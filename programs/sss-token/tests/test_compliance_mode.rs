//! S6: `compliance_mode` (Hook / Acl / Both) and the StablecoinConfig layout change.

use anchor_lang::error::Error;
use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use sss_token::constants::*;
use sss_token::errors::SssError;
use sss_token::instructions::{build_extension_list, InitializeArgs};
use sss_token::state::*;

/// StablecoinConfig as written before S6 (no `compliance_mode`).
#[derive(AnchorSerialize)]
struct LegacyConfig {
    authority: Pubkey,
    mint: Pubkey,
    name: String,
    symbol: String,
    uri: String,
    decimals: u8,
    enable_permanent_delegate: bool,
    enable_transfer_hook: bool,
    default_account_frozen: bool,
    enable_confidential_transfers: bool,
    enable_allowlist: bool,
    paused: bool,
    total_minted: u64,
    total_burned: u64,
    bump: u8,
}

const LEGACY_CONFIG_SIZE: usize = 350;

/// A pre-S6 config account: discriminator + Borsh fields, zero-filled to the old allocation.
fn legacy_account(name: &str, symbol: &str, uri: &str) -> Vec<u8> {
    let legacy = LegacyConfig {
        authority: Pubkey::new_unique(),
        mint: Pubkey::new_unique(),
        name: name.into(),
        symbol: symbol.into(),
        uri: uri.into(),
        decimals: 6,
        enable_permanent_delegate: true,
        enable_transfer_hook: true,
        default_account_frozen: false,
        enable_confidential_transfers: false,
        enable_allowlist: false,
        paused: false,
        total_minted: 1_000,
        total_burned: 10,
        bump: 254,
    };
    let mut data = StablecoinConfig::DISCRIMINATOR.to_vec();
    legacy.serialize(&mut data).unwrap();
    assert!(data.len() <= LEGACY_CONFIG_SIZE);
    data.resize(LEGACY_CONFIG_SIZE, 0);
    data
}

fn is(result: Result<()>, expected: SssError) -> bool {
    matches!(result, Err(Error::AnchorError(e)) if e.error_code_number == u32::from(expected))
}

fn args(compliance_mode: u8, default_account_frozen: bool, enable_transfer_hook: bool) -> InitializeArgs {
    InitializeArgs {
        name: "ThawGate USD".into(),
        symbol: "tgUSD".into(),
        uri: "https://example.com/tgusd.json".into(),
        decimals: 6,
        enable_permanent_delegate: true,
        enable_transfer_hook,
        default_account_frozen,
        hook_program_id: enable_transfer_hook.then(Pubkey::new_unique),
        enable_confidential_transfers: false,
        enable_allowlist: false,
        compliance_mode,
    }
}

#[test]
fn config_size_grows_by_the_mode_byte() {
    assert_eq!(STABLECOIN_CONFIG_SIZE, LEGACY_CONFIG_SIZE + 1);
}

/// Configs created before S6 (the March devnet deploy) must still load after the upgrade: the unused string
/// capacity is zero, so `compliance_mode` reads 0 (Hook) and the account re-serializes in its 350 bytes.
#[test]
fn legacy_config_reads_as_hook_mode_and_reserializes_in_place() {
    let mut data = legacy_account("Compliance USD", "cUSD", "https://compliance.example.com/meta.json");
    let config = StablecoinConfig::try_deserialize(&mut data.as_slice()).unwrap();
    assert_eq!(config.compliance_mode, COMPLIANCE_MODE_HOOK);
    assert!(config.enable_transfer_hook && config.compliance_enabled() && !config.uses_token_acl());
    assert_eq!((config.total_minted, config.total_burned, config.bump), (1_000, 10, 254));

    let mut out: &mut [u8] = &mut data;
    config.try_serialize(&mut out).unwrap();
}

/// The one layout that breaks: name, symbol and uri all at their maximum leave no spare byte after `bump`.
#[test]
fn legacy_config_with_max_length_strings_does_not_load() {
    let data = legacy_account(&"n".repeat(MAX_NAME_LEN), &"s".repeat(MAX_SYMBOL_LEN), &"u".repeat(MAX_URI_LEN));
    assert!(StablecoinConfig::try_deserialize(&mut data.as_slice()).is_err());
}

#[test]
fn compliance_helpers_per_mode() {
    let data = legacy_account("A", "B", "C");
    let mut config = StablecoinConfig::try_deserialize(&mut data.as_slice()).unwrap();
    config.enable_transfer_hook = false;
    assert!(!config.compliance_enabled(), "SSS-1: no hook, Hook mode");
    config.compliance_mode = COMPLIANCE_MODE_ACL;
    assert!(config.uses_token_acl() && config.compliance_enabled());
    config.compliance_mode = COMPLIANCE_MODE_BOTH;
    config.enable_transfer_hook = true;
    assert!(config.uses_token_acl() && config.compliance_enabled());
}

#[test]
fn initialize_validates_compliance_mode() {
    // Hook mode: unchanged rules (any combination of the legacy flags).
    assert!(args(COMPLIANCE_MODE_HOOK, false, false).validate_compliance_mode().is_ok());
    assert!(args(COMPLIANCE_MODE_HOOK, true, true).validate_compliance_mode().is_ok());
    // Acl: frozen by default, no hook.
    assert!(args(COMPLIANCE_MODE_ACL, true, false).validate_compliance_mode().is_ok());
    assert!(is(args(COMPLIANCE_MODE_ACL, false, false).validate_compliance_mode(), SssError::InvalidComplianceMode));
    assert!(is(args(COMPLIANCE_MODE_ACL, true, true).validate_compliance_mode(), SssError::InvalidComplianceMode));
    // Both: frozen by default and the hook.
    assert!(args(COMPLIANCE_MODE_BOTH, true, true).validate_compliance_mode().is_ok());
    assert!(is(args(COMPLIANCE_MODE_BOTH, true, false).validate_compliance_mode(), SssError::InvalidComplianceMode));
    assert!(is(args(COMPLIANCE_MODE_BOTH, false, true).validate_compliance_mode(), SssError::InvalidComplianceMode));
    // Out of range.
    assert!(is(args(3, true, false).validate_compliance_mode(), SssError::InvalidComplianceMode));
}

#[test]
fn token_acl_modes_add_pausable_and_metadata_pointer() {
    let hook = build_extension_list(&args(COMPLIANCE_MODE_HOOK, true, true));
    assert_eq!(hook, vec![ExtensionType::PermanentDelegate, ExtensionType::TransferHook, ExtensionType::DefaultAccountState]);

    let acl = build_extension_list(&args(COMPLIANCE_MODE_ACL, true, false));
    assert_eq!(
        acl,
        vec![ExtensionType::PermanentDelegate, ExtensionType::DefaultAccountState, ExtensionType::Pausable, ExtensionType::MetadataPointer]
    );

    let both = build_extension_list(&args(COMPLIANCE_MODE_BOTH, true, true));
    assert!(both.contains(&ExtensionType::TransferHook) && both.contains(&ExtensionType::Pausable));
}
