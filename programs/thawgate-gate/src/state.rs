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
    /// credential it cannot hold. Everyone else still needs the credential. Requires `require_sas`.
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
    /// SAS KYC policy: the owner needs a live attestation at `["attestation", sas_credential, sas_schema, owner]`
    /// under SAS (nonce = holder wallet).
    pub require_sas: bool,
    pub sas_credential: Pubkey,
    pub sas_schema: Pubkey,
    /// 0 = any level. Otherwise compared with the attestation data's first byte, so the schema's first field must
    /// be `kyc_level: u8`.
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
        if args.check_blacklist || args.allowlist_mode != AllowlistMode::Off {
            require_keys_neq!(args.issuer_program, Pubkey::default(), GateError::MissingIssuerProgram);
        }
        if args.require_sas {
            require!(
                args.sas_credential != Pubkey::default() && args.sas_schema != Pubkey::default(),
                GateError::MissingSasConfig
            );
        }
        require!(args.allowlist_mode != AllowlistMode::BypassForPdas || args.require_sas, GateError::BypassNeedsSas);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(require_sas: bool, credential: Pubkey, schema: Pubkey, allowlist_mode: AllowlistMode) -> PolicyArgs {
        PolicyArgs {
            authority: Pubkey::new_unique(),
            issuer_program: Pubkey::new_unique(),
            check_blacklist: false,
            allowlist_mode,
            require_sas,
            sas_credential: credential,
            sas_schema: schema,
            min_kyc_level: 1,
        }
    }
    fn apply(a: &PolicyArgs) -> Result<()> {
        let mut policy = GatePolicy {
            version: POLICY_VERSION,
            bump: 255,
            mint: Pubkey::new_unique(),
            authority: Pubkey::default(),
            issuer_program: Pubkey::default(),
            check_blacklist: false,
            allowlist_mode: AllowlistMode::Off,
            require_sas: false,
            sas_credential: Pubkey::default(),
            sas_schema: Pubkey::default(),
            min_kyc_level: 0,
            reserved: [0; 64],
        };
        policy.apply(a)
    }
    fn is(result: Result<()>, expected: GateError) -> bool {
        matches!(result, Err(Error::AnchorError(e)) if e.error_code_number == u32::from(expected))
    }

    #[test]
    fn sas_needs_a_credential_and_schema() {
        let (c, s, none) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::default());
        assert!(apply(&args(true, c, s, AllowlistMode::Off)).is_ok());
        assert!(is(apply(&args(true, none, s, AllowlistMode::Off)), GateError::MissingSasConfig));
        assert!(is(apply(&args(true, c, none, AllowlistMode::Off)), GateError::MissingSasConfig));
        // Unused SAS fields may stay default while the policy is off.
        assert!(apply(&args(false, none, none, AllowlistMode::Off)).is_ok());
    }

    #[test]
    fn bypass_for_pdas_needs_sas() {
        let (c, s, none) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::default());
        assert!(apply(&args(true, c, s, AllowlistMode::BypassForPdas)).is_ok());
        assert!(is(apply(&args(false, none, none, AllowlistMode::BypassForPdas)), GateError::BypassNeedsSas));
    }
}
