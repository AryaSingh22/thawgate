/**
 * Attestor configuration from the environment.
 *
 *   ATTESTOR_SOURCE       JSON file path or http(s) URL of the reserve report (src/source.ts has the format). Required.
 *   ATTESTOR_KEYPAIR      path to the attestor's keypair file (solana-keygen JSON). It signs and pays the fee. Required.
 *   ATTESTOR_RPC_URL      RPC endpoint. Default: HELIUS_DEVNET_RPC from the environment, else from the repo's .env.
 *                         It carries an API key, so it is masked in every log line.
 *   ATTESTOR_INTERVAL_MS  time between ticks (default 60000).
 *   ATTESTOR_ONCE=1       one tick, then exit: 0 posted or unchanged, 2 skipped (wrong attestor, no attestation, older
 *                         or future source), 1 error.
 *   DRY_RUN=1             decide and log, never send.
 */
import fs from "fs";
import path from "path";

export interface AttestorConfig {
  source: string;
  keypairPath: string;
  rpcUrl: string;
  intervalMs: number;
  once: boolean;
  dryRun: boolean;
}

/** A value from a .env file, parsed like tests/e2e/cluster.ts and services/keeper. */
function dotEnvValue(file: string, name: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AttestorConfig {
  const rpcUrl =
    env.ATTESTOR_RPC_URL ||
    env.HELIUS_DEVNET_RPC ||
    [path.resolve(process.cwd(), ".env"), path.resolve(__dirname, "../../../.env")].reduce<string | undefined>(
      (found, f) => found ?? dotEnvValue(f, "HELIUS_DEVNET_RPC"),
      undefined,
    );
  if (!rpcUrl) throw new Error("no RPC: set ATTESTOR_RPC_URL or HELIUS_DEVNET_RPC (environment or .env)");
  if (!env.ATTESTOR_SOURCE) throw new Error("ATTESTOR_SOURCE (JSON file or URL) is not set");
  if (!env.ATTESTOR_KEYPAIR) throw new Error("ATTESTOR_KEYPAIR (path to the attestor keypair) is not set");
  return {
    source: env.ATTESTOR_SOURCE,
    keypairPath: env.ATTESTOR_KEYPAIR,
    rpcUrl,
    intervalMs: env.ATTESTOR_INTERVAL_MS ? parseInt(env.ATTESTOR_INTERVAL_MS, 10) : 60_000,
    once: env.ATTESTOR_ONCE === "1",
    dryRun: env.DRY_RUN === "1",
  };
}

/** Replaces each secret (and any `api-key=` value) with <RPC>. Same rule as the keeper's masker. */
export function masker(secrets: string[]): (s: string) => string {
  const parts = secrets.filter((s) => s && s.length > 8);
  return (s: string) => {
    let out = s;
    for (const p of parts) out = out.split(p).join("<RPC>");
    return out.replace(/api-key=[^&\s"']+/gi, "api-key=<RPC>");
  };
}

/** One JSON line per event, masked. */
export function logLine(mask: (s: string) => string, level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const line = mask(
    JSON.stringify({ time: new Date().toISOString(), level, service: "attestor", msg, ...(data ?? {}) }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v instanceof Error ? v.message : v,
    ),
  );
  (level === "error" ? console.error : console.log)(line);
}
