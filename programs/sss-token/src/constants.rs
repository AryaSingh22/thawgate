//! PDA seeds and size constants for the SSS-Token program.
//!
//! All PDA derivations in the program use seeds defined here.
//! Never hardcode seed strings inline — always reference these constants.

/// PDA seed for the main stablecoin configuration account.
pub const SEED_CONFIG: &[u8] = b"stablecoin_config";

/// PDA seed prefix for role records.
pub const SEED_ROLE: &[u8] = b"role";

/// PDA seed prefix for minter quotas.
pub const SEED_QUOTA: &[u8] = b"minter_quota";

/// PDA seed prefix for blacklist entries (SSS-2).
pub const SEED_BLACKLIST: &[u8] = b"blacklist";

/// PDA seed for pause state.
pub const SEED_PAUSE: &[u8] = b"pause_state";

/// PDA seed prefix for allowlist entries (SSS-3).
pub const SEED_ALLOWLIST: &[u8] = b"allowlist";

/// Maximum length for token name field.
pub const MAX_NAME_LEN: usize = 32;

/// Maximum length for token symbol field.
pub const MAX_SYMBOL_LEN: usize = 10;

/// Maximum length for metadata URI.
pub const MAX_URI_LEN: usize = 200;

/// Maximum length for blacklist reason string (SSS-2).
pub const MAX_REASON_LEN: usize = 100;

/// `StablecoinConfig.compliance_mode` 0: compliance through the transfer hook when `enable_transfer_hook` is set
/// (SSS-1/SSS-2 as before). Configs created before the field existed read as this mode.
pub const COMPLIANCE_MODE_HOOK: u8 = 0;

/// `compliance_mode` 1: Token ACL (sRFC 37) with the ThawGate gate. Frozen by default, Pausable, TokenMetadata;
/// no transfer hook.
pub const COMPLIANCE_MODE_ACL: u8 = 1;

/// `compliance_mode` 2: Token ACL plus the transfer hook ("strict mode").
pub const COMPLIANCE_MODE_BOTH: u8 = 2;

/// TokenMetadata key through which Token ACL clients find a mint's gate (@token-acl/sdk `TOKEN_ACL_METADATA_KEY`).
pub const TOKEN_ACL_METADATA_KEY: &str = "token_acl";
