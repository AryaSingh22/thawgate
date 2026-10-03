/**
 * @module gate/tokenAcl
 * @description Token ACL (sRFC 37) instructions on @solana/web3.js v1.
 *
 * Hand-built from @token-acl/sdk 0.2.7's generated code, which is @solana/kit-based (and its `*WithExtraMetas`
 * builders print to the console). tests/tokenAcl.test.ts pins every builder here byte-for-byte against it. Extra
 * account metas resolve with @solana/spl-token's resolver, the same algorithm @token-acl/sdk uses.
 */

import {
    AccountMeta,
    Connection,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getExtraAccountMetas, resolveExtraAccountMeta } from "@solana/spl-token";
import { TOKEN_ACL_PROGRAM_ID } from "../programs";

/** Token ACL instruction discriminators (one byte). */
export const TOKEN_ACL_IX = {
    createConfig: 0,
    setAuthority: 1,
    setGatingProgram: 2,
    deleteConfig: 3,
    thaw: 4,
    freeze: 5,
    thawPermissionless: 6,
    freezePermissionless: 7,
    togglePermissionlessInstructions: 8,
    thawPermissionlessIdempotent: 9,
    freezePermissionlessIdempotent: 10,
} as const;

/** `["MINT_CONFIG", mint]` under Token ACL. */
export function findMintConfigPda(mint: PublicKey, programId: PublicKey = TOKEN_ACL_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("MINT_CONFIG"), mint.toBuffer()], programId)[0];
}

/** `["FLAG_ACCOUNT", tokenAccount]` under Token ACL: created and closed inside a permissionless thaw or freeze. */
export function findFlagAccountPda(tokenAccount: PublicKey, programId: PublicKey = TOKEN_ACL_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("FLAG_ACCOUNT"), tokenAccount.toBuffer()], programId)[0];
}

/** The gating program's extra-metas list for permissionless thaw: `["thaw_extra_account_metas", mint]` under the gate. */
export function findThawExtraMetasPda(mint: PublicKey, gatingProgram: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("thaw_extra_account_metas"), mint.toBuffer()], gatingProgram)[0];
}

/** The gating program's extra-metas list for permissionless freeze: `["freeze_extra_account_metas", mint]`. */
export function findFreezeExtraMetasPda(mint: PublicKey, gatingProgram: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("freeze_extra_account_metas"), mint.toBuffer()], gatingProgram)[0];
}

/** Token ACL's per-mint config. `freezeAuthority` may freeze, thaw and change the gate; it is the mint's freeze authority. */
export interface MintConfig {
    bump: number;
    enablePermissionlessThaw: boolean;
    enablePermissionlessFreeze: boolean;
    mint: PublicKey;
    freezeAuthority: PublicKey;
    gatingProgram: PublicKey;
}

/** u8 discriminator (1), bump, two flags, then three pubkeys. */
export const MINT_CONFIG_SIZE = 100;

export function decodeMintConfig(data: Buffer | Uint8Array): MintConfig {
    const b = Buffer.from(data);
    if (b.length < MINT_CONFIG_SIZE || b[0] !== 1) throw new Error("not a Token ACL MintConfig");
    return {
        bump: b[1],
        enablePermissionlessThaw: b[2] !== 0,
        enablePermissionlessFreeze: b[3] !== 0,
        mint: new PublicKey(b.subarray(4, 36)),
        freezeAuthority: new PublicKey(b.subarray(36, 68)),
        gatingProgram: new PublicKey(b.subarray(68, 100)),
    };
}

/** The mint's Token ACL config, or `null` if the mint has none (it is not a Token ACL mint). */
export async function fetchMintConfig(connection: Connection, mint: PublicKey): Promise<MintConfig | null> {
    const info = await connection.getAccountInfo(findMintConfigPda(mint));
    if (!info || !info.owner.equals(TOKEN_ACL_PROGRAM_ID)) return null;
    return decodeMintConfig(info.data);
}

