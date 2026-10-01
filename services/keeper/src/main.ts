/** Entry point: `node dist/main.js` (see services/keeper/README.md for the environment). */
import fs from "fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { createLogger, loadConfig, masker } from "./config";
import { Keeper } from "./keeper";
import { startServer } from "./server";

/** Masks the RPC URL (it carries an API key) in anything printed, including a startup error. */
let mask = masker([process.env.KEEPER_RPC_URL ?? "", process.env.HELIUS_DEVNET_RPC ?? "", process.env.KEEPER_WS_URL ?? ""]);

async function main() {
  const config = loadConfig();
  mask = masker([config.rpcUrl, config.wsUrl]);
  const log = createLogger(mask, (process.env.LOG_LEVEL as any) ?? "info");
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(config.keypairPath, "utf8"))));
  const keeper = new Keeper(config, signer, log);
  const server = await startServer(keeper, config.port, config.host);
  log.info("http listening", { port: config.port });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("stopping", { signal });
    await server.close();
    await keeper.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  await keeper.start();
}

main().catch((e) => {
  console.error(mask(`keeper failed: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
