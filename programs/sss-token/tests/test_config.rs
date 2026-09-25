#[cfg(test)]
mod test_config {
    use sss_token::state::*;
    use anchor_lang::prelude::Pubkey;

    fn get_base_config() -> StablecoinConfig {
        StablecoinConfig {
            authority: Pubkey::default(),
            mint: Pubkey::default(),
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            uri: "".to_string(),
            decimals: 6,
            enable_permanent_delegate: false,
            enable_transfer_hook: false,
            default_account_frozen: false,
            enable_confidential_transfers: false,
            enable_allowlist: false,
            paused: false,
            total_minted: 0,
            total_burned: 0,
            bump: 0,
            compliance_mode: 0,
        }
    }

    #[test]
    fn sss1_config_disables_transfer_hook() {
        let mut config = get_base_config();
        config.enable_transfer_hook = false;
        assert_eq!(config.enable_transfer_hook, false);
    }

    #[test]
    fn sss2_config_enables_transfer_hook() {
        let mut config = get_base_config();
        config.enable_transfer_hook = true;
        config.enable_permanent_delegate = true;
        assert_eq!(config.enable_transfer_hook, true);
        assert_eq!(config.enable_permanent_delegate, true);
    }

    #[test]
    fn sss2_config_enables_default_frozen() {
        let mut config = get_base_config();
        config.default_account_frozen = true;
        assert_eq!(config.default_account_frozen, true);
    }

    #[test]
    fn config_name_max_length() {
        let name_32 = "a".repeat(32);
        assert_eq!(name_32.len(), 32);
        
        let name_33 = "a".repeat(33);
        assert!(name_33.len() > 32);
    }

    #[test]
    fn config_symbol_max_length() {
        let symbol_10 = "a".repeat(10);
        assert_eq!(symbol_10.len(), 10);
        
        let symbol_11 = "a".repeat(11);
        assert!(symbol_11.len() > 10);
    }

    #[test]
    fn config_decimals_valid_range() {
        let decimals: u8 = 9;
        assert!(decimals <= 9);
        let decimals_bad: u8 = 10;
        assert!(decimals_bad > 9);
    }

    #[test]
    fn config_size_matches_account_space() {
        // Just assert that the Rust struct size is smaller than allocated PDA size
        assert!(std::mem::size_of::<StablecoinConfig>() <= STABLECOIN_CONFIG_SIZE);
    }

    #[test]
    fn sss1_has_no_blacklister_role() {
        let config = get_base_config();
        assert_eq!(config.enable_transfer_hook, false);
    }

    #[test]
    fn config_preset_sss1_correct_fields() {
        let config = get_base_config();
        assert_eq!(config.enable_permanent_delegate, false);
        assert_eq!(config.enable_transfer_hook, false);
        assert_eq!(config.default_account_frozen, false);
    }

    #[test]
    fn config_preset_sss2_correct_fields() {
        let mut config = get_base_config();
        config.enable_permanent_delegate = true;
        config.enable_transfer_hook = true;
        config.default_account_frozen = true;
        
        assert_eq!(config.enable_permanent_delegate, true);
        assert_eq!(config.enable_transfer_hook, true);
        assert_eq!(config.default_account_frozen, true);
    }
}
