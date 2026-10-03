/**
 * Sanctions screener configuration from the environment, and a JSON-lines logger that masks the RPC URL and the Range
 * API key in every line.
 *
 *   SCREENER_RPC_URL              RPC endpoint. Default: HELIUS_DEVNET_RPC from the environment, else from the repo's .env
 *                                 (SCREENER_DOTENV overrides the file). It carries an API key, so it is masked.
 *   SCREENER_KEYPAIR              path to the screener's keypair file (solana-keygen JSON). The key needs the sss-token
 *                                 Blacklister role on each mint it screens, and SOL for fees and BlacklistEntry rent.
 *                                 It must not be the MasterAuthority.
 *   SCREENER_KEEPER_URL           the keeper's HTTP server (default http://127.0.0.1:3005): GET /mints, GET /mints/:mint.
 *   RANGE_API_KEY                 Range Risk API key (environment or .env). Set: the Range provider screens. Unset: the
 *                                 static list does, labelled as a fallback in logs, /health and /metrics.
 *   RANGE_API_URL                 default https://api.range.org
 *   SCREENER_STATIC_LIST          the static list file (default services/compliance-service/lists/demo.json).
 *   SCREENER_THRESHOLD            risk score (1-10) at or above which a wallet is blacklisted. Default 8, Range's REJECT
 *                                 band (docs.range.org, compliance screening guide: 8-10 reject, 6-7 flag or reject).
 *   SCREENER_POLL_MS              keeper poll interval (default 5000). New holders are screened on the next poll.
 *   SCREENER_RESCREEN_MS          re-screen interval per wallet (default 86400000, one day; Range bills per call). A static
 *                                 list edit re-screens every wallet at once.
 *   SCREENER_PROVIDER_TIMEOUT_MS  per-call provider timeout (default 5000). A timeout never blacklists.
 *   SCREENER_CONCURRENCY          provider calls in parallel (default 4).
 *   SCREENER_MINTS                optional comma list: only these mints.
 *   SCREENER_EXEMPT               comma list of wallets never screened or blacklisted (treasury, pool PDAs).
 *   SCREENER_DRY_RUN              1: screen and log, never send a transaction.
 *   PORT / HOST / LOG_LEVEL       HTTP server (default 3006 / 0.0.0.0 / info).
 */
import fs from "fs";
import path from "path";

export interface ScreenerConfig {
  rpcUrl?: string;
  keypairPath?: string;
  keeperUrl: string;
  rangeApiKey?: string;
  rangeApiUrl: string;
  staticList: string;
  threshold: number;
  pollMs: number;
  rescreenMs: number;
  providerTimeoutMs: number;
  concurrency: number;
  mints?: string[];
  exempt: string[];
  dryRun: boolean;
  port: number;
  host: string;
}

/** A value from a .env file, parsed like tests/e2e/cluster.ts and the keeper. */
export function dotEnvValue(file: string, name: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const int = (v: string | undefined, fallback: number) => (v ? parseInt(v, 10) : fallback);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScreenerConfig {
  // src/screener and dist/screener sit at the same depth below the repo root.
  const dotenvFiles = [env.SCREENER_DOTENV, path.resolve(process.cwd(), ".env"), path.resolve(__dirname, "../../../../.env")];
  const fromDotEnv = (name: string) => dotenvFiles.reduce<string | undefined>((found, f) => found ?? (f ? dotEnvValue(f, name) : undefined), undefined);
  // `||`, not `??`: docker compose passes unset variables through as "".
  const threshold = int(env.SCREENER_THRESHOLD, 8);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10) throw new Error(`SCREENER_THRESHOLD must be 1-10, not ${env.SCREENER_THRESHOLD}`);
  return {
    rpcUrl: env.SCREENER_RPC_URL || env.HELIUS_DEVNET_RPC || fromDotEnv("HELIUS_DEVNET_RPC"),
    keypairPath: env.SCREENER_KEYPAIR || undefined,
    keeperUrl: (env.SCREENER_KEEPER_URL || "http://127.0.0.1:3005").replace(/\/$/, ""),
    rangeApiKey: env.RANGE_API_KEY || fromDotEnv("RANGE_API_KEY"),
    rangeApiUrl: env.RANGE_API_URL || "https://api.range.org",
    staticList: env.SCREENER_STATIC_LIST || path.resolve(__dirname, "../../lists/demo.json"),
    threshold,
    pollMs: int(env.SCREENER_POLL_MS, 5_000),
    rescreenMs: int(env.SCREENER_RESCREEN_MS, 86_400_000),
    providerTimeoutMs: int(env.SCREENER_PROVIDER_TIMEOUT_MS, 5_000),
    concurrency: Math.max(1, int(env.SCREENER_CONCURRENCY, 4)),
    mints: list(env.SCREENER_MINTS),
    exempt: list(env.SCREENER_EXEMPT) ?? [],
    dryRun: env.SCREENER_DRY_RUN === "1" || env.SCREENER_DRY_RUN === "true",
    port: int(env.PORT, 3006),
    host: env.HOST || "0.0.0.0",
  };
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Replaces each secret (the RPC URL, the Range key) and any `api-key=` value with <SECRET>. */
export function masker(secrets: (string | undefined)[]): (s: string) => string {
  const parts = secrets.filter((s): s is string => !!s && s.length > 8);
  return (s: string) => {
    let out = s;
    for (const p of parts) out = out.split(p).join("<SECRET>");
    return out.replace(/api-key=[^&\s"']+/gi, "api-key=<SECRET>").replace(/Bearer\s+[^\s"']+/g, "Bearer <SECRET>");
  };
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createLogger(mask: (s: string) => string, level: keyof typeof LEVELS = "info"): Logger {
  const log = (lvl: keyof typeof LEVELS, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const line = mask(
      JSON.stringify({ time: new Date().toISOString(), level: lvl, service: "screener", msg, ...(data ?? {}) }, (_k, v) =>
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
