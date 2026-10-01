/**
 * The gate's freeze rule, mirrored from programs/thawgate-gate/src/{instructions/gate.rs,decision.rs,sas.rs} so the
 * keeper knows which holders to try. It only picks candidates: every freeze is still simulated against the real gate
 * (preflight), and the gate's own log decides the outcome. test/policy.test.ts ports decision.rs's test table.
 *
 * Freeze passes only when a policy flags the owner, in precedence order: active blacklist entry; AllowOnly without an
 * active allowlist entry; SAS credential missing (never issued or closed), expired, or below `min_kyc_level`.
 * BypassForPdas: an off-curve owner with an active allowlist entry skips SAS. A malformed registry entry or
 * attestation denies both thaw and freeze (BAD_REGISTRY_ENTRY / BAD_CREDENTIAL), so it is never a candidate.
 */
import { AttestationRead, EntryRead, GatePolicy } from "./accounts";

export type FreezeReason = "BLACKLISTED" | "NOT_ALLOWLISTED" | "NO_CREDENTIAL" | "CREDENTIAL_EXPIRED" | "KYC_LEVEL_TOO_LOW";

/** What the gate would read for one owner. `undefined` = not read yet (never a candidate until it is). */
export interface OwnerReads {
  blacklist?: EntryRead;
  allowlist?: EntryRead;
  attestation?: AttestationRead;
  ownerOffCurve: boolean;
}

export type Credential = "missing" | "expired" | "levelTooLow" | "valid" | "bad";

/** sas.rs `parse_attestation` after the identity checks: expired when `expiry != 0 && expiry < now` (SAS's own rule). */
export function credentialState(read: AttestationRead, minKycLevel: number, now: bigint): Credential {
  if (read.kind !== "present") return read.kind;
  if (read.expiry !== 0n && read.expiry < now) return "expired";
  if (minKycLevel > 0) {
    if (read.firstByte === undefined) return "bad";
    if (read.firstByte < minKycLevel) return "levelTooLow";
  }
  return "valid";
}

/** The `TG:ALLOW:<reason>` the gate would log for a freeze of this owner now, or null if it would deny it. */
export function freezeReason(policy: GatePolicy, reads: OwnerReads, now: bigint): FreezeReason | null {
  const blacklist = policy.checkBlacklist ? reads.blacklist : "none";
  const allowlist = policy.allowlistMode !== "off" ? reads.allowlist : "none";
  if (blacklist === undefined || allowlist === undefined) return null;
  if (blacklist === "bad" || allowlist === "bad") return null;

  let credential: Credential | "notRequired" | "bypassed" = "notRequired";
  if (policy.requireSas) {
    if (policy.allowlistMode === "bypassForPdas" && allowlist === "active" && reads.ownerOffCurve) {
      credential = "bypassed";
    } else {
      if (reads.attestation === undefined) return null;
      credential = credentialState(reads.attestation, policy.minKycLevel, now);
      if (credential === "bad") return null;
    }
  }

  if (blacklist === "active") return "BLACKLISTED";
  if (policy.allowlistMode === "allowOnly" && allowlist !== "active") return "NOT_ALLOWLISTED";
  if (credential === "missing") return "NO_CREDENTIAL";
  if (credential === "expired") return "CREDENTIAL_EXPIRED";
  if (credential === "levelTooLow") return "KYC_LEVEL_TOO_LOW";
  return null;
}
