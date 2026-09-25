//! Error codes for the SSS-Token program.
//!
//! Every error that can be thrown by any instruction in the program is defined here.
//! Each variant includes a human-readable message specific enough for operators
//! to diagnose issues without reading source code.

use anchor_lang::prelude::*;

/// Comprehensive error enum for the SSS-Token program.
///
/// All errors are defined upfront. New errors should not be added mid-implementation
/// without updating this central registry.
#[error_code]
pub enum SssError {
    /// The signer does not have the required role or authority for this operation.
    #[msg("Not authorized: the signer lacks the required role for this operation")]
    NotAuthorized,

    /// Attempted to modify an immutable configuration field after initialization.
    #[msg("Configuration is immutable: permanent_delegate, transfer_hook, and default_account_frozen cannot be changed after initialization")]
    ConfigImmutable,

    /// An SSS-2 feature was invoked on a token that does not have it enabled.
    #[msg("Feature not enabled: this operation requires enable_transfer_hook to be true at initialization")]
    FeatureNotEnabled,

    /// The stablecoin configuration account has already been initialized for this mint.
    #[msg("Already initialized: a stablecoin config already exists for this mint")]
    AlreadyInitialized,

    /// The provided mint account does not match the expected mint in the configuration.
    #[msg("Invalid mint: the provided mint account does not match the config's mint")]
    InvalidMint,

    /// Token operations are paused. Mint, burn, and transfer operations are blocked.
    #[msg("Tokens paused: mint, burn, and transfer operations are currently suspended")]
    TokensPaused,

    /// No active minter role record was found for the given address.
    #[msg("Minter not found: no active minter role record exists for this address")]
    MinterNotFound,

    /// The minter has exceeded their allowed minting quota for the current period.
    #[msg("Minter quota exceeded: the requested mint amount would exceed the minter's allowed limit")]
    MinterQuotaExceeded,

    /// No active burner role record was found for the given address.
    #[msg("Burner not found: no active burner role record exists for this address")]
    BurnerNotFound,

    /// The target account is not frozen, but the operation requires it to be frozen.
    #[msg("Account not frozen: the target token account is not currently frozen")]
    AccountNotFrozen,

    /// The target account is already frozen.
    #[msg("Account already frozen: the target token account is already in a frozen state")]
    AccountAlreadyFrozen,

    /// The target address is already on the blacklist.
    #[msg("Account already blacklisted: an active blacklist entry already exists for this address")]
    AccountAlreadyBlacklisted,

    /// The target address is not currently on the blacklist.
    #[msg("Account not blacklisted: no active blacklist entry exists for this address")]
    AccountNotBlacklisted,

    /// No active blacklister role record was found for the given address.
    #[msg("Blacklister not found: no active blacklister role record exists for this address")]
    BlacklisterNotFound,

    /// The seize operation is not authorized for this configuration or role.
    #[msg("Seize not authorized: the signer lacks the seizer role or permanent_delegate is not enabled")]
    SeizeNotAuthorized,

    /// No active pauser role record was found for the given address.
    #[msg("Pauser not found: no active pauser role record exists for this address")]
    PauserNotFound,

    /// The specified role type is invalid or not recognized.
    #[msg("Invalid role type: the provided role type is not recognized by the program")]
    InvalidRoleType,

    /// A role record already exists and is active for this holder and role type.
    #[msg("Role already active: an active role record already exists for this holder and role type")]
    RoleAlreadyActive,

    /// The role record for this holder is not currently active.
    #[msg("Role not active: the role record for this holder is not currently active")]
    RoleNotActive,

    /// The provided amount is invalid (e.g., zero when a positive value is required).
    #[msg("Invalid amount: the provided amount must be greater than zero")]
    InvalidAmount,

    /// An arithmetic overflow occurred during a checked operation.
    #[msg("Overflow: arithmetic overflow occurred during supply or quota calculation")]
    Overflow,

    /// The provided configuration parameters are invalid.
    #[msg("Invalid config: one or more configuration parameters are out of valid range")]
    InvalidConfig,

    /// The transfer hook compliance check failed (blacklisted or paused).
    #[msg("Transfer hook check failed: the transfer was rejected by the compliance hook")]
    TransferHookCheckFailed,

    /// The name field exceeds the maximum allowed length.
    #[msg("Name too long: the token name exceeds the maximum length of 32 bytes")]
    NameTooLong,

    /// The symbol field exceeds the maximum allowed length.
    #[msg("Symbol too long: the token symbol exceeds the maximum length of 10 bytes")]
    SymbolTooLong,

    /// The URI field exceeds the maximum allowed length.
    #[msg("URI too long: the metadata URI exceeds the maximum length of 200 bytes")]
    UriTooLong,

    /// The reason field exceeds the maximum allowed length.
    #[msg("Reason too long: the blacklist reason exceeds the maximum length of 100 bytes")]
    ReasonTooLong,

    /// The permanent delegate feature is required but not enabled.
    #[msg("Permanent delegate not enabled: seize requires enable_permanent_delegate to be true")]
    PermanentDelegateNotEnabled,

    /// The target account does not have an active blacklist entry, which is required for seizure.
    #[msg("Blacklist entry required: seize requires the target address to have an active blacklist entry")]
    BlacklistEntryRequired,

    /// The token operations are already paused — cannot pause again.
    #[msg("Already paused: token operations are already suspended")]
    AlreadyPaused,

    /// The token operations are not currently paused — cannot unpause.
    #[msg("Not paused: token operations are not currently suspended")]
    NotPaused,

    /// The allowlist entry for this wallet is not active (SSS-3).
    #[msg("Allowlist entry not active: the allowlist entry for this wallet has been deactivated")]
    AllowlistEntryNotActive,

    /// `compliance_mode` is out of range or inconsistent with the other initialize flags.
    #[msg("Invalid compliance mode: use 0 (Hook), 1 (Acl: default_account_frozen, no hook) or 2 (Both: default_account_frozen and the hook)")]
    InvalidComplianceMode,

    /// A Token ACL instruction was called on a mint created in Hook mode.
    #[msg("Not a Token ACL mint: this instruction needs compliance_mode Acl or Both")]
    NotTokenAclMode,

    /// The mint's freeze authority is neither this config nor its Token ACL MintConfig.
    #[msg("Unknown freeze authority: the mint's freeze authority is neither the config PDA nor the Token ACL MintConfig")]
    UnknownFreezeAuthority,
}
