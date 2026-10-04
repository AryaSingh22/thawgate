# Security Documentation

## Overview

This document details the security measures, testing, and known considerations for the SSS stablecoin standard. The system is designed with defense-in-depth principles combining isolated Role-Based Access Control, Program-Derived Authority boundaries, and intense Fuzz testing.

## Fuzz Testing Coverage

The SSS business logic is mathematically verified using the **Trident** fuzzing framework for Solana. Trident generates hundreds of thousands of pseudo-random interaction sequences to prove invariant safety.

### SSS-1 Fuzz Targets (`fuzz_0`)

| Target | Description | Invariants Tested |
|--------|-------------|-------------------|
| `fuzz_initialize` | Random init parameters | Config PDA created correctly, extension flags immutable. |
| `fuzz_mint` | Random amounts and states | Zero-amount rejection, strict quota enforcement, pause check. |
| `fuzz_burn` | Random burn amounts | Zero-amount rejection, underflow protection. |
| `fuzz_freeze_thaw` | State machine coverage | Double-freeze rejection, thaw-when-not-frozen rejection. |
| `fuzz_pause_unpause` | State machine coverage | Double-pause rejection, unpause-when-not-paused rejection. |
| `fuzz_update_roles` | Role management | MasterAuthority protection, duplicate role rejection. |

### SSS-2 Compliance Fuzz Targets (`fuzz_1`)

| Target | Description | Invariants Tested |
|--------|-------------|-------------------|
| `fuzz_blacklist` | Blacklist operations | Role isolation, feature gating, active flag toggling. |
| `fuzz_seize` | Token seizure | Multi-condition validation (Role + PermanentDelegate + Blacklist + Frozen). |
| `fuzz_transfer_hook`| Hook enforcement | Blacklist active rejection, global pause rejection. |
| `fuzz_role_escalation`| Cross-role prevention | A Minter cannot execute Seize, Burner cannot Blacklist. |
| `fuzz_concurrent_ops` | Operation sequences | Race conditions blocking blacklist-to-thaw discrepancies. |

### Reproducing Fuzz Tests

To reproduce the 0-crash results locally (requires WSL/Linux):

1. Install Trident CLI:
```bash
cargo install trident-cli
```
2. Run SSS-1 standard campaign:
```bash
cd trident-tests/fuzz_tests/fuzz_0
cargo trident fuzz run --max_total_time=120
```
3. Run SSS-2 compliance campaign:
```bash
cd trident-tests/fuzz_tests/fuzz_1
cargo trident fuzz run --max_total_time=120
```

## Role-Based Access Control (RBAC)

RBAC is strictly enforced at the program level. 
- **Role Isolation:** A Minter cannot acquire Burner or Pauser capabilities implicitly. 
- **Self-Modification Prevention:** MasterAuthority transfer is atomic (old deactivated, new activated in one tx).
- **Auditability:** Role records are PDA-based and **never deleted**. Revoking a role merely toggles its `active` boolean, ensuring a permanent historical record.

## Supply Protection

- **Checked Math:** `total_minted` and `total_burned` state variables rigidly use Rust's `checked_add` and `checked_sub` to prevent overflow exploits.
- **Zero-Value Protection:** Zero-amount mints and burns are rejected at the instruction level to prevent spam.
- **Bounded Impact:** Quota enforcement ensures that even if a Minter key is compromised, the attacker can only mint up to the strictly defined limit for that time period.

## Reserve check (S9)

`mint_tokens` reads the mint's `ReserveAttestation` ([RESERVES.md](RESERVES.md)).
- **Supply cap:** `mint.supply + amount <= reserves`, with Token-2022's `supply` (not the config counters, which `seize` skews).
- **Staleness:** `now - as_of <= max_staleness`, checked first.
- **Who posts:** only the attestor MasterAuthority set. A new attestor clears the posted reserves. The account can't be closed, and a caller can't omit it from `mint_tokens`.
- **Trust:** the attestor key is trusted for the number itself. The demo attestor is ThawGate's own key.

The `oracle-module` program it replaced was retired in S9. Its `oracle_gated_mint` never read a feed, and anyone could create a mint's oracle config first.

## Sanctions screener (S10)

The screener in `services/compliance-service` blacklists wallets a risk provider flags ([SANCTIONS.md](SANCTIONS.md)).
- **Trust assumption: an operator key writes the blacklist.** The screener key holds the sss-token Blacklister role and nothing else. The gate trusts the `BlacklistEntry`; it can't verify the provider's verdict, which the reason string (`range:<score>`, `static:<list>`) only records. A compromised screener key can blacklist, and so freeze, any holder of the mints it holds the role on. Revoke the role and remove the entries.
- **Fail-safe:** provider errors and timeouts never blacklist; they are counted in `/metrics`. An outage is a screening gap, not a freeze.
- **No automatic seize.** Seizing stays a manual Seizer action through the CLI.
- **Switchboard-verified quotes are cut.** The provider's score never reaches the chain.

## Known Limitations & Experimental Features

1. **Confidential Transfers (SSS-3):** SSS-3 confidential transfer instructions validate feature flags but rely on the raw SPL Confidential Transfer CPI. Production deployment requires careful adherence to Solana's exact compute budget limits for ZK proofs.
2. **Reserve sources:** reserves come from a signed attestation only. A Switchboard or Chainlink Proof of Reserve source is a TODO ([RESERVES.md](RESERVES.md)).
3. **Extra Account Meta Lists:** The transfer hook program enforces blacklist/pause checks securely, but requires the `ExtraAccountMetaList` PDA to be explicitly initialized by the admin immediately after mint creation to function.
4. **Fixed in S15: blacklisting a wallet again.** Until S15, `add_to_blacklist` created the `BlacklistEntry` with `init`, and `remove_from_blacklist` only set `active = false`, so a second `add_to_blacklist` after a removal failed with "already in use". `add_to_blacklist` now reactivates the inactive entry (no new rent; reason, time and operator are overwritten, and the `AddedToBlacklist` / `RemovedFromBlacklist` events keep the history). An active entry is refused with `AccountAlreadyBlacklisted` (6011). `add_to_allowlist_v3` (refused while active with `AllowlistEntryAlreadyActive`, 6041) and `transfer_authority` (authority can return to a previous holder; a transfer to yourself is refused with `RoleAlreadyActive`, 6017) had the same `init` pattern and got the same fix. The screener still treats an inactive entry as an operator override and doesn't re-add the wallet.
5. **Range adapter untested live.** The screener's Range provider is unit-tested against mocked responses only; no live call has been made (no API key). The devnet run used the static-list fallback.

## TODO

- **Mainnet: upgrade authorities → multisig.** On devnet each program is upgradeable by a single key: `5BXg…` for sss-token and the ThawGate gate (and the retired oracle-module), `3YnV…` for the transfer hook. Before any mainnet deploy, move each upgrade authority to a multisig. (The gate is unaudited; there are no mainnet deploys.)
