/**
 * @module gate/reasons
 * @description ThawGate's reason codes and the one parser for them.
 *
 * On every thaw and freeze decision the gate logs `TG:ALLOW:<CODE>` or `TG:DENY:<CODE>`
 * (programs/thawgate-gate/src/decision.rs). `explain()`, `freezeIfInvalid()` and the keeper all read a transaction's
 * logs through {@link classifyGateLogs}, so a wallet's reason is computed one way everywhere.
 *
 * This module has no imports. Services that don't want the SDK's Solana dependencies load it on its own:
 * `import { classifyGateLogs } from "@thawgate/sdk/reasons"`.
 */

/** The ThawGate gating program (devnet). The same value as `THAWGATE_GATE_PROGRAM_ID`, as a string. */
export const THAWGATE_GATE_ID = "THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ";

/** Which Token ACL permissionless instruction called the gate. */
export type GateAction = "thaw" | "freeze";

/** Why a thaw passes (`TG:ALLOW:<code>` on thaw). */
export const THAW_ALLOW_CODES = ["KYC", "PDA_ALLOWLISTED", "ALLOWLISTED", "CLEAN"] as const;
/** A policy flag on the owner: `TG:DENY:<code>` on thaw, `TG:ALLOW:<code>` on freeze. */
export const FLAG_CODES = ["BLACKLISTED", "NOT_ALLOWLISTED", "NO_CREDENTIAL", "CREDENTIAL_EXPIRED", "KYC_LEVEL_TOO_LOW"] as const;
/** Denied before any policy decision, on thaw and on freeze. */
export const STRUCTURAL_DENY_CODES = ["MISSING_ACCOUNTS", "BAD_POLICY", "BAD_REGISTRY_ENTRY", "BAD_CREDENTIAL"] as const;

export type ThawAllowCode = (typeof THAW_ALLOW_CODES)[number];
export type FlagCode = (typeof FLAG_CODES)[number];
export type StructuralDenyCode = (typeof STRUCTURAL_DENY_CODES)[number];
/** Every code the gate logs. `NO_IMMUTABLE_OWNER` denies a thaw only; `COMPLIANT` denies a freeze only. */
export type TgCode = ThawAllowCode | FlagCode | StructuralDenyCode | "NO_IMMUTABLE_OWNER" | "COMPLIANT";

/** What each code says about the owner, as the second half of a sentence. */
const FACTS: Record<TgCode, string> = {
    KYC: "the owner holds a live SAS attestation from the policy's credential and schema",
    PDA_ALLOWLISTED: "the owner is a program address (PDA) on the issuer's allowlist (BypassForPdas)",
    ALLOWLISTED: "the owner is on the issuer's allowlist",
    CLEAN: "no policy check flags the owner",
    BLACKLISTED: "the owner is on the issuer's blacklist",
    NOT_ALLOWLISTED: "the policy is allowlist-only and the owner is not on the issuer's allowlist",
    NO_CREDENTIAL: "the owner has no SAS attestation from the policy's credential and schema (never issued, or revoked)",
    CREDENTIAL_EXPIRED: "the owner's SAS attestation has expired",
    KYC_LEVEL_TOO_LOW: "the owner's kyc_level is below the policy minimum",
    NO_IMMUTABLE_OWNER: "the token account lacks the ImmutableOwner extension (use an associated token account)",
    MISSING_ACCOUNTS: "the transaction left out accounts the policy needs (resolve the gate's extra account metas)",
    BAD_POLICY: "the policy account is not this mint's ThawGate policy",
    BAD_REGISTRY_ENTRY: "a blacklist or allowlist account has the wrong owner, type or fields",
    BAD_CREDENTIAL: "the account at the attestation address is not a SAS attestation of this credential, schema and owner",
    COMPLIANT: "the owner passes the policy",
};

/**
 * The gate's custom error number for each `TG:DENY` code (errors.rs `Denied*`, 6009–6019). Used only when a
 * simulation's logs were cut before the gate's own line.
 */
export const GATE_DENY_ERRORS: Readonly<Record<number, TgCode>> = {
    6009: "MISSING_ACCOUNTS",
    6010: "BAD_POLICY",
    6011: "BAD_REGISTRY_ENTRY",
    6012: "BAD_CREDENTIAL",
    6013: "NO_IMMUTABLE_OWNER",
    6014: "BLACKLISTED",
    6015: "NOT_ALLOWLISTED",
    6016: "NO_CREDENTIAL",
    6017: "CREDENTIAL_EXPIRED",
    6018: "KYC_LEVEL_TOO_LOW",
    6019: "COMPLIANT",
};

export function isTgCode(code: string): code is TgCode {
    return Object.prototype.hasOwnProperty.call(FACTS, code);
}

/**
 * A human sentence for a gate decision, e.g. `describe("DENY", "NO_CREDENTIAL", "thaw")` →
 * "Unlock denied: the owner has no SAS attestation …". The action matters: BLACKLISTED denies a thaw but allows a freeze.
 */
