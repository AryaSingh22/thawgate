//! Allowlist instructions (SSS-3).
//!
//! Provides `add_to_allowlist` and `remove_from_allowlist` for SSS-3 stablecoins.
//! Only the MasterAuthority can manage the allowlist.

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;

/// Accounts required for the `add_to_allowlist` instruction.
#[derive(Accounts)]
pub struct AddToAllowlist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.enable_allowlist @ SssError::FeatureNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = authority_role.bump,
        constraint = authority_role.active @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// The wallet to add to the allowlist.
    /// CHECK: This is the wallet address to allowlist, not an account we read.
    pub wallet: UncheckedAccount<'info>,

    /// Created on the wallet's first add, reactivated after a removal (S15).
    #[account(
        init_if_needed,
        payer = authority,
        space = ALLOWLIST_ENTRY_SIZE,
        seeds = [SEED_ALLOWLIST, config.mint.as_ref(), wallet.key().as_ref()],
        bump,
        constraint = !allowlist_entry.active @ SssError::AllowlistEntryAlreadyActive,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    pub system_program: Program<'info, System>,
}

/// Handler for `add_to_allowlist`: creates the entry, or reactivates an inactive one (no new rent).
pub fn add_to_allowlist_handler(ctx: Context<AddToAllowlist>) -> Result<()> {
    let clock = Clock::get()?;
    let entry = &mut ctx.accounts.allowlist_entry;
    entry.mint = ctx.accounts.config.mint;
    entry.wallet = ctx.accounts.wallet.key();
    entry.added_at = clock.unix_timestamp;
    entry.active = true;
    entry.bump = ctx.bumps.allowlist_entry;

    emit!(AllowlistAdded {
        mint: entry.mint,
        wallet: entry.wallet,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Accounts required for the `remove_from_allowlist` instruction.
#[derive(Accounts)]
pub struct RemoveFromAllowlist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.enable_allowlist @ SssError::FeatureNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = authority_role.bump,
        constraint = authority_role.active @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// CHECK: The wallet being managed.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ALLOWLIST, config.mint.as_ref(), wallet.key().as_ref()],
        bump = allowlist_entry.bump,
        constraint = allowlist_entry.active @ SssError::AllowlistEntryNotActive,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,
}

/// Handler for `remove_from_allowlist`.
pub fn remove_from_allowlist_handler(ctx: Context<RemoveFromAllowlist>) -> Result<()> {
    let entry = &mut ctx.accounts.allowlist_entry;
    entry.active = false;

    emit!(AllowlistRemoved {
        mint: entry.mint,
        wallet: entry.wallet,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Event emitted when a wallet is added to the allowlist.
#[event]
pub struct AllowlistAdded {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub timestamp: i64,
}

/// Event emitted when a wallet is removed from the allowlist.
#[event]
pub struct AllowlistRemoved {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub timestamp: i64,
}
