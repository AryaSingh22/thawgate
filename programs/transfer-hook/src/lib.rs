//! # Transfer Hook — Solana Stablecoin Standard Compliance Hook
//!
//! This program implements the `spl-transfer-hook-interface` to provide
//! real-time compliance checks during Token-2022 transfers.
//!
//! ## Checks performed on every transfer:
//! 1. **Pause state**: If the token is paused, the transfer is rejected
//! 2. **Source blacklist**: If the sender wallet is blacklisted, the transfer is rejected
//! 3. **Destination blacklist**: If the recipient wallet is blacklisted, the transfer is rejected
//!
//! ## PDA Derivation
//! The hook reads PDAs created by the main sss-token program using shared seeds:
//! - PauseState: `[b"pause_state", mint.key()]`
//! - BlacklistEntry: `[b"blacklist", mint.key(), wallet_authority.key()]`
//!
//! **Important:** The blacklist check uses the wallet authority (owner) key, NOT the
//! token account key. For the source, this is account index 3. For the destination,
//! the owner is extracted from the token account data (bytes 32..64).

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub mod errors;
pub mod execute;

use errors::TransferHookError;
use execute::*;

declare_id!("2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv");

/// The SPL transfer-hook `Execute` discriminator, which Token-2022 sends on every transfer. A plain constant for
/// `#[instruction(discriminator = …)]`: the Anchor macro evaluates the expression where `SplDiscriminate` is not
/// in scope.
pub const EXECUTE_DISCRIMINATOR: &[u8] = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE;

/// Accounts for initializing the extra account meta list.
///
/// This instruction registers the additional accounts that the hook program
/// needs to receive during transfer execution (pause state + blacklist PDAs).
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// The payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The extra account meta list PDA.
    /// CHECK: Created and initialized by the hook.
    #[account(mut)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The Token-2022 mint this hook is attached to.
    /// CHECK: We only read the key for PDA derivation.
    pub mint: UncheckedAccount<'info>,

    /// The SSS-Token program that owns the compliance PDAs. Pinned: anyone may create a mint's meta list, and
    /// a list naming another program would point every pause and blacklist lookup at accounts that never exist.
    /// CHECK: address constraint.
    #[account(address = SSS_TOKEN_PROGRAM_ID @ TransferHookError::InvalidSssTokenProgram)]
    pub sss_token_program: UncheckedAccount<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// The transfer hook program.
#[program]
pub mod transfer_hook {
    use super::*;

    /// Initializes the extra account meta list for the transfer hook.
    ///
    /// Registers the pause state and blacklist entry accounts that the hook
    /// needs during transfer execution. Must be called after the mint is
    /// initialized with the transfer hook extension.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        let sss_program_id = ctx.accounts.sss_token_program.key();

        // Define the extra accounts the hook needs:
        // 1. PauseState PDA (from sss-token program)
        // 2. Source wallet's BlacklistEntry PDA (from sss-token program)
        // 3. Destination wallet's BlacklistEntry PDA (from sss-token program)
        // 4. SSS Token Program (needed for external PDA derivation)

        let extra_metas: Vec<ExtraAccountMeta> = vec![
            // SSS Token Program account (needed as a known program for external PDAs)
            ExtraAccountMeta::new_with_pubkey(&sss_program_id, false, false)?,
            // PauseState: seeds = [b"pause_state", mint.key()] on sss-token program
            ExtraAccountMeta::new_external_pda_with_seeds(
                5, // index of sss_token_program in the resolved extra accounts
                &[
                    Seed::Literal {
                        bytes: execute::SEED_PAUSE.to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint account (standard position)
                ],
                false, // is_signer
                false, // is_writable
            )?,
            // Source BlacklistEntry: seeds = [b"blacklist", mint.key(), source_authority.key()]
            // index 3 = the source token account's owner/authority (standard transfer hook position)
            ExtraAccountMeta::new_external_pda_with_seeds(
                5, // sss_token_program index
                &[
                    Seed::Literal {
                        bytes: execute::SEED_BLACKLIST.to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint
                    Seed::AccountKey { index: 3 }, // source owner/authority
                ],
                false,
                false,
            )?,
            // Destination BlacklistEntry: seeds = [b"blacklist", mint.key(), dest_authority.key()]
            // CRITICAL-1 FIX: Use the destination token account's OWNER (bytes 32..64 of
            // the token account data at index 2) instead of the token account key itself.
            // Token-2022 account layout: [mint(32) | owner(32) | amount(8) | ...]
            // Using the account key of the destination (index 2) directly would check
            // the token account address, NOT the wallet — allowing a blacklisted wallet
            // to receive tokens through a fresh token account whose address is not
            // blacklisted.
            ExtraAccountMeta::new_external_pda_with_seeds(
                5, // sss_token_program index
                &[
                    Seed::Literal {
                        bytes: execute::SEED_BLACKLIST.to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint
                    Seed::AccountData { account_index: 2, data_index: 32, length: 32 }, // destination owner/authority from token account data
                ],
                false,
                false,
            )?,
        ];

        // Calculate space for the extra account meta list
        let account_size = ExtraAccountMetaList::size_of(extra_metas.len())?;

        // Create the extra account meta list account
        let lamports = Rent::get()?.minimum_balance(account_size);
        let meta_list_info = ctx.accounts.extra_account_meta_list.to_account_info();

        // Derive PDA for the extra account meta list
        let (expected_key, bump) = Pubkey::find_program_address(
            &[b"extra-account-metas", mint_key.as_ref()],
            ctx.program_id,
        );

        // Verify the provided account matches the expected PDA
        require_keys_eq!(meta_list_info.key(), expected_key);

        let signer_seeds: &[&[u8]] = &[b"extra-account-metas", mint_key.as_ref(), &[bump]];

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: meta_list_info.clone(),
                },
                &[signer_seeds],
            ),
            lamports,
            account_size as u64,
            ctx.program_id,
        )?;

        // Initialize the extra account meta list data
        let mut data = meta_list_info.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_metas)?;

        Ok(())
    }

    /// Transfer hook execute handler — called by Token-2022 on every transfer.
    ///
    /// Validates pause state and blacklist compliance.
    #[instruction(discriminator = crate::EXECUTE_DISCRIMINATOR)]
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        execute::handler(ctx, amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    /// Token-2022 invokes the hook with the SPL discriminator; with Anchor's default one the call would hit
    /// `InstructionFallbackNotFound`.
    #[test]
    fn execute_answers_the_spl_discriminator() {
        // sha256("spl-transfer-hook-interface:execute")[..8]
        assert_eq!(EXECUTE_DISCRIMINATOR, &[105, 37, 101, 197, 75, 251, 102, 26]);
        assert_eq!(instruction::Execute::DISCRIMINATOR, EXECUTE_DISCRIMINATOR);
    }
}
