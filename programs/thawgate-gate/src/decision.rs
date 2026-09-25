//! The gate's decision, as a pure function of what the handler read. Every outcome has a log code:
//! `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.
//!
//! One rule for both instructions: a thaw passes when no policy flags the owner, and a freeze passes only when one
//! does. So tightening a policy (raising `min_kyc_level`, switching to `AllowOnly`) makes holders who no longer
//! comply permissionlessly freezable, by design. Missing or malformed accounts deny both (they are decided before
//! this runs).

use crate::errors::GateError;
use crate::registry::Entry;
use crate::sas::Credential;
use crate::state::AllowlistMode;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
    Thaw,
    Freeze,
}

/// The SAS KYC policy's input.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Sas {
    /// The policy does not require a credential.
    NotRequired,
    /// `BypassForPdas`: an allowlisted off-curve owner (a pool or vault PDA) cannot hold a credential, and its
    /// allowlist entry stands in for one. The attestation is not read.
    Bypassed,
    /// The attestation at the enforced address.
    Checked(Credential),
}

/// What the handler read. `blacklist` / `allowlist` are `None` when the policy does not consult them.
pub struct Facts {
    pub immutable_owner: bool,
    pub blacklist: Option<Entry>,
    pub allowlist: Option<Entry>,
    pub allowlist_mode: AllowlistMode,
    pub sas: Sas,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Allow {
    // Thaw: what admitted the owner.
    Clean,
    Allowlisted,
    /// A valid SAS credential.
    Kyc,
    /// `BypassForPdas`: an allowlisted pool or vault PDA.
    PdaAllowlisted,
    // Freeze: the policy flag on the owner.
    Blacklisted,
    NotAllowlisted,
    NoCredential,
    CredentialExpired,
    KycLevelTooLow,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Deny {
    MissingAccounts,
    BadPolicy,
    BadRegistryEntry,
    /// The account at the attestation address is not a SAS attestation for this policy and owner.
    BadCredential,
    NoImmutableOwner,
    // Thaw: the policy flag on the owner.
    Blacklisted,
    NotAllowlisted,
    NoCredential,
    CredentialExpired,
    KycLevelTooLow,
    /// Freeze refused: the owner passes the policy.
    Compliant,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decision {
    Allow(Allow),
    Deny(Deny),
}

impl Allow {
    pub fn log(self) -> &'static str {
        match self {
            Allow::Clean => "TG:ALLOW:CLEAN",
            Allow::Allowlisted => "TG:ALLOW:ALLOWLISTED",
            Allow::Kyc => "TG:ALLOW:KYC",
            Allow::PdaAllowlisted => "TG:ALLOW:PDA_ALLOWLISTED",
            Allow::Blacklisted => "TG:ALLOW:BLACKLISTED",
            Allow::NotAllowlisted => "TG:ALLOW:NOT_ALLOWLISTED",
            Allow::NoCredential => "TG:ALLOW:NO_CREDENTIAL",
            Allow::CredentialExpired => "TG:ALLOW:CREDENTIAL_EXPIRED",
            Allow::KycLevelTooLow => "TG:ALLOW:KYC_LEVEL_TOO_LOW",
        }
    }
}

impl Deny {
    pub fn log(self) -> &'static str {
        match self {
            Deny::MissingAccounts => "TG:DENY:MISSING_ACCOUNTS",
            Deny::BadPolicy => "TG:DENY:BAD_POLICY",
            Deny::BadRegistryEntry => "TG:DENY:BAD_REGISTRY_ENTRY",
            Deny::BadCredential => "TG:DENY:BAD_CREDENTIAL",
            Deny::NoImmutableOwner => "TG:DENY:NO_IMMUTABLE_OWNER",
            Deny::Blacklisted => "TG:DENY:BLACKLISTED",
            Deny::NotAllowlisted => "TG:DENY:NOT_ALLOWLISTED",
            Deny::NoCredential => "TG:DENY:NO_CREDENTIAL",
            Deny::CredentialExpired => "TG:DENY:CREDENTIAL_EXPIRED",
            Deny::KycLevelTooLow => "TG:DENY:KYC_LEVEL_TOO_LOW",
            Deny::Compliant => "TG:DENY:COMPLIANT",
        }
    }

    pub fn error(self) -> GateError {
        match self {
            Deny::MissingAccounts => GateError::DeniedMissingAccounts,
            Deny::BadPolicy => GateError::DeniedBadPolicy,
            Deny::BadRegistryEntry => GateError::DeniedBadRegistryEntry,
            Deny::BadCredential => GateError::DeniedBadCredential,
            Deny::NoImmutableOwner => GateError::DeniedNoImmutableOwner,
            Deny::Blacklisted => GateError::DeniedBlacklisted,
            Deny::NotAllowlisted => GateError::DeniedNotAllowlisted,
            Deny::NoCredential => GateError::DeniedNoCredential,
            Deny::CredentialExpired => GateError::DeniedCredentialExpired,
            Deny::KycLevelTooLow => GateError::DeniedKycLevelTooLow,
            Deny::Compliant => GateError::DeniedCompliant,
        }
    }
}

/// A policy flag on the owner: it denies a thaw and allows a freeze.
#[derive(Clone, Copy)]
enum Flag {
    Blacklisted,
    NotAllowlisted,
    NoCredential,
    CredentialExpired,
    KycLevelTooLow,
}

impl Flag {
    fn deny(self) -> Deny {
        match self {
            Flag::Blacklisted => Deny::Blacklisted,
            Flag::NotAllowlisted => Deny::NotAllowlisted,
            Flag::NoCredential => Deny::NoCredential,
            Flag::CredentialExpired => Deny::CredentialExpired,
            Flag::KycLevelTooLow => Deny::KycLevelTooLow,
        }
    }

