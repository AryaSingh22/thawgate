# SSS-2 Specification: Enhanced Compliance Standard

## 1. Introduction

SSS-2 extends SSS-1 by mandating Token-2022 extensions required for enterprise compliance: Permanent Delegate, Transfer Hook, and Default Account State. It enforces real-time transfer blocking and enables asset seizure from blacklisted accounts.

## 2. Conformance Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

## 3. Token-2022 Extension Requirements

An SSS-2 compliant token:
- **MUST** be initialized as a Token-2022 Mint.
- **MUST** initialize the `TransferHook` extension pointing to a strictly validating hook program.
- **MUST** initialize the `PermanentDelegate` extension pointing to the `StablecoinConfig` PDA.
- **MUST** initialize the `DefaultAccountState` extension as `Frozen` or `Initialized` depending on business requirements (usually `Frozen` for strict KYC gating).
- **MUST NOT** allow modifying `enable_transfer_hook`, `enable_permanent_delegate`, or `default_account_frozen` after initialization.

## 4. Account Schemas

SSS-2 inherits all accounts from SSS-1 and adds the following:

### 4.1 `BlacklistEntry` (PDA: `["blacklist", MINT, WALLET_AUTHORITY]`)
| Offset | Name | Type | Size (Bytes) | Description |
|--------|------|------|--------------|-------------|
| 0 | `discriminator` | `[u8; 8]` | 8 | Anchor discriminator |
| 8 | `authority` | `Pubkey` | 32 | Wallet owner being blacklisted |
| 40 | `active` | `bool` | 1 | `true` if blacklist is enforced |
| 41 | `timestamp` | `i64` | 8 | Unix timestamp of addition |
| 49 | `operator` | `Pubkey` | 32 | Blacklister who added entry |
| 81 | `reason` | `String` | ≤104| UTF-8 string (4 bytes len + 100 bytes max payload) |
| 185| `bump` | `u8` | 1 | PDA bump |
**Max Total Size:** 186 Bytes

### 4.2 `ExtraAccountMetaList` (Transfer Hook PDA: `["extra-account-metas", MINT]`)
Required by the `spl-transfer-hook-interface` to resolve accounts during transfer.
- **MUST** include index mapping for:
  - `sss-token` program ID
  - `PauseState` PDA
  - `BlacklistEntry` PDA (Source Wallet)
  - `BlacklistEntry` PDA (Destination Wallet)

## 5. Instruction Specification

### 5.1 `add_to_blacklist`
- **MUST** verify the signer holds an active `Blacklister` role.
- **MUST** verify `config.enable_transfer_hook == true`.
- **MUST** create or update the `BlacklistEntry` PDA with `active = true`.
- **MUST** execute a Token-2022 `freeze_account` CPI against the target's associated token account.
- **MUST** emit a `BlacklistEvent`.

### 5.2 `remove_from_blacklist`
- **MUST** verify the signer holds an active `Blacklister` role.
- **MUST** set `BlacklistEntry.active = false`.
- **MUST NOT** delete the account (to preserve the audit trail).
- **MUST NOT** automatically thaw the token account (operators **MUST** call `thaw_account` separately).

### 5.3 `seize`
- **MUST** verify the signer holds an active `Seizer` role.
- **MUST** verify `config.enable_permanent_delegate == true`.
- **MUST** verify `BlacklistEntry.active == true` for the target wallet.
- **MUST** execute a Token-2022 `transfer_checked` or `burn`/`mint` sequence using the `PermanentDelegate` authority (the `StablecoinConfig` PDA) to move funds to the destination treasury.
- **MUST** emit a `SeizeEvent`.

## 6. Transfer Hook Execution

The `transfer-hook` program's `execute` instruction:
1. **MUST** load the `PauseState` PDA. If `is_paused == true`, the transfer **MUST** abort with a `TokenPaused` error.
2. **MUST** load the `BlacklistEntry` for the **source** wallet. The wallet address **MUST** be resolved from bytes 32..64 of the source Token Account data. If `active == true`, the transfer **MUST** abort with a `WalletBlacklisted` error.
3. **MUST** load the `BlacklistEntry` for the **destination** wallet. The wallet address **MUST** be resolved from bytes 32..64 of the destination Token Account data. If `active == true`, the transfer **MUST** abort with a `WalletBlacklisted` error.
4. **MUST** return `Ok(())` if all checks pass.
