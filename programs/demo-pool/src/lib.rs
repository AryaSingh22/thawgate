//! # Demo pool: the ThawGate demo venue
//!
//! **Demo venue; any protocol that separates pool init from deposit works the same way (Orca proven on localnet in
//! S2, docs/gatekit/SPIKES.md).** Not audited, devnet only, single liquidity provider, no LP shares, no withdraw.
//!
//! A Token ACL mint starts every token account frozen, the pool's vaults included. So the pool is opened in three
//! steps, the way Orca Whirlpools opens one:
//! 1. `init_pool` creates the pool PDA and its two vaults (keypair accounts with ImmutableOwner, owner = the pool
//!    PDA). No tokens move: the gated vault is left frozen.
//! 2. Outside this program: the issuer allowlists the pool PDA, and anyone thaws the vault through Token ACL
//!    `thaw_permissionless` (ThawGate `BypassForPdas` logs `TG:ALLOW:PDA_ALLOWLISTED`).
//! 3. `deposit` adds the liquidity; `swap` trades against it (constant product, `fee_bps` fee).
//!
//! The gate still holds inside a swap: Token-2022 refuses the transfer from or to a holder's frozen account.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022_extensions::immutable_owner::{immutable_owner_initialize, ImmutableOwnerInitialize};
use anchor_spl::token_interface::{
    initialize_account3, transfer_checked, InitializeAccount3, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use spl_token_2022::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions};

declare_id!("9oYxeFvSLhgq8rqh4BRJA1gRyMX53j7gt9jYzNZhLaKS");

pub const POOL_SEED: &[u8] = b"pool";
const BPS: u128 = 10_000;
const MAX_FEE_BPS: u16 = 1_000;

#[program]
pub mod demo_pool {
    use super::*;

    /// Creates the pool and its two empty vaults. A Token-2022 vault gets ImmutableOwner (ThawGate requires it).
    pub fn init_pool(ctx: Context<InitPool>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, PoolError::FeeTooHigh);
        let a = &ctx.accounts;
        for (vault, mint, token_program) in
            [(&a.vault_a, &a.mint_a, &a.token_program_a), (&a.vault_b, &a.mint_b, &a.token_program_b)]
        {
            create_vault(a, vault, mint, token_program)?;
        }
        let pool = Pool {
            admin: a.admin.key(),
            mint_a: a.mint_a.key(),
            mint_b: a.mint_b.key(),
            vault_a: a.vault_a.key(),
            vault_b: a.vault_b.key(),
            fee_bps,
            bump: ctx.bumps.pool,
        };
        ctx.accounts.pool.set_inner(pool);
        msg!("DEMO_POOL: demo venue; any protocol that separates pool init from deposit works the same way");
        Ok(())
    }

    /// The admin adds liquidity (single LP; no shares).
    pub fn deposit(ctx: Context<Deposit>, amount_a: u64, amount_b: u64) -> Result<()> {
        let a = &ctx.accounts;
        let admin = a.admin.to_account_info();
        for (amount, from, to, mint, token_program) in [
            (amount_a, &a.admin_a, &a.vault_a, &a.mint_a, &a.token_program_a),
            (amount_b, &a.admin_b, &a.vault_b, &a.mint_b, &a.token_program_b),
        ] {
            if amount > 0 {
                transfer(token_program, from, mint, to, admin.clone(), &[], amount)?;
            }
        }
        Ok(())
    }

    /// Sells `amount_in` of mint A for mint B (`a_to_b`) or the reverse, at the vaults' current ratio.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
        let a = &ctx.accounts;
        let (side_in, side_out) = if a_to_b {
            ((&a.user_a, &a.vault_a, &a.mint_a, &a.token_program_a), (&a.user_b, &a.vault_b, &a.mint_b, &a.token_program_b))
        } else {
            ((&a.user_b, &a.vault_b, &a.mint_b, &a.token_program_b), (&a.user_a, &a.vault_a, &a.mint_a, &a.token_program_a))
        };
        let amount_out = amount_out(side_in.1.amount, side_out.1.amount, amount_in, a.pool.fee_bps)?;
        require!(amount_out >= min_amount_out, PoolError::SlippageExceeded);

        let (mint_a, mint_b) = (a.pool.mint_a, a.pool.mint_b);
        let seeds: &[&[u8]] = &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref(), &[a.pool.bump]];
        transfer(side_in.3, side_in.0, side_in.2, side_in.1, a.user.to_account_info(), &[], amount_in)?;
        transfer(side_out.3, side_out.1, side_out.2, side_out.0, a.pool.to_account_info(), &[seeds], amount_out)?;
        msg!("DEMO_POOL:SWAP in={} out={}", amount_in, amount_out);
        Ok(())
    }
}

