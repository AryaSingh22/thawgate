/**
 * @module gate/client
 * @description GateClient: ThawGate policies and the holder-side flows (unlock, explain, freeze-if-invalid) for any
 * Token ACL mint gated by ThawGate, whoever issued it. sss-token mints get it as `SolanaStablecoin#gate`.
 *
 * @example
 * ```ts
 * const gate = new GateClient(connection, wallet);
 * const why = await gate.explain(mint, holder);          // simulate: may this wallet unlock? why not?
 * await gate.send(await gate.createAtaAndThaw(mint, holder));
 * await gate.freezeIfInvalid(tokenAccount);             // freezes only if the gate allows it
 * ```
 */

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
    AccountInfo,
    Commitment,
    Connection,
    PublicKey,
    Signer,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import {
    TOKEN_2022_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    createUpdateFieldInstruction,
    getAssociatedTokenAddressSync,
    getTokenMetadata,
    unpackAccount,
} from "@solana/spl-token";

/** The mint metadata field Token ACL clients read to find a mint's gate (@token-acl/sdk `TOKEN_ACL_METADATA_KEY`). */
export const TOKEN_ACL_METADATA_KEY = "token_acl";
import GATE_IDL from "./idl.json";
import type { ThawgateGate } from "./idl-type";
import { SSS_TOKEN_PROGRAM_ID, THAWGATE_GATE_PROGRAM_ID } from "../programs";
import { findConfigPda } from "../pda";
import { GateAction, GateVerdict, classifyGateLogs } from "./reasons";
import {
    MintConfig,
    PermissionlessKind,
    fetchMintConfig,
    findFreezeExtraMetasPda,
    findMintConfigPda,
    findThawExtraMetasPda,
    permissionlessIx,
    setGatingProgramIx,
    togglePermissionlessIx,
} from "./tokenAcl";

/** An Anchor-style wallet: a public key that signs transactions. `keypairWallet(keypair)` makes one. */
export type GateWallet = AnchorProvider["wallet"];

/** How the issuer's allowlist is used. `bypassForPdas` lets allowlisted program-owned accounts (pool vaults) skip SAS. */
export type AllowlistMode = "off" | "allowOnly" | "bypassForPdas";

/** A policy, as you write it. Every field is optional; the defaults are off. */
export interface PolicyInput {
    /** Deny holders with an active blacklist entry in the issuer program. */
    checkBlacklist?: boolean;
    allowlistMode?: AllowlistMode;
    /** Require a live SAS attestation (nonce = the holder's wallet) under this credential and schema. `null` turns SAS off. */
    sas?: { credential: PublicKey; schema: PublicKey; minKycLevel?: number } | null;
    /** Owner of the blacklist/allowlist entries. Default: sss-token when either list is on. Ignored by `enableTokenAcl`. */
    issuerProgram?: PublicKey;
    /** Who may change the policy. Default: the payer. Ignored by `enableTokenAcl` (it uses the issuer's authority). */
    authority?: PublicKey;
}

/** A policy as stored on chain (`["policy", mint]` under the gate). */
export interface GatePolicy {
    address: PublicKey;
    version: number;
    mint: PublicKey;
    authority: PublicKey;
    issuerProgram: PublicKey;
    checkBlacklist: boolean;
    allowlistMode: AllowlistMode;
    requireSas: boolean;
    sasCredential: PublicKey;
    sasSchema: PublicKey;
    minKycLevel: number;
}

/** What `explain` found. */
export interface Explanation {
    mint: PublicKey;
    wallet: PublicKey;
    tokenAccount: PublicKey;
    /** The token account before the simulation. */
    account: "missing" | "frozen" | "thawed";
    /**
     * - `can_unlock`: the account is missing or frozen, and a permissionless thaw would succeed.
     * - `denied`: a thaw would be refused (`code` says why).
     * - `compliant`: the account is thawed and nobody can freeze it permissionlessly.
     * - `freezable`: the account is thawed, but the policy flags the owner, so anyone can freeze it (`code` says why).
     * - `not_token_acl`, `permissionless_disabled`, `error`: see `reason`.
     */
    status: "can_unlock" | "denied" | "compliant" | "freezable" | "not_token_acl" | "permissionless_disabled" | "error";
    /** The gate's reason code (`KYC`, `NO_CREDENTIAL`, …), or null when the gate did not decide. */
    code: string | null;
    /** One sentence for a person. */
    reason: string;
    /** What was simulated: a thaw (missing or frozen account) or a freeze (thawed account). */
    simulated: GateAction | null;
    gatingProgram: PublicKey | null;
    verdict: GateVerdict | null;
    logs: string[];
}

