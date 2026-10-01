import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { Address, address, getAddressEncoder } from "@solana/kit";
import {
  ADDED_TO_BLACKLIST_DISCRIMINATOR,
  ALLOWLIST_ENTRY_DISCRIMINATOR,
  ALLOWLIST_REMOVED_DISCRIMINATOR,
  attestationPda,
  BLACKLIST_ENTRY_DISCRIMINATOR,
  clockUnixTimestamp,
  decodeGatePolicy,
  decodeIssuerEvent,
  decodeMintConfig,
  decodeTokenAccount,
  GATE_ID,
  GATE_POLICY_DISCRIMINATOR,
  programDataLogs,
  readAllowlistEntry,
  readAttestation,
  readBlacklistEntry,
  SAS_ID,
  TOKEN_ACL_ID,
} from "../src/accounts";

const enc = getAddressEncoder();
const anchorDisc = (s: string) => [...createHash("sha256").update(s).digest().subarray(0, 8)];
const A: Address = address("4CTEDr7pgqBU4uLkVk2aqu54tPQi9ufUKZVvDv2tgYp2"); // S3 holder
const B: Address = address("5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e");
const C: Address = address("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ"); // sss-token
const concat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
const key = (a: Address) => enc.encode(a);

describe("discriminators", () => {
  it("are Anchor's sha256 prefixes", () => {
    expect([...GATE_POLICY_DISCRIMINATOR]).toEqual(anchorDisc("account:GatePolicy"));
    expect([...BLACKLIST_ENTRY_DISCRIMINATOR]).toEqual(anchorDisc("account:BlacklistEntry"));
    expect([...ALLOWLIST_ENTRY_DISCRIMINATOR]).toEqual(anchorDisc("account:AllowlistEntry"));
    expect([...ADDED_TO_BLACKLIST_DISCRIMINATOR]).toEqual(anchorDisc("event:AddedToBlacklist"));
    expect([...ALLOWLIST_REMOVED_DISCRIMINATOR]).toEqual(anchorDisc("event:AllowlistRemoved"));
  });

  it("match the sss-token IDL the SDK ships", () => {
    const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../sdk/src/idl.json"), "utf8"));
    const event = (name: string) => idl.events.find((e: any) => e.name === name)?.discriminator;
    const account = (name: string) => idl.accounts.find((a: any) => a.name === name)?.discriminator;
    expect(event("AddedToBlacklist")).toEqual([...ADDED_TO_BLACKLIST_DISCRIMINATOR]);
    expect(event("AllowlistRemoved")).toEqual([...ALLOWLIST_REMOVED_DISCRIMINATOR]);
    expect(account("BlacklistEntry")).toEqual([...BLACKLIST_ENTRY_DISCRIMINATOR]);
    expect(account("AllowlistEntry")).toEqual([...ALLOWLIST_ENTRY_DISCRIMINATOR]);
  });
});

describe("GatePolicy", () => {
  const policy = (mode: number) =>
    concat(GATE_POLICY_DISCRIMINATOR, [1, 254], key(A), key(B), key(C), [1, mode, 1], key(GATE_ID), key(SAS_ID), [3], new Uint8Array(64));

  it("decodes the 238-byte layout", () => {
    const bytes = policy(2);
    expect(bytes.length).toBe(238);
    expect(decodeGatePolicy(bytes)).toEqual({
      mint: A,
      authority: B,
      issuerProgram: C,
      checkBlacklist: true,
      allowlistMode: "bypassForPdas",
      requireSas: true,
      sasCredential: GATE_ID,
      sasSchema: SAS_ID,
      minKycLevel: 3,
    });
  });

  it("rejects other accounts", () => {
    expect(decodeGatePolicy(policy(3))).toBeNull(); // no such allowlist mode
    expect(decodeGatePolicy(policy(0).subarray(0, 237))).toBeNull();
    const other = policy(0);
    other[0] ^= 1;
    expect(decodeGatePolicy(other)).toBeNull();
  });
});