/// Constant product with the fee taken from the input: `out = R_out * in' / (R_in + in')`, rounded down. `out` is
/// below `R_out`, so it fits in a u64.
pub fn amount_out(reserve_in: u64, reserve_out: u64, amount_in: u64, fee_bps: u16) -> Result<u64> {
    require!(reserve_in > 0 && reserve_out > 0, PoolError::EmptyPool);
    let in_after_fee = amount_in as u128 * (BPS - fee_bps as u128) / BPS;
    let out = (reserve_out as u128 * in_after_fee / (reserve_in as u128 + in_after_fee)) as u64;
    require!(out > 0, PoolError::ZeroAmount);
    Ok(out)
}

/// Whirlpool-style vault: a keypair account, sized for the extensions the mint requires plus ImmutableOwner, owned
/// by the pool PDA. On a DefaultAccountState=Frozen mint it starts frozen.
fn create_vault<'info>(
    a: &InitPool<'info>,
    vault: &Signer<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let is_2022 = token_program.key() == spl_token_2022::ID;
    let extensions = if is_2022 {
        let data = mint.to_account_info().try_borrow_data()?.to_vec();
        let mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)?;
        let mut extensions = ExtensionType::get_required_init_account_extensions(&mint_state.get_extension_types()?);
        extensions.push(ExtensionType::ImmutableOwner);
        extensions
    } else {
        vec![] // 165 bytes, an SPL Token account
    };
    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Account>(&extensions)?;
    create_account(
        CpiContext::new(a.system_program.to_account_info(), CreateAccount { from: a.admin.to_account_info(), to: vault.to_account_info() }),
        Rent::get()?.minimum_balance(space),
        space as u64,
        token_program.key,
    )?;
    if is_2022 {
        immutable_owner_initialize(CpiContext::new(
            token_program.to_account_info(),
            ImmutableOwnerInitialize { token_program_id: token_program.to_account_info(), token_account: vault.to_account_info() },
        ))?;
    }
    initialize_account3(CpiContext::new(
        token_program.to_account_info(),
        InitializeAccount3 { account: vault.to_account_info(), mint: mint.to_account_info(), authority: a.pool.to_account_info() },
    ))
}

/// `transfer_checked`; the token program checks the accounts' mint, the authority and the frozen state.
fn transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let accounts = TransferChecked { from: from.to_account_info(), mint: mint.to_account_info(), to: to.to_account_info(), authority };
    transfer_checked(CpiContext::new_with_signer(token_program.to_account_info(), accounts, signer_seeds), amount, mint.decimals)
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub admin: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,
    #[account(mint::token_program = token_program_a, constraint = mint_a.key() != mint_b.key())]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program_b)]
    pub mint_b: InterfaceAccount<'info, Mint>,
    /// New keypair account, created here as a token account.
    #[account(mut)]
    pub vault_a: Signer<'info>,
    /// New keypair account, created here as a token account.
    #[account(mut)]
    pub vault_b: Signer<'info>,
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub admin: Signer<'info>,
    #[account(has_one = admin, has_one = mint_a, has_one = mint_b, has_one = vault_a, has_one = vault_b)]
    pub pool: Account<'info, Pool>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub admin_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub admin_b: InterfaceAccount<'info, TokenAccount>,
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(has_one = mint_a, has_one = mint_b, has_one = vault_a, has_one = vault_b)]
    pub pool: Account<'info, Pool>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_b: InterfaceAccount<'info, TokenAccount>,
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum PoolError {
    #[msg("fee_bps is above 1000 (10%)")]
    FeeTooHigh,
    #[msg("The pool has no liquidity on one side")]
    EmptyPool,
    #[msg("The swap would move zero tokens")]
    ZeroAmount,
    #[msg("Output is below min_amount_out")]
    SlippageExceeded,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_takes_the_fee_and_rounds_down() {
        // in' = 1000 * 9970 / 10000 = 997; out = 100000 * 997 / 100997 = 987.16
        assert_eq!(amount_out(100_000, 100_000, 1_000, 30).unwrap(), 987);
        assert_eq!(amount_out(100_000, 100_000, 1_000, 0).unwrap(), 990);
    }

    #[test]
    fn the_product_never_falls() {
        for (r_in, r_out, amount) in [(100_000u64, 100_000u64, 1_000u64), (7, 1_000_000, 3), (1_000_000, 7, 999_999)] {
            let out = amount_out(r_in, r_out, amount, 30).unwrap();
            assert!((r_in as u128 + amount as u128) * ((r_out - out) as u128) >= r_in as u128 * r_out as u128);
        }
    }

    #[test]
    fn extremes() {
        assert!(amount_out(u64::MAX, u64::MAX, u64::MAX, 0).unwrap() < u64::MAX);
        assert!(amount_out(0, 100, 10, 30).is_err());
        assert!(amount_out(100, 0, 10, 30).is_err());
        assert!(amount_out(1_000_000, 1, 1, 30).is_err()); // rounds to zero
    }
}
