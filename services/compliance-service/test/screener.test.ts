import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { Chain, EntryRead, SendOutcome, SSS_TOKEN_ID } from "../src/screener/chain";
import { Logger } from "../src/screener/config";
import { ProviderError, RiskProvider, RiskResult } from "../src/screener/providers";
import { HolderSource, KeeperAccount, KeeperMint, Screener } from "../src/screener/screener";

const key = () => Keypair.generate().publicKey.toBase58();
const SSS = SSS_TOKEN_ID.toBase58();
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

class FakeSource implements HolderSource {
  mintList: KeeperMint[] = [];
  holders = new Map<string, KeeperAccount[]>();
  down = false;
  addMint(mint: string, policy: Partial<KeeperMint["policy"]> = {}) {
    this.mintList.push({ mint, policy: { issuerProgram: SSS, checkBlacklist: true, ...policy } });
    this.holders.set(mint, []);
  }
  hold(mint: string, owner: string, state = "initialized") {
    const address = key();
    this.holders.get(mint)!.push({ address, owner, state });
    return address;
  }
  async mints() {
    if (this.down) throw new Error("keeper down");
    return this.mintList;
  }
  async accounts(mint: string) {
    return this.holders.get(mint);
  }
}

class FakeChain implements Chain {
  operator = key();
  roles = new Set<string>();
  entries = new Map<string, EntryRead>();
  sent: { mint: string; wallet: string; tokenAccount: string; reason: string }[] = [];
  next: SendOutcome[] = [];
  async hasBlacklisterRole(mint: string) {
    return this.roles.has(mint);
  }
  async blacklistEntries(pairs: { mint: string; wallet: string }[]) {
    return pairs.map((p) => this.entries.get(`${p.mint}|${p.wallet}`) ?? "none");
  }
  async addToBlacklist(p: { mint: string; wallet: string; tokenAccount: string; reason: string }): Promise<SendOutcome> {
    this.sent.push(p);
    const outcome = this.next.shift() ?? { kind: "sent", sig: `sig${this.sent.length}`, slot: 1, confirmedAt: Date.now() };
    if (outcome.kind === "sent") this.entries.set(`${p.mint}|${p.wallet}`, "active");
    return outcome;
  }
  async balance() {
    return 1_000_000;
  }
}

class FakeProvider implements RiskProvider {
  name = "static" as const;
  fallback = true;
  label = "static:test";
  scores = new Map<string, number>();
  failures = new Map<string, "error" | "timeout">();
  calls: string[] = [];
  ver = "v1";
  version() {
    return this.ver;
  }
  reason() {
    return "static:test";
  }
  async screen(wallet: string, signal: AbortSignal): Promise<RiskResult> {
    this.calls.push(wallet);
    const fault = this.failures.get(wallet);
    if (fault === "error") throw new ProviderError("http_503", "provider down");
    if (fault === "timeout") {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ProviderError("timeout", "timed out"))));
    }
    return { score: this.scores.get(wallet) ?? 1 };
  }
}

const CONFIG = { threshold: 8, pollMs: 1_000, rescreenMs: 3_600_000, providerTimeoutMs: 30, concurrency: 4, exempt: [] as string[], dryRun: false };

