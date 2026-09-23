/**
 * @module client
 * @description SolanaStablecoin — the main SDK entrypoint class.
 *
 * Provides a high-level, ergonomic API for interacting with SSS stablecoins.
 * Wraps all base operations, role management, and compliance modules.
 *
 * @example
 * ```ts
 * import { SolanaStablecoin, sss1Preset } from "@thawgate/sdk";
 *
 * const client = SolanaStablecoin.fromConfig({
 *   rpcUrl: "https://api.devnet.solana.com",
 *   programId: new PublicKey("..."),
 * });
 *
 * // Initialize a new SSS-1 stablecoin
 * const { instructions, mint } = await client.initialize(
 *   authority.publicKey,
 *   sss1Preset("USD Stablecoin", "USDS", "https://meta.example.com", 6),
 * );
 * ```
 */

import {
    PublicKey,
    Connection,
    Keypair,
    TransactionInstruction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
    findConfigPda,
    findPauseStatePda,
    findRolePda,
    findQuotaPda,
} from "./pda";
import * as tokenOps from "./base/token";
import * as roleOps from "./base/roles";
import { ComplianceModule } from "./modules/compliance";
import { PrivacyModule } from "./modules/privacy";
import IDL from "./idl.json";
import type {
    SSSClientConfig,
    InitializeArgs,
    StablecoinConfig,
    RoleRecord,
    MinterQuota,
    PauseState,
} from "./types";
import { RoleType, QuotaPeriod } from "./types";
import { ConfigError, AccountNotFoundError, parseError } from "./errors";

// Placeholder program ID patterns — used for validation only.
// These must NOT be shipped as defaults; callers must configure real IDs.
const PLACEHOLDER_PATTERNS = [
    "SSSToken11111111111111111111111111111111111",
    "Hook111111111111111111111111111111111111111",
    "11111111111111111111111111111111",
];

/**
 * Validates that a program ID is not a known placeholder.
 * Throws ConfigError if the ID matches a placeholder pattern.
 */
function validateProgramId(id: PublicKey | undefined, name: string): void {
    if (!id) {
        throw new ConfigError(
            `${name} is not configured. Provide it in the SDK config.`,
        );
    }
    const idStr = id.toBase58();
    if (PLACEHOLDER_PATTERNS.includes(idStr)) {
        throw new ConfigError(
            `${name} is set to a placeholder value (${idStr}). ` +
            `Configure the real deployed program ID.`,
        );
    }
}

/**
 * SolanaStablecoin — main SDK class.
 *
 * Acts as a facade over all SSS operations. Provides both
 * instruction builders (for composability) and convenience
 * methods for common workflows.
 */
export class SolanaStablecoin {
    /** The Anchor program instance. */
    public readonly program: Program;
    /** The Solana connection. */
    public readonly connection: Connection;
    /** The SSS-Token program ID. */
    public readonly programId: PublicKey;
    /** The transfer hook program ID. */
    public readonly hookProgramId: PublicKey;

    private constructor(
        program: Program,
        connection: Connection,
        programId: PublicKey,
        hookProgramId: PublicKey,
    ) {
        this.program = program;
        this.connection = connection;
        this.programId = programId;
        this.hookProgramId = hookProgramId;
    }

    /**
     * Creates a new SolanaStablecoin instance.
     *
     * Primary static factory method as required by the SSS PRD specification.
     * Accepts a Connection object directly (PRD pattern) or creates one from config.rpcUrl.
     *
     * @param connectionOrConfig - A Solana Connection, or SSSClientConfig
     * @param configOrWallet - SSSClientConfig if first arg is Connection, or wallet
     * @param wallet - Anchor wallet (optional for read-only)
     * @returns A new SolanaStablecoin instance
     */
    static async create(
        connectionOrConfig: Connection | SSSClientConfig,
        configOrWallet?: SSSClientConfig | AnchorProvider["wallet"],
        wallet?: AnchorProvider["wallet"],
    ): Promise<SolanaStablecoin> {
        let config: SSSClientConfig;
        let resolvedWallet: AnchorProvider["wallet"] | undefined;

        if (connectionOrConfig instanceof Connection) {
            // PRD pattern: create(connection, config)
            config = (configOrWallet as SSSClientConfig) ?? { rpcUrl: "" };
            // Override rpcUrl since we already have a connection
            config = { ...config, rpcUrl: config.rpcUrl || "provided-via-connection" };
            resolvedWallet = wallet;
        } else {
            // Legacy pattern: create(config, wallet?)
            config = connectionOrConfig;
            resolvedWallet = configOrWallet as AnchorProvider["wallet"] | undefined;
        }

        return SolanaStablecoin.fromConfig(config, resolvedWallet);
    }