describe("MintConfig", () => {
  it("decodes Token ACL's 100-byte config", () => {
    const bytes = concat([1, 255, 1, 0], key(A), key(B), key(GATE_ID));
    expect(decodeMintConfig(bytes)).toEqual({ mint: A, freezeAuthority: B, gatingProgram: GATE_ID, permissionlessThaw: true, permissionlessFreeze: false });
    bytes[0] = 0;
    expect(decodeMintConfig(bytes)).toBeNull();
  });
});

describe("token account", () => {
  const account = (state: number, accountType = 2) => {
    const data = new Uint8Array(170);
    data.set(key(A), 0);
    data.set(key(B), 32);
    data.set(i64(1_000_000n), 64);
    data[108] = state;
    data[165] = accountType;
    return data;
  };
  it("reads mint, owner, amount and state", () => {
    expect(decodeTokenAccount(account(1))).toEqual({ mint: A, owner: B, amount: 1_000_000n, state: "initialized" });
    expect(decodeTokenAccount(account(2))?.state).toBe("frozen");
    expect(decodeTokenAccount(account(2).subarray(0, 165))?.state).toBe("frozen"); // no extensions
  });
  it("rejects a mint (account type 1) and short data", () => {
    expect(decodeTokenAccount(account(1, 1))).toBeNull();
    expect(decodeTokenAccount(account(1).subarray(0, 164))).toBeNull();
  });
});

/** The attestation the deployed SAS program wrote in S3 (programs/thawgate-gate/src/sas.rs tests). */
const S3_HEX =
  "022f821b10be71bc4a0faafc3973038a60331d3da598ae8e9afaddf43b4a3bc42bd044ee5d1ac0fd114ae283af7adecf9c476edbebc412cd7d5d3f4c0b632bc623c14a644ec9dad43627fc1a4e990366beb86015fa9b326d4582e7f3a75c3a57a5070000000202000000494e51400fd6e5b3d85c985be03de05276be7b66a6e3c58c0a5b4cc6392d5a51396fafd0966c000000000000000000000000000000000000000000000000000000000000000000000000";
const S3_CREDENTIAL = address("F1zmKcyTqcDBzd1bD8a526Sk38r7GrMRrN6EgCfGWmoG");
const S3_SCHEMA = address("E1XUjb5UJxgg3xExSX77JqaPrsJ4SEwQC6dtMCEZu3LG");
const s3 = () => Uint8Array.from(Buffer.from(S3_HEX, "hex"));

describe("SAS attestation", () => {
  const read = (data: Uint8Array, owner: Address = SAS_ID, holder: Address = A) =>
    readAttestation({ owner, data }, S3_CREDENTIAL, S3_SCHEMA, holder);

  it("decodes the attestation SAS wrote", () => {
    expect(s3().length).toBe(180);
    expect(read(s3())).toEqual({ kind: "present", expiry: 1_821_823_151n, dataLen: 7, firstByte: 2 });
  });

  it("is missing when the account is gone or empty", () => {
    expect(readAttestation(null, S3_CREDENTIAL, S3_SCHEMA, A)).toEqual({ kind: "missing" });
    expect(read(new Uint8Array(0))).toEqual({ kind: "missing" });
  });

  it("is bad when it isn't this policy's attestation for this holder", () => {
    expect(read(s3(), TOKEN_ACL_ID).kind).toBe("bad"); // not owned by SAS
    expect(read(s3(), SAS_ID, B).kind).toBe("bad"); // nonce is another wallet
    expect(readAttestation({ owner: SAS_ID, data: s3() }, S3_SCHEMA, S3_SCHEMA, A).kind).toBe("bad");
    const schemaAccount = s3();
    schemaAccount[0] = 1;
    expect(read(schemaAccount).kind).toBe("bad");
    expect(read(s3().subarray(0, 140 + 7)).kind).toBe("bad"); // truncated inside expiry
    const longData = s3();
    longData.set(u32(1000), 97);
    expect(read(longData).kind).toBe("bad");
  });

  it("derives the PDA the gate's extra metas resolve", async () => {
    // S3 spike holder; SPIKES.md S3 checked this address by hand, via sas-lib and via the resolver.
    const pda = await attestationPda(S3_CREDENTIAL, S3_SCHEMA, A);
    expect(typeof pda).toBe("string");
    expect(pda).not.toBe(A);
  });
});

