/**
 * Sends Token ACL `freeze_permissionless_idempotent` (disc 10) for one token account, with retries.
 *
 * The gate decides. Preflight simulation runs the real gate, and its log sets the outcome:
 *   TG:ALLOW:<REASON>           -> frozen (confirmed)
 *   success with no gate frame  -> already_frozen: Token ACL returns early for an account that isn't Initialized
 *   TG:DENY:COMPLIANT           -> compliant: nothing to do, not an error, not retried
 *   any other failed program    -> denied:<code>, not retried (the chain state decides, not the RPC)
 * Blockhash, RPC, rate-limit and confirmation problems are retried with a fresh blockhash and exponential backoff.
 * One attempt per token account at a time: concurrent triggers for the same account share it.
 */
import {
  Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  Instruction,
  MaybeEncodedAccount,
  pipe,
  Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  Signature,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { createFreezePermissionlessIdempotentInstructionWithExtraMetas } from "@token-acl/sdk";
import { classifyGateLogs } from "@thawgate/sdk/reasons";
import { COMPUTE_BUDGET_ID, freezeExtraMetasPda, GATE_ID, mintConfigPda, TOKEN_ACL_ID } from "./accounts";
import { KeeperConfig, Logger } from "./config";
import { Metrics } from "./metrics";

export type Trigger = "sas" | "blacklist" | "allowlist" | "expiry" | "policy" | "token_account" | "sweep" | "resync" | "manual";

export interface FreezeRequest {
  mint: Address;
  tokenAccount: Address;
  owner: Address;
  trigger: Trigger;
  /** Date.now() when the keeper saw the trigger; the latency metric runs from here to confirmation. */
  observedAt: number;
  /** The slot the trigger was seen at: preflight must not run on an RPC node that is behind it. */
  minContextSlot?: bigint;
}

export type Outcome =
  | { kind: "frozen"; reason: string; signature: Signature; cu?: number; latencyMs: number }
  | { kind: "already_frozen"; signature: Signature }
  | { kind: "compliant" }
  | { kind: "denied"; code: string }
  | { kind: "failed"; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_ATTEMPTS = 5;
const CONFIRM_POLL_MS = 400;

export type Verdict = { kind: "frozen"; reason: string } | { kind: "already_frozen" } | { kind: "compliant" } | { kind: "denied"; code: string };

/**
 * The gate's verdict in a freeze transaction's logs (a confirmed transaction's, or a failed preflight's). The logs are
 * read by the SDK's parser, the one `explain()` and `freezeIfInvalid()` use, so the keeper and the SDK can't disagree
 * on a reason. Only TG lines inside the gate's own frames count.
 */
export function classifyLogs(logs: readonly string[], succeeded: boolean): Verdict {
  const v = classifyGateLogs(logs, succeeded, "freeze", { gateId: GATE_ID });
  switch (v.outcome) {
    case "allowed":
      return { kind: "frozen", reason: v.code };
    case "skipped":
      return { kind: "already_frozen" };
    case "denied":
      return v.code === "COMPLIANT" ? { kind: "compliant" } : { kind: "denied", code: v.code };
    case "failed":
      return { kind: "denied", code: v.program === "unknown" ? "UNKNOWN" : `${v.program}: ${v.message}` };
  }
}

const programFailed = (logs: readonly string[]) => logs.some((l) => /^Program \S+ failed: /.test(l));

/** The simulation logs of a failed preflight, if the RPC returned them. */
function preflightLogs(e: any): readonly string[] | undefined {
  return e?.context?.logs ?? e?.cause?.context?.logs ?? undefined;
}

function computeBudgetIxs(limit: number, microLamports: bigint): Instruction[] {
  const setLimit = new Uint8Array(5);
  setLimit[0] = 2;
  new DataView(setLimit.buffer).setUint32(1, limit, true);
  const ixs: Instruction[] = [{ programAddress: COMPUTE_BUDGET_ID, data: setLimit }];
  if (microLamports > 0n) {
    const setPrice = new Uint8Array(9);
    setPrice[0] = 3;
    new DataView(setPrice.buffer).setBigUint64(1, microLamports, true);
    ixs.push({ programAddress: COMPUTE_BUDGET_ID, data: setPrice });
  }
  return ixs;
}

export class Freezer {
  private inflight = new Map<Address, Promise<Outcome>>();
  /** MintConfig and the freeze extra-metas list per mint; dropped when the mint's policy changes. */
  private mintAccounts = new Map<Address, Map<Address, Promise<MaybeEncodedAccount<string>>>>();
  private blockhash?: { value: { blockhash: any; lastValidBlockHeight: bigint }; at: number };

  constructor(
    private rpc: Rpc<SolanaRpcApi>,
    readonly signer: TransactionSigner,
    private config: KeeperConfig,
    private metrics: Metrics,
    private log: Logger,
  ) {}

  /** Forget a mint's cached Token ACL accounts (its policy, and so its extra-metas list, changed). */
  invalidate(mint: Address) {
    this.mintAccounts.delete(mint);
  }

  /** In-flight attempts, for a graceful stop. */
  pending(): Promise<unknown>[] {
    return [...this.inflight.values()];
  }

  freeze(req: FreezeRequest): Promise<Outcome> {
    const running = this.inflight.get(req.tokenAccount);
    if (running) return running;
    const p = this.run(req)
      .catch((e): Outcome => ({ kind: "failed", error: e instanceof Error ? e.message : String(e) }))
      .then((outcome) => {
        this.record(req, outcome);
        return outcome;
      })
      .finally(() => this.inflight.delete(req.tokenAccount));
    this.inflight.set(req.tokenAccount, p);
    return p;
  }

  private record(req: FreezeRequest, o: Outcome) {
    const base = { mint: req.mint, tokenAccount: req.tokenAccount, owner: req.owner, trigger: req.trigger };
    switch (o.kind) {
      case "frozen":
        this.metrics.inc("thawgate_keeper_freezes_total", { trigger: req.trigger, reason: o.reason });
        this.metrics.observe("thawgate_keeper_freeze_latency_seconds", { trigger: req.trigger }, o.latencyMs / 1000);
        this.log.info("frozen", { ...base, reason: o.reason, signature: o.signature, cu: o.cu, latencyMs: o.latencyMs });
        break;
      case "already_frozen":
        this.metrics.inc("thawgate_keeper_skipped_total", { outcome: "already_frozen" });
        this.log.info("already frozen (idempotent no-op landed)", { ...base, signature: o.signature });
        break;
      case "compliant":
        this.metrics.inc("thawgate_keeper_skipped_total", { outcome: "compliant" });
        this.log.info("gate says compliant (TG:DENY:COMPLIANT): nothing to do", base);
        break;
      case "denied":
        this.metrics.inc("thawgate_keeper_denied_total", { code: o.code.slice(0, 64) });
        this.log.warn("freeze refused", { ...base, code: o.code });
        break;
      case "failed":
        this.metrics.inc("thawgate_keeper_failures_total", { kind: "exhausted" });
        this.log.error("freeze failed after retries", { ...base, error: o.error });
        break;
    }
  }

  private async run(req: FreezeRequest): Promise<Outcome> {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        this.metrics.inc("thawgate_keeper_retries_total");
        await sleep(Math.min(500 * 2 ** (attempt - 2), 4_000));
      }
      try {
        const result = await this.attempt(req);
        if (result.kind !== "retry") return result.outcome;
        lastError = result.reason;
        this.log.debug("retrying freeze", { tokenAccount: req.tokenAccount, attempt, reason: result.reason });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        this.blockhash = undefined;
        this.log.warn("freeze attempt errored", { tokenAccount: req.tokenAccount, attempt, error: lastError });
      }
    }
    return { kind: "failed", error: lastError };
  }

  private async attempt(req: FreezeRequest): Promise<{ kind: "done"; outcome: Outcome } | { kind: "retry"; reason: string }> {
    const ix = await createFreezePermissionlessIdempotentInstructionWithExtraMetas(
      this.signer,
      req.tokenAccount,
      req.mint,
      req.owner,
      TOKEN_ACL_ID,
      (a) => this.account(req.mint, a),
    );
    const { blockhash, lastValidBlockHeight } = await this.latestBlockhash();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
      (m) => appendTransactionMessageInstructions([...computeBudgetIxs(this.config.cuLimit, this.config.cuPrice), ix], m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(tx);

    try {
      await this.rpc
        .sendTransaction(getBase64EncodedWireTransaction(tx), {
          encoding: "base64",
          preflightCommitment: "confirmed",
          ...(req.minContextSlot !== undefined ? { minContextSlot: req.minContextSlot } : {}),
        })
        .send();
    } catch (e) {
      const logs = preflightLogs(e);
      if (logs && programFailed(logs)) {
        const verdict = classifyLogs(logs, false);
        if (verdict.kind === "compliant" || verdict.kind === "denied") return { kind: "done", outcome: verdict };
      }
      this.blockhash = undefined;
      return { kind: "retry", reason: `send: ${(e as Error)?.message ?? e}` };
    }

    const status = await this.confirm(signature, lastValidBlockHeight);
    if (status === "expired") return { kind: "retry", reason: "blockhash expired before confirmation" };
    const latencyMs = Date.now() - req.observedAt;

    const logs = await this.transactionLogs(signature);
    const verdict = classifyLogs(logs?.logs ?? [], status.err === null);
    if (!logs && status.err === null) {
      // Confirmed, logs not served: it froze or was a no-op; the index's next read tells which.
      return { kind: "done", outcome: { kind: "frozen", reason: "UNKNOWN", signature, latencyMs } };
    }
    switch (verdict.kind) {
      case "frozen":
        return { kind: "done", outcome: { kind: "frozen", reason: verdict.reason, signature, cu: logs?.cu, latencyMs } };
      case "already_frozen":
        return { kind: "done", outcome: { kind: "already_frozen", signature } };
      default:
        // Landed but failed: the state changed between preflight and execution. The gate's log still decides.
        return { kind: "done", outcome: verdict };
    }
  }

  /** Waits for "confirmed"; "expired" once the block height passes the blockhash's last valid height. */
  private async confirm(signature: Signature, lastValidBlockHeight: bigint): Promise<{ err: unknown } | "expired"> {
    for (;;) {
      const { value } = await this.rpc.getSignatureStatuses([signature]).send();
      const s = value[0];
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { err: s.err };
      if (s?.err) return { err: s.err };
      const height = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > lastValidBlockHeight) return "expired";
      await sleep(CONFIRM_POLL_MS);
    }
  }

  private async transactionLogs(signature: Signature): Promise<{ logs: readonly string[]; cu?: number } | undefined> {
    for (let i = 0; i < 20; i++) {
      const t = await this.rpc
        .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" })
        .send();
      if (t?.meta) return { logs: t.meta.logMessages ?? [], cu: t.meta.computeUnitsConsumed !== undefined ? Number(t.meta.computeUnitsConsumed) : undefined };
      await sleep(300);
    }
    this.log.warn("confirmed, but getTransaction returned nothing", { signature });
    return undefined;
  }

  /** A blockhash at most 5 s old. It stays valid for ~150 blocks, so reuse costs nothing and saves a round trip. */
  private async latestBlockhash() {
    if (!this.blockhash || Date.now() - this.blockhash.at > 5_000) {
      const { value } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      this.blockhash = { value, at: Date.now() };
    }
    return this.blockhash.value;
  }

  /** The SDK's account retriever: MintConfig and the freeze extra-metas list come from a per-mint cache. */
  private async account(mint: Address, a: Address): Promise<MaybeEncodedAccount<string>> {
    let cache = this.mintAccounts.get(mint);
    if (!cache) {
      cache = new Map();
      this.mintAccounts.set(mint, cache);
      for (const key of [await mintConfigPda(mint), await freezeExtraMetasPda(mint)]) {
        cache.set(key, fetchEncodedAccount(this.rpc, key, { commitment: "confirmed" }));
      }
    }
    const hit = cache.get(a);
    if (hit) {
      const account = await hit.catch(() => undefined);
      if (account) return account;
      cache.delete(a);
    }
    return fetchEncodedAccount(this.rpc, a, { commitment: "confirmed" });
  }
}
