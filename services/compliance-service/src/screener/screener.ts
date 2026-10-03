/**
 * The sanctions screener: risk provider result -> sss-token add_to_blacklist -> (the keeper freezes the rest).
 *
 * Every SCREENER_POLL_MS it reads the keeper's holder index over HTTP (GET /mints, GET /mints/:mint; no second
 * indexer) and keeps, per wallet, the token accounts it holds on each eligible mint. A mint is eligible when its gate
 * policy checks the sss-token blacklist and the screener key holds an active Blacklister role on it.
 *
 * Due for screening: new holders; wallets last screened more than SCREENER_RESCREEN_MS ago; every wallet after the
 * provider's data changes (a static list edit); wallets whose last screen failed, with backoff. Wallets with a
 * BlacklistEntry (active or not) on every mint they hold are skipped before the provider is called.
 *
 * A score at or above the threshold sends add_to_blacklist(reason) for each eligible mint the wallet holds, passing
 * one of its token accounts there (a thawed one if any, so sss-token freezes it in the same transaction). The
 * AddedToBlacklist event is the keeper's trigger to freeze the wallet's other thawed accounts.
 *
 * Fail-safe: a provider error or timeout never blacklists. It is counted and the wallet is retried. An inactive
 * BlacklistEntry means an operator removed the wallet; the screener leaves it alone (sss-token's entry is `init`, so it
 * couldn't re-add it anyway). Seizing stays a manual step (the CLI's `seize`).
 */
import { Chain, EntryRead, SSS_TOKEN_ID } from "./chain";
import { Logger, ScreenerConfig } from "./config";
import { Metrics } from "./metrics";
import { ProviderError, RiskProvider } from "./providers";

export interface KeeperAccount {
  address: string;
  owner: string;
  state: string;
}

export interface KeeperMint {
  mint: string;
  policy: { issuerProgram: string; checkBlacklist: boolean };
}

/** The keeper's index, as the screener reads it. */
export interface HolderSource {
  mints(): Promise<KeeperMint[]>;
  /** A mint's token accounts; undefined if the keeper no longer tracks it. */
  accounts(mint: string): Promise<KeeperAccount[] | undefined>;
}

export class KeeperHttp implements HolderSource {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 5_000,
  ) {}

  private async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`keeper ${path} answered ${res.status}`);
    return res.json() as Promise<any>;
  }

  async mints(): Promise<KeeperMint[]> {
    const body = await this.get("/mints");
    if (!Array.isArray(body)) throw new Error("keeper /mints did not return a list");
    return body;
  }

  async accounts(mint: string): Promise<KeeperAccount[] | undefined> {
    const body = await this.get(`/mints/${mint}`);
    return body?.accounts;
  }
}

export type Decision = "clean" | "flagged" | "error" | "blacklisted" | "skipped" | "failed";

/** One line of GET /screenings. Times are wall-clock ms. */
export interface ScreeningRecord {
  at: number;
  wallet: string;
  mint?: string;
  provider: string;
  decision: Decision;
  score?: number;
  reason?: string;
  detail?: string;
  flaggedAt?: number;
  tokenAccount?: string;
  sig?: string;
  slot?: number;
  confirmedAt?: number;
}

interface WalletState {
  wallet: string;
  holdings: Map<string, KeeperAccount[]>;
  lastScreenedAt?: number;
  lastVersion?: string;
  failures: number;
  retryAt?: number;
}

interface Pending {
  mint: string;
  wallet: string;
  reason: string;
  score: number;
  flaggedAt: number;
  attempts: number;
}

const ROLE_RECHECK_MS = 60_000;
const RETRY_BASE_MS = 30_000;
const MAX_SEND_ATTEMPTS = 5;
const RECORDS = 1_000;
const BALANCE_EVERY = 12;

const sleepUnless = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

