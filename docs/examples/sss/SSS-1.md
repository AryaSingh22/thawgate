# SSS-1 Specification: Minimal Stablecoin Standard

## 1. Introduction

SSS-1 defines the baseline standard for a Solana stablecoin leveraging Token-2022. It is designed for issuers requiring strict role-based access control and quota-enforced minting, but without the mandatory use of complex transfer hooks or permanent delegates.

## 2. Conformance Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

## 3. Token-2022 Extension Requirements

An SSS-1 compliant token:
- **MUST** be initialized as a Token-2022 Mint.
- **MUST NOT** initialize the `TransferHook` extension.
- **MUST NOT** initialize the `PermanentDelegate` extension.
- **MUST NOT** initialize the `DefaultAccountState` extension as `Frozen`.
- **MAY** initialize the `MetadataPointer` extension to point to self.
- **MAY** initialize the `TokenMetadata` extension.

## 4. Account Schemas

All PDAs **MUST** be derived from the Mint address to ensure deterministic discovery.

### 4.1 `StablecoinConfig` (PDA: `["config", MINT]`)
| Offset | Name | Type | Size (Bytes) | Description |
|--------|------|------|--------------|-------------|
| 0 | `discriminator` | `[u8; 8]` | 8 | Anchor discriminator |
| 8 | `authority` | `Pubkey` | 32 | Global program authority |
| 40 | `mint` | `Pubkey` | 32 | Token-2022 Mint address |
| 72 | `name` | `[u8; 32]` | 32 | Null-padded string |
| 104| `symbol` | `[u8; 8]` | 8 | Null-padded string |
| 112| `decimals` | `u8` | 1 | Token decimals (0-9) |
| 113| `enable_transfer_hook`| `bool` | 1 | **MUST** be `false` in SSS-1 |
| 114| `enable_permanent_delegate`| `bool` | 1 | **MUST** be `false` in SSS-1 |
| 115| `default_account_frozen`| `bool` | 1 | **MUST** be `false` in SSS-1 |
| 116| `total_minted`| `u64` | 8 | Cumulative minted amount |
| 124| `total_burned`| `u64` | 8 | Cumulative burned amount |
| 132| `bump` | `u8` | 1 | PDA bump |
**Total Size:** 133 Bytes

### 4.2 `PauseState` (PDA: `["pause_state", MINT]`)
| Offset | Name | Type | Size (Bytes) | Description |
|--------|------|------|--------------|-------------|
| 0 | `discriminator` | `[u8; 8]` | 8 | Anchor discriminator |
| 8 | `authority` | `Pubkey` | 32 | Last Pauser authority |
| 40 | `is_paused` | `bool` | 1 | `true` if transfers/mints halted |
| 41 | `timestamp` | `i64` | 8 | Unix timestamp of state change |
**Total Size:** 49 Bytes

### 4.3 `RoleRecord` (PDA: `["role", MINT, WALLET, ROLE_TYPE_U8]`)
| Offset | Name | Type | Size (Bytes) | Description |
|--------|------|------|--------------|-------------|
| 0 | `discriminator` | `[u8; 8]` | 8 | Anchor discriminator |
| 8 | `authority` | `Pubkey` | 32 | Wallet holding the role |
| 40 | `role_type` | `u8` | 1 | 0=Master, 1=Minter, 2=Burner, 3=Pauser, 4=Blacklister, 5=Seizer |
| 41 | `active` | `bool` | 1 | `true` if role is currently valid |
| 42 | `granted_at` | `i64` | 8 | Unix timestamp |
| 50 | `granted_by` | `Pubkey` | 32 | Master authority that granted |
| 82 | `bump` | `u8` | 1 | PDA bump |
**Total Size:** 83 Bytes

## 5. Instruction Specification

### 5.1 `initialize`
- **MUST** create the `StablecoinConfig` and `PauseState` accounts.
- **MUST** assign the `MasterAuthority` role to the payer/authority.
- **MUST** set the mint authority and freeze authority of the Token-2022 mint to the `StablecoinConfig` PDA.

### 5.2 `mint_tokens`
- **MUST** verify the signer holds an active `Minter` role.
- **MUST** verify `PauseState.is_paused == false`.
- **MUST** fetch the `MinterQuota` PDA for the signer.
- **MUST** enforce the quota limit (`current_minted + amount <= limit`).
- **MUST** emit a `MintEvent`.

### 5.3 `burn_tokens`
- **MUST** verify the signer holds an active `Burner` role.
- **MUST** verify the signer is burning from an ATA they own.
- **MUST** emit a `BurnEvent`.

## 6. Known Exclusions
SSS-1 **DOES NOT** include:
1. `add_to_blacklist`
2. `remove_from_blacklist`
3. `seize`
*(These require SSS-2 extensions).*
