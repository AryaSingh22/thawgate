/**
 * Reading what the chain said: sss-token's mint refusals, the gate's last thaw/freeze decision on a token account,
 * and the two SAS accounts the decision dashboard shows. Only RPC calls a public endpoint serves (signatures by
 * address, transactions, accounts); no getProgramAccounts.
 */
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { GateAction, GateVerdict, classifyGateLogs } from "@thawgate/sdk/reasons";

import { MintInfo, formatUnits, duration, utcTime } from "./lib";

/** sss-token's reserve refusal (mint.rs `check_reserve_attestation`): `SSS:DENY:RESERVE_<KIND> key=value …`. */
export interface ReserveDenial {
    kind: "INSUFFICIENT" | "STALE" | "MISSING";
    fields: Record<string, bigint>;
}

const RESERVE_LINE = /^Program log: SSS:DENY:RESERVE_(INSUFFICIENT|STALE|MISSING)(.*)$/;

export function reserveDenial(logs: readonly string[]): ReserveDenial | null {
    for (const line of logs) {
        const m = RESERVE_LINE.exec(line);
        if (!m) continue;
        const fields: Record<string, bigint> = {};
        for (const [, key, value] of m[2].matchAll(/(\w+)=(-?\d+)/g)) fields[key] = BigInt(value);
        return { kind: m[1] as ReserveDenial["kind"], fields };
    }
    return null;
}

/** The Anchor error name in a failure's logs ("ReserveInsufficient"), or null. */
export function anchorErrorName(logs: readonly string[]): string | null {
    for (const line of logs) {
        const m = /Error Code: (\w+)\./.exec(line);
        if (m) return m[1];
    }
    return null;
}

/** The custom error number of a failed instruction (`{ InstructionError: [i, { Custom: n }] }`). */
export function customErrorCode(err: unknown): number | undefined {
    const detail = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError?.[1];
    return typeof detail === "object" && detail !== null && "Custom" in detail ? Number((detail as { Custom: number }).Custom) : undefined;
}

export interface Refusal {
    /** A short headline: "Refused: not enough reserves". */
    title: string;
    /** The plain-words reason, with the numbers the program logged. */
    sentence: string;
    /** The program's error name, when known ("ReserveInsufficient"). */
    code: string | null;
}

/** Why sss-token refused a `mint_tokens`, in plain words, or null when the logs don't say. */
export function mintRefusal(logs: readonly string[], mint: Pick<MintInfo, "decimals" | "symbol">): Refusal | null {
    const amount = (v: bigint | undefined) => (v === undefined ? "?" : `${formatUnits(v, mint.decimals)} ${mint.symbol}`.trim());
    const denial = reserveDenial(logs);
    if (denial?.kind === "INSUFFICIENT") {
        const { supply, amount: minted, reserves, as_of } = denial.fields;
        const after = supply !== undefined && minted !== undefined ? supply + minted : undefined;
        return {
            title: "Refused: not enough reserves",
            sentence:
                `Minting ${amount(minted)} would take the supply from ${amount(supply)} to ${amount(after)}, above the ${amount(reserves)} of attested ` +
                `reserves${as_of ? ` (as of ${utcTime(as_of)})` : ""}. sss-token refuses every mint past the reserves; the attestor has to post higher reserves first.`,
            code: "ReserveInsufficient",
        };
    }
    if (denial?.kind === "STALE") {
        const { as_of, age, max_staleness } = denial.fields;
        return {
            title: "Refused: the reserve figure is stale",
            sentence:
                `The last reserve post${as_of ? ` (as of ${utcTime(as_of)})` : ""} is ${age !== undefined ? duration(age) : "too"} old, past the ` +
                `${max_staleness !== undefined ? duration(max_staleness) : "allowed"} limit. Minting stays stopped until the attestor posts again.`,
            code: "ReserveStale",
        };
    }
    if (denial?.kind === "MISSING") {
        return {
            title: "Refused: no reserve attestation",
            sentence: "This mint has no reserve attestation yet. Token ACL mints can't mint until the issuer sets an attestor and the attestor posts reserves.",
            code: "ReserveAttestationMissing",
        };
    }
    const name = anchorErrorName(logs);
    if (name === "MinterQuotaExceeded") {
        return { title: "Refused: over your minter quota", sentence: "This amount is more than what's left of your minter quota. The issuer can raise it.", code: name };
    }
    if (name === "MinterNotFound" || (name === "AccountNotInitialized" && logs.some((l) => /caused by account: minter_(role|quota)/.test(l)))) {
        return { title: "Refused: not a minter", sentence: "This wallet holds no active Minter role on this mint. The issuer grants it.", code: name };
    }
    if (name === "TokensPaused") return { title: "Refused: the mint is paused", sentence: "The issuer has paused this stablecoin, so nothing can be minted.", code: name };
    if (name === "InvalidAmount") return { title: "Refused: amount", sentence: "The amount must be above 0.", code: name };
    if (logs.some((l) => l.includes("Error: Account is frozen"))) {
        return {
            title: "Refused: the recipient's account is locked",
            sentence:
                "The recipient's token account is frozen. Every account of a Token ACL stablecoin starts frozen; the recipient unlocks it on the Holders page first (the policy must allow them).",
            code: "AccountFrozen",
        };
    }
    return null;
}

