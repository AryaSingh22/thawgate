/**
 * Cluster switch for tests/e2e. Import it before tests/gate/helpers, which reads ANCHOR_PROVIDER_URL and
 * ANCHOR_WALLET when it loads.
 *   CLUSTER=localnet (default): the scripts/test-gate.sh validator and test-keypair.json, like the gate suites.
 *   CLUSTER=devnet: RPC = HELIUS_DEVNET_RPC from the environment or ~/thawgate/.env (it carries an API key and is
 *   never printed). Payer = ANCHOR_WALLET, default the sss-token upgrade authority's keypair (5BXg…). SAS credential
 *   authority = SAS_ISSUER_KEYPAIR, default the S3 spike payer (5avMn…). Reserve attestor = ATTESTOR_KEYPAIR.
 */
import fs from "fs";
import os from "os";
import path from "path";

export type Cluster = "localnet" | "devnet";
export const CLUSTER = (process.env.CLUSTER ?? "localnet") as Cluster;
if (CLUSTER !== "localnet" && CLUSTER !== "devnet") throw new Error(`CLUSTER must be localnet or devnet, not ${CLUSTER}`);

const home = (p: string) => path.join(os.homedir(), p);

function heliusFromDotEnv(): string | undefined {
  const file = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("HELIUS_DEVNET_RPC="));
  return line?.slice("HELIUS_DEVNET_RPC=".length).trim().replace(/^["']|["']$/g, "") || undefined;
}

if (CLUSTER === "devnet") {
  const url = process.env.HELIUS_DEVNET_RPC ?? heliusFromDotEnv();
  if (!url) throw new Error("CLUSTER=devnet needs HELIUS_DEVNET_RPC (environment or .env)");
  process.env.ANCHOR_PROVIDER_URL = url;
  process.env.ANCHOR_WALLET ??= home(".config/solana/sss-authority.json");
}

/** Keypair file of the SAS credential authority on devnet. */
export const SAS_ISSUER_KEYPAIR = process.env.SAS_ISSUER_KEYPAIR ?? home(".keys/thawgate/spike-payer.json");

/** Keypair file of the reserve attestor on devnet (created on first use, mode 600; it needs no SOL, the payer pays). */
export const ATTESTOR_KEYPAIR = process.env.ATTESTOR_KEYPAIR ?? home(".keys/thawgate/attestor.json");

/** An explorer link on devnet; localnet signatures don't outlive the validator, so they aren't printed. */
export const txLink = (sig: string) => (CLUSTER === "devnet" ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : "");