    fn allow(self) -> Allow {
        match self {
            Flag::Blacklisted => Allow::Blacklisted,
            Flag::NotAllowlisted => Allow::NotAllowlisted,
            Flag::NoCredential => Allow::NoCredential,
            Flag::CredentialExpired => Allow::CredentialExpired,
            Flag::KycLevelTooLow => Allow::KycLevelTooLow,
        }
    }
}

/// The first policy that flags the owner, in precedence order: blacklist, allowlist, SAS credential.
fn flag(facts: &Facts) -> Option<Flag> {
    if facts.blacklist == Some(Entry::Active) {
        return Some(Flag::Blacklisted);
    }
    if facts.allowlist_mode == AllowlistMode::AllowOnly && facts.allowlist != Some(Entry::Active) {
        return Some(Flag::NotAllowlisted);
    }
    match facts.sas {
        Sas::Checked(Credential::Missing) => Some(Flag::NoCredential),
        Sas::Checked(Credential::Expired) => Some(Flag::CredentialExpired),
        Sas::Checked(Credential::LevelTooLow) => Some(Flag::KycLevelTooLow),
        Sas::NotRequired | Sas::Bypassed | Sas::Checked(Credential::Valid) => None,
    }
}

/// What admitted an unflagged owner.
fn admitted_by(facts: &Facts) -> Allow {
    match facts.sas {
        Sas::Bypassed => Allow::PdaAllowlisted,
        Sas::Checked(_) => Allow::Kyc, // only a valid credential is unflagged
        Sas::NotRequired if facts.allowlist == Some(Entry::Active) => Allow::Allowlisted,
        Sas::NotRequired => Allow::Clean,
    }
}

/// Thaw passes when the account has ImmutableOwner and no policy flags the owner. Freeze passes only when a
/// policy flags the owner (never for lack of data: missing accounts are denied before this runs).
pub fn evaluate(op: Op, facts: &Facts) -> Decision {
    match (op, flag(facts)) {
        (Op::Thaw, _) if !facts.immutable_owner => Decision::Deny(Deny::NoImmutableOwner),
        (Op::Thaw, Some(flag)) => Decision::Deny(flag.deny()),
        (Op::Thaw, None) => Decision::Allow(admitted_by(facts)),
        (Op::Freeze, Some(flag)) => Decision::Allow(flag.allow()),
        (Op::Freeze, None) => Decision::Deny(Deny::Compliant),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AllowlistMode::*;
    use Entry::{Active, Inactive};

    fn facts(immutable_owner: bool, blacklist: Option<Entry>, allowlist: Option<Entry>, mode: AllowlistMode) -> Facts {
        Facts { immutable_owner, blacklist, allowlist, allowlist_mode: mode, sas: Sas::NotRequired }
    }
    fn with_sas(sas: Sas, allowlist: Option<Entry>, mode: AllowlistMode) -> Facts {
        Facts { sas, ..facts(true, None, allowlist, mode) }
    }
    fn both(f: &Facts) -> (Decision, Decision) {
        (evaluate(Op::Thaw, f), evaluate(Op::Freeze, f))
    }
    use Decision::{Allow as A, Deny as D};

    #[test]
    fn clean_owner_thaws_and_cannot_be_frozen() {
        assert_eq!(both(&facts(true, None, None, Off)), (A(Allow::Clean), D(Deny::Compliant)));
        assert_eq!(both(&facts(true, Some(Entry::None), None, Off)), (A(Allow::Clean), D(Deny::Compliant)));
        assert_eq!(both(&facts(true, Some(Inactive), None, Off)), (A(Allow::Clean), D(Deny::Compliant)));
    }

    #[test]
    fn blacklisted_owner_is_denied_and_freezable() {
        assert_eq!(both(&facts(true, Some(Active), None, Off)), (D(Deny::Blacklisted), A(Allow::Blacklisted)));
        // Blacklist wins over an allowlist entry.
        assert_eq!(both(&facts(true, Some(Active), Some(Active), AllowOnly)), (D(Deny::Blacklisted), A(Allow::Blacklisted)));
    }

    #[test]
    fn allow_only_requires_an_active_entry() {
        assert_eq!(both(&facts(true, None, Some(Active), AllowOnly)), (A(Allow::Allowlisted), D(Deny::Compliant)));
        for missing in [Entry::None, Inactive] {
            assert_eq!(
                both(&facts(true, None, Some(missing), AllowOnly)),
                (D(Deny::NotAllowlisted), A(Allow::NotAllowlisted))
            );
        }
    }

    #[test]
    fn thaw_needs_immutable_owner_freeze_does_not_care() {
        assert_eq!(evaluate(Op::Thaw, &facts(false, None, None, Off)), D(Deny::NoImmutableOwner));
        assert_eq!(evaluate(Op::Freeze, &facts(false, Some(Active), None, Off)), A(Allow::Blacklisted));
        assert_eq!(evaluate(Op::Freeze, &facts(false, None, None, Off)), D(Deny::Compliant));
        // Also for an allowlisted PDA: the bypass skips SAS, not ImmutableOwner.
        let pda_without = Facts { immutable_owner: false, ..with_sas(Sas::Bypassed, Some(Active), BypassForPdas) };
        assert_eq!(evaluate(Op::Thaw, &pda_without), D(Deny::NoImmutableOwner));
    }

    #[test]
    fn valid_credential_thaws_and_cannot_be_frozen() {
        let valid = Sas::Checked(Credential::Valid);
        assert_eq!(both(&with_sas(valid, None, Off)), (A(Allow::Kyc), D(Deny::Compliant)));
        assert_eq!(both(&with_sas(valid, Some(Active), AllowOnly)), (A(Allow::Kyc), D(Deny::Compliant)));
        assert_eq!(both(&with_sas(valid, Some(Entry::None), BypassForPdas)), (A(Allow::Kyc), D(Deny::Compliant)));
    }

    #[test]
    fn missing_expired_or_low_credential_is_denied_and_freezable() {
        for (credential, deny, allow) in [
            (Credential::Missing, Deny::NoCredential, Allow::NoCredential),
            (Credential::Expired, Deny::CredentialExpired, Allow::CredentialExpired),
            (Credential::LevelTooLow, Deny::KycLevelTooLow, Allow::KycLevelTooLow),
        ] {
            assert_eq!(both(&with_sas(Sas::Checked(credential), None, Off)), (D(deny), A(allow)));
            // An allowlist entry doesn't stand in for the credential outside BypassForPdas (the handler only
            // bypasses for off-curve owners in that mode).
            assert_eq!(both(&with_sas(Sas::Checked(credential), Some(Active), AllowOnly)), (D(deny), A(allow)));
        }
    }

    #[test]
    fn earlier_policies_take_precedence_over_the_credential() {
        let missing = Sas::Checked(Credential::Missing);
        let blacklisted = Facts { blacklist: Some(Active), ..with_sas(missing, None, Off) };
        assert_eq!(both(&blacklisted), (D(Deny::Blacklisted), A(Allow::Blacklisted)));
        assert_eq!(both(&with_sas(missing, Some(Inactive), AllowOnly)), (D(Deny::NotAllowlisted), A(Allow::NotAllowlisted)));
    }

    #[test]
    fn bypassed_pda_thaws_and_cannot_be_frozen_unless_blacklisted() {
        let bypassed = with_sas(Sas::Bypassed, Some(Active), BypassForPdas);
        assert_eq!(both(&bypassed), (A(Allow::PdaAllowlisted), D(Deny::Compliant)));
        let blacklisted = Facts { blacklist: Some(Active), ..with_sas(Sas::Bypassed, Some(Active), BypassForPdas) };
        assert_eq!(both(&blacklisted), (D(Deny::Blacklisted), A(Allow::Blacklisted)));
    }
}
