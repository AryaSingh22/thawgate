/**
 * @module types
 * @description TypeScript type definitions for the Solana Stablecoin Standard (SSS) SDK.
 *
 * These types mirror the on-chain Anchor program state and instruction arguments.
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ============================================================================
// Enums
// ============================================================================

/**
 * Role types matching the on-chain RoleType enum.
 * Numeric values match the Anchor discriminator bytes.
 */
export enum RoleType {
    MasterAuthority = 0,
    Minter = 1,
    Burner = 2,
    Pauser = 3,
    Blacklister = 4,
    Seizer = 5,
}

/**
 * Minter quota period matching the on-chain QuotaPeriod enum.
 */
export enum QuotaPeriod {
    Daily = 0,
    Weekly = 1,
    Monthly = 2,
    Lifetime = 3,
}

/**
 * Supported SSS preset tiers.
 */
export enum SSSPreset {
    /** Basic stablecoin — mint, burn, freeze, pause, roles */
    SSS1 = "SSS-1",
    /** Enhanced compliance — adds blacklist, seize, transfer hook */
    SSS2 = "SSS-2",
    /** Private stablecoin — confidential transfers + allowlist */
    SSS3 = "SSS-3",
    /** Token ACL mint gated by ThawGate (no transfer hook); the default for new mints */
    SSS_ACL = "SSS-ACL",
    /** Token ACL plus the SSS transfer hook */
    SSS_BOTH = "SSS-Both",
}

/**
 * How a mint enforces compliance (`StablecoinConfig.compliance_mode`, immutable).
 */
export enum ComplianceMode {
    /** Transfer hook on every transfer (legacy SSS-2). */
    Hook = 0,
    /** Token ACL: frozen-by-default accounts thawed through the ThawGate gate; no hook. */
    Acl = 1,
    /** Token ACL and the transfer hook. */
    Both = 2,
}

// ============================================================================
// Account State Types
// ============================================================================

/**
 * On-chain StablecoinConfig account data.
 */
export interface StablecoinConfig {
    /** The MasterAuthority who controls this stablecoin. */
    authority: PublicKey;
    /** The Token-2022 mint address. */
    mint: PublicKey;
    /** Human-readable name (max 32 chars). */
    name: string;
    /** Ticker symbol (max 10 chars). */
    symbol: string;
    /** Metadata URI (max 200 chars). */
    uri: string;
    /** Number of decimal places. */
    decimals: number;
    /** Whether permanent delegate extension is enabled (immutable). */
    enablePermanentDelegate: boolean;
    /** Whether transfer hook extension is enabled (immutable). */
    enableTransferHook: boolean;
    /** Whether new accounts are frozen by default (immutable). */
    defaultAccountFrozen: boolean;
    /** Whether token operations are currently paused. */
    paused: boolean;
    /** Total tokens minted (cumulative). */
    totalMinted: BN;
    /** Total tokens burned (cumulative). */
    totalBurned: BN;
    /** PDA bump seed. */
    bump: number;
    /** A `ComplianceMode` value (immutable; decodes as 0 = Hook on configs created before S6). */
    complianceMode: number;
}

/**
 * On-chain RoleRecord account data.
 */
export interface RoleRecord {
    /** The mint this role is associated with. */
    mint: PublicKey;
    /** The key that holds this role. */
    holder: PublicKey;
    /** The type of role. */
    role: RoleType;
    /** Whether the role is currently active. */
    active: boolean;
    /** Unix timestamp when the role was granted. */
    grantedAt: BN;
    /** PDA bump seed. */
    bump: number;
}

/**
 * On-chain MinterQuota account data.
 */
export interface MinterQuota {
    /** The mint this quota applies to. */
    mint: PublicKey;
    /** The minter this quota belongs to. */
    minter: PublicKey;
    /** Maximum amount that can be minted per period. */
    limit: BN;
    /** Amount already minted in current period. */
    used: BN;
    /** The quota period type. */
    period: QuotaPeriod;
    /** PDA bump seed. */
    bump: number;
}

/**
 * On-chain BlacklistEntry account data (SSS-2 only).
 */
export interface BlacklistEntry {
    /** The mint this entry applies to. */
    mint: PublicKey;
    /** The blacklisted wallet address. */
    target: PublicKey;
    /** Human-readable reason for blacklisting. */
    reason: string;
    /** Unix timestamp when added. */
    addedAt: BN;
    /** The operator who added the entry. */
    addedBy: PublicKey;
    /** Whether the entry is currently active. */
    active: boolean;
    /** PDA bump seed. */
    bump: number;
}

