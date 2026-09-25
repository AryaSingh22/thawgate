//! Solana Attestation Service (SAS): the attestation account the KYC policy reads, vendored.
//!
//! No SAS crate is a dependency. The layout comes from the SAS program (`program/src/processor/create_attestation.rs`,
//! `program/src/state/attestation.rs`) and sas-lib's `getAttestationDecoder`, and is pinned by the tests below against
//! bytes the deployed SAS program wrote (docs/gatekit/SPIKES.md, S3):
//! `[0] discriminator = 2 | [1..33] nonce | [33..65] credential | [65..97] schema | [97..101] data len n (u32) |
//!  [101..101+n] data | signer (32) | expiry (i64) | token_account (32)`.
//!
//! Token ACL resolves the attestation's address from the gate's extra metas
//! (`["attestation", credential, schema, owner]` under SAS), so the account read here is the canonical one for this
//! policy and owner. An empty account there means no credential: never issued, or closed (SAS's revoke).

use anchor_lang::prelude::*;

use crate::errors::GateError;
use crate::state::GatePolicy;

/// SAS program.
pub const SAS_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/// Attestation PDA seed: `["attestation", credential, schema, nonce]`; this gate requires nonce = holder wallet.
pub const ATTESTATION_SEED: &[u8] = b"attestation";

const ATTESTATION_DISCRIMINATOR: u8 = 2;
const NONCE: usize = 1;
const CREDENTIAL: usize = 33;
const SCHEMA: usize = 65;
const DATA_LEN: usize = 97;
/// Start of the schema data. `min_kyc_level` reads its first byte, so the schema's first field must be
/// `kyc_level: u8` (the demo schema is `kyc_level: u8, country: String`).
const DATA: usize = 101;
/// The signer (32 bytes) sits between the data and `expiry`.
const SIGNER_LEN: usize = 32;

/// What the attestation at the enforced address says about the holder.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Credential {
    /// No account: never issued, or closed (revoked).
    Missing,
    /// Past its SAS header `expiry`.
    Expired,
    /// Live, but `kyc_level` is below the policy's `min_kyc_level`.
    LevelTooLow,
    Valid,
}

/// Reads the attestation at the enforced address. `Err` means the account is not a SAS attestation for this policy
/// and owner (the gate denies both thaw and freeze then).
pub fn read_attestation(info: &AccountInfo, policy: &GatePolicy, owner: &Pubkey) -> Result<Credential> {
    if info.data_is_empty() {
        return Ok(Credential::Missing);
    }
    require_keys_eq!(*info.owner, SAS_ID, GateError::DeniedBadCredential);
    let now = Clock::get()?.unix_timestamp;
    parse_attestation(
        &info.try_borrow_data()?,
        &policy.sas_credential,
        &policy.sas_schema,
        owner,
        policy.min_kyc_level,
        now,
    )
}

