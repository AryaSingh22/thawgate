/**
 * The ThawGate keeper: finds token accounts the gate now lets anyone freeze, and freezes them through Token ACL's
 * `freeze_permissionless_idempotent`. Its key pays fees only; it holds no role on any mint.
 *
 * Triggers (websockets at "confirmed"):
 *   sas            SAS transactions (logs mentioning SAS). Their logs name no instruction, so the keeper reads the
 *                  transaction and matches its account keys against the attestation addresses it tracks (revokes).
 *   blacklist      sss-token AddedToBlacklist (and AllowlistRemoved) events: every other thawed account of the wallet.
 *   policy         a GatePolicy account changed (`update_policy`): full re-check of that mint.
 *   token_account  a token account of a gated mint appeared or was thawed.
 * Sweep (every KEEPER_SWEEP_MS): reads the cluster Clock and every tracked owner's PDAs, so it catches expiries (no
 * event exists for them) and anything a websocket missed. Resync (every KEEPER_RESYNC_MS, and after a websocket
 * reconnects): re-lists policies and token accounts.
 */
import {
  Address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
  TransactionSigner,
} from "@solana/kit";
import {
  base58,
  CLOCK_SYSVAR,
  clockUnixTimestamp,
  decodeGatePolicy,
  decodeIssuerEvent,
  decodeMintConfig,
  decodeTokenAccount,
  GATE_ID,
  GATE_POLICY_DISCRIMINATOR,
  GatePolicy,
  mintConfigPda,
  programDataLogs,
  readAllowlistEntry,
  readAttestation,
  readBlacklistEntry,
  SAS_ID,
  TOKEN_2022_ID,
} from "./accounts";
import { KeeperConfig, Logger } from "./config";
import { Freezer, Outcome, Trigger } from "./freezer";
import { HolderIndex, MintEntry, OwnerFacts } from "./holders";
import { Metrics } from "./metrics";
import { freezeReason, ownerVerdict } from "./policy";

type RawAccount = { owner: Address; data: Uint8Array } | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A sleep that ends early when `signal` aborts, so `stop()` doesn't wait out a sweep or resync interval. */
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
const bytes = (data: readonly [string, string] | string) => Uint8Array.from(Buffer.from(Array.isArray(data) ? data[0] : (data as string), "base64"));
const BATCH = 100;

export interface Health {
  status: "ok" | "starting" | "stale";
  keeper: Address;
  lastSweepAgeMs?: number;
  lastSweepClusterTime?: string;
  sweepMs: number;
  streams: Record<string, boolean>;
  mints: number;
  tokenAccounts: { initialized: number; frozen: number };
  owners: number;
}

export class Keeper {
  readonly metrics = new Metrics();
  readonly index = new HolderIndex();
  readonly freezer: Freezer;
  private rpc: Rpc<SolanaRpcApi>;
  private subs: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  private stop$ = new AbortController();
  private streamAborts = new Map<string, AbortController>();
  private streams: Record<string, boolean> = {};
  private lastSweep?: { at: number; clusterTime: bigint };
  private resyncing?: Promise<void>;
  private resyncRequested = false;
  private background = new Set<Promise<unknown>>();