/** Switch the mint's gating program. Signed by the MintConfig freeze authority. */
export function setGatingProgramIx(args: { authority: PublicKey; mint: PublicKey; gatingProgram: PublicKey }): TransactionInstruction {
    return new TransactionInstruction({
        programId: TOKEN_ACL_PROGRAM_ID,
        keys: [
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: findMintConfigPda(args.mint), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([Buffer.from([TOKEN_ACL_IX.setGatingProgram]), args.gatingProgram.toBuffer()]),
    });
}

/** Enable or disable permissionless freeze and thaw. Signed by the MintConfig freeze authority. */
export function togglePermissionlessIx(args: { authority: PublicKey; mint: PublicKey; freeze: boolean; thaw: boolean }): TransactionInstruction {
    return new TransactionInstruction({
        programId: TOKEN_ACL_PROGRAM_ID,
        keys: [
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: findMintConfigPda(args.mint), isSigner: false, isWritable: true },
        ],
        data: Buffer.from([TOKEN_ACL_IX.togglePermissionlessInstructions, args.freeze ? 1 : 0, args.thaw ? 1 : 0]),
    });
}

/**
 * A permissionless Token ACL instruction. The idempotent variants return early, without calling the gate, when the
 * account is already in the target state.
 */
export type PermissionlessKind = "thaw" | "thawIdempotent" | "freeze" | "freezeIdempotent";

const DISC: Record<PermissionlessKind, number> = {
    thaw: TOKEN_ACL_IX.thawPermissionless,
    thawIdempotent: TOKEN_ACL_IX.thawPermissionlessIdempotent,
    freeze: TOKEN_ACL_IX.freezePermissionless,
    freezeIdempotent: TOKEN_ACL_IX.freezePermissionlessIdempotent,
};

export interface PermissionlessArgs {
    /** Signs and pays for the flag account's rent (refunded in the same instruction). Anyone may call. */
    caller: PublicKey;
    mint: PublicKey;
    tokenAccount: PublicKey;
    /** The token account's owner. Token ACL checks it against the account. */
    owner: PublicKey;
    /** The mint's config, if already fetched. */
    mintConfig?: MintConfig;
}

/**
 * Builds `thaw_permissionless` / `freeze_permissionless` (or an idempotent variant) with the gating program's extra
 * accounts resolved, like @token-acl/sdk's `create*InstructionWithExtraMetas`.
 *
 * The gate receives `[caller, token_account, mint, owner, flag_account, extra_metas, ...extras]`. Its meta list's
 * seeds index into that list, so the resolver starts from those six accounts and appends each resolved meta in turn
 * (a later seed can reference an earlier extra, e.g. the attestation's credential and schema).
 */
export async function permissionlessIx(connection: Connection, kind: PermissionlessKind, args: PermissionlessArgs): Promise<TransactionInstruction> {
    const mintConfig = args.mintConfig ?? (await fetchMintConfig(connection, args.mint));
    if (!mintConfig) throw new Error(`mint ${args.mint.toBase58()} has no Token ACL MintConfig`);
    const gating = mintConfig.gatingProgram;
    const flag = findFlagAccountPda(args.tokenAccount);
    const isThaw = kind === "thaw" || kind === "thawIdempotent";
    const extraMetas = isThaw ? findThawExtraMetasPda(args.mint, gating) : findFreezeExtraMetasPda(args.mint, gating);
    const data = Buffer.from([DISC[kind]]);

    const keys: AccountMeta[] = [
        { pubkey: args.caller, isSigner: true, isWritable: false },
        { pubkey: args.mint, isSigner: false, isWritable: false },
        { pubkey: args.tokenAccount, isSigner: false, isWritable: true },
        { pubkey: flag, isSigner: false, isWritable: true },
        { pubkey: args.owner, isSigner: false, isWritable: false },
        { pubkey: findMintConfigPda(args.mint), isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: gating, isSigner: false, isWritable: false },
    ];

    const list = await connection.getAccountInfo(extraMetas);
    if (!list) throw new Error(`the gating program's ${isThaw ? "thaw" : "freeze"} extra-metas account ${extraMetas.toBase58()} does not exist`);
    if (!list.owner.equals(gating)) throw new Error(`extra-metas account ${extraMetas.toBase58()} is not owned by the gating program`);

    const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
    const resolved: AccountMeta[] = [ro(args.caller), ro(args.tokenAccount), ro(args.mint), ro(args.owner), ro(flag), ro(extraMetas)];
    for (const meta of getExtraAccountMetas(list)) {
        resolved.push(await resolveExtraAccountMeta(connection, meta, resolved, data, gating));
    }
    return new TransactionInstruction({ programId: TOKEN_ACL_PROGRAM_ID, keys: [...keys, ...resolved.slice(5)], data });
}