/**
 * Sign with the wallet and send without preflight, so a transaction the program will refuse still lands, failed,
 * as a public record. Costs the fee. Returns its signature, error and logs.
 */
export async function sendWithoutPreflight(connection: Connection, wallet: AnchorWallet, ixs: TransactionInstruction[]) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    const signed = await wallet.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
    let err: unknown = null;
    try {
        err = (await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")).value.err;
    } catch (e) {
        // web3.js rejects with the bare TransactionError ({ InstructionError: … }) when its status poll sees the failed
        // transaction before the websocket does, which is the usual case here.
        if (e instanceof Error) throw e;
        err = e;
    }
    let logs: string[] = [];
    for (let attempt = 0; attempt < 5 && logs.length === 0; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1_000));
        const landed = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        logs = landed?.meta?.logMessages ?? [];
    }
    return { signature, err, logs };
}

/** The gate's last thaw or freeze decision on a token account. */
export interface GateDecisionTx {
    signature: string;
    blockTime: number | null;
    action: GateAction;
    succeeded: boolean;
    verdict: GateVerdict;
}

/** An RPC read, retried with a growing pause: public endpoints answer bursts with 429 after web3.js's own retries. */
export async function retrying<T>(read: () => Promise<T>, attempts = 4): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await read();
        } catch (error) {
            if (attempt >= attempts) throw error;
            await new Promise((r) => setTimeout(r, 2_000 * attempt));
        }
    }
}

/** Which permissionless instruction a transaction ran through the gate, from the gate's own instruction log. */
function gateAction(logs: readonly string[]): GateAction | null {
    if (logs.includes("Program log: Instruction: CanThawPermissionless")) return "thaw";
    if (logs.includes("Program log: Instruction: CanFreezePermissionless")) return "freeze";
    return null;
}

/**
 * One transaction with its logs. One at a time on purpose: public devnet counts every item of a batch against a low
 * per-method limit for getTransaction, and web3.js's `getTransactions` doesn't keep the batch's order.
 */
export function readTransaction(connection: Connection, signature: string) {
    return retrying(() => connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), 5);
}

/**
 * Walks the token account's latest transactions (newest first, `limit` at most) to the first one in which the gate
 * decided a thaw or freeze. Null if none is that recent.
 */
export async function lastGateDecision(connection: Connection, tokenAccount: PublicKey, limit = 15): Promise<GateDecisionTx | null> {
    const signatures = await retrying(() => connection.getSignaturesForAddress(tokenAccount, { limit }, "confirmed"));
    for (const { signature, blockTime } of signatures) {
        const tx = await readTransaction(connection, signature);
        const logs = tx?.meta?.logMessages;
        const action = logs ? gateAction(logs) : null;
        if (!logs || !action) continue;
        const err = tx!.meta!.err;
        return {
            signature,
            blockTime: blockTime ?? null,
            action,
            succeeded: err === null,
            verdict: classifyGateLogs(logs, err === null, action, { errorCode: customErrorCode(err) }),
        };
    }
    return null;
}

/** A SAS credential: the issuer that controls it, and its name. Layout: disc u8 | authority | name (u32 len + bytes) | … */
export function readCredential(data: Uint8Array): { authority: PublicKey; name: string } | null {
    if (data.length < 37 || data[0] !== 0) return null;
    const nameLen = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(33, true);
    if (data.length < 37 + nameLen) return null;
    return { authority: new PublicKey(data.subarray(1, 33)), name: new TextDecoder().decode(data.subarray(37, 37 + nameLen)) };
}

/**
 * A SAS attestation: who signed it, when it expires (unix seconds, 0 = never) and its first data byte (kyc_level in
 * the KYC schema). Layout: disc u8 | nonce | credential | schema | data (u32 len @97 + bytes @101) | signer | expiry i64.
 */
export function readAttestation(data: Uint8Array): { signer: PublicKey; expiry: number; kycLevel: number | null } | null {
    if (data.length < 101 || data[0] !== 2) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const len = view.getUint32(97, true);
    if (data.length < 141 + len) return null;
    return {
        signer: new PublicKey(data.subarray(101 + len, 133 + len)),
        expiry: Number(view.getBigInt64(133 + len, true)),
        kycLevel: len >= 1 ? data[101] : null,
    };
}
