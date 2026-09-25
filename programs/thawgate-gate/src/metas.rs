//! Extra-metas: which accounts Token ACL resolves for the gate, and at which index.
//!
//! The gate instruction's first accounts are fixed by Token ACL:
//! `0 caller | 1 token_account | 2 mint | 3 token_account_owner | 4 flag_account | 5 extra_metas`.
//! The extras follow, only for enabled policies: `6 policy`, then `issuer_program`, `blacklist entry`,
//! `allowlist entry`, then the SAS group: `SAS program`, `credential`, `schema`, `attestation`.
//! [`Layout::of`] is the single source for both writing the list and reading it back.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};

use crate::errors::GateError;
use crate::registry::{SEED_ALLOWLIST, SEED_BLACKLIST};
use crate::sas::{ATTESTATION_SEED, SAS_ID};
use crate::state::{AllowlistMode, GatePolicy, POLICY_SEED};
use crate::token_acl::{
    CanFreezePermissionless, CanThawPermissionless, FREEZE_EXTRA_ACCOUNT_METAS_SEED, THAW_EXTRA_ACCOUNT_METAS_SEED,
};

pub const MINT_INDEX: u8 = 2;
/// Token ACL checks `token_account.owner == token_account_owner` before calling the gate.
pub const OWNER_INDEX: u8 = 3;
pub const EXTRA_METAS_INDEX: usize = 5;
pub const POLICY_INDEX: usize = 6;

/// The SAS group, from its first index: SAS program, credential, schema, attestation.
const SAS_GROUP_LEN: usize = 4;
const SAS_CREDENTIAL_OFFSET: usize = 1;
const SAS_SCHEMA_OFFSET: usize = 2;
const SAS_ATTESTATION_OFFSET: usize = 3;

/// Where each extra account sits in the gate instruction.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Layout {
    pub issuer: Option<usize>,
    pub blacklist: Option<usize>,
    pub allowlist: Option<usize>,
    /// First index of the SAS group (the SAS program); see [`Layout::attestation`].
    pub sas: Option<usize>,
    /// Number of accounts in the gate instruction.
    pub len: usize,
}

impl Layout {
    pub fn of(check_blacklist: bool, allowlist_mode: AllowlistMode, require_sas: bool) -> Self {
        let allowlist_on = allowlist_mode != AllowlistMode::Off;
        let mut next = POLICY_INDEX + 1;
        let mut slot = |on: bool, width: usize| {
            on.then(|| {
                next += width;
                next - width
            })
        };
        let issuer = slot(check_blacklist || allowlist_on, 1);
        let blacklist = slot(check_blacklist, 1);
        let allowlist = slot(allowlist_on, 1);
        let sas = slot(require_sas, SAS_GROUP_LEN);
        Layout { issuer, blacklist, allowlist, sas, len: next }
    }

    pub fn for_policy(policy: &GatePolicy) -> Self {
        Self::of(policy.check_blacklist, policy.allowlist_mode, policy.require_sas)
    }

    /// Index of the holder's SAS attestation.
    pub fn attestation(&self) -> Option<usize> {
        self.sas.map(|sas| sas + SAS_ATTESTATION_OFFSET)
    }
}

/// The extra-metas list for a policy, in [`Layout`] order.
pub fn extra_metas(policy: &GatePolicy) -> Result<Vec<ExtraAccountMeta>> {
    let layout = Layout::for_policy(policy);
    let registry_seeds = |prefix: &[u8]| {
        [
            Seed::Literal { bytes: prefix.to_vec() },
            Seed::AccountKey { index: MINT_INDEX },
            Seed::AccountKey { index: OWNER_INDEX },
        ]
    };
    let mut metas = vec![ExtraAccountMeta::new_with_seeds(
        &[Seed::Literal { bytes: POLICY_SEED.to_vec() }, Seed::AccountKey { index: MINT_INDEX }],
        false,
        false,
    )?];
    if let Some(issuer) = layout.issuer {
        metas.push(ExtraAccountMeta::new_with_pubkey(&policy.issuer_program, false, false)?);
        if layout.blacklist.is_some() {
            metas.push(ExtraAccountMeta::new_external_pda_with_seeds(issuer as u8, &registry_seeds(SEED_BLACKLIST), false, false)?);
        }
        if layout.allowlist.is_some() {
            metas.push(ExtraAccountMeta::new_external_pda_with_seeds(issuer as u8, &registry_seeds(SEED_ALLOWLIST), false, false)?);
        }
    }
    if let Some(sas) = layout.sas {
        // The attestation is SAS's PDA `["attestation", credential, schema, nonce]` with nonce = the owner (key 3;
        // Token ACL checks it owns the token account). Credential and schema are fixed metas so the seeds can
        // reference them by index: 19 of the 32 address-config bytes.
        metas.push(ExtraAccountMeta::new_with_pubkey(&SAS_ID, false, false)?);
        metas.push(ExtraAccountMeta::new_with_pubkey(&policy.sas_credential, false, false)?);
        metas.push(ExtraAccountMeta::new_with_pubkey(&policy.sas_schema, false, false)?);
        metas.push(ExtraAccountMeta::new_external_pda_with_seeds(
            sas as u8,
            &[
                Seed::Literal { bytes: ATTESTATION_SEED.to_vec() },
                Seed::AccountKey { index: (sas + SAS_CREDENTIAL_OFFSET) as u8 },
                Seed::AccountKey { index: (sas + SAS_SCHEMA_OFFSET) as u8 },
                Seed::AccountKey { index: OWNER_INDEX },
            ],
            false,
            false,
        )?);
    }
    Ok(metas)
}

