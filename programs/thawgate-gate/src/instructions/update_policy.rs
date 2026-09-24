//! `update_policy` and `setup_extra_metas`: change a policy, or resync its extra-metas lists.
//! Both rewrite the thaw and freeze lists, so the lists always match the stored policy.

use anchor_lang::prelude::*;

use crate::errors::GateError;
use crate::metas;
use crate::state::{GatePolicy, PolicyArgs, POLICY_SEED};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [POLICY_SEED, mint.key().as_ref()],
        bump = policy.bump,
        has_one = authority @ GateError::NotPolicyAuthority,
        has_one = mint,
    )]
    pub policy: Account<'info, GatePolicy>,

    /// CHECK: bound to the policy by `has_one` and the seeds.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: PDA `["thaw_extra_account_metas", mint]`, checked in `metas::write`.
    #[account(mut)]
    pub thaw_extra_metas: UncheckedAccount<'info>,

    /// CHECK: PDA `["freeze_extra_account_metas", mint]`, checked in `metas::write`.
    #[account(mut)]
    pub freeze_extra_metas: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_policy_handler(ctx: Context<UpdatePolicy>, args: PolicyArgs) -> Result<()> {
    ctx.accounts.policy.apply(&args)?;
    setup_extra_metas_handler(ctx)
}

pub fn setup_extra_metas_handler(ctx: Context<UpdatePolicy>) -> Result<()> {
    metas::write_both(
        &ctx.accounts.policy,
        &ctx.accounts.thaw_extra_metas.to_account_info(),
        &ctx.accounts.freeze_extra_metas.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )
}
