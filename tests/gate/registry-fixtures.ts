/**
 * Writes the REGISTRY entries (tests/gate/keys.ts) as `solana-test-validator --account` JSON files, in
 * sss-token's account layout (programs/sss-token/src/state/{blacklist,allowlist}_entry.rs), owned by sss-token.
 *
 *   npx ts-node --transpile-only tests/gate/registry-fixtures.ts <out-dir>
 *
 * Prints one "<address> <file>" line per account for scripts/test-gate.sh.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { key, REGISTRY, registryPda, SSS_TOKEN_ID } from "./keys";

// Account sizes as sss-token allocates them (BLACKLIST_ENTRY_SIZE, ALLOWLIST_ENTRY_SIZE).
const BLACKLIST_ENTRY_SIZE = 218;
const ALLOWLIST_ENTRY_SIZE = 82;
const ADDED_AT = 1_760_000_000n;

const discriminator = (account: string) => createHash("sha256").update(`account:${account}`).digest().subarray(0, 8);
/** Rent-exempt minimum on a default test validator: (128 + size) bytes * 3480 lamports/byte-year * 2 years. */
const rentExempt = (size: number) => (128 + size) * 3480 * 2;

function encode(kind: "blacklist" | "allowlist", mint: Buffer, wallet: Buffer, active: boolean, bump: number) {
  const size = kind === "blacklist" ? BLACKLIST_ENTRY_SIZE : ALLOWLIST_ENTRY_SIZE;
  const b = Buffer.alloc(size);
  let o = discriminator(kind === "blacklist" ? "BlacklistEntry" : "AllowlistEntry").copy(b, 0);
  o += mint.copy(b, o);
  o += wallet.copy(b, o); // `target` / `wallet`
  if (kind === "blacklist") {
    const reason = Buffer.from("ThawGate S4 test fixture");
    o = b.writeUInt32LE(reason.length, o);
    o += reason.copy(b, o);
    o = b.writeBigInt64LE(ADDED_AT, o);
    o += key("blacklister").toBuffer().copy(b, o); // added_by
  } else {
    o = b.writeBigInt64LE(ADDED_AT, o);
  }
  b[o++] = active ? 1 : 0;
  b[o++] = bump;
  return b;
}

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: registry-fixtures.ts <out-dir>");
fs.mkdirSync(outDir, { recursive: true });
for (const entry of REGISTRY) {
  const mint = key(entry.mint);
  const wallet = key(entry.wallet);
  const [address, bump] = registryPda(entry.kind, mint, wallet);
  const data = encode(entry.kind, mint.toBuffer(), wallet.toBuffer(), entry.active, bump);
  const file = path.join(outDir, `${entry.kind}-${entry.mint}-${entry.wallet}.json`);
  const account = {
    pubkey: address.toBase58(),
    account: {
      lamports: rentExempt(data.length),
      data: [data.toString("base64"), "base64"],
      owner: SSS_TOKEN_ID.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
  fs.writeFileSync(file, JSON.stringify(account));
  console.log(`${address.toBase58()} ${file}`);
}
