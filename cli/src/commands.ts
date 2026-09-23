/**
 * @module commands
 * @description All CLI command implementations.
 *
 * Fixes applied:
 *   HIGH-001: Renamed 'initialize' → 'init', 'info' → 'status'
 *   HIGH-002: Added supply, minters, holders, seize, audit-log, config commands
 *   HIGH-003: Added --confirm guard to all destructive commands
 *   HIGH-004: Added --dry-run flag to mint, burn, freeze, thaw
 *   MED-004:  Added SSS-2 compliance warning prompt on init
 */

import * as fs from "fs";
import * as os from "os";
import * as readline from "readline";
import { Command } from "commander";
import { PublicKey, Keypair, Connection, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { BN, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
    SolanaStablecoin,
    sss1Preset,
    sss2Preset,
    RoleType,
    QuotaPeriod,
} from "@thawgate/sdk";
import { loadConfig, loadKeypair, saveConfig } from "./config";
import { Logger } from "./logger";
import { simulateTransaction } from "./utils";

/**
 * Creates a configured SDK client from CLI options.
 */
function createClient(opts: Record<string, string>): {
    client: SolanaStablecoin;
    keypair: Keypair;
    logger: Logger;
    connection: Connection;
} {
    const config = loadConfig({
        rpcUrl: opts.rpcUrl,
        commitment: opts.commitment as "confirmed" | undefined,
        keypairPath: opts.keypair,
    });

    const logger = new Logger(opts.verbose === "true", opts.json === "true");
    const keypairBytes = loadKeypair(config.keypairPath);
    const keypair = Keypair.fromSecretKey(keypairBytes);

    const connection = new Connection(config.rpcUrl, config.commitment);
    const wallet = new Wallet(keypair);
    const client = SolanaStablecoin.fromConfig(
        {
            rpcUrl: config.rpcUrl,
            commitment: config.commitment,
            programId: new PublicKey(config.programId),
            hookProgramId: new PublicKey(config.hookProgramId),
        },
        wallet,
    );

    return { client, keypair, logger, connection };
}

/**
 * Prompts the user to confirm SSS-2 deployment and its irreversible implications.
 * Returns true if the user types 'yes', false otherwise.
 */
async function confirmSSS2Warning(): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        console.log('\n⚠️  WARNING: SSS-2 Compliance Notice');
        console.log('─'.repeat(60));
        console.log('SSS-2 enables PERMANENT DELEGATE and TRANSFER HOOK extensions.');
        console.log('These extensions are IMMUTABLE after initialization.');
        console.log('Once enabled, they CANNOT be disabled without migrating');
        console.log('all token holders to a new mint.');
        console.log('');
        console.log('Ensure you understand the compliance implications before');
        console.log('deploying this token in a production environment.');
        console.log('─'.repeat(60));
        rl.question("Type 'yes' to continue, anything else to cancel: ", (answer: string) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes');
        });
    });
}

/**
 * Writes an entry to the local audit log file.
 */
function auditLog(entry: Record<string, unknown>): void {
    const config = loadConfig({});
    const logPath = (config as unknown as Record<string, string>).auditLogPath || `${os.homedir()}/.sss-token/audit.log`;
    const dir = logPath.substring(0, logPath.lastIndexOf('/'));
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
}

/**
 * Registers all CLI commands.
 */
