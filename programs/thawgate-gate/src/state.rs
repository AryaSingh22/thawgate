//! Per-mint policy.

use anchor_lang::prelude::*;

use crate::errors::GateError;

/// `GatePolicy` PDA seed: `["policy", mint]`.
pub const POLICY_SEED: &[u8] = b"policy";

/// Current `GatePolicy.version`.
pub const POLICY_VERSION: u8 = 1;

/// How the issuer allowlist is used.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AllowlistMode {
    /// The allowlist is not consulted.
    Off,
    /// Only owners with an active allowlist entry may thaw.
    AllowOnly,
    /// An active allowlist entry on an off-curve owner (a pool or vault PDA) stands in for the SAS
    /// credential it cannot hold. Stored now; enforced with the SAS policy (S5).
    BypassForPdas,
}

/// One per mint. Token ACL resolves it for the gate as extra account `[6]`.
#[account]
#[derive(InitSpace)]
pub struct GatePolicy {
    pub version: u8,
    pub bump: u8,
    pub mint: Pubkey,
    /// May change the policy (`update_policy`, `setup_extra_metas`).
    pub authority: Pubkey,
    /// Program that owns the registry (sss-token): `BlacklistEntry` at `["blacklist", mint, wallet]`,
    /// `AllowlistEntry` at `["allowlist", mint, wallet]`.
    pub issuer_program: Pubkey,
    pub check_blacklist: bool,
    pub allowlist_mode: AllowlistMode,
    /// SAS KYC policy (S5). Rejected while it is not implemented.
    pub require_sas: bool,
    pub sas_credential: Pubkey,
    pub sas_schema: Pubkey,
    pub min_kyc_level: u8,
    /// Room for later policies (sanctions, keeper settings) without a realloc.
    pub reserved: [u8; 64],
}

/// Settable policy fields, for `init_policy` and `update_policy`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PolicyArgs {
    pub authority: Pubkey,
    pub issuer_program: Pubkey,
    pub check_blacklist: bool,
    pub allowlist_mode: AllowlistMode,
    pub require_sas: bool,
    pub sas_credential: Pubkey,
    pub sas_schema: Pubkey,
    pub min_kyc_level: u8,
}

impl GatePolicy {
    /// Validates `args` and copies them in.
    pub fn apply(&mut self, args: &PolicyArgs) -> Result<()> {
        require!(!args.require_sas, GateError::SasNotYetSupported);
        if args.check_blacklist || args.allowlist_mode != AllowlistMode::Off {
            require_keys_neq!(args.issuer_program, Pubkey::default(), GateError::MissingIssuerProgram);
        }
        self.authority = args.authority;
        self.issuer_program = args.issuer_program;
        self.check_blacklist = args.check_blacklist;
        self.allowlist_mode = args.allowlist_mode;
        self.require_sas = args.require_sas;
        self.sas_credential = args.sas_credential;
        self.sas_schema = args.sas_schema;
        self.min_kyc_level = args.min_kyc_level;
        Ok(())
    }
}