export function describe(decision: "ALLOW" | "DENY", code: string, action: GateAction): string {
    const fact = isTgCode(code) ? FACTS[code] : `the gate returned ${code}, a code this SDK version doesn't know`;
    if (action === "thaw") return `${decision === "ALLOW" ? "Unlock allowed" : "Unlock denied"}: ${fact}.`;
    if (decision === "ALLOW") return `Freezable by anyone: ${fact}.`;
    return code === "COMPLIANT" ? `Not freezable: ${fact}.` : `Freeze denied: ${fact}.`;
}

export interface GateLogs {
    /** A frame of the gating program appears in the logs. */
    gateInvoked: boolean;
    /** The gate's `TG:` line: the first one inside one of its own frames. */
    decision: { kind: "ALLOW" | "DENY"; code: string } | null;
    /** The first `Program <id> failed: <message>` line. */
    failure: { program: string; message: string } | null;
}

const INVOKE = /^Program (\S+) invoke \[\d+\]$/;
const EXIT = /^Program (\S+) (?:success|failed: .*)$/;
const FAILED = /^Program (\S+) failed: (.*)$/;
const TG_LINE = /^Program log: .*?TG:(ALLOW|DENY):([A-Z_]+)/;

/**
 * Reads a transaction's (or a simulation's) logs. Only `TG:` lines logged inside the gate's own frames count, so a
 * different gating program can't impersonate a ThawGate decision. The first match wins: the gate's `msg!` line comes
 * before Anchor's error line, which repeats the code.
 */
export function parseGateLogs(logs: readonly string[], gateId: string = THAWGATE_GATE_ID): GateLogs {
    const stack: string[] = [];
    let gateInvoked = false;
    let decision: GateLogs["decision"] = null;
    let failure: GateLogs["failure"] = null;
    for (const line of logs) {
        const invoke = INVOKE.exec(line);
        if (invoke) {
            stack.push(invoke[1]);
            if (invoke[1] === gateId) gateInvoked = true;
            continue;
        }
        const failed = FAILED.exec(line);
        if (failed && !failure) failure = { program: failed[1], message: failed[2] };
        if (EXIT.test(line)) {
            stack.pop();
            continue;
        }
        if (!decision && stack[stack.length - 1] === gateId) {
            const tg = TG_LINE.exec(line);
            if (tg) decision = { kind: tg[1] as "ALLOW" | "DENY", code: tg[2] };
        }
    }
    return { gateInvoked, decision, failure };
}

/** The gate's verdict on one thaw or freeze transaction. */
export type GateVerdict =
    /** The gate allowed it (a thaw unlocked the account, or a freeze froze it). */
    | { outcome: "allowed"; code: string; reason: string }
    /** The gate denied it. On freeze, `COMPLIANT` means the owner passes the policy. */
    | { outcome: "denied"; code: string; reason: string }
    /** It succeeded without calling the gate: Token ACL's idempotent instructions return early on an account already
     * in the target state. */
    | { outcome: "skipped"; reason: string }
    /** It failed outside the gate's decision (Token ACL, Token-2022, the system program, fees, …). */
    | { outcome: "failed"; program: string; message: string; reason: string };

/**
 * The verdict of a thaw or freeze transaction from its logs. `succeeded` is whether it landed (or simulated) without
 * error. `errorCode` is the custom error number of a failed instruction, when known: it recovers the gate's code if
 * the logs were cut.
 */
export function classifyGateLogs(
    logs: readonly string[],
    succeeded: boolean,
    action: GateAction,
    opts: { gateId?: string; errorCode?: number } = {},
): GateVerdict {
    const { gateInvoked, decision, failure } = parseGateLogs(logs, opts.gateId);
    if (succeeded) {
        if (!gateInvoked) {
            const state = action === "thaw" ? "thawed" : "frozen";
            return { outcome: "skipped", reason: `No change: the account is already ${state}, so Token ACL did not call the gate.` };
        }
        const code = decision?.kind === "ALLOW" ? decision.code : "UNKNOWN";
        return { outcome: "allowed", code, reason: describe("ALLOW", code, action) };
    }
    if (decision?.kind === "DENY") return { outcome: "denied", code: decision.code, reason: describe("DENY", decision.code, action) };
    // Truncated logs ("Log truncated") usually lose the gate's own failed line too, so accept a missing failure line.
    // 6009–6019 don't collide with Token ACL's or Token-2022's error numbers, which are small.
    const gateFailed = failure === null || failure.program === (opts.gateId ?? THAWGATE_GATE_ID);
    const fromError = opts.errorCode !== undefined && gateFailed ? GATE_DENY_ERRORS[opts.errorCode] : undefined;
    if (fromError) return { outcome: "denied", code: fromError, reason: describe("DENY", fromError, action) };
    if (failure) {
        return {
            outcome: "failed",
            program: failure.program,
            message: failure.message,
            reason: `Failed before the gate decided: ${failure.program} returned "${failure.message}".`,
        };
    }
    return { outcome: "failed", program: "unknown", message: "no logs", reason: "Failed, and the logs give no reason." };
}
