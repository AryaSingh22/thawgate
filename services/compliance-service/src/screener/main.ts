/**
 * Entry point of the sanctions screener (see docs/thawgate/SANCTIONS.md and the environment in ./config.ts).
 *
 *   node dist/screener/main.js                  run: poll the keeper, screen holders, blacklist flagged wallets.
 *   node dist/screener/main.js probe <address>  print one provider result and exit (no keypair, no transaction).
 */
import fs from "fs";
import { Keypair } from "@solana/web3.js";
import { createLogger, loadConfig, masker } from "./config";
import { SolanaChain } from "./chain";
import { selectProvider } from "./providers";
import { KeeperHttp, Screener } from "./screener";
import { startServer } from "./server";

/** Masks the RPC URL and the Range key in anything printed, including a startup error. */
let mask = masker([process.env.SCREENER_RPC_URL, process.env.HELIUS_DEVNET_RPC, process.env.RANGE_API_KEY]);

async function main() {
  const config = loadConfig();
  mask = masker([config.rpcUrl, config.rangeApiKey]);
  const log = createLogger(mask, (process.env.LOG_LEVEL as any) ?? "info");
  let reloadErrors = 0;
  let onReloadError = (e: unknown) => {
    reloadErrors++;
    log.error("static list edit could not be loaded; keeping the last good list", { error: e });
  };
  const provider = selectProvider(config, (e) => onReloadError(e));

  if (process.argv[2] === "probe") {
    const wallet = process.argv[3];
    if (!wallet) throw new Error("usage: main.js probe <address>");
    const result = await provider.screen(wallet, AbortSignal.timeout(config.providerTimeoutMs));
    console.log(JSON.stringify({ provider: provider.label, fallback: provider.fallback, wallet, ...result, threshold: config.threshold, flagged: result.score >= config.threshold }));
    return;
  }

  if (!config.rpcUrl) throw new Error("no RPC: set SCREENER_RPC_URL or HELIUS_DEVNET_RPC (environment or .env)");
  if (!config.keypairPath) throw new Error("SCREENER_KEYPAIR (path to the Blacklister keypair) is not set");
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(config.keypairPath, "utf8"))));
  const screener = new Screener(config, provider, new SolanaChain(config.rpcUrl, signer), new KeeperHttp(config.keeperUrl), log);
  onReloadError = (e) => {
    screener.metrics.inc("thawgate_screener_list_reload_errors_total");
    log.error("static list edit could not be loaded; keeping the last good list", { error: e });
  };
  if (reloadErrors) screener.metrics.inc("thawgate_screener_list_reload_errors_total", {}, reloadErrors);
  if (provider.fallback) log.warn("no RANGE_API_KEY: screening against the static list (fallback)", { list: provider.label, file: config.staticList });
  const server = await startServer(screener, config.port, config.host);
  log.info("http listening", { port: config.port });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("stopping", { signal });
    await server.close();
    await screener.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  await screener.start();
}

main().catch((e) => {
  console.error(mask(`screener failed: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
