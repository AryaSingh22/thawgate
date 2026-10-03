/** The gate's freeze rule (programs/thawgate-gate/src/decision.rs and sas.rs tests), as the keeper mirrors it. */
import { describe, expect, it } from "vitest";
import { address } from "@solana/kit";
import { AllowlistMode, AttestationRead, EntryRead, GatePolicy } from "../src/accounts";
import { credentialState, freezeReason, OwnerReads, ownerVerdict, verdictReason } from "../src/policy";

const K = address("11111111111111111111111111111111");
const policy = (p: Partial<GatePolicy> = {}): GatePolicy => ({
  mint: K,
  authority: K,
  issuerProgram: K,
  checkBlacklist: false,
  allowlistMode: "off",
  requireSas: false,
  sasCredential: K,
  sasSchema: K,
  minKycLevel: 0,
  ...p,
});
const NOW = 1_000_000n;
const valid: AttestationRead = { kind: "present", expiry: NOW + 100n, dataLen: 7, firstByte: 2 };
const expired: AttestationRead = { kind: "present", expiry: NOW - 1n, dataLen: 7, firstByte: 2 };
const missing: AttestationRead = { kind: "missing" };
const reads = (r: Partial<OwnerReads> = {}): OwnerReads => ({ ownerOffCurve: false, blacklist: "none", allowlist: "none", ...r });
const registry = (blacklist: EntryRead, allowlist: EntryRead, mode: AllowlistMode) =>
  freezeReason(policy({ checkBlacklist: true, allowlistMode: mode }), reads({ blacklist, allowlist }), NOW);

describe("freeze rule (decision.rs)", () => {
  it("a clean owner cannot be frozen", () => {
    expect(freezeReason(policy(), reads(), NOW)).toBeNull();
    expect(registry("none", "none", "off")).toBeNull();
    expect(registry("inactive", "none", "off")).toBeNull();
  });

  it("a blacklisted owner is freezable, before an allowlist entry", () => {
    expect(registry("active", "none", "off")).toBe("BLACKLISTED");
    expect(registry("active", "active", "allowOnly")).toBe("BLACKLISTED");
  });

  it("AllowOnly needs an active entry", () => {
    expect(registry("none", "active", "allowOnly")).toBeNull();
    expect(registry("none", "none", "allowOnly")).toBe("NOT_ALLOWLISTED");
    expect(registry("none", "inactive", "allowOnly")).toBe("NOT_ALLOWLISTED");
  });

  it("a valid credential cannot be frozen", () => {
    const sas = policy({ requireSas: true, minKycLevel: 1 });
    expect(freezeReason(sas, reads({ attestation: valid }), NOW)).toBeNull();
    expect(freezeReason({ ...sas, allowlistMode: "allowOnly" }, reads({ attestation: valid, allowlist: "active" }), NOW)).toBeNull();
    expect(freezeReason({ ...sas, allowlistMode: "bypassForPdas" }, reads({ attestation: valid }), NOW)).toBeNull();
  });

  it("missing, expired and below-minimum credentials are freezable, even with an allowlist entry", () => {
    const sas = policy({ requireSas: true, minKycLevel: 3 });
    expect(freezeReason(sas, reads({ attestation: missing }), NOW)).toBe("NO_CREDENTIAL");
    expect(freezeReason(sas, reads({ attestation: expired }), NOW)).toBe("CREDENTIAL_EXPIRED");
    expect(freezeReason(sas, reads({ attestation: valid }), NOW)).toBe("KYC_LEVEL_TOO_LOW");
    const allowOnly = { ...sas, allowlistMode: "allowOnly" as const };
    expect(freezeReason(allowOnly, reads({ attestation: missing, allowlist: "active" }), NOW)).toBe("NO_CREDENTIAL");
  });

  it("earlier policies take precedence over the credential", () => {
    const sas = policy({ requireSas: true, checkBlacklist: true });
    expect(freezeReason(sas, reads({ attestation: missing, blacklist: "active" }), NOW)).toBe("BLACKLISTED");
    expect(freezeReason({ ...sas, allowlistMode: "allowOnly" }, reads({ attestation: missing, allowlist: "inactive" }), NOW)).toBe("NOT_ALLOWLISTED");
  });

  it("BypassForPdas: an allowlisted off-curve owner skips SAS, unless blacklisted", () => {
    const bypass = policy({ requireSas: true, checkBlacklist: true, allowlistMode: "bypassForPdas" });
    expect(freezeReason(bypass, reads({ ownerOffCurve: true, allowlist: "active" }), NOW)).toBeNull();
    expect(freezeReason(bypass, reads({ ownerOffCurve: true, allowlist: "active", blacklist: "active" }), NOW)).toBe("BLACKLISTED");
    // An on-curve wallet with an entry, or a PDA without one, still needs the credential.
    expect(freezeReason(bypass, reads({ ownerOffCurve: false, allowlist: "active", attestation: missing }), NOW)).toBe("NO_CREDENTIAL");
    expect(freezeReason(bypass, reads({ ownerOffCurve: true, allowlist: "inactive", attestation: missing }), NOW)).toBe("NO_CREDENTIAL");
  });

  it("malformed accounts are never candidates (the gate denies both ways)", () => {
    expect(registry("bad", "none", "off")).toBeNull();
    const sas = policy({ requireSas: true, checkBlacklist: true });
    expect(freezeReason(sas, reads({ attestation: { kind: "bad" }, blacklist: "active" }), NOW)).toBeNull();
  });

  it("an owner not read yet is never a candidate", () => {
    expect(freezeReason(policy({ requireSas: true }), reads(), NOW)).toBeNull();
    expect(freezeReason(policy({ checkBlacklist: true }), { ownerOffCurve: false }, NOW)).toBeNull();
  });
});