  constructor(
    readonly config: KeeperConfig,
    readonly signer: TransactionSigner,
    private log: Logger,
  ) {
    this.rpc = createSolanaRpc(config.rpcUrl);
    this.subs = createSolanaRpcSubscriptions(config.wsUrl);
    this.freezer = new Freezer(this.rpc, signer, config, this.metrics, log);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------------------------
  async start() {
    this.log.info("keeper starting", { keeper: this.signer.address, sweepMs: this.config.sweepMs, resyncMs: this.config.resyncMs, mints: this.config.mints, skipMints: this.config.skipMints });
    this.openStream("sas_logs", (signal) => this.subs.logsNotifications({ mentions: [SAS_ID] }, { commitment: "confirmed" }).subscribe({ abortSignal: signal }), (n, at) =>
      this.onSasLogs(n.value.signature, n.value.err, BigInt(n.context.slot), at),
    );
    this.openStream(
      "gate_policies",
      (signal) =>
        this.subs
          .programNotifications(GATE_ID, {
            commitment: "confirmed",
            encoding: "base64",
            filters: [{ memcmp: { offset: 0n, bytes: base58(GATE_POLICY_DISCRIMINATOR) as any, encoding: "base58" } }],
          })
          .subscribe({ abortSignal: signal }),
      (n, at) => this.onPolicy(n.value.pubkey, bytes(n.value.account.data as any), BigInt(n.context.slot), at),
    );
    await this.resync();
    await this.sweep();
    this.loop("sweep", this.config.sweepMs, () => this.sweep());
    this.loop("resync", this.config.resyncMs, () => this.resync());
  }

  async stop() {
    this.stop$.abort();
    for (const a of this.streamAborts.values()) a.abort();
    await Promise.allSettled([...this.background, ...this.freezer.pending()]);
    this.log.info("keeper stopped");
  }

  /** Resolves once every stream in `names` (default: all opened so far) is subscribed. */
  async waitForStreams(names?: string[], timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const wanted = names ?? [...this.streamAborts.keys()];
      if (wanted.every((n) => this.streams[n])) return;
      if (Date.now() > deadline) throw new Error(`streams not connected: ${wanted.filter((n) => !this.streams[n]).join(", ")}`);
      await sleep(200);
    }
  }

  health(): Health {
    const c = this.index.counts();
    const age = this.lastSweep ? Date.now() - this.lastSweep.at : undefined;
    return {
      status: age === undefined ? "starting" : age < 3 * this.config.sweepMs ? "ok" : "stale",
      keeper: this.signer.address,
      lastSweepAgeMs: age,
      lastSweepClusterTime: this.lastSweep?.clusterTime.toString(),
      sweepMs: this.config.sweepMs,
      streams: { ...this.streams },
      mints: c.mints,
      tokenAccounts: { initialized: c.initialized, frozen: c.frozen },
      owners: c.owners,
    };
  }

  /** One mint's slice of the index, JSON-safe (GET /mints/:mint). */
  describeMint(mint: Address) {
    const entry = this.index.mints.get(mint);
    if (!entry) return undefined;
    const attestation = (r: OwnerFacts["reads"]["attestation"]) =>
      r?.kind === "present" ? { kind: r.kind, expiry: r.expiry.toString(), kycLevel: r.firstByte } : r;
    const now = this.lastSweep?.clusterTime;
    return {
      mint,
      policy: entry.policy,
      clusterTime: now?.toString(),
      accounts: [...entry.accounts].map(([address, a]) => ({ address, owner: a.owner, state: a.state })),
      owners: [...entry.owners.values()].map((o) => ({
        owner: o.owner,
        verdict: ownerVerdict(entry.policy, o.reads, now),
        attestationPda: o.attestationPda,
        reads: { ...o.reads, attestation: attestation(o.reads.attestation) },
      })),
    };
  }

  private loop(name: string, everyMs: number, body: () => Promise<unknown>) {
    const run = async () => {
      while (!this.stop$.signal.aborted) {
        await sleepUnless(everyMs, this.stop$.signal);
        if (this.stop$.signal.aborted) break;
        await body().catch((e) => {
          this.metrics.inc("thawgate_keeper_failures_total", { kind: name });
          this.log.error(`${name} failed`, { error: e });
        });
      }
    };
    this.track(run());
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.background.add(p);
    p.finally(() => this.background.delete(p)).catch(() => undefined);
    return p;
  }

  /** Runs a handler without blocking its stream; errors are counted and logged. */
  private spawn(what: string, body: () => Promise<unknown>) {
    this.track(
      body().catch((e) => {
        this.metrics.inc("thawgate_keeper_failures_total", { kind: what });
        this.log.error(`${what} handler failed`, { error: e });
      }),
    );
  }

