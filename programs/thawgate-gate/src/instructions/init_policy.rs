//! `init_policy`: create a mint's `GatePolicy` and write its thaw and freeze extra-metas lists.

use anchor_lang::prelude::*;

use crate::errors::GateError;
use crate::metas;
use crate::state::{GatePolicy, PolicyArgs, POLICY_SEED, POLICY_VERSION};
use crate::token_acl;

#[derive(Accounts)]
pub struct InitPolicy<'info> {
    /// Token ACL `MintConfig.freeze_authority` of this mint. Can be a PDA signing through CPI
    /// (the sss-token config in S6). The policy admin is `args.authority`, which may be someone else.
    pub freeze_authority: Signer<'info>,

    /// Pays rent. Separate from `freeze_authority`, since a program-owned PDA cannot fund `create_account`.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + GatePolicy::INIT_SPACE,
        seeds = [POLICY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, GatePolicy>,

    /// CHECK: a Token-2022 mint (owner check); tied to the MintConfig by its `mint` field.
    #[account(owner = spl_token_2022::ID @ GateError::InvalidMint)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: parsed and checked by `token_acl::read_mint_config`.
    pub mint_config: UncheckedAccount<'info>,

    /// CHECK: PDA `["thaw_extra_account_metas", mint]`, checked in `metas::write`.
    #[account(mut)]
    pub thaw_extra_metas: UncheckedAccount<'info>,

    /// CHECK: PDA `["freeze_extra_account_metas", mint]`, checked in `metas::write`.
    #[account(mut)]
    pub freeze_extra_metas: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_policy_handler(ctx: Context<InitPolicy>, args: PolicyArgs) -> Result<()> {
    let config = token_acl::read_mint_config(&ctx.accounts.mint_config)?;
    require_keys_eq!(config.mint, ctx.accounts.mint.key(), GateError::MintConfigMismatch);
    require_keys_eq!(config.freeze_authority, ctx.accounts.freeze_authority.key(), GateError::NotFreezeAuthority);

    let policy = &mut ctx.accounts.policy;
    policy.version = POLICY_VERSION;
    policy.bump = ctx.bumps.policy;
    policy.mint = ctx.accounts.mint.key();
    policy.reserved = [0; 64];
    policy.apply(&args)?;

    metas::write_both(
        &ctx.accounts.policy,
        &ctx.accounts.thaw_extra_metas.to_account_info(),
        &ctx.accounts.freeze_extra_metas.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )
}
