//! The ThawGate gate's `init_policy`, vendored for the `enable_token_acl` CPI.
//!
//! No crate dependency on thawgate-gate: the gate already dev-depends on sss-token (for its registry drift tests),
//! so the reverse would be a cycle. The ID, seeds, discriminator, argument layout and account order below are
//! pinned against the real gate by programs/thawgate-gate/src/instructions/init_policy.rs tests.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::system_program;

/// ThawGate gate program (its `declare_id!`; checked by scripts/verify-ids.sh).
pub const THAWGATE_GATE_ID: Pubkey = pubkey!("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");

/// Gate PDAs: `GatePolicy` at `["policy", mint]`; the extra-metas lists Token ACL reads.
pub const POLICY_SEED: &[u8] = b"policy";
pub const THAW_EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"thaw_extra_account_metas";
pub const FREEZE_EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"freeze_extra_account_metas";

/// Anchor discriminator of `init_policy`: sha256("global:init_policy")[..8].
pub const INIT_POLICY_DISCRIMINATOR: [u8; 8] = [45, 234, 110, 100, 209, 146, 191, 86];

/// Mirror of the gate's `AllowlistMode` (Borsh: the variant index as one byte).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GateAllowlistMode {
    /// The allowlist is not consulted.
    Off,
    /// Only owners with an active allowlist entry may thaw.
    AllowOnly,
    /// An active entry on an off-curve owner (a pool or vault PDA) stands in for the SAS credential.
    BypassForPdas,
}

/// Mirror of the gate's `PolicyArgs` (programs/thawgate-gate/src/state.rs), same field order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GatePolicyArgs {
    pub authority: Pubkey,
    pub issuer_program: Pubkey,
    pub check_blacklist: bool,
    pub allowlist_mode: GateAllowlistMode,
    pub require_sas: bool,
    pub sas_credential: Pubkey,
    pub sas_schema: Pubkey,
    pub min_kyc_level: u8,
}

/// `init_policy(args)`. `freeze_authority` must be the Token ACL `MintConfig.freeze_authority` (the sss-token
/// config PDA, signing through its seeds); `payer` funds the policy and both extra-metas lists.
/// Accounts: freeze_authority (s), payer (w, s), policy (w), mint, mint_config, thaw_extra_metas (w),
/// freeze_extra_metas (w), system_program.
#[allow(clippy::too_many_arguments)]
pub fn init_policy(
    freeze_authority: &Pubkey,
    payer: &Pubkey,
    policy: &Pubkey,
    mint: &Pubkey,
    mint_config: &Pubkey,
    thaw_extra_metas: &Pubkey,
    freeze_extra_metas: &Pubkey,
    args: &GatePolicyArgs,
) -> Result<Instruction> {
    let mut data = INIT_POLICY_DISCRIMINATOR.to_vec();
    args.serialize(&mut data)?;
    Ok(Instruction {
        program_id: THAWGATE_GATE_ID,
        accounts: vec![
            AccountMeta::new_readonly(*freeze_authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(*policy, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*mint_config, false),
            AccountMeta::new(*thaw_extra_metas, false),
            AccountMeta::new(*freeze_extra_metas, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    })
}
