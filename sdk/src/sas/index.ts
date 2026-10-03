/**
 * @module sas
 * @description Solana Attestation Service (SAS) instructions on @solana/web3.js v1: credentials, schemas and
 * attestations, enough to issue the KYC credential a ThawGate policy checks.
 *
 * Hand-built from sas-lib 1.0.10's generated code (sas-lib is @solana/kit-based); tests/sas.test.ts pins each builder
 * byte-for-byte against it.
 *
 * A credential you create yourself is a **self-issued test credential**: it proves the flow, not anyone's identity.
 * In production the policy names a KYC provider's credential and schema, and the provider issues attestations.
 */

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "../programs";

export const SAS_IX = { createCredential: 0, createSchema: 1, createAttestation: 6, closeAttestation: 7 } as const;

/** PDA seeds are at most 32 bytes, and SAS seeds credential and schema PDAs with the name. */
const MAX_NAME_BYTES = 32;

function nameSeed(name: string, what: string): Buffer {
    const b = Buffer.from(name, "utf8");
    if (b.length === 0 || b.length > MAX_NAME_BYTES) throw new Error(`${what} name must be 1-${MAX_NAME_BYTES} bytes of UTF-8 (got ${b.length})`);
    return b;
}

/** `["credential", authority, name]`. */
export function findCredentialPda(authority: PublicKey, name: string): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("credential"), authority.toBuffer(), nameSeed(name, "credential")], SAS_PROGRAM_ID)[0];
}

/** `["schema", credential, name, version]`. A new schema is version 1. */
export function findSchemaPda(credential: PublicKey, name: string, version = 1): PublicKey {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("schema"), credential.toBuffer(), nameSeed(name, "schema"), Buffer.from([version])],
        SAS_PROGRAM_ID,
    )[0];
}

/** `["attestation", credential, schema, nonce]`. ThawGate policies use `nonce = the holder's wallet`. */
export function findAttestationPda(credential: PublicKey, schema: PublicKey, nonce: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("attestation"), credential.toBuffer(), schema.toBuffer(), nonce.toBuffer()], SAS_PROGRAM_ID)[0];
}

/** SAS's event authority, `["__event_authority"]`: `close_attestation` emits its event through it. */
export const SAS_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], SAS_PROGRAM_ID)[0];

const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
};
const str = (s: string) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([u32(b.length), b]);
};
const bytes = (d: Uint8Array) => Buffer.concat([u32(d.length), Buffer.from(d)]);

/** A credential: `authority` and the `signers` may issue attestations under it. Returns the instruction and its PDA. */
export function createCredentialIx(args: { payer: PublicKey; authority: PublicKey; name: string; signers?: PublicKey[] }): {
    instruction: TransactionInstruction;
    credential: PublicKey;
} {
    const credential = findCredentialPda(args.authority, args.name);
    const signers = args.signers ?? [args.authority];
    const data = Buffer.concat([Buffer.from([SAS_IX.createCredential]), str(args.name), u32(signers.length), ...signers.map((s) => s.toBuffer())]);
    const instruction = new TransactionInstruction({
        programId: SAS_PROGRAM_ID,
        keys: [
            { pubkey: args.payer, isSigner: true, isWritable: true },
            { pubkey: credential, isSigner: false, isWritable: true },
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
    return { instruction, credential };
}

/** A schema under a credential. `layout` holds SAS compact type codes (0 = u8, 12 = String, …), one per field. */
export function createSchemaIx(args: {
    payer: PublicKey;
    authority: PublicKey;
    credential: PublicKey;
    name: string;
    description: string;
    layout: number[];
    fieldNames: string[];
}): { instruction: TransactionInstruction; schema: PublicKey } {
    if (args.layout.length !== args.fieldNames.length) throw new Error("schema layout and fieldNames must have the same length");
    const schema = findSchemaPda(args.credential, args.name);
    const data = Buffer.concat([
        Buffer.from([SAS_IX.createSchema]),
        str(args.name),
        str(args.description),
        bytes(Uint8Array.from(args.layout)),
        u32(args.fieldNames.length),
        ...args.fieldNames.map(str),
    ]);
    const instruction = new TransactionInstruction({
        programId: SAS_PROGRAM_ID,
        keys: [
            { pubkey: args.payer, isSigner: true, isWritable: true },
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: args.credential, isSigner: false, isWritable: false },
            { pubkey: schema, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
    return { instruction, schema };
}

/**
 * An attestation of `data` (encoded to the schema's layout) for `nonce`. `expiry` is a unix timestamp; 0 = never.
 * `authority` must be one of the credential's signers.
 */
export function createAttestationIx(args: {
    payer: PublicKey;
    authority: PublicKey;
    credential: PublicKey;
    schema: PublicKey;
    nonce: PublicKey;
    data: Uint8Array;
    expiry: number | bigint;
}): { instruction: TransactionInstruction; attestation: PublicKey } {
    const attestation = findAttestationPda(args.credential, args.schema, args.nonce);
    const expiry = Buffer.alloc(8);
    expiry.writeBigInt64LE(BigInt(args.expiry));
    const data = Buffer.concat([Buffer.from([SAS_IX.createAttestation]), args.nonce.toBuffer(), bytes(args.data), expiry]);
    const instruction = new TransactionInstruction({
        programId: SAS_PROGRAM_ID,
        keys: [
            { pubkey: args.payer, isSigner: true, isWritable: true },
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: args.credential, isSigner: false, isWritable: false },
            { pubkey: args.schema, isSigner: false, isWritable: false },
            { pubkey: attestation, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
    return { instruction, attestation };
}

/** Close (revoke) an attestation; the rent goes to `payer`. Under a ThawGate SAS policy the holder becomes freezable. */
export function closeAttestationIx(args: { payer: PublicKey; authority: PublicKey; credential: PublicKey; attestation: PublicKey }): TransactionInstruction {
    return new TransactionInstruction({
        programId: SAS_PROGRAM_ID,
        keys: [
            { pubkey: args.payer, isSigner: true, isWritable: true },
            { pubkey: args.authority, isSigner: true, isWritable: false },
            { pubkey: args.credential, isSigner: false, isWritable: false },
            { pubkey: args.attestation, isSigner: false, isWritable: true },
            { pubkey: SAS_EVENT_AUTHORITY, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: SAS_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([SAS_IX.closeAttestation]),
    });
}

/**
 * The KYC schema layout ThawGate reads: `kyc_level: u8` must come first (the gate reads it at a fixed offset when the
 * policy sets `min_kyc_level`), then `country: String`.
 */
export const KYC_SCHEMA = {
    layout: [0, 12],
    fieldNames: ["kyc_level", "country"],
} as const;

/** Attestation data for {@link KYC_SCHEMA}: u8 kyc_level, then u32-length-prefixed UTF-8 country. */
export function encodeKycData(args: { kycLevel: number; country: string }): Uint8Array {
    if (!Number.isInteger(args.kycLevel) || args.kycLevel < 0 || args.kycLevel > 255) throw new Error("kycLevel must be 0-255");
    return Buffer.concat([Buffer.from([args.kycLevel]), str(args.country)]);
}
