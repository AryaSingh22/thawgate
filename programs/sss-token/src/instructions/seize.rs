//! Seize instruction — seizes all tokens from a frozen, blacklisted account (SSS-2 and Token ACL modes).
//!
//! Uses the permanent delegate extension to transfer tokens without owner consent.
//! Requires: compliance enabled (hook or Token ACL), enable_permanent_delegate, active blacklist entry,
//! and frozen source account.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022::extension::pausable::{self, PausableConfig};
use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::SssError;
use crate::instructions::freeze_route::{self, FreezeRoute};
use crate::state::*;
use crate::token_acl::{MINT_CONFIG_SEED, TOKEN_ACL_ID};

/// Accounts required for the seize instruction.
#[derive(Accounts)]
pub struct Seize<'info> {
    /// The seizer operator — must have Seizer role.
    #[account(mut)]
    pub seizer: Signer<'info>,

    /// The stablecoin configuration PDA (also acts as permanent delegate).
    #[account(
        mut,
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The seizer's role record PDA.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            seizer.key().as_ref(),
            &[RoleType::Seizer as u8],
        ],
        bump = seizer_role.bump,
        constraint = seizer_role.active @ SssError::SeizeNotAuthorized,
        constraint = seizer_role.role == RoleType::Seizer @ SssError::SeizeNotAuthorized,
    )]
    pub seizer_role: Account<'info, RoleRecord>,

    /// The blacklist entry for the source — must be active.
    #[account(
        seeds = [SEED_BLACKLIST, config.mint.as_ref(), source_authority.key().as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.active @ SssError::BlacklistEntryRequired,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    /// The Token-2022 mint account.
    #[account(
        mut,
        constraint = mint.key() == config.mint @ SssError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The source token account to seize from — must be frozen.
    #[account(
        mut,
        token::mint = mint,
        token::authority = source_authority,
        token::token_program = token_program,
        constraint = source_token_account.is_frozen() @ SssError::AccountNotFrozen,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The owner of the source token account.
    /// CHECK: Validated via token account constraint.
    pub source_authority: UncheckedAccount<'info>,

    /// The treasury/destination token account to receive seized tokens.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program.
    pub token_program: Interface<'info, TokenInterface>,

    /// Token ACL program (thaws and refreezes once Token ACL holds the mint's freeze authority).
    /// CHECK: address constraint.
    #[account(address = TOKEN_ACL_ID)]
    pub token_acl_program: UncheckedAccount<'info>,

    /// The mint's Token ACL MintConfig PDA; may not exist (Hook-mode mints).
    /// CHECK: PDA constraint; only Token ACL reads it.
    #[account(seeds = [MINT_CONFIG_SEED, mint.key().as_ref()], bump, seeds::program = token_acl_program.key())]
    pub mint_config: UncheckedAccount<'info>,
}

impl<'info> Seize<'info> {
    fn route(&self) -> FreezeRoute<'_, 'info> {
        FreezeRoute {
            config: self.config.as_ref(),
            mint: &self.mint,
            token_account: self.source_token_account.as_ref(),
            mint_config: self.mint_config.as_ref(),
            token_acl_program: self.token_acl_program.as_ref(),
            token_program: self.token_program.as_ref(),
        }
    }

    /// Whether the mint has the Pausable extension and is paused (Token ACL modes).
    fn mint_paused(&self) -> Result<bool> {
        let info = self.mint.to_account_info();
        let data = info.try_borrow_data()?;
        let mint = StateWithExtensions::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack(&data)?;
        Ok(mint.get_extension::<PausableConfig>().map(|p| bool::from(p.paused)).unwrap_or(false))
    }

    /// Token-2022 Pausable `resume` or `pause`, signed by the config PDA (the pause authority).
    fn set_paused(&self, paused: bool, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let (token_program, mint, config) = (self.token_program.key, &self.mint.key(), &self.config.key());
        let ix = if paused {
            pausable::instruction::pause(token_program, mint, config, &[])?
        } else {
            pausable::instruction::resume(token_program, mint, config, &[])?
        };
        invoke_signed(&ix, &[self.mint.to_account_info(), self.config.to_account_info()], signer_seeds)?;
        Ok(())
    }
}

