import * as fs from "fs";
import * as path from "path";
import { describe as group, expect, it } from "vitest";
import {
    FLAG_CODES,
    GATE_DENY_ERRORS,
    STRUCTURAL_DENY_CODES,
    THAW_ALLOW_CODES,
    THAWGATE_GATE_ID,
    classifyGateLogs,
    describe,
    isTgCode,
    parseGateLogs,
} from "../src/gate/reasons";

const GATE = THAWGATE_GATE_ID;
const TOKEN_ACL = "TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BUDGET = "ComputeBudget111111111111111111111111111111";
const OTHER_GATE = "GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz";

// The keeper's fixtures (services/keeper/test/freezer.test.ts): a program's frame with its inner lines.
const frame = (program: string, depth: number, inner: string[], result = "success") => [
    `Program ${program} invoke [${depth}]`,
    ...inner,
    result === "success" ? `Program ${program} success` : `Program ${program} failed: ${result}`,
];
const anchorError = (name: string, n: number, code: string) =>
    `Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${n}. Error Message: TG:DENY:${code}: …`;

group("parseGateLogs", () => {
    it("reads the gate's line inside its frame", () => {
        const logs = frame(TOKEN_ACL, 1, frame(GATE, 2, ["Program log: Instruction: CanThawPermissionless", "Program log: TG:ALLOW:KYC"]));
        expect(parseGateLogs(logs)).toEqual({ gateInvoked: true, decision: { kind: "ALLOW", code: "KYC" }, failure: null });
    });

    it("ignores TG lines logged by another program", () => {
        const logs = frame(TOKEN_ACL, 1, [...frame(OTHER_GATE, 2, ["Program log: TG:ALLOW:KYC"]), "Program log: TG:ALLOW:CLEAN"]);
        expect(parseGateLogs(logs)).toEqual({ gateInvoked: false, decision: null, failure: null });
    });

    it("takes the first match: the gate's msg! before Anchor's error line", () => {
        const logs = frame(
            TOKEN_ACL,
            1,
            frame(GATE, 2, ["Program log: TG:DENY:BLACKLISTED", anchorError("DeniedBlacklisted", 6014, "BLACKLISTED")], "custom program error: 0x177e"),
            "custom program error: 0x177e",
        );
        const parsed = parseGateLogs(logs);
        expect(parsed.decision).toEqual({ kind: "DENY", code: "BLACKLISTED" });
        expect(parsed.failure).toEqual({ program: GATE, message: "custom program error: 0x177e" });
    });

    it("tracks frames after the gate returns", () => {
        const logs = frame(TOKEN_ACL, 1, [...frame(GATE, 2, ["Program log: TG:ALLOW:NO_CREDENTIAL"]), ...frame(TOKEN_2022, 2, ["Program log: TG:ALLOW:KYC"])]);
        expect(parseGateLogs(logs).decision).toEqual({ kind: "ALLOW", code: "NO_CREDENTIAL" });
    });

    it("honours a custom gate id", () => {
        const logs = frame(TOKEN_ACL, 1, frame(OTHER_GATE, 2, ["Program log: TG:DENY:COMPLIANT"], "custom program error: 0x1"), "custom program error: 0x1");
        expect(parseGateLogs(logs, OTHER_GATE).decision).toEqual({ kind: "DENY", code: "COMPLIANT" });
    });
});

