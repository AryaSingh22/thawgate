/**
 * One attestor tick: read the source, read the mint's ReserveAttestation, and post `attest_reserves` when the
 * source is newer. The program enforces the same rules (attestor signature, as_of not in the future and not older
 * than the stored one); checking them here first means a skipped tick costs no fee and says why.
 */
import {
  Address,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  Signature,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { attestReservesInstruction, decodeReserveAttestation, OnChainAttestation, reservePda, SSS_TOKEN_ID } from "./chain";
import { ReserveReport } from "./source";

const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");

export type Decision =
  | { post: true; reason: "first_post" | "newer" | "correction" }
  | { post: false; reason: "no_attestation" | "not_attestor" | "older_than_chain" | "unchanged" | "future_as_of"; detail?: string };

/** Whether to post `report` over the on-chain attestation, as `attestor`, at unix time `now`. */
export function decide(report: ReserveReport, onChain: OnChainAttestation | null, attestor: Address, now: bigint): Decision {
  if (!onChain) return { post: false, reason: "no_attestation", detail: "MasterAuthority hasn't called set_reserve_attestor for this mint" };
  if (onChain.attestor !== attestor) return { post: false, reason: "not_attestor", detail: `the mint's attestor is ${onChain.attestor}` };
  if (report.asOf > now) return { post: false, reason: "future_as_of", detail: `asOf ${report.asOf} > now ${now}` };
  if (report.asOf < onChain.asOf) return { post: false, reason: "older_than_chain", detail: `asOf ${report.asOf} < on-chain ${onChain.asOf}` };
  if (report.asOf === onChain.asOf) {
    if (report.reserves === onChain.reserves && report.reportUri === onChain.reportUri) return { post: false, reason: "unchanged" };
    return { post: true, reason: "correction" };
  }
  return { post: true, reason: onChain.asOf === 0n ? "first_post" : "newer" };
}

export interface TickResult {
  decision: Decision;
  signature?: Signature;
}

export interface TickOptions {
  rpc: Rpc<SolanaRpcApi>;
  attestor: TransactionSigner;
  /** Pays the fee; default the attestor. */
  feePayer?: TransactionSigner;
  programId?: Address;
  dryRun?: boolean;
}

/** Reads the on-chain attestation, decides, and posts unless `dryRun`. Resolves once the post is confirmed. */
export async function tick(report: ReserveReport, opts: TickOptions): Promise<TickResult> {
  const { rpc, attestor } = opts;
  const pda = await reservePda(report.mint, opts.programId ?? SSS_TOKEN_ID);
  const account = await fetchEncodedAccount(rpc, pda, { commitment: "confirmed" });
  const onChain = account.exists ? decodeReserveAttestation(account.data) : null;
  // Cluster time, not the local clock: the program compares as_of with Clock::unix_timestamp (byte 32 of the sysvar).
  const clock = await fetchEncodedAccount(rpc, CLOCK_SYSVAR, { commitment: "confirmed" });
  if (!clock.exists) throw new Error("no Clock sysvar");
  const now = Buffer.from(clock.data).readBigInt64LE(32);

  const decision = decide(report, onChain, attestor.address, now);
  if (!decision.post || opts.dryRun) return { decision };

  const ix = attestReservesInstruction({ attestor, reserveAttestation: pda, reserves: report.reserves, asOf: report.asOf, reportUri: report.reportUri, programId: opts.programId });
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(opts.feePayer ?? attestor, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    ),
  );
  const signature = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  await confirm(rpc, signature, latest.lastValidBlockHeight);
  return { decision, signature };
}

async function confirm(rpc: Rpc<SolanaRpcApi>, signature: Signature, lastValidBlockHeight: bigint): Promise<void> {
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const s = value[0];
    if (s?.err) throw new Error(`attest_reserves ${signature} failed: ${JSON.stringify(s.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    if ((await rpc.getBlockHeight({ commitment: "confirmed" }).send()) > lastValidBlockHeight) {
      throw new Error(`attest_reserves ${signature}: blockhash expired before confirmation`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
