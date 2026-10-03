/**
 * Risk providers. A provider turns a wallet address into a score from 1 (clean) to 10 (directly malicious), Range's
 * scale. Any failure throws a ProviderError: there is no "unknown means clean" and no "unknown means flagged" path, and
 * the screener never blacklists on an error.
 *
 *   RangeProvider       Range Risk API, GET /v1/risk/address?address=&network=solana with a Bearer key
 *                       (docs.range.org/risk-api/risk/get-address-risk-score). Used only when RANGE_API_KEY is set.
 *   StaticListProvider  a JSON list { name, source, addresses } on disk: listed = 10, otherwise 1. The fallback when
 *                       there is no Range key, and labelled as such.
 */
import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { MAX_REASON_LEN } from "./chain";

export class ProviderError extends Error {
  constructor(
    /** timeout | network | parse | http_<status> */
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RiskResult {
  score: number;
  /** Provider detail for logs (Range's riskLevel); never written on chain. */
  detail?: string;
}

export interface RiskProvider {
  readonly name: "range" | "static";
  /** True for the static list: the screener runs without a live risk API. */
  readonly fallback: boolean;
  /** For logs, /health and metrics: "range" or "static:<list name>". */
  readonly label: string;
  /** Changes when the provider's data changes (a static list edit), so every wallet is re-screened. Undefined for an API. */
  version(): string | undefined;
  /** The reason written into the BlacklistEntry: "range:<score>" or "static:<list name>", at most 100 bytes. */
  reason(result: RiskResult): string;
  /** Throws ProviderError on any failure, including an abort through `signal`. */
  screen(wallet: string, signal: AbortSignal): Promise<RiskResult>;
  /** Extra detail for /health (the static list's file and size). */
  info?(): Record<string, unknown>;
}

/** Keeps a reason within sss-token's MAX_REASON_LEN (bytes) and to a safe character set. */
export function clampReason(reason: string): string {
  const safe = reason.replace(/[^A-Za-z0-9:._-]/g, "_");
  return Buffer.from(safe, "utf8").subarray(0, MAX_REASON_LEN).toString("utf8");
}

const isAbort = (e: unknown, signal: AbortSignal) =>
  signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));

export class RangeProvider implements RiskProvider {
  readonly name = "range" as const;
  readonly fallback = false;
  readonly label = "range";

  constructor(
    private readonly opts: { apiKey: string; baseUrl?: string; network?: string; fetch?: typeof fetch },
  ) {}

  version() {
    return undefined;
  }

  reason(result: RiskResult) {
    return clampReason(`range:${result.score}`);
  }

  async screen(wallet: string, signal: AbortSignal): Promise<RiskResult> {
    const url = new URL("/v1/risk/address", this.opts.baseUrl ?? "https://api.range.org");
    url.searchParams.set("address", wallet);
    url.searchParams.set("network", this.opts.network ?? "solana");
    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json" }, signal });
    } catch (e) {
      if (isAbort(e, signal)) throw new ProviderError("timeout", `Range timed out for ${wallet}`);
      throw new ProviderError("network", `Range request failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new ProviderError(`http_${res.status}`, `Range answered ${res.status} for ${wallet}`);
    let body: any;
    try {
      body = await res.json();
    } catch (e) {
      if (isAbort(e, signal)) throw new ProviderError("timeout", `Range timed out for ${wallet}`);
      throw new ProviderError("parse", `Range sent a body that is not JSON for ${wallet}`);
    }
    const score = body?.riskScore;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 10) {
      throw new ProviderError("parse", `Range riskScore for ${wallet} is not an integer 1-10: ${JSON.stringify(score)}`);
    }
    return { score, detail: typeof body.riskLevel === "string" ? body.riskLevel : undefined };
  }
}

interface StaticList {
  name: string;
  source: string;
  addresses: Set<string>;
}

/** Parses and validates a list file. Throws on anything malformed, so a bad edit never empties the list. */
export function parseStaticList(text: string): StaticList {
  const json = JSON.parse(text);
  if (typeof json?.name !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(json.name)) throw new Error("list `name` must match [A-Za-z0-9._-]{1,40}");
  if (!Array.isArray(json.addresses)) throw new Error("list `addresses` must be an array");
  const addresses = new Set<string>();
  for (const a of json.addresses) {
    if (typeof a !== "string") throw new Error(`list address is not a string: ${JSON.stringify(a)}`);
    addresses.add(new PublicKey(a).toBase58()); // throws on a malformed address
  }
  return { name: json.name, source: typeof json.source === "string" ? json.source : "", addresses };
}

export class StaticListProvider implements RiskProvider {
  readonly name = "static" as const;
  readonly fallback = true;
  private list: StaticList;
  private loadedStat: string;
  private failedStat?: string;

  constructor(
    readonly file: string,
    private readonly onReloadError: (e: unknown) => void = () => undefined,
  ) {
    // A list that can't be read at startup is fatal: the screener would run with nothing to screen against.
    this.loadedStat = this.stat();
    this.list = parseStaticList(fs.readFileSync(file, "utf8"));
  }

  get label() {
    return `static:${this.list.name}`;
  }

  get size() {
    return this.list.addresses.size;
  }

  get source() {
    return this.list.source;
  }

  info() {
    return { file: this.file, size: this.list.addresses.size, source: this.list.source };
  }

  private stat(): string {
    const s = fs.statSync(this.file);
    return `${s.mtimeMs}:${s.size}`;
  }

  /** Reloads the file if it changed. A bad edit keeps the last good list and is reported once. */
  private refresh() {
    let now: string;
    try {
      now = this.stat();
    } catch (e) {
      if (this.failedStat !== "missing") this.onReloadError(e);
      this.failedStat = "missing";
      return;
    }
    if (now === this.loadedStat || now === this.failedStat) return;
    try {
      this.list = parseStaticList(fs.readFileSync(this.file, "utf8"));
      this.loadedStat = now;
      this.failedStat = undefined;
    } catch (e) {
      this.failedStat = now;
      this.onReloadError(e);
    }
  }

  version() {
    this.refresh();
    return this.loadedStat;
  }

  reason(_result: RiskResult) {
    return clampReason(`static:${this.list.name}`);
  }

  async screen(wallet: string, signal: AbortSignal): Promise<RiskResult> {
    if (signal.aborted) throw new ProviderError("timeout", `static screen aborted for ${wallet}`);
    this.refresh();
    return { score: this.list.addresses.has(wallet) ? 10 : 1 };
  }
}

/** Range when RANGE_API_KEY is set, otherwise the static list (the labelled fallback). */
export function selectProvider(
  cfg: { rangeApiKey?: string; rangeApiUrl: string; staticList: string },
  onReloadError?: (e: unknown) => void,
): RiskProvider {
  if (cfg.rangeApiKey) return new RangeProvider({ apiKey: cfg.rangeApiKey, baseUrl: cfg.rangeApiUrl });
  return new StaticListProvider(cfg.staticList, onReloadError);
}