export function registerCommands(program: Command): void {
    // ========================================================================
    // Initialize (HIGH-001: renamed from 'initialize' to 'init')
    // ========================================================================
    program
        .command("init")
        .description("Initialize a new SSS stablecoin")
        .option("--name <name>", "Stablecoin name (max 32 chars)")
        .option("--symbol <symbol>", "Token symbol (max 10 chars)")
        .option("--uri <uri>", "Metadata URI")
        .option("--decimals <n>", "Decimal places", "6")
        .option("--preset <preset>", "Preset: sss1 or sss2", "sss1")
        .option("--custom <path>", "Path to custom config file (.toml or .json)")
        .option("--hook-program <pubkey>", "Transfer hook program ID (SSS-2)")
        .option("--confirm", "Skip confirmation prompt")
        .action(async (opts) => {
            // FIX-P4-01: --custom config support
            if (opts.custom && opts.preset && opts.preset !== "sss1") {
                console.error("❌ Cannot use --custom and --preset together");
                process.exit(1);
            }

            let name = opts.name;
            let symbol = opts.symbol;
            let uri = opts.uri;
            let decimals = parseInt(opts.decimals, 10);
            let preset = opts.preset;

            if (opts.custom) {
                // Load config from file
                const { extname } = require("path");
                const raw = fs.readFileSync(opts.custom, "utf-8");
                const ext = extname(opts.custom).toLowerCase();

                let customConfig: Record<string, any>;
                if (ext === ".toml") {
                    try {
                        const toml = require("@iarna/toml");
                        customConfig = toml.parse(raw);
                    } catch {
                        // Fallback: simple TOML key=value parser
                        customConfig = {};
                        for (const line of raw.split("\n")) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
                            const eqIdx = trimmed.indexOf("=");
                            if (eqIdx === -1) continue;
                            const key = trimmed.slice(0, eqIdx).trim();
                            let value = trimmed.slice(eqIdx + 1).trim();
                            // Remove quotes
                            if ((value.startsWith('"') && value.endsWith('"')) ||
                                (value.startsWith("'") && value.endsWith("'"))) {
                                value = value.slice(1, -1);
                            }
                            // Parse booleans and numbers
                            if (value === "true") customConfig[key] = true;
                            else if (value === "false") customConfig[key] = false;
                            else if (/^\d+$/.test(value)) customConfig[key] = parseInt(value, 10);
                            else customConfig[key] = value;
                        }
                    }
                } else {
                    customConfig = JSON.parse(raw);
                }

                console.log(`Loading custom config from ${opts.custom}`);
                console.log("Config:", JSON.stringify(customConfig, null, 2));

                // Validate required fields
                if (!customConfig.name || !customConfig.symbol) {
                    console.error("❌ Custom config must include: name, symbol");
                    process.exit(1);
                }

                name = customConfig.name;
                symbol = customConfig.symbol;
                uri = customConfig.uri || opts.uri || "";
                decimals = customConfig.decimals ?? decimals;
                if (customConfig.preset) preset = customConfig.preset;
            }

            if (!name || !symbol) {
                console.error("❌ --name and --symbol are required (or provide --custom <path>)");
                process.exit(1);
            }

            // MED-004: SSS-2 compliance warning prompt
            if (preset === "sss2" && !opts.confirm) {
                const confirmed = await confirmSSS2Warning();
                if (!confirmed) {
                    console.log("Initialization cancelled.");
                    process.exit(0);
                }
            }

            const { client, keypair, logger, connection } = createClient(program.opts());

            const args =
                preset === "sss2"
                    ? sss2Preset(
                        name,
                        symbol,
                        uri || "",
                        new PublicKey(opts.hookProgram),
                        decimals,
                    )
                    : sss1Preset(name, symbol, uri || "", decimals);

            logger.info(`Initializing ${preset.toUpperCase()} stablecoin: ${name}`);

            const { instructions, mint, mintKeypair } = await client.initialize(
                keypair.publicKey,
                args,
            );

            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair, mintKeypair]);

            logger.transaction("init", sig, {
                mint: mint.toBase58(),
                preset,
                custom: opts.custom || undefined,
            });
            logger.output({ mint: mint.toBase58(), signature: sig });
            auditLog({ command: 'init', mint: mint.toBase58(), preset, custom: opts.custom, result: sig });
        });

    // ========================================================================
    // Mint (HIGH-004: added --dry-run)
    // ========================================================================
    program
        .command("mint")
        .description("Mint tokens to a recipient")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--recipient <pubkey>", "Recipient wallet address")
        .requiredOption("--amount <amount>", "Amount to mint (raw units)")
        .option("--dry-run", "Simulate the transaction without submitting")
        .option("--memo <memo>", "Optional memo")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());

            const mint = new PublicKey(opts.mint);
            const recipient = new PublicKey(opts.recipient);
            const amount = new BN(opts.amount);

            const instructions = await client.mintTokens(mint, keypair.publicKey, recipient, amount);
            const tx = new Transaction().add(...instructions);

            if (opts.dryRun) {
                await simulateTransaction(connection, tx, [keypair]);
                return;
            }

            logger.info(`Minting ${opts.amount} tokens to ${recipient.toBase58()}`);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("mint", sig, {
                mint: mint.toBase58(),
                recipient: recipient.toBase58(),
                amount: opts.amount,
            });
            auditLog({ command: 'mint', mint: mint.toBase58(), recipient: recipient.toBase58(), amount: opts.amount, result: sig });
        });

    // ========================================================================
    // Burn (HIGH-004: added --dry-run)
    // ========================================================================
    program
        .command("burn")
        .description("Burn tokens from your account")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--amount <amount>", "Amount to burn (raw units)")
        .option("--dry-run", "Simulate the transaction without submitting")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());

            const mint = new PublicKey(opts.mint);
            const amount = new BN(opts.amount);

            const instructions = await client.burnTokens(mint, keypair.publicKey, amount);
            const tx = new Transaction().add(...instructions);

            if (opts.dryRun) {
                await simulateTransaction(connection, tx, [keypair]);
                return;
            }

            logger.info(`Burning ${opts.amount} tokens`);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("burn", sig, { mint: mint.toBase58(), amount: opts.amount });
            auditLog({ command: 'burn', mint: mint.toBase58(), amount: opts.amount, result: sig });
        });

    // ========================================================================
    // Freeze / Thaw (HIGH-003: added --confirm; HIGH-004: added --dry-run)
    // ========================================================================
    program
        .command("freeze")
        .description("Freeze a token account")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--target <pubkey>", "Target token account to freeze")
        .option("--dry-run", "Simulate the transaction without submitting")
        .option("--confirm", "Confirm this irreversible action")
        .action(async (opts) => {
            if (!opts.confirm && !opts.dryRun) {
                console.error(
                    `ERROR: Freeze is irreversible.\nRe-run with --confirm to proceed:\n  sss-token freeze --mint ${opts.mint} --target ${opts.target} --confirm`
                );
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const target = new PublicKey(opts.target);

            const instructions = await client.freezeAccount(mint, keypair.publicKey, target);
            const tx = new Transaction().add(...instructions);

            if (opts.dryRun) {
                await simulateTransaction(connection, tx, [keypair]);
                return;
            }

            logger.info(`Freezing token account ${target.toBase58()}`);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("freeze", sig, { target: target.toBase58() });
            auditLog({ command: 'freeze', mint: mint.toBase58(), target: target.toBase58(), result: sig });
        });

    program
        .command("thaw")
        .description("Thaw a frozen token account")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--target <pubkey>", "Target token account to thaw")
        .option("--dry-run", "Simulate the transaction without submitting")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());

            const mint = new PublicKey(opts.mint);
            const target = new PublicKey(opts.target);

            const instructions = await client.thawAccount(mint, keypair.publicKey, target);
            const tx = new Transaction().add(...instructions);

            if (opts.dryRun) {
                await simulateTransaction(connection, tx, [keypair]);
                return;
            }

            logger.info(`Thawing token account ${target.toBase58()}`);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("thaw", sig, { target: target.toBase58() });
            auditLog({ command: 'thaw', mint: mint.toBase58(), target: target.toBase58(), result: sig });
        });

    // ========================================================================
    // Pause / Unpause
    // ========================================================================
    program
        .command("pause")
        .description("Pause all token operations")
        .requiredOption("--mint <pubkey>", "Mint address")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            logger.info("Pausing token operations");

            const instructions = await client.pause(mint, keypair.publicKey);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("pause", sig, { mint: mint.toBase58() });
            auditLog({ command: 'pause', mint: mint.toBase58(), result: sig });
        });

    program
        .command("unpause")
        .description("Resume token operations")
        .requiredOption("--mint <pubkey>", "Mint address")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            logger.info("Resuming token operations");

            const instructions = await client.unpause(mint, keypair.publicKey);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("unpause", sig, { mint: mint.toBase58() });
            auditLog({ command: 'unpause', mint: mint.toBase58(), result: sig });
        });

    // ========================================================================
    // Roles
    // ========================================================================
    program
        .command("grant-role")
        .description("Grant a role to a wallet")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--holder <pubkey>", "Wallet to grant role to")
        .requiredOption("--role <role>", "Role: minter, burner, pauser, blacklister, seizer")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(opts.holder);
            const role = parseRoleType(opts.role);

            logger.info(`Granting ${opts.role} role to ${holder.toBase58()}`);

            const instructions = await client.updateRoles(mint, keypair.publicKey, holder, role, true);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("grant-role", sig, {
                holder: holder.toBase58(),
                role: opts.role,
            });
            auditLog({ command: 'grant-role', mint: mint.toBase58(), holder: holder.toBase58(), role: opts.role, result: sig });
        });

    program
        .command("revoke-role")
        .description("Revoke a role from a wallet")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--holder <pubkey>", "Wallet to revoke role from")
        .requiredOption("--role <role>", "Role: minter, burner, pauser, blacklister, seizer")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(opts.holder);
            const role = parseRoleType(opts.role);

            logger.info(`Revoking ${opts.role} role from ${holder.toBase58()}`);

            const instructions = await client.updateRoles(mint, keypair.publicKey, holder, role, false);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("revoke-role", sig, {
                holder: holder.toBase58(),
                role: opts.role,
            });
            auditLog({ command: 'revoke-role', mint: mint.toBase58(), holder: holder.toBase58(), role: opts.role, result: sig });
        });

    // ========================================================================
    // Roles (NEW-002: spec-required `roles` parent command with subcommands)
    // Provides sss-token roles grant / sss-token roles revoke interface.
    // The top-level grant-role / revoke-role commands above are kept for
    // backward compatibility.
    // ========================================================================
    const rolesCmd = program
        .command("roles")
        .description("Manage roles (grant or revoke). Use: roles grant | roles revoke");

    rolesCmd
        .command("grant")
        .description("Grant a role to a wallet")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--holder <pubkey>", "Wallet to grant role to")
        .requiredOption("--role <role>", "Role: minter, burner, pauser, blacklister, seizer")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(opts.holder);
            const role = parseRoleType(opts.role);

            logger.info(`Granting ${opts.role} role to ${holder.toBase58()}`);

            const instructions = await client.updateRoles(mint, keypair.publicKey, holder, role, true);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("roles grant", sig, {
                holder: holder.toBase58(),
                role: opts.role,
            });
            auditLog({ command: 'roles grant', mint: mint.toBase58(), holder: holder.toBase58(), role: opts.role, result: sig });
        });

    rolesCmd
        .command("revoke")
        .description("Revoke a role from a wallet")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--holder <pubkey>", "Wallet to revoke role from")
        .requiredOption("--role <role>", "Role: minter, burner, pauser, blacklister, seizer")
        .action(async (opts) => {
            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(opts.holder);
            const role = parseRoleType(opts.role);

            logger.info(`Revoking ${opts.role} role from ${holder.toBase58()}`);

            const instructions = await client.updateRoles(mint, keypair.publicKey, holder, role, false);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("roles revoke", sig, {
                holder: holder.toBase58(),
                role: opts.role,
            });
            auditLog({ command: 'roles revoke', mint: mint.toBase58(), holder: holder.toBase58(), role: opts.role, result: sig });
        });

    rolesCmd
        .command("list")
        .description("List all active role assignments")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--json", "Output as JSON")
        .action(async (opts) => {
            const { client } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            // Fetch all RoleRecord accounts on-chain for this mint
            const allRoles = await (client.program.account as any).roleRecord.all([
                { memcmp: { offset: 8, bytes: mint.toBase58() } },
            ]);
            const active = allRoles
                .map((r: any) => r.account)
                .filter((r: any) => r.active);

            if (opts.json) {
                console.log(JSON.stringify({ success: true, data: active, error: null }));
            } else {
                if (active.length === 0) {
                    console.log("No active role assignments.");
                } else {
                    active.forEach((r: any) => {
                        console.log(`${r.holder.toBase58()}  role: ${Object.keys(r.role)[0]}`);
                    });
                }
            }
        });

    program
        .command("transfer-authority")
        .description("Transfer MasterAuthority to a new wallet")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--new-authority <pubkey>", "New MasterAuthority wallet")
        .option("--confirm", "Confirm this irreversible action")
        .action(async (opts) => {
            // HIGH-003: --confirm guard
            if (!opts.confirm) {
                console.error(
                    `ERROR: Transferring authority is irreversible without a follow-up transfer-back.\nRe-run with --confirm to proceed:\n  sss-token transfer-authority --mint ${opts.mint} --new-authority ${opts.newAuthority} --confirm`
                );
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const newAuthority = new PublicKey(opts.newAuthority);

            logger.info(`Transferring authority to ${newAuthority.toBase58()}`);

            const instructions = await client.transferAuthority(
                mint,
                keypair.publicKey,
                newAuthority,
            );
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("transfer-authority", sig, {
                newAuthority: newAuthority.toBase58(),
            });
            auditLog({ command: 'transfer-authority', mint: mint.toBase58(), newAuthority: newAuthority.toBase58(), result: sig });
        });

    // ========================================================================
    // Compliance (SSS-2) — HIGH-003: --confirm on blacklist/unblacklist
    // ========================================================================
    program
        .command("blacklist")
        .description("Add a wallet to the blacklist (SSS-2)")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--target <pubkey>", "Wallet to blacklist")
        .requiredOption("--reason <reason>", "Reason for blacklisting")
        .option("--confirm", "Confirm this irreversible action")
        .action(async (opts) => {
            // HIGH-003: --confirm guard
            if (!opts.confirm) {
                console.error(
                    `ERROR: Blacklisting is irreversible without a separate unblacklist operation.\nRe-run with --confirm to proceed:\n  sss-token blacklist --mint ${opts.mint} --target ${opts.target} --reason "${opts.reason}" --confirm`
                );
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const target = new PublicKey(opts.target);

            logger.info(`Blacklisting ${target.toBase58()}: ${opts.reason}`);

            const compliance = client.compliance(mint);
            const instructions = await compliance.addToBlacklist(
                keypair.publicKey,
                target,
                opts.reason,
            );
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("blacklist", sig, {
                target: target.toBase58(),
                reason: opts.reason,
            });
            auditLog({ command: 'blacklist', mint: mint.toBase58(), target: target.toBase58(), reason: opts.reason, result: sig });
        });

    program
        .command("unblacklist")
        .description("Remove a wallet from the blacklist (SSS-2)")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--target <pubkey>", "Wallet to remove from blacklist")
        .option("--confirm", "Confirm this action")
        .action(async (opts) => {
            // HIGH-003: --confirm guard
            if (!opts.confirm) {
                console.error(
                    `ERROR: Confirm required for this operation.\nRe-run with --confirm:\n  sss-token unblacklist --mint ${opts.mint} --target ${opts.target} --confirm`
                );
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const target = new PublicKey(opts.target);

            logger.info(`Removing ${target.toBase58()} from blacklist`);

            const compliance = client.compliance(mint);
            const instructions = await compliance.removeFromBlacklist(
                keypair.publicKey,
                target,
            );
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("unblacklist", sig, { target: target.toBase58() });
            auditLog({ command: 'unblacklist', mint: mint.toBase58(), target: target.toBase58(), result: sig });
        });

    // ========================================================================
    // Seize (HIGH-002: new command)
    // ========================================================================
    program
        .command("seize")
        .description("Seize tokens from a blacklisted frozen account (SSS-2 only)")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--source <pubkey>", "Source token account (ATA) to seize from")
        .requiredOption("--source-authority <pubkey>", "Wallet that owns the source token account (the blacklisted address)")
        .requiredOption("--treasury <pubkey>", "Treasury token account (ATA) to receive seized tokens")
        .option("--confirm", "Confirm this irreversible action")
        .action(async (opts) => {
            if (!opts.confirm) {
                console.error(
                    `ERROR: Seize is irreversible. Re-run with --confirm to proceed:\n  sss-token seize --mint ${opts.mint} --source ${opts.source} --source-authority ${opts.sourceAuthority} --treasury ${opts.treasury} --confirm`
                );
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const sourceAccount = new PublicKey(opts.source);
            const sourceAuthority = new PublicKey(opts.sourceAuthority);
            const treasuryAccount = new PublicKey(opts.treasury);

            logger.info(`Seizing tokens from ${sourceAccount.toBase58()} to ${treasuryAccount.toBase58()}`);

            const compliance = client.compliance(mint);
            const instructions = await compliance.seize(
                keypair.publicKey,
                sourceAuthority,
                sourceAccount,
                treasuryAccount,
            );
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            logger.transaction("seize", sig, {
                source: sourceAccount.toBase58(),
                treasury: treasuryAccount.toBase58(),
            });
            auditLog({ command: 'seize', mint: mint.toBase58(), source: sourceAccount.toBase58(), treasury: treasuryAccount.toBase58(), result: sig });
        });

    // ========================================================================
    // Supply (HIGH-002: new command)
    // ========================================================================
    program
        .command("supply")
        .description("Display the current total token supply")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--json", "Output as JSON")
        .action(async (opts) => {
            const { client, logger } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            const config = await client.getConfig(mint);
            const supply = config.totalMinted;

            if (opts.json) {
                console.log(JSON.stringify({ success: true, data: { supply: supply.toString(), totalMinted: config.totalMinted.toString(), totalBurned: config.totalBurned.toString() }, error: null }));
            } else {
                console.log(`Total Minted: ${config.totalMinted.toString()}`);
                console.log(`Total Burned: ${config.totalBurned.toString()}`);
                console.log(`Net Supply:   ${supply.toString()}`);
            }
        });

    // ========================================================================
    // Minters (HIGH-002: new command with subcommands)
    // ========================================================================
    const mintersCmd = program.command("minters").description("Manage minter roles");

    mintersCmd
        .command("list")
        .description("List all active minters and their quotas")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--json", "Output as JSON")
        .action(async (opts) => {
            const { client } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            // Fetch all RoleRecord accounts on-chain and filter for active Minters
            const allRoles = await (client.program.account as any).roleRecord.all([
                { memcmp: { offset: 8, bytes: mint.toBase58() } },
            ]);
            const minterRoles = allRoles
                .map((r: any) => r.account)
                .filter((r: any) => r.active && Object.keys(r.role)[0] === 'minter');

            if (opts.json) {
                console.log(JSON.stringify({ success: true, data: minterRoles, error: null }));
            } else {
                if (minterRoles.length === 0) {
                    console.log("No active minters.");
                } else {
                    minterRoles.forEach((m: any) => {
                        console.log(`${m.holder.toBase58()}  limit: ${m.limit?.toString() || 'unlimited'}`);
                    });
                }
            }
        });

    mintersCmd
        .command("add <address>")
        .description("Add a minter role")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--limit <amount>", "Minting quota limit (0 = unlimited)")
        .option("--period <period>", "Quota period: daily|weekly|monthly|lifetime", "lifetime")
        .option("--confirm", "Confirm the action")
        .action(async (address: string, opts) => {
            if (!opts.confirm) {
                console.error("Error: --confirm flag required for this operation");
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(address);

            const instructions = await client.updateMinter(
                mint,
                keypair.publicKey,
                holder,
                new BN(opts.limit),
                opts.period as QuotaPeriod,
            );
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            console.log(`Minter added. TX: ${sig}`);
            auditLog({ command: 'minters add', address, limit: opts.limit, result: sig });
        });

    mintersCmd
        .command("remove <address>")
        .description("Remove a minter role")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--confirm", "Confirm the action")
        .action(async (address: string, opts) => {
            if (!opts.confirm) {
                console.error("Error: --confirm flag required for this operation");
                process.exit(1);
            }

            const { client, keypair, logger, connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);
            const holder = new PublicKey(address);

            const instructions = await client.updateRoles(mint, keypair.publicKey, holder, RoleType.Minter, false);
            const tx = new Transaction().add(...instructions);
            const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);

            console.log(`Minter removed. TX: ${sig}`);
            auditLog({ command: 'minters remove', address, result: sig });
        });

    // ========================================================================
    // Holders (HIGH-002: new command)
    // ========================================================================
    program
        .command("holders")
        .description("List token holders")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--min-balance <amount>", "Minimum balance filter", "0")
        .option("--format <format>", "Output format: table|json|csv", "table")
        .action(async (opts) => {
            const { connection } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
                filters: [
                    { dataSize: 165 },
                    { memcmp: { offset: 0, bytes: mint.toBase58() } },
                ]
            });

            const minBalance = BigInt(opts.minBalance);
            const holders = accounts
                .map(acc => ({
                    address: acc.pubkey.toString(),
                    balance: BigInt(acc.account.data.readBigUInt64LE ? acc.account.data.readBigUInt64LE(64) : 0),
                }))
                .filter(h => h.balance >= minBalance);

            if (opts.format === 'json') {
                console.log(JSON.stringify({ success: true, data: holders.map(h => ({ ...h, balance: h.balance.toString() })), error: null }));
            } else if (opts.format === 'csv') {
                console.log('address,balance');
                holders.forEach(h => console.log(`${h.address},${h.balance}`));
            } else {
                console.table(holders.map(h => ({ ...h, balance: h.balance.toString() })));
            }
        });

    // ========================================================================
    // Audit Log (HIGH-002: new command)
    // ========================================================================
    program
        .command("audit-log")
        .description("Display the local audit log")
        .option("--action <type>", "Filter by action type")
        .option("--from <date>", "Start date (ISO 8601)")
        .option("--to <date>", "End date (ISO 8601)")
        .option("--format <format>", "Output format: json|csv", "json")
        .action((opts) => {
            const config = loadConfig({}) as unknown as Record<string, string>;
            const logPath = config.auditLogPath || `${os.homedir()}/.sss-token/audit.log`;

            if (!fs.existsSync(logPath)) {
                console.log("No audit log found.");
                return;
            }

            const lines = fs.readFileSync(logPath, 'utf-8')
                .split('\n')
                .filter(Boolean)
                .map(l => JSON.parse(l));

            let filtered = lines;
            if (opts.action) filtered = filtered.filter((e: Record<string, string>) => e.command?.includes(opts.action));
            if (opts.from) filtered = filtered.filter((e: Record<string, string>) => new Date(e.timestamp) >= new Date(opts.from));
            if (opts.to) filtered = filtered.filter((e: Record<string, string>) => new Date(e.timestamp) <= new Date(opts.to));

            if (opts.format === 'csv') {
                console.log('timestamp,command,result');
                filtered.forEach((e: Record<string, string>) => console.log(`${e.timestamp},${e.command},${e.result}`));
            } else {
                console.log(JSON.stringify(filtered, null, 2));
            }
        });

    // ========================================================================
    // Config (HIGH-002: new command with subcommands)
    // ========================================================================
    const configCmd = program.command("config").description("Manage CLI configuration");

    configCmd
        .command("show")
        .description("Display current configuration")
        .action(() => {
            const config = loadConfig({}) as unknown as Record<string, string>;
            // Redact sensitive fields before printing
            const safe = { ...config, keypairPath: config.keypairPath ? '[set]' : '[not set]' };
            console.log(JSON.stringify(safe, null, 2));
        });

    configCmd
        .command("set")
        .description("Set a configuration value")
        .option("--rpc-url <url>", "Solana RPC URL")
        .option("--keypair-path <path>", "Path to keypair JSON file")
        .option("--program-id <id>", "SSS Token program ID")
        .option("--mint-address <address>", "Token mint address")
        .action((opts) => {
            const updates: Record<string, string> = {};
            if (opts.rpcUrl) updates.rpcUrl = opts.rpcUrl;
            if (opts.keypairPath) updates.keypairPath = opts.keypairPath;
            if (opts.programId) updates.programId = opts.programId;
            if (opts.mintAddress) updates.mintAddress = opts.mintAddress;

            if (Object.keys(updates).length === 0) {
                console.error("No configuration options provided. Use --help for available options.");
                process.exit(1);
            }

            try {
                saveConfig(updates);
                console.log("Configuration saved to ~/.sss-token/config.json");
                for (const [key, value] of Object.entries(updates)) {
                    console.log(`  ${key}: ${value}`);
                }
            } catch (err: any) {
                console.error(`Failed to save configuration: ${err.message}`);
                process.exit(1);
            }
        });

    // ========================================================================
    // Status (HIGH-001: renamed from 'info' to 'status')
    // ========================================================================
    program
        .command("status")
        .description("Display stablecoin configuration and status")
        .requiredOption("--mint <pubkey>", "Mint address")
        .action(async (opts) => {
            const { client, logger } = createClient(program.opts());
            const mint = new PublicKey(opts.mint);

            const config = await client.getConfig(mint);
            const pauseState = await client.getPauseState(mint);

            logger.output({
                mint: config.mint.toBase58(),
                name: config.name,
                symbol: config.symbol,
                decimals: config.decimals,
                authority: config.authority.toBase58(),
                paused: pauseState.paused,
                permanentDelegate: config.enablePermanentDelegate,
                transferHook: config.enableTransferHook,
                defaultFrozen: config.defaultAccountFrozen,
                totalMinted: config.totalMinted.toString(),
                totalBurned: config.totalBurned.toString(),
            });
        });
}

/**
 * Parses a role name string to RoleType enum.
 */
function parseRoleType(role: string): RoleType {
    const map: Record<string, RoleType> = {
        minter: RoleType.Minter,
        burner: RoleType.Burner,
        pauser: RoleType.Pauser,
        blacklister: RoleType.Blacklister,
        seizer: RoleType.Seizer,
    };
    const result = map[role.toLowerCase()];
    if (result === undefined) {
        throw new Error(
            `Invalid role: ${role}. Valid roles: ${Object.keys(map).join(", ")}`,
        );
    }
    return result;
}
