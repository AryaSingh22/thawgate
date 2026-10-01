/**
 * Keeper configuration from the environment, and a JSON-lines logger that never prints the RPC URL.
 *
 *   KEEPER_RPC_URL     RPC endpoint. Default: HELIUS_DEVNET_RPC from the environment, else from the repo's .env
 *                      (KEEPER_DOTENV overrides the file). It carries an API key, so it is masked in every log line.
 *   KEEPER_WS_URL      websocket endpoint. Default: the RPC URL with http(s) -> ws(s) (localhost :8899 -> :8900).
 *   KEEPER_KEYPAIR     path to the fee payer's keypair file (solana-keygen JSON). It needs no role on any mint.
 *   KEEPER_MINTS       optional comma list: only these mints. Default: every mint whose Token ACL gate is ThawGate.
 *   KEEPER_SKIP_MINTS  optional comma list of mints to leave alone.
 *   KEEPER_SWEEP_MS    expiry sweep + polling fallback interval (default 15000).
 *   KEEPER_RESYNC_MS   full re-listing of policies and token accounts (default 300000).
 *   KEEPER_CU_LIMIT    compute unit limit per freeze (default 100000; a devnet freeze measured 35,143 CU).
 *   KEEPER_CU_PRICE    priority fee, micro-lamports per CU (default 0).
 *   PORT / HOST        HTTP server for /health and /metrics (default 3005 / 0.0.0.0).
 */
import fs from "fs";
import path from "path";

export interface KeeperConfig {
  rpcUrl: string;
  wsUrl: string;
  mints?: string[];
  skipMints: string[];
  sweepMs: number;
  resyncMs: number;
  cuLimit: number;
  cuPrice: bigint;
}

export interface ServiceConfig extends KeeperConfig {
  keypairPath: string;
  port: number;
  host: string;
}

/** HELIUS_DEVNET_RPC from a .env file, parsed like tests/e2e/cluster.ts. */
export function dotEnvValue(file: string, name: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

export const wsUrlFor = (rpcUrl: string) =>
  rpcUrl.replace(/^http/, "ws").replace(/(127\.0\.0\.1|localhost):8899/, "$1:8900");

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const int = (v: string | undefined, fallback: number) => (v ? parseInt(v, 10) : fallback);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const dotenvFiles = [env.KEEPER_DOTENV, path.resolve(process.cwd(), ".env"), path.resolve(__dirname, "../../../.env")];
  // `||`, not `??`: docker compose passes unset variables through as "".
  const rpcUrl =
    env.KEEPER_RPC_URL ||
    env.HELIUS_DEVNET_RPC ||
    dotenvFiles.reduce<string | undefined>((found, f) => found ?? (f ? dotEnvValue(f, "HELIUS_DEVNET_RPC") : undefined), undefined);
  if (!rpcUrl) throw new Error("no RPC: set KEEPER_RPC_URL or HELIUS_DEVNET_RPC (environment or .env)");
  if (!env.KEEPER_KEYPAIR) throw new Error("KEEPER_KEYPAIR (path to the fee payer keypair) is not set");
  return {
    rpcUrl,
    wsUrl: env.KEEPER_WS_URL || wsUrlFor(rpcUrl),
    keypairPath: env.KEEPER_KEYPAIR,
    mints: list(env.KEEPER_MINTS),
    skipMints: list(env.KEEPER_SKIP_MINTS) ?? [],
    sweepMs: int(env.KEEPER_SWEEP_MS, 15_000),
    resyncMs: int(env.KEEPER_RESYNC_MS, 300_000),
    cuLimit: int(env.KEEPER_CU_LIMIT, 100_000),
    cuPrice: BigInt(env.KEEPER_CU_PRICE || "0"),
    port: int(env.PORT, 3005),
    host: env.HOST ?? "0.0.0.0",
  };
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Replaces each secret (and any `api-key=` value) with <RPC>. */
export function masker(secrets: string[]): (s: string) => string {
  const parts = secrets.filter((s) => s && s.length > 8);
  return (s: string) => {
    let out = s;
    for (const p of parts) out = out.split(p).join("<RPC>");
    return out.replace(/api-key=[^&\s"']+/gi, "api-key=<RPC>");
  };
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createLogger(mask: (s: string) => string, level: keyof typeof LEVELS = "info"): Logger {
  const log = (lvl: keyof typeof LEVELS, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const line = mask(
      JSON.stringify({ time: new Date().toISOString(), level: lvl, service: "keeper", msg, ...(data ?? {}) }, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v instanceof Error ? v.message : v,
      ),
    );
    (lvl === "error" ? console.error : console.log)(line);
  };
  return {
    debug: (m, d) => log("debug", m, d),
    info: (m, d) => log("info", m, d),
    warn: (m, d) => log("warn", m, d),
    error: (m, d) => log("error", m, d),
  };
}
