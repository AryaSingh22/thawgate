//! Transfer Hook error codes.
//!
//! Defines errors specific to the transfer hook program.

use anchor_lang::prelude::*;

/// Error codes for the transfer hook program.
#[error_code]
pub enum TransferHookError {
    /// Token operations are paused — transfers blocked by pause state.
    #[msg("Transfer blocked: token operations are currently paused")]
    TokensPaused,

    /// The source address is blacklisted — transfers from this address are blocked.
    #[msg("Transfer blocked: source address is blacklisted")]
    SourceBlacklisted,

    /// The destination address is blacklisted — transfers to this address are blocked.
    #[msg("Transfer blocked: destination address is blacklisted")]
    DestinationBlacklisted,

    /// The extra account meta list has already been initialized.
    #[msg("Extra account meta list already initialized")]
    AlreadyInitialized,

    /// Failed to deserialize an account's data — account may be corrupt or wrong type.
    #[msg("Failed to deserialize account data — account data is invalid or corrupted")]
    InvalidAccountData,

    /// The account passed as the sss-token program is not sss-token.
    #[msg("Invalid sss-token program: the compliance PDAs must derive from the sss-token program")]
    InvalidSssTokenProgram,
}
