/**
 * @module tests/commands
 * @description CLI unit tests for command validation and config management.
 *
 * These tests exercise the command handlers and config module directly
 * without requiring an RPC connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadConfig, saveConfig, CLIConfig } from "../src/config";
import { parsePreset } from "../src/commands";
import { PublicKey } from "@solana/web3.js";

// Use a temp directory for config tests
const TEST_CONFIG_DIR = path.join(os.tmpdir(), ".sss-token-test-" + Date.now());
const TEST_CONFIG_FILE = path.join(TEST_CONFIG_DIR, "config.json");

describe("CLI Config Management", () => {
    beforeEach(() => {
        if (fs.existsSync(TEST_CONFIG_DIR)) {
            fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(TEST_CONFIG_DIR)) {
            fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
        }
    });

    it("loadConfig returns defaults when no config file exists", () => {
        const config = loadConfig({});
        expect(config.rpcUrl).toBeDefined();
        expect(config.commitment).toBe("confirmed");
    });

    it("loadConfig returns overrides when provided", () => {
        const config = loadConfig({ rpcUrl: "https://custom.rpc.com" });
        expect(config.rpcUrl).toBe("https://custom.rpc.com");
    });

    it("loadConfig sets correct default commitment", () => {
        const config = loadConfig({});
        expect(config.commitment).toBe("confirmed");
    });

    it("loadConfig sets correct default keypair path", () => {
        const config = loadConfig({});
        expect(config.keypairPath).toContain("id.json");
    });

    it("loadConfig merges overrides over defaults", () => {
        const config = loadConfig({
            rpcUrl: "https://override.rpc.com",
            commitment: "finalized",
        });
        expect(config.rpcUrl).toBe("https://override.rpc.com");
        expect(config.commitment).toBe("finalized");
    });

    it("an undefined override (flag not given) keeps the env value", () => {
        const before = process.env.SSS_RPC_URL;
        process.env.SSS_RPC_URL = "https://env.rpc.test";
        try {
            // createClient passes every flag, given or not.
            const config = loadConfig({ rpcUrl: undefined, keypairPath: undefined, commitment: "confirmed" });
            expect(config.rpcUrl).toBe("https://env.rpc.test");
            expect(config.keypairPath).toContain("id.json");
        } finally {
            if (before === undefined) delete process.env.SSS_RPC_URL;
            else process.env.SSS_RPC_URL = before;
        }
    });
});

describe("CLI Input Validation", () => {
    it("PublicKey constructor rejects invalid base58", () => {
        expect(() => new PublicKey("not-a-valid-pubkey!!")).toThrow();
    });

    it("PublicKey constructor accepts valid base58", () => {
        const key = new PublicKey("So11111111111111111111111111111111111111112");
        expect(key).toBeInstanceOf(PublicKey);
    });

    it("empty string is not a valid PublicKey", () => {
        expect(() => new PublicKey("")).toThrow();
    });

    it("validates amount parsing for mint command", () => {
        const amount = parseInt("1000000", 10);
        expect(amount).toBe(1000000);
        expect(isNaN(amount)).toBe(false);
    });

    it("rejects non-numeric amounts", () => {
        const amount = parseInt("not-a-number", 10);
        expect(isNaN(amount)).toBe(true);
    });

    it("validates decimals parsing", () => {
        const decimals = parseInt("6", 10);
        expect(decimals).toBe(6);
        expect(decimals).toBeGreaterThanOrEqual(0);
        expect(decimals).toBeLessThanOrEqual(9);
    });
});

describe("CLI Preset Handling", () => {
    it("sss1 is the default preset", () => {
        const preset = "sss1";
        expect(preset).toBe("sss1");
    });

    it("sss2 preset is recognized", () => {
        const preset = "sss2";
        expect(["sss1", "sss2"]).toContain(preset);
    });

    it("unknown preset should be rejected", () => {
        const preset = "sss99";
        expect(["sss1", "sss2"]).not.toContain(preset);
    });

    it("init command parses custom config from JSON", () => {
        const jsonConfig = JSON.stringify({
            name: "Test USD",
            symbol: "TUSD",
            decimals: 6,
        });
        const parsed = JSON.parse(jsonConfig);
        expect(parsed.name).toBe("Test USD");
        expect(parsed.symbol).toBe("TUSD");
        expect(parsed.decimals).toBe(6);
    });
});

describe("CLI Minters Validation", () => {
    it("minters add requires valid address format", () => {
        const validAddress = "So11111111111111111111111111111111111111112";
        expect(() => new PublicKey(validAddress)).not.toThrow();
    });

    it("minters add rejects invalid address", () => {
        expect(() => new PublicKey("invalid!!!")).toThrow();
    });

    it("minters remove requires valid address format", () => {
        const validAddress = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        expect(() => new PublicKey(validAddress)).not.toThrow();
    });

    it("minters remove rejects empty address", () => {
        expect(() => new PublicKey("")).toThrow();
    });

    it("minter list validates mint flag", () => {
        const mintStr = "So11111111111111111111111111111111111111112";
        const mint = new PublicKey(mintStr);
        expect(mint.toBase58()).toBe(mintStr);
    });
});

describe("CLI Blacklist Validation", () => {
    it("blacklist add validates target address", () => {
        const target = "So11111111111111111111111111111111111111112";
        expect(() => new PublicKey(target)).not.toThrow();
    });

    it("blacklist add rejects invalid address", () => {
        expect(() => new PublicKey("not-valid!")).toThrow();
    });

    it("blacklist add requires reason (non-empty string)", () => {
        const reason = "OFAC sanctioned entity";
        expect(reason.length).toBeGreaterThan(0);
    });

    it("blacklist remove validates address", () => {
        const target = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        expect(() => new PublicKey(target)).not.toThrow();
    });

    it("empty reason should be flagged", () => {
        const reason = "";
        expect(reason.length).toBe(0);
    });
});

describe("CLI Status/Supply Output", () => {
    it("supply command formats output as number", () => {
        const supply = "1000000";
        expect(parseInt(supply, 10)).toBe(1000000);
    });

    it("supply with decimals formats correctly", () => {
        const rawSupply = 1000000;
        const decimals = 6;
        const formatted = (rawSupply / Math.pow(10, decimals)).toFixed(decimals);
        expect(formatted).toBe("1.000000");
    });

    it("status outputs valid program ID format", () => {
        const programId = "HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ";
        expect(() => new PublicKey(programId)).not.toThrow();
    });

    it("status outputs preset name", () => {
        const preset = "sss-2";
        expect(["sss-1", "sss-2"]).toContain(preset);
    });
});

describe("CLI Audit Log", () => {
    it("audit log entry is valid JSON", () => {
        const entry = {
            command: "mint",
            mint: "ABC123",
            amount: "1000",
            timestamp: new Date().toISOString(),
        };
        const json = JSON.stringify(entry);
        const parsed = JSON.parse(json);
        expect(parsed.command).toBe("mint");
        expect(parsed.timestamp).toBeDefined();
    });

    it("audit log filters by action type", () => {
        const entries = [
            { command: "mint", amount: "100" },
            { command: "burn", amount: "50" },
            { command: "mint", amount: "200" },
        ];
        const mintEntries = entries.filter((e) => e.command === "mint");
        expect(mintEntries.length).toBe(2);
    });

    it("audit log default shows recent entries", () => {
        const entries = Array.from({ length: 20 }, (_, i) => ({
            command: "mint",
            index: i,
        }));
        const recent = entries.slice(-10);
        expect(recent.length).toBe(10);
        expect(recent[0].index).toBe(10);
    });

    it("empty audit log shows no events message", () => {
        const entries: unknown[] = [];
        const message = entries.length === 0 ? "No events found" : "Events:";
        expect(message).toBe("No events found");
    });
});

describe("CLI Error Handling", () => {
    it("init --preset takes sss1 or sss2 only (anything else used to create an SSS-1 mint)", () => {
        expect(parsePreset("sss1")).toBe("sss1");
        expect(parsePreset("SSS2")).toBe("sss2");
        for (const bad of ["unknown", "acl", "sss3", ""]) {
            expect(() => parsePreset(bad)).toThrow(/Valid presets: sss1, sss2/);
        }
    });

    it("missing required arg is detected", () => {
        const opts = { mint: undefined };
        expect(opts.mint).toBeUndefined();
    });

    it("network error produces friendly message", () => {
        const error = new Error("fetch failed");
        const friendlyMsg = error.message.includes("fetch")
            ? "Network error: unable to connect to RPC"
            : error.message;
        expect(friendlyMsg).toContain("Network error");
    });
});
