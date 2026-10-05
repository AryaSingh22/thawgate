/**
 * @module errors
 * @description Error class hierarchy for the SSS SDK.
 *
 * Maps on-chain Anchor error codes to typed JavaScript errors. The code → name → message tables come from the
 * programs' IDLs (`src/idl.json`, `src/gate/idl.json`), which CI compares byte for byte with its own `anchor build`.
 */

import SSS_TOKEN_IDL from "./idl.json";
import GATE_IDL from "./gate/idl.json";

/**
 * Base error class for all SSS SDK errors.
 */
export class SSSError extends Error {
    /** The Anchor error code (if from on-chain). */
    public readonly code?: number;
    /** The original error that caused this one. */
    public readonly cause?: Error;
    /** The program's name for the error, from its IDL (e.g. `"ReserveInsufficient"`), when a program raised it. */
    public readonly errorName?: string;
    /** The program that raised it (base58), when known. */
    public readonly program?: string;

    constructor(message: string, code?: number, cause?: Error) {
        super(message);
        this.name = "SSSError";
        this.code = code;
        this.cause = cause;
        // Ensure proper prototype chain for instanceof checks
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     * Alias for `code` — spec requires the field to be named `errorCode`.
     * LOW-002: added getter for spec API surface compatibility.
     */
    get errorCode(): number | undefined {
        return this.code;
    }
}

/**
 * Error thrown when a transaction fails on-chain.
 */
export class TransactionError extends SSSError {
    /** The transaction signature (if available). */
    public readonly signature?: string;
    /** The transaction logs (if available). */
    public readonly logs?: string[];

    constructor(
        message: string,
        code?: number,
        signature?: string,
        logs?: string[],
    ) {
        super(message, code);
        this.name = "TransactionError";
        this.signature = signature;
        this.logs = logs;
    }
}

/**
 * Error thrown when authorization/permission checks fail.
 */
export class AuthorizationError extends SSSError {
    constructor(message: string, code?: number) {
        super(message, code);
        this.name = "AuthorizationError";
    }
}

/**
 * Error thrown when the token is paused and the operation is blocked.
 */
export class TokenPausedError extends SSSError {
    constructor(message = "Token operations are currently paused") {
        super(message);
        this.name = "TokenPausedError";
    }
}

/**
 * Error thrown when a feature is not enabled (e.g., SSS-2 operations on SSS-1).
 */
export class FeatureNotEnabledError extends SSSError {
    constructor(feature: string) {
        super(`Feature "${feature}" is not enabled for this stablecoin`);
        this.name = "FeatureNotEnabledError";
    }
}

/**
 * Error thrown when an account is blacklisted.
 */
export class BlacklistedError extends SSSError {
    constructor(address: string) {
        super(`Account ${address} is blacklisted`);
        this.name = "BlacklistedError";
    }
}

/**
 * Error thrown when a minter exceeds their quota.
 */
export class QuotaExceededError extends SSSError {
    /** The current quota limit. */
    public readonly limit: bigint;
    /** The amount already used. */
    public readonly used: bigint;
    /** The amount that was attempted. */
    public readonly attempted: bigint;

