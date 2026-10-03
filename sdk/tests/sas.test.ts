// Pins the SDK's hand-built SAS instructions byte-for-byte against sas-lib 1.0.10 (a devDependency, kit-based).
import { address, createNoopSigner } from "@solana/kit";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
    deriveAttestationPda,
    deriveCredentialPda,
    deriveEventAuthorityAddress,
    deriveSchemaPda,
    getCloseAttestationInstruction,
    getCreateAttestationInstruction,
    getCreateCredentialInstruction,
    getCreateSchemaInstruction,
    serializeAttestationData,
} from "sas-lib";
import { describe, expect, it } from "vitest";
import {
    KYC_SCHEMA,
    SAS_EVENT_AUTHORITY,
    closeAttestationIx,
    createAttestationIx,
    createCredentialIx,
    createSchemaIx,
    encodeKycData,
    findAttestationPda,
    findCredentialPda,
    findSchemaPda,
} from "../src/sas";
import { fromKit, fromWeb3 } from "./pins";

const key = (seed: number) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) & 0xff)).publicKey;
const payer = key(1);
const authority = key(2);
const holder = key(3);
const kitAddr = (p: PublicKey) => address(p.toBase58());
const signer = (p: PublicKey) => createNoopSigner(kitAddr(p));
const NAME = "Quickstart KYC";
const SCHEMA_NAME = "thawgate-kyc";

describe("SAS PDAs", () => {
    it("match sas-lib's derivations", async () => {
        const credential = findCredentialPda(authority, NAME);
        expect(credential.toBase58()).toBe((await deriveCredentialPda({ authority: kitAddr(authority), name: NAME }))[0]);
        const schema = findSchemaPda(credential, SCHEMA_NAME);
        expect(schema.toBase58()).toBe((await deriveSchemaPda({ credential: kitAddr(credential), name: SCHEMA_NAME, version: 1 }))[0]);
        const attestation = findAttestationPda(credential, schema, holder);
        expect(attestation.toBase58()).toBe(
            (await deriveAttestationPda({ credential: kitAddr(credential), schema: kitAddr(schema), nonce: kitAddr(holder) }))[0],
        );
        expect(SAS_EVENT_AUTHORITY.toBase58()).toBe(await deriveEventAuthorityAddress());
    });

    it("refuse names longer than a PDA seed", () => {
        expect(() => findCredentialPda(authority, "x".repeat(33))).toThrow(/1-32 bytes/);
        expect(() => findSchemaPda(authority, "")).toThrow(/1-32 bytes/);
    });
});

describe("SAS instructions", () => {
    const credential = findCredentialPda(authority, NAME);
    const schema = findSchemaPda(credential, SCHEMA_NAME);

    it("create_credential", () => {
        const ours = createCredentialIx({ payer, authority, name: NAME, signers: [authority, holder] });
        expect(ours.credential.equals(credential)).toBe(true);
        const theirs = getCreateCredentialInstruction({
            payer: signer(payer),
            credential: kitAddr(credential),
            authority: signer(authority),
            name: NAME,
            signers: [kitAddr(authority), kitAddr(holder)],
        });
        expect(fromWeb3(ours.instruction)).toEqual(fromKit(theirs));
    });

    it("create_schema", () => {
        const ours = createSchemaIx({
            payer,
            authority,
            credential,
            name: SCHEMA_NAME,
            description: "KYC level and country",
            layout: [...KYC_SCHEMA.layout],
            fieldNames: [...KYC_SCHEMA.fieldNames],
        });
        expect(ours.schema.equals(schema)).toBe(true);
        const theirs = getCreateSchemaInstruction({
            payer: signer(payer),
            authority: signer(authority),
            credential: kitAddr(credential),
            schema: kitAddr(schema),
            name: SCHEMA_NAME,
            description: "KYC level and country",
            layout: Uint8Array.from(KYC_SCHEMA.layout),
            fieldNames: [...KYC_SCHEMA.fieldNames],
        });
        expect(fromWeb3(ours.instruction)).toEqual(fromKit(theirs));
    });

    it("create_attestation, with KYC data encoded like sas-lib's serializer", () => {
        const data = encodeKycData({ kycLevel: 2, country: "IN" });
        const sasSchema = {
            discriminator: 1,
            credential: kitAddr(credential),
            name: Buffer.from(SCHEMA_NAME),
            description: Buffer.from(""),
            layout: Uint8Array.from(KYC_SCHEMA.layout),
            // SAS stores field names as u32-prefixed strings, back to back.
            fieldNames: Buffer.concat(KYC_SCHEMA.fieldNames.map((f) => Buffer.concat([Buffer.from([f.length, 0, 0, 0]), Buffer.from(f)]))),
            isPaused: false,
            version: 1,
        };
        expect(Buffer.from(data).toString("hex")).toBe(Buffer.from(serializeAttestationData(sasSchema, { kyc_level: 2, country: "IN" })).toString("hex"));

        const expiry = 1_790_000_000n;
        const ours = createAttestationIx({ payer, authority, credential, schema, nonce: holder, data, expiry });
        const theirs = getCreateAttestationInstruction({
            payer: signer(payer),
            authority: signer(authority),
            credential: kitAddr(credential),
            schema: kitAddr(schema),
            attestation: kitAddr(ours.attestation),
            nonce: kitAddr(holder),
            data,
            expiry,
        });
        expect(fromWeb3(ours.instruction)).toEqual(fromKit(theirs));
    });

    it("close_attestation", () => {
        const attestation = findAttestationPda(credential, schema, holder);
        const ours = closeAttestationIx({ payer, authority, credential, attestation });
        const theirs = getCloseAttestationInstruction({
            payer: signer(payer),
            authority: signer(authority),
            credential: kitAddr(credential),
            attestation: kitAddr(attestation),
        });
        expect(fromWeb3(ours)).toEqual(fromKit(theirs));
    });

    it("encodeKycData rejects an out-of-range level", () => {
        expect(() => encodeKycData({ kycLevel: 256, country: "IN" })).toThrow(/0-255/);
    });
});