/// Event emitted when tokens are seized.
#[event]
pub struct TokensSeized {
    /// The mint address.
    pub mint: Pubkey,
    /// The source account that was seized from.
    pub source: Pubkey,
    /// The treasury account that received the tokens.
    pub treasury: Pubkey,
    /// The number of tokens seized.
    pub amount: u64,
    /// The seizer who executed the operation.
    pub seizer: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Handler for the seize instruction.
///
/// Feature-gated: requires `config.compliance_enabled()` (the hook or Token ACL) and `enable_permanent_delegate`.
/// Seizes ALL tokens from a frozen, blacklisted account and transfers them to the
/// treasury. The seized amount is added to total_burned (seizure is treated as
/// equivalent to a burn from the circulating supply perspective, since the tokens
/// are moved to a controlled treasury rather than destroyed).
///
/// A Pausable mint (Token ACL modes) that is paused is resumed for the transfer and paused again within this
/// instruction, so seizing keeps working while paused and nothing else sees the mint unpaused. The transfer
/// hook's own PauseState check is separate: on a paused hook mint (Hook and Both modes) it still rejects the
/// transfer.
pub fn seize_handler<'info>(ctx: Context<'_, '_, '_, 'info, Seize<'info>>) -> Result<()> {
    // Compliance feature gate — FIRST LINE of handler body
    require!(
        ctx.accounts.config.compliance_enabled(),
        SssError::FeatureNotEnabled
    );

    // Validate permanent delegate is enabled
    require!(
        ctx.accounts.config.enable_permanent_delegate,
        SssError::PermanentDelegateNotEnabled
    );

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;
    let amount = ctx.accounts.source_token_account.amount;

    // Validate there are tokens to seize
    require!(amount > 0, SssError::InvalidAmount);

    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[config_bump]]];

    // Thaw the account before transferring (Token-2022 requirement)
    freeze_route::thaw(&ctx.accounts.route(), signer_seeds)?;

    // Pausable blocks every transfer, the permanent delegate's included (Token-2022 `MintPaused`)
    let paused = ctx.accounts.mint_paused()?;
    if paused {
        ctx.accounts.set_paused(false, signer_seeds)?;
    }

    // Transfer ALL tokens from source to treasury using permanent delegate authority
    // The config PDA is the permanent delegate
    let mut transfer_ix = spl_token_2022::instruction::transfer_checked(
        ctx.accounts.token_program.key,
        ctx.accounts.source_token_account.to_account_info().key,
        ctx.accounts.mint.to_account_info().key,
        ctx.accounts.treasury_token_account.to_account_info().key,
        ctx.accounts.config.to_account_info().key,
        &[],
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // anchor-spl's token_2022::transfer_checked ignores remaining_accounts (still true in 0.32.2),
    // so we manually append them (transfer hook extra accounts) to the IX Metas
    for acc in ctx.remaining_accounts.iter() {
        transfer_ix.accounts.push(AccountMeta {
            pubkey: *acc.key,
            is_signer: acc.is_signer,
            // The transfer hook extra accounts are read-only: Token-2022 invokes them as such
            // but we'll preserve whatever original constraint is set by the client.
            is_writable: acc.is_writable,
        });
    }

    // Combine standard accounts + remaining accounts for the invoke
    let mut account_infos = vec![
        ctx.accounts.source_token_account.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.treasury_token_account.to_account_info(),
        ctx.accounts.config.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    ];
    account_infos.extend_from_slice(ctx.remaining_accounts);

    anchor_lang::solana_program::program::invoke_signed(
        &transfer_ix,
        &account_infos,
        signer_seeds,
    )?;

    if paused {
        ctx.accounts.set_paused(true, signer_seeds)?;
    }

    // Re-freeze the account after seizing
    freeze_route::freeze(&ctx.accounts.route(), signer_seeds)?;

    // Update total_burned — seizure counted as removal from circulating supply
    let config = &mut ctx.accounts.config;
    config.total_burned = config
        .total_burned
        .checked_add(amount)
        .ok_or(SssError::Overflow)?;

    emit!(TokensSeized {
        mint: mint_key,
        source: ctx.accounts.source_token_account.key(),
        treasury: ctx.accounts.treasury_token_account.key(),
        amount,
        seizer: ctx.accounts.seizer.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