export interface FreezeResult {
    frozen: boolean;
    /** It was frozen before this call. */
    alreadyFrozen: boolean;
    code: string | null;
    reason: string;
    signature?: string;
}

const ALLOWLIST_TO_ANCHOR: Record<AllowlistMode, object> = { off: { off: {} }, allowOnly: { allowOnly: {} }, bypassForPdas: { bypassForPdas: {} } };

function allowlistFromAnchor(mode: Record<string, unknown>): AllowlistMode {
    const k = Object.keys(mode)[0];
    if (k === "off" || k === "allowOnly" || k === "bypassForPdas") return k;
    throw new Error(`unknown allowlist mode ${k}`);
}

/** sss-token's `GatePolicyConfig` (the `enable_token_acl` argument) from a PolicyInput. */
export function toGatePolicyConfig(p: PolicyInput) {
    return {
        checkBlacklist: p.checkBlacklist ?? false,
        allowlistMode: ALLOWLIST_TO_ANCHOR[p.allowlistMode ?? "off"],
        requireSas: !!p.sas,
        sasCredential: p.sas?.credential ?? PublicKey.default,
        sasSchema: p.sas?.schema ?? PublicKey.default,
        minKycLevel: p.sas?.minKycLevel ?? 0,
    };
}

/** The gate's `PolicyArgs` from a PolicyInput; `authority` is the fallback policy admin. */
function toPolicyArgs(p: PolicyInput, authority: PublicKey) {
    const listsOn = !!p.checkBlacklist || (p.allowlistMode ?? "off") !== "off";
    return {
        authority: p.authority ?? authority,
        issuerProgram: p.issuerProgram ?? (listsOn ? SSS_TOKEN_PROGRAM_ID : PublicKey.default),
        ...toGatePolicyConfig(p),
    };
}

/** A stored policy as a PolicyInput, so `updatePolicy` can apply changes on top of it. */
function policyToInput(p: GatePolicy): PolicyInput {
    return {
        checkBlacklist: p.checkBlacklist,
        allowlistMode: p.allowlistMode,
        sas: p.requireSas ? { credential: p.sasCredential, schema: p.sasSchema, minKycLevel: p.minKycLevel } : null,
        issuerProgram: p.issuerProgram,
        authority: p.authority,
    };
}

export interface GateClientOptions {
    /** Default: the devnet ThawGate deployment. */
    gateProgramId?: PublicKey;
    commitment?: Commitment;
}

export class GateClient {
    readonly program: Program<ThawgateGate>;
    readonly gateProgramId: PublicKey;
    private readonly commitment: Commitment;

    /**
     * @param connection - RPC connection.
     * @param wallet - Signs and pays. Optional for read-only use (`explain`, `getPolicy`, builders with explicit payers).
     */
    constructor(
        readonly connection: Connection,
        readonly wallet?: GateWallet,
        opts: GateClientOptions = {},
    ) {
        this.gateProgramId = opts.gateProgramId ?? THAWGATE_GATE_PROGRAM_ID;
        this.commitment = opts.commitment ?? "confirmed";
        const provider = wallet
            ? new AnchorProvider(connection, wallet, { commitment: this.commitment, preflightCommitment: this.commitment })
            : ({ connection, publicKey: PublicKey.default } as unknown as AnchorProvider);
        this.program = new Program<ThawgateGate>({ ...(GATE_IDL as ThawgateGate), address: this.gateProgramId.toBase58() }, provider);
    }

    private me(what: string): PublicKey {
        if (!this.wallet) throw new Error(`${what} needs a wallet (or an explicit payer/authority)`);
        return this.wallet.publicKey;
    }

