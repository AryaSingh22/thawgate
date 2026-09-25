//! Pause and unpause instructions — halts or resumes token operations.
//!
//! When paused, mint, burn, and transfer operations are blocked.
//! Compliance operations (freeze, thaw, seize) still work while paused, except seize on a mint with the
//! transfer hook (Hook and Both modes): the hook rejects every transfer while PauseState is paused (see seize.rs).
//!
//! Hook mode: the PauseState PDA is the switch; the transfer hook and mint/burn read it.
//! Token ACL modes (Acl, Both): the mint's Token-2022 Pausable extension is the switch for transfers, mint and burn
//! (pause authority = config PDA), and PauseState is kept in step for mint/burn and, in Both mode, the hook.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022::extension::pausable;
use anchor_spl::token_2022::Token2022;

use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;

/// Accounts required for the pause and unpause instructions.
#[derive(Accounts)]
pub struct PauseOrUnpause<'info> {
    /// The operator — must have Pauser or MasterAuthority role.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        mut,
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
        has_one = mint @ SssError::InvalidMint,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The pause state PDA to be updated.
    #[account(
        mut,
        seeds = [SEED_PAUSE, config.mint.as_ref()],
        bump = pause_state.bump,
    )]
    pub pause_state: Account<'info, PauseState>,

    /// The operator's role record PDA.
    /// Must be either Pauser or MasterAuthority with active status.
    pub operator_role: Account<'info, RoleRecord>,

    /// The config's mint: Token ACL mode pauses it through Token-2022 Pausable.
    /// CHECK: `has_one` on config; Token-2022 validates it.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// Token-2022 program (Pausable CPI).
    pub token_program: Program<'info, Token2022>,
}

impl<'info> PauseOrUnpause<'info> {
    /// Token-2022 Pausable `pause` / `resume`, signed by the config PDA (the pause authority). Token ACL modes only;
    /// Hook-mode mints have no Pausable extension.
    fn set_mint_paused(&self, paused: bool) -> Result<()> {
        if !self.config.uses_token_acl() {
            return Ok(());
        }
        let (token_program, mint, config) = (self.token_program.key, self.mint.key, &self.config.key());
        let ix = if paused {
            pausable::instruction::pause(token_program, mint, config, &[])?
        } else {
            pausable::instruction::resume(token_program, mint, config, &[])?
        };
        let mint_key = self.config.mint;
        let seeds: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[self.config.bump]]];
        invoke_signed(&ix, &[self.mint.to_account_info(), self.config.to_account_info()], seeds)?;
        Ok(())
    }
}

/// Event emitted when token operations are paused.
#[event]
pub struct TokensPausedEvent {
    /// The mint address.
    pub mint: Pubkey,
    /// The operator who paused operations.
    pub operator: Pubkey,
    /// Unix timestamp when paused.
    pub timestamp: i64,
}

/// Event emitted when token operations are unpaused.
#[event]
pub struct TokensUnpausedEvent {
    /// The mint address.
    pub mint: Pubkey,
    /// The operator who unpaused operations.
    pub operator: Pubkey,
    /// Unix timestamp when unpaused.
    pub timestamp: i64,
}

/// Validates that the operator has Pauser or MasterAuthority role.
fn validate_pauser(
    operator_role: &Account<RoleRecord>,
    operator_key: &Pubkey,
    mint_key: &Pubkey,
) -> Result<()> {
    require!(
        operator_role.holder == *operator_key,
        SssError::NotAuthorized
    );
    require!(
        operator_role.mint == *mint_key,
        SssError::InvalidMint
    );
    require!(operator_role.active, SssError::PauserNotFound);
    require!(
        operator_role.role == RoleType::Pauser
            || operator_role.role == RoleType::MasterAuthority,
        SssError::PauserNotFound
    );
    Ok(())
}

/// Handler for the pause instruction.
///
/// Pauses all token operations (mint, burn, transfer).
/// Does NOT prevent freeze/thaw/seize — compliance operations must still work.
pub fn handler_pause(ctx: Context<PauseOrUnpause>) -> Result<()> {
    validate_pauser(
        &ctx.accounts.operator_role,
        &ctx.accounts.operator.key(),
        &ctx.accounts.config.mint,
    )?;

    // MED-001: Guard against double-pause
    require!(!ctx.accounts.pause_state.paused, SssError::AlreadyPaused);

    ctx.accounts.set_mint_paused(true)?;

    let clock = Clock::get()?;

    // Update pause state
    let pause_state = &mut ctx.accounts.pause_state;
    pause_state.paused = true;
    pause_state.paused_at = clock.unix_timestamp;
    pause_state.paused_by = ctx.accounts.operator.key();

    // Also update config for quick reads
    let config = &mut ctx.accounts.config;
    config.paused = true;

    emit!(TokensPausedEvent {
        mint: ctx.accounts.config.mint,
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Handler for the unpause instruction.
///
/// Resumes all token operations (mint, burn, transfer).
pub fn handler_unpause(ctx: Context<PauseOrUnpause>) -> Result<()> {
    validate_pauser(
        &ctx.accounts.operator_role,
        &ctx.accounts.operator.key(),
        &ctx.accounts.config.mint,
    )?;

    // MED-001: Guard against double-unpause (not-yet-paused)
    require!(ctx.accounts.pause_state.paused, SssError::NotPaused);

    ctx.accounts.set_mint_paused(false)?;

    let clock = Clock::get()?;

    // Update pause state
    let pause_state = &mut ctx.accounts.pause_state;
    pause_state.paused = false;
    pause_state.paused_at = clock.unix_timestamp;
    pause_state.paused_by = ctx.accounts.operator.key();

    // Also update config for quick reads
    let config = &mut ctx.accounts.config;
    config.paused = false;

    emit!(TokensUnpausedEvent {
        mint: ctx.accounts.config.mint,
        operator: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