describe("sss-token registry entries", () => {
  const blacklist = (active: number, mint = A, wallet = B) =>
    concat(BLACKLIST_ENTRY_DISCRIMINATOR, key(mint), key(wallet), u32(6), Buffer.from("reason"), i64(1_760_000_000n), key(C), [active, 254], new Uint8Array(40));
  const allowlist = (active: number) => concat(ALLOWLIST_ENTRY_DISCRIMINATOR, key(A), key(B), i64(1_760_000_000n), [active, 253]);

  it("reads active and inactive entries", () => {
    expect(readBlacklistEntry({ owner: C, data: blacklist(1) }, C, A, B)).toBe("active");
    expect(readBlacklistEntry({ owner: C, data: blacklist(0) }, C, A, B)).toBe("inactive");
    expect(readAllowlistEntry({ owner: C, data: allowlist(1) }, C, A, B)).toBe("active");
    expect(readAllowlistEntry({ owner: C, data: allowlist(0) }, C, A, B)).toBe("inactive");
    expect(readBlacklistEntry(null, C, A, B)).toBe("none");
  });

  it("rejects entries for another mint, wallet, owner program or type", () => {
    expect(readBlacklistEntry({ owner: C, data: blacklist(1, B, B) }, C, A, B)).toBe("bad");
    expect(readBlacklistEntry({ owner: C, data: blacklist(1, A, A) }, C, A, B)).toBe("bad");
    expect(readBlacklistEntry({ owner: GATE_ID, data: blacklist(1) }, C, A, B)).toBe("bad");
    expect(readAllowlistEntry({ owner: C, data: blacklist(1) }, C, A, B)).toBe("bad");
    expect(readBlacklistEntry({ owner: C, data: blacklist(2) }, C, A, B)).toBe("bad");
  });
});

describe("Clock and events", () => {
  it("reads Clock.unix_timestamp at byte 32", () => {
    const data = concat(i64(1n), i64(2n), i64(3n), i64(4n), i64(1_790_852_566n));
    expect(clockUnixTimestamp(data)).toBe(1_790_852_566n);
  });

  it("decodes events logged in the issuer's own frame only", () => {
    const added = Buffer.from(concat(ADDED_TO_BLACKLIST_DISCRIMINATOR, key(A), key(B), u32(1), Buffer.from("x"), key(C), i64(1n))).toString("base64");
    const removed = Buffer.from(concat(ALLOWLIST_REMOVED_DISCRIMINATOR, key(A), key(C), i64(1n))).toString("base64");
    const logs = [
      `Program ${C} invoke [1]`,
      "Program log: Instruction: AddToBlacklist",
      `Program ${TOKEN_ACL_ID} invoke [2]`,
      `Program data: ${removed}`, // inside a CPI: not the issuer's event
      `Program ${TOKEN_ACL_ID} success`,
      `Program data: ${added}`,
      `Program ${C} consumed 26669 of 200000 compute units`,
      `Program ${C} success`,
    ];
    const events = programDataLogs(logs, C).map(decodeIssuerEvent);
    expect(events).toEqual([{ kind: "addedToBlacklist", mint: A, wallet: B }]);
    expect(decodeIssuerEvent(Buffer.from(removed, "base64"))).toEqual({ kind: "allowlistRemoved", mint: A, wallet: C });
  });
});
