/**
 * The screener's on-chain side, on @solana/web3.js v1 (already a compliance-service dependency): sss-token PDAs, the
 * RoleRecord and BlacklistEntry readers, a hand-built `add_to_blacklist` (pinned against the SDK IDL in the tests), and
 * sending it.
 *
 * add_to_blacklist(reason) accounts, in IDL order:
 *   operator (signer, writable: pays the entry's rent), config, operator_role (Blacklister), blacklist_entry (writable,
 *   `init`), target, mint, target_token_account (writable; must be owned by target since S9), token_program,
 *   system_program, token_acl_program, mint_config (Token ACL's PDA for the mint).
 * sss-token freezes target_token_account itself if it is thawed, through Token ACL, then emits AddedToBlacklist; the
 * keeper freezes the wallet's other thawed accounts.
 */
import { AccountInfo, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

export const SSS_TOKEN_ID = new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
export const TOKEN_2022_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const TOKEN_ACL_ID = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");

/** sss-token RoleType::Blacklister (MasterAuthority 0, Minter 1, Burner 2, Pauser 3, Blacklister 4, Seizer 5). */
export const BLACKLISTER_ROLE = 4;
/** sss-token constants::MAX_REASON_LEN (bytes). */
export const MAX_REASON_LEN = 100;

export const ADD_TO_BLACKLIST_DISCRIMINATOR = Buffer.from([90, 115, 98, 231, 173, 119, 117, 176]);
export const BLACKLIST_ENTRY_DISCRIMINATOR = Buffer.from([218, 179, 231, 40, 141, 25, 168, 189]);
export const ROLE_RECORD_DISCRIMINATOR = Buffer.from([178, 241, 126, 194, 47, 84, 237, 40]);

const pda = (seeds: (Buffer | Uint8Array)[], program = SSS_TOKEN_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
export const configPda = (mint: PublicKey) => pda([Buffer.from("stablecoin_config"), mint.toBuffer()]);
export const rolePda = (mint: PublicKey, holder: PublicKey, role: number) => pda([Buffer.from("role"), mint.toBuffer(), holder.toBuffer(), Buffer.from([role])]);
export const blacklistPda = (mint: PublicKey, wallet: PublicKey) => pda([Buffer.from("blacklist"), mint.toBuffer(), wallet.toBuffer()]);
export const mintConfigPda = (mint: PublicKey) => pda([Buffer.from("MINT_CONFIG"), mint.toBuffer()], TOKEN_ACL_ID);

export function addToBlacklistIx(p: { operator: PublicKey; mint: PublicKey; target: PublicKey; targetTokenAccount: PublicKey; reason: string }): TransactionInstruction {
  const reason = Buffer.from(p.reason, "utf8");
  if (reason.length > MAX_REASON_LEN) throw new Error(`reason is ${reason.length} bytes; sss-token allows ${MAX_REASON_LEN}`);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(reason.length);
  const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
  const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  return new TransactionInstruction({
    programId: SSS_TOKEN_ID,
    keys: [
      { pubkey: p.operator, isSigner: true, isWritable: true },
      ro(configPda(p.mint)),
      ro(rolePda(p.mint, p.operator, BLACKLISTER_ROLE)),
      rw(blacklistPda(p.mint, p.target)),
      ro(p.target),
      ro(p.mint),
      rw(p.targetTokenAccount),
      ro(TOKEN_2022_ID),
      ro(SystemProgram.programId),
      ro(TOKEN_ACL_ID),
      ro(mintConfigPda(p.mint)),
    ],
    data: Buffer.concat([ADD_TO_BLACKLIST_DISCRIMINATOR, len, reason]),
  });
}

export type EntryRead = "none" | "inactive" | "active" | "bad";

/** BlacklistEntry: disc | mint 32 @8 | target 32 @40 | reason (u32 len + bytes) @72 | added_at i64 | added_by 32 | active | bump. */
export function readBlacklistEntry(account: Pick<AccountInfo<Buffer>, "owner" | "data"> | null, mint: PublicKey, wallet: PublicKey): EntryRead {
  if (!account || account.data.length === 0) return "none";
  const data = account.data;
  if (!account.owner.equals(SSS_TOKEN_ID) || !data.subarray(0, 8).equals(BLACKLIST_ENTRY_DISCRIMINATOR) || data.length < 76) return "bad";
  if (!data.subarray(8, 40).equals(mint.toBuffer()) || !data.subarray(40, 72).equals(wallet.toBuffer())) return "bad";
  const activeAt = 76 + data.readUInt32LE(72) + 8 + 32;
  if (data.length < activeAt + 2 || data[activeAt] > 1) return "bad";
  return data[activeAt] === 1 ? "active" : "inactive";
}

/** RoleRecord: disc | mint 32 @8 | holder 32 @40 | role u8 @72 | active u8 @73 | granted_at i64 @74 | bump @82. */
export function roleIsActive(account: Pick<AccountInfo<Buffer>, "owner" | "data"> | null, mint: PublicKey, holder: PublicKey, role: number): boolean {
  if (!account || !account.owner.equals(SSS_TOKEN_ID)) return false;
  const data = account.data;
  if (data.length < 83 || !data.subarray(0, 8).equals(ROLE_RECORD_DISCRIMINATOR)) return false;
  return data.subarray(8, 40).equals(mint.toBuffer()) && data.subarray(40, 72).equals(holder.toBuffer()) && data[72] === role && data[73] === 1;
}

export type SendOutcome =
  | { kind: "sent"; sig: string; slot: number; confirmedAt: number }
  | { kind: "already_blacklisted" }
  | { kind: "no_role" }
  | { kind: "account_gone"; detail: string }
  | { kind: "failed"; detail: string };

/** Maps a refused add_to_blacklist (simulation or landed) to an outcome. Exported for the tests. */
export function classifyFailure(text: string): SendOutcome {
  if (/already in use/.test(text)) return { kind: "already_blacklisted" };
  if (/caused by account: operator_role/.test(text) || /BlacklisterNotFound/.test(text)) return { kind: "no_role" };
  if (/caused by account: target_token_account/.test(text) || /TargetAccountOwnerMismatch/.test(text)) return { kind: "account_gone", detail: firstErrorLine(text) };
  return { kind: "failed", detail: firstErrorLine(text) };
}

const firstErrorLine = (text: string) => text.split("\n").find((l) => /Error|failed/i.test(l))?.trim().slice(0, 300) ?? text.slice(0, 300);

/** What the screener needs from the chain; tests substitute a fake. */
export interface Chain {
  readonly operator: string;
  hasBlacklisterRole(mint: string): Promise<boolean>;
  blacklistEntries(pairs: { mint: string; wallet: string }[]): Promise<EntryRead[]>;
  addToBlacklist(p: { mint: string; wallet: string; tokenAccount: string; reason: string }): Promise<SendOutcome>;
  balance(): Promise<number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BATCH = 100;

export class SolanaChain implements Chain {
  readonly operator: string;
  private conn: Connection;

  constructor(
    rpcUrl: string,
    private readonly signer: Keypair,
  ) {
    this.conn = new Connection(rpcUrl, { commitment: "confirmed" });
    this.operator = signer.publicKey.toBase58();
  }

  async hasBlacklisterRole(mint: string) {
    const m = new PublicKey(mint);
    const info = await this.conn.getAccountInfo(rolePda(m, this.signer.publicKey, BLACKLISTER_ROLE), "confirmed");
    return roleIsActive(info, m, this.signer.publicKey, BLACKLISTER_ROLE);
  }

  async blacklistEntries(pairs: { mint: string; wallet: string }[]) {
    const out: EntryRead[] = [];
    for (let i = 0; i < pairs.length; i += BATCH) {
      const chunk = pairs.slice(i, i + BATCH).map((p) => ({ mint: new PublicKey(p.mint), wallet: new PublicKey(p.wallet) }));
      const infos = await this.conn.getMultipleAccountsInfo(chunk.map((p) => blacklistPda(p.mint, p.wallet)), "confirmed");
      chunk.forEach((p, j) => out.push(readBlacklistEntry(infos[j], p.mint, p.wallet)));
    }
    return out;
  }

  async balance() {
    return this.conn.getBalance(this.signer.publicKey, "confirmed");
  }

  /**
   * Sends add_to_blacklist with preflight at "confirmed" and polls its status every 400 ms. A blockhash that expires
   * before confirmation, or an RPC error, is retried with a fresh blockhash (3 attempts); a resend after the first one
   * landed fails "already in use", which reads as already_blacklisted.
   */
  async addToBlacklist(p: { mint: string; wallet: string; tokenAccount: string; reason: string }): Promise<SendOutcome> {
    const ix = addToBlacklistIx({
      operator: this.signer.publicKey,
      mint: new PublicKey(p.mint),
      target: new PublicKey(p.wallet),
      targetTokenAccount: new PublicKey(p.tokenAccount),
      reason: p.reason,
    });
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      let sig: string;
      let lastValidBlockHeight: number;
      try {
        const latest = await this.conn.getLatestBlockhash("confirmed");
        lastValidBlockHeight = latest.lastValidBlockHeight;
        const tx = new Transaction({ feePayer: this.signer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight }).add(ix);
        tx.sign(this.signer);
        sig = await this.conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
      } catch (e: any) {
        const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
        const text = [e?.message ?? String(e), ...logs].join("\n");
        // A refusal in simulation carries program logs; an RPC or network error doesn't, and is worth another try.
        if (logs.length || /custom program error|already in use/.test(text)) return classifyFailure(text);
        last = text;
        await sleep(500 * attempt);
        continue;
      }
      for (let polls = 0; ; polls++) {
        const { value } = await this.conn.getSignatureStatuses([sig]);
        const s = value[0];
        if (s?.err) {
          const landed = await this.conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
          return classifyFailure([JSON.stringify(s.err), ...(landed?.meta?.logMessages ?? [])].join("\n"));
        }
        if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { kind: "sent", sig, slot: s.slot, confirmedAt: Date.now() };
        if (polls % 5 === 4 && (await this.conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          last = `${sig} expired before confirmation`;
          break;
        }
        await sleep(400);
      }
    }
    return { kind: "failed", detail: last.slice(0, 300) };
  }
}
