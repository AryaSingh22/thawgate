import { describe, expect, it } from "vitest";
import { address, generateKeyPairSigner, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { createHash } from "crypto";
import IDL from "../../../sdk/src/idl.json";
import { decide } from "../src/attestor";
import {
  ATTEST_RESERVES_DISCRIMINATOR,
  attestReservesInstruction,
  decodeReserveAttestation,
  OnChainAttestation,
  RESERVE_ATTESTATION_DISCRIMINATOR,
  reservePda,
  SSS_TOKEN_ID,
} from "../src/chain";
import { masker } from "../src/config";
import { parseReport, ReserveReport } from "../src/source";

const MINT = address("5632jFw8mU2hAjP2p8jNcCG9CW2MdeikDkbpd4Knr2G6");
const ATTESTOR = address("4auu6ttRQPrkewa3Umwer25W8ck7ERm73H1CmyYoDWH2");
const NOW = 1_790_000_000n;
const idl = IDL as any;

describe("source", () => {
  const ok = { mint: MINT, reserves: "1000000000", asOf: 1_789_999_000, reportUri: "https://example.com/r.json" };

  it("parses base units as a bigint and asOf as seconds or ISO", () => {
    expect(parseReport(ok)).toEqual({ mint: MINT, reserves: 1_000_000_000n, asOf: 1_789_999_000n, reportUri: ok.reportUri });
    expect(parseReport({ ...ok, asOf: "2026-10-01T00:00:00Z" }).asOf).toBe(1_790_812_800n);
    expect(parseReport({ ...ok, reserves: "18446744073709551615" }).reserves).toBe(18446744073709551615n);
  });

  it("rejects what the program would reject or misread", () => {
    expect(() => parseReport({ ...ok, reserves: 1000 })).toThrow(/decimal integer string/);
    expect(() => parseReport({ ...ok, reserves: "1.5" })).toThrow(/decimal integer string/);
    expect(() => parseReport({ ...ok, reserves: "18446744073709551616" })).toThrow(/exceed u64/);
    expect(() => parseReport({ ...ok, mint: "not-an-address" })).toThrow(/mint/);
    expect(() => parseReport({ ...ok, asOf: "yesterday" })).toThrow(/asOf/);
    expect(() => parseReport({ ...ok, reportUri: "x".repeat(201) })).toThrow(/200 bytes/);
    expect(parseReport({ ...ok, reportUri: "x".repeat(200) }).reportUri).toHaveLength(200);
  });
});

describe("decide", () => {
  const report: ReserveReport = { mint: MINT, reserves: 500n, asOf: NOW - 10n, reportUri: "u" };
  const chain = (over: Partial<OnChainAttestation> = {}): OnChainAttestation => ({
    mint: MINT,
    attestor: ATTESTOR,
    reserves: 400n,
    asOf: NOW - 100n,
    maxStaleness: 3600n,
    reportUri: "u",
    postedAt: NOW - 90n,
    ...over,
  });

  it("posts a first, newer or corrected report", () => {
    expect(decide(report, chain({ asOf: 0n, reserves: 0n, reportUri: "" }), ATTESTOR, NOW)).toEqual({ post: true, reason: "first_post" });
    expect(decide(report, chain(), ATTESTOR, NOW)).toEqual({ post: true, reason: "newer" });
    expect(decide(report, chain({ asOf: report.asOf }), ATTESTOR, NOW)).toEqual({ post: true, reason: "correction" });
  });

  it("skips without spending a fee when the program would refuse, or nothing changed", () => {
    expect(decide(report, null, ATTESTOR, NOW).reason).toBe("no_attestation");
    expect(decide(report, chain({ attestor: MINT }), ATTESTOR, NOW).reason).toBe("not_attestor");
    expect(decide({ ...report, asOf: NOW + 1n }, chain(), ATTESTOR, NOW).reason).toBe("future_as_of");
    expect(decide({ ...report, asOf: NOW - 101n }, chain(), ATTESTOR, NOW).reason).toBe("older_than_chain");
    expect(decide({ ...report, asOf: NOW - 100n, reserves: 400n }, chain(), ATTESTOR, NOW).reason).toBe("unchanged");
  });
});

describe("chain encoding, pinned against the sss-token IDL", () => {
  const anchorDisc = (kind: string, name: string) => [...createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8)];

  it("discriminators", () => {
    expect([...ATTEST_RESERVES_DISCRIMINATOR]).toEqual(idl.instructions.find((i: any) => i.name === "attest_reserves").discriminator);
    expect([...ATTEST_RESERVES_DISCRIMINATOR]).toEqual(anchorDisc("global", "attest_reserves"));
    expect([...RESERVE_ATTESTATION_DISCRIMINATOR]).toEqual(idl.accounts.find((a: any) => a.name === "ReserveAttestation").discriminator);
    expect([...RESERVE_ATTESTATION_DISCRIMINATOR]).toEqual(anchorDisc("account", "ReserveAttestation"));
  });

  it("account order and args follow the IDL", async () => {
    const ixIdl = idl.instructions.find((i: any) => i.name === "attest_reserves");
    expect(ixIdl.accounts.map((a: any) => [a.name, !!a.signer, !!a.writable])).toEqual([
      ["attestor", true, false],
      ["reserve_attestation", false, true],
    ]);
    expect(ixIdl.args).toEqual([
      { name: "reserves", type: "u64" },
      { name: "as_of", type: "i64" },
      { name: "report_uri", type: "string" },
    ]);
    const signer = await generateKeyPairSigner();
    const pda = await reservePda(MINT);
    const ix = attestReservesInstruction({ attestor: signer, reserveAttestation: pda, reserves: 7n, asOf: NOW, reportUri: "ab" });
    const data = Buffer.from(ix.data!);
    expect(data.length).toBe(8 + 8 + 8 + 4 + 2);
    expect(data.readBigUInt64LE(8)).toBe(7n);
    expect(data.readBigInt64LE(16)).toBe(NOW);
    expect(data.readUInt32LE(24)).toBe(2);
    expect(ix.accounts!.map((a) => a.address)).toEqual([signer.address, pda]);
  });

  it("the PDA uses the IDL's seed", async () => {
    const seed = Buffer.from(idl.instructions.find((i: any) => i.name === "mint_tokens").accounts.find((a: any) => a.name === "reserve_attestation").pda.seeds[0].value);
    const [expected] = await getProgramDerivedAddress({ programAddress: SSS_TOKEN_ID, seeds: [seed, getAddressEncoder().encode(MINT)] });
    expect(await reservePda(MINT)).toBe(expected);
  });

  it("decodes the account layout (373 bytes, uri in the middle)", async () => {
    const enc = getAddressEncoder();
    const uri = Buffer.from("https://example.com/r.json");
    const data = Buffer.alloc(373);
    data.set(RESERVE_ATTESTATION_DISCRIMINATOR, 0);
    data.set(enc.encode(MINT), 8);
    data.set(enc.encode(ATTESTOR), 40);
    data.writeBigUInt64LE(1_000n, 72);
    data.writeBigInt64LE(NOW - 5n, 80);
    data.writeBigInt64LE(86_400n, 88);
    data.writeUInt32LE(uri.length, 96);
    uri.copy(data, 100);
    data.writeBigInt64LE(NOW, 100 + uri.length);
    expect(decodeReserveAttestation(new Uint8Array(data))).toEqual({
      mint: MINT,
      attestor: ATTESTOR,
      reserves: 1_000n,
      asOf: NOW - 5n,
      maxStaleness: 86_400n,
      reportUri: uri.toString(),
      postedAt: NOW,
    });
    data[0] ^= 1;
    expect(decodeReserveAttestation(new Uint8Array(data))).toBeNull();
  });
});

describe("masking", () => {
  it("never prints the RPC URL or an api-key", () => {
    const url = "https://devnet.helius-rpc.com/?api-key=0123456789abcdef";
    const mask = masker([url]);
    expect(mask(`error at ${url}`)).toBe("error at <RPC>");
    expect(mask("https://x/?api-key=secret123")).toBe("https://x/?api-key=<RPC>");
  });
});
