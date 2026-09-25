//! Error codes. The gate's own denials (`Denied*`) are also logged as `TG:DENY:<CODE>`.

use anchor_lang::prelude::*;

#[error_code]
pub enum GateError {
    // --- policy administration
    #[msg("Not a Token ACL MintConfig (owner, size or discriminator)")]
    InvalidMintConfig,
    #[msg("The MintConfig belongs to a different mint")]
    MintConfigMismatch,
    #[msg("Signer is not the Token ACL freeze authority of this mint")]
    NotFreezeAuthority,
    #[msg("Signer is not the policy authority")]
    NotPolicyAuthority,
    #[msg("Mint is not a Token-2022 mint")]
    InvalidMint,
    #[msg("Extra-metas account is not the expected PDA")]
    InvalidExtraMetasAccount,
    #[msg("issuer_program must be set when the blacklist or allowlist is enabled")]
    MissingIssuerProgram,
    #[msg("sas_credential and sas_schema must be set when require_sas is on")]
    MissingSasConfig,
    #[msg("BypassForPdas stands in for the SAS credential, so it needs require_sas")]
    BypassNeedsSas,

    // --- gate decisions (can_thaw / can_freeze)
    #[msg("TG:DENY:MISSING_ACCOUNTS: extra accounts missing")]
    DeniedMissingAccounts,
    #[msg("TG:DENY:BAD_POLICY: policy account is not this mint's GatePolicy")]
    DeniedBadPolicy,
    #[msg("TG:DENY:BAD_REGISTRY_ENTRY: registry account has the wrong owner, type or fields")]
    DeniedBadRegistryEntry,
    #[msg("TG:DENY:BAD_CREDENTIAL: attestation account is not a SAS attestation of this credential, schema and owner")]
    DeniedBadCredential,
    #[msg("TG:DENY:NO_IMMUTABLE_OWNER: token account lacks the ImmutableOwner extension")]
    DeniedNoImmutableOwner,
    #[msg("TG:DENY:BLACKLISTED: owner is on the issuer blacklist")]
    DeniedBlacklisted,
    #[msg("TG:DENY:NOT_ALLOWLISTED: owner is not on the issuer allowlist")]
    DeniedNotAllowlisted,
    #[msg("TG:DENY:NO_CREDENTIAL: owner has no SAS attestation (never issued, or revoked)")]
    DeniedNoCredential,
    #[msg("TG:DENY:CREDENTIAL_EXPIRED: owner's SAS attestation has expired")]
    DeniedCredentialExpired,
    #[msg("TG:DENY:KYC_LEVEL_TOO_LOW: owner's kyc_level is below the policy minimum")]
    DeniedKycLevelTooLow,
    #[msg("TG:DENY:COMPLIANT: owner passes the policy, so it cannot be frozen permissionlessly")]
    DeniedCompliant,
}
