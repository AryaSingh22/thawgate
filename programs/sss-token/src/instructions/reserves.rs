//! Reserve attestation instructions (S9): set_reserve_attestor, attest_reserves.
//!
//! MasterAuthority picks the attestor and the staleness window; only the attestor posts reserves. `mint_tokens`
//! enforces them (instructions/mint.rs). Reserves are in the mint's base units.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;

// ============================================================================
// Set Reserve Attestor — MasterAuthority only
// ============================================================================

/// Accounts required for the set_reserve_attestor instruction.
#[derive(Accounts)]
pub struct SetReserveAttestor<'info> {
    /// The MasterAuthority; pays for the attestation account the first time.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
        has_one = mint @ SssError::InvalidMint,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The authority's MasterAuthority role record.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = authority_role.bump,
        constraint = authority_role.active @ SssError::NotAuthorized,
        constraint = authority_role.role == RoleType::MasterAuthority @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// CHECK: `has_one` on config; only its key is used.
    pub mint: UncheckedAccount<'info>,

    /// The mint's reserve attestation, created on first use.
    #[account(
        init_if_needed,
        payer = authority,
        space = RESERVE_ATTESTATION_SIZE,
        seeds = [SEED_RESERVE, mint.key().as_ref()],
        bump,
    )]
    pub reserve_attestation: Account<'info, ReserveAttestation>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Event emitted when MasterAuthority sets the attestor or the staleness window.
#[event]
pub struct ReserveAttestorSet {
    /// The mint address.
    pub mint: Pubkey,
    /// The attestor whose signature `attest_reserves` now requires.
    pub attestor: Pubkey,
    /// Seconds after `as_of` during which minting may rely on an attestation.
    pub max_staleness: i64,
    /// Whether the posted reserves were cleared (new account or new attestor).
    pub reset: bool,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Handler for set_reserve_attestor.
///
/// A new account or a different attestor clears the posted reserves, so minting stops until the new attestor
/// posts: numbers signed by the previous attestor are not carried over. The same attestor only changes
/// `max_staleness`.
pub fn set_reserve_attestor_handler(ctx: Context<SetReserveAttestor>, attestor: Pubkey, max_staleness: i64) -> Result<()> {
    require!(max_staleness > 0, SssError::InvalidReserveAttestation);
    require_keys_neq!(attestor, Pubkey::default(), SssError::InvalidReserveAttestation);

    let mint = ctx.accounts.mint.key();
    let att = &mut ctx.accounts.reserve_attestation;
    let reset = att.mint == Pubkey::default() || att.attestor != attestor;
    att.mint = mint;
    att.attestor = attestor;
    att.max_staleness = max_staleness;
    att.bump = ctx.bumps.reserve_attestation;
    if reset {
        att.reserves = 0;
        att.as_of = 0;
        att.report_uri = String::new();
        att.posted_at = 0;
    }

    emit!(ReserveAttestorSet {
        mint,
        attestor,
        max_staleness,
        reset,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// ============================================================================
// Attest Reserves — the attestor only
// ============================================================================

/// Accounts required for the attest_reserves instruction.
#[derive(Accounts)]
pub struct AttestReserves<'info> {
    /// The attestor set by MasterAuthority.
    pub attestor: Signer<'info>,

    /// The mint's reserve attestation.
    #[account(
        mut,
        seeds = [SEED_RESERVE, reserve_attestation.mint.as_ref()],
        bump = reserve_attestation.bump,
        has_one = attestor @ SssError::NotReserveAttestor,
    )]
    pub reserve_attestation: Account<'info, ReserveAttestation>,
}

/// Event emitted when the attestor posts reserves.
#[event]
pub struct ReservesAttested {
    /// The mint address.
    pub mint: Pubkey,
    /// The attestor who signed.
    pub attestor: Pubkey,
    /// Reserves in the mint's base units.
    pub reserves: u64,
    /// Unix time at which the reserves were measured.
    pub as_of: i64,
    /// Where the report lives.
    pub report_uri: String,
    /// Cluster time of the post.
    pub timestamp: i64,
}

/// Handler for attest_reserves.
///
/// `as_of` may not be in the future, nor older than the stored one. Allowed while the mint is paused.
pub fn attest_reserves_handler(ctx: Context<AttestReserves>, reserves: u64, as_of: i64, report_uri: String) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let att = &mut ctx.accounts.reserve_attestation;
    require!(valid_post(as_of, att.as_of, now, report_uri.len()), SssError::InvalidReserveAttestation);

    att.reserves = reserves;
    att.as_of = as_of;
    att.report_uri = report_uri.clone();
    att.posted_at = now;

    emit!(ReservesAttested {
        mint: att.mint,
        attestor: att.attestor,
        reserves,
        as_of,
        report_uri,
        timestamp: now,
    });

    Ok(())
}
