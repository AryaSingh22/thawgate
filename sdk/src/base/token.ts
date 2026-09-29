/**
 * @module base/token
 * @description Core token operations — initialize, mint, burn, freeze, thaw, pause, unpause.
 *
 * These functions build Anchor instruction transactions.
 * The caller is responsible for signing and sending.
 */

import {
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Keypair,
    TransactionInstruction,
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import {
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    findConfigPda,
    findPauseStatePda,
    findRolePda,
    findQuotaPda,
} from "../pda";
import { ComplianceMode, RoleType } from "../types";
import type { InitializeArgs, TransactionResult } from "../types";
import { parseError } from "../errors";

/**
 * Initializes a new stablecoin.
 *
 * Creates the Token-2022 mint with configured extensions,
 * plus StablecoinConfig, PauseState, and MasterAuthority PDAs.
 *
 * @param program - The Anchor program instance
 * @param authority - The authority keypair (becomes MasterAuthority)
 * @param args - Initialization arguments (use presets for defaults)
 * @param mintKeypair - Optional mint keypair (generated if not provided)
 * @returns Transaction result with mint address
 */
export async function initialize(
    program: Program,
    authority: PublicKey,
    args: InitializeArgs,
    mintKeypair?: Keypair,
): Promise<{ instructions: TransactionInstruction[]; mint: PublicKey; mintKeypair: Keypair }> {
    const mint = mintKeypair ?? Keypair.generate();
    const mintKey = mint.publicKey;
    const programId = program.programId;

    const [configPda] = findConfigPda(mintKey, programId);
    const [pausePda] = findPauseStatePda(mintKey, programId);
    const [masterRolePda] = findRolePda(
        mintKey,
        authority,
        RoleType.MasterAuthority,
        programId,
    );

    try {
        const ix = await program.methods
            .initialize({
                name: args.name,
                symbol: args.symbol,
                uri: args.uri,
                decimals: args.decimals,
                enablePermanentDelegate: args.enablePermanentDelegate,
                enableTransferHook: args.enableTransferHook,
                defaultAccountFrozen: args.defaultAccountFrozen,
                hookProgramId: args.hookProgramId ?? null,
                enableConfidentialTransfers: args.enableConfidentialTransfers ?? false,
                enableAllowlist: args.enableAllowlist ?? false,
                complianceMode: args.complianceMode ?? ComplianceMode.Hook,
            })
            .accounts({
                authority,
                mint: mintKey,
                config: configPda,
                pauseState: pausePda,
                masterRole: masterRolePda,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .instruction();

        return { instructions: [ix], mint: mintKey, mintKeypair: mint };
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Mints tokens to a recipient.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param minter - The minter's public key (must have Minter role)
 * @param recipient - The recipient's wallet address
 * @param amount - Amount to mint (raw, not decimal-adjusted)
 * @returns Transaction instructions
 */
export async function mintTokens(
    program: Program,
    mint: PublicKey,
    minter: PublicKey,
    recipient: PublicKey,
    amount: BN,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [pausePda] = findPauseStatePda(mint, programId);
    const [minterRolePda] = findRolePda(mint, minter, RoleType.Minter, programId);
    const [quotaPda] = findQuotaPda(mint, minter, programId);

    const recipientAta = getAssociatedTokenAddressSync(
        mint,
        recipient,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    try {
        const ix = await program.methods
            .mintTokens(amount)
            .accounts({
                minter,
                config: configPda,
                pauseState: pausePda,
                minterRole: minterRolePda,
                minterQuota: quotaPda,
                mint,
                recipientTokenAccount: recipientAta,
                recipient,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Burns tokens from the burner's account.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param burner - The burner's public key (must have Burner role)
 * @param amount - Amount to burn (raw, not decimal-adjusted)
 * @returns Transaction instructions
 */
export async function burnTokens(
    program: Program,
    mint: PublicKey,
    burner: PublicKey,
    amount: BN,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [pausePda] = findPauseStatePda(mint, programId);
    const [burnerRolePda] = findRolePda(mint, burner, RoleType.Burner, programId);

    const burnerAta = getAssociatedTokenAddressSync(
        mint,
        burner,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    try {
        const ix = await program.methods
            .burnTokens(amount)
            .accounts({
                burner,
                config: configPda,
                pauseState: pausePda,
                burnerRole: burnerRolePda,
                mint,
                burnerTokenAccount: burnerAta,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Freezes a target token account.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param operator - The operator's public key (MasterAuthority or Blacklister)
 * @param targetTokenAccount - The token account to freeze
 * @param operatorRole - The role type of the operator
 * @returns Transaction instructions
 */
export async function freezeAccount(
    program: Program,
    mint: PublicKey,
    operator: PublicKey,
    targetTokenAccount: PublicKey,
    operatorRole: RoleType.MasterAuthority | RoleType.Blacklister = RoleType.MasterAuthority,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [rolePda] = findRolePda(mint, operator, operatorRole, programId);

    try {
        const ix = await program.methods
            .freezeAccount()
            .accounts({
                operator,
                config: configPda,
                operatorRole: rolePda,
                mint,
                targetTokenAccount,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Thaws a frozen token account.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param operator - The operator's public key (MasterAuthority or Blacklister)
 * @param targetTokenAccount - The token account to thaw
 * @param operatorRole - The role type of the operator
 * @returns Transaction instructions
 */
export async function thawAccount(
    program: Program,
    mint: PublicKey,
    operator: PublicKey,
    targetTokenAccount: PublicKey,
    operatorRole: RoleType.MasterAuthority | RoleType.Blacklister = RoleType.MasterAuthority,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [rolePda] = findRolePda(mint, operator, operatorRole, programId);

    try {
        const ix = await program.methods
            .thawAccount()
            .accounts({
                operator,
                config: configPda,
                operatorRole: rolePda,
                mint,
                targetTokenAccount,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Pauses all token operations.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param operator - The operator's public key (Pauser or MasterAuthority)
 * @param operatorRole - The role type of the operator
 * @returns Transaction instructions
 */
export async function pause(
    program: Program,
    mint: PublicKey,
    operator: PublicKey,
    operatorRole: RoleType.Pauser | RoleType.MasterAuthority = RoleType.Pauser,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [pausePda] = findPauseStatePda(mint, programId);
    const [rolePda] = findRolePda(mint, operator, operatorRole, programId);

    try {
        const ix = await program.methods
            .pause()
            .accounts({
                operator,
                config: configPda,
                pauseState: pausePda,
                operatorRole: rolePda,
                // Token ACL modes pause the mint itself (Token-2022 Pausable)
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Resumes all token operations.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param operator - The operator's public key (Pauser or MasterAuthority)
 * @param operatorRole - The role type of the operator
 * @returns Transaction instructions
 */
export async function unpause(
    program: Program,
    mint: PublicKey,
    operator: PublicKey,
    operatorRole: RoleType.Pauser | RoleType.MasterAuthority = RoleType.Pauser,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [pausePda] = findPauseStatePda(mint, programId);
    const [rolePda] = findRolePda(mint, operator, operatorRole, programId);

    try {
        const ix = await program.methods
            .unpause()
            .accounts({
                operator,
                config: configPda,
                pauseState: pausePda,
                operatorRole: rolePda,
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}
