/**
 * @module programs
 * @description Program IDs the SDK talks to. ThawGate's own programs are deployed on devnet (localnet uses the same
 * IDs); Token ACL, SAS and the ABL gate are the upstream deployments, the same address on devnet and mainnet.
 */

import { PublicKey } from "@solana/web3.js";

/** sss-token, the example issuer (devnet). */
export const SSS_TOKEN_PROGRAM_ID = new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
/** The SSS transfer hook (devnet). Used by SSS-2 and Both mints only. */
export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv");
/** The ThawGate gating program (devnet; unaudited, never deployed to mainnet). */
export const THAWGATE_GATE_PROGRAM_ID = new PublicKey("THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ");
/** Token ACL (sRFC 37). */
export const TOKEN_ACL_PROGRAM_ID = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
/** Solana Attestation Service. */
export const SAS_PROGRAM_ID = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
/** Token ACL's reference allow/block-list gate (ABL). */
export const ABL_GATE_PROGRAM_ID = new PublicKey("GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz");
