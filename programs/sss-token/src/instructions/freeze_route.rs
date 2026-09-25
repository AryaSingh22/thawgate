//! Freeze and thaw through whoever holds the mint's freeze authority (S6).
//!
//! Until Token ACL manages a mint (every Hook-mode mint, and an Acl/Both mint before `enable_token_acl`), the
//! config PDA is its Token-2022 freeze authority and freezes directly. Afterwards the Token ACL MintConfig PDA is,
//! and the config PDA, as `MintConfig.freeze_authority`, uses Token ACL's permissioned `freeze` / `thaw`. Routing
//! on the mint's actual authority, not on `compliance_mode`, also covers a later Token ACL `delete_config`, which
//! hands the authority back.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::Mint;

use crate::errors::SssError;
use crate::token_acl;

/// The accounts a freeze or thaw needs, whichever way it goes.
pub struct FreezeRoute<'a, 'info> {
    /// The config PDA (signs through `signer_seeds`).
    pub config: &'a AccountInfo<'info>,
    pub mint: &'a InterfaceAccount<'info, Mint>,
    pub token_account: &'a AccountInfo<'info>,
    /// The mint's Token ACL MintConfig PDA (checked by the caller's account constraints).
    pub mint_config: &'a AccountInfo<'info>,
    pub token_acl_program: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Freeze,
    Thaw,
}

pub fn freeze(route: &FreezeRoute, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    run(route, Op::Freeze, signer_seeds)
}

pub fn thaw(route: &FreezeRoute, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    run(route, Op::Thaw, signer_seeds)
}

fn run(r: &FreezeRoute, op: Op, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let authority: Option<Pubkey> = r.mint.freeze_authority.into();
    match authority {
        Some(key) if key == r.config.key() => match op {
            Op::Freeze => anchor_spl::token_2022::freeze_account(CpiContext::new_with_signer(
                r.token_program.clone(),
                anchor_spl::token_2022::FreezeAccount {
                    account: r.token_account.clone(),
                    mint: r.mint.to_account_info(),
                    authority: r.config.clone(),
                },
                signer_seeds,
            )),
            Op::Thaw => anchor_spl::token_2022::thaw_account(CpiContext::new_with_signer(
                r.token_program.clone(),
                anchor_spl::token_2022::ThawAccount {
                    account: r.token_account.clone(),
                    mint: r.mint.to_account_info(),
                    authority: r.config.clone(),
                },
                signer_seeds,
            )),
        },
        Some(key) if key == r.mint_config.key() => {
            let (config, mint, account, mint_config) = (r.config.key, &r.mint.key(), r.token_account.key, r.mint_config.key);
            let ix = match op {
                Op::Freeze => token_acl::freeze(config, mint, account, mint_config),
                Op::Thaw => token_acl::thaw(config, mint, account, mint_config),
            };
            invoke_signed(
                &ix,
                &[
                    r.config.clone(),
                    r.mint.to_account_info(),
                    r.token_account.clone(),
                    r.mint_config.clone(),
                    r.token_program.clone(),
                    r.token_acl_program.clone(),
                ],
                signer_seeds,
            )?;
            Ok(())
        }
        _ => err!(SssError::UnknownFreezeAuthority),
    }
}