/**
 * On-chain PauseState account data.
 */
export interface PauseState {
    /** The mint this pause state applies to. */
    mint: PublicKey;
    /** Whether token operations are paused. */
    paused: boolean;
    /** Unix timestamp when last paused (0 if never). */
    pausedAt: BN;
    /** The operator who last paused. */
    pausedBy: PublicKey;
    /** PDA bump seed. */
    bump: number;
}

// ============================================================================
// Instruction Argument Types
// ============================================================================

/**
 * Arguments for the initialize instruction.
 */
export interface InitializeArgs {
    /** Human-readable name (max 32 chars). */
    name: string;
    /** Ticker symbol (max 10 chars). */
    symbol: string;
    /** Metadata URI (max 200 chars). */
    uri: string;
    /** Number of decimal places. */
    decimals: number;
    /** Enable permanent delegate extension (SSS-2). */
    enablePermanentDelegate: boolean;
    /** Enable transfer hook extension (SSS-2). */
    enableTransferHook: boolean;
    /** Freeze new accounts by default. */
    defaultAccountFrozen: boolean;
    /** Transfer hook program ID (required if enableTransferHook=true). */
    hookProgramId?: PublicKey;
    /** Enable confidential transfers (SSS-3). */
    enableConfidentialTransfers?: boolean;
    /** Enable allowlist-based access control (SSS-3). */
    enableAllowlist?: boolean;
    /**
     * How the mint enforces compliance (default `ComplianceMode.Hook`, the pre-S6 behavior). `Acl` and `Both` need
     * `defaultAccountFrozen`; `Acl` takes no hook and `Both` requires it. Call `enable_token_acl` after initialize.
     */
    complianceMode?: ComplianceMode;
}

/**
 * Arguments for updating a minter's quota.
 */
export interface UpdateMinterArgs {
    /** The minter's public key. */
    minter: PublicKey;
    /** Maximum mint amount per period. */
    limit: BN;
    /** The quota period. */
    period: QuotaPeriod;
}

/**
 * Arguments for granting/revoking a role.
 */
export interface UpdateRolesArgs {
    /** The key to grant/revoke the role for. */
    holder: PublicKey;
    /** The role type. */
    role: RoleType;
    /** Whether to activate or deactivate. */
    active: boolean;
}

/**
 * Arguments for adding a wallet to the blacklist.
 */
export interface AddToBlacklistArgs {
    /** The wallet to blacklist. */
    target: PublicKey;
    /** Human-readable reason (max 200 chars). */
    reason: string;
}

// ============================================================================
// SDK Configuration Types
// ============================================================================

/**
 * Configuration for initializing the SDK client.
 */
export interface SSSClientConfig {
    /** Solana RPC endpoint URL. */
    rpcUrl: string;
    /** Commitment level for transactions. */
    commitment?: "processed" | "confirmed" | "finalized";
    /** Whether to skip preflight checks. */
    skipPreflight?: boolean;
    /** SSS-Token program ID (default: from IDL). */
    programId?: PublicKey;
    /** Transfer Hook program ID (default: from IDL). */
    hookProgramId?: PublicKey;
}

/**
 * Result type for SDK operations that submit transactions.
 */
export interface TransactionResult {
    /** The transaction signature. */
    signature: string;
    /** The slot the transaction was confirmed in. */
    slot?: number;
    /** Any useful data returned from the transaction. */
    data?: Record<string, unknown>;
}

/**
 * Options for transaction submission.
 */
export interface TransactionOptions {
    /** Whether to skip preflight simulation. */
    skipPreflight?: boolean;
    /** Maximum retries for transaction confirmation. */
    maxRetries?: number;
    /** Additional signers beyond the payer. */
    additionalSigners?: unknown[];
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitted when a stablecoin is initialized.
 */
export interface StablecoinInitializedEvent {
    mint: PublicKey;
    authority: PublicKey;
    name: string;
    symbol: string;
    decimals: number;
    enablePermanentDelegate: boolean;
    enableTransferHook: boolean;
    defaultAccountFrozen: boolean;
    timestamp: BN;
}

/**
 * Event emitted when authority is transferred.
 */
export interface AuthorityTransferredEvent {
    mint: PublicKey;
    oldAuthority: PublicKey;
    newAuthority: PublicKey;
    timestamp: BN;
}

/**
 * Event emitted when tokens are seized.
 */
export interface TokensSeizedEvent {
    mint: PublicKey;
    source: PublicKey;
    treasury: PublicKey;
    amount: BN;
    seizer: PublicKey;
    timestamp: BN;
}
