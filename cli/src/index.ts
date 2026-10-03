/**
 * @module thawgate CLI
 * @description Command-line interface for ThawGate (@thawgate/sdk): Token ACL gate policies, SSS-ACL stablecoins
 * (sss-token is the example issuer) and SAS credentials. Devnet program IDs are the defaults.
 *
 * Usage:
 *   thawgate create-stablecoin --name "USD Stablecoin" --symbol USDS --blacklist on \
 *     --sas-credential <pubkey> --sas-schema <pubkey> --min-kyc 1 --reserves 1000000000000 --report-uri https://...
 *   thawgate explain --mint <pubkey> --wallet <pubkey>
 *   thawgate unlock --mint <pubkey> --owner <pubkey>
 *   thawgate freeze-if-invalid --token-account <pubkey>
 *   thawgate policy show|init|update|setup-extra-metas --mint <pubkey> ...
 *   thawgate swap-gate --mint <pubkey> --sas-credential <pubkey> --sas-schema <pubkey> --confirm
 *   thawgate sas create-credential|create-schema|attest|revoke ...
 *   thawgate mint --mint <pubkey> --recipient <pubkey> --amount 1000000
 *   thawgate blacklist --mint <pubkey> --target <wallet> --reason "..." [--token-account <pubkey>] --confirm
 *   thawgate status --mint <pubkey>
 */

import { Command } from "commander";
import { parseGateLogs } from "@thawgate/sdk";
import { registerCommands } from "./commands";
import { registerGateCommands } from "./gate";

const program = new Command();

program
    .name("thawgate")
    .description("ThawGate CLI: Token ACL gate policies, SSS-ACL stablecoins and SAS credentials (devnet IDs by default)")
    .version("0.1.0")
    .option("--rpc-url <url>", "Solana RPC endpoint URL (or SSS_RPC_URL; default devnet)")
    .option("--commitment <level>", "Commitment level", "confirmed")
    .option("--keypair <path>", "Path to keypair file (or SSS_KEYPAIR_PATH; default ~/.config/solana/id.json)")
    .option("--json", "Output in JSON format (progress lines go to stderr)")
    .option("--verbose", "Enable verbose logging");

registerGateCommands(program);
registerCommands(program);

program.parseAsync(process.argv).catch((err) => {
    console.error("Error:", err.message);
    // A refused transaction: show the gate's own decision line if it logged one.
    const logs: string[] | undefined = err?.logs ?? err?.transactionLogs;
    const decision = logs ? parseGateLogs(logs).decision : null;
    if (decision) console.error(`Gate: TG:${decision.kind}:${decision.code}`);
    if (logs && program.opts().verbose) console.error(logs.join("\n"));
    process.exit(1);
});