describe("credential state (sas.rs)", () => {
  const at = (expiry: bigint, firstByte: number | undefined): AttestationRead => ({ kind: "present", expiry, dataLen: firstByte === undefined ? 0 : 7, firstByte });
  it("follows the SAS program's expiry rule: live in the expiry second, 0 never expires", () => {
    expect(credentialState(at(NOW, 2), 0, NOW)).toBe("valid");
    expect(credentialState(at(NOW - 1n, 2), 0, NOW)).toBe("expired");
    expect(credentialState(at(0n, 2), 0, 1n << 62n)).toBe("valid");
  });
  it("compares min_kyc_level with the first data byte", () => {
    expect(credentialState(at(NOW + 1n, 2), 2, NOW)).toBe("valid");
    expect(credentialState(at(NOW + 1n, 2), 3, NOW)).toBe("levelTooLow");
    expect(credentialState(at(NOW - 1n, 2), 3, NOW)).toBe("expired"); // expired whatever the level
    expect(credentialState(at(NOW + 1n, undefined), 0, NOW)).toBe("valid");
    expect(credentialState(at(NOW + 1n, undefined), 1, NOW)).toBe("bad");
  });
});

describe("ownerVerdict (GET /mints/:mint)", () => {
  const sas = policy({ checkBlacklist: true, requireSas: true, minKycLevel: 1 });

  it("names the code the gate's thaw would log for a compliant owner", () => {
    expect(ownerVerdict(sas, reads({ attestation: valid }), NOW)).toBe("compliant:KYC");
    expect(ownerVerdict(policy(), reads(), NOW)).toBe("compliant:CLEAN");
    expect(ownerVerdict(policy({ allowlistMode: "allowOnly" }), reads({ allowlist: "active" }), NOW)).toBe("compliant:ALLOWLISTED");
    const bypass = policy({ requireSas: true, allowlistMode: "bypassForPdas" });
    expect(ownerVerdict(bypass, reads({ allowlist: "active", ownerOffCurve: true, attestation: missing }), NOW)).toBe("compliant:PDA_ALLOWLISTED");
  });

  it("freezable:<reason> exactly when freezeReason flags the owner", () => {
    expect(ownerVerdict(sas, reads({ attestation: missing }), NOW)).toBe("freezable:NO_CREDENTIAL");
    expect(ownerVerdict(sas, reads({ attestation: expired }), NOW)).toBe("freezable:CREDENTIAL_EXPIRED");
    expect(ownerVerdict(sas, reads({ blacklist: "active", attestation: valid }), NOW)).toBe("freezable:BLACKLISTED");
  });

  it("unknown until every read and the cluster clock are in", () => {
    expect(ownerVerdict(sas, reads({ attestation: valid }), undefined)).toBe("unknown");
    expect(ownerVerdict(sas, reads({ attestation: undefined }), NOW)).toBe("unknown");
    expect(ownerVerdict(sas, reads({ blacklist: undefined, attestation: valid }), NOW)).toBe("unknown");
    expect(ownerVerdict(sas, reads({ attestation: { kind: "bad" } }), NOW)).toBe("unknown");
  });
});

describe("verdictReason (the SDK's sentences, shared with explain())", () => {
  it("reads each kind of verdict", () => {
    expect(verdictReason("freezable:NO_CREDENTIAL")).toMatch(/^Freezable by anyone: the owner has no SAS attestation/);
    expect(verdictReason("compliant:KYC")).toMatch(/^Unlock allowed: the owner holds a live SAS attestation/);
    expect(verdictReason("unknown")).toMatch(/^Not judged yet/);
  });
});