fn parse_attestation(
    data: &[u8],
    credential: &Pubkey,
    schema: &Pubkey,
    owner: &Pubkey,
    min_kyc_level: u8,
    now: i64,
) -> Result<Credential> {
    require!(data.len() >= DATA && data[0] == ATTESTATION_DISCRIMINATOR, GateError::DeniedBadCredential);
    let key = |at: usize| &data[at..at + 32];
    require!(
        key(NONCE) == owner.as_ref() && key(CREDENTIAL) == credential.as_ref() && key(SCHEMA) == schema.as_ref(),
        GateError::DeniedBadCredential
    );
    let len = u32::from_le_bytes(data[DATA_LEN..DATA].try_into().unwrap()) as usize;
    let expiry_at = DATA + len + SIGNER_LEN;
    require!(data.len() >= expiry_at + 8, GateError::DeniedBadCredential);
    let expiry = i64::from_le_bytes(data[expiry_at..expiry_at + 8].try_into().unwrap());

    // The SAS program's own rule, create_attestation.rs:64 (solana-attestation-service 44a58eea):
    // `if args.expiry < clock.unix_timestamp && args.expiry != 0 { InvalidAttestationData }`. 0 means never expires
    // (state/attestation.rs:28), and an attestation is still live in the second `expiry == now`. (SAS's kit example
    // `sas-standard-kit-demo.ts:193` checks `now < expiry` instead; this gate follows the program.)
    if expiry != 0 && expiry < now {
        return Ok(Credential::Expired);
    }
    if min_kyc_level > 0 {
        require!(len >= 1, GateError::DeniedBadCredential);
        if data[DATA] < min_kyc_level {
            return Ok(Credential::LevelTooLow);
        }
    }
    Ok(Credential::Valid)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The attestation the deployed SAS program wrote in the S3 spike (SPIKES.md): kyc_level 2, country "IN",
    /// expiry 1821823151, nonce = the holder wallet.
    const S3_ATTESTATION_HEX: &str = "022f821b10be71bc4a0faafc3973038a60331d3da598ae8e9afaddf43b4a3bc42bd044ee5d1ac0fd114ae283af7adecf9c476edbebc412cd7d5d3f4c0b632bc623c14a644ec9dad43627fc1a4e990366beb86015fa9b326d4582e7f3a75c3a57a5070000000202000000494e51400fd6e5b3d85c985be03de05276be7b66a6e3c58c0a5b4cc6392d5a51396fafd0966c000000000000000000000000000000000000000000000000000000000000000000000000";
    const S3_HOLDER: Pubkey = pubkey!("4CTEDr7pgqBU4uLkVk2aqu54tPQi9ufUKZVvDv2tgYp2");
    const S3_CREDENTIAL: Pubkey = pubkey!("F1zmKcyTqcDBzd1bD8a526Sk38r7GrMRrN6EgCfGWmoG");
    const S3_SCHEMA: Pubkey = pubkey!("E1XUjb5UJxgg3xExSX77JqaPrsJ4SEwQC6dtMCEZu3LG");
    const S3_EXPIRY: i64 = 1_821_823_151;
    const EXPIRY_AT: usize = 140;

    fn s3_bytes() -> Vec<u8> {
        (0..S3_ATTESTATION_HEX.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&S3_ATTESTATION_HEX[i..i + 2], 16).unwrap())
            .collect()
    }
    fn parse(data: &[u8], min_kyc_level: u8, now: i64) -> Result<Credential> {
        parse_attestation(data, &S3_CREDENTIAL, &S3_SCHEMA, &S3_HOLDER, min_kyc_level, now)
    }

    #[test]
    fn decodes_the_attestation_sas_wrote() {
        let data = s3_bytes();
        assert_eq!(data.len(), 180);
        assert_eq!(i64::from_le_bytes(data[EXPIRY_AT..EXPIRY_AT + 8].try_into().unwrap()), S3_EXPIRY);
        assert_eq!(data[DATA], 2); // kyc_level
        assert_eq!(parse(&data, 0, S3_EXPIRY - 100).unwrap(), Credential::Valid);
        assert_eq!(parse(&data, 2, S3_EXPIRY - 100).unwrap(), Credential::Valid);
    }

    #[test]
    fn expiry_follows_the_sas_program() {
        let data = s3_bytes();
        assert_eq!(parse(&data, 0, S3_EXPIRY - 1).unwrap(), Credential::Valid);
        assert_eq!(parse(&data, 0, S3_EXPIRY).unwrap(), Credential::Valid); // live in the expiry second itself
        assert_eq!(parse(&data, 0, S3_EXPIRY + 1).unwrap(), Credential::Expired);
        let mut never = data.clone();
        never[EXPIRY_AT..EXPIRY_AT + 8].copy_from_slice(&0i64.to_le_bytes());
        assert_eq!(parse(&never, 0, i64::MAX).unwrap(), Credential::Valid);
    }

    #[test]
    fn min_kyc_level_reads_the_first_data_byte() {
        let data = s3_bytes();
        assert_eq!(parse(&data, 3, 0).unwrap(), Credential::LevelTooLow);
        // An expired attestation reports Expired whatever its level.
        assert_eq!(parse(&data, 3, S3_EXPIRY + 1).unwrap(), Credential::Expired);
    }

    #[test]
    fn rejects_anything_that_is_not_this_policys_attestation_for_this_owner() {
        let data = s3_bytes();
        let other = Pubkey::new_unique();
        for (at, what) in [(NONCE, "nonce"), (CREDENTIAL, "credential"), (SCHEMA, "schema")] {
            let mut bad = data.clone();
            bad[at..at + 32].copy_from_slice(other.as_ref());
            assert!(parse(&bad, 0, 0).is_err(), "{what} not checked");
        }
        let mut bad = data.clone();
        bad[0] = 1; // a Schema account's discriminator
        assert!(parse(&bad, 0, 0).is_err());
        assert!(parse(&data[..EXPIRY_AT + 7], 0, 0).is_err()); // truncated before the end of expiry
        assert!(parse(&data[..DATA - 1], 0, 0).is_err());
        // Data length pointing past the end of the account.
        let mut bad = data.clone();
        bad[DATA_LEN..DATA].copy_from_slice(&1000u32.to_le_bytes());
        assert!(parse(&bad, 0, 0).is_err());
        // min_kyc_level with no data to read it from.
        let empty_data: Vec<u8> = [&data[..DATA_LEN], &0u32.to_le_bytes()[..], &data[DATA + 7..]].concat();
        assert_eq!(parse(&empty_data, 0, 0).unwrap(), Credential::Valid);
        assert!(parse(&empty_data, 1, 0).is_err());
    }
}
