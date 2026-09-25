//! `can_thaw_permissionless` / `can_freeze_permissionless`: what Token ACL calls on a permissionless thaw or
//! freeze. They read state, log `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`, and return Ok or the matching error.
//!
//! Token ACL resolves the extra accounts from this program's extra-metas list on-chain
//! (`ExtraAccountMetaList::add_to_cpi_instruction`), so each extra is the canonical address for this mint and
//! owner. If the caller leaves the extra-metas account out, Token ACL calls the gate with only the five base
//! accounts: that is denied here (fail closed), for freeze as much as for thaw.

use anchor_lang::prelude::*;
use solana_curve25519::edwards::{validate_edwards, PodEdwardsPoint};
use spl_token_2022::extension::{immutable_owner::ImmutableOwner, BaseStateWithExtensions, StateWithExtensions};

use crate::decision::{evaluate, Decision, Deny, Facts, Op, Sas};
use crate::metas::{Layout, EXTRA_METAS_INDEX, POLICY_INDEX};
use crate::registry::{self, Entry};
use crate::sas;
use crate::state::{AllowlistMode, GatePolicy};

#[derive(Accounts)]
pub struct CanGate<'info> {
    /// CHECK: signer of the Token ACL instruction; not used.
    pub caller: UncheckedAccount<'info>,
    /// CHECK: ImmutableOwner is checked on thaw; Token ACL checks its mint and owner.
    pub token_account: UncheckedAccount<'info>,
    /// CHECK: bound to the policy through `policy.mint`.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Token ACL checks it is the token account's owner.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: Token ACL's flag account; not used, the gate writes no state.
    pub flag_account: UncheckedAccount<'info>,
    // [5] extra_metas and the resolved extras arrive as remaining accounts.
}

pub fn can_gate_handler(ctx: Context<CanGate>, op: Op) -> Result<()> {
    match decide(&ctx, op) {
        Decision::Allow(allow) => {
            msg!(allow.log());
            Ok(())
        }
        Decision::Deny(deny) => {
            msg!(deny.log());
            Err(deny.error().into())
        }
    }
}

fn decide(ctx: &Context<CanGate>, op: Op) -> Decision {
    // Gate instruction index -> remaining account.
    let extra = |index: usize| ctx.remaining_accounts.get(index - EXTRA_METAS_INDEX);
    let (mint, owner) = (ctx.accounts.mint.key, ctx.accounts.owner.key);

    let Some(policy_info) = extra(POLICY_INDEX) else {
        return Decision::Deny(Deny::MissingAccounts);
    };
    let Some(policy) = load_policy(policy_info, mint) else {
        return Decision::Deny(Deny::BadPolicy);
    };
    let layout = Layout::for_policy(&policy);
    if EXTRA_METAS_INDEX + ctx.remaining_accounts.len() < layout.len {
        return Decision::Deny(Deny::MissingAccounts);
    }

    let read = |index: Option<usize>, reader: fn(&AccountInfo, &Pubkey, &Pubkey, &Pubkey) -> Result<Entry>| {
        index.map(|i| reader(extra(i).unwrap(), &policy.issuer_program, mint, owner)).transpose()
    };
    let (Ok(blacklist), Ok(allowlist)) =
        (read(layout.blacklist, registry::read_blacklist), read(layout.allowlist, registry::read_allowlist))
    else {
        return Decision::Deny(Deny::BadRegistryEntry);
    };

    let sas = match layout.attestation() {
        None => Sas::NotRequired,
        // A pool or vault PDA the issuer allowlisted: it cannot hold a credential, so the entry stands in. An
        // on-curve wallet with an entry still needs one.
        Some(_)
            if policy.allowlist_mode == AllowlistMode::BypassForPdas
                && allowlist == Some(Entry::Active)
                && is_off_curve(owner) =>
        {
            Sas::Bypassed
        }
        Some(index) => match sas::read_attestation(extra(index).unwrap(), &policy, owner) {
            Ok(credential) => Sas::Checked(credential),
            Err(_) => return Decision::Deny(Deny::BadCredential),
        },
    };

    let immutable_owner = match op {
        Op::Thaw => has_immutable_owner(&ctx.accounts.token_account),
        Op::Freeze => true, // not a freeze criterion
    };
    evaluate(op, &Facts { immutable_owner, blacklist, allowlist, allowlist_mode: policy.allowlist_mode, sas })
}

/// This mint's `GatePolicy`: owned by this program, right discriminator, `policy.mint == mint`.
fn load_policy(info: &AccountInfo, mint: &Pubkey) -> Option<GatePolicy> {
    if info.owner != &crate::ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    let policy = GatePolicy::try_deserialize(&mut &data[..]).ok()?;
    (policy.mint == *mint).then_some(policy)
}

/// A Token-2022 account with the ImmutableOwner extension. Without it, a KYC'd owner could thaw the account
/// and then hand it to someone else (as in the ABL reference gate).
fn has_immutable_owner(info: &AccountInfo) -> bool {
    if info.owner != &spl_token_2022::ID {
        return false;
    }
    let Ok(data) = info.try_borrow_data() else { return false };
    StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)
        .map(|account| account.get_extension::<ImmutableOwner>().is_ok())
        .unwrap_or(false)
}

/// Not an ed25519 point, so no private key: a PDA. `Pubkey::is_on_curve` is `unimplemented!()` on SBF;
/// `validate_edwards` is the `sol_curve_validate_point` syscall there (curve25519-dalek off-chain).
fn is_off_curve(key: &Pubkey) -> bool {
    !validate_edwards(&PodEdwardsPoint(key.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdas_are_off_curve_wallets_are_not() {
        let (pda, _) = Pubkey::find_program_address(&[b"whirlpool"], &crate::ID);
        assert!(is_off_curve(&pda));
        // The S3 spike's holder, a generated keypair (SPIKES.md S3).
        assert!(!is_off_curve(&pubkey!("4CTEDr7pgqBU4uLkVk2aqu54tPQi9ufUKZVvDv2tgYp2")));
    }
}
