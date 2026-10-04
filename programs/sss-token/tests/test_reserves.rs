//! S9 reserve-backed mint: the pure check in `mint_tokens`, the post rule in `attest_reserves`, the account
//! layout, and the error codes the clients match on.

use anchor_lang::prelude::*;
use sss_token::constants::MAX_URI_LEN;
use sss_token::errors::SssError;
use sss_token::state::*;

const NOW: i64 = 1_790_000_000;

#[test]
fn reserves_equal_to_supply_after_mint_pass() {
    assert_eq!(check_reserves(400, 600, 1_000, NOW - 10, 60, NOW), ReserveCheck::Ok);
}

#[test]
fn one_base_unit_over_reserves_is_insufficient() {
    assert_eq!(check_reserves(400, 601, 1_000, NOW - 10, 60, NOW), ReserveCheck::Insufficient);
    assert_eq!(check_reserves(1_000, 1, 1_000, NOW, 60, NOW), ReserveCheck::Insufficient);
}

#[test]
fn supply_plus_amount_overflow_is_insufficient() {
    assert_eq!(check_reserves(u64::MAX, 1, u64::MAX, NOW, 60, NOW), ReserveCheck::Insufficient);
}

#[test]
fn age_equal_to_max_staleness_passes_one_more_second_is_stale() {
    assert_eq!(check_reserves(0, 1, 1, NOW - 60, 60, NOW), ReserveCheck::Ok);
    assert_eq!(check_reserves(0, 1, 1, NOW - 61, 60, NOW), ReserveCheck::Stale);
}

#[test]
fn stale_is_reported_before_insufficient() {
    assert_eq!(check_reserves(1_000, 1, 1_000, NOW - 61, 60, NOW), ReserveCheck::Stale);
}

#[test]
fn never_posted_attestation_is_stale() {
    // set_reserve_attestor leaves as_of = 0 until the attestor's first post.
    assert_eq!(check_reserves(0, 1, 0, 0, 31_536_000, NOW), ReserveCheck::Stale);
}

#[test]
fn post_rules() {
    assert!(valid_post(NOW, 0, NOW, 0));
    assert!(valid_post(NOW - 5, NOW - 5, NOW, MAX_URI_LEN), "same as_of re-posts (a correction)");
    assert!(!valid_post(NOW + 1, 0, NOW, 0), "future as_of");
    assert!(!valid_post(NOW - 6, NOW - 5, NOW, 0), "older than the stored as_of");
    assert!(!valid_post(NOW, 0, NOW, MAX_URI_LEN + 1), "report_uri over 200 bytes");
}

#[test]
fn reserve_attestation_size_fits_a_full_uri() {
    let att = ReserveAttestation {
        mint: Pubkey::new_unique(),
        attestor: Pubkey::new_unique(),
        reserves: u64::MAX,
        as_of: NOW,
        max_staleness: 86_400,
        report_uri: "x".repeat(MAX_URI_LEN),
        posted_at: NOW,
        bump: 255,
        reserved: [0; 64],
    };
    let mut data = Vec::new();
    att.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), RESERVE_ATTESTATION_SIZE);
    assert_eq!(RESERVE_ATTESTATION_SIZE, 373);
}

#[test]
fn new_errors_are_appended_and_old_codes_do_not_move() {
    assert_eq!(u32::from(SssError::NotAuthorized), 6000);
    assert_eq!(u32::from(SssError::UnknownFreezeAuthority), 6034);
    assert_eq!(u32::from(SssError::ReserveInsufficient), 6035);
    assert_eq!(u32::from(SssError::ReserveStale), 6036);
    assert_eq!(u32::from(SssError::ReserveAttestationMissing), 6037);
    assert_eq!(u32::from(SssError::NotReserveAttestor), 6038);
    assert_eq!(u32::from(SssError::InvalidReserveAttestation), 6039);
    assert_eq!(u32::from(SssError::TargetAccountOwnerMismatch), 6040);
    // S15: the re-add and transfer-back refusals reuse these two; the screener matches the first by name.
    assert_eq!(u32::from(SssError::AccountAlreadyBlacklisted), 6011);
    assert_eq!(u32::from(SssError::RoleAlreadyActive), 6017);
    assert_eq!(u32::from(SssError::AllowlistEntryAlreadyActive), 6041);
}

fn attestation_bytes(report_uri: &str, bump: u8) -> Vec<u8> {
    let att = ReserveAttestation {
        mint: Pubkey::new_unique(),
        attestor: Pubkey::new_unique(),
        reserves: 7,
        as_of: NOW,
        max_staleness: 86_400,
        report_uri: report_uri.to_string(),
        posted_at: NOW,
        bump,
        reserved: [0; 64],
    };
    let mut data = Vec::new();
    att.try_serialize(&mut data).unwrap();
    data.resize(RESERVE_ATTESTATION_SIZE, 0); // the account's unused tail
    data
}

#[test]
fn stored_bump_reads_the_bump_after_any_report_uri() {
    let full = "x".repeat(MAX_URI_LEN);
    for (uri, bump) in [("", 255u8), ("https://example.com/reserves.json", 248), (full.as_str(), 1)] {
        assert_eq!(stored_bump(&attestation_bytes(uri, bump)), Some(bump), "uri of {} bytes", uri.len());
    }
}

#[test]
fn stored_bump_is_none_for_anything_else() {
    let good = attestation_bytes("abc", 250);
    assert_eq!(stored_bump(&[]), None, "no account");
    assert_eq!(stored_bump(&good[..100]), None, "truncated");
    let mut other_type = good.clone();
    other_type[0] ^= 1;
    assert_eq!(stored_bump(&other_type), None, "another account type");
    let mut long_uri = good.clone();
    long_uri[96..100].copy_from_slice(&((MAX_URI_LEN as u32) + 1).to_le_bytes());
    assert_eq!(stored_bump(&long_uri), None, "a URI length the account can't hold");
}
