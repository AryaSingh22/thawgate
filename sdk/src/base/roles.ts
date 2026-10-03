/**
 * @module base/roles
 * @description Role management operations — update_minter, update_roles, transfer_authority.
 */

import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    findConfigPda,
    findRolePda,
    findQuotaPda,
} from "../pda";
import { RoleType, QuotaPeriod } from "../types";
import { parseError } from "../errors";

/**
 * Creates or updates a minter with a quota.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param authority - The MasterAuthority's public key
 * @param minter - The minter's public key
 * @param limit - Maximum mint amount per period
 * @param period - The quota period
 * @returns Transaction instructions
 */
export async function updateMinter(
    program: Program,
    mint: PublicKey,
    authority: PublicKey,
    minter: PublicKey,
    limit: BN,
    period: QuotaPeriod,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [authorityRolePda] = findRolePda(
        mint,
        authority,
        RoleType.MasterAuthority,
        programId,
    );
    const [minterRolePda] = findRolePda(mint, minter, RoleType.Minter, programId);
    const [quotaPda] = findQuotaPda(mint, minter, programId);

    try {
        const ix = await program.methods
            .updateMinter(minter, limit, { [QuotaPeriod[period].toLowerCase()]: {} })
            .accounts({
                authority,
                config: configPda,
                authorityRole: authorityRolePda,
                minterRole: minterRolePda,
                minterQuota: quotaPda,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Creates or updates a role for a given key.
 *
 * Cannot grant MasterAuthority — use transferAuthority instead.
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param authority - The MasterAuthority's public key
 * @param holder - The key to grant/revoke the role for
 * @param role - The role type (cannot be MasterAuthority)
 * @param active - Whether to activate or deactivate
 * @returns Transaction instructions
 */
export async function updateRoles(
    program: Program,
    mint: PublicKey,
    authority: PublicKey,
    holder: PublicKey,
    role: RoleType,
    active: boolean,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [authorityRolePda] = findRolePda(
        mint,
        authority,
        RoleType.MasterAuthority,
        programId,
    );
    const [targetRolePda] = findRolePda(mint, holder, role, programId);

    try {
        const ix = await program.methods
            .updateRoles(holder, { [RoleType[role].toLowerCase()]: {} }, active)
            .accounts({
                authority,
                config: configPda,
                authorityRole: authorityRolePda,
                targetRole: targetRolePda,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Transfers MasterAuthority to a new key.
 *
 * The old authority's role record is deactivated (audit trail).
 *
 * @param program - The Anchor program instance
 * @param mint - The Token-2022 mint address
 * @param authority - The current MasterAuthority's public key
 * @param newAuthority - The new MasterAuthority's public key
 * @returns Transaction instructions
 */
export async function transferAuthority(
    program: Program,
    mint: PublicKey,
    authority: PublicKey,
    newAuthority: PublicKey,
): Promise<TransactionInstruction[]> {
    const programId = program.programId;
    const [configPda] = findConfigPda(mint, programId);
    const [oldMasterRolePda] = findRolePda(
        mint,
        authority,
        RoleType.MasterAuthority,
        programId,
    );
    const [newMasterRolePda] = findRolePda(
        mint,
        newAuthority,
        RoleType.MasterAuthority,
        programId,
    );

    try {
        const ix = await program.methods
            .transferAuthority(newAuthority)
            .accounts({
                authority,
                config: configPda,
                oldMasterRole: oldMasterRolePda,
                newMasterRole: newMasterRolePda,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        return [ix];
    } catch (error) {
        throw parseError(error);
    }
}
