//! Freeze and thaw instructions — freezes or thaws a target token account.
//!
//! Only MasterAuthority or Blacklister roles can freeze/thaw accounts.
//! The StablecoinConfig PDA signs: directly as the Token-2022 freeze authority, or, once Token ACL manages the
//! mint, as its `MintConfig.freeze_authority` through Token ACL (see `freeze_route`).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::SssError;
use crate::instructions::freeze_route::{self, FreezeRoute};
use crate::state::*;
use crate::token_acl::{MINT_CONFIG_SEED, TOKEN_ACL_ID};

/// Accounts required for freeze_account and thaw_account instructions.
#[derive(Accounts)]
pub struct FreezeOrThaw<'info> {
    /// The operator — must have MasterAuthority or Blacklister role.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The stablecoin configuration PDA (also the freeze authority).
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The operator's role record PDA.
    /// Must be either MasterAuthority or Blacklister with active status.
    /// CHECK: We manually verify role type and active status in the handler.
    pub operator_role: Account<'info, RoleRecord>,

    /// The Token-2022 mint account.
    #[account(
        constraint = mint.key() == config.mint @ SssError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The target token account to freeze or thaw.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program.
    pub token_program: Interface<'info, TokenInterface>,

    /// Token ACL program (used once Token ACL holds the mint's freeze authority).
    /// CHECK: address constraint.
    #[account(address = TOKEN_ACL_ID)]
    pub token_acl_program: UncheckedAccount<'info>,

    /// The mint's Token ACL MintConfig PDA; may not exist (Hook-mode mints).
    /// CHECK: PDA constraint; only Token ACL reads it.
    #[account(seeds = [MINT_CONFIG_SEED, mint.key().as_ref()], bump, seeds::program = token_acl_program.key())]
    pub mint_config: UncheckedAccount<'info>,
}

impl<'info> FreezeOrThaw<'info> {
    fn route(&self) -> FreezeRoute<'_, 'info> {
        FreezeRoute {
            config: self.config.as_ref(),
            mint: &self.mint,
            token_account: self.target_token_account.as_ref(),
            mint_config: self.mint_config.as_ref(),
            token_acl_program: self.token_acl_program.as_ref(),
            token_program: self.token_program.as_ref(),
        }
    }
}

/// Event emitted when a token account is frozen.
#[event]
pub struct AccountFrozen {
    /// The mint address.
    pub mint: Pubkey,
    /// The frozen token account address.
    pub target: Pubkey,
    /// The operator who froze the account.
    pub operator: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Event emitted when a token account is thawed.
#[event]
pub struct AccountThawed {
    /// The mint address.
    pub mint: Pubkey,
    /// The thawed token account address.
    pub target: Pubkey,
    /// The operator who thawed the account.
    pub operator: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Validates that the operator has MasterAuthority or Blacklister role.
fn validate_freeze_authority(
    operator_role: &Account<RoleRecord>,
    operator_key: &Pubkey,
    mint_key: &Pubkey,
) -> Result<()> {
    // Verify the role record belongs to the operator and the correct mint
    require!(
        operator_role.holder == *operator_key,
        SssError::NotAuthorized
    );
    require!(
        operator_role.mint == *mint_key,
        SssError::InvalidMint
    );
    require!(operator_role.active, SssError::NotAuthorized);
    require!(
        operator_role.role == RoleType::MasterAuthority
            || operator_role.role == RoleType::Blacklister,
        SssError::NotAuthorized
    );
    Ok(())
}

/// Handler for the freeze_account instruction.
///
/// Freezes a target token account using the config PDA as freeze authority.
pub fn handler_freeze(ctx: Context<FreezeOrThaw>) -> Result<()> {
    validate_freeze_authority(
        &ctx.accounts.operator_role,
        &ctx.accounts.operator.key(),
        &ctx.accounts.config.mint,
    )?;

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;
    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[config_bump]]];

    freeze_route::freeze(&ctx.accounts.route(), signer_seeds)?;

    emit!(AccountFrozen {
        mint: mint_key,
        target: ctx.accounts.target_token_account.key(),
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Handler for the thaw_account instruction.
///
/// Thaws a frozen token account using the config PDA as freeze authority.
pub fn handler_thaw(ctx: Context<FreezeOrThaw>) -> Result<()> {
    validate_freeze_authority(
        &ctx.accounts.operator_role,
        &ctx.accounts.operator.key(),
        &ctx.accounts.config.mint,
    )?;

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;
    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[config_bump]]];

    freeze_route::thaw(&ctx.accounts.route(), signer_seeds)?;

    emit!(AccountThawed {
        mint: mint_key,
        target: ctx.accounts.target_token_account.key(),
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
