//! The issuer registry the gate reads: sss-token's `BlacklistEntry` and `AllowlistEntry` accounts.
//!
//! Token ACL resolves each entry's address from the gate's extra-metas list, so the account the gate sees is
//! the canonical PDA. An empty account there means "no entry". A non-empty one must be owned by the policy's
//! issuer program, carry the right Anchor discriminator and name this mint and wallet.

use anchor_lang::prelude::*;

use crate::errors::GateError;

/// sss-token seeds: `["blacklist", mint, wallet]` and `["allowlist", mint, wallet]`.
pub const SEED_BLACKLIST: &[u8] = b"blacklist";
pub const SEED_ALLOWLIST: &[u8] = b"allowlist";

/// Anchor account discriminators, sha256("account:<Name>")[..8]; pinned against sss-token in the tests.
pub const BLACKLIST_ENTRY_DISCRIMINATOR: [u8; 8] = [218, 179, 231, 40, 141, 25, 168, 189];
pub const ALLOWLIST_ENTRY_DISCRIMINATOR: [u8; 8] = [42, 59, 88, 1, 124, 138, 92, 236];

/// Mirror of sss-token's `BlacklistEntry` (programs/sss-token/src/state/blacklist_entry.rs); same as the
/// transfer hook's mirror. `active` sits after the variable-length `reason`, so it is Borsh-decoded.
#[derive(AnchorDeserialize)]
struct BlacklistEntryMirror {
    mint: Pubkey,
    target: Pubkey,
    _reason: String,
    _added_at: i64,
    _added_by: Pubkey,
    active: bool,
    _bump: u8,
}

/// Mirror of sss-token's `AllowlistEntry` (programs/sss-token/src/state/allowlist_entry.rs).
#[derive(AnchorDeserialize)]
struct AllowlistEntryMirror {
    mint: Pubkey,
    wallet: Pubkey,
    _added_at: i64,
    active: bool,
    _bump: u8,
}

/// What the registry says about one wallet.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Entry {
    None,
    Inactive,
    Active,
}

pub fn read_blacklist(info: &AccountInfo, issuer: &Pubkey, mint: &Pubkey, wallet: &Pubkey) -> Result<Entry> {
    if info.data_is_empty() {
        return Ok(Entry::None);
    }
    require_keys_eq!(*info.owner, *issuer, GateError::DeniedBadRegistryEntry);
    parse_blacklist(&info.try_borrow_data()?, mint, wallet)
}

pub fn read_allowlist(info: &AccountInfo, issuer: &Pubkey, mint: &Pubkey, wallet: &Pubkey) -> Result<Entry> {
    if info.data_is_empty() {
        return Ok(Entry::None);
    }
    require_keys_eq!(*info.owner, *issuer, GateError::DeniedBadRegistryEntry);
    parse_allowlist(&info.try_borrow_data()?, mint, wallet)
}

fn parse_blacklist(data: &[u8], mint: &Pubkey, wallet: &Pubkey) -> Result<Entry> {
    require!(data.starts_with(&BLACKLIST_ENTRY_DISCRIMINATOR), GateError::DeniedBadRegistryEntry);
    let e = BlacklistEntryMirror::deserialize(&mut &data[8..]).map_err(|_| error!(GateError::DeniedBadRegistryEntry))?;
    require!(e.mint == *mint && e.target == *wallet, GateError::DeniedBadRegistryEntry);
    Ok(if e.active { Entry::Active } else { Entry::Inactive })
}

fn parse_allowlist(data: &[u8], mint: &Pubkey, wallet: &Pubkey) -> Result<Entry> {
    require!(data.starts_with(&ALLOWLIST_ENTRY_DISCRIMINATOR), GateError::DeniedBadRegistryEntry);
    let e = AllowlistEntryMirror::deserialize(&mut &data[8..]).map_err(|_| error!(GateError::DeniedBadRegistryEntry))?;
    require!(e.mint == *mint && e.wallet == *wallet, GateError::DeniedBadRegistryEntry);
    Ok(if e.active { Entry::Active } else { Entry::Inactive })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::{AccountSerialize, Discriminator};
    use sss_token::state::{allowlist_entry::AllowlistEntry, blacklist_entry::BlacklistEntry};

    fn blacklist_bytes(mint: Pubkey, target: Pubkey, active: bool) -> Vec<u8> {
        let entry = BlacklistEntry {
            mint,
            target,
            reason: "sanctions list match".into(),
            added_at: 1_760_000_000,
            added_by: Pubkey::new_unique(),
            active,
            bump: 254,
        };
        let mut out = Vec::new();
        entry.try_serialize(&mut out).unwrap();
        out
    }

    #[test]
    fn discriminators_match_sss_token() {
        assert_eq!(BLACKLIST_ENTRY_DISCRIMINATOR, BlacklistEntry::DISCRIMINATOR);
        assert_eq!(ALLOWLIST_ENTRY_DISCRIMINATOR, AllowlistEntry::DISCRIMINATOR);
        assert_eq!(SEED_BLACKLIST, sss_token::constants::SEED_BLACKLIST);
        assert_eq!(SEED_ALLOWLIST, sss_token::constants::SEED_ALLOWLIST);
    }

    /// Layout drift: bytes written by sss-token's real structs decode with the mirrors.
    #[test]
    fn mirrors_decode_sss_token_entries() {
        let (mint, wallet) = (Pubkey::new_unique(), Pubkey::new_unique());
        assert_eq!(parse_blacklist(&blacklist_bytes(mint, wallet, true), &mint, &wallet).unwrap(), Entry::Active);
        assert_eq!(parse_blacklist(&blacklist_bytes(mint, wallet, false), &mint, &wallet).unwrap(), Entry::Inactive);

        let allow = AllowlistEntry { mint, wallet, added_at: 1_760_000_000, active: true, bump: 253 };
        let mut bytes = Vec::new();
        allow.try_serialize(&mut bytes).unwrap();
        assert_eq!(parse_allowlist(&bytes, &mint, &wallet).unwrap(), Entry::Active);
    }

    #[test]
    fn rejects_entries_for_another_mint_wallet_or_type() {
        let (mint, wallet) = (Pubkey::new_unique(), Pubkey::new_unique());
        let other = Pubkey::new_unique();
        let bytes = blacklist_bytes(mint, wallet, true);
        assert!(parse_blacklist(&bytes, &other, &wallet).is_err());
        assert!(parse_blacklist(&bytes, &mint, &other).is_err());
        // A blacklist entry is not an allowlist entry.
        assert!(parse_allowlist(&bytes, &mint, &wallet).is_err());
    }
}
