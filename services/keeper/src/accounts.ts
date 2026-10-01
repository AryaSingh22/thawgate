/**
 * Program IDs, PDAs and decoders for every account and event the keeper reads. The layouts are vendored from the
 * programs in this repo (no Anchor client, no IDL at runtime) and pinned by test/accounts.test.ts:
 *   GatePolicy          programs/thawgate-gate/src/state.rs
 *   MintConfig          programs/thawgate-gate/src/token_acl.rs (Token ACL program/src/state.rs)
 *   SAS attestation     programs/thawgate-gate/src/sas.rs
 *   registry entries    programs/thawgate-gate/src/registry.rs (sss-token BlacklistEntry / AllowlistEntry)
 *   events              programs/sss-token/src/instructions/{compliance,allowlist}.rs
 */
import {
  Address,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  isOffCurveAddress,
} from "@solana/kit";

export const GATE_ID = address("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");
export const TOKEN_ACL_ID = address("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
export const SAS_ID = address("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
export const TOKEN_2022_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");
export const COMPUTE_BUDGET_ID = address("ComputeBudget111111111111111111111111111111");

/** Anchor discriminators: sha256("account:<Name>") / sha256("event:<Name>"), first 8 bytes. */
export const GATE_POLICY_DISCRIMINATOR = Uint8Array.from([3, 77, 45, 55, 30, 166, 143, 147]);
export const BLACKLIST_ENTRY_DISCRIMINATOR = Uint8Array.from([218, 179, 231, 40, 141, 25, 168, 189]);
export const ALLOWLIST_ENTRY_DISCRIMINATOR = Uint8Array.from([42, 59, 88, 1, 124, 138, 92, 236]);
export const ADDED_TO_BLACKLIST_DISCRIMINATOR = Uint8Array.from([3, 196, 78, 136, 111, 197, 188, 114]);
export const ALLOWLIST_REMOVED_DISCRIMINATOR = Uint8Array.from([47, 69, 78, 173, 196, 109, 163, 172]);

const encodeAddress = getAddressEncoder();
const decodeAddress = getAddressDecoder();
const keyAt = (data: Uint8Array, at: number): Address => decodeAddress.decode(data.subarray(at, at + 32));
const startsWith = (data: Uint8Array, prefix: Uint8Array) => data.length >= prefix.length && prefix.every((b, i) => data[i] === b);
export const base58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
export const isOffCurve = (key: Address) => isOffCurveAddress(key);

// ---------------------------------------------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------------------------------------------
const text = (s: string) => new TextEncoder().encode(s);
async function pda(program: Address, seeds: (string | Address)[]): Promise<Address> {
  const bytes = seeds.map((s, i) => (i === 0 ? text(s as string) : encodeAddress.encode(s as Address)));
  return (await getProgramDerivedAddress({ programAddress: program, seeds: bytes }))[0];
}
export const policyPda = (mint: Address) => pda(GATE_ID, ["policy", mint]);
export const mintConfigPda = (mint: Address) => pda(TOKEN_ACL_ID, ["MINT_CONFIG", mint]);
export const freezeExtraMetasPda = (mint: Address, gate: Address = GATE_ID) => pda(gate, ["freeze_extra_account_metas", mint]);
export const attestationPda = (credential: Address, schema: Address, owner: Address) =>
  pda(SAS_ID, ["attestation", credential, schema, owner]);
export const blacklistPda = (issuer: Address, mint: Address, wallet: Address) => pda(issuer, ["blacklist", mint, wallet]);
export const allowlistPda = (issuer: Address, mint: Address, wallet: Address) => pda(issuer, ["allowlist", mint, wallet]);

// ---------------------------------------------------------------------------------------------------------------
// GatePolicy (238 bytes)
// [0..8] disc | [8] version | [9] bump | [10..42] mint | [42..74] authority | [74..106] issuer_program |
// [106] check_blacklist | [107] allowlist_mode | [108] require_sas | [109..141] sas_credential |
// [141..173] sas_schema | [173] min_kyc_level | [174..238] reserved
// ---------------------------------------------------------------------------------------------------------------
export const GATE_POLICY_LEN = 238;
export type AllowlistMode = "off" | "allowOnly" | "bypassForPdas";
const ALLOWLIST_MODES: AllowlistMode[] = ["off", "allowOnly", "bypassForPdas"];

export interface GatePolicy {
  mint: Address;
  authority: Address;
  issuerProgram: Address;
  checkBlacklist: boolean;
  allowlistMode: AllowlistMode;
  requireSas: boolean;
  sasCredential: Address;
  sasSchema: Address;
  minKycLevel: number;
}

export function decodeGatePolicy(data: Uint8Array): GatePolicy | null {
  if (data.length !== GATE_POLICY_LEN || !startsWith(data, GATE_POLICY_DISCRIMINATOR)) return null;
  const mode = ALLOWLIST_MODES[data[107]];
  if (!mode) return null;
  return {
    mint: keyAt(data, 10),
    authority: keyAt(data, 42),
    issuerProgram: keyAt(data, 74),
    checkBlacklist: data[106] === 1,
    allowlistMode: mode,
    requireSas: data[108] === 1,
    sasCredential: keyAt(data, 109),
    sasSchema: keyAt(data, 141),
    minKycLevel: data[173],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Token ACL MintConfig (100 bytes)
// [0] disc = 1 | [1] bump | [2] thaw enabled | [3] freeze enabled | [4..36] mint | [36..68] freeze_authority |
// [68..100] gating_program
// ---------------------------------------------------------------------------------------------------------------
export interface MintConfig {
  mint: Address;
  freezeAuthority: Address;
  gatingProgram: Address;
  permissionlessThaw: boolean;
  permissionlessFreeze: boolean;
}

export function decodeMintConfig(data: Uint8Array): MintConfig | null {
  if (data.length !== 100 || data[0] !== 1) return null;
  return {
    mint: keyAt(data, 4),
    freezeAuthority: keyAt(data, 36),
    gatingProgram: keyAt(data, 68),
    permissionlessThaw: data[2] === 1,
    permissionlessFreeze: data[3] === 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Token-2022 account: [0..32] mint | [32..64] owner | [64..72] amount | ... | [108] state | [165] account type = 2
// ---------------------------------------------------------------------------------------------------------------
export type TokenState = "uninitialized" | "initialized" | "frozen";
const TOKEN_STATES: TokenState[] = ["uninitialized", "initialized", "frozen"];

export interface TokenAccount {
  mint: Address;
  owner: Address;
  amount: bigint;
  state: TokenState;
}

export function decodeTokenAccount(data: Uint8Array): TokenAccount | null {
  if (data.length < 165 || (data.length > 165 && data[165] !== 2)) return null;
  const state = TOKEN_STATES[data[108]];
  if (!state) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { mint: keyAt(data, 0), owner: keyAt(data, 32), amount: view.getBigUint64(64, true), state };
}

// ---------------------------------------------------------------------------------------------------------------
// SAS attestation: [0] disc = 2 | [1..33] nonce | [33..65] credential | [65..97] schema | [97..101] data len n |
// [101..101+n] data | signer (32) | expiry (i64) | token_account (32)
// ---------------------------------------------------------------------------------------------------------------
const ATT_NONCE = 1;
const ATT_CREDENTIAL = 33;
const ATT_SCHEMA = 65;
const ATT_DATA_LEN = 97;
const ATT_DATA = 101;
const ATT_SIGNER_LEN = 32;

/**
 * What the gate would read at an owner's attestation address. `bad` = an account that is not this policy's
 * attestation for this owner: the gate denies thaw and freeze then (`TG:DENY:BAD_CREDENTIAL`).
 */
export type AttestationRead =
  | { kind: "missing" }
  | { kind: "bad" }
  | { kind: "present"; expiry: bigint; dataLen: number; firstByte: number | undefined };

export function readAttestation(
  account: { owner: Address; data: Uint8Array } | null,
  credential: Address,
  schema: Address,
  holder: Address,
): AttestationRead {
  if (!account || account.data.length === 0) return { kind: "missing" };
  const data = account.data;
  if (account.owner !== SAS_ID || data.length < ATT_DATA || data[0] !== 2) return { kind: "bad" };
  if (keyAt(data, ATT_NONCE) !== holder || keyAt(data, ATT_CREDENTIAL) !== credential || keyAt(data, ATT_SCHEMA) !== schema) {
    return { kind: "bad" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataLen = view.getUint32(ATT_DATA_LEN, true);
  const expiryAt = ATT_DATA + dataLen + ATT_SIGNER_LEN;
  if (data.length < expiryAt + 8) return { kind: "bad" };
  return { kind: "present", expiry: view.getBigInt64(expiryAt, true), dataLen, firstByte: dataLen >= 1 ? data[ATT_DATA] : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// sss-token registry entries (Anchor, Borsh)
// BlacklistEntry: disc | mint | target | reason (u32 len + bytes) | added_at i64 | added_by | active bool | bump
// AllowlistEntry: disc | mint | wallet | added_at i64 | active bool | bump
// ---------------------------------------------------------------------------------------------------------------
export type EntryRead = "none" | "inactive" | "active" | "bad";

export function readBlacklistEntry(account: { owner: Address; data: Uint8Array } | null, issuer: Address, mint: Address, wallet: Address): EntryRead {
  if (!account || account.data.length === 0) return "none";
  const data = account.data;
  if (account.owner !== issuer || !startsWith(data, BLACKLIST_ENTRY_DISCRIMINATOR) || data.length < 76) return "bad";
  if (keyAt(data, 8) !== mint || keyAt(data, 40) !== wallet) return "bad";
  const reasonLen = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(72, true);
  const activeAt = 76 + reasonLen + 8 + 32;
  if (data.length < activeAt + 2 || data[activeAt] > 1) return "bad";
  return data[activeAt] === 1 ? "active" : "inactive";
}

export function readAllowlistEntry(account: { owner: Address; data: Uint8Array } | null, issuer: Address, mint: Address, wallet: Address): EntryRead {
  if (!account || account.data.length === 0) return "none";
  const data = account.data;
  const activeAt = 8 + 32 + 32 + 8;
  if (account.owner !== issuer || !startsWith(data, ALLOWLIST_ENTRY_DISCRIMINATOR) || data.length < activeAt + 2) return "bad";
  if (keyAt(data, 8) !== mint || keyAt(data, 40) !== wallet || data[activeAt] > 1) return "bad";
  return data[activeAt] === 1 ? "active" : "inactive";
}

// ---------------------------------------------------------------------------------------------------------------
// Clock sysvar: [0..8] slot | [8..16] epoch_start_timestamp | [16..24] epoch | [24..32] leader_schedule_epoch |
// [32..40] unix_timestamp
// ---------------------------------------------------------------------------------------------------------------
export function clockUnixTimestamp(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(32, true);
}

// ---------------------------------------------------------------------------------------------------------------
// Events: an Anchor `emit!` logs "Program data: <base64(disc + borsh)>" inside the emitting program's frame.
// AddedToBlacklist { mint, target, reason, operator, timestamp }; AllowlistRemoved { mint, wallet, timestamp }.
// ---------------------------------------------------------------------------------------------------------------
export type IssuerEvent = { kind: "addedToBlacklist" | "allowlistRemoved"; mint: Address; wallet: Address };

export function decodeIssuerEvent(data: Uint8Array): IssuerEvent | null {
  if (data.length < 72) return null;
  if (startsWith(data, ADDED_TO_BLACKLIST_DISCRIMINATOR)) return { kind: "addedToBlacklist", mint: keyAt(data, 8), wallet: keyAt(data, 40) };
  if (startsWith(data, ALLOWLIST_REMOVED_DISCRIMINATOR)) return { kind: "allowlistRemoved", mint: keyAt(data, 8), wallet: keyAt(data, 40) };
  return null;
}

/** "Program data:" payloads logged inside `program`'s own frames (not its CPIs' frames). */
export function programDataLogs(logs: readonly string[], program: Address): Uint8Array[] {
  const stack: string[] = [];
  const out: Uint8Array[] = [];
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
    } else if (/^Program \S+ (success|failed)/.test(line)) {
      stack.pop();
    } else if (line.startsWith("Program data: ") && stack[stack.length - 1] === program) {
      out.push(Uint8Array.from(Buffer.from(line.slice("Program data: ".length), "base64")));
    }
  }
  return out;
}
