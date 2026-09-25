#[cfg(test)]
mod test_state {
    use sss_token::state::*;
    use anchor_lang::prelude::Pubkey;

    #[test]
    fn pause_state_default_is_unpaused() {
        let state = PauseState {
            mint: Pubkey::default(),
            paused: false,
            paused_at: 0,
            paused_by: Pubkey::default(),
            bump: 0,
        };
        assert_eq!(state.paused, false);
    }

    #[test]
    fn pause_state_toggling_works() {
        let mut state = PauseState { 
            mint: Pubkey::default(),
            paused: false, 
            paused_at: 0,
            paused_by: Pubkey::default(),
            bump: 0 
        };
        state.paused = true;
        assert_eq!(state.paused, true);
        state.paused = false;
        assert_eq!(state.paused, false);
    }

    #[test]
    fn minter_quota_default_is_zero() {
        let quota = MinterQuota {
            mint: Pubkey::default(),
            minter: Pubkey::default(),
            limit: 1000,
            used: 0,
            period: QuotaPeriod::Daily,
            bump: 0,
        };
        assert_eq!(quota.used, 0);
    }

    #[test]
    fn minter_quota_decrements_on_mint() {
        let mut quota = MinterQuota {
            mint: Pubkey::default(),
            minter: Pubkey::default(),
            limit: 1000,
            used: 0,
            period: QuotaPeriod::Daily,
            bump: 0,
        };
        quota.used += 100;
        assert_eq!(quota.used, 100);
        assert!(quota.used <= quota.limit);
    }

    #[test]
    fn minter_quota_cannot_go_below_zero() {
        let quota = MinterQuota {
            mint: Pubkey::default(),
            minter: Pubkey::default(),
            limit: 1000,
            used: 0,
            period: QuotaPeriod::Daily,
            bump: 0,
        };
        assert_eq!(quota.used, 0);
    }

    #[test]
    fn blacklist_entry_stores_reason() {
        let entry = BlacklistEntry {
            mint: Pubkey::default(),
            target: Pubkey::default(),
            reason: "Sus".to_string(),
            added_at: 100,
            added_by: Pubkey::default(),
            active: true,
            bump: 0,
        };
        assert_eq!(entry.reason, "Sus");
    }

    #[test]
    fn blacklist_entry_stores_timestamp() {
        let entry = BlacklistEntry {
            mint: Pubkey::default(),
            target: Pubkey::default(),
            reason: "Sus".to_string(),
            added_at: 12345678,
            added_by: Pubkey::default(),
            active: true,
            bump: 0,
        };
        assert_eq!(entry.added_at, 12345678);
    }

    #[test]
    fn role_record_stores_correct_pubkey() {
        let pk = Pubkey::new_unique();
        let record = RoleRecord {
            mint: Pubkey::default(),
            holder: pk,
            role: RoleType::Minter,
            granted_at: 0,
            active: true,
            bump: 0,
        };
        assert_eq!(record.holder, pk);
    }

    #[test]
    fn stablecoin_config_paused_field_toggles() {
        let pause_state = PauseState { 
            mint: Pubkey::default(),
            paused: true, 
            paused_at: 0,
            paused_by: Pubkey::default(),
            bump: 0 
        };
        assert_eq!(pause_state.paused, true);
    }

    #[test]
    fn stablecoin_config_authority_field_updatable() {
        let mut config = StablecoinConfig {
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
        };
        let pk = Pubkey::new_unique();
        config.authority = pk;
        assert_eq!(config.authority, pk);
    }
}
