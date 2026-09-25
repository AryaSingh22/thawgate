/**
 * Deterministic test keys and the genesis fixtures (issuer registry entries, one malformed SAS attestation),
 * shared by tests/gate/registry-fixtures.ts (which writes the accounts before the validator starts) and the tests.
 * Every key comes from a name, so both sides derive the same mints and wallets without any key files.
 */
import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";

export const GATE_ID = new PublicKey("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");
export const TOKEN_ACL_ID = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
/** The issuer program whose registry the gate reads (sss-token). Not deployed in these tests: only its accounts. */
export const SSS_TOKEN_ID = new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
/** Solana Attestation Service, loaded from tests/fixtures/sas.so. */
export const SAS_ID = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/** Test keypair for `name`: ed25519 seed = sha256("thawgate-gate-test:<name>"). */
export const keypair = (name: string) => Keypair.fromSeed(createHash("sha256").update(`thawgate-gate-test:${name}`).digest());
export const key = (name: string) => keypair(name).publicKey;
/** An off-curve owner for `name`, like a DEX pool PDA (a Whirlpool owns its vaults). */
export const offCurveKey = (name: string) => PublicKey.findProgramAddressSync([Buffer.from(name)], key("pool-program"))[0];

export type RegistryKind = "blacklist" | "allowlist";

/** sss-token registry PDA: `[kind, mint, wallet]` under sss-token. */
export const registryPda = (kind: RegistryKind, mint: PublicKey, wallet: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(kind), mint.toBuffer(), wallet.toBuffer()], SSS_TOKEN_ID);

export type RegistryEntry = { kind: RegistryKind; mint: string; wallet: string; active: boolean; offCurve?: boolean };
export const walletKey = (entry: { wallet: string; offCurve?: boolean }) =>
  entry.offCurve ? offCurveKey(entry.wallet) : key(entry.wallet);

/**
 * Registry entries injected at validator genesis, in sss-token's real account layout. sss-token cannot write
 * entries for a Token ACL mint until S6 (its mints keep the config PDA as freeze authority), so S4 injects them.
 */
export const REGISTRY: RegistryEntry[] = [
  { kind: "blacklist", mint: "bl-mint", wallet: "blacklisted", active: true },
  { kind: "blacklist", mint: "bl-mint", wallet: "unblocked", active: false },
  { kind: "blacklist", mint: "toggle-mint", wallet: "blacklisted", active: true },
  { kind: "allowlist", mint: "al-mint", wallet: "allowlisted", active: true },
  // S5 BypassForPdas: two pool PDAs (one active entry, one deactivated) and an allowlisted on-curve wallet.
  { kind: "allowlist", mint: "pda-mint", wallet: "pool-a", offCurve: true, active: true },
  { kind: "allowlist", mint: "pda-mint", wallet: "pool-b", offCurve: true, active: false },
  { kind: "allowlist", mint: "pda-mint", wallet: "allowlisted-wallet", active: true },
];

// ---------------------------------------------------------------------------------------------
// SAS: the S3 demo credential and schema (SPIKES.md S3), issued here by a test key
// ---------------------------------------------------------------------------------------------
export const SAS_ISSUER = "sas-issuer";
export const SAS_CREDENTIAL_NAME = "ThawGate Demo KYC";
export const SAS_SCHEMA_NAME = "thawgate-demo-kyc";
export const SAS_SCHEMA_VERSION = 1;
/** SAS compact layout codes: 0 = u8, 12 = String. kyc_level first, at the fixed offset the gate reads. */
export const SAS_SCHEMA_LAYOUT = [0, 12];
export const SAS_SCHEMA_FIELDS = ["kyc_level", "country"];

/** SAS PDAs (seeds as in sas-lib's derive*Pda; the suite cross-checks them against sas-lib). */
export const sasCredentialPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("credential"), key(SAS_ISSUER).toBuffer(), Buffer.from(SAS_CREDENTIAL_NAME)], SAS_ID)[0];
export const sasSchemaPda = () =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("schema"), sasCredentialPda().toBuffer(), Buffer.from(SAS_SCHEMA_NAME), Buffer.from([SAS_SCHEMA_VERSION])],
    SAS_ID,
  )[0];
/** The holder's attestation: nonce = the holder wallet. */
export const attestationPda = (wallet: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), sasCredentialPda().toBuffer(), sasSchemaPda().toBuffer(), wallet.toBuffer()],
    SAS_ID,
  )[0];

/**
 * A malformed attestation injected at genesis at the address Token ACL enforces for `wallet`: owned by SAS, in
 * SAS's layout, but naming another credential. The real SAS program never writes such an account there (the
 * address derives from the credential); it exercises the gate's field checks end to end.
 */
export const FORGED_ATTESTATION = { wallet: "forged", credential: "other-credential" };
