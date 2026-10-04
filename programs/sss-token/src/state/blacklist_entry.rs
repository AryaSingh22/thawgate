//! Blacklist entry account (SSS-2).
//!
//! Tracks addresses that are blocked from sending or receiving tokens.
//! Blacklist entries are never deleted — when removed, `active` is set to `false`
//! to maintain a complete audit trail. Blacklisting the address again reactivates the entry (S15).

use anchor_lang::prelude::*;
use crate::constants::MAX_REASON_LEN;

// Space = 8 (discriminator)
//       + 32 (mint Pubkey)
//       + 32 (target Pubkey)
//       + 4 + 100 (reason String: len prefix + max bytes)
//       + 8 (added_at i64)
//       + 32 (added_by Pubkey)
//       + 1 (active bool)
//       + 1 (bump u8)
//       = 218
/// Size of the [`BlacklistEntry`] account in bytes, including the 8-byte discriminator.
pub const BLACKLIST_ENTRY_SIZE: usize = 8 + 32 + 32 + (4 + MAX_REASON_LEN) + 8 + 32 + 1 + 1;

/// A record of an address that has been blacklisted for a specific mint (SSS-2 only).
///
/// Derived as a PDA from `[SEED_BLACKLIST, mint.key(), target.key()]`.
/// When an address is blacklisted, their token account is also frozen.
/// Entries are never deleted; `active` is set to `false` when removed, and back to `true` when the address is
/// blacklisted again (`reason`, `added_at` and `added_by` then describe the latest blacklisting).
#[account]
#[derive(Debug)]
pub struct BlacklistEntry {
    /// The mint this blacklist entry applies to.
    pub mint: Pubkey,
    /// The wallet address that is blacklisted.
    pub target: Pubkey,
    /// Human-readable reason for the blacklisting (max 100 bytes).
    pub reason: String,
    /// Unix timestamp when the address was blacklisted.
    pub added_at: i64,
    /// The operator who added this blacklist entry.
    pub added_by: Pubkey,
    /// Whether this blacklist entry is currently active.
    pub active: bool,
    /// PDA bump seed for this account.
    pub bump: u8,
}