describe("Screener", () => {
  let source: FakeSource;
  let chain: FakeChain;
  let provider: FakeProvider;
  let mint: string;
  const make = (over: Partial<typeof CONFIG & { mints: string[] }> = {}) => new Screener({ ...CONFIG, ...over }, provider, chain, source, quiet);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    source = new FakeSource();
    chain = new FakeChain();
    provider = new FakeProvider();
    mint = key();
    source.addMint(mint);
    chain.roles.add(mint);
  });
  afterEach(() => vi.useRealTimers());

  it("a new holder is screened on the next poll; clean sends nothing", async () => {
    const s = make();
    const w = key();
    source.hold(mint, w);
    await s.poll();
    expect(provider.calls).toEqual([w]);
    expect(chain.sent).toEqual([]);
    expect(s.screenings(w).map((r) => r.decision)).toEqual(["clean"]);
    expect(s.metrics.get("thawgate_screener_screens_total", { result: "clean" })).toBe(1);
    await s.poll();
    expect(provider.calls).toHaveLength(1); // not due again yet
  });

  it("score >= threshold blacklists with the provider's reason, passing a thawed account; 7 doesn't", async () => {
    const s = make();
    const [hot, warm] = [key(), key()];
    source.hold(mint, hot, "frozen");
    const thawed = source.hold(mint, hot, "initialized");
    source.hold(mint, warm);
    provider.scores.set(hot, 8).set(warm, 7);
    await s.poll();
    expect(chain.sent).toEqual([{ mint, wallet: hot, tokenAccount: thawed, reason: "static:test" }]);
    const row = s.screenings(hot).find((r) => r.decision === "blacklisted")!;
    expect(row.sig).toBe("sig1");
    expect(row.flaggedAt).toBeTypeOf("number");
    expect(s.metrics.get("thawgate_screener_blacklists_total")).toBe(1);
    expect(s.metrics.get("thawgate_screener_screens_total", { result: "flagged" })).toBe(1);
    expect(s.metrics.get("thawgate_screener_screens_total", { result: "clean" })).toBe(1);
  });

  it("a wallet with only frozen accounts is blacklisted through a frozen one (the owner check needs an account)", async () => {
    const s = make();
    const w = key();
    const frozen = source.hold(mint, w, "frozen");
    provider.scores.set(w, 10);
    await s.poll();
    expect(chain.sent.map((x) => x.tokenAccount)).toEqual([frozen]);
  });

  it("fail-safe: provider errors and timeouts never blacklist; they are counted and retried with backoff", async () => {
    const s = make();
    const [down, slow] = [key(), key()];
    source.hold(mint, down);
    source.hold(mint, slow);
    provider.scores.set(down, 10).set(slow, 10);
    provider.failures.set(down, "error").set(slow, "timeout");
    await s.poll();
    expect(chain.sent).toEqual([]);
    expect(s.metrics.get("thawgate_screener_provider_errors_total", { kind: "http_503" })).toBe(1);
    expect(s.metrics.get("thawgate_screener_provider_errors_total", { kind: "timeout" })).toBe(1);
    expect(s.metrics.get("thawgate_screener_screens_total", { result: "error" })).toBe(2);
    await s.poll(); // inside the 30 s backoff: not retried
    expect(provider.calls).toHaveLength(2);
    provider.failures.clear();
    vi.setSystemTime(Date.now() + 31_000);
    await s.poll();
    expect(chain.sent.map((x) => x.wallet).sort()).toEqual([down, slow].sort());
  });

  it("exempt wallets are never screened", async () => {
    const w = key();
    const s = make({ exempt: [w] });
    source.hold(mint, w);
    provider.scores.set(w, 10);
    await s.poll();
    expect(provider.calls).toEqual([]);
    expect(chain.sent).toEqual([]);
    expect(s.metrics.get("thawgate_screener_skipped_total", { reason: "exempt" })).toBe(1);
  });

  it("an existing entry skips the provider: active = already blacklisted, inactive = an operator removed it", async () => {
    const s = make();
    const [listed, cleared] = [key(), key()];
    source.hold(mint, listed);
    source.hold(mint, cleared);
    provider.scores.set(listed, 10).set(cleared, 10);
    chain.entries.set(`${mint}|${listed}`, "active").set(`${mint}|${cleared}`, "inactive");
    await s.poll();
    expect(provider.calls).toEqual([]);
    expect(chain.sent).toEqual([]);
    expect(s.metrics.get("thawgate_screener_skipped_total", { reason: "already_blacklisted" })).toBe(1);
    expect(s.metrics.get("thawgate_screener_skipped_total", { reason: "operator_cleared" })).toBe(1);
  });

  it("a provider version change (list edit) re-screens every wallet; so does the re-screen interval", async () => {
    const s = make();
    const [a, b] = [key(), key()];
    source.hold(mint, a);
    source.hold(mint, b);
    await s.poll();
    provider.scores.set(a, 10);
    provider.ver = "v2";
    await s.poll();
    expect(provider.calls).toEqual([a, b, a, b]);
    expect(chain.sent.map((x) => x.wallet)).toEqual([a]);
    vi.setSystemTime(Date.now() + CONFIG.rescreenMs);
    await s.poll();
    expect(provider.calls.slice(4)).toEqual([b]); // a is blacklisted now: skipped before the provider
  });

  it("only eligible mints: blacklist policy, sss-token issuer, Blacklister role, SCREENER_MINTS", async () => {
    const [noRole, noBlacklist, otherIssuer] = [key(), key(), key()];
    source.addMint(noRole);
    source.addMint(noBlacklist, { checkBlacklist: false });
    source.addMint(otherIssuer, { issuerProgram: key() });
    chain.roles.add(noBlacklist).add(otherIssuer);
    const w = key();
    for (const m of [noRole, noBlacklist, otherIssuer]) source.hold(m, w);
    provider.scores.set(w, 10);
    const s = make();
    await s.poll();
    expect(provider.calls).toEqual([]);
    expect(s.health().eligibleMints).toEqual([mint]);
    const only = make({ mints: [noRole] });
    await only.poll();
    expect(only.health().eligibleMints).toEqual([]);
  });

  it("send outcomes: a gone account is retried next poll without asking the provider; no role makes the mint ineligible", async () => {
    const s = make();
    const w = key();
    source.hold(mint, w);
    provider.scores.set(w, 10);
    chain.next.push({ kind: "account_gone", detail: "closed" });
    await s.poll();
    expect(chain.sent).toHaveLength(1);
    expect(s.metrics.get("thawgate_screener_blacklist_failures_total", { reason: "account_gone" })).toBe(1);
    await s.poll();
    expect(chain.sent).toHaveLength(2);
    expect(provider.calls).toHaveLength(1);
    expect(s.screenings(w).at(-1)!.decision).toBe("blacklisted");

    const v = key();
    source.hold(mint, v);
    provider.scores.set(v, 10);
    chain.next.push({ kind: "no_role" });
    await s.poll();
    expect(s.health().eligibleMints).toEqual([]);
    expect(s.metrics.get("thawgate_screener_blacklist_failures_total", { reason: "no_role" })).toBe(1);
  });

  it("dry run screens and records but never sends", async () => {
    const s = make({ dryRun: true });
    const w = key();
    source.hold(mint, w);
    provider.scores.set(w, 10);
    await s.poll();
    expect(chain.sent).toEqual([]);
    expect(s.metrics.get("thawgate_screener_skipped_total", { reason: "dry_run" })).toBe(1);
  });

  it("an unreadable keeper is counted and screens nothing", async () => {
    const s = make();
    source.hold(mint, key());
    source.down = true;
    await s.poll();
    expect(provider.calls).toEqual([]);
    expect(s.metrics.get("thawgate_screener_keeper_errors_total")).toBe(1);
    expect(s.health().status).toBe("starting");
  });

  it("/metrics names the provider and marks the static list as the fallback", () => {
    const text = make().metrics.render();
    expect(text).toContain('thawgate_screener_provider_info{fallback="1",label="static:test",provider="static"} 1');
    expect(text).toContain("thawgate_screener_threshold 8");
  });
});
