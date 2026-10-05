/**
 * @module @thawgate/sdk
 * @description Solana Stablecoin Standard (SSS) TypeScript SDK.
 *
 * This package provides a complete TypeScript API for interacting
 * with SSS stablecoins on Solana: SSS-ACL (Token ACL gated by ThawGate,
 * the default), SSS-Both (Token ACL + transfer hook), SSS-1 (basic)
 * and SSS-2 (transfer hook) configurations.
 *
 * @example
 * ```ts
 * import { SolanaStablecoin, sssAclPreset, SssError } from "@thawgate/sdk";
 *
 * const client = SolanaStablecoin.fromConfig({
 *   rpcUrl: "https://api.devnet.solana.com",
 * });
 *
 * // Initialize a Token ACL stablecoin (then call enable_token_acl as the master authority)
 * const { instructions, mint } = await client.initialize(
 *   authority.publicKey,
 *   sssAclPreset("USD Stablecoin", "USDS", "https://meta.example.com"),
 * );
 * ```
 */

// Main client
export { SolanaStablecoin } from "./client";
export type { CreateStablecoinOptions, CreatedStablecoin, InitializeStablecoinOptions, SetupMintingOptions } from "./client";

// ThawGate gate client (any Token ACL mint gated by ThawGate; also SolanaStablecoin#gate)
export { GateClient, toGatePolicyConfig } from "./gate/client";
export type { AllowlistMode, PolicyInput, GatePolicy, Explanation, FreezeResult, GateWallet, GateClientOptions } from "./gate/client";

// A wallet from a Keypair, for scripts and servers
export { keypairWallet } from "./wallet";
export type { KeypairWallet } from "./wallet";

// The BN the SDK's amounts use. Imported from bn.js, not anchor: anchor's CJS exports BN through a getter that native
// Node ESM can't name-import ("Named export 'BN' not found").
export { default as BN } from "bn.js";

// Gate reason codes (also published dependency-free as "@thawgate/sdk/reasons")
export {
    THAWGATE_GATE_ID,
    THAW_ALLOW_CODES,
    FLAG_CODES,
    STRUCTURAL_DENY_CODES,
    GATE_DENY_ERRORS,
    isTgCode,
    describe as describeGateCode,
    parseGateLogs,
    classifyGateLogs,
} from "./gate/reasons";
export type {
    GateAction,
    TgCode,
    ThawAllowCode,
    FlagCode,
    StructuralDenyCode,
    GateLogs,
    GateVerdict,
} from "./gate/reasons";

// Token ACL (sRFC 37) instructions on web3.js v1
export {
    TOKEN_ACL_IX,
    MINT_CONFIG_SIZE,
    findMintConfigPda,
    findFlagAccountPda,
    findThawExtraMetasPda,
    findFreezeExtraMetasPda,
    decodeMintConfig,
    fetchMintConfig,
    setGatingProgramIx,
    togglePermissionlessIx,
    permissionlessIx,
} from "./gate/tokenAcl";
export type { MintConfig, PermissionlessKind, PermissionlessArgs } from "./gate/tokenAcl";

// Solana Attestation Service: credentials, schemas, attestations (sas.createCredentialIx, sas.KYC_SCHEMA, …)
export * as sas from "./sas";

// Program IDs (devnet deployments + upstream Token ACL / SAS / ABL)
export {
    SSS_TOKEN_PROGRAM_ID,
    TRANSFER_HOOK_PROGRAM_ID,
    THAWGATE_GATE_PROGRAM_ID,
    TOKEN_ACL_PROGRAM_ID,
    SAS_PROGRAM_ID,
    ABL_GATE_PROGRAM_ID,
} from "./programs";

// Types and enums
export {
    RoleType,
    QuotaPeriod,
    SSSPreset,
    ComplianceMode,
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
    programError,
    SSS_TOKEN_ERRORS,
    THAWGATE_GATE_ERRORS,
} from "./errors";
export type { ProgramErrorInfo } from "./errors";

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
import { SSS_ACL_FEATURES } from "./presets/sssAcl";
import { SSS_BOTH_FEATURES } from "./presets/sssBoth";

/**
 * SSS preset configurations.
 *
 * Spec-required export: `Presets.SSS_1` and `Presets.SSS_2`.
 * Each value provides the feature flags for the respective standard. `SSS_ACL` is the default for new mints.
 *
 * @example
 * ```ts
 * import { Presets } from "@thawgate/sdk";
 * const hasPermanentDelegate = Presets.SSS_2.permanentDelegate; // true
 * ```
 */
export const Presets = {
    /** SSS-ACL (default): Token ACL gated by ThawGate — no transfer hook. */
    SSS_ACL: SSS_ACL_FEATURES,
    /** SSS-Both: Token ACL + the transfer hook. */
    SSS_BOTH: SSS_BOTH_FEATURES,
    /** SSS-1: Basic stablecoin — no compliance extensions. */
    SSS_1: SSS1_FEATURES,
    /** SSS-2: Compliance stablecoin — with permanent delegate + transfer hook. */
    SSS_2: SSS2_FEATURES,
    /** SSS-3: Private stablecoin — confidential transfers + allowlist. */
    SSS_3: SSS3_FEATURES,
} as const;

// Preset factory functions
export { sssAclPreset, SSS_ACL_FEATURES } from "./presets/sssAcl";
export { sssBothPreset, SSS_BOTH_FEATURES } from "./presets/sssBoth";
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
    findAllowlistPda,
    findExtraAccountMetaListPda,
    findReserveAttestationPda,
} from "./pda";

// Modules
export { ComplianceModule } from "./modules/compliance";
export { PrivacyModule } from "./modules/privacy";
export { ReservesModule } from "./modules/reserves";
export type { ReserveAttestation } from "./modules/reserves";

// Base operations (for advanced usage)
export * as token from "./base/token";
export * as roles from "./base/roles";
