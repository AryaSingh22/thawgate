//! Token ACL (sRFC 37) constants and instruction builders for the CPIs sss-token makes, vendored.
//!
//! No `token-acl-interface` dependency: it pulls `solana-pubkey` ^4, which conflicts with Anchor 0.32's solana 2.x
//! crates. Account orders and data follow the Token ACL client the gate suite runs against the devnet build
//! (@token-acl/sdk 0.2.7, generated from the program's IDL). The shared constants are pinned against
//! programs/thawgate-gate/src/token_acl.rs by that crate's tests.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::system_program;
use anchor_spl::token_2022;

/// Token ACL program.
pub const TOKEN_ACL_ID: Pubkey = pubkey!("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");

/// MintConfig PDA (owned by Token ACL): `["MINT_CONFIG", mint]`. Once Token ACL manages a mint, this PDA is the
/// mint's Token-2022 freeze authority.
pub const MINT_CONFIG_SEED: &[u8] = b"MINT_CONFIG";

/// Instruction discriminators (one byte).
pub const IX_CREATE_CONFIG: u8 = 0;
pub const IX_THAW: u8 = 4;
pub const IX_FREEZE: u8 = 5;
pub const IX_TOGGLE_PERMISSIONLESS_INSTRUCTIONS: u8 = 8;

/// `create_config`: puts `mint` under Token ACL with `gating_program` as its gate. `authority` is the mint's
/// current freeze authority; it becomes `MintConfig.freeze_authority`, and the Token-2022 freeze authority moves
/// to the MintConfig PDA. The mint must have DefaultAccountState.
/// Accounts: payer (w, s), authority (s), mint (w), mint_config (w), system_program, token_program.
pub fn create_config(payer: &Pubkey, authority: &Pubkey, mint: &Pubkey, mint_config: &Pubkey, gating_program: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(33);
    data.push(IX_CREATE_CONFIG);
    data.extend_from_slice(gating_program.as_ref());
    Instruction {
        program_id: TOKEN_ACL_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*mint, false),
            AccountMeta::new(*mint_config, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(token_2022::ID, false),
        ],
        data,
    }
}

/// `toggle_permissionless_instructions`: turns permissionless freeze and thaw on or off.
/// Accounts: authority (s), mint_config (w). Data: freeze_enabled, then thaw_enabled.
pub fn toggle_permissionless_instructions(authority: &Pubkey, mint_config: &Pubkey, freeze_enabled: bool, thaw_enabled: bool) -> Instruction {
    Instruction {
        program_id: TOKEN_ACL_ID,
        accounts: vec![AccountMeta::new_readonly(*authority, true), AccountMeta::new(*mint_config, false)],
        data: vec![IX_TOGGLE_PERMISSIONLESS_INSTRUCTIONS, freeze_enabled as u8, thaw_enabled as u8],
    }
}

/// Permissioned `thaw` (4) or `freeze` (5) by `MintConfig.freeze_authority`; the gate is not called.
/// Accounts: authority (s), mint, token_account (w), mint_config, token_program.
fn thaw_or_freeze(discriminator: u8, authority: &Pubkey, mint: &Pubkey, token_account: &Pubkey, mint_config: &Pubkey) -> Instruction {
    Instruction {
        program_id: TOKEN_ACL_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*token_account, false),
            AccountMeta::new_readonly(*mint_config, false),
            AccountMeta::new_readonly(token_2022::ID, false),
        ],
        data: vec![discriminator],
    }
}

pub fn thaw(authority: &Pubkey, mint: &Pubkey, token_account: &Pubkey, mint_config: &Pubkey) -> Instruction {
    thaw_or_freeze(IX_THAW, authority, mint, token_account, mint_config)
}

pub fn freeze(authority: &Pubkey, mint: &Pubkey, token_account: &Pubkey, mint_config: &Pubkey) -> Instruction {
    thaw_or_freeze(IX_FREEZE, authority, mint, token_account, mint_config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instruction_layouts() {
        let (payer, authority, mint, mint_config, gate, account) =
            (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());

        let ix = create_config(&payer, &authority, &mint, &mint_config, &gate);
        assert_eq!(ix.data[0], 0);
        assert_eq!(&ix.data[1..], gate.as_ref());
        assert_eq!(ix.accounts.len(), 6);
        assert!(ix.accounts[0].is_signer && ix.accounts[0].is_writable);
        assert!(ix.accounts[1].is_signer && !ix.accounts[1].is_writable);

        let ix = toggle_permissionless_instructions(&authority, &mint_config, true, false);
        assert_eq!(ix.data, vec![8, 1, 0]);

        let (t, f) = (thaw(&authority, &mint, &account, &mint_config), freeze(&authority, &mint, &account, &mint_config));
        assert_eq!((t.data, f.data), (vec![4], vec![5]));
        assert_eq!(t.accounts[2].pubkey, account);
        assert!(t.accounts[2].is_writable && t.accounts[0].is_signer);
    }
}
