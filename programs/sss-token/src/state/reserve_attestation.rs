//! Reserve attestation account (S9).
//!
//! The reserves backing a mint, as posted by the mint's attestor. `mint_tokens` refuses a mint that would take the
//! Token-2022 supply above `reserves`, and any mint while the attestation is older than `max_staleness`.
//! Acl and Both mode mints need one to mint at all; a Hook mode mint is checked once its MasterAuthority creates one.
//! There is no close instruction, so a mint that has one stays checked.

use anchor_lang::prelude::*;
use crate::constants::MAX_URI_LEN;

// Space = 8 (discriminator)
//       + 32 (mint Pubkey)
//       + 32 (attestor Pubkey)
//       + 8 (reserves u64)
//       + 8 (as_of i64)
//       + 8 (max_staleness i64)
//       + 4 + 200 (report_uri String: len prefix + max bytes)
//       + 8 (posted_at i64)
//       + 1 (bump u8)
//       + 64 (reserved)
//       = 373
/// Size of the [`ReserveAttestation`] account in bytes, including the 8-byte discriminator.
pub const RESERVE_ATTESTATION_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + (4 + MAX_URI_LEN) + 8 + 1 + 64;

/// The attested reserves for one mint.
///
/// Derived as a PDA from `[SEED_RESERVE, mint.key()]`. MasterAuthority sets `attestor` and `max_staleness`
/// (`set_reserve_attestor`); only the attestor posts `reserves`, `as_of` and `report_uri` (`attest_reserves`).
#[account]
#[derive(Debug)]
pub struct ReserveAttestation {
    /// The mint these reserves back.
    pub mint: Pubkey,
    /// The key whose signature `attest_reserves` requires.
    pub attestor: Pubkey,
    /// Reserves in the mint's **base units** (same decimals as the token: 1.00 of a 6-decimal coin is 1_000_000).
    pub reserves: u64,
    /// Unix time (seconds) at which the attestor measured `reserves`. 0 until the first post.
    pub as_of: i64,
    /// Seconds after `as_of` during which minting may rely on this attestation.
    pub max_staleness: i64,
    /// Where the attestor's report lives (max 200 bytes).
    pub report_uri: String,
    /// Cluster time of the last `attest_reserves`. 0 until the first post.
    pub posted_at: i64,
    /// PDA bump seed for this account.
    pub bump: u8,
    /// Zero. Room for an oracle-fed source (Switchboard, Chainlink) without a layout change.
    pub reserved: [u8; 64],
}

/// Outcome of the reserve check in `mint_tokens`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveCheck {
    Ok,
    /// `now - as_of > max_staleness`. Checked first: stale reserves are not compared.
    Stale,
    /// `supply + amount > reserves`, or the sum overflows u64.
    Insufficient,
}

/// Whether minting `amount` on top of `supply` is covered by an attestation of `reserves` taken at `as_of`.
pub fn check_reserves(supply: u64, amount: u64, reserves: u64, as_of: i64, max_staleness: i64, now: i64) -> ReserveCheck {
    if now.saturating_sub(as_of) > max_staleness {
        return ReserveCheck::Stale;
    }
    match supply.checked_add(amount) {
        Some(total) if total <= reserves => ReserveCheck::Ok,
        _ => ReserveCheck::Insufficient,
    }
}

/// Whether the attestor may post `as_of` over a stored `stored_as_of` at cluster time `now`: not in the future and
/// not older than what is already posted (an equal `as_of` corrects the same report).
pub fn valid_post(as_of: i64, stored_as_of: i64, now: i64, report_uri_len: usize) -> bool {
    as_of <= now && as_of >= stored_as_of && report_uri_len <= MAX_URI_LEN
}
