import { describe, expect, it } from "vitest";
import { GATE_ID, TOKEN_2022_ID, TOKEN_ACL_ID } from "../src/accounts";
import { masker } from "../src/config";
import { classifyLogs } from "../src/freezer";
import { Metrics } from "../src/metrics";

const BUDGET = "ComputeBudget111111111111111111111111111111";
const frame = (program: string, depth: number, inner: string[], result = "success") => [
  `Program ${program} invoke [${depth}]`,
  ...inner,
  result === "success" ? `Program ${program} success` : `Program ${program} failed: ${result}`,
];

describe("classifyLogs", () => {
  it("a confirmed freeze carries the gate's TG:ALLOW reason", () => {
    const logs = [
      ...frame(BUDGET, 1, []),
      ...frame(TOKEN_ACL_ID, 1, [
        ...frame(GATE_ID, 2, ["Program log: Instruction: CanFreezePermissionless", "Program log: TG:ALLOW:NO_CREDENTIAL"]),
        ...frame(TOKEN_2022_ID, 2, ["Program log: Instruction: FreezeAccount"]),
      ]),
    ];
    expect(classifyLogs(logs, true)).toEqual({ kind: "frozen", reason: "NO_CREDENTIAL" });
  });

  it("a success without a gate frame is Token ACL's idempotent early return", () => {
    expect(classifyLogs([...frame(BUDGET, 1, []), ...frame(TOKEN_ACL_ID, 1, [])], true)).toEqual({ kind: "already_frozen" });
  });

  it("TG:DENY:COMPLIANT is a no-op, not an error", () => {
    const logs = frame(TOKEN_ACL_ID, 1, frame(GATE_ID, 2, ["Program log: TG:DENY:COMPLIANT"], "custom program error: 0x177a"), "custom program error: 0x177a");
    expect(classifyLogs(logs, false)).toEqual({ kind: "compliant" });
  });

  it("other denials keep their code", () => {
    const deny = frame(TOKEN_ACL_ID, 1, frame(GATE_ID, 2, ["Program log: TG:DENY:BAD_CREDENTIAL"], "custom program error: 0x1773"), "custom program error: 0x1773");
    expect(classifyLogs(deny, false)).toEqual({ kind: "denied", code: "BAD_CREDENTIAL" });
    const tokenAcl = frame(TOKEN_ACL_ID, 1, [], "custom program error: 0x5");
    expect(classifyLogs(tokenAcl, false)).toEqual({ kind: "denied", code: `${TOKEN_ACL_ID}: custom program error: 0x5` });
  });
});

describe("masker", () => {
  it("never prints the RPC URL or an api-key", () => {
    const url = "https://devnet.helius-rpc.com/?api-key=0123456789abcdef";
    const mask = masker([url, url.replace("https", "wss")]);
    expect(mask(`fetch failed for ${url}`)).toBe("fetch failed for <RPC>");
    expect(mask("wss://devnet.helius-rpc.com/?api-key=0123456789abcdef")).toBe("<RPC>");
    expect(mask("https://other.example/?api-key=zzz&x=1")).toBe("https://other.example/?api-key=<RPC>&x=1");
  });
});

describe("metrics", () => {
  it("renders Prometheus text and sums counters by label", () => {
    const m = new Metrics();
    m.inc("thawgate_keeper_freezes_total", { trigger: "sas", reason: "NO_CREDENTIAL" });
    m.inc("thawgate_keeper_freezes_total", { trigger: "expiry", reason: "CREDENTIAL_EXPIRED" });
    m.observe("thawgate_keeper_freeze_latency_seconds", { trigger: "sas" }, 1.2);
    m.set("thawgate_keeper_last_sweep_timestamp_seconds", {}, 1790852566);
    expect(m.get("thawgate_keeper_freezes_total")).toBe(2);
    expect(m.get("thawgate_keeper_freezes_total", { trigger: "sas" })).toBe(1);
    const text = m.render();
    expect(text).toContain('thawgate_keeper_freezes_total{reason="NO_CREDENTIAL",trigger="sas"} 1');
    expect(text).toContain('thawgate_keeper_freeze_latency_seconds_bucket{trigger="sas",le="1.5"} 1');
    expect(text).toContain('thawgate_keeper_freeze_latency_seconds_bucket{trigger="sas",le="1"} 0');
    expect(text).toContain('thawgate_keeper_freeze_latency_seconds_count{trigger="sas"} 1');
    expect(text).toContain("thawgate_keeper_last_sweep_timestamp_seconds 1790852566");
    expect(text).toContain("# TYPE thawgate_keeper_freeze_latency_seconds histogram");
  });
});
