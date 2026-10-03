// Pins the SDK's hand-built Token ACL instructions byte-for-byte against @token-acl/sdk 0.2.7 (a devDependency,
// kit-based), including the extra-account-meta resolution, over the same fake accounts.
import { address, createNoopSigner } from "@solana/kit";
import { AccountInfo, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
    createFreezePermissionlessIdempotentInstructionWithExtraMetas,
    createFreezePermissionlessInstructionWithExtraMetas,
    createThawPermissionlessIdempotentInstructionWithExtraMetas,
    createThawPermissionlessInstructionWithExtraMetas,
    findFlagAccountPda as kitFlag,
    findFreezeExtraMetasAccountPda as kitFreezeMetas,
    findMintConfigPda as kitMintConfig,
    findThawExtraMetasAccountPda as kitThawMetas,
    getMintConfigEncoder,
    getSetGatingProgramInstruction,
    getTogglePermissionlessInstructionsInstruction,
} from "@token-acl/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAS_PROGRAM_ID, SSS_TOKEN_PROGRAM_ID, THAWGATE_GATE_PROGRAM_ID, TOKEN_ACL_PROGRAM_ID } from "../src/programs";
import {
    PermissionlessKind,
    decodeMintConfig,
    findFlagAccountPda,
    findFreezeExtraMetasPda,
    findMintConfigPda,
    findThawExtraMetasPda,
    permissionlessIx,
    setGatingProgramIx,
    togglePermissionlessIx,
} from "../src/gate/tokenAcl";
import { fromKit, fromWeb3 } from "./pins";

const key = (seed: number) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + seed) & 0xff)).publicKey;
const mint = key(1);
const caller = key(2);
const owner = key(3);
const tokenAccount = key(4);
const freezeAuthority = key(5);
const credential = key(6);
const schema = key(7);
const GATE = THAWGATE_GATE_PROGRAM_ID;
const kitAddr = (p: PublicKey) => address(p.toBase58());

// --- an extra-metas list in the gate's layout (programs/thawgate-gate/src/metas.rs), blacklist + allowlist + SAS
const literal = (s: string) => [1, s.length, ...Buffer.from(s)];
const accountKey = (i: number) => [3, i];
const meta = (discriminator: number, config: number[]) => {
    const b = Buffer.alloc(35);
    b[0] = discriminator;
    Buffer.from(config).copy(b, 1);
    return b; // is_signer = is_writable = false
};
const fixed = (p: PublicKey) => meta(0, [...p.toBuffer()]);
const metas = [
    meta(1, [...literal("policy"), ...accountKey(2)]), // [6] the policy, a gate PDA
    fixed(SSS_TOKEN_PROGRAM_ID), // [7] issuer program
    meta(128 + 7, [...literal("blacklist"), ...accountKey(2), ...accountKey(3)]), // [8]
    meta(128 + 7, [...literal("allowlist"), ...accountKey(2), ...accountKey(3)]), // [9]
    fixed(SAS_PROGRAM_ID), // [10]
    fixed(credential), // [11]
    fixed(schema), // [12]
    meta(128 + 10, [...literal("attestation"), ...accountKey(11), ...accountKey(12), ...accountKey(3)]), // [13]
];
const metaList = (ixDiscriminator: number[]) => {
    const header = Buffer.alloc(16);
    Buffer.from(ixDiscriminator).copy(header, 0);
    header.writeUInt32LE(4 + 35 * metas.length, 8);
    header.writeUInt32LE(metas.length, 12);
    return Buffer.concat([header, ...metas]);
};

function store(mintConfig: { thaw: boolean; freeze: boolean; gate: PublicKey }) {
    const accounts = new Map<string, AccountInfo<Buffer>>();
    const put = (at: PublicKey, owner: PublicKey, data: Buffer) =>
        accounts.set(at.toBase58(), { data, owner, executable: false, lamports: 1_000_000 });
    put(
        findMintConfigPda(mint),
        TOKEN_ACL_PROGRAM_ID,
        Buffer.from(
            getMintConfigEncoder().encode({
                discriminator: 1,
                bump: 254,
                enablePermissionlessThaw: mintConfig.thaw,
                enablePermissionlessFreeze: mintConfig.freeze,
                mint: kitAddr(mint),
                freezeAuthority: kitAddr(freezeAuthority),
                gatingProgram: kitAddr(mintConfig.gate),
            }),
        ),
    );
    put(findThawExtraMetasPda(mint, mintConfig.gate), mintConfig.gate, metaList([8, 175, 169, 129, 137, 74, 61, 241]));
    put(findFreezeExtraMetasPda(mint, mintConfig.gate), mintConfig.gate, metaList([214, 141, 109, 75, 248, 1, 45, 29]));
    const connection = { getAccountInfo: async (p: PublicKey) => accounts.get(p.toBase58()) ?? null } as unknown as Connection;
    const retriever = async (a: string) => {
        const info = accounts.get(a);
        return info
            ? { exists: true as const, address: a, data: Uint8Array.from(info.data), executable: false, lamports: 1_000_000n, programAddress: info.owner.toBase58(), space: BigInt(info.data.length) }
            : { exists: false as const, address: a };
    };
    return { connection, retriever, accounts };
}

