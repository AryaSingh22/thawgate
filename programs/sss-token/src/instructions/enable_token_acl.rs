//! enable_token_acl — puts a Token ACL mode mint (Acl or Both) under Token ACL, gated by ThawGate (S6).
//!
//! The config PDA is the mint's freeze authority, so it signs each step through the config seeds:
//! 1. Token ACL `create_config` with the ThawGate gate: the Token-2022 freeze authority moves to the MintConfig PDA,
//!    and the config PDA becomes `MintConfig.freeze_authority`.
//! 2. `toggle_permissionless_instructions`: permissionless thaw (holders unlock themselves through the gate) and
//!    permissionless freeze (anyone may freeze a holder the policy flags).
//! 3. The mint's TokenMetadata `token_acl` field = the gate, which is how Token ACL clients find it.
//! 4. ThawGate `init_policy`: the policy admin is the issuer's master authority and the registry is sss-token's.
//!
//! The gate is fixed to ThawGate: sss-token must know the gate's `init_policy` interface to create the policy.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use spl_token_metadata_interface::state::Field;

use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;
use crate::thawgate::{
    self, GateAllowlistMode, GatePolicyArgs, FREEZE_EXTRA_ACCOUNT_METAS_SEED, POLICY_SEED, THAWGATE_GATE_ID,
    THAW_EXTRA_ACCOUNT_METAS_SEED,
};
use crate::token_acl::{self, MINT_CONFIG_SEED, TOKEN_ACL_ID};

/// The policy the issuer picks. The admin (`config.authority`) and the registry program (sss-token) are set by
/// sss-token.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GatePolicyConfig {
    /// Deny holders with an active sss-token `BlacklistEntry`.
    pub check_blacklist: bool,
    /// How the sss-token allowlist (`add_to_allowlist_v3`) is used.
    pub allowlist_mode: GateAllowlistMode,
    /// Require a live SAS attestation (nonce = holder wallet) under this credential and schema.
    pub require_sas: bool,
    pub sas_credential: Pubkey,
    pub sas_schema: Pubkey,
    /// 0 = any level; otherwise the attestation data's first byte must be at least this.
    pub min_kyc_level: u8,
}

#[derive(Accounts)]
pub struct EnableTokenAcl<'info> {
    /// The master authority; pays for the MintConfig, the policy and its extra-metas lists.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
        has_one = mint @ SssError::InvalidMint,
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
        constraint = authority_role.role == RoleType::MasterAuthority @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// CHECK: `has_one` on config; Token ACL and Token-2022 validate it.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: address constraint.
    #[account(address = TOKEN_ACL_ID)]
    pub token_acl_program: UncheckedAccount<'info>,

    /// Token ACL MintConfig PDA, created by `create_config`.
    /// CHECK: PDA constraint; Token ACL creates it.
    #[account(mut, seeds = [MINT_CONFIG_SEED, mint.key().as_ref()], bump, seeds::program = token_acl_program.key())]
    pub mint_config: UncheckedAccount<'info>,

    /// CHECK: address constraint.
    #[account(address = THAWGATE_GATE_ID)]
    pub gate_program: UncheckedAccount<'info>,

    /// The gate's `GatePolicy`, created by `init_policy`.
    /// CHECK: PDA constraint; the gate creates it.
    #[account(mut, seeds = [POLICY_SEED, mint.key().as_ref()], bump, seeds::program = gate_program.key())]
    pub gate_policy: UncheckedAccount<'info>,

    /// CHECK: PDA constraint; the gate creates it.
    #[account(mut, seeds = [THAW_EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump, seeds::program = gate_program.key())]
    pub thaw_extra_metas: UncheckedAccount<'info>,

    /// CHECK: PDA constraint; the gate creates it.
    #[account(mut, seeds = [FREEZE_EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump, seeds::program = gate_program.key())]
    pub freeze_extra_metas: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
}

/// Event emitted when a mint is put under Token ACL.
#[event]
pub struct TokenAclEnabled {
    pub mint: Pubkey,
    /// The gating program (ThawGate).
    pub gating_program: Pubkey,
    /// The gate policy's admin (the master authority at this time).
    pub policy_authority: Pubkey,
    pub timestamp: i64,
}

pub fn enable_token_acl_handler(ctx: Context<EnableTokenAcl>, policy: GatePolicyConfig) -> Result<()> {
    require!(ctx.accounts.config.uses_token_acl(), SssError::NotTokenAclMode);

    let a = &ctx.accounts;
    let mint_key = a.config.mint;
    let config_key = a.config.key();
    let signer: &[&[&[u8]]] = &[&[SEED_CONFIG, mint_key.as_ref(), &[a.config.bump]]];
    let (config, mint, mint_config) = (a.config.to_account_info(), a.mint.to_account_info(), a.mint_config.to_account_info());

    // 1. Token ACL takes over the freeze authority, with ThawGate as the gate
    invoke_signed(
        &token_acl::create_config(&a.authority.key(), &config_key, &mint_key, &mint_config.key(), &THAWGATE_GATE_ID),
        &[
            a.authority.to_account_info(),
            config.clone(),
            mint.clone(),
            mint_config.clone(),
            a.system_program.to_account_info(),
            a.token_program.to_account_info(),
            a.token_acl_program.to_account_info(),
        ],
        signer,
    )?;

    // 2. Permissionless freeze and thaw on
    invoke_signed(
        &token_acl::toggle_permissionless_instructions(&config_key, &mint_config.key(), true, true),
        &[config.clone(), mint_config.clone(), a.token_acl_program.to_account_info()],
        signer,
    )?;

    // 3. Gate discovery field (its rent was funded at initialize)
    invoke_signed(
        &spl_token_metadata_interface::instruction::update_field(
            &a.token_program.key(),
            &mint_key,
            &config_key,
            Field::Key(TOKEN_ACL_METADATA_KEY.to_string()),
            THAWGATE_GATE_ID.to_string(),
        ),
        &[mint.clone(), config.clone(), a.token_program.to_account_info()],
        signer,
    )?;

    // 4. The gate policy, administered by the issuer's master authority
    let args = GatePolicyArgs {
        authority: a.config.authority,
        issuer_program: crate::ID,
        check_blacklist: policy.check_blacklist,
        allowlist_mode: policy.allowlist_mode,
        require_sas: policy.require_sas,
        sas_credential: policy.sas_credential,
        sas_schema: policy.sas_schema,
        min_kyc_level: policy.min_kyc_level,
    };
    let ix = thawgate::init_policy(
        &config_key,
        &a.authority.key(),
        &a.gate_policy.key(),
        &mint_key,
        &mint_config.key(),
        &a.thaw_extra_metas.key(),
        &a.freeze_extra_metas.key(),
        &args,
    )?;
    invoke_signed(
        &ix,
        &[
            config,
            a.authority.to_account_info(),
            a.gate_policy.to_account_info(),
            mint,
            mint_config,
            a.thaw_extra_metas.to_account_info(),
            a.freeze_extra_metas.to_account_info(),
            a.system_program.to_account_info(),
            a.gate_program.to_account_info(),
        ],
        signer,
    )?;

    emit!(TokenAclEnabled {
        mint: mint_key,
        gating_program: THAWGATE_GATE_ID,
        policy_authority: a.config.authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
