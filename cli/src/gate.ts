/**
 * @module gate
 * @description CLI commands for ThawGate, mirroring @thawgate/sdk: the issuer preset (create-stablecoin,
 * enable-token-acl), policies, the holder flows (explain, unlock, freeze-if-invalid), swap-gate, SAS credentials and
 * the issuer allowlist.
 */

import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { AllowlistMode, Explanation, GatePolicy, PolicyInput, sas } from "@thawgate/sdk";
import { createClient } from "./commands";

type Opts = Record<string, string | boolean | string[] | undefined>;

/** The policy flags shared by create-stablecoin, enable-token-acl, policy init|update and swap-gate. */
export interface PolicyFlags {
    blacklist?: string;
    allowlist?: string;
    sasCredential?: string;
    sasSchema?: string;
    minKyc?: string;
    /** `false` when --no-sas was given (commander's negatable option). */
    sas?: boolean;
}

const ALLOWLIST_MODES: AllowlistMode[] = ["off", "allowOnly", "bypassForPdas"];

function onOff(v: string, flag: string): boolean {
    if (v === "on" || v === "true") return true;
    if (v === "off" || v === "false") return false;
    throw new Error(`${flag} takes on or off, not ${v}`);
}

/**
 * Policy flags → the SDK's PolicyInput. A flag not given stays undefined, so `policy update` changes only what was
 * given. With only --min-kyc, the credential and schema come from `current` (the stored policy).
 */
export function policyFromFlags(f: PolicyFlags, current?: Pick<GatePolicy, "requireSas" | "sasCredential" | "sasSchema" | "minKycLevel"> | null): PolicyInput {
    const p: PolicyInput = {};
    if (f.blacklist !== undefined) p.checkBlacklist = onOff(f.blacklist, "--blacklist");
    if (f.allowlist !== undefined) {
        if (!ALLOWLIST_MODES.includes(f.allowlist as AllowlistMode)) throw new Error(`--allowlist takes ${ALLOWLIST_MODES.join(", ")}, not ${f.allowlist}`);
        p.allowlistMode = f.allowlist as AllowlistMode;
    }
    const sasGiven = f.sasCredential !== undefined || f.sasSchema !== undefined || f.minKyc !== undefined;
    if (f.sas === false) {
        if (sasGiven) throw new Error("--no-sas can't be combined with --sas-credential, --sas-schema or --min-kyc");
        p.sas = null;
    } else if (sasGiven) {
        const stored = current?.requireSas ? current : undefined;
        const credential = f.sasCredential ? new PublicKey(f.sasCredential) : stored?.sasCredential;
        const schema = f.sasSchema ? new PublicKey(f.sasSchema) : stored?.sasSchema;
        if (!credential || !schema) throw new Error("a SAS policy needs both --sas-credential and --sas-schema");
        const minKycLevel = f.minKyc !== undefined ? Number(f.minKyc) : stored?.minKycLevel ?? 0;
        if (!Number.isInteger(minKycLevel) || minKycLevel < 0 || minKycLevel > 255) throw new Error("--min-kyc takes 0-255");
        p.sas = { credential, schema, minKycLevel };
    }
    return p;
}

function withPolicyFlags(cmd: Command, negatable = false): Command {
    cmd.option("--blacklist <on|off>", "Deny holders on the issuer blacklist")
        .option("--allowlist <mode>", `Issuer allowlist: ${ALLOWLIST_MODES.join(" | ")}`)
        .option("--sas-credential <pubkey>", "Require a SAS attestation under this credential...")
        .option("--sas-schema <pubkey>", "...and this schema (nonce = the holder's wallet)")
        .option("--min-kyc <n>", "Minimum kyc_level (the attestation's first byte); 0 = any");
    if (negatable) cmd.option("--no-sas", "Turn the SAS requirement off");
    return cmd;
}

const pk = (v: unknown, flag: string): PublicKey => {
    if (typeof v !== "string") throw new Error(`${flag} is required`);
    return new PublicKey(v);
};

/** The explanation without the raw logs (unless --verbose), with keys as strings. */
function explanationOut(e: Explanation, verbose: boolean): Record<string, unknown> {
    return {
        mint: e.mint.toBase58(),
        wallet: e.wallet.toBase58(),
        tokenAccount: e.tokenAccount.toBase58(),
        account: e.account,
        status: e.status,
        code: e.code,
        reason: e.reason,
        simulated: e.simulated,
        gatingProgram: e.gatingProgram?.toBase58() ?? null,
        ...(verbose ? { logs: e.logs } : {}),
    };
}