describe("Token ACL PDAs", () => {
    it("match @token-acl/sdk", async () => {
        expect(findMintConfigPda(mint).toBase58()).toBe((await kitMintConfig({ mint: kitAddr(mint) }))[0]);
        expect(findFlagAccountPda(tokenAccount).toBase58()).toBe((await kitFlag({ tokenAccount: kitAddr(tokenAccount) }))[0]);
        expect(findThawExtraMetasPda(mint, GATE).toBase58()).toBe((await kitThawMetas({ mint: kitAddr(mint) }, { programAddress: kitAddr(GATE) }))[0]);
        expect(findFreezeExtraMetasPda(mint, GATE).toBase58()).toBe((await kitFreezeMetas({ mint: kitAddr(mint) }, { programAddress: kitAddr(GATE) }))[0]);
    });

    it("decodeMintConfig reads @token-acl/sdk's encoding", () => {
        const { accounts } = store({ thaw: true, freeze: false, gate: GATE });
        const cfg = decodeMintConfig(accounts.get(findMintConfigPda(mint).toBase58())!.data);
        expect(cfg).toMatchObject({ bump: 254, enablePermissionlessThaw: true, enablePermissionlessFreeze: false });
        expect(cfg.freezeAuthority.equals(freezeAuthority) && cfg.gatingProgram.equals(GATE) && cfg.mint.equals(mint)).toBe(true);
        expect(() => decodeMintConfig(Buffer.alloc(100))).toThrow(/MintConfig/);
    });
});

describe("Token ACL admin instructions", () => {
    it("set_gating_program (disc 2)", () => {
        const theirs = getSetGatingProgramInstruction({
            authority: createNoopSigner(kitAddr(freezeAuthority)),
            mintConfig: kitAddr(findMintConfigPda(mint)),
            newGatingProgram: kitAddr(GATE),
        });
        expect(fromWeb3(setGatingProgramIx({ authority: freezeAuthority, mint, gatingProgram: GATE }))).toEqual(fromKit(theirs));
    });

    it("toggle_permissionless_instructions (disc 8)", () => {
        const theirs = getTogglePermissionlessInstructionsInstruction({
            authority: createNoopSigner(kitAddr(freezeAuthority)),
            mintConfig: kitAddr(findMintConfigPda(mint)),
            freezeEnabled: true,
            thawEnabled: false,
        });
        expect(fromWeb3(togglePermissionlessIx({ authority: freezeAuthority, mint, freeze: true, thaw: false }))).toEqual(fromKit(theirs));
    });
});

describe("permissionless thaw / freeze with extra metas", () => {
    // @token-acl/sdk 0.2.7's *WithExtraMetas builders print their inputs.
    beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
    afterEach(() => vi.restoreAllMocks());

    const reference: Record<PermissionlessKind, typeof createThawPermissionlessInstructionWithExtraMetas> = {
        thaw: createThawPermissionlessInstructionWithExtraMetas,
        thawIdempotent: createThawPermissionlessIdempotentInstructionWithExtraMetas,
        freeze: createFreezePermissionlessInstructionWithExtraMetas,
        freezeIdempotent: createFreezePermissionlessIdempotentInstructionWithExtraMetas,
    };

    for (const kind of Object.keys(reference) as PermissionlessKind[]) {
        it(`${kind}: same accounts, flags and data`, async () => {
            const { connection, retriever } = store({ thaw: true, freeze: true, gate: GATE });
            const ours = await permissionlessIx(connection, kind, { caller, mint, tokenAccount, owner });
            const theirs = await reference[kind](
                createNoopSigner(kitAddr(caller)),
                kitAddr(tokenAccount),
                kitAddr(mint),
                kitAddr(owner),
                kitAddr(TOKEN_ACL_PROGRAM_ID),
                retriever as never,
            );
            expect(fromWeb3(ours)).toEqual(fromKit(theirs));
            // 9 base accounts + the extra-metas list + the 8 resolved extras.
            expect(ours.keys).toHaveLength(18);
        });
    }

    it("the gating program comes from the MintConfig", async () => {
        const other = key(9);
        const { connection } = store({ thaw: true, freeze: true, gate: other });
        const ix = await permissionlessIx(connection, "thaw", { caller, mint, tokenAccount, owner });
        expect(ix.keys[8].pubkey.equals(other)).toBe(true);
        expect(ix.keys[9].pubkey.equals(findThawExtraMetasPda(mint, other))).toBe(true);
    });

    it("refuses a mint without a MintConfig, and a list the gate doesn't own", async () => {
        const { connection, accounts } = store({ thaw: true, freeze: true, gate: GATE });
        await expect(permissionlessIx(connection, "thaw", { caller, mint: key(10), tokenAccount, owner })).rejects.toThrow(/no Token ACL MintConfig/);
        const list = accounts.get(findThawExtraMetasPda(mint, GATE).toBase58())!;
        accounts.set(findThawExtraMetasPda(mint, GATE).toBase58(), { ...list, owner: key(11) });
        await expect(permissionlessIx(connection, "thaw", { caller, mint, tokenAccount, owner })).rejects.toThrow(/not owned by the gating program/);
    });
});
