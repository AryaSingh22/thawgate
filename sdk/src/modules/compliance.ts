/**
 * @module modules/compliance
 * @description ComplianceModule class for SSS-2 compliance operations.
 *
 * Provides blacklist management and token seizure capabilities.
 * All methods are feature-gated — they throw FeatureNotEnabledError
 * if the stablecoin was not initialized with SSS-2 features.
 */

import {
    AccountMeta,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    findConfigPda,
    findRolePda,
    findBlacklistPda,
    findAllowlistPda,
} from "../pda";
import { RoleType } from "../types";
import type { StablecoinConfig, BlacklistEntry } from "../types";
import { FeatureNotEnabledError, parseError } from "../errors";

/**
 * ComplianceModule — SSS-2 compliance operations.
 *
 * Encapsulates blacklist and seizure operations. Validates that the
 * stablecoin has SSS-2 features enabled before executing.
 *
 * @example
 * ```ts
 * const compliance = new ComplianceModule(program, mint, config);
 *
 * // Add to blacklist
 * const ixs = await compliance.addToBlacklist(operator, target, "OFAC sanctioned");
 *
 * // Seize tokens
 * const seizeIxs = await compliance.seize(seizer, sourceTokenAccount, treasury);
 * ```
 */
export class ComplianceModule {
    private readonly program: Program;
    private readonly mint: PublicKey;
    private readonly programId: PublicKey;

    constructor(program: Program, mint: PublicKey) {
        this.program = program;
        this.mint = mint;
        this.programId = program.programId;
    }