  /** A websocket subscription that reconnects with backoff. A reconnect requests a resync (missed notifications). */
  private openStream<T>(name: string, open: (signal: AbortSignal) => Promise<AsyncIterable<T>>, onItem: (item: T, observedAt: number) => void) {
    if (this.streamAborts.has(name)) return;
    const abort = new AbortController();
    this.streamAborts.set(name, abort);
    const run = async () => {
      let backoff = 1_000;
      let connections = 0;
      while (!abort.signal.aborted && !this.stop$.signal.aborted) {
        const since = Date.now();
        try {
          const items = await open(abort.signal);
          this.setStream(name, true);
          if (connections++ > 0) this.requestResync(`${name} reconnected`);
          for await (const item of items) onItem(item, Date.now());
        } catch (e) {
          if (abort.signal.aborted) break;
          this.log.warn("stream dropped", { stream: name, error: e });
        }
        this.setStream(name, false);
        if (abort.signal.aborted || this.stop$.signal.aborted) break;
        if (Date.now() - since > 60_000) backoff = 1_000;
        await sleepUnless(backoff, abort.signal);
        backoff = Math.min(backoff * 2, 30_000);
      }
      this.setStream(name, false);
    };
    this.track(run());
  }

  private closeStream(name: string) {
    this.streamAborts.get(name)?.abort();
    this.streamAborts.delete(name);
    delete this.streams[name];
    this.metrics.set("thawgate_keeper_ws_connected", { stream: name }, 0);
  }

