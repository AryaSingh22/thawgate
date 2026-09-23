/**
 * @module @thawgate/sdk
 * @description Solana Stablecoin Standard (SSS) TypeScript SDK.
 *
 * This package provides a complete TypeScript API for interacting
 * with SSS stablecoins on Solana, supporting both SSS-1 (basic)
 * and SSS-2 (enhanced compliance) configurations.
 *
 * @example
 * ```ts
 * import { SolanaStablecoin, Presets, SssError } from "@thawgate/sdk";
 *
 * const client = SolanaStablecoin.fromConfig({
 *   rpcUrl: "https://api.devnet.solana.com",
 * });
 *
 * // Initialize a stablecoin using the spec-required Presets namespace
 * const { instructions, mint } = await client.initialize(
 *   authority.publicKey,
 *   { ...Presets.SSS_1, name: "USD Stablecoin", symbol: "USDS", uri: "https://meta.example.com" },
 * );
 * ```
 */

// Main client
export { SolanaStablecoin } from "./client";

// Types and enums
export {
    RoleType,
    QuotaPeriod,
    SSSPreset,
} from "./types";

export type {
    StablecoinConfig,
    RoleRecord,
    MinterQuota,
    BlacklistEntry,
    PauseState,
    InitializeArgs,
    UpdateMinterArgs,
    UpdateRolesArgs,
    AddToBlacklistArgs,
    SSSClientConfig,
    TransactionResult,
    TransactionOptions,
    StablecoinInitializedEvent,
    AuthorityTransferredEvent,
    TokensSeizedEvent,
} from "./types";

// Errors — internal names
export {
    SSSError,
    TransactionError,
    AuthorizationError,
    TokenPausedError,
    FeatureNotEnabledError,
    BlacklistedError,
    QuotaExceededError,
    ConfigError,
    AccountNotFoundError,
    parseError,
} from "./errors";

// Errors — spec-required names (HIGH-005)
export {
    SssError,
    SssInitError,
    SssMintError,
    SssComplianceError,
    SssRpcError,
} from "./errors";

// Presets — spec-required Presets namespace (HIGH-005)
import { SSS1_FEATURES } from "./presets/sss1";
import { SSS2_FEATURES } from "./presets/sss2";
import { SSS3_FEATURES } from "./presets/sss3";

/**
 * SSS preset configurations.
 *
 * Spec-required export: `Presets.SSS_1` and `Presets.SSS_2`.
 * Each value provides the feature flags for the respective standard.
 *
 * @example
 * ```ts
 * import { Presets } from "@thawgate/sdk";
 * const hasPermanentDelegate = Presets.SSS_2.permanentDelegate; // true
 * ```
 */
export const Presets = {
    /** SSS-1: Basic stablecoin — no compliance extensions. */
    SSS_1: SSS1_FEATURES,
    /** SSS-2: Compliance stablecoin — with permanent delegate + transfer hook. */
    SSS_2: SSS2_FEATURES,
    /** SSS-3: Private stablecoin — confidential transfers + allowlist. */
    SSS_3: SSS3_FEATURES,
} as const;

// Preset factory functions (kept for backward compat)
export { sss1Preset, SSS1_FEATURES } from "./presets/sss1";
export { sss2Preset, SSS2_FEATURES } from "./presets/sss2";
export { sss3Preset, SSS3_FEATURES } from "./presets/sss3";

// PDA helpers
export {
    findConfigPda,
    findPauseStatePda,
    findRolePda,
    findQuotaPda,
    findBlacklistPda,
    findExtraAccountMetaListPda,
} from "./pda";

// Modules
export { ComplianceModule } from "./modules/compliance";
export { PrivacyModule } from "./modules/privacy";

// Base operations (for advanced usage)
export * as token from "./base/token";
export * as roles from "./base/roles";
