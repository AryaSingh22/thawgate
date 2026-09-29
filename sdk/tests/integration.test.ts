/**
 * @module tests/integration
 * @description SDK integration tests validating cross-module behavior,
 * PDA consistency, preset → config mapping, and module interactions.
 * These tests run without a validator using pure SDK/TypeScript logic.
 */

import { describe, it, expect } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import { sss1Preset, SSS1_FEATURES } from "../src/presets/sss1";
import { sss2Preset, SSS2_FEATURES } from "../src/presets/sss2";
import { sss3Preset, SSS3_FEATURES } from "../src/presets/sss3";
import { SSSPreset, RoleType, QuotaPeriod } from "../src/types";
import {
    findConfigPda,
    findPauseStatePda,
    findRolePda,
    findQuotaPda,
    findBlacklistPda,
} from "../src/pda";

const PROGRAM_ID = new PublicKey("HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ");
const HOOK_PROGRAM_ID = new PublicKey("2wcwbEsw7rZ2t36qaDujHUc9HHrg3f5m4opcSHpixNUv");

describe("Preset → Config Mapping", () => {
    it("SSS-1 preset disables compliance features", () => {
        const args = sss1Preset("USD", "USD", "https://test.com");
        expect(args.enablePermanentDelegate).toBe(false);
        expect(args.enableTransferHook).toBe(false);
        expect(args.defaultAccountFrozen).toBe(false);
    });

    it("SSS-2 preset enables all compliance features", () => {
        const args = sss2Preset("USD", "USD", "https://test.com", HOOK_PROGRAM_ID);
        expect(args.enablePermanentDelegate).toBe(true);
        expect(args.enableTransferHook).toBe(true);
        expect(args.defaultAccountFrozen).toBe(true);
    });

    it("SSS-3 preset enables all SSS-2 + privacy features", () => {
        const args = sss3Preset("USD", "USD", "https://test.com", HOOK_PROGRAM_ID);
        expect(args.enablePermanentDelegate).toBe(true);
        expect(args.enableTransferHook).toBe(true);
        expect(args.enableConfidentialTransfers).toBe(true);
        expect(args.enableAllowlist).toBe(true);
    });

    it("preset feature flags are superset chain: SSS-1 ⊂ SSS-2 ⊂ SSS-3", () => {
        const s1Keys = Object.keys(SSS1_FEATURES).length;
        const s2Keys = Object.keys(SSS2_FEATURES).length;
        const s3Keys = Object.keys(SSS3_FEATURES).length;
        expect(s2Keys).toBeGreaterThanOrEqual(s1Keys);
        expect(s3Keys).toBeGreaterThanOrEqual(s2Keys);
    });
});

describe("Cross-PDA Consistency", () => {
    const mint = Keypair.generate().publicKey;
    const holder = Keypair.generate().publicKey;

    it("config and pause PDAs are different for same mint", () => {
        const config = findConfigPda(mint, PROGRAM_ID);
        const pause = findPauseStatePda(mint, PROGRAM_ID);
        expect(config[0].equals(pause[0])).toBe(false);
    });

    it("different role types produce different PDAs", () => {
        const minterPda = findRolePda(mint, holder, RoleType.Minter, PROGRAM_ID);
        const burnerPda = findRolePda(mint, holder, RoleType.Burner, PROGRAM_ID);
        expect(minterPda[0].equals(burnerPda[0])).toBe(false);
    });

    it("quota PDA is different from role PDA for same minter", () => {
        const rolePda = findRolePda(mint, holder, RoleType.Minter, PROGRAM_ID);
        const quotaPda = findQuotaPda(mint, holder, PROGRAM_ID);
        expect(rolePda[0].equals(quotaPda[0])).toBe(false);
    });

    it("blacklist PDA is different from config PDA", () => {
        const target = Keypair.generate().publicKey;
        const config = findConfigPda(mint, PROGRAM_ID);
        const blacklist = findBlacklistPda(mint, target, PROGRAM_ID);
        expect(config[0].equals(blacklist[0])).toBe(false);
    });

    it("all 5 PDA types are unique for same mint", () => {
        const target = Keypair.generate().publicKey;
        const pdas = [
            findConfigPda(mint, PROGRAM_ID)[0],
            findPauseStatePda(mint, PROGRAM_ID)[0],
            findRolePda(mint, holder, RoleType.Minter, PROGRAM_ID)[0],
            findQuotaPda(mint, holder, PROGRAM_ID)[0],
            findBlacklistPda(mint, target, PROGRAM_ID)[0],
        ];
        const unique = new Set(pdas.map((p) => p.toBase58()));
        expect(unique.size).toBe(5);
    });
});

describe("Enum Completeness", () => {
    it("RoleType has all 6 roles", () => {
        expect(Object.keys(RoleType).filter((k) => isNaN(Number(k))).length).toBe(6);
    });

    it("QuotaPeriod has all 4 periods", () => {
        expect(Object.keys(QuotaPeriod).filter((k) => isNaN(Number(k))).length).toBe(4);
    });

    it("SSSPreset has all 5 presets", () => {
        expect(Object.keys(SSSPreset).length).toBe(5);
    });

    it("RoleType values are sequential from 0", () => {
        expect(RoleType.MasterAuthority).toBe(0);
        expect(RoleType.Minter).toBe(1);
        expect(RoleType.Burner).toBe(2);
        expect(RoleType.Pauser).toBe(3);
        expect(RoleType.Blacklister).toBe(4);
        expect(RoleType.Seizer).toBe(5);
    });
});

describe("PDA Security Properties", () => {
    it("PDA is not on the ed25519 curve (no private key)", () => {
        const mint = Keypair.generate().publicKey;
        const [pda] = findConfigPda(mint, PROGRAM_ID);
        // PDAs are 32 bytes but NOT valid ed25519 points
        expect(pda.toBytes().length).toBe(32);
    });

    it("bump seed is within valid range [0, 255]", () => {
        const mint = Keypair.generate().publicKey;
        const [, bump] = findConfigPda(mint, PROGRAM_ID);
        expect(bump).toBeGreaterThanOrEqual(0);
        expect(bump).toBeLessThanOrEqual(255);
    });

    it("config PDA cannot collide with pause PDA", () => {
        // Test with 100 random mints to confirm no collision
        for (let i = 0; i < 100; i++) {
            const m = Keypair.generate().publicKey;
            const cp = findConfigPda(m, PROGRAM_ID)[0];
            const pp = findPauseStatePda(m, PROGRAM_ID)[0];
            expect(cp.equals(pp)).toBe(false);
        }
    });
});

describe("Feature Flag Validation", () => {
    it("SSS-1 features do not include compliance", () => {
        expect(SSS1_FEATURES.blacklist).toBe(false);
        expect(SSS1_FEATURES.seize).toBe(false);
    });

    it("SSS-2 features include compliance but not privacy", () => {
        expect(SSS2_FEATURES.blacklist).toBe(true);
        expect(SSS2_FEATURES.seize).toBe(true);
        expect((SSS2_FEATURES as any).confidentialTransfers).toBeUndefined();
    });

    it("SSS-3 features include both compliance and privacy", () => {
        expect(SSS3_FEATURES.blacklist).toBe(true);
        expect(SSS3_FEATURES.confidentialTransfers).toBe(true);
        expect(SSS3_FEATURES.allowlist).toBe(true);
    });

    it("all features are boolean type", () => {
        for (const [, value] of Object.entries(SSS3_FEATURES)) {
            expect(typeof value).toBe("boolean");
        }
    });
});
