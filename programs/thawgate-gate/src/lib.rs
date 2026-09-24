//! # ThawGate gate: a Token ACL (sRFC 37) gating program
//!
//! Token ACL calls this program on every permissionless thaw or freeze of a mint whose `MintConfig`
//! names it as `gating_program`. The answer comes from the mint's `GatePolicy`:
//! - thaw: the token account has ImmutableOwner, the owner is not on the issuer blacklist and, in
//!   `AllowOnly` mode, is on the issuer allowlist;
//! - freeze: only when a policy flags the owner (blacklisted, or not allowlisted in `AllowOnly` mode).
//!
//! The issuer registry is sss-token's `BlacklistEntry` / `AllowlistEntry` accounts, read in place.
//! Every decision is logged as `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.

use anchor_lang::prelude::*;

pub mod decision;
pub mod errors;
pub mod instructions;
pub mod metas;
pub mod registry;
pub mod state;
pub mod token_acl;

use decision::Op;
use instructions::*;
use state::PolicyArgs;

declare_id!("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");

#[program]
pub mod thawgate_gate {
    use super::*;

    /// Creates the mint's policy and its thaw/freeze extra-metas lists.
    /// Signed by the Token ACL freeze authority; `args.authority` becomes the policy admin.
    pub fn init_policy(ctx: Context<InitPolicy>, args: PolicyArgs) -> Result<()> {
        instructions::init_policy::init_policy_handler(ctx, args)
    }

    /// Changes the policy and rewrites both extra-metas lists to match.
    pub fn update_policy(ctx: Context<UpdatePolicy>, args: PolicyArgs) -> Result<()> {
        instructions::update_policy::update_policy_handler(ctx, args)
    }

    /// Rewrites both extra-metas lists from the stored policy (idempotent).
    pub fn setup_extra_metas(ctx: Context<UpdatePolicy>) -> Result<()> {
        instructions::update_policy::setup_extra_metas_handler(ctx)
    }

    /// Token ACL gate interface: may this token account be thawed permissionlessly?
    #[instruction(discriminator = crate::token_acl::CAN_THAW_DISCRIMINATOR)]
    pub fn can_thaw_permissionless(ctx: Context<CanGate>) -> Result<()> {
        instructions::gate::can_gate_handler(ctx, Op::Thaw)
    }

    /// Token ACL gate interface: may this token account be frozen permissionlessly?
    #[instruction(discriminator = crate::token_acl::CAN_FREEZE_DISCRIMINATOR)]
    pub fn can_freeze_permissionless(ctx: Context<CanGate>) -> Result<()> {
        instructions::gate::can_gate_handler(ctx, Op::Freeze)
    }
}
