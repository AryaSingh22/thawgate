//! # SSS-Token — Solana Stablecoin Standard Core Program
//!
//! This Anchor program implements the core stablecoin functionality for the
//! Solana Stablecoin Standard (SSS). It supports two preset configurations:
//!
//! - **SSS-1**: Basic stablecoin with mint, burn, freeze, pause, and role management.
//! - **SSS-2**: Enhanced compliance stablecoin with blacklist, seize (via permanent
//!   delegate), and transfer hook integration for real-time compliance checks.
//! - **SSS-3**: Private stablecoin with confidential transfers and allowlist-based
//!   access control using SPL Token-2022 extensions.
//!
//! ## Architecture
//!
//! - All state is stored in PDAs derived from the mint address
//! - The mint authority and freeze authority are the StablecoinConfig PDA
//! - Role-based access control via RoleRecord PDAs
//! - Extension flags (permanent_delegate, transfer_hook, default_account_frozen)
//!   are set at initialization and are immutable forever

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod thawgate;
pub mod token_acl;

use instructions::*;
use state::*;

declare_id!("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");

/// The SSS-Token program.
#[program]
pub mod sss_token {
    use super::*;

    /// Initializes a new stablecoin with Token-2022 extensions.
    ///
    /// Creates the mint, config PDA, pause state PDA, and master authority role.
    /// Extension flags are immutable after this call.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::initialize_handler(ctx, args)
    }

    /// Mints tokens to a recipient.
    ///
    /// Validates minter role, pause state, and quota before minting.
    /// Creates recipient ATA if it doesn't exist.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::mint_handler(ctx, amount)
    }

    /// Burns tokens from the burner's account.
    ///
    /// Validates burner role and pause state before burning.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::burn_handler(ctx, amount)
    }

    /// Freezes a target token account.
    ///
    /// Requires MasterAuthority or Blacklister role.
    pub fn freeze_account(ctx: Context<FreezeOrThaw>) -> Result<()> {
        instructions::freeze::handler_freeze(ctx)
    }

    /// Thaws a frozen token account.
    ///
    /// Requires MasterAuthority or Blacklister role.
    pub fn thaw_account(ctx: Context<FreezeOrThaw>) -> Result<()> {
        instructions::freeze::handler_thaw(ctx)
    }

    /// Pauses all token operations (mint, burn, transfer).
    ///
    /// Requires Pauser or MasterAuthority role.
    /// Does NOT prevent freeze/thaw/seize.
    pub fn pause(ctx: Context<PauseOrUnpause>) -> Result<()> {
        instructions::pause::handler_pause(ctx)
    }

    /// Resumes all token operations.
    ///
    /// Requires Pauser or MasterAuthority role.
    pub fn unpause(ctx: Context<PauseOrUnpause>) -> Result<()> {
        instructions::pause::handler_unpause(ctx)
    }

    /// Creates or updates a minter with a quota.
    ///
    /// Only MasterAuthority can call. Creates both role record and quota PDAs.
    pub fn update_minter(
        ctx: Context<UpdateMinter>,
        minter: Pubkey,
        limit: u64,
        period: QuotaPeriod,
    ) -> Result<()> {
        instructions::roles::handler_update_minter(ctx, minter, limit, period)
    }

    /// Creates or updates a role for a given key.
    ///
    /// Only MasterAuthority can call. Cannot grant MasterAuthority (use transfer_authority).
    pub fn update_roles(
        ctx: Context<UpdateRoles>,
        holder: Pubkey,
        role: RoleType,
        active: bool,
    ) -> Result<()> {
        instructions::roles::handler_update_roles(ctx, holder, role, active)
    }

    /// Transfers MasterAuthority to a new key.
    ///
    /// Only the current MasterAuthority can call. Old authority is deactivated.
    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::roles::handler_transfer_authority(ctx, new_authority)
    }

    /// Adds an address to the blacklist (SSS-2 and Token ACL modes).
    ///
    /// Feature-gated: requires compliance (enable_transfer_hook, or compliance_mode Acl/Both).
    /// Creates a BlacklistEntry and freezes the target's token account.
    pub fn add_to_blacklist(ctx: Context<AddToBlacklist>, reason: String) -> Result<()> {
        instructions::compliance::handler_add_to_blacklist(ctx, reason)
    }

    /// Removes an address from the blacklist (SSS-2 and Token ACL modes).
    ///
    /// Feature-gated: requires compliance (enable_transfer_hook, or compliance_mode Acl/Both).
    /// Deactivates the BlacklistEntry. Does NOT auto-thaw.
    pub fn remove_from_blacklist(ctx: Context<RemoveFromBlacklist>) -> Result<()> {
        instructions::compliance::handler_remove_from_blacklist(ctx)
    }

    /// Seizes all tokens from a frozen, blacklisted account (SSS-2 and Token ACL modes).
    ///
    /// Feature-gated: requires compliance (the hook or Token ACL) and enable_permanent_delegate.
    /// Uses permanent delegate authority to transfer without owner consent.
    pub fn seize<'info>(ctx: Context<'_, '_, '_, 'info, Seize<'info>>) -> Result<()> {
        instructions::seize::seize_handler(ctx)
    }

    // ====================================================================
    // Token ACL mode (S6)
    // ====================================================================

    /// Puts a Token ACL mode mint under Token ACL with the ThawGate gate and creates its gate policy.
    ///
    /// Requires compliance_mode Acl or Both and the MasterAuthority. The config PDA signs every CPI.
    pub fn enable_token_acl(ctx: Context<EnableTokenAcl>, policy: GatePolicyConfig) -> Result<()> {
        instructions::enable_token_acl::enable_token_acl_handler(ctx, policy)
    }

    // ====================================================================
    // SSS-3 Instructions — Private Stablecoin
    // ====================================================================

    /// Adds a wallet to the allowlist (SSS-3 only).
    ///
    /// Feature-gated: requires enable_allowlist.
    /// Only MasterAuthority can manage the allowlist.
    pub fn add_to_allowlist_v3(ctx: Context<AddToAllowlist>) -> Result<()> {
        instructions::allowlist::add_to_allowlist_handler(ctx)
    }

    /// Removes a wallet from the allowlist (SSS-3 only).
    ///
    /// Feature-gated: requires enable_allowlist.
    /// Only MasterAuthority can manage the allowlist.
    pub fn remove_from_allowlist_v3(ctx: Context<RemoveFromAllowlist>) -> Result<()> {
        instructions::allowlist::remove_from_allowlist_handler(ctx)
    }

    /// Configures a token account for confidential transfers (SSS-3 only).
    ///
    /// Feature-gated: requires enable_confidential_transfers.
    pub fn configure_confidential_account(
        ctx: Context<ConfigureConfidentialAccount>,
    ) -> Result<()> {
        instructions::confidential::configure_confidential_account_handler(ctx)
    }

    /// Applies pending confidential balance credits (SSS-3 only).
    ///
    /// Feature-gated: requires enable_confidential_transfers.
    pub fn apply_pending_balance(
        ctx: Context<ApplyPendingBalance>,
    ) -> Result<()> {
        instructions::confidential::apply_pending_balance_handler(ctx)
    }
}