group("classifyGateLogs (the keeper's freezer.test.ts cases, plus thaw)", () => {
    it("a confirmed freeze carries the gate's TG:ALLOW reason", () => {
        const logs = [
            ...frame(BUDGET, 1, []),
            ...frame(TOKEN_ACL, 1, [
                ...frame(GATE, 2, ["Program log: Instruction: CanFreezePermissionless", "Program log: TG:ALLOW:NO_CREDENTIAL"]),
                ...frame(TOKEN_2022, 2, ["Program log: Instruction: FreezeAccount"]),
            ]),
        ];
        expect(classifyGateLogs(logs, true, "freeze")).toEqual({
            outcome: "allowed",
            code: "NO_CREDENTIAL",
            reason: describe("ALLOW", "NO_CREDENTIAL", "freeze"),
        });
    });

    it("a success without a gate frame is Token ACL's idempotent early return", () => {
        const v = classifyGateLogs([...frame(BUDGET, 1, []), ...frame(TOKEN_ACL, 1, [])], true, "freeze");
        expect(v.outcome).toBe("skipped");
        expect(v.reason).toMatch(/already frozen/);
        expect(classifyGateLogs(frame(TOKEN_ACL, 1, []), true, "thaw").reason).toMatch(/already thawed/);
    });

    it("TG:DENY:COMPLIANT on freeze", () => {
        const logs = frame(TOKEN_ACL, 1, frame(GATE, 2, ["Program log: TG:DENY:COMPLIANT"], "custom program error: 0x1783"), "custom program error: 0x1783");
        expect(classifyGateLogs(logs, false, "freeze")).toEqual({ outcome: "denied", code: "COMPLIANT", reason: "Not freezable: the owner passes the policy." });
    });

    it("a thaw denial keeps its code; a Token ACL failure is not the gate's", () => {
        const deny = frame(TOKEN_ACL, 1, frame(GATE, 2, ["Program log: TG:DENY:BAD_CREDENTIAL"], "custom program error: 0x177c"), "custom program error: 0x177c");
        expect(classifyGateLogs(deny, false, "thaw")).toMatchObject({ outcome: "denied", code: "BAD_CREDENTIAL" });
        const tokenAcl = frame(TOKEN_ACL, 1, [], "custom program error: 0x5");
        expect(classifyGateLogs(tokenAcl, false, "thaw")).toMatchObject({ outcome: "failed", program: TOKEN_ACL, message: "custom program error: 0x5" });
    });

    it("recovers the code from the error number when the logs were cut", () => {
        const cut = [`Program ${TOKEN_ACL} invoke [1]`, `Program ${GATE} invoke [2]`, "Log truncated"];
        expect(classifyGateLogs(cut, false, "thaw", { errorCode: 6016 })).toMatchObject({ outcome: "denied", code: "NO_CREDENTIAL" });
        expect(classifyGateLogs(frame(TOKEN_ACL, 1, [], "custom program error: 0x5"), false, "thaw", { errorCode: 6016 }).outcome).toBe("failed");
    });

    it("an empty log is a failure with no reason, never a decision", () => {
        expect(classifyGateLogs([], false, "thaw")).toMatchObject({ outcome: "failed", program: "unknown" });
    });
});

group("describe", () => {
    it("BLACKLISTED denies a thaw and allows a freeze", () => {
        expect(describe("DENY", "BLACKLISTED", "thaw")).toBe("Unlock denied: the owner is on the issuer's blacklist.");
        expect(describe("ALLOW", "BLACKLISTED", "freeze")).toBe("Freezable by anyone: the owner is on the issuer's blacklist.");
        expect(describe("DENY", "BAD_POLICY", "freeze")).toMatch(/^Freeze denied: /);
    });

    it("an unknown code still reads as a sentence", () => {
        expect(describe("DENY", "NEW_THING", "thaw")).toBe("Unlock denied: the gate returned NEW_THING, a code this SDK version doesn't know.");
    });
});

// Drift guard: every code the gate program can log has a description, and the error numbers match errors.rs.
group("matches programs/thawgate-gate", () => {
    const src = path.join(__dirname, "../../programs/thawgate-gate/src");
    const decision = fs.readFileSync(path.join(src, "decision.rs"), "utf8");
    const errors = fs.readFileSync(path.join(src, "errors.rs"), "utf8");

    it("decision.rs logs no code the SDK lacks, and the SDK has none the gate dropped", () => {
        const logged = new Set([...decision.matchAll(/"TG:(?:ALLOW|DENY):([A-Z_]+)"/g)].map((m) => m[1]));
        const known = new Set<string>([...THAW_ALLOW_CODES, ...FLAG_CODES, ...STRUCTURAL_DENY_CODES, "NO_IMMUTABLE_OWNER", "COMPLIANT"]);
        expect([...logged].sort()).toEqual([...known].sort());
        for (const c of logged) expect(isTgCode(c)).toBe(true);
    });

    it("GATE_DENY_ERRORS follows the GateError enum order (6000 + index)", () => {
        const body = errors.slice(errors.indexOf("pub enum GateError"));
        const variants = [...body.matchAll(/^\s{4}([A-Z][A-Za-z]+),$/gm)].map((m) => m[1]);
        const messages = [...body.matchAll(/#\[msg\("([^"]*)"\)\]/g)].map((m) => m[1]);
        expect(variants.length).toBe(messages.length);
        const fromSource: Record<number, string> = {};
        variants.forEach((v, i) => {
            const tg = /^TG:DENY:([A-Z_]+):/.exec(messages[i]);
            if (v.startsWith("Denied")) fromSource[6000 + i] = tg![1];
        });
        expect(fromSource).toEqual(GATE_DENY_ERRORS);
    });
});