    /**
     * Adds an address to the blacklist and freezes their token account.
     *
     * @param operator - The Blacklister operator's public key
     * @param target - The wallet to blacklist
     * @param reason - Human-readable reason (max 200 chars)
     * @param opts.targetTokenAccount - The target's token account to pass (default: its ATA). sss-token requires an
     *   account owned by `target` (S9); on Token ACL mints it is frozen in the same transaction if thawed.
     * @returns Transaction instructions
     * @throws FeatureNotEnabledError if transfer_hook is not enabled
     */
    async addToBlacklist(
        operator: PublicKey,
        target: PublicKey,
        reason: string,
        opts: { targetTokenAccount?: PublicKey } = {},
    ): Promise<TransactionInstruction[]> {
        const [configPda] = findConfigPda(this.mint, this.programId);
        const [operatorRolePda] = findRolePda(
            this.mint,
            operator,
            RoleType.Blacklister,
            this.programId,
        );
        const [blacklistPda] = findBlacklistPda(this.mint, target, this.programId);

        const targetAta = opts.targetTokenAccount ?? getAssociatedTokenAddressSync(
            this.mint,
            target,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        try {
            const ix = await this.program.methods
                .addToBlacklist(reason)
                .accounts({
                    operator,
                    config: configPda,
                    operatorRole: operatorRolePda,
                    blacklistEntry: blacklistPda,
                    target,
                    mint: this.mint,
                    targetTokenAccount: targetAta,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .instruction();

            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /**
     * Removes an address from the blacklist.
     *
     * Does NOT automatically thaw the account — call thawAccount separately.
     *
     * @param operator - The Blacklister operator's public key
     * @param target - The wallet to remove from blacklist
     * @returns Transaction instructions
     */
    async removeFromBlacklist(
        operator: PublicKey,
        target: PublicKey,
    ): Promise<TransactionInstruction[]> {
        const [configPda] = findConfigPda(this.mint, this.programId);
        const [operatorRolePda] = findRolePda(
            this.mint,
            operator,
            RoleType.Blacklister,
            this.programId,
        );
        const [blacklistPda] = findBlacklistPda(this.mint, target, this.programId);

        try {
            const ix = await this.program.methods
                .removeFromBlacklist()
                .accounts({
                    operator,
                    config: configPda,
                    operatorRole: operatorRolePda,
                    blacklistEntry: blacklistPda,
                    target,
                })
                .instruction();

            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /**
     * Adds a wallet to the issuer allowlist (`add_to_allowlist_v3`, MasterAuthority). Needs a mint initialized with
     * `enableAllowlist`; a ThawGate `allowOnly` or `bypassForPdas` policy reads the entry.
     */
    async addToAllowlist(authority: PublicKey, wallet: PublicKey): Promise<TransactionInstruction[]> {
        return this.allowlistIx("addToAllowlistV3", authority, wallet);
    }

    /** Deactivates a wallet's allowlist entry (`remove_from_allowlist_v3`, MasterAuthority). */
    async removeFromAllowlist(authority: PublicKey, wallet: PublicKey): Promise<TransactionInstruction[]> {
        return this.allowlistIx("removeFromAllowlistV3", authority, wallet);
    }

    private async allowlistIx(method: "addToAllowlistV3" | "removeFromAllowlistV3", authority: PublicKey, wallet: PublicKey): Promise<TransactionInstruction[]> {
        const accounts: Record<string, PublicKey> = {
            authority,
            config: findConfigPda(this.mint, this.programId)[0],
            authorityRole: findRolePda(this.mint, authority, RoleType.MasterAuthority, this.programId)[0],
            wallet,
            allowlistEntry: findAllowlistPda(this.mint, wallet, this.programId)[0],
        };
        if (method === "addToAllowlistV3") accounts.systemProgram = SystemProgram.programId;
        try {
            const ix = await (this.program.methods as any)[method]().accountsStrict(accounts).instruction();
            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /**
     * Seizes all tokens from a frozen, blacklisted account.
     *
     * Requires both enable_transfer_hook and enable_permanent_delegate.
     *
     * @param seizer - The Seizer operator's public key
     * @param sourceAuthority - The owner of the source token account
     * @param sourceTokenAccount - The frozen token account to seize from
     * @param treasuryTokenAccount - The treasury to receive seized tokens
     * @returns Transaction instructions
     */
    async seize(
        seizer: PublicKey,
        sourceAuthority: PublicKey,
        sourceTokenAccount: PublicKey,
        treasuryTokenAccount: PublicKey,
        remainingAccounts?: AccountMeta[],
    ): Promise<TransactionInstruction[]> {
        const [configPda] = findConfigPda(this.mint, this.programId);
        const [seizerRolePda] = findRolePda(
            this.mint,
            seizer,
            RoleType.Seizer,
            this.programId,
        );
        const [blacklistPda] = findBlacklistPda(
            this.mint,
            sourceAuthority,
            this.programId,
        );

        try {
            const ix = await this.program.methods
                .seize()
                .accounts({
                    seizer,
                    config: configPda,
                    seizerRole: seizerRolePda,
                    blacklistEntry: blacklistPda,
                    mint: this.mint,
                    sourceTokenAccount,
                    sourceAuthority,
                    treasuryTokenAccount,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                })
                .remainingAccounts(remainingAccounts || [])
                .instruction();

            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /**
     * Fetches a blacklist entry for a given target.
     *
     * @param target - The wallet to check
     * @returns The BlacklistEntry or null if not found
     */
    async getBlacklistEntry(target: PublicKey): Promise<BlacklistEntry | null> {
        const [blacklistPda] = findBlacklistPda(this.mint, target, this.programId);

        try {
            const accounts = this.program.account as Record<string, { fetch: (pda: PublicKey) => Promise<unknown> }>;
            const account = await accounts["blacklistEntry"].fetch(blacklistPda);
            return account as BlacklistEntry;
        } catch {
            return null;
        }
    }

    /**
     * Checks if a wallet is currently blacklisted.
     *
     * @param target - The wallet to check
     * @returns true if actively blacklisted
     */
    async isBlacklisted(target: PublicKey): Promise<boolean> {
        const entry = await this.getBlacklistEntry(target);
        return entry?.active ?? false;
    }
}