/// Writes the policy's list into both the thaw and the freeze extra-metas accounts.
pub fn write_both<'info>(
    policy: &GatePolicy,
    thaw_extra_metas: &AccountInfo<'info>,
    freeze_extra_metas: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let list = extra_metas(policy)?;
    write(Variant::Thaw, thaw_extra_metas, &policy.mint, payer, system_program, &list)?;
    write(Variant::Freeze, freeze_extra_metas, &policy.mint, payer, system_program, &list)
}

#[derive(Clone, Copy)]
pub enum Variant {
    Thaw,
    Freeze,
}

impl Variant {
    pub fn seed(self) -> &'static [u8] {
        match self {
            Variant::Thaw => THAW_EXTRA_ACCOUNT_METAS_SEED,
            Variant::Freeze => FREEZE_EXTRA_ACCOUNT_METAS_SEED,
        }
    }
}

/// Creates or resizes the extra-metas PDA `[variant seed, mint]` and writes `metas` into it.
/// Keeps it exactly rent-exempt: the payer tops it up, or gets the surplus back when it shrinks.
pub fn write<'info>(
    variant: Variant,
    extra_metas: &AccountInfo<'info>,
    mint: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    metas: &[ExtraAccountMeta],
) -> Result<()> {
    let (expected, bump) = Pubkey::find_program_address(&[variant.seed(), mint.as_ref()], &crate::ID);
    require_keys_eq!(expected, extra_metas.key(), GateError::InvalidExtraMetasAccount);

    let len = ExtraAccountMetaList::size_of(metas.len())?;
    let rent = Rent::get()?.minimum_balance(len);
    let current = extra_metas.lamports();

    if extra_metas.owner == &crate::ID {
        extra_metas.resize(len)?;
        if current > rent {
            **extra_metas.try_borrow_mut_lamports()? = rent;
            **payer.try_borrow_mut_lamports()? += current - rent;
        }
    } else {
        // allocate + assign instead of create_account: someone may have sent lamports to the PDA already.
        let bump_seed = [bump];
        let signer: &[&[&[u8]]] = &[&[variant.seed(), mint.as_ref(), &bump_seed]];
        system_program::allocate(
            CpiContext::new_with_signer(
                system_program.clone(),
                system_program::Allocate { account_to_allocate: extra_metas.clone() },
                signer,
            ),
            len as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                system_program.clone(),
                system_program::Assign { account_to_assign: extra_metas.clone() },
                signer,
            ),
            &crate::ID,
        )?;
    }
    if current < rent {
        system_program::transfer(
            CpiContext::new(system_program.clone(), system_program::Transfer { from: payer.clone(), to: extra_metas.clone() }),
            rent - current,
        )?;
    }

    let mut data = extra_metas.try_borrow_mut_data()?;
    data.fill(0);
    match variant {
        Variant::Thaw => ExtraAccountMetaList::init::<CanThawPermissionless>(&mut data, metas)?,
        Variant::Freeze => ExtraAccountMetaList::init::<CanFreezePermissionless>(&mut data, metas)?,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::POLICY_VERSION;

    fn policy(check_blacklist: bool, allowlist_mode: AllowlistMode, require_sas: bool) -> GatePolicy {
        GatePolicy {
            version: POLICY_VERSION,
            bump: 255,
            mint: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
            issuer_program: sss_token::ID,
            check_blacklist,
            allowlist_mode,
            require_sas,
            sas_credential: Pubkey::new_unique(),
            sas_schema: Pubkey::new_unique(),
            min_kyc_level: 0,
            reserved: [0; 64],
        }
    }

    /// Resolves the policy's metas the way Token ACL does (spl-tlv `ExtraAccountMeta::resolve`): the gate
    /// instruction's account keys, base accounts first.
    fn resolve(p: &GatePolicy, owner: Pubkey) -> Vec<Pubkey> {
        let mut keys = vec![Pubkey::new_unique(), Pubkey::new_unique(), p.mint, owner, Pubkey::new_unique(), Pubkey::new_unique()];
        for meta in extra_metas(p).unwrap() {
            let resolved = {
                let lookup = |i: usize| keys.get(i).map(|k| (k, None));
                meta.resolve(&[], &crate::ID, lookup).unwrap().pubkey
            };
            keys.push(resolved);
        }
        keys
    }

    #[test]
    fn layout_places_only_enabled_accounts() {
        use AllowlistMode::*;
        let l = |b, a| Layout::of(b, a, false);
        assert_eq!(l(false, Off), Layout { issuer: None, blacklist: None, allowlist: None, sas: None, len: 7 });
        assert_eq!(l(true, Off), Layout { issuer: Some(7), blacklist: Some(8), allowlist: None, sas: None, len: 9 });
        assert_eq!(l(false, AllowOnly), Layout { issuer: Some(7), blacklist: None, allowlist: Some(8), sas: None, len: 9 });
        assert_eq!(l(true, AllowOnly), Layout { issuer: Some(7), blacklist: Some(8), allowlist: Some(9), sas: None, len: 10 });
        assert_eq!(l(true, BypassForPdas), l(true, AllowOnly));
        // The SAS group goes last, so the S4 indices don't move.
        assert_eq!(Layout::of(false, Off, true), Layout { issuer: None, blacklist: None, allowlist: None, sas: Some(7), len: 11 });
        let full = Layout::of(true, BypassForPdas, true);
        assert_eq!(full, Layout { issuer: Some(7), blacklist: Some(8), allowlist: Some(9), sas: Some(10), len: 14 });
        assert_eq!(full.attestation(), Some(13));
        for (b, a, s) in [(false, Off, false), (true, Off, false), (false, AllowOnly, false), (true, AllowOnly, false), (false, Off, true), (true, BypassForPdas, true)] {
            let p = policy(b, a, s);
            assert_eq!(POLICY_INDEX + extra_metas(&p).unwrap().len(), Layout::for_policy(&p).len);
        }
    }

    /// The metas land on this program's policy PDA and on sss-token's real registry PDAs (its own seeds and
    /// program ID).
    #[test]
    fn metas_resolve_to_sss_token_registry_pdas() {
        let p = policy(true, AllowlistMode::AllowOnly, false);
        let (mint, owner) = (p.mint, Pubkey::new_unique());
        let keys = resolve(&p, owner);
        let layout = Layout::for_policy(&p);
        let sss = |seed: &[u8]| Pubkey::find_program_address(&[seed, mint.as_ref(), owner.as_ref()], &sss_token::ID).0;
        assert_eq!(keys[POLICY_INDEX], Pubkey::find_program_address(&[POLICY_SEED, mint.as_ref()], &crate::ID).0);
        assert_eq!(keys[layout.issuer.unwrap()], sss_token::ID);
        assert_eq!(keys[layout.blacklist.unwrap()], sss(sss_token::constants::SEED_BLACKLIST));
        assert_eq!(keys[layout.allowlist.unwrap()], sss(sss_token::constants::SEED_ALLOWLIST));
    }

    /// The attestation meta lands on SAS's attestation PDA with nonce = the owner (the same derivation as SAS's
    /// `create_attestation` and sas-lib's `deriveAttestationPda`).
    #[test]
    fn metas_resolve_to_the_sas_attestation_pda() {
        let p = policy(true, AllowlistMode::BypassForPdas, true);
        let owner = Pubkey::new_unique();
        let keys = resolve(&p, owner);
        let layout = Layout::for_policy(&p);
        let sas = layout.sas.unwrap();
        assert_eq!(keys[sas], SAS_ID);
        assert_eq!(keys[sas + SAS_CREDENTIAL_OFFSET], p.sas_credential);
        assert_eq!(keys[sas + SAS_SCHEMA_OFFSET], p.sas_schema);
        let expected = Pubkey::find_program_address(
            &[ATTESTATION_SEED, p.sas_credential.as_ref(), p.sas_schema.as_ref(), owner.as_ref()],
            &SAS_ID,
        )
        .0;
        assert_eq!(keys[layout.attestation().unwrap()], expected);
        assert_eq!(keys.len(), layout.len);
    }
}