    /** `["policy", mint]` under the gate. */
    policyAddress(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("policy"), mint.toBuffer()], this.gateProgramId)[0];
    }

    /** The mint's Token ACL config (freeze authority, gating program, permissionless flags), or null. */
    getMintConfig(mint: PublicKey): Promise<MintConfig | null> {
        return fetchMintConfig(this.connection, mint);
    }

    /** The mint's ThawGate policy, or null if it has none. */
    async getPolicy(mint: PublicKey): Promise<GatePolicy | null> {
        const address = this.policyAddress(mint);
        const p = await this.program.account.gatePolicy.fetchNullable(address);
        if (!p) return null;
        return {
            address,
            version: p.version,
            mint: p.mint,
            authority: p.authority,
            issuerProgram: p.issuerProgram,
            checkBlacklist: p.checkBlacklist,
            allowlistMode: allowlistFromAnchor(p.allowlistMode as Record<string, unknown>),
            requireSas: p.requireSas,
            sasCredential: p.sasCredential,
            sasSchema: p.sasSchema,
            minKycLevel: p.minKycLevel,
        };
    }

    private metasAccounts(mint: PublicKey) {
        return {
            policy: this.policyAddress(mint),
            mint,
            thawExtraMetas: findThawExtraMetasPda(mint, this.gateProgramId),
            freezeExtraMetas: findFreezeExtraMetasPda(mint, this.gateProgramId),
            systemProgram: SystemProgram.programId,
        };
    }

    /** Refuses mints whose Token ACL freeze authority is sss-token's config PDA: those get their policy from `enable_token_acl`. */
    private async freezeAuthorityOf(mint: PublicKey): Promise<MintConfig> {
        const config = await fetchMintConfig(this.connection, mint);
        if (!config) throw new Error(`mint ${mint.toBase58()} has no Token ACL MintConfig: create one with Token ACL's create_config first`);
        if (config.freezeAuthority.equals(findConfigPda(mint, SSS_TOKEN_PROGRAM_ID)[0])) {
            throw new Error("this mint's Token ACL freeze authority is sss-token's config PDA: sss-token's enable_token_acl creates its policy; change it with updatePolicy");
        }
        return config;
    }

    /**
     * Create the mint's policy and write both extra-metas lists. Signed by the Token ACL freeze authority of the mint
     * (not for sss-token mints: `enableTokenAcl` does this there). The gating program is not switched; `swapGate` does both.
     */
    async initPolicy(mint: PublicKey, policy: PolicyInput, opts: { freezeAuthority?: PublicKey; payer?: PublicKey } = {}): Promise<TransactionInstruction[]> {
        const config = await this.freezeAuthorityOf(mint);
        const freezeAuthority = opts.freezeAuthority ?? this.me("initPolicy");
        if (!config.freezeAuthority.equals(freezeAuthority)) {
            throw new Error(`${freezeAuthority.toBase58()} is not the mint's Token ACL freeze authority (${config.freezeAuthority.toBase58()})`);
        }
        const payer = opts.payer ?? this.wallet?.publicKey ?? freezeAuthority;
        const ix = await this.program.methods
            .initPolicy(toPolicyArgs(policy, payer) as never)
            .accountsStrict({ freezeAuthority, payer, mintConfig: findMintConfigPda(mint), ...this.metasAccounts(mint) })
            .instruction();
        return [ix];
    }

    /**
     * Change the policy and rewrite both extra-metas lists. `changes` apply on top of the stored policy (`sas: null`
     * turns SAS off). Signed by the policy authority: the issuer's wallet on sss-token mints.
     */
    async updatePolicy(mint: PublicKey, changes: PolicyInput, opts: { authority?: PublicKey; payer?: PublicKey } = {}): Promise<TransactionInstruction[]> {
        const current = await this.getPolicy(mint);
        if (!current) throw new Error(`mint ${mint.toBase58()} has no ThawGate policy`);
        const authority = opts.authority ?? this.wallet?.publicKey ?? current.authority;
        const merged: PolicyInput = { ...policyToInput(current), ...changes };
        const ix = await this.program.methods
            .updatePolicy(toPolicyArgs(merged, current.authority) as never)
            .accountsStrict({ authority, payer: opts.payer ?? authority, ...this.metasAccounts(mint) })
            .instruction();
        return [ix];
    }

    /** Rewrite both extra-metas lists from the stored policy (idempotent). Signed by the policy authority. */
    async setupExtraMetas(mint: PublicKey, opts: { authority?: PublicKey; payer?: PublicKey } = {}): Promise<TransactionInstruction[]> {
        const current = await this.getPolicy(mint);
        if (!current) throw new Error(`mint ${mint.toBase58()} has no ThawGate policy`);
        const authority = opts.authority ?? this.wallet?.publicKey ?? current.authority;
        const ix = await this.program.methods
            .setupExtraMetas()
            .accountsStrict({ authority, payer: opts.payer ?? authority, ...this.metasAccounts(mint) })
            .instruction();
        return [ix];
    }

    /**
     * Move an existing Token ACL mint (e.g. on the ABL gate) to ThawGate in one transaction: create the policy (or
     * rewrite it if it exists), `set_gating_program` to ThawGate, and enable permissionless thaw and freeze if either
     * is off. Signed by the mint's Token ACL freeze authority.
     *
     * Token ACL clients that find the gate through the mint's `token_acl` metadata field (@token-acl/sdk's `*FromMint`
     * builders) would keep resolving the old gate's accounts, so the field is updated too when it names another gate.
     * That needs the metadata update authority (`metadataAuthority`, default the freeze authority); pass
     * `skipMetadata: true` to leave it.
     */
    async swapGate(
        mint: PublicKey,
        policy: PolicyInput,
        opts: { freezeAuthority?: PublicKey; payer?: PublicKey; metadataAuthority?: PublicKey; skipMetadata?: boolean } = {},
    ): Promise<TransactionInstruction[]> {
        const config = await this.freezeAuthorityOf(mint);
        const authority = opts.freezeAuthority ?? this.me("swapGate");
        const payer = opts.payer ?? this.wallet?.publicKey ?? authority;
        const ixs = (await this.getPolicy(mint))
            ? await this.updatePolicy(mint, policy, { authority, payer })
            : await this.initPolicy(mint, policy, { freezeAuthority: authority, payer });
        if (!config.gatingProgram.equals(this.gateProgramId)) ixs.push(setGatingProgramIx({ authority, mint, gatingProgram: this.gateProgramId }));
        if (!config.enablePermissionlessThaw || !config.enablePermissionlessFreeze) {
            ixs.push(togglePermissionlessIx({ authority, mint, freeze: true, thaw: true }));
        }
        if (!opts.skipMetadata) ixs.push(...(await this.tokenAclMetadataIxs(mint, opts.metadataAuthority ?? authority, payer)));
        return ixs;
    }

    /** Point the mint's `token_acl` metadata field at this gate, if the mint has the field and it names another program. */
    private async tokenAclMetadataIxs(mint: PublicKey, updateAuthority: PublicKey, payer: PublicKey): Promise<TransactionInstruction[]> {
        const gate = this.gateProgramId.toBase58();
        const meta = await getTokenMetadata(this.connection, mint, this.commitment, TOKEN_2022_PROGRAM_ID).catch(() => null);
        const current = meta?.additionalMetadata.find(([k]) => k === TOKEN_ACL_METADATA_KEY)?.[1];
        if (!meta || current === undefined || current === gate) return [];
        if (!meta.updateAuthority?.equals(updateAuthority)) {
            throw new Error(
                `the mint's "${TOKEN_ACL_METADATA_KEY}" metadata names ${current}; its update authority ${meta.updateAuthority?.toBase58() ?? "(none)"} must sign ` +
                    "to point it at ThawGate (pass metadataAuthority), or pass skipMetadata: true",
            );
        }
        const ixs: TransactionInstruction[] = [];
        const grow = Buffer.byteLength(gate) - Buffer.byteLength(current);
        if (grow > 0) {
            const info = (await this.connection.getAccountInfo(mint))!;
            const need = (await this.connection.getMinimumBalanceForRentExemption(info.data.length + grow)) - info.lamports;
            if (need > 0) ixs.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: mint, lamports: need }));
        }
        ixs.push(createUpdateFieldInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority, field: TOKEN_ACL_METADATA_KEY, value: gate }));
        return ixs;
    }

    /** The owner's associated token account for a Token-2022 mint (off-curve owners allowed). */
    ata(mint: PublicKey, owner: PublicKey): PublicKey {
        return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
    }

    /**
     * Create the owner's ATA if missing, then thaw it permissionlessly through the gate (idempotent: a thawed account
     * stays as is). Anyone can pay; the owner doesn't sign. If the gate would deny, the transaction fails: call
     * `explain` first for the reason.
     */
    async createAtaAndThaw(mint: PublicKey, owner: PublicKey, opts: { payer?: PublicKey } = {}): Promise<TransactionInstruction[]> {
        const payer = opts.payer ?? this.me("createAtaAndThaw");
        const tokenAccount = this.ata(mint, owner);
        return [
            createAssociatedTokenAccountIdempotentInstruction(payer, tokenAccount, owner, mint, TOKEN_2022_PROGRAM_ID),
            await permissionlessIx(this.connection, "thawIdempotent", { caller: payer, mint, tokenAccount, owner }),
        ];
    }

    private async readTokenAccount(address: PublicKey, info?: AccountInfo<Buffer> | null) {
        const raw = info === undefined ? await this.connection.getAccountInfo(address) : info;
        return raw ? unpackAccount(address, raw, TOKEN_2022_PROGRAM_ID) : null;
    }

    /**
     * Why may (or can't) this wallet hold the token? Simulates the permissionless instruction that applies, with no
     * signature and no state change:
     * - the wallet's account is missing or frozen: create-ATA + thaw (would it unlock?);
     * - it is thawed: freeze (could anyone freeze it?).
     *
     * The fee payer of the simulation must exist and, for a missing account, afford the ATA rent: `opts.payer`, else the
     * client's wallet, else the policy authority.
     */
    async explain(mint: PublicKey, wallet: PublicKey, opts: { payer?: PublicKey; tokenAccount?: PublicKey } = {}): Promise<Explanation> {
        const tokenAccount = opts.tokenAccount ?? this.ata(mint, wallet);
        const base = { mint, wallet, tokenAccount, simulated: null, gatingProgram: null, verdict: null, logs: [] as string[], code: null };
        const [config, info] = await Promise.all([fetchMintConfig(this.connection, mint), this.connection.getAccountInfo(tokenAccount)]);
        const account = info ? ((await this.readTokenAccount(tokenAccount, info))!.isFrozen ? "frozen" : "thawed") : "missing";
        if (account === "missing" && opts.tokenAccount) {
            return { ...base, account, status: "error", reason: `Token account ${tokenAccount.toBase58()} does not exist (only the wallet's ATA is created here).` };
        }
        if (!config) {
            return { ...base, account, status: "not_token_acl", reason: "This mint has no Token ACL config, so no gate decides who may hold it." };
        }
        const action: GateAction = account === "thawed" ? "freeze" : "thaw";
        const gating = { ...base, account, gatingProgram: config.gatingProgram, simulated: action } as const;
        if (action === "thaw" ? !config.enablePermissionlessThaw : !config.enablePermissionlessFreeze) {
            return { ...gating, status: "permissionless_disabled", reason: `Permissionless ${action} is turned off for this mint; only its freeze authority can ${action}.` };
        }

        const payer = opts.payer ?? this.wallet?.publicKey ?? (await this.getPolicy(mint))?.authority ?? wallet;
        const ixs: TransactionInstruction[] = [];
        if (account === "missing") ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, tokenAccount, wallet, mint, TOKEN_2022_PROGRAM_ID));
        const kind: PermissionlessKind = action;
        ixs.push(await permissionlessIx(this.connection, kind, { caller: payer, mint, tokenAccount, owner: wallet, mintConfig: config }));

        const sim = await this.simulate(ixs, payer);
        const verdict = classifyGateLogs(sim.logs, sim.err === null, action, { gateId: this.gateProgramId.toBase58(), errorCode: sim.errorCode });
        const result = { ...gating, verdict, logs: sim.logs };
        const foreign = !config.gatingProgram.equals(this.gateProgramId);
        if (verdict.outcome === "failed") {
            const hint = sim.payerMissing ? ` The fee payer ${payer.toBase58()} has no SOL on this cluster: pass { payer }.` : "";
            return { ...result, status: "error", reason: verdict.reason + hint };
        }
        if (foreign) {
            // Another gating program: its logs carry no ThawGate codes, so report only the outcome.
            const ok = verdict.outcome === "allowed";
            const status = action === "thaw" ? (ok ? "can_unlock" : "denied") : ok ? "freezable" : "compliant";
            return { ...result, status, reason: `The mint's gating program ${config.gatingProgram.toBase58()} (not ThawGate) ${ok ? "allows" : "refuses"} a permissionless ${action}; it logs no ThawGate reason codes.` };
        }
        const code = verdict.outcome === "allowed" || verdict.outcome === "denied" ? verdict.code : null;
        const status = action === "thaw" ? (verdict.outcome === "denied" ? "denied" : "can_unlock") : verdict.outcome === "allowed" ? "freezable" : "compliant";
        return { ...result, status, code, reason: verdict.reason };
    }

    /**
     * Freeze `tokenAccount` permissionlessly if, and only if, the gate allows it (the policy flags its owner). Simulates
     * first and sends only on `TG:ALLOW`, so a compliant holder costs no fee. Needs a wallet: it signs and pays.
     */
    async freezeIfInvalid(tokenAccount: PublicKey): Promise<FreezeResult> {
        const caller = this.me("freezeIfInvalid");
        const acc = await this.readTokenAccount(tokenAccount);
        if (!acc) throw new Error(`token account ${tokenAccount.toBase58()} does not exist`);
        if (acc.isFrozen) return { frozen: true, alreadyFrozen: true, code: null, reason: "Already frozen." };
        const ix = await permissionlessIx(this.connection, "freezeIdempotent", { caller, mint: acc.mint, tokenAccount, owner: acc.owner });
        const sim = await this.simulate([ix], caller);
        const verdict = classifyGateLogs(sim.logs, sim.err === null, "freeze", { gateId: this.gateProgramId.toBase58(), errorCode: sim.errorCode });
        switch (verdict.outcome) {
            case "skipped":
                return { frozen: true, alreadyFrozen: true, code: null, reason: verdict.reason };
            case "denied":
                return { frozen: false, alreadyFrozen: false, code: verdict.code, reason: verdict.reason };
            case "failed":
                return { frozen: false, alreadyFrozen: false, code: null, reason: verdict.reason };
            case "allowed": {
                const signature = await this.send([ix]);
                return { frozen: true, alreadyFrozen: false, code: verdict.code, reason: verdict.reason, signature };
            }
        }
    }

    /** Simulate without signatures. `payerMissing` = the fee payer account doesn't exist. */
    async simulate(ixs: TransactionInstruction[], payer: PublicKey): Promise<{ err: unknown; logs: string[]; errorCode?: number; payerMissing: boolean; unitsConsumed?: number }> {
        const { blockhash } = await this.connection.getLatestBlockhash(this.commitment);
        const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
        const { value } = await this.connection.simulateTransaction(new VersionedTransaction(message), {
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: this.commitment,
        });
        const err = value.err ?? null;
        const custom = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError?.[1];
        const errorCode = typeof custom === "object" && custom !== null && "Custom" in custom ? Number((custom as { Custom: number }).Custom) : undefined;
        return { err, logs: value.logs ?? [], errorCode, payerMissing: err === "AccountNotFound", unitsConsumed: value.unitsConsumed };
    }

    /**
     * Sign with the client's wallet, then with `signers`, send, and confirm. Returns the signature.
     *
     * The wallet signs first: Phantom asks for that order on multi-signer transactions (a wallet may change the
     * transaction while signing, which would void signatures made before it). Anchor's `sendAndConfirm` signs the
     * other way round, so it gets no signers here and a wallet that adds them after the real wallet has signed.
     */
    async send(ixs: TransactionInstruction[], signers: Signer[] = []): Promise<string> {
        this.me("send");
        const wallet = this.wallet!;
        const provider = this.program.provider as AnchorProvider;
        if (signers.length === 0) return provider.sendAndConfirm(new Transaction().add(...ixs), [], { commitment: this.commitment });
        const walletFirst: GateWallet = {
            publicKey: wallet.publicKey,
            signTransaction: async (tx) => {
                const signed = await wallet.signTransaction(tx);
                if (signed instanceof VersionedTransaction) signed.sign(signers);
                else (signed as Transaction).partialSign(...signers);
                return signed;
            },
            signAllTransactions: (txs) => Promise.all(txs.map((tx) => walletFirst.signTransaction(tx))),
        };
        return new AnchorProvider(this.connection, walletFirst, provider.opts).sendAndConfirm(new Transaction().add(...ixs), [], { commitment: this.commitment });
    }
}
