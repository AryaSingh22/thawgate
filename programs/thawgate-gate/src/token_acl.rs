//! Token ACL (sRFC 37) constants and account readers, vendored.
//!
//! The `token-acl-interface` crate is not a dependency: it pulls `solana-pubkey` ^4, which conflicts with
//! Anchor 0.32's solana 2.x crates. Values come from the Token ACL source (interface/src/lib.rs,
//! interface/src/instruction.rs, program/src/state.rs) and are pinned by the tests below.

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;

use crate::errors::GateError;

/// Token ACL program.
pub const TOKEN_ACL_ID: Pubkey = pubkey!("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");

/// Extra-metas PDAs (owned by the gate): `[seed, mint]`.
pub const THAW_EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"thaw_extra_account_metas";
pub const FREEZE_EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"freeze_extra_account_metas";

/// MintConfig PDA (owned by Token ACL): `["MINT_CONFIG", mint]`.
pub const MINT_CONFIG_SEED: &[u8] = b"MINT_CONFIG";

/// `can_thaw_permissionless`: instruction discriminator and TLV type of the thaw extra-metas list.
#[derive(SplDiscriminate)]
#[discriminator_hash_input("efficient-allow-block-list-standard:can-thaw-permissionless")]
pub struct CanThawPermissionless;

/// `can_freeze_permissionless`: instruction discriminator and TLV type of the freeze extra-metas list.
#[derive(SplDiscriminate)]
#[discriminator_hash_input("efficient-allow-block-list-standard:can-freeze-permissionless")]
pub struct CanFreezePermissionless;

/// The same discriminators as plain constants, for `#[instruction(discriminator = …)]` (the Anchor macro
/// evaluates the expression where the `SplDiscriminate` trait is not in scope).
pub const CAN_THAW_DISCRIMINATOR: &[u8] = CanThawPermissionless::SPL_DISCRIMINATOR_SLICE;
pub const CAN_FREEZE_DISCRIMINATOR: &[u8] = CanFreezePermissionless::SPL_DISCRIMINATOR_SLICE;

/// MintConfig account: 100 bytes.
/// `[0] discriminator = 1 | [1] bump | [2] thaw enabled | [3] freeze enabled | [4..36] mint |
///  [36..68] freeze_authority | [68..100] gating_program`
pub const MINT_CONFIG_LEN: usize = 100;
const MINT_CONFIG_DISCRIMINATOR: u8 = 1;

/// The MintConfig fields the gate uses.
pub struct MintConfig {
    pub mint: Pubkey,
    pub freeze_authority: Pubkey,
    pub gating_program: Pubkey,
}

/// Reads a MintConfig: owned by Token ACL, 100 bytes, discriminator 1.
pub fn read_mint_config(info: &AccountInfo) -> Result<MintConfig> {
    require_keys_eq!(*info.owner, TOKEN_ACL_ID, GateError::InvalidMintConfig);
    let data = info.try_borrow_data()?;
    parse_mint_config(&data)
}

fn parse_mint_config(data: &[u8]) -> Result<MintConfig> {
    require!(
        data.len() == MINT_CONFIG_LEN && data[0] == MINT_CONFIG_DISCRIMINATOR,
        GateError::InvalidMintConfig
    );
    let key = |at: usize| Pubkey::new_from_array(data[at..at + 32].try_into().unwrap());
    Ok(MintConfig { mint: key(4), freeze_authority: key(36), gating_program: key(68) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminators_match_token_acl() {
        // RESEARCH.md §1.2; also sha256 of the hash inputs above, first 8 bytes.
        assert_eq!(CanThawPermissionless::SPL_DISCRIMINATOR_SLICE, &[8, 175, 169, 129, 137, 74, 61, 241]);
        assert_eq!(CanFreezePermissionless::SPL_DISCRIMINATOR_SLICE, &[214, 141, 109, 75, 248, 1, 45, 29]);
    }

    #[test]
    fn parses_mint_config() {
        let (mint, authority, gate) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let mut data = vec![0u8; MINT_CONFIG_LEN];
        data[0] = 1;
        data[4..36].copy_from_slice(mint.as_ref());
        data[36..68].copy_from_slice(authority.as_ref());
        data[68..100].copy_from_slice(gate.as_ref());
        let config = parse_mint_config(&data).unwrap();
        assert_eq!((config.mint, config.freeze_authority, config.gating_program), (mint, authority, gate));

        data[0] = 0;
        assert!(parse_mint_config(&data).is_err());
        assert!(parse_mint_config(&data[..99]).is_err());
    }
}
