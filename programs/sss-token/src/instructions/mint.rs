//! Mint instruction — mints new stablecoin tokens to a recipient.
//!
//! Validates minter role, pause state, quota limits and attested reserves, and updates supply tracking.
//! Creates the recipient's associated token account if it doesn't exist.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;

/// Accounts required for the mint instruction.
#[derive(Accounts)]
pub struct MintTokens<'info> {
    /// The minter — must have an active Minter role.
    #[account(mut)]
    pub minter: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        mut,
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The pause state PDA — checked to ensure operations are not paused.
    #[account(
        seeds = [SEED_PAUSE, config.mint.as_ref()],
        bump = pause_state.bump,
    )]
    pub pause_state: Account<'info, PauseState>,

    /// The minter's role record PDA — must be an active Minter.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            minter.key().as_ref(),
            &[RoleType::Minter as u8],
        ],
        bump = minter_role.bump,
        constraint = minter_role.active @ SssError::MinterNotFound,
        constraint = minter_role.role == RoleType::Minter @ SssError::MinterNotFound,
    )]
    pub minter_role: Account<'info, RoleRecord>,

    /// The minter's quota PDA — tracks usage against limits.
    #[account(
        mut,
        seeds = [SEED_QUOTA, config.mint.as_ref(), minter.key().as_ref()],
        bump = minter_quota.bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,

    /// The Token-2022 mint account.
    #[account(
        mut,
        constraint = mint.key() == config.mint @ SssError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The recipient's associated token account — created if it doesn't exist.
    /// CHECK: This is validated by the associated token program during creation
    /// or by the token program if it already exists.
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,

    /// The recipient wallet address.
    /// CHECK: This is the wallet that will own the ATA. No signer check required.
    pub recipient: UncheckedAccount<'info>,

    /// Token-2022 program.
    pub token_program: Interface<'info, TokenInterface>,

    /// Associated token program for ATA creation.
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,

    /// The mint's reserve attestation (S9). Always passed, so a caller can't skip the check by leaving it out;
    /// it may not exist (Hook mode mints that never opted in). The address is checked with the stored bump (S15).
    /// CHECK: PDA constraint; read in the handler.
    #[account(seeds = [SEED_RESERVE, mint.key().as_ref()], bump = reserve_bump(&reserve_attestation, &mint.key()))]
    pub reserve_attestation: UncheckedAccount<'info>,
}

/// Event emitted when tokens are minted.
#[event]
pub struct TokensMinted {
    /// The mint address.
    pub mint: Pubkey,
    /// The recipient wallet address.
    pub recipient: Pubkey,
    /// The number of tokens minted.
    pub amount: u64,
    /// The minter who executed the mint.
    pub minter: Pubkey,
    /// Unix timestamp of the mint.
    pub timestamp: i64,
}

/// Reserve check (S9): the Token-2022 supply after this mint must not exceed the attested reserves, and the
/// attestation must be within `max_staleness`. Acl and Both mode mints must have an attestation; a Hook mode mint
/// without one mints as before. A deny logs `SSS:DENY:RESERVE_<STALE|INSUFFICIENT>` with the numbers.
fn check_reserve_attestation(accounts: &MintTokens, amount: u64, now: i64) -> Result<()> {
    let info = accounts.reserve_attestation.to_account_info();
    if info.data_is_empty() {
        if accounts.config.uses_token_acl() {
            msg!("SSS:DENY:RESERVE_MISSING");
            return err!(SssError::ReserveAttestationMissing);
        }
        return Ok(());
    }
    require_keys_eq!(*info.owner, crate::ID, SssError::ReserveAttestationMissing);
    let att = ReserveAttestation::try_deserialize(&mut &info.try_borrow_data()?[..])?;

    let supply = accounts.mint.supply;
    match check_reserves(supply, amount, att.reserves, att.as_of, att.max_staleness, now) {
        ReserveCheck::Ok => Ok(()),
        ReserveCheck::Stale => {
            msg!(
                "SSS:DENY:RESERVE_STALE as_of={} now={} age={} max_staleness={}",
                att.as_of,
                now,
                now.saturating_sub(att.as_of),
                att.max_staleness
            );
            err!(SssError::ReserveStale)
        }
        ReserveCheck::Insufficient => {
            msg!("SSS:DENY:RESERVE_INSUFFICIENT supply={} amount={} reserves={} as_of={}", supply, amount, att.reserves, att.as_of);
            err!(SssError::ReserveInsufficient)
        }
    }
}

/// Handler for the mint instruction.
///
/// Mints tokens to a recipient after validating role, pause state, quota and reserves.
pub fn mint_handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    // Validate amount > 0
    require!(amount > 0, SssError::InvalidAmount);

    // Validate not paused
    require!(!ctx.accounts.pause_state.paused, SssError::TokensPaused);

    // Validate quota (limit == 0 means unlimited)
    let quota = &ctx.accounts.minter_quota;
    if quota.limit > 0 {
        let new_used = quota
            .used
            .checked_add(amount)
            .ok_or(SssError::Overflow)?;
        require!(new_used <= quota.limit, SssError::MinterQuotaExceeded);
    }

    let clock = Clock::get()?;
    check_reserve_attestation(ctx.accounts, amount, clock.unix_timestamp)?;

    let mint_key = ctx.accounts.config.mint;
    // The `config` constraint checked this bump; searching for it again cost ~1,500 CU per step below 255 (S15).
    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[config_bump]]];

    // Create ATA if it doesn't exist
    if ctx.accounts.recipient_token_account.data_is_empty() {
        anchor_spl::associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.minter.to_account_info(),
                associated_token: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.recipient.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        // Note: if default_account_frozen, the ATA is created frozen.
        // We do NOT auto-thaw — operator must explicitly thaw.
    }

    // Mint tokens via CPI with config PDA as mint authority
    anchor_spl::token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Update quota
    let quota = &mut ctx.accounts.minter_quota;
    quota.used = quota.used.checked_add(amount).ok_or(SssError::Overflow)?;

    // Update total minted
    let config = &mut ctx.accounts.config;
    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(SssError::Overflow)?;

    // Emit event
    emit!(TokensMinted {
        mint: mint_key,
        recipient: ctx.accounts.recipient.key(),
        amount,
        minter: ctx.accounts.minter.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
