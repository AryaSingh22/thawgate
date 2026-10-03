/**
 * Timing and polling helpers shared by the e2e suites (keeper.ts, screener.ts).
 */
import "./cluster"; // first: sets the RPC and payer before the helpers load
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  Address,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  Instruction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  TransactionSigner,
} from "@solana/kit";
import { rpc } from "../gate/helpers";

export const kit = (k: PublicKey): Address => address(k.toBase58());
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Timing: send and confirm with 100 ms status polls, so "confirmed at" is when the client could first know.
// ---------------------------------------------------------------------------------------------
export type Landed = { sig: string; slot: bigint; confirmedAt: number };
export async function sendFast(ixs: Instruction[], feePayer: TransactionSigner): Promise<Landed> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  const deadline = Date.now() + 60_000;
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const s = value[0];
    if (s?.err) throw new Error(`${sig} failed: ${JSON.stringify(s.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { sig, slot: BigInt(s.slot), confirmedAt: Date.now() };
    if (Date.now() > deadline) throw new Error(`${sig} not confirmed in 60 s`);
    await sleep(100);
  }
}

export async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false>, timeoutMs: number, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** A confirmed transaction's fee payer, logs, CU and slot. */
export async function txInfo(signature: string) {
  const t: any = await waitFor(
    `getTransaction ${signature}`,
    () => rpc.getTransaction(signature as any, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" }).send().then((t) => t ?? undefined),
    20_000,
    300,
  );
  return {
    sig: signature,
    slot: BigInt(t.slot),
    blockTime: t.blockTime === null ? undefined : BigInt(t.blockTime),
    feePayer: t.transaction.message.accountKeys[0] as string,
    logs: (t.meta?.logMessages ?? []) as string[],
    cu: Number(t.meta?.computeUnitsConsumed ?? 0),
  };
}

/** The newest successful transaction touching `account` and what it says: the keeper's freeze, if it froze it. */
export async function latestTx(account: PublicKey) {
  const sigs = await rpc.getSignaturesForAddress(kit(account), { limit: 5, commitment: "confirmed" }).send();
  const last = sigs.find((s) => s.err === null);
  assert.ok(last, `no transaction on ${account.toBase58()}`);
  return txInfo(last.signature);
}

/** Sum of a counter's samples whose labels include `labels`. */
export function counter(text: string, name: string, labels: Record<string, string> = {}): number {
  return text
    .split("\n")
    .filter((l) => l.startsWith(`${name}{`) || l.startsWith(`${name} `))
    .filter((l) => Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)))
    .reduce((sum, l) => sum + Number(l.slice(l.lastIndexOf(" ") + 1)), 0);
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