    /** `message` replaces the default text, e.g. when the amounts aren't known (a program error). */
    constructor(limit: bigint, used: bigint, attempted: bigint, message?: string) {
        super(
            message ?? `Minter quota exceeded: limit=${limit}, used=${used}, attempted=${attempted}`,
        );
        this.name = "QuotaExceededError";
        this.limit = limit;
        this.used = used;
        this.attempted = attempted;
    }
}

/**
 * Error thrown for invalid configuration or arguments.
 */
export class ConfigError extends SSSError {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

/**
 * Error thrown when an account is not found on-chain.
 */
export class AccountNotFoundError extends SSSError {
    constructor(accountType: string, address: string) {
        super(`${accountType} account not found: ${address}`);
        this.name = "AccountNotFoundError";
    }
}

// ============================================================================
// Error Code Mapping
// ============================================================================

/** One error a program declares in its IDL. */
export interface ProgramErrorInfo {
    /** The declaring program (base58, the IDL's `address`). */
    program: string;
    code: number;
    name: string;
    msg: string;
}

type IdlErrors = { address: string; errors?: readonly { code: number; name: string; msg?: string }[] };

function errorTable(idl: IdlErrors): Readonly<Record<number, ProgramErrorInfo>> {
    const rows = (idl.errors ?? []).map((e) => [e.code, Object.freeze({ program: idl.address, code: e.code, name: e.name, msg: e.msg ?? e.name })]);
    return Object.freeze(Object.fromEntries(rows));
}

/** sss-token's errors by code, from its IDL. */
export const SSS_TOKEN_ERRORS = errorTable(SSS_TOKEN_IDL);
/** The ThawGate gate's errors by code, from its IDL. */
export const THAWGATE_GATE_ERRORS = errorTable(GATE_IDL);

const TABLES: Readonly<Record<string, Readonly<Record<number, ProgramErrorInfo>>>> = {
    [SSS_TOKEN_IDL.address]: SSS_TOKEN_ERRORS,
    [GATE_IDL.address]: THAWGATE_GATE_ERRORS,
};

/** The IDL entry for `code` raised by `program` (base58); undefined for a program or code the SDK doesn't know. */
export function programError(program: string, code: number): ProgramErrorInfo | undefined {
    return TABLES[program]?.[code];
}

/** Errors that mean "the signer lacks the role or key for this", by IDL name. */
const AUTHORIZATION_ERRORS = new Set([
    "NotAuthorized",
    "MinterNotFound",
    "BurnerNotFound",
    "BlacklisterNotFound",
    "PauserNotFound",
    "SeizeNotAuthorized",
    "NotReserveAttestor",
    "NotFreezeAuthority",
    "NotPolicyAuthority",
]);

/** The SDK class for a program error, chosen by its IDL name (never by number, which moves when errors are added). */
function fromProgramError(info: ProgramErrorInfo, cause?: Error): SSSError {
    let err: SSSError;
    if (info.program === SSS_TOKEN_IDL.address && info.name === "TokensPaused") err = new TokenPausedError(info.msg);
    else if (info.program === SSS_TOKEN_IDL.address && info.name === "MinterQuotaExceeded") err = new QuotaExceededError(0n, 0n, 0n, info.msg);
    else if (info.program === SSS_TOKEN_IDL.address && info.name === "FeatureNotEnabled") {
        // The IDL text names only the transfer hook; the program also raises it for Token ACL compliance, the allowlist
        // and confidential transfers.
        err = new FeatureNotEnabledError("compliance (transfer hook or Token ACL), allowlist or confidential transfers");
    } else if (AUTHORIZATION_ERRORS.has(info.name)) err = new AuthorizationError(info.msg);
    else err = new SSSError(info.msg, undefined, cause);
    return Object.assign(err, { code: info.code, errorName: info.name, program: info.program });
}

/** The first `Program <id> failed: custom program error: 0x…` line: the program that raised the error (outer
 * programs repeat the same code as it propagates up through the CPIs). */
function failedProgram(logs: unknown): { program: string; code: number } | undefined {
    if (!Array.isArray(logs)) return undefined;
    for (const line of logs) {
        const m = typeof line === "string" ? /^Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)$/.exec(line) : null;
        if (m) return { program: m[1], code: parseInt(m[2], 16) };
    }
    return undefined;
}

const base58Of = (p: unknown): string | undefined =>
    typeof p === "string" ? p : typeof (p as { toBase58?: unknown })?.toBase58 === "function" ? (p as { toBase58(): string }).toBase58() : undefined;

/**
 * Parses an error from a program call into a typed SSSError.
 *
 * Reads, in order: an Anchor `AnchorError` (`error.errorCode.number` and `program`); a numeric `code` (Anchor's
 * `ProgramError`, raised by the SDK's sss-token calls); the transaction logs (`logs`, as on web3.js's
 * `SendTransactionError` from `client.send`). Codes are looked up in the raising program's IDL; a program the SDK
 * doesn't know (Token-2022, Token ACL, …) is left unmapped. A code without a program is read as sss-token's.
 *
 * @param error - The raw error from Anchor/web3.js
 * @returns A typed SSSError instance
 */
export function parseError(error: unknown): SSSError {
    if (error instanceof SSSError) return error;

    const err = (error ?? {}) as Record<string, any>;
    const cause = error instanceof Error ? error : undefined;
    const failed = failedProgram(err.logs ?? err.transactionLogs);
    const anchorCode = err.error?.errorCode?.number;
    const code: number | undefined =
        typeof anchorCode === "number"
            ? anchorCode
            : typeof err.code === "number"
                ? err.code
                : typeof err.error?.code === "number"
                    ? err.error.code
                    : failed?.code;
    const program = base58Of(err.program) ?? failed?.program ?? SSS_TOKEN_IDL.address;

    const info = code !== undefined ? programError(program, code) : undefined;
    if (info) return fromProgramError(info, cause);

    // Fallback: wrap in generic SSSError
    const message =
        err?.message && typeof err.message === "string"
            ? err.message
            : "Unknown SSS error";

    return new SSSError(message, code, cause);
}

// ============================================================================
// Spec-required named error aliases (HIGH-005)
// These aliases use the exact names required by the SSS specification,
// which differ from the internal implementation names above.
// We keep the originals to avoid breaking internal usage.
// ============================================================================

/**
 * @spec SssError — base error class alias required by the SSS spec.
 */
export class SssError extends SSSError {
    constructor(message: string, code?: number, cause?: Error) {
        super(message, code, cause);
        this.name = "SssError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * @spec SssInitError — initialization error class required by the SSS spec.
 * Maps to TransactionError for initialization transactions.
 */
export class SssInitError extends SSSError {
    constructor(message: string, cause?: Error) {
        super(message, undefined, cause);
        this.name = "SssInitError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * @spec SssMintError — minting error class required by the SSS spec.
 * Maps to QuotaExceededError and related mint errors.
 */
export class SssMintError extends SSSError {
    constructor(message: string, cause?: Error) {
        super(message, undefined, cause);
        this.name = "SssMintError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * @spec SssComplianceError — compliance error class required by the SSS spec.
 * Maps to BlacklistedError and related compliance errors.
 */
export class SssComplianceError extends SSSError {
    constructor(message: string, cause?: Error) {
        super(message, undefined, cause);
        this.name = "SssComplianceError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * @spec SssRpcError — network/RPC error class required by the SSS spec.
 * Maps to TransactionError for network-level failures.
 */
export class SssRpcError extends SSSError {
    constructor(message: string, cause?: Error) {
        super(message, undefined, cause);
        this.name = "SssRpcError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
