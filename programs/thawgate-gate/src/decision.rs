//! The gate's decision, as a pure function of what the handler read. Every outcome has a log code:
//! `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`.

use crate::errors::GateError;
use crate::registry::Entry;
use crate::state::AllowlistMode;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
    Thaw,
    Freeze,
}

/// What the handler read. `blacklist` / `allowlist` are `None` when the policy does not consult them.
pub struct Facts {
    pub immutable_owner: bool,
    pub blacklist: Option<Entry>,
    pub allowlist: Option<Entry>,
    pub allowlist_mode: AllowlistMode,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Allow {
    Clean,
    Allowlisted,
    /// Freeze allowed: the owner is on the blacklist.
    Blacklisted,
    /// Freeze allowed: the policy requires an allowlist entry and the owner has none.
    NotAllowlisted,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Deny {
    MissingAccounts,
    BadPolicy,
    BadRegistryEntry,
    NoImmutableOwner,
    Blacklisted,
    NotAllowlisted,
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
            Allow::Blacklisted => "TG:ALLOW:BLACKLISTED",
            Allow::NotAllowlisted => "TG:ALLOW:NOT_ALLOWLISTED",
        }
    }
}

impl Deny {
    pub fn log(self) -> &'static str {
        match self {
            Deny::MissingAccounts => "TG:DENY:MISSING_ACCOUNTS",
            Deny::BadPolicy => "TG:DENY:BAD_POLICY",
            Deny::BadRegistryEntry => "TG:DENY:BAD_REGISTRY_ENTRY",
            Deny::NoImmutableOwner => "TG:DENY:NO_IMMUTABLE_OWNER",
            Deny::Blacklisted => "TG:DENY:BLACKLISTED",
            Deny::NotAllowlisted => "TG:DENY:NOT_ALLOWLISTED",
            Deny::Compliant => "TG:DENY:COMPLIANT",
        }
    }

    pub fn error(self) -> GateError {
        match self {
            Deny::MissingAccounts => GateError::DeniedMissingAccounts,
            Deny::BadPolicy => GateError::DeniedBadPolicy,
            Deny::BadRegistryEntry => GateError::DeniedBadRegistryEntry,
            Deny::NoImmutableOwner => GateError::DeniedNoImmutableOwner,
            Deny::Blacklisted => GateError::DeniedBlacklisted,
            Deny::NotAllowlisted => GateError::DeniedNotAllowlisted,
            Deny::Compliant => GateError::DeniedCompliant,
        }
    }
}

/// Thaw passes when the account has ImmutableOwner and no policy flags the owner. Freeze passes only when a
/// policy flags the owner (never for lack of data: missing accounts are denied before this runs).
pub fn evaluate(op: Op, facts: &Facts) -> Decision {
    let blacklisted = facts.blacklist == Some(Entry::Active);
    let allowlisted = facts.allowlist == Some(Entry::Active);
    let not_allowlisted = facts.allowlist_mode == AllowlistMode::AllowOnly && !allowlisted;
    match op {
        Op::Thaw if !facts.immutable_owner => Decision::Deny(Deny::NoImmutableOwner),
        Op::Thaw if blacklisted => Decision::Deny(Deny::Blacklisted),
        Op::Thaw if not_allowlisted => Decision::Deny(Deny::NotAllowlisted),
        Op::Thaw if allowlisted => Decision::Allow(Allow::Allowlisted),
        Op::Thaw => Decision::Allow(Allow::Clean),
        Op::Freeze if blacklisted => Decision::Allow(Allow::Blacklisted),
        Op::Freeze if not_allowlisted => Decision::Allow(Allow::NotAllowlisted),
        Op::Freeze => Decision::Deny(Deny::Compliant),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AllowlistMode::*;
    use Entry::{Active, Inactive};

    fn facts(immutable_owner: bool, blacklist: Option<Entry>, allowlist: Option<Entry>, mode: AllowlistMode) -> Facts {
        Facts { immutable_owner, blacklist, allowlist, allowlist_mode: mode }
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
    fn bypass_for_pdas_does_not_gate_until_sas() {
        assert_eq!(both(&facts(true, None, Some(Entry::None), BypassForPdas)), (A(Allow::Clean), D(Deny::Compliant)));
        assert_eq!(both(&facts(true, None, Some(Active), BypassForPdas)), (A(Allow::Allowlisted), D(Deny::Compliant)));
    }

    #[test]
    fn thaw_needs_immutable_owner_freeze_does_not_care() {
        assert_eq!(evaluate(Op::Thaw, &facts(false, None, None, Off)), D(Deny::NoImmutableOwner));
        assert_eq!(evaluate(Op::Freeze, &facts(false, Some(Active), None, Off)), A(Allow::Blacklisted));
        assert_eq!(evaluate(Op::Freeze, &facts(false, None, None, Off)), D(Deny::Compliant));
    }
}
