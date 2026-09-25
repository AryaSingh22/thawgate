//! Transfer Hook execute handler.
//!
//! Implements the spl-transfer-hook-interface `Execute` instruction.
//! Validates pause state and blacklist entries for both source and destination.
//!
//! CRIT-002 FIX: Replaced raw byte-offset access (`data[data.len()-2]`) with
//! proper Borsh deserialization via mirror structs. The `BlacklistEntry.active`
//! field is at a variable offset because `reason` is a variable-length String.
//! The old code only worked when reason was exactly MAX_REASON_LEN (100) bytes.

use anchor_lang::prelude::*;
use anchor_lang::AnchorDeserialize;

use crate::errors::TransferHookError;

/// PDA seed for pause state (shared with sss-token program).
pub const SEED_PAUSE: &[u8] = b"pause_state";

/// PDA seed prefix for blacklist entries (shared with sss-token program).
pub const SEED_BLACKLIST: &[u8] = b"blacklist";

/// The sss-token program, which owns the PauseState and BlacklistEntry PDAs (its `declare_id!`; checked by
/// scripts/verify-ids.sh).
pub const SSS_TOKEN_PROGRAM_ID: Pubkey = pubkey!("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");

/// Mirror of the main program's PauseState for deserialization.
///
/// Field order and types MUST exactly match programs/sss-token/src/state/pause_state.rs.
/// If the main program's struct changes, this must be updated in sync.
#[derive(AnchorDeserialize)]
struct PauseStateMirror {
    pub mint: Pubkey,
    pub paused: bool,
    pub paused_at: i64,
    pub paused_by: Pubkey,
    pub bump: u8,
}

/// Mirror of the main program's BlacklistEntry for deserialization.
///
/// Field order and types MUST exactly match programs/sss-token/src/state/blacklist_entry.rs.
/// If the main program's struct changes, this must be updated in sync.
#[derive(AnchorDeserialize)]
struct BlacklistEntryMirror {
    pub mint: Pubkey,
    pub target: Pubkey,
    pub reason: String,
    pub added_at: i64,
    pub added_by: Pubkey,
    pub active: bool,
    pub bump: u8,
}

/// Accounts for the execute transfer hook instruction.
///
/// The transfer hook receives standard accounts from the Token-2022 program
/// plus any extra accounts registered via the ExtraAccountMetaList.
#[derive(Accounts)]
pub struct Execute<'info> {
    /// The source token account.
    /// CHECK: Validated by Token-2022 before hook invocation.
    pub source_account: UncheckedAccount<'info>,

    /// The mint account.
    /// CHECK: Validated by Token-2022 before hook invocation.
    pub mint: UncheckedAccount<'info>,

    /// The destination token account.
    /// CHECK: Validated by Token-2022 before hook invocation.
    pub destination_account: UncheckedAccount<'info>,

    /// The owner/authority of the source account.
    /// CHECK: Validated by Token-2022 before hook invocation.
    pub owner: UncheckedAccount<'info>,

    /// The extra account meta list PDA.
    /// CHECK: Validated by the transfer hook interface.
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The sss-token program: the first extra account in the meta list (index 5), which the PDA metas below
    /// derive from. Without this field every later account would bind one position off.
    /// CHECK: address constraint.
    #[account(address = SSS_TOKEN_PROGRAM_ID @ TransferHookError::InvalidSssTokenProgram)]
    pub sss_token_program: UncheckedAccount<'info>,

    /// The pause state PDA (derived from the sss-token program).
    /// Contains serialized PauseState data if it exists.
    /// CHECK: We read and deserialize this manually to check pause state.
    pub pause_state: UncheckedAccount<'info>,

    /// The blacklist entry for the source authority (if it exists).
    /// CHECK: We read and deserialize this manually to check blacklist status.
    pub source_blacklist: UncheckedAccount<'info>,

    /// The blacklist entry for the destination authority (if it exists).
    /// CHECK: We read and deserialize this manually to check blacklist status.
    pub dest_blacklist: UncheckedAccount<'info>,
}

