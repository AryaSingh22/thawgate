# Architecture

## Layer Model

The Solana Stablecoin Standard (SSS) is designed across three distinct layers:

```
Layer 3 (Standards)   ┌──────────┐  ┌──────────┐  ┌──────────┐
                      │  SSS-1   │  │  SSS-2   │  │  SSS-3   │
                      │ (Basic)  │  │(Compliant│  │ (Exper.) │
                      └────┬─────┘  └────┬─────┘  └────┬─────┘
                           │              │             │
Layer 2 (Modules)    ┌─────┴──────────────┴─────────────┴─────┐
                     │ Role Mgmt │ Compliance │ Oracle Gating │
                     │ Quota     │ Blacklist  │ ZK Transfers  │
                     │ Pause     │ Seizure    │ Allowlist     │
                     └────────────┬───────────┴───────────────┘
                                  │
Layer 1 (Base/SDK)   ┌────────────┴───────────────────────────┐
                     │           SolanaStablecoin             │
                     │       Token-2022 CPI Operations        │
                     │             PDA Derivation             │
                     └────────────────────────────────────────┘
```

## Program Architecture

The on-chain system consists of three Anchor programs:

1. **`sss-token`**: The core standard program implementing the 16 instructions for minting, role management, pausing, and SSS-2 compliance actions.
2. **`transfer-hook`**: A Token-2022 Transfer Hook extension program that blocks transfers if the token is paused or if either the source or destination wallet is blacklisted.
3. **`thawgate-gate`**: The Token ACL gate (ThawGate). Before S9 this slot held `oracle-module`, a stub that never read a feed. It was retired in S9; `sss-token` `mint_tokens` now checks attested reserves itself ([RESERVES.md](RESERVES.md)).

## Account/PDA Layout

All Program Derived Addresses (PDAs) are strictly derived from the **mint address** and specific seed prefixes to ensure consistent addressing across the ecosystem.

| PDA | Seeds | Size (Bytes) | Purpose |
|-----|-------|--------------|---------|
| `StablecoinConfig` | `["config", mint]` | 129 | Global configuration (name, symbol, decimals). |
| `PauseState` | `["pause_state", mint]` | 37 | Global pause flag to halt all transfers. |
| `RoleRecord` | `["role", mint, holder, role_type]` | 65 | Role assignment (Master, Minter, Burner, etc). |
| `MinterQuota` | `["minter_quota", mint, minter]` | 53 | Mint rate limiting (daily/weekly/monthly limits). |
| `BlacklistEntry` | `["blacklist", mint, wallet_authority]` | 45 | Compliance blacklist (uses wallet owner, not token account). |
| `AllowlistEntry` | `["allowlist", mint, wallet_authority]` | 29 | Regulatory gating for SSS-3 transfers. |
| `ExtraAccountMetaList` | `["extra-account-metas", mint]` | Variable | Transfer hook metadata mapping for Token-2022. |
| `ReserveAttestation` | `["reserve_attestation", mint]` | 373 | Attested reserves (base units) that `mint_tokens` checks ([RESERVES.md](RESERVES.md)). |

## Transfer Hook Data Flow

The `transfer-hook` program intercepts every token transfer at the protocol level.

```
[User Transfer TX]
       │
       ▼
Token-2022 Program: 
Is Transfer Hook enabled for this Mint? ──YES──► Call TransferHook.execute()
                                                          │
   ┌──────────────────────────────────────────────────────┘
   │
   ├── 1. Resolve ExtraAccountMetaList PDA
   ├── 2. Load `PauseState` PDA ───────────────► IF true: Reject Transfer
   ├── 3. Load `BlacklistEntry` (Source) ──────► IF active: Reject Transfer
   ├── 4. Load `BlacklistEntry` (Destination) ─► IF active: Reject Transfer
   │
   └──► ALL CLEAR ──► Return Ok() ──► Token-2022 Completes Transfer
```

**Note on Blacklist Resolution:** The hook explicitly reads the `owner` authority (bytes 32..64) from the associated token account data to derive the `BlacklistEntry` PDA. Blacklisting a token account address has no effect; the actual user wallet must be blacklisted.

## Data Flows

### Minting Flow

1. **Operator** uses CLI/SDK: `thawgate mint --mint <MINT> --recipient <WALLET> --amount <BASE_UNITS>`
2. **SDK** automatically derives necessary PDAs (`config`, `pause_state`, `minter_quota`).
3. **Anchor** CPIs into `sss-token` program -> `mint_tokens` instruction.
4. **On-Chain checks**:
   - Is token paused?
   - Does sender have `Minter` role?
   - Does mint amount exceed remaining quota for current period?
5. **On-Chain Action**: CPI to Token-2022 `mint_to`.
6. **Backend**: `indexer` picks up the transaction signature from RPC.
7. **Backend**: Saves `MintOperation` row to PostgreSQL.
8. **Backend**: `webhook-service` fires HTTP POST to registered listeners.

### Compliance Seize Flow

1. **Law Enforcement/Admin** uses CLI/SDK: `thawgate seize --mint <MINT> --source <FROZEN_ACCOUNT> --source-authority <WALLET> --treasury <TREASURY> --confirm`
2. **On-Chain checks**:
   - Does sender have `Seizer` role?
   - Is the target `<frozen_account>` actually frozen? (Required)
   - Is the target wallet blacklisted? (Required)
3. **On-Chain Action**: CPI to Token-2022 `transfer_checked` (force moving funds) OR `burn` followed by `mint` depending on implementation approach. (Currently uses Burn/Mint replacement).
4. **Backend**: `indexer` reads the seize event payload.
5. **Backend**: Saves `ComplianceEvent` to the regulatory audit log database.

## Role Model

SSS employs a strict Role-Based Access Control (RBAC) model. 

- **MasterAuthority**: Can grant/revoke roles and configure the stablecoin. Cannot mint or seize directly without assigning themselves the role.
- **Minter**: Can execute `mint_tokens`, constrained by `MinterQuota`.
- **Burner**: Can execute `burn_tokens` from their own accounts.
- **Pauser**: Can execute `pause` and `unpause` instructions.
- **Blacklister**: Can execute `add_to_blacklist`, `remove_from_blacklist`, `freeze_account`, and `thaw_account`.
- **Seizer**: Can execute `seize` against frozen/blacklisted accounts.

## Security Model

| Feature | Mechanism |
|---------|-----------|
| **Immutability of Extensions** | Token-2022 extensions (like `TransferHook` and `PermanentDelegate`) are locked permanently via `StablecoinConfig` flags during initialization. |
| **Audit Trails** | `RoleRecord` and `BlacklistEntry` accounts are **never deleted**. When a role is revoked or a blacklist lifted, an `active` boolean is flipped to `false`. This preserves historical on-chain evidence of all compliance actions. |
| **Supply Protection** | Minting uses Rust checked math (`checked_add`) to prevent overflow exploits. Quota periods ensure compromised Minter keys have explicitly bounded impact. |
| **Reserve check** | `mint_tokens` refuses `mint.supply + amount > reserves` (`ReserveInsufficient`) and an attestation older than `max_staleness` (`ReserveStale`). Acl/Both mints need an attestation ([RESERVES.md](RESERVES.md)). |
| **Sanctions screening** | Off chain: the screener (`services/compliance-service`) sends `add_to_blacklist` for holders a risk provider flags, signed by a Blacklister-role key; the keeper freezes the rest. The gate trusts the entry, not the provider ([SANCTIONS.md](SANCTIONS.md)). |
| **Fuzz Testing** | Business logic is verified with Trident fuzz harnesses running thousands of pseudo-random interaction sequences to prove invariant safety. |