    /**
     * Creates a new SolanaStablecoin instance from configuration.
     *
     * Alias for {@link SolanaStablecoin.create} — kept for backward compatibility.
     *
     * @param config - Client configuration
     * @param wallet - Anchor wallet (optional for read-only)
     * @returns A new SolanaStablecoin instance
     */
    static fromConfig(
        config: SSSClientConfig,
        wallet?: AnchorProvider["wallet"],
    ): SolanaStablecoin {
        if (!config.rpcUrl) {
            throw new ConfigError("rpcUrl is required");
        }

        const connection = new Connection(
            config.rpcUrl,
            config.commitment ?? "confirmed",
        );

        const programId = config.programId;
        const hookProgramId = config.hookProgramId;

        // Validate program IDs — reject placeholders and missing IDs
        validateProgramId(programId, "SSS Token program ID (programId)");
        validateProgramId(hookProgramId, "Transfer Hook program ID (hookProgramId)");

        // After validation, we know these are defined and valid
        const validProgramId = programId!;
        const validHookProgramId = hookProgramId!;

        // Create a read-only provider if no wallet is provided
        const provider = wallet
            ? new AnchorProvider(connection, wallet, {
                commitment: config.commitment ?? "confirmed",
                skipPreflight: config.skipPreflight ?? false,
            })
            : ({
                connection,
                publicKey: PublicKey.default,
            } as unknown as AnchorProvider);

        // Create program with the actual IDL bundled with the SDK.
        const ProgramCtor: new (...args: unknown[]) => Program = Program as unknown as new (...args: unknown[]) => Program;
        const program = new ProgramCtor(
            { ...IDL, address: validProgramId.toBase58() } as any,
            provider,
        );

        return new SolanaStablecoin(program, connection, validProgramId, validHookProgramId);
    }

    // ============================================================================
    // Token Operations
    // ============================================================================

    /**
     * Initializes a new stablecoin.
     *
     * @param authority - The authority's public key (becomes MasterAuthority)
     * @param args - Initialization arguments (use sss1Preset or sss2Preset)
     * @param mintKeypair - Optional mint keypair (generated if not provided)
     */
    async initialize(
        authority: PublicKey,
        args: InitializeArgs,
        mintKeypair?: Keypair,
    ): Promise<{
        instructions: TransactionInstruction[];
        mint: PublicKey;
        mintKeypair: Keypair;
    }> {
        return tokenOps.initialize(this.program, authority, args, mintKeypair);
    }

    /**
     * Mints tokens to a recipient.
     */
    async mintTokens(
        mint: PublicKey,
        minter: PublicKey,
        recipient: PublicKey,
        amount: BN,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.mintTokens(this.program, mint, minter, recipient, amount);
    }

    /**
     * Burns tokens from the burner's account.
     */
    async burnTokens(
        mint: PublicKey,
        burner: PublicKey,
        amount: BN,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.burnTokens(this.program, mint, burner, amount);
    }

    /**
     * Freezes a target token account.
     */
    async freezeAccount(
        mint: PublicKey,
        operator: PublicKey,
        targetTokenAccount: PublicKey,
        operatorRole?: RoleType.MasterAuthority | RoleType.Blacklister,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.freezeAccount(
            this.program,
            mint,
            operator,
            targetTokenAccount,
            operatorRole,
        );
    }

    /**
     * Thaws a frozen token account.
     */
    async thawAccount(
        mint: PublicKey,
        operator: PublicKey,
        targetTokenAccount: PublicKey,
        operatorRole?: RoleType.MasterAuthority | RoleType.Blacklister,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.thawAccount(
            this.program,
            mint,
            operator,
            targetTokenAccount,
            operatorRole,
        );
    }

    /**
     * Pauses all token operations.
     */
    async pause(
        mint: PublicKey,
        operator: PublicKey,
        operatorRole?: RoleType.Pauser | RoleType.MasterAuthority,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.pause(this.program, mint, operator, operatorRole);
    }

    /**
     * Resumes all token operations.
     */
    async unpause(
        mint: PublicKey,
        operator: PublicKey,
        operatorRole?: RoleType.Pauser | RoleType.MasterAuthority,
    ): Promise<TransactionInstruction[]> {
        return tokenOps.unpause(this.program, mint, operator, operatorRole);
    }

