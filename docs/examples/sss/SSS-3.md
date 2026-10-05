# SSS-3 Specification: Experimental Private Stablecoin

## 1. Introduction

SSS-3 builds upon the SSS-2 compliance standard to introduce privacy-preserving features. It utilizes the Token-2022 Confidential Transfer extension to encrypt transaction amounts on-chain, paired with an Allowlist mechanism to ensure only pre-approved wallets can hold or transact the asset. 

**Status:** Experimental. SSS-3 is intended for highly regulated environments (e.g., inter-bank settlements) where transaction privacy is legally mandated.

## 2. Conformance Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

## 3. Token-2022 Extension Requirements

An SSS-3 compliant token:
- **MUST** include all extensions required by SSS-2 (`TransferHook`, `PermanentDelegate`, `DefaultAccountState`).
- **MUST** initialize the `ConfidentialTransfer` extension.
- **MUST** initialize the `ConfidentialTransferFee` extension (even if fee is 0).
- **MUST NOT** allow modifying `enable_confidential_transfers` or `enable_allowlist` after initialization.

## 4. Account Schemas

SSS-3 inherits all accounts from SSS-1 and SSS-2, and adds the following gating mechanism:

### 4.1 `AllowlistEntry` (PDA: `["allowlist", MINT, WALLET_AUTHORITY]`)
| Offset | Name | Type | Size (Bytes) | Description |
|--------|------|------|--------------|-------------|
| 0 | `discriminator` | `[u8; 8]` | 8 | Anchor discriminator |
| 8 | `authority` | `Pubkey` | 32 | Wallet owner being allowed |
| 40 | `active` | `bool` | 1 | `true` if allowlist is enforced |
| 41 | `timestamp` | `i64` | 8 | Unix timestamp of addition |
| 49 | `operator` | `Pubkey` | 32 | MasterAuthority who added entry |
| 81 | `bump` | `u8` | 1 | PDA bump |
**Total Size:** 82 Bytes

## 5. Instruction Specification

### 5.1 `add_to_allowlist_v3`
- **MUST** verify the signer holds an active `MasterAuthority` role (or a highly privileged delegated role).
- **MUST** verify `config.enable_allowlist == true`.
- **MUST** create or update the `AllowlistEntry` PDA with `active = true` for the target wallet.
- **SHOULD** automatically execute a Token-2022 `thaw_account` CPI if `DefaultAccountState` initially froze the account.
- **MUST** emit an `AllowlistEvent`.

### 5.2 `remove_from_allowlist_v3`
- **MUST** verify the signer holds an active `MasterAuthority` role.
- **MUST** set `AllowlistEntry.active = false`.
- **MUST NOT** delete the account.
- **MUST** execute a Token-2022 `freeze_account` CPI against the target's token account to prevent further transfers.

### 5.3 Confidential Transfer Operations
Standard Token-2022 confidential transfer instructions are heavily integrated:
- `configure_confidential_account`: **MUST** be called by the token account owner before receiving confidential transfers.
- `apply_pending_balance`: **MUST** be called to move incoming encrypted transfers into the spendable encrypted balance.
- SSS-3 wrapper instructions for these operations **MAY** exist to enforce additional allowlist checks during configuration.

## 6. Transfer Hook Execution (SSS-3 Variant)

The `transfer-hook` program's `execute` instruction is expanded for SSS-3:
1. **MUST** load `PauseState` → reject if true.
2. **MUST** load `BlacklistEntry` → reject if active for source or destination.
3. **MUST** conditionally load `AllowlistEntry` for source and destination if the Token-2022 mint indicates `enable_allowlist` is active via CPI or shared state. If `active == false` or the account does not exist, the transfer **MUST** abort with an `AddressNotAllowlisted` error.

## 7. Security & Limitations

- **ZKP Overhead:** Confidential transfers require significant compute budget for zero-knowledge proofs (ElGamal encryption). Transactions **MUST** heavily utilize compute budget instruction (`SetComputeUnitLimit`).
- **CPI Limitations:** As of Solana 1.18, CPIs executing confidential transfers from PDAs have known limitations. Mints or burns of confidential amounts by program authorities require precise handling of audited attributes.
- **Auditing:** The auditor authority configured in the `ConfidentialTransfer` extension **SHALL** possess the ElGamal decryptable auditor key, allowing the issuer to view decrypted amouts for regulatory reporting despite on-chain privacy.