  private setStream(name: string, up: boolean) {
    if (!this.streamAborts.has(name)) return;
    this.streams[name] = up;
    this.metrics.set("thawgate_keeper_ws_connected", { stream: name }, up ? 1 : 0);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Mint discovery
  // ------------------------------------------------------------------------------------------------------------
  private wanted(mint: Address) {
    if (this.config.skipMints.includes(mint)) return false;
    return !this.config.mints || this.config.mints.includes(mint);
  }

  /** Token ACL's MintConfig names ThawGate as the gate and has permissionless freeze on. */
  private async gatedByUs(mint: Address): Promise<boolean> {
    const [account] = await this.accounts([await mintConfigPda(mint)]);
    const config = account && decodeMintConfig(account.data);
    return !!config && config.mint === mint && config.gatingProgram === GATE_ID && config.permissionlessFreeze;
  }

  private requestResync(why: string) {
    this.log.info("resync requested", { why });
    this.resyncRequested = true;
    if (!this.resyncing) this.spawn("resync", () => this.resync());
  }

  /** Re-lists every ThawGate policy and each wanted mint's token accounts, then checks every mint. */
  resync(): Promise<void> {
    if (this.resyncing) {
      this.resyncRequested = true;
      return this.resyncing;
    }
    this.resyncing = (async () => {
      do {
        this.resyncRequested = false;
        await this.resyncOnce();
      } while (this.resyncRequested && !this.stop$.signal.aborted);
    })().finally(() => (this.resyncing = undefined));
    return this.resyncing;
  }

  private async resyncOnce() {
    const observedAt = Date.now();
    const policies = await this.rpc
      .getProgramAccounts(GATE_ID, {
        commitment: "confirmed",
        encoding: "base64",
        filters: [{ memcmp: { offset: 0n, bytes: base58(GATE_POLICY_DISCRIMINATOR) as any, encoding: "base58" } }],
      })
      .send();
    const seen = new Set<Address>();
    for (const { pubkey, account } of policies as any[]) {
      const policy = decodeGatePolicy(bytes(account.data));
      if (!policy || !this.wanted(policy.mint) || !(await this.gatedByUs(policy.mint))) continue;
      seen.add(policy.mint);
      await this.loadMint(pubkey, policy);
    }
    for (const mint of [...this.index.mints.keys()]) {
      if (!seen.has(mint)) this.dropMint(mint, "no longer a wanted ThawGate mint");
    }
    this.refreshIssuerStreams();
    this.gauges();
    this.log.info("resync done", { wanted: [...seen], ...this.index.counts() });
    await Promise.all([...this.index.mints.keys()].map((mint) => this.check(mint, "all", "resync", observedAt)));
  }

  /** (Re)loads a mint: policy, all its token accounts, its token-account stream. */
  private async loadMint(policyAddress: Address, policy: GatePolicy): Promise<MintEntry> {
    const known = this.index.mints.get(policy.mint);
    const changed = !known || JSON.stringify(known.policy) !== JSON.stringify(policy);
    const entry = changed ? this.index.setMint(policy.mint, policyAddress, policy) : known!;
    if (changed) this.freezer.invalidate(policy.mint);
    const listed = await this.rpc
      .getProgramAccounts(TOKEN_2022_ID, {
        commitment: "confirmed",
        encoding: "base64",
        filters: [{ memcmp: { offset: 0n, bytes: policy.mint as any, encoding: "base58" } }],
      })
      .send();
    entry.accounts.clear();
    for (const { pubkey, account } of listed as any[]) {
      const token = decodeTokenAccount(bytes(account.data));
      if (token && token.mint === policy.mint) this.index.upsertAccount(entry, pubkey, { owner: token.owner, state: token.state });
    }
    const mint = policy.mint;
    this.openStream(
      `token_accounts:${mint}`,
      (signal) =>
        this.subs
          .programNotifications(TOKEN_2022_ID, {
            commitment: "confirmed",
            encoding: "base64",
            filters: [{ memcmp: { offset: 0n, bytes: mint as any, encoding: "base58" } }],
          })
          .subscribe({ abortSignal: signal }),
      (n, at) => this.onTokenAccount(mint, n.value.pubkey, bytes(n.value.account.data as any), BigInt(n.context.slot), at),
    );
    return entry;
  }

  private dropMint(mint: Address, why: string) {
    this.index.removeMint(mint);
    this.freezer.invalidate(mint);
    this.closeStream(`token_accounts:${mint}`);
    this.log.info("mint dropped", { mint, why });
  }

  /** One log stream per issuer program named by a tracked policy (sss-token for every policy so far). */
  private refreshIssuerStreams() {
    const issuers = new Set([...this.index.mints.values()].filter((e) => e.policy.checkBlacklist || e.policy.allowlistMode !== "off").map((e) => e.policy.issuerProgram));
    for (const name of [...this.streamAborts.keys()].filter((n) => n.startsWith("issuer_logs:"))) {
      if (!issuers.has(name.slice("issuer_logs:".length) as Address)) this.closeStream(name);
    }
    for (const program of issuers) {
      this.openStream(
        `issuer_logs:${program}`,
        (signal) => this.subs.logsNotifications({ mentions: [program] }, { commitment: "confirmed" }).subscribe({ abortSignal: signal }),
        (n, at) => this.onIssuerLogs(program, n.value.logs, n.value.err, BigInt(n.context.slot), at),
      );
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Triggers
  // ------------------------------------------------------------------------------------------------------------
  private onSasLogs(signature: string, err: unknown, slot: bigint, observedAt: number) {
    if (err || !this.index.hasAttestations()) return;
    this.metrics.inc("thawgate_keeper_triggers_total", { source: "sas" });
    this.spawn("sas", async () => {
      const keys = await this.transactionKeys(signature);
      const byMint = new Map<Address, Set<Address>>();
      for (const key of keys) {
        for (const { mint, owner } of this.index.dependents(key)) byMint.set(mint, (byMint.get(mint) ?? new Set()).add(owner));
      }
      if (!byMint.size) return;
      this.log.info("SAS transaction touches tracked attestations", { signature, slot, owners: [...byMint.values()].flatMap((s) => [...s]) });
      await Promise.all([...byMint].map(([mint, owners]) => this.check(mint, [...owners], "sas", observedAt, slot)));
    });
  }

  private onIssuerLogs(program: Address, logs: readonly string[], err: unknown, slot: bigint, observedAt: number) {
    if (err) return;
    for (const data of programDataLogs(logs, program)) {
      const event = decodeIssuerEvent(data);
      const entry = event && this.index.mints.get(event.mint);
      if (!event || !entry || entry.policy.issuerProgram !== program) continue;
      const trigger: Trigger = event.kind === "addedToBlacklist" ? "blacklist" : "allowlist";
      this.metrics.inc("thawgate_keeper_triggers_total", { source: trigger });
      this.log.info("issuer event", { kind: event.kind, mint: event.mint, wallet: event.wallet, slot });
      this.spawn(trigger, () => this.check(event.mint, [event.wallet], trigger, observedAt, slot));
    }
  }

  private onPolicy(policyAddress: Address, data: Uint8Array, slot: bigint, observedAt: number) {
    const policy = decodeGatePolicy(data);
    if (!policy || !this.wanted(policy.mint)) return;
    this.metrics.inc("thawgate_keeper_triggers_total", { source: "policy" });
    this.spawn("policy", async () => {
      if (!(await this.gatedByUs(policy.mint))) return;
      this.log.info("policy changed: full re-check", { mint: policy.mint, policy });
      this.index.setMint(policy.mint, policyAddress, policy); // drops the owners' PDAs and reads
      this.freezer.invalidate(policy.mint);
      await this.loadMint(policyAddress, policy);
      this.refreshIssuerStreams();
      await this.check(policy.mint, "all", "policy", observedAt, slot);
    });
  }

  private onTokenAccount(mint: Address, tokenAccount: Address, data: Uint8Array, slot: bigint, observedAt: number) {
    const entry = this.index.mints.get(mint);
    const token = decodeTokenAccount(data);
    if (!entry || !token || token.mint !== mint) return;
    const previous = this.index.upsertAccount(entry, tokenAccount, { owner: token.owner, state: token.state });
    if (token.state !== "initialized" || previous === "initialized") return;
    this.metrics.inc("thawgate_keeper_triggers_total", { source: "token_account" });
    this.spawn("token_account", () => this.check(mint, [token.owner], "token_account", observedAt, slot));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Check and sweep
  // ------------------------------------------------------------------------------------------------------------
  /** One pass over every tracked owner: fresh Clock and PDAs, then freezes. Expiries are found only here. */
  async sweep() {
    const started = Date.now();
    const { now, slot } = await this.clock();
    await Promise.all([...this.index.mints.keys()].map((mint) => this.check(mint, "all", "sweep", started, slot, now)));
    this.lastSweep = { at: Date.now(), clusterTime: now };
    this.metrics.inc("thawgate_keeper_sweeps_total");
    this.metrics.set("thawgate_keeper_last_sweep_timestamp_seconds", {}, Math.floor(this.lastSweep.at / 1000));
    this.metrics.set("thawgate_keeper_last_sweep_cluster_time_seconds", {}, Number(now));
    this.metrics.set("thawgate_keeper_sweep_duration_seconds", {}, (this.lastSweep.at - started) / 1000);
    this.gauges();
    const { value: lamports } = await this.rpc.getBalance(this.signer.address, { commitment: "confirmed" }).send();
    this.metrics.set("thawgate_keeper_fee_payer_lamports", {}, Number(lamports));
  }

  /**
   * Re-reads `owners` (or every owner with a thawed account) of `mint` at or after `minContextSlot`, and freezes
   * each thawed account whose owner the gate would now flag.
   */
  async check(mint: Address, owners: Address[] | "all", trigger: Trigger, observedAt: number, minContextSlot?: bigint, now?: bigint): Promise<Outcome[]> {
    const entry = this.index.mints.get(mint);
    if (!entry) return [];
    const thawedOwners = new Set(this.index.ownersWithThawedAccounts(entry));
    const targets = (owners === "all" ? [...thawedOwners] : owners).filter((o) => thawedOwners.has(o));
    if (!targets.length) return [];

    // One batch read: each owner's PDAs and its thawed token accounts.
    const facts = await Promise.all(targets.map((o) => this.index.owner(entry, o)));
    const plan = facts.map((f) => ({ facts: f, tokenAccounts: this.index.thawedAccounts(entry, f.owner) }));
    const addresses = plan.flatMap(({ facts: f, tokenAccounts }) =>
      [f.attestationPda, f.blacklistPda, f.allowlistPda].filter((a): a is Address => !!a).concat(tokenAccounts),
    );
    const read = new Map<Address, RawAccount>();
    const [accounts, clock] = await Promise.all([this.accounts(addresses, minContextSlot), now === undefined ? this.clock(minContextSlot) : undefined]);
    addresses.forEach((a, i) => read.set(a, accounts[i]));
    const at = now ?? clock!.now;

    const p = entry.policy;
    const freezes: Promise<Outcome>[] = [];
    for (const { facts: f, tokenAccounts } of plan) {
      if (f.attestationPda) f.reads.attestation = readAttestation(read.get(f.attestationPda) ?? null, p.sasCredential, p.sasSchema, f.owner);
      if (f.blacklistPda) f.reads.blacklist = readBlacklistEntry(read.get(f.blacklistPda) ?? null, p.issuerProgram, mint, f.owner);
      if (f.allowlistPda) f.reads.allowlist = readAllowlistEntry(read.get(f.allowlistPda) ?? null, p.issuerProgram, mint, f.owner);
      const thawed = tokenAccounts.filter((ta) => {
        const raw = read.get(ta);
        const token = raw && decodeTokenAccount(raw.data);
        if (token) this.index.upsertAccount(entry, ta, { owner: token.owner, state: token.state });
        return token?.state === "initialized";
      });
      const reason = freezeReason(p, f.reads, at);
      if (!reason) continue;
      const label: Trigger = reason === "CREDENTIAL_EXPIRED" && (trigger === "sweep" || trigger === "resync") ? "expiry" : trigger;
      this.log.info("freezable", { mint, owner: f.owner, reason, trigger: label, tokenAccounts: thawed });
      for (const tokenAccount of thawed) {
        freezes.push(
          this.freezer.freeze({ mint, tokenAccount, owner: f.owner, trigger: label, observedAt, minContextSlot }).then((outcome) => {
            if (outcome.kind === "frozen" || outcome.kind === "already_frozen") {
              this.index.upsertAccount(entry, tokenAccount, { owner: f.owner, state: "frozen" });
            }
            return outcome;
          }),
        );
      }
    }
    return Promise.all(freezes);
  }

  // ------------------------------------------------------------------------------------------------------------
  // RPC reads
  // ------------------------------------------------------------------------------------------------------------
  /** getMultipleAccounts in batches, at "confirmed", retried while the node is behind `minContextSlot` or erroring. */
  private async accounts(addresses: Address[], minContextSlot?: bigint): Promise<RawAccount[]> {
    const out: RawAccount[] = [];
    for (let i = 0; i < addresses.length; i += BATCH) {
      const chunk = addresses.slice(i, i + BATCH);
      const value = await this.retry(() =>
        this.rpc
          .getMultipleAccounts(chunk, { commitment: "confirmed", encoding: "base64", ...(minContextSlot !== undefined ? { minContextSlot } : {}) })
          .send()
          .then((r) => r.value),
      );
      for (const a of value) out.push(a ? { owner: a.owner, data: bytes(a.data as any) } : null);
    }
    return out;
  }

  private async clock(minContextSlot?: bigint): Promise<{ now: bigint; slot: bigint }> {
    const r = await this.retry(() =>
      this.rpc
        .getAccountInfo(CLOCK_SYSVAR, { commitment: "confirmed", encoding: "base64", ...(minContextSlot !== undefined ? { minContextSlot } : {}) })
        .send(),
    );
    if (!r.value) throw new Error("no Clock sysvar");
    return { now: clockUnixTimestamp(bytes(r.value.data as any)), slot: BigInt(r.context.slot) };
  }

  /** Every account key of a transaction, including those loaded from lookup tables. Retried until served. */
  private async transactionKeys(signature: string): Promise<Address[]> {
    for (let i = 0; i < 20; i++) {
      const t: any = await this.retry(() =>
        this.rpc.getTransaction(signature as any, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" }).send(),
      );
      if (t) {
        const loaded = t.meta?.loadedAddresses ?? { writable: [], readonly: [] };
        return [...t.transaction.message.accountKeys, ...loaded.writable, ...loaded.readonly];
      }
      await sleep(250);
    }
    this.log.warn("SAS transaction not served by getTransaction; the sweep will cover it", { signature });
    return [];
  }

  private async retry<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await call();
      } catch (e) {
        if (i >= attempts) throw e;
        await sleep(250 * 2 ** (i - 1));
      }
    }
  }

  private gauges() {
    const c = this.index.counts();
    this.metrics.set("thawgate_keeper_tracked_mints", {}, c.mints);
    this.metrics.set("thawgate_keeper_tracked_token_accounts", { state: "initialized" }, c.initialized);
    this.metrics.set("thawgate_keeper_tracked_token_accounts", { state: "frozen" }, c.frozen);
    this.metrics.set("thawgate_keeper_tracked_owners", {}, c.owners);
  }
}
