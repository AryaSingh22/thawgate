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

/// sss-token calls `init_policy` from `enable_token_acl` through a vendored copy of its interface
/// (programs/sss-token/src/thawgate.rs, src/token_acl.rs), because it cannot depend on this crate. These tests
/// pin that copy to the real one.
#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;
    use anchor_lang::{Discriminator, InstructionData, ToAccountMetas};
    use sss_token::thawgate::{self as mirror, GateAllowlistMode, GatePolicyArgs};

    use crate::state::{AllowlistMode, PolicyArgs, POLICY_SEED};
    use crate::token_acl;

    fn args(mode: AllowlistMode) -> (PolicyArgs, GatePolicyArgs) {
        let (authority, issuer, credential, schema) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let mirror_mode = match mode {
            AllowlistMode::Off => GateAllowlistMode::Off,
            AllowlistMode::AllowOnly => GateAllowlistMode::AllowOnly,
            AllowlistMode::BypassForPdas => GateAllowlistMode::BypassForPdas,
        };
        (
            PolicyArgs {
                authority,
                issuer_program: issuer,
                check_blacklist: true,
                allowlist_mode: mode,
                require_sas: true,
                sas_credential: credential,
                sas_schema: schema,
                min_kyc_level: 3,
            },
            GatePolicyArgs {
                authority,
                issuer_program: issuer,
                check_blacklist: true,
                allowlist_mode: mirror_mode,
                require_sas: true,
                sas_credential: credential,
                sas_schema: schema,
                min_kyc_level: 3,
            },
        )
    }

    #[test]
    fn ids_seeds_and_discriminator_match() {
        assert_eq!(mirror::THAWGATE_GATE_ID, crate::ID);
        assert_eq!(mirror::INIT_POLICY_DISCRIMINATOR, crate::instruction::InitPolicy::DISCRIMINATOR);
        assert_eq!(mirror::POLICY_SEED, POLICY_SEED);
        assert_eq!(mirror::THAW_EXTRA_ACCOUNT_METAS_SEED, token_acl::THAW_EXTRA_ACCOUNT_METAS_SEED);
        assert_eq!(mirror::FREEZE_EXTRA_ACCOUNT_METAS_SEED, token_acl::FREEZE_EXTRA_ACCOUNT_METAS_SEED);
        assert_eq!(sss_token::token_acl::TOKEN_ACL_ID, token_acl::TOKEN_ACL_ID);
        assert_eq!(sss_token::token_acl::MINT_CONFIG_SEED, token_acl::MINT_CONFIG_SEED);
    }

    /// Same instruction data (discriminator + Borsh args) for every allowlist mode.
    #[test]
    fn instruction_data_matches() {
        for mode in [AllowlistMode::Off, AllowlistMode::AllowOnly, AllowlistMode::BypassForPdas] {
            let (real, copy) = args(mode);
            let expected = crate::instruction::InitPolicy { args: real }.data();
            let k = Pubkey::default();
            let ix = mirror::init_policy(&k, &k, &k, &k, &k, &k, &k, &copy).unwrap();
            assert_eq!(ix.data, expected, "{mode:?}");
        }
    }

    /// Same account order and signer/writable flags as Anchor's client struct for `InitPolicy`.
    #[test]
    fn account_metas_match() {
        let keys: Vec<Pubkey> = (0..8).map(|_| Pubkey::new_unique()).collect();
        let expected = crate::accounts::InitPolicy {
            freeze_authority: keys[0],
            payer: keys[1],
            policy: keys[2],
            mint: keys[3],
            mint_config: keys[4],
            thaw_extra_metas: keys[5],
            freeze_extra_metas: keys[6],
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None);
        let (_, copy) = args(AllowlistMode::Off);
        let ix = mirror::init_policy(&keys[0], &keys[1], &keys[2], &keys[3], &keys[4], &keys[5], &keys[6], &copy).unwrap();
        assert_eq!(ix.program_id, crate::ID);
        assert_eq!(ix.accounts, expected);
    }
}
