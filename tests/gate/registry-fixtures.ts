/**
 * Writes the genesis fixtures (tests/gate/keys.ts) as `solana-test-validator --account` JSON files:
 * - the REGISTRY entries, in sss-token's account layout (programs/sss-token/src/state/{blacklist,allowlist}_entry.rs),
 *   owned by sss-token;
 * - FORGED_ATTESTATION, in SAS's attestation layout, owned by SAS.
 *
 *   npx ts-node --transpile-only tests/gate/registry-fixtures.ts <out-dir>
 *
 * Prints one "<address> <file>" line per account for scripts/test-gate.sh.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  attestationPda,
  FORGED_ATTESTATION,
  key,
  REGISTRY,
  registryPda,
  SAS_ID,
  SAS_ISSUER,
  sasSchemaPda,
  SSS_TOKEN_ID,
  walletKey,
} from "./keys";

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

/**
 * SAS attestation layout (SAS create_attestation.rs): discriminator 2 | nonce | credential | schema |
 * u32 data len + data | signer | expiry i64 | token_account. Data = kyc_level 2, country "IN", as in S3.
 */
function encodeAttestation(nonce: PublicKey, credential: PublicKey, schema: PublicKey) {
  const data = Buffer.from([2, 2, 0, 0, 0, ...Buffer.from("IN")]);
  const b = Buffer.alloc(1 + 32 * 3 + 4 + data.length + 32 + 8 + 32);
  let o = 0;
  b[o++] = 2;
  for (const k of [nonce, credential, schema]) o += k.toBuffer().copy(b, o);
  o = b.writeUInt32LE(data.length, o);
  o += data.copy(b, o);
  o += key(SAS_ISSUER).toBuffer().copy(b, o); // signer
  b.writeBigInt64LE(0n, o); // expiry: never; token_account stays zero (not tokenized)
  return b;
}

function write(name: string, address: PublicKey, owner: PublicKey, data: Buffer) {
  const file = path.join(outDir, `${name}.json`);
  const account = {
    pubkey: address.toBase58(),
    account: {
      lamports: rentExempt(data.length),
      data: [data.toString("base64"), "base64"],
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
  fs.writeFileSync(file, JSON.stringify(account));
  console.log(`${address.toBase58()} ${file}`);
}

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: registry-fixtures.ts <out-dir>");
fs.mkdirSync(outDir, { recursive: true });
for (const entry of REGISTRY) {
  const mint = key(entry.mint);
  const wallet = walletKey(entry);
  const [address, bump] = registryPda(entry.kind, mint, wallet);
  const data = encode(entry.kind, mint.toBuffer(), wallet.toBuffer(), entry.active, bump);
  write(`${entry.kind}-${entry.mint}-${entry.wallet}`, address, SSS_TOKEN_ID, data);
}
const forged = key(FORGED_ATTESTATION.wallet);
write(
  "attestation-forged",
  attestationPda(forged),
  SAS_ID,
  encodeAttestation(forged, key(FORGED_ATTESTATION.credential), sasSchemaPda()),
);