function policyOut(p: GatePolicy): Record<string, unknown> {
    return {
        policy: p.address.toBase58(),
        authority: p.authority.toBase58(),
        issuerProgram: p.issuerProgram.toBase58(),
        checkBlacklist: p.checkBlacklist,
        allowlistMode: p.allowlistMode,
        requireSas: p.requireSas,
        sasCredential: p.requireSas ? p.sasCredential.toBase58() : null,
        sasSchema: p.requireSas ? p.sasSchema.toBase58() : null,
        minKycLevel: p.minKycLevel,
    };
}

export function registerGateCommands(program: Command): void {
    const ctx = () => createClient(program.opts());
    const verbose = () => Boolean(program.opts().verbose);

    // ------------------------------------------------------------------------------------------------
    // Issuer: SSS-ACL stablecoins
    // ------------------------------------------------------------------------------------------------
    withPolicyFlags(
        program
            .command("create-stablecoin")
            .description("Create an SSS-ACL stablecoin gated by ThawGate: initialize, enable_token_acl, minter role and reserves (3 txs)")
            .requiredOption("--name <name>", "Name (max 32 chars)")
            .requiredOption("--symbol <symbol>", "Symbol (max 10 chars)")
            .option("--uri <uri>", "Metadata URI", "")
            .option("--decimals <n>", "Decimals", "6")
            .requiredOption("--reserves <amount>", "Reserves to post now, in base units (the supply can't exceed them)")
            .requiredOption("--report-uri <uri>", "Link to the reserve report (max 200 bytes)")
            .option("--max-staleness <seconds>", "Minting stops when the last reserve post is older than this", "86400")
            .option("--attestor <pubkey>", "Who posts reserves (default: you, and you post --reserves now)"),
    ).action(async (opts: Opts) => {
        const { client, logger } = ctx();
        const policy = policyFromFlags(opts as PolicyFlags);
        logger.info(`Creating ${opts.symbol} (SSS-ACL, gated by ThawGate)`);
        const created = await client.createStablecoin({
            name: opts.name as string,
            symbol: opts.symbol as string,
            uri: opts.uri as string,
            decimals: Number(opts.decimals),
            policy,
            reserves: {
                amount: opts.reserves as string,
                reportUri: opts.reportUri as string,
                maxStalenessSeconds: Number(opts.maxStaleness),
                attestor: opts.attestor ? pk(opts.attestor, "--attestor") : undefined,
            },
        });
        logger.output({ mint: created.mint.toBase58(), ...created.signatures });
    });

    withPolicyFlags(
        program
            .command("enable-token-acl")
            .description("sss-token enable_token_acl on an Acl-mode mint: Token ACL config + ThawGate policy (MasterAuthority)")
            .requiredOption("--mint <pubkey>", "Mint address"),
    ).action(async (opts: Opts) => {
        const { client, logger } = ctx();
        const sig = await client.send(await client.enableTokenAcl(pk(opts.mint, "--mint"), policyFromFlags(opts as PolicyFlags)));
        logger.output({ signature: sig });
    });

    // ------------------------------------------------------------------------------------------------
    // Policies
    // ------------------------------------------------------------------------------------------------
    const policy = program.command("policy").description("A mint's ThawGate policy");

    policy
        .command("show")
        .description("Show the policy and the mint's Token ACL config")
        .requiredOption("--mint <pubkey>", "Mint address")
        .action(async (opts: Opts) => {
            const { client, logger } = ctx();
            const mint = pk(opts.mint, "--mint");
            const [p, config] = await Promise.all([client.gate.getPolicy(mint), client.gate.getMintConfig(mint)]);
            logger.output({
                mint: mint.toBase58(),
                gatingProgram: config?.gatingProgram.toBase58() ?? null,
                freezeAuthority: config?.freezeAuthority.toBase58() ?? null,
                permissionlessThaw: config?.enablePermissionlessThaw ?? null,
                permissionlessFreeze: config?.enablePermissionlessFreeze ?? null,
                ...(p ? policyOut(p) : { policy: null }),
            });
        });

    withPolicyFlags(
        policy
            .command("init")
            .description("Create the policy of a Token ACL mint whose freeze authority is your key (sss-token mints: enable-token-acl)")
            .requiredOption("--mint <pubkey>", "Mint address")
            .option("--authority <pubkey>", "Policy admin (default: you)"),
    ).action(async (opts: Opts) => {
        const { client, logger } = ctx();
        const input = policyFromFlags(opts as PolicyFlags);
        if (opts.authority) input.authority = pk(opts.authority, "--authority");
        const sig = await client.send(await client.gate.initPolicy(pk(opts.mint, "--mint"), input));
        logger.output({ signature: sig });
    });

    withPolicyFlags(
        policy
            .command("update")
            .description("Change the policy (only the flags given) and rewrite its extra metas; holders who no longer comply become freezable")
            .requiredOption("--mint <pubkey>", "Mint address"),
        true,
    ).action(async (opts: Opts) => {
        const { client, logger } = ctx();
        const mint = pk(opts.mint, "--mint");
        const changes = policyFromFlags(opts as PolicyFlags, await client.gate.getPolicy(mint));
        const sig = await client.send(await client.gate.updatePolicy(mint, changes));
        logger.output({ signature: sig, ...policyOut((await client.gate.getPolicy(mint))!) });
    });

    policy
        .command("setup-extra-metas")
        .description("Rewrite both extra-metas lists from the stored policy (idempotent)")
        .requiredOption("--mint <pubkey>", "Mint address")
        .action(async (opts: Opts) => {
            const { client, logger } = ctx();
            const sig = await client.send(await client.gate.setupExtraMetas(pk(opts.mint, "--mint")));
            logger.output({ signature: sig });
        });

    withPolicyFlags(
        program
            .command("swap-gate")
            .description("Move an existing Token ACL mint to ThawGate in one tx: policy, set_gating_program, toggles, token_acl metadata")
            .requiredOption("--mint <pubkey>", "Mint address (its Token ACL freeze authority is your key)")
            .option("--skip-metadata", "Leave the mint's token_acl metadata field as it is")
            .option("--confirm", "Confirm: holders are judged by the new policy from this transaction on"),
    ).action(async (opts: Opts) => {
        const mint = pk(opts.mint, "--mint");
        if (!opts.confirm) {
            console.error(`ERROR: swap-gate changes who may hold this token.\nRe-run with --confirm:\n  thawgate swap-gate --mint ${mint.toBase58()} ... --confirm`);
            process.exit(1);
        }
        const { client, logger } = ctx();
        const ixs = await client.gate.swapGate(mint, policyFromFlags(opts as PolicyFlags), { skipMetadata: Boolean(opts.skipMetadata) });
        const sig = await client.send(ixs);
        logger.output({ signature: sig, instructions: ixs.length });
    });

    // ------------------------------------------------------------------------------------------------
    // Holders
    // ------------------------------------------------------------------------------------------------
    program
        .command("explain")
        .description("Why may (or can't) this wallet hold the token? Simulates the thaw (or the freeze, if thawed); sends nothing")
        .requiredOption("--mint <pubkey>", "Mint address")
        .requiredOption("--wallet <pubkey>", "Holder wallet")
        .option("--token-account <pubkey>", "A token account of the wallet (default: its associated token account)")
        .action(async (opts: Opts) => {
            const { client, logger } = ctx();
            const tokenAccount = opts.tokenAccount ? pk(opts.tokenAccount, "--token-account") : undefined;
            const e = await client.gate.explain(pk(opts.mint, "--mint"), pk(opts.wallet, "--wallet"), { tokenAccount });
            logger.output(explanationOut(e, verbose()));
        });

    program
        .command("unlock")
        .description("Create the owner's associated token account if needed and thaw it through the gate (you pay; the owner signs nothing)")
        .requiredOption("--mint <pubkey>", "Mint address")
        .option("--owner <pubkey>", "Holder wallet (default: you)")
        .action(async (opts: Opts) => {
            const { client, keypair, logger } = ctx();
            const mint = pk(opts.mint, "--mint");
            const owner = opts.owner ? pk(opts.owner, "--owner") : keypair.publicKey;
            const e = await client.gate.explain(mint, owner);
            if (e.account === "thawed") {
                logger.output({ status: "already_unlocked", tokenAccount: e.tokenAccount.toBase58(), reason: e.reason });
                return;
            }
            if (e.status !== "can_unlock") {
                logger.output({ status: e.status, code: e.code, reason: e.reason });
                process.exitCode = 1;
                return;
            }
            const sig = await client.send(await client.gate.createAtaAndThaw(mint, owner));
            logger.output({ status: "unlocked", tokenAccount: e.tokenAccount.toBase58(), signature: sig, reason: e.reason });
        });

    program
        .command("freeze-if-invalid")
        .description("Freeze a token account permissionlessly if the policy flags its owner; sends nothing if it complies")
        .requiredOption("--token-account <pubkey>", "Token account")
        .action(async (opts: Opts) => {
            const { client, logger } = ctx();
            const r = await client.gate.freezeIfInvalid(pk(opts.tokenAccount, "--token-account"));
            logger.output({ ...r, signature: r.signature ?? null });
        });

    // ------------------------------------------------------------------------------------------------
    // SAS credentials (self-issued test KYC; production policies name a KYC provider's credential)
    // ------------------------------------------------------------------------------------------------
    const sasCmd = program.command("sas").description("Solana Attestation Service: credentials, the KYC schema, attestations");

    sasCmd
        .command("create-credential")
        .description("Create a SAS credential you issue under (a self-issued test credential)")
        .requiredOption("--name <name>", "Credential name (1-32 bytes)")
        .option("--signer <pubkey...>", "Keys that may attest (default: you)")
        .action(async (opts: Opts) => {
            const { client, keypair, logger } = ctx();
            const signers = (opts.signer as string[] | undefined)?.map((s) => new PublicKey(s));
            const { instruction, credential } = sas.createCredentialIx({ payer: keypair.publicKey, authority: keypair.publicKey, name: opts.name as string, signers });
            const sig = await client.send([instruction]);
            logger.output({ credential: credential.toBase58(), signature: sig });
        });

    sasCmd
        .command("create-schema")
        .description("Create the KYC schema ThawGate reads (kyc_level: u8, country: String) under your credential")
        .requiredOption("--credential <pubkey>", "Credential")
        .requiredOption("--name <name>", "Schema name (1-32 bytes)")
        .option("--description <text>", "Description", "KYC level and country (ThawGate)")
        .action(async (opts: Opts) => {
            const { client, keypair, logger } = ctx();
            const { instruction, schema } = sas.createSchemaIx({
                payer: keypair.publicKey,
                authority: keypair.publicKey,
                credential: pk(opts.credential, "--credential"),
                name: opts.name as string,
                description: opts.description as string,
                layout: [...sas.KYC_SCHEMA.layout],
                fieldNames: [...sas.KYC_SCHEMA.fieldNames],
            });
            const sig = await client.send([instruction]);
            logger.output({ schema: schema.toBase58(), signature: sig });
        });

    sasCmd
        .command("attest")
        .description("Attest a wallet's KYC (nonce = the wallet), as a signer of the credential")
        .requiredOption("--credential <pubkey>", "Credential")
        .requiredOption("--schema <pubkey>", "Schema (the KYC layout)")
        .requiredOption("--wallet <pubkey>", "Holder wallet")
        .requiredOption("--kyc-level <n>", "kyc_level, 0-255")
        .option("--country <code>", "Country", "IN")
        .option("--expiry-days <days>", "Days until it expires; 0 = never", "365")
        .action(async (opts: Opts) => {
            const { client, keypair, logger } = ctx();
            const days = Number(opts.expiryDays);
            const expiry = days === 0 ? 0 : (await client.clusterTime()) + Math.round(days * 86_400);
            const { instruction, attestation } = sas.createAttestationIx({
                payer: keypair.publicKey,
                authority: keypair.publicKey,
                credential: pk(opts.credential, "--credential"),
                schema: pk(opts.schema, "--schema"),
                nonce: pk(opts.wallet, "--wallet"),
                data: sas.encodeKycData({ kycLevel: Number(opts.kycLevel), country: opts.country as string }),
                expiry,
            });
            const sig = await client.send([instruction]);
            logger.output({ attestation: attestation.toBase58(), expiry, signature: sig });
        });

    sasCmd
        .command("revoke")
        .description("Close a wallet's attestation; under a SAS policy its accounts become freezable")
        .requiredOption("--credential <pubkey>", "Credential")
        .requiredOption("--schema <pubkey>", "Schema")
        .requiredOption("--wallet <pubkey>", "Holder wallet")
        .action(async (opts: Opts) => {
            const { client, keypair, logger } = ctx();
            const credential = pk(opts.credential, "--credential");
            const attestation = sas.findAttestationPda(credential, pk(opts.schema, "--schema"), pk(opts.wallet, "--wallet"));
            const sig = await client.send([sas.closeAttestationIx({ payer: keypair.publicKey, authority: keypair.publicKey, credential, attestation })]);
            logger.output({ attestation: attestation.toBase58(), signature: sig });
        });

    // ------------------------------------------------------------------------------------------------
    // Issuer allowlist (allowOnly / bypassForPdas policies; the mint needs enable_allowlist)
    // ------------------------------------------------------------------------------------------------
    const allowlist = program.command("allowlist").description("The sss-token issuer allowlist (MasterAuthority)");
    for (const [name, add] of [["add", true], ["remove", false]] as const) {
        allowlist
            .command(name)
            .description(add ? "Add a wallet to the allowlist" : "Deactivate a wallet's allowlist entry")
            .requiredOption("--mint <pubkey>", "Mint address")
            .requiredOption("--wallet <pubkey>", "Wallet")
            .action(async (opts: Opts) => {
                const { client, keypair, logger } = ctx();
                const compliance = client.compliance(pk(opts.mint, "--mint"));
                const wallet = pk(opts.wallet, "--wallet");
                const ixs = add ? await compliance.addToAllowlist(keypair.publicKey, wallet) : await compliance.removeFromAllowlist(keypair.publicKey, wallet);
                logger.output({ signature: await client.send(ixs) });
            });
    }
}
