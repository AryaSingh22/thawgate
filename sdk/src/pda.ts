/**
 * @module pda
 * @description PDA derivation helpers for the SSS-Token program.
 *
 * All PDAs are derived from the mint address for consistent addressing.
 * Seeds match the on-chain constants.rs exactly.
 */

import { PublicKey } from "@solana/web3.js";
import { RoleType } from "./types";

// ============================================================================
// PDA Seeds (must match on-chain constants.rs)
// ============================================================================

const SEED_CONFIG = Buffer.from("stablecoin_config");
const SEED_PAUSE = Buffer.from("pause_state");
const SEED_ROLE = Buffer.from("role");
const SEED_QUOTA = Buffer.from("minter_quota");
const SEED_BLACKLIST = Buffer.from("blacklist");
const SEED_RESERVE = Buffer.from("reserve_attestation");

// ============================================================================
// PDA Derivation Functions
// ============================================================================

/**
 * Derives the StablecoinConfig PDA address.
 *
 * @param mint - The Token-2022 mint address
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findConfigPda(
    mint: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_CONFIG, mint.toBuffer()],
        programId,
    );
}

/**
 * Derives the PauseState PDA address.
 *
 * @param mint - The Token-2022 mint address
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findPauseStatePda(
    mint: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_PAUSE, mint.toBuffer()],
        programId,
    );
}

/**
 * Derives a RoleRecord PDA address.
 *
 * @param mint - The Token-2022 mint address
 * @param holder - The role holder's public key
 * @param role - The role type
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findRolePda(
    mint: PublicKey,
    holder: PublicKey,
    role: RoleType,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_ROLE, mint.toBuffer(), holder.toBuffer(), Buffer.from([role])],
        programId,
    );
}

/**
 * Derives a MinterQuota PDA address.
 *
 * @param mint - The Token-2022 mint address
 * @param minter - The minter's public key
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findQuotaPda(
    mint: PublicKey,
    minter: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_QUOTA, mint.toBuffer(), minter.toBuffer()],
        programId,
    );
}

/**
 * Derives a BlacklistEntry PDA address.
 *
 * @param mint - The Token-2022 mint address
 * @param target - The blacklisted wallet's public key
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findBlacklistPda(
    mint: PublicKey,
    target: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_BLACKLIST, mint.toBuffer(), target.toBuffer()],
        programId,
    );
}

/**
 * Derives an AllowlistEntry PDA address (`add_to_allowlist_v3`; read by ThawGate AllowOnly / BypassForPdas policies).
 *
 * @param mint - The Token-2022 mint address
 * @param wallet - The allowlisted wallet's public key
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findAllowlistPda(
    mint: PublicKey,
    wallet: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("allowlist"), mint.toBuffer(), wallet.toBuffer()],
        programId,
    );
}

/**
 * Derives the ReserveAttestation PDA address (S9).
 *
 * @param mint - The Token-2022 mint address
 * @param programId - The SSS-Token program ID
 * @returns [pda, bump]
 */
export function findReserveAttestationPda(
    mint: PublicKey,
    programId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_RESERVE, mint.toBuffer()],
        programId,
    );
}

/**
 * Derives the ExtraAccountMetaList PDA for the transfer hook.
 *
 * @param mint - The Token-2022 mint address
 * @param hookProgramId - The transfer hook program ID
 * @returns [pda, bump]
 */
export function findExtraAccountMetaListPda(
    mint: PublicKey,
    hookProgramId: PublicKey,
): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mint.toBuffer()],
        hookProgramId,
    );
}