/** Runs `fn` over `items`, at most `limit` at a time. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export class Screener {
  readonly metrics = new Metrics();
  private wallets = new Map<string, WalletState>();
  private eligible = new Map<string, { ok: boolean; why: string; checkedAt: number }>();
  private pending = new Map<string, Pending>();
  /** One add_to_blacklist at a time per (mint, wallet). */
  private inflight = new Set<string>();
  private records: ScreeningRecord[] = [];
  private stop$ = new AbortController();
  private loopDone?: Promise<void>;
  private lastPoll?: number;
  private polls = 0;

  constructor(
    readonly config: Pick<ScreenerConfig, "threshold" | "pollMs" | "rescreenMs" | "providerTimeoutMs" | "concurrency" | "mints" | "exempt" | "dryRun"> & {
      /** First retry delay after a provider error, doubling per failure (default 30 s; tests shorten it). */
      retryBaseMs?: number;
    },
    readonly provider: RiskProvider,
    private readonly chain: Chain,
    private readonly source: HolderSource,
    private readonly log: Logger,
  ) {
    this.metrics.set("thawgate_screener_provider_info", { provider: provider.name, fallback: provider.fallback ? "1" : "0", label: provider.label }, 1);
    this.metrics.set("thawgate_screener_threshold", {}, config.threshold);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------------------------
  async start() {
    this.log.info("screener starting", {
      operator: this.chain.operator,
      provider: this.provider.label,
      fallback: this.provider.fallback ? "static list: RANGE_API_KEY is not set" : false,
      threshold: this.config.threshold,
      pollMs: this.config.pollMs,
      rescreenMs: this.config.rescreenMs,
      mints: this.config.mints,
      exempt: this.config.exempt,
      dryRun: this.config.dryRun,
    });
    await this.poll().catch((e) => this.log.error("poll failed", { error: e }));
    this.loopDone = (async () => {
      while (!this.stop$.signal.aborted) {
        await sleepUnless(this.config.pollMs, this.stop$.signal);
        if (this.stop$.signal.aborted) break;
        await this.poll().catch((e) => this.log.error("poll failed", { error: e }));
      }
    })();
  }

  async stop() {
    this.stop$.abort();
    await this.loopDone;
    this.log.info("screener stopped");
  }

  health() {
    const age = this.lastPoll === undefined ? undefined : Date.now() - this.lastPoll;
    return {
      status: age === undefined ? "starting" : age < 3 * this.config.pollMs ? "ok" : "stale",
      operator: this.chain.operator,
      provider: { name: this.provider.name, label: this.provider.label, fallback: this.provider.fallback, ...this.provider.info?.() },
      threshold: this.config.threshold,
      pollMs: this.config.pollMs,
      lastPollAgeMs: age,
      eligibleMints: [...this.eligible].filter(([, e]) => e.ok).map(([m]) => m),
      wallets: this.wallets.size,
      pending: this.pending.size,
      dryRun: this.config.dryRun,
    };
  }

  screenings(wallet?: string, limit = 200): ScreeningRecord[] {
    const rows = wallet ? this.records.filter((r) => r.wallet === wallet) : this.records;
    return rows.slice(-limit);
  }

  private record(r: Omit<ScreeningRecord, "at" | "provider">) {
    this.records.push({ at: Date.now(), provider: this.provider.label, ...r });
    if (this.records.length > RECORDS) this.records.splice(0, this.records.length - RECORDS);
  }

  // ------------------------------------------------------------------------------------------------------------
  // One poll
  // ------------------------------------------------------------------------------------------------------------
  async poll() {
    const holdings = await this.readHoldings();
    if (!holdings) return;
    this.track(holdings);
    await this.flushPending();
    const version = this.provider.version();
    const now = Date.now();
    const due = [...this.wallets.values()].filter((w) => this.isDue(w, version, now));
    if (due.length) await this.screenDue(due, version);
    this.lastPoll = Date.now();
    this.metrics.inc("thawgate_screener_polls_total");
    this.metrics.set("thawgate_screener_last_poll_timestamp_seconds", {}, Math.floor(this.lastPoll / 1000));
    this.metrics.set("thawgate_screener_tracked_wallets", {}, this.wallets.size);
    if (this.polls++ % BALANCE_EVERY === 0) {
      await this.chain.balance().then(
        (lamports) => this.metrics.set("thawgate_screener_signer_lamports", {}, lamports),
        () => undefined,
      );
    }
  }

  /** wallet -> mint -> token accounts, over every eligible mint; undefined if the keeper can't be read. */
  private async readHoldings(): Promise<Map<string, Map<string, KeeperAccount[]>> | undefined> {
    let mints: KeeperMint[];
    try {
      mints = await this.source.mints();
    } catch (e) {
      this.metrics.inc("thawgate_screener_keeper_errors_total");
      this.log.warn("keeper index unreadable", { error: e });
      return undefined;
    }
    const byWallet = new Map<string, Map<string, KeeperAccount[]>>();
    const seen = new Set<string>();
    for (const m of mints) {
      seen.add(m.mint);
      if (!(await this.isEligible(m))) continue;
      let accounts: KeeperAccount[] | undefined;
      try {
        accounts = await this.source.accounts(m.mint);
      } catch (e) {
        this.metrics.inc("thawgate_screener_keeper_errors_total");
        this.log.warn("keeper mint unreadable", { mint: m.mint, error: e });
        return undefined;
      }
      for (const a of accounts ?? []) {
        const perMint = byWallet.get(a.owner) ?? new Map<string, KeeperAccount[]>();
        perMint.set(m.mint, [...(perMint.get(m.mint) ?? []), a]);
        byWallet.set(a.owner, perMint);
      }
    }
    for (const mint of [...this.eligible.keys()]) if (!seen.has(mint)) this.eligible.delete(mint);
    this.metrics.set("thawgate_screener_eligible_mints", {}, [...this.eligible.values()].filter((e) => e.ok).length);
    return byWallet;
  }

  private async isEligible(m: KeeperMint): Promise<boolean> {
    const known = this.eligible.get(m.mint);
    let why: string;
    if (this.config.mints && !this.config.mints.includes(m.mint)) why = "not in SCREENER_MINTS";
    else if (!m.policy?.checkBlacklist) why = "policy does not check the blacklist";
    else if (m.policy.issuerProgram !== SSS_TOKEN_ID.toBase58()) why = "issuer program is not sss-token";
    else if (known && (known.why === "eligible" || known.why === "no Blacklister role") && Date.now() - known.checkedAt < ROLE_RECHECK_MS) return known.ok;
    else {
      const hasRole = await this.chain.hasBlacklisterRole(m.mint).catch((e) => {
        this.log.warn("role read failed", { mint: m.mint, error: e });
        return known?.ok ?? false;
      });
      why = hasRole ? "eligible" : "no Blacklister role";
    }
    const ok = why === "eligible";
    if (!known || known.ok !== ok || known.why !== why) this.log.info(ok ? "mint eligible" : "mint not eligible", { mint: m.mint, why });
    this.eligible.set(m.mint, { ok, why, checkedAt: Date.now() });
    return ok;
  }

  private track(holdings: Map<string, Map<string, KeeperAccount[]>>) {
    for (const [wallet, perMint] of holdings) {
      const known = this.wallets.get(wallet);
      if (known) known.holdings = perMint;
      else this.wallets.set(wallet, { wallet, holdings: perMint, failures: 0 });
    }
    for (const wallet of [...this.wallets.keys()]) if (!holdings.has(wallet)) this.wallets.delete(wallet);
  }

  private isDue(w: WalletState, version: string | undefined, now: number) {
    if (w.retryAt !== undefined && now < w.retryAt) return false;
    if (w.lastScreenedAt === undefined) return true;
    if (version !== undefined && w.lastVersion !== version) return true;
    return now - w.lastScreenedAt >= this.config.rescreenMs;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Screening
  // ------------------------------------------------------------------------------------------------------------
  private async screenDue(due: WalletState[], version: string | undefined) {
    const toScreen: WalletState[] = [];
    const exempt = new Set(this.config.exempt);
    for (const w of due) {
      if (!exempt.has(w.wallet)) {
        toScreen.push(w);
        continue;
      }
      w.lastScreenedAt = Date.now();
      w.lastVersion = version;
      this.metrics.inc("thawgate_screener_skipped_total", { reason: "exempt" });
    }
    // One read of every (mint, wallet) entry: wallets with an entry on every mint they hold need no provider call.
    const pairs = toScreen.flatMap((w) => [...w.holdings.keys()].map((mint) => ({ mint, wallet: w.wallet })));
    let entries: EntryRead[];
    try {
      entries = await this.chain.blacklistEntries(pairs);
    } catch (e) {
      this.log.warn("blacklist entries unreadable; screening deferred", { error: e });
      return;
    }
    const entryOf = new Map(pairs.map((p, i) => [`${p.mint}|${p.wallet}`, entries[i]]));
    await mapLimit(toScreen, this.config.concurrency, (w) => this.screenOne(w, version, entryOf));
  }

  private async screenOne(w: WalletState, version: string | undefined, entryOf: Map<string, EntryRead>) {
    const open = [...w.holdings.keys()].filter((mint) => entryOf.get(`${mint}|${w.wallet}`) === "none");
    for (const mint of w.holdings.keys()) {
      const entry = entryOf.get(`${mint}|${w.wallet}`);
      if (entry === "active" || entry === "inactive") this.metrics.inc("thawgate_screener_skipped_total", { reason: entry === "active" ? "already_blacklisted" : "operator_cleared" });
      if (entry === "inactive" && w.lastScreenedAt === undefined) this.log.warn("wallet was removed from the blacklist by an operator; not re-adding", { mint, wallet: w.wallet });
    }
    if (!open.length) {
      w.lastScreenedAt = Date.now();
      w.lastVersion = version;
      return;
    }

    let result;
    try {
      result = await this.provider.screen(w.wallet, AbortSignal.timeout(this.config.providerTimeoutMs));
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "error";
      this.metrics.inc("thawgate_screener_provider_errors_total", { provider: this.provider.name, kind });
      this.metrics.inc("thawgate_screener_screens_total", { provider: this.provider.name, result: "error" });
      w.failures++;
      w.retryAt = Date.now() + Math.min((this.config.retryBaseMs ?? RETRY_BASE_MS) * 2 ** (w.failures - 1), this.config.rescreenMs);
      this.record({ wallet: w.wallet, decision: "error", detail: kind });
      this.log.warn("provider failed; not blacklisting", { wallet: w.wallet, kind, retryInMs: w.retryAt - Date.now(), error: e });
      return;
    }
    const flagged = result.score >= this.config.threshold;
    this.metrics.inc("thawgate_screener_screens_total", { provider: this.provider.name, result: flagged ? "flagged" : "clean" });
    w.lastScreenedAt = Date.now();
    w.lastVersion = version;
    w.failures = 0;
    w.retryAt = undefined;
    if (!flagged) {
      this.record({ wallet: w.wallet, decision: "clean", score: result.score });
      return;
    }
    const flaggedAt = Date.now();
    const reason = this.provider.reason(result);
    this.record({ wallet: w.wallet, decision: "flagged", score: result.score, reason, flaggedAt });
    this.log.info("flagged", { wallet: w.wallet, score: result.score, detail: result.detail, reason, mints: open });
    // A mint that already has a pending send is retried by flushPending on each poll; don't send twice.
    const fresh = open.filter((mint) => !this.pending.has(`${mint}|${w.wallet}`));
    for (const mint of fresh) this.pending.set(`${mint}|${w.wallet}`, { mint, wallet: w.wallet, reason, score: result.score, flaggedAt, attempts: 0 });
    await Promise.all(fresh.map((mint) => this.blacklist(this.pending.get(`${mint}|${w.wallet}`)!)));
  }

  /** Retries blacklists that failed on an earlier poll (with fresh holdings), without asking the provider again. */
  private async flushPending() {
    for (const p of [...this.pending.values()]) {
      if (!this.wallets.has(p.wallet)) {
        this.pending.delete(`${p.mint}|${p.wallet}`);
        continue;
      }
      await this.blacklist(p);
    }
  }

  private async blacklist(p: Pending) {
    const key = `${p.mint}|${p.wallet}`;
    if (this.inflight.has(key)) return;
    const accounts = this.wallets.get(p.wallet)?.holdings.get(p.mint) ?? [];
    // A thawed account if there is one: sss-token freezes it in the same transaction. Otherwise any of its accounts
    // (the owner check needs one); the keeper freezes the rest after the AddedToBlacklist event.
    const tokenAccount = (accounts.find((a) => a.state === "initialized") ?? accounts[0])?.address;
    if (!tokenAccount) {
      this.pending.delete(key);
      return;
    }
    if (this.config.dryRun) {
      this.pending.delete(key);
      this.metrics.inc("thawgate_screener_skipped_total", { reason: "dry_run" });
      this.record({ wallet: p.wallet, mint: p.mint, decision: "skipped", detail: "dry_run", score: p.score, reason: p.reason, flaggedAt: p.flaggedAt, tokenAccount });
      return;
    }
    this.inflight.add(key);
    p.attempts++;
    try {
      const outcome = await this.chain.addToBlacklist({ mint: p.mint, wallet: p.wallet, tokenAccount, reason: p.reason });
      const base = { wallet: p.wallet, mint: p.mint, score: p.score, reason: p.reason, flaggedAt: p.flaggedAt, tokenAccount };
      switch (outcome.kind) {
        case "sent":
          this.pending.delete(key);
          this.metrics.inc("thawgate_screener_blacklists_total", { provider: this.provider.name });
          this.metrics.observe("thawgate_screener_flag_to_blacklist_seconds", { provider: this.provider.name }, (outcome.confirmedAt - p.flaggedAt) / 1000);
          this.record({ ...base, decision: "blacklisted", sig: outcome.sig, slot: outcome.slot, confirmedAt: outcome.confirmedAt });
          this.log.info("blacklisted", { ...base, sig: outcome.sig, slot: outcome.slot, flagToConfirmedMs: outcome.confirmedAt - p.flaggedAt });
          return;
        case "already_blacklisted":
          this.pending.delete(key);
          this.metrics.inc("thawgate_screener_skipped_total", { reason: "already_blacklisted" });
          this.record({ ...base, decision: "skipped", detail: "already_blacklisted" });
          return;
        case "no_role":
          this.pending.delete(key);
          this.eligible.set(p.mint, { ok: false, why: "no Blacklister role", checkedAt: Date.now() });
          this.metrics.inc("thawgate_screener_blacklist_failures_total", { reason: "no_role" });
          this.record({ ...base, decision: "failed", detail: "no_role" });
          this.log.error("screener key lacks the Blacklister role", base);
          return;
        default: {
          this.metrics.inc("thawgate_screener_blacklist_failures_total", { reason: outcome.kind });
          this.record({ ...base, decision: "failed", detail: `${outcome.kind}: ${outcome.detail}` });
          this.log.warn("add_to_blacklist failed", { ...base, outcome: outcome.kind, detail: outcome.detail, attempt: p.attempts });
          if (p.attempts >= MAX_SEND_ATTEMPTS) {
            // Give up until the next screen of this wallet flags it again.
            this.pending.delete(key);
            const w = this.wallets.get(p.wallet);
            if (w) w.lastScreenedAt = undefined;
          }
        }
      }
    } finally {
      this.inflight.delete(key);
    }
  }
}
