/**
 * @module modules/reserves
 * @description ReservesModule: the reserve attestation that `mint_tokens` checks (S9).
 *
 * MasterAuthority sets the attestor and the staleness window; the attestor posts reserves. `mint_tokens` then
 * refuses a mint when `mint.supply + amount > reserves` (ReserveInsufficient) or `now - asOf > maxStaleness`
 * (ReserveStale). Reserves are in the mint's base units (1.00 of a 6-decimal coin = 1_000_000).
 * Acl/Both mode mints need an attestation to mint at all; Hook mode mints are checked once one exists.
 */

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { findConfigPda, findReserveAttestationPda, findRolePda } from "../pda";
import { RoleType } from "../types";
import { parseError } from "../errors";

/** On-chain `ReserveAttestation` (PDA `["reserve_attestation", mint]`). */
export interface ReserveAttestation {
    mint: PublicKey;
    attestor: PublicKey;
    /** Base units of the mint. */
    reserves: BN;
    /** Unix seconds at which the reserves were measured; 0 until the first post. */
    asOf: BN;
    /** Seconds after `asOf` during which minting may rely on the attestation. */
    maxStaleness: BN;
    reportUri: string;
    /** Cluster time of the last post; 0 until the first post. */
    postedAt: BN;
    bump: number;
}

/**
 * @example
 * ```ts
 * const reserves = client.reserves(mint);
 * await reserves.setReserveAttestor(master, attestor, 86_400);          // MasterAuthority
 * await reserves.attestReserves(attestor, new BN(1_000_000_000), asOf, "https://example.com/report.json");
 * ```
 */
export class ReservesModule {
    private readonly program: Program;
    private readonly mint: PublicKey;
    private readonly programId: PublicKey;

    constructor(program: Program, mint: PublicKey) {
        this.program = program;
        this.mint = mint;
        this.programId = program.programId;
    }

    /** The mint's ReserveAttestation address. */
    address(): PublicKey {
        return findReserveAttestationPda(this.mint, this.programId)[0];
    }

    /**
     * Sets the attestor and the staleness window (seconds). MasterAuthority only; creates the account on first
     * use. A different attestor clears the posted reserves, so minting waits for its first post.
     */
    async setReserveAttestor(
        authority: PublicKey,
        attestor: PublicKey,
        maxStalenessSeconds: number | BN,
    ): Promise<TransactionInstruction[]> {
        try {
            const ix = await this.program.methods
                .setReserveAttestor(attestor, new BN(maxStalenessSeconds.toString()))
                .accountsStrict({
                    authority,
                    config: findConfigPda(this.mint, this.programId)[0],
                    authorityRole: findRolePda(this.mint, authority, RoleType.MasterAuthority, this.programId)[0],
                    mint: this.mint,
                    reserveAttestation: this.address(),
                    systemProgram: SystemProgram.programId,
                })
                .instruction();
            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /**
     * Posts reserves (base units) measured at `asOf` (unix seconds). Signed by the attestor. `asOf` may not be in
     * the future or older than the stored one; `reportUri` is at most 200 bytes.
     */
    async attestReserves(
        attestor: PublicKey,
        reserves: BN,
        asOf: number | BN,
        reportUri: string,
    ): Promise<TransactionInstruction[]> {
        try {
            const ix = await this.program.methods
                .attestReserves(reserves, new BN(asOf.toString()), reportUri)
                .accountsStrict({ attestor, reserveAttestation: this.address() })
                .instruction();
            return [ix];
        } catch (error) {
            throw parseError(error);
        }
    }

    /** The mint's attestation, or null if MasterAuthority never set an attestor. */
    async fetch(): Promise<ReserveAttestation | null> {
        return (await (this.program.account as any).reserveAttestation.fetchNullable(this.address())) as ReserveAttestation | null;
    }
}
