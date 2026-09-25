//! Compliance instructions — add_to_blacklist, remove_from_blacklist (SSS-2 and Token ACL modes).
//!
//! These instructions are feature-gated on `config.compliance_enabled()`: the transfer hook
//! (`enable_transfer_hook`) or Token ACL (`compliance_mode` Acl/Both) must enforce the blacklist.
//! The feature gate check is the FIRST line of every handler body.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::SssError;
use crate::instructions::freeze_route::{self, FreezeRoute};
use crate::state::*;
use crate::token_acl::{MINT_CONFIG_SEED, TOKEN_ACL_ID};

// ============================================================================
// Add to Blacklist
// ============================================================================

/// Accounts required for the add_to_blacklist instruction.
#[derive(Accounts)]
#[instruction(reason: String)]
pub struct AddToBlacklist<'info> {
    /// The blacklister operator — must have Blacklister role.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The operator's Blacklister role record.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            operator.key().as_ref(),
            &[RoleType::Blacklister as u8],
        ],
        bump = operator_role.bump,
        constraint = operator_role.active @ SssError::BlacklisterNotFound,
        constraint = operator_role.role == RoleType::Blacklister @ SssError::BlacklisterNotFound,
    )]
    pub operator_role: Account<'info, RoleRecord>,

    /// The blacklist entry PDA to be created.
    #[account(
        init,
        payer = operator,
        space = BLACKLIST_ENTRY_SIZE,
        seeds = [SEED_BLACKLIST, config.mint.as_ref(), target.key().as_ref()],
        bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// The target wallet being blacklisted.
    /// CHECK: This is the wallet address to blacklist. We only store the key.
    pub target: UncheckedAccount<'info>,

    /// The Token-2022 mint account.
    #[account(
        constraint = mint.key() == config.mint @ SssError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The target's token account to be frozen.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program for freeze CPI.
    pub token_program: Interface<'info, TokenInterface>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,

    /// Token ACL program (freezes once Token ACL holds the mint's freeze authority).
    /// CHECK: address constraint.
    #[account(address = TOKEN_ACL_ID)]
    pub token_acl_program: UncheckedAccount<'info>,

    /// The mint's Token ACL MintConfig PDA; may not exist (Hook-mode mints).
    /// CHECK: PDA constraint; only Token ACL reads it.
    #[account(seeds = [MINT_CONFIG_SEED, mint.key().as_ref()], bump, seeds::program = token_acl_program.key())]
    pub mint_config: UncheckedAccount<'info>,
}

/// Event emitted when an address is added to the blacklist.
#[event]
pub struct AddedToBlacklist {
    /// The mint address.
    pub mint: Pubkey,
    /// The blacklisted wallet address.
    pub target: Pubkey,
    /// The reason for blacklisting.
    pub reason: String,
    /// The operator who performed the blacklisting.
    pub operator: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Handler for the add_to_blacklist instruction.
///
/// Feature-gated: requires `config.compliance_enabled()` (the hook or Token ACL).
/// Creates a BlacklistEntry PDA and freezes the target's token account (through Token ACL once it holds the
/// mint's freeze authority).
pub fn handler_add_to_blacklist(ctx: Context<AddToBlacklist>, reason: String) -> Result<()> {
    // Compliance feature gate — FIRST LINE of handler body
    require!(
        ctx.accounts.config.compliance_enabled(),
        SssError::FeatureNotEnabled
    );

    // Validate reason length
    require!(reason.len() <= MAX_REASON_LEN, SssError::ReasonTooLong);

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;

    // Initialize blacklist entry
    let entry = &mut ctx.accounts.blacklist_entry;
    entry.mint = mint_key;
    entry.target = ctx.accounts.target.key();
    entry.reason = reason.clone();
    entry.added_at = clock.unix_timestamp;
    entry.added_by = ctx.accounts.operator.key();
    entry.active = true;
    entry.bump = ctx.bumps.blacklist_entry;

    // Freeze the target's token account via CPI
    // MED-002: Check if already frozen before calling freeze CPI.
    // If the account is already frozen (e.g., from a prior manual freeze),
    // skip the CPI to avoid a redundant-freeze error.
    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[config_bump]]];

    if !ctx.accounts.target_token_account.is_frozen() {
        let a = &ctx.accounts;
        let route = FreezeRoute {
            config: a.config.as_ref(),
            mint: &a.mint,
            token_account: a.target_token_account.as_ref(),
            mint_config: a.mint_config.as_ref(),
            token_acl_program: a.token_acl_program.as_ref(),
            token_program: a.token_program.as_ref(),
        };
        freeze_route::freeze(&route, signer_seeds)?;
    }

    emit!(AddedToBlacklist {
        mint: mint_key,
        target: ctx.accounts.target.key(),
        reason,
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ============================================================================
// Remove from Blacklist
// ============================================================================

/// Accounts required for the remove_from_blacklist instruction.
#[derive(Accounts)]
pub struct RemoveFromBlacklist<'info> {
    /// The blacklister operator — must have Blacklister role.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The operator's Blacklister role record.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            operator.key().as_ref(),
            &[RoleType::Blacklister as u8],
        ],
        bump = operator_role.bump,
        constraint = operator_role.active @ SssError::BlacklisterNotFound,
        constraint = operator_role.role == RoleType::Blacklister @ SssError::BlacklisterNotFound,
    )]
    pub operator_role: Account<'info, RoleRecord>,

    /// The blacklist entry PDA to be deactivated.
    #[account(
        mut,
        seeds = [SEED_BLACKLIST, config.mint.as_ref(), target.key().as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.active @ SssError::AccountNotBlacklisted,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// The target wallet being removed from blacklist.
    /// CHECK: This is the wallet address. We only read the key.
    pub target: UncheckedAccount<'info>,
}

/// Event emitted when an address is removed from the blacklist.
#[event]
pub struct RemovedFromBlacklist {
    /// The mint address.
    pub mint: Pubkey,
    /// The wallet address removed from blacklist.
    pub target: Pubkey,
    /// The operator who removed the entry.
    pub operator: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Handler for the remove_from_blacklist instruction.
///
/// Feature-gated: requires `config.compliance_enabled()` (the hook or Token ACL).
/// Deactivates the BlacklistEntry PDA. Does NOT automatically thaw the
/// target's token account — the operator must call thaw_account separately
/// (or, under Token ACL, the holder may thaw permissionlessly through the gate).
pub fn handler_remove_from_blacklist(ctx: Context<RemoveFromBlacklist>) -> Result<()> {
    // Compliance feature gate — FIRST LINE of handler body
    require!(
        ctx.accounts.config.compliance_enabled(),
        SssError::FeatureNotEnabled
    );

    let clock = Clock::get()?;

    // Deactivate blacklist entry (never delete — audit trail)
    let entry = &mut ctx.accounts.blacklist_entry;
    entry.active = false;

    emit!(RemovedFromBlacklist {
        mint: ctx.accounts.config.mint,
        target: ctx.accounts.target.key(),
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
