/**
 * Deterministic test keys and the issuer-registry fixtures, shared by tests/gate/registry-fixtures.ts (which
 * writes the accounts before the validator starts) and the tests. Every key comes from a name, so both sides
 * derive the same mints and wallets without any key files.
 */
import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";

export const GATE_ID = new PublicKey("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");
export const TOKEN_ACL_ID = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
/** The issuer program whose registry the gate reads (sss-token). Not deployed in these tests: only its accounts. */
export const SSS_TOKEN_ID = new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");

/** Test keypair for `name`: ed25519 seed = sha256("thawgate-gate-test:<name>"). */
export const keypair = (name: string) => Keypair.fromSeed(createHash("sha256").update(`thawgate-gate-test:${name}`).digest());
export const key = (name: string) => keypair(name).publicKey;

export type RegistryKind = "blacklist" | "allowlist";

/** sss-token registry PDA: `[kind, mint, wallet]` under sss-token. */
export const registryPda = (kind: RegistryKind, mint: PublicKey, wallet: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(kind), mint.toBuffer(), wallet.toBuffer()], SSS_TOKEN_ID);

/**
 * Registry entries injected at validator genesis, in sss-token's real account layout. sss-token cannot write
 * entries for a Token ACL mint until S6 (its mints keep the config PDA as freeze authority), so S4 injects them.
 */
export const REGISTRY: { kind: RegistryKind; mint: string; wallet: string; active: boolean }[] = [
  { kind: "blacklist", mint: "bl-mint", wallet: "blacklisted", active: true },
  { kind: "blacklist", mint: "bl-mint", wallet: "unblocked", active: false },
  { kind: "blacklist", mint: "toggle-mint", wallet: "blacklisted", active: true },
  { kind: "allowlist", mint: "al-mint", wallet: "allowlisted", active: true },
];
