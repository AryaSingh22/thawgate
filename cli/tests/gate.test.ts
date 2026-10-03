import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { policyFromFlags } from "../src/gate";

const CRED = new PublicKey("4auu6tNqd6pDsYx4yYfVc4VHXdyENhwMiXh5bP5gE2Kp");
const SCHEMA = new PublicKey("AUPc2FiAYMe6jcXBvoyRuckypNq8gNAGftKPoacbLsRv");
const stored = { requireSas: true, sasCredential: CRED, sasSchema: SCHEMA, minKycLevel: 1 };

describe("policyFromFlags", () => {
    it("leaves every field unset when no flag is given (policy update changes nothing else)", () => {
        expect(policyFromFlags({})).toEqual({});
        expect(policyFromFlags({ sas: true })).toEqual({}); // commander's default for --no-sas
    });

    it("reads --blacklist and --allowlist", () => {
        expect(policyFromFlags({ blacklist: "on", allowlist: "allowOnly" })).toEqual({ checkBlacklist: true, allowlistMode: "allowOnly" });
        expect(policyFromFlags({ blacklist: "off" })).toEqual({ checkBlacklist: false });
        expect(() => policyFromFlags({ blacklist: "yes" })).toThrow(/on or off/);
        expect(() => policyFromFlags({ allowlist: "allow" })).toThrow(/off, allowOnly, bypassForPdas/);
    });

    it("needs both SAS keys for a new SAS policy", () => {
        const p = policyFromFlags({ sasCredential: CRED.toBase58(), sasSchema: SCHEMA.toBase58(), minKyc: "2" });
        expect(p.sas?.credential.equals(CRED) && p.sas?.schema.equals(SCHEMA)).toBe(true);
        expect(p.sas?.minKycLevel).toBe(2);
        expect(() => policyFromFlags({ sasCredential: CRED.toBase58() })).toThrow(/both --sas-credential and --sas-schema/);
        expect(() => policyFromFlags({ minKyc: "1" })).toThrow(/both/);
    });

    it("--min-kyc alone keeps the stored credential and schema", () => {
        const p = policyFromFlags({ minKyc: "3" }, stored);
        expect(p.sas?.credential.equals(CRED) && p.sas?.schema.equals(SCHEMA)).toBe(true);
        expect(p.sas?.minKycLevel).toBe(3);
        expect(() => policyFromFlags({ minKyc: "256" }, stored)).toThrow(/0-255/);
    });

    it("--no-sas turns SAS off and can't be mixed with SAS flags", () => {
        expect(policyFromFlags({ sas: false })).toEqual({ sas: null });
        expect(() => policyFromFlags({ sas: false, minKyc: "1" }, stored)).toThrow(/can't be combined/);
    });
});