    // ============================================================================
    // Role Operations
    // ============================================================================

    /**
     * Creates or updates a minter with a quota.
     */
    async updateMinter(
        mint: PublicKey,
        authority: PublicKey,
        minter: PublicKey,
        limit: BN,
        period: QuotaPeriod,
    ): Promise<TransactionInstruction[]> {
        return roleOps.updateMinter(
            this.program,
            mint,
            authority,
            minter,
            limit,
            period,
        );
    }

    /**
     * Creates or updates a role for a given key.
     */
    async updateRoles(
        mint: PublicKey,
        authority: PublicKey,
        holder: PublicKey,
        role: RoleType,
        active: boolean,
    ): Promise<TransactionInstruction[]> {
        return roleOps.updateRoles(
            this.program,
            mint,
            authority,
            holder,
            role,
            active,
        );
    }

    /**
     * Transfers MasterAuthority to a new key.
     */
    async transferAuthority(
        mint: PublicKey,
        authority: PublicKey,
        newAuthority: PublicKey,
    ): Promise<TransactionInstruction[]> {
        return roleOps.transferAuthority(
            this.program,
            mint,
            authority,
            newAuthority,
        );
    }

    // ============================================================================
    // Module Accessors
    // ============================================================================

    /**
     * Returns a ComplianceModule for SSS-2 operations on a specific mint.
     */
    compliance(mint: PublicKey): ComplianceModule {
        return new ComplianceModule(this.program, mint);
    }

    /**
     * Returns a PrivacyModule for SSS-3 operations on a specific mint.
     */
    privacy(mint: PublicKey): PrivacyModule {
        return new PrivacyModule(mint);
    }

    // ============================================================================
    // Account Fetchers
    // ============================================================================

    /**
     * Typed account fetch helper.
     * Wraps Anchor's program.account access with proper typing.
     */
    private fetchAccount(accountName: string): { fetch: (pda: PublicKey) => Promise<unknown>; all: (filters?: unknown[]) => Promise<unknown[]> } {
        const accounts = this.program.account as Record<string, { fetch: (pda: PublicKey) => Promise<unknown>; all: (filters?: unknown[]) => Promise<unknown[]> }>;
        return accounts[accountName];
    }

    /**
     * Fetches the StablecoinConfig for a mint.
     */
    async getConfig(mint: PublicKey): Promise<StablecoinConfig> {
        const [configPda] = findConfigPda(mint, this.programId);
        try {
            const account = await this.fetchAccount("stablecoinConfig").fetch(configPda);
            return account as StablecoinConfig;
        } catch (error) {
            throw new AccountNotFoundError("StablecoinConfig", configPda.toBase58());
        }
    }

    /**
     * Fetches the PauseState for a mint.
     */
    async getPauseState(mint: PublicKey): Promise<PauseState> {
        const [pausePda] = findPauseStatePda(mint, this.programId);
        try {
            const account = await this.fetchAccount("pauseState").fetch(pausePda);
            return account as PauseState;
        } catch (error) {
            throw new AccountNotFoundError("PauseState", pausePda.toBase58());
        }
    }

    /**
     * Fetches a role record for a given holder and role.
     */
    async getRoleRecord(
        mint: PublicKey,
        holder: PublicKey,
        role: RoleType,
    ): Promise<RoleRecord | null> {
        const [rolePda] = findRolePda(mint, holder, role, this.programId);
        try {
            const account = await this.fetchAccount("roleRecord").fetch(rolePda);
            return account as RoleRecord;
        } catch {
            return null;
        }
    }

    /**
     * Fetches a minter's quota.
     */
    async getMinterQuota(
        mint: PublicKey,
        minter: PublicKey,
    ): Promise<MinterQuota | null> {
        const [quotaPda] = findQuotaPda(mint, minter, this.programId);
        try {
            const account = await this.fetchAccount("minterQuota").fetch(quotaPda);
            return account as MinterQuota;
        } catch {
            return null;
        }
    }

    /**
     * Checks if a wallet has a specific active role.
     */
    async hasRole(
        mint: PublicKey,
        holder: PublicKey,
        role: RoleType,
    ): Promise<boolean> {
        const record = await this.getRoleRecord(mint, holder, role);
        return record?.active ?? false;
    }

    /**
     * Checks if the token is currently paused.
     */
    async isPaused(mint: PublicKey): Promise<boolean> {
        const state = await this.getPauseState(mint);
        return state.paused;
    }
}