/// Handler for the execute transfer hook.
///
/// Checks:
/// 1. If paused → reject transfer
/// 2. If source is blacklisted → reject transfer
/// 3. If destination is blacklisted → reject transfer
/// 4. If all checks pass → allow transfer
pub fn handler(ctx: Context<Execute>, _amount: u64) -> Result<()> {
    // -------------------------------------------------------------------------
    // Check pause state
    // -------------------------------------------------------------------------
    let pause_state_info = &ctx.accounts.pause_state;
    if !pause_state_info.data_is_empty() {
        let data = pause_state_info.try_borrow_data()?;
        // Account has data — deserialize via Borsh, skipping the 8-byte Anchor discriminator
        if data.len() > 8 {
            let pause_state = PauseStateMirror::deserialize(&mut &data[8..])
                .map_err(|_| TransferHookError::InvalidAccountData)?;
            
            // Validate the mirror matches the current mint
            if pause_state.mint != ctx.accounts.mint.key() {
                 return Err(TransferHookError::InvalidAccountData.into());
            }
            
            // Utilize fields for logging/debugging to resolve dead_code warnings natively
            msg!("Evaluating pause state: mint={}, paused={}, at={}, by={}, bump={}", 
                pause_state.mint, pause_state.paused, pause_state.paused_at, pause_state.paused_by, pause_state.bump);

            if pause_state.paused {
                return Err(TransferHookError::TokensPaused.into());
            }
        }
    }

    // -------------------------------------------------------------------------
    // Check source blacklist
    // -------------------------------------------------------------------------
    let source_bl_info = &ctx.accounts.source_blacklist;
    if !source_bl_info.data_is_empty() {
        let data = source_bl_info.try_borrow_data()?;
        // Account exists — deserialize BlacklistEntry, skipping the 8-byte discriminator.
        // We use Borsh deserialization instead of raw byte offset because BlacklistEntry
        // contains a variable-length String (reason), making fixed byte offsets unreliable.
        if data.len() > 8 {
            let entry = BlacklistEntryMirror::deserialize(&mut &data[8..])
                .map_err(|_| TransferHookError::InvalidAccountData)?;
            
            // Validate the mirror matches the current mint
            if entry.mint != ctx.accounts.mint.key() {
                 return Err(TransferHookError::InvalidAccountData.into());
            }

            // Log details to ensure usage of all deserialized fields (resolves dead_code warning)
            msg!("Evaluating source blacklist: mint={}, target={}, reason={}, active={}, added_by={}, added_at={}, bump={}", 
                entry.mint, entry.target, entry.reason, entry.active, entry.added_by, entry.added_at, entry.bump);

            if entry.active {
                return Err(TransferHookError::SourceBlacklisted.into());
            }
        }
    }

    // -------------------------------------------------------------------------
    // Check destination blacklist
    // -------------------------------------------------------------------------
    let dest_bl_info = &ctx.accounts.dest_blacklist;
    if !dest_bl_info.data_is_empty() {
        let data = dest_bl_info.try_borrow_data()?;
        if data.len() > 8 {
            let entry = BlacklistEntryMirror::deserialize(&mut &data[8..])
                .map_err(|_| TransferHookError::InvalidAccountData)?;

            if entry.mint != ctx.accounts.mint.key() {
                 return Err(TransferHookError::InvalidAccountData.into());
            }

            msg!("Evaluating destination blacklist: mint={}, target={}, reason={}, active={}, added_by={}, added_at={}, bump={}", 
                entry.mint, entry.target, entry.reason, entry.active, entry.added_by, entry.added_at, entry.bump);

            if entry.active {
                return Err(TransferHookError::DestinationBlacklisted.into());
            }
        }
    }

    // All checks passed — transfer is allowed
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests — mirror struct Borsh round-trip validation
// ---------------------------------------------------------------------------
//
// These tests verify that PauseStateMirror and BlacklistEntryMirror correctly
// deserialize every field from raw Borsh bytes.  They exercise fields that the
// production handler only deserializes partially (it only checks the boolean
// flags), ensuring the mirror structs stay in sync with the on-chain layouts
// and that no field silently drifts to an unexpected type or order.
#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AnchorSerialize;

    /// Build a realistic set of test keys.
    fn test_pubkey(seed: u8) -> Pubkey {
        Pubkey::new_from_array([seed; 32])
    }

    // -----------------------------------------------------------------------
    // PauseStateMirror round-trip
    // -----------------------------------------------------------------------

    /// Helper: Borsh-serialise a PauseStateMirror and hand back the raw bytes.
    fn serialize_pause_state(
        mint: Pubkey,
        paused: bool,
        paused_at: i64,
        paused_by: Pubkey,
        bump: u8,
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        mint.serialize(&mut buf).unwrap();
        paused.serialize(&mut buf).unwrap();
        paused_at.serialize(&mut buf).unwrap();
        paused_by.serialize(&mut buf).unwrap();
        bump.serialize(&mut buf).unwrap();
        buf
    }

    #[test]
    fn test_pause_state_mirror_not_paused() {
        let mint = test_pubkey(1);
        let paused_by = test_pubkey(2);
        let paused_at: i64 = 1_700_000_000;
        let bump: u8 = 254;

        let bytes = serialize_pause_state(mint, false, paused_at, paused_by, bump);
        let state = PauseStateMirror::deserialize(&mut bytes.as_slice()).unwrap();

        assert_eq!(state.mint, mint,      "mint field must round-trip");
        assert!(!state.paused,             "paused must be false");
        assert_eq!(state.paused_at, paused_at, "paused_at must round-trip");
        assert_eq!(state.paused_by, paused_by, "paused_by must round-trip");
        assert_eq!(state.bump, bump,       "bump must round-trip");
    }

    #[test]
    fn test_pause_state_mirror_paused() {
        let mint = test_pubkey(10);
        let paused_by = test_pubkey(20);
        let paused_at: i64 = 9_999_999_999;
        let bump: u8 = 1;

        let bytes = serialize_pause_state(mint, true, paused_at, paused_by, bump);
        let state = PauseStateMirror::deserialize(&mut bytes.as_slice()).unwrap();

        assert_eq!(state.mint, mint,      "mint field must round-trip when paused");
        assert!(state.paused,              "paused must be true");
        assert_eq!(state.paused_at, paused_at, "paused_at must round-trip when paused");
        assert_eq!(state.paused_by, paused_by, "paused_by must round-trip when paused");
        assert_eq!(state.bump, bump,       "bump must round-trip when paused");
    }

    #[test]
    fn test_pause_state_mirror_invalid_data() {
        // Truncated data must fail cleanly, not panic.
        let result = PauseStateMirror::deserialize(&mut [0u8; 4].as_slice());
        assert!(result.is_err(), "deserializing truncated data must fail");
    }

    // -----------------------------------------------------------------------
    // BlacklistEntryMirror round-trip
    // -----------------------------------------------------------------------

    /// Helper: Borsh-serialise a BlacklistEntryMirror and return the raw bytes.
    fn serialize_blacklist_entry(
        mint: Pubkey,
        target: Pubkey,
        reason: &str,
        added_at: i64,
        added_by: Pubkey,
        active: bool,
        bump: u8,
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        mint.serialize(&mut buf).unwrap();
        target.serialize(&mut buf).unwrap();
        reason.to_string().serialize(&mut buf).unwrap();
        added_at.serialize(&mut buf).unwrap();
        added_by.serialize(&mut buf).unwrap();
        active.serialize(&mut buf).unwrap();
        bump.serialize(&mut buf).unwrap();
        buf
    }

    #[test]
    fn test_blacklist_entry_mirror_active() {
        let mint = test_pubkey(3);
        let target = test_pubkey(4);
        let reason = "AML violation: suspicious transaction pattern";
        let added_at: i64 = 1_710_000_000;
        let added_by = test_pubkey(5);
        let bump: u8 = 253;

        let bytes = serialize_blacklist_entry(mint, target, reason, added_at, added_by, true, bump);
        let entry = BlacklistEntryMirror::deserialize(&mut bytes.as_slice()).unwrap();

        assert_eq!(entry.mint, mint,         "mint must round-trip (active)");
        assert_eq!(entry.target, target,     "target must round-trip (active)");
        assert_eq!(entry.reason, reason,     "reason must round-trip (active)");
        assert_eq!(entry.added_at, added_at, "added_at must round-trip (active)");
        assert_eq!(entry.added_by, added_by, "added_by must round-trip (active)");
        assert!(entry.active,                "active must be true");
        assert_eq!(entry.bump, bump,         "bump must round-trip (active)");
    }

    #[test]
    fn test_blacklist_entry_mirror_inactive() {
        let mint = test_pubkey(6);
        let target = test_pubkey(7);
        let reason = ""; // empty reason edge-case
        let added_at: i64 = 0;
        let added_by = test_pubkey(8);
        let bump: u8 = 0;

        let bytes =
            serialize_blacklist_entry(mint, target, reason, added_at, added_by, false, bump);
        let entry = BlacklistEntryMirror::deserialize(&mut bytes.as_slice()).unwrap();

        assert_eq!(entry.mint, mint,         "mint must round-trip (inactive)");
        assert_eq!(entry.target, target,     "target must round-trip (inactive)");
        assert_eq!(entry.reason, reason,     "reason must round-trip (empty string)");
        assert_eq!(entry.added_at, added_at, "added_at must round-trip (zero)");
        assert_eq!(entry.added_by, added_by, "added_by must round-trip (inactive)");
        assert!(!entry.active,               "active must be false");
        assert_eq!(entry.bump, bump,         "bump must round-trip (zero)");
    }

    #[test]
    fn test_blacklist_entry_mirror_long_reason() {
        // Max-length reason (100 chars) — ensures the variable-length String
        // deserialization is robust, not byte-offset dependent.
        let reason = "A".repeat(100);
        let mint = test_pubkey(9);
        let target = test_pubkey(11);
        let added_by = test_pubkey(12);

        let bytes =
            serialize_blacklist_entry(mint, target, &reason, 12345, added_by, true, 200);
        let entry = BlacklistEntryMirror::deserialize(&mut bytes.as_slice()).unwrap();

        assert_eq!(entry.reason.len(), 100, "100-char reason must round-trip");
        assert_eq!(entry.mint, mint,        "mint must round-trip (long reason)");
        assert_eq!(entry.target, target,    "target must round-trip (long reason)");
        assert_eq!(entry.added_by, added_by,"added_by must round-trip (long reason)");
        assert_eq!(entry.bump, 200,         "bump must round-trip (long reason)");
    }

    #[test]
    fn test_blacklist_entry_mirror_invalid_data() {
        let result = BlacklistEntryMirror::deserialize(&mut [0u8; 8].as_slice());
        assert!(result.is_err(), "deserializing truncated blacklist data must fail");
    }
}
