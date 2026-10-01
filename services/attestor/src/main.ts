/** Entry point: `node dist/main.js` (see services/attestor/README.md for the environment). */
import fs from "fs";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { tick } from "./attestor";
import { loadConfig, logLine, masker } from "./config";
import { readReport } from "./source";

let mask = masker([process.env.ATTESTOR_RPC_URL ?? "", process.env.HELIUS_DEVNET_RPC ?? ""]);

async function main() {
  const config = loadConfig();
  mask = masker([config.rpcUrl]);
  const rpc = createSolanaRpc(config.rpcUrl);
  const attestor = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(config.keypairPath, "utf8"))));
  logLine(mask, "info", "attestor starting", { attestor: attestor.address, once: config.once, dryRun: config.dryRun, intervalMs: config.intervalMs });

  let stopping = false;
  let wake: (() => void) | undefined;
  process.on("SIGTERM", () => ((stopping = true), wake?.()));
  process.on("SIGINT", () => ((stopping = true), wake?.()));

  for (;;) {
    let skipped = false;
    try {
      const report = await readReport(config.source);
      const { decision, signature } = await tick(report, { rpc, attestor, dryRun: config.dryRun });
      skipped = !decision.post && decision.reason !== "unchanged";
      logLine(mask, skipped ? "warn" : "info", decision.post ? (config.dryRun ? "would post" : "posted") : "skipped", {
        mint: report.mint,
        reserves: report.reserves,
        asOf: report.asOf,
        reason: decision.reason,
        ...(decision.post ? {} : { detail: decision.detail }),
        ...(signature ? { signature } : {}),
      });
    } catch (e) {
      logLine(mask, "error", "tick failed", { error: e instanceof Error ? e.message : String(e) });
      if (config.once) process.exit(1);
    }
    if (config.once) process.exit(skipped ? 2 : 0);
    if (stopping) break;
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, config.intervalMs);
    });
    if (stopping) break;
  }
  logLine(mask, "info", "attestor stopped");
}

main().catch((e) => {
  console.error(mask(`attestor failed: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
