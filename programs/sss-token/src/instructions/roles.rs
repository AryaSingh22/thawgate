//! Role management instructions — update_minter, update_roles, transfer_authority.
//!
//! Only the MasterAuthority can manage roles.
//! Role records are never deleted — `active` is set to `false` for audit trail.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::SssError;
use crate::state::*;

// ============================================================================
// Update Minter — create or update a MinterQuota PDA
// ============================================================================

/// Accounts required for the update_minter instruction.
#[derive(Accounts)]
#[instruction(minter: Pubkey, limit: u64, period: QuotaPeriod)]
pub struct UpdateMinter<'info> {
    /// The authority — must be the current MasterAuthority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The authority's MasterAuthority role record.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = authority_role.bump,
        constraint = authority_role.active @ SssError::NotAuthorized,
        constraint = authority_role.role == RoleType::MasterAuthority @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// The minter's role record PDA — initialized if needed.
    #[account(
        init_if_needed,
        payer = authority,
        space = ROLE_RECORD_SIZE,
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            minter.as_ref(),
            &[RoleType::Minter as u8],
        ],
        bump,
    )]
    pub minter_role: Account<'info, RoleRecord>,

    /// The minter's quota PDA — initialized if needed.
    #[account(
        init_if_needed,
        payer = authority,
        space = MINTER_QUOTA_SIZE,
        seeds = [SEED_QUOTA, config.mint.as_ref(), minter.as_ref()],
        bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Handler for the update_minter instruction.
///
/// Creates or updates a minter's role record and quota.
pub fn handler_update_minter(
    ctx: Context<UpdateMinter>,
    minter: Pubkey,
    limit: u64,
    period: QuotaPeriod,
) -> Result<()> {
    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;

    // Initialize or update role record
    let minter_role = &mut ctx.accounts.minter_role;
    minter_role.mint = mint_key;
    minter_role.holder = minter;
    minter_role.role = RoleType::Minter;
    minter_role.active = true;
    minter_role.granted_at = clock.unix_timestamp;
    minter_role.bump = ctx.bumps.minter_role;

    // Initialize or update quota
    let quota = &mut ctx.accounts.minter_quota;
    quota.mint = mint_key;
    quota.minter = minter;
    quota.limit = limit;
    // Reset used on quota update
    quota.used = 0;
    quota.period = period;
    quota.bump = ctx.bumps.minter_quota;

    Ok(())
}

// ============================================================================
// Update Roles — create or deactivate a role for a given key
// ============================================================================

/// Accounts required for the update_roles instruction.
#[derive(Accounts)]
#[instruction(holder: Pubkey, role: RoleType, active: bool)]
pub struct UpdateRoles<'info> {
    /// The authority — must be the current MasterAuthority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The authority's MasterAuthority role record.
    #[account(
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = authority_role.bump,
        constraint = authority_role.active @ SssError::NotAuthorized,
        constraint = authority_role.role == RoleType::MasterAuthority @ SssError::NotAuthorized,
    )]
    pub authority_role: Account<'info, RoleRecord>,

    /// The target holder's role record PDA — initialized if needed.
    #[account(
        init_if_needed,
        payer = authority,
        space = ROLE_RECORD_SIZE,
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            holder.as_ref(),
            &[role as u8],
        ],
        bump,
    )]
    pub target_role: Account<'info, RoleRecord>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Handler for the update_roles instruction.
///
/// Creates a new role record or updates an existing one.
/// Setting active=false revokes the role (never deletes — audit trail).
pub fn handler_update_roles(
    ctx: Context<UpdateRoles>,
    holder: Pubkey,
    role: RoleType,
    active: bool,
) -> Result<()> {
    // Cannot grant MasterAuthority via this instruction — use transfer_authority
    require!(
        role != RoleType::MasterAuthority,
        SssError::InvalidRoleType
    );

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;

    let target_role = &mut ctx.accounts.target_role;
    target_role.mint = mint_key;
    target_role.holder = holder;
    target_role.role = role;
    target_role.active = active;
    target_role.granted_at = clock.unix_timestamp;
    target_role.bump = ctx.bumps.target_role;

    Ok(())
}

// ============================================================================
// Transfer Authority — transfers MasterAuthority to a new key
// ============================================================================

/// Accounts required for the transfer_authority instruction.
#[derive(Accounts)]
#[instruction(new_authority: Pubkey)]
pub struct TransferAuthority<'info> {
    /// The current MasterAuthority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stablecoin configuration PDA.
    #[account(
        mut,
        seeds = [SEED_CONFIG, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The current authority's MasterAuthority role record — will be deactivated.
    #[account(
        mut,
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            authority.key().as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump = old_master_role.bump,
        constraint = old_master_role.active @ SssError::NotAuthorized,
        constraint = old_master_role.role == RoleType::MasterAuthority @ SssError::NotAuthorized,
    )]
    pub old_master_role: Account<'info, RoleRecord>,

    /// The new authority's MasterAuthority role record: created, or reactivated when the key held MasterAuthority
    /// before (S15). An active record means the new authority is the signer itself.
    #[account(
        init_if_needed,
        payer = authority,
        space = ROLE_RECORD_SIZE,
        seeds = [
            SEED_ROLE,
            config.mint.as_ref(),
            new_authority.as_ref(),
            &[RoleType::MasterAuthority as u8],
        ],
        bump,
        constraint = !new_master_role.active @ SssError::RoleAlreadyActive,
    )]
    pub new_master_role: Account<'info, RoleRecord>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Event emitted when authority is transferred.
#[event]
pub struct AuthorityTransferred {
    /// The mint address.
    pub mint: Pubkey,
    /// The previous authority.
    pub old_authority: Pubkey,
    /// The new authority.
    pub new_authority: Pubkey,
    /// Unix timestamp.
    pub timestamp: i64,
}

/// Handler for the transfer_authority instruction.
///
/// Transfers MasterAuthority to a new key. The old authority's role record
/// is deactivated (not deleted) and the new authority's record is created, or
/// reactivated if that key held MasterAuthority before, so authority can return
/// to a previous holder. Does NOT transfer the on-chain mint authority (that PDA
/// remains program-controlled).
pub fn handler_transfer_authority(
    ctx: Context<TransferAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let mint_key = ctx.accounts.config.mint;

    // Deactivate old master role (audit trail preserved)
    let old_role = &mut ctx.accounts.old_master_role;
    old_role.active = false;

    // Initialize new master role
    let new_role = &mut ctx.accounts.new_master_role;
    new_role.mint = mint_key;
    new_role.holder = new_authority;
    new_role.role = RoleType::MasterAuthority;
    new_role.active = true;
    new_role.granted_at = clock.unix_timestamp;
    new_role.bump = ctx.bumps.new_master_role;

    // Update config authority reference
    let config = &mut ctx.accounts.config;
    config.authority = new_authority;

    emit!(AuthorityTransferred {
        mint: mint_key,
        old_authority: ctx.accounts.authority.key(),
        new_authority,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
