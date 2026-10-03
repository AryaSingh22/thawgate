import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { loadConfig, masker } from "../src/screener/config";
import { clampReason, parseStaticList, ProviderError, RangeProvider, selectProvider, StaticListProvider } from "../src/screener/providers";

const KEY = "range-test-key-0123456789abcdef";
const W = Keypair.generate().publicKey.toBase58();
const never = () => new AbortController().signal;
const respond = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rangeWith = (impl: (url: string, init: RequestInit) => Promise<Response>) => new RangeProvider({ apiKey: KEY, fetch: impl as any });

/** Every way a RangeProvider call can fail, with the error it threw. */
async function failure(p: RangeProvider, signal = never()): Promise<ProviderError> {
  try {
    await p.screen(W, signal);
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as Error).message).not.toContain(KEY);
    return e as ProviderError;
  }
  throw new Error("screen() resolved; a failure must throw");
}

describe("RangeProvider (Range Risk API, mocked: no RANGE_API_KEY exists for a live call)", () => {
  it("GET /v1/risk/address with address, network=solana and the Bearer key; riskScore is the score", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const p = rangeWith(async (url, init) => {
      calls.push({ url: String(url), init });
      return respond(200, { riskScore: 9, riskLevel: "Extremely high risk", numHops: 1 });
    });
    expect(await p.screen(W, never())).toEqual({ score: 9, detail: "Extremely high risk" });
    const u = new URL(calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe("https://api.range.org/v1/risk/address");
    expect(u.searchParams.get("address")).toBe(W);
    expect(u.searchParams.get("network")).toBe("solana");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(p.reason({ score: 9 })).toBe("range:9");
    expect([p.name, p.fallback, p.label, p.version()]).toEqual(["range", false, "range", undefined]);
  });

  it.each([400, 401, 404, 429, 500, 503])("HTTP %i is an error, never a score", async (status) => {
    expect((await failure(rangeWith(async () => respond(status, { riskScore: 10 })))).kind).toBe(`http_${status}`);
  });

  it("a timeout is an error of kind timeout", async () => {
    const hang = rangeWith(
      (_url, init) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    expect((await failure(hang, AbortSignal.timeout(30))).kind).toBe("timeout");
  });

  it("a network failure is an error of kind network", async () => {
    expect((await failure(rangeWith(async () => Promise.reject(new TypeError("fetch failed"))))).kind).toBe("network");
  });

  it.each([[{}], [{ riskScore: 0 }], [{ riskScore: 11 }], [{ riskScore: 7.5 }], [{ riskScore: "9" }], [{ riskScore: null }], ["<html>"]])(
    "a malformed body (%j) is a parse error",
    async (body) => {
      expect((await failure(rangeWith(async () => respond(200, body)))).kind).toBe("parse");
    },
  );
});

describe("StaticListProvider (the fallback)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const listFile = (content: unknown) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screener-list-"));
    dirs.push(dir);
    const file = path.join(dir, "list.json");
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    return file;
  };
  /** Rewrites the file so its size or mtime changes. */
  const rewrite = (file: string, content: unknown) => {
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    const t = new Date(Date.now() + 5_000);
    fs.utimesSync(file, t, t);
  };

  it("listed = 10, unlisted = 1; the reason is static:<name>; labelled as the fallback", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const p = new StaticListProvider(listFile({ name: "ofac-sample", source: "test", addresses: [W] }));
    expect(await p.screen(W, never())).toEqual({ score: 10 });
    expect(await p.screen(other, never())).toEqual({ score: 1 });
    expect([p.name, p.fallback, p.label, p.reason({ score: 10 })]).toEqual(["static", true, "static:ofac-sample", "static:ofac-sample"]);
  });

  it("an edit changes version() and takes effect on the next screen", async () => {
    const file = listFile({ name: "demo", addresses: [] });
    const p = new StaticListProvider(file);
    const v1 = p.version();
    expect(await p.screen(W, never())).toEqual({ score: 1 });
    rewrite(file, { name: "demo", addresses: [W] });
    expect(p.version()).not.toBe(v1);
    expect(await p.screen(W, never())).toEqual({ score: 10 });
  });

  it("a bad edit keeps the last good list, reports once, and the version stays", async () => {
    const file = listFile({ name: "demo", addresses: [W] });
    const errors: unknown[] = [];
    const p = new StaticListProvider(file, (e) => errors.push(e));
    const v1 = p.version();
    rewrite(file, "{ not json");
    expect(p.version()).toBe(v1);
    expect(await p.screen(W, never())).toEqual({ score: 10 });
    p.version();
    expect(errors).toHaveLength(1);
    rewrite(file, { name: "demo", addresses: ["not-an-address"] });
    expect(p.version()).toBe(v1);
    expect(errors).toHaveLength(2);
  });

  it("a bad list at startup is fatal", () => {
    expect(() => new StaticListProvider(listFile("{"))).toThrow();
    expect(() => new StaticListProvider(listFile({ name: "has space", addresses: [] }))).toThrow(/name/);
    expect(() => parseStaticList(JSON.stringify({ name: "x", addresses: [42] }))).toThrow(/not a string/);
  });

  it("the shipped demo list loads and is empty", () => {
    const p = new StaticListProvider(path.join(__dirname, "../lists/demo.json"));
    expect([p.label, p.size]).toEqual(["static:demo", 0]);
  });
});

describe("selectProvider", () => {
  const demo = path.join(__dirname, "../lists/demo.json");
  it("Range only when RANGE_API_KEY is set", () => {
    expect(selectProvider({ rangeApiKey: KEY, rangeApiUrl: "https://api.range.org", staticList: demo }).name).toBe("range");
  });
  it("otherwise the static list, flagged as the fallback", () => {
    const p = selectProvider({ rangeApiKey: undefined, rangeApiUrl: "https://api.range.org", staticList: demo });
    expect([p.name, p.fallback]).toEqual(["static", true]);
  });
});

describe("config and helpers", () => {
  it("reasons are cut to sss-token's 100 bytes and a safe character set", () => {
    expect(clampReason("static:demo")).toBe("static:demo");
    expect(clampReason("static:a b/c")).toBe("static:a_b_c");
    expect(Buffer.byteLength(clampReason(`static:${"x".repeat(200)}`))).toBe(100);
  });

  it("the masker hides the RPC URL, the Range key and Bearer values", () => {
    const rpc = "https://devnet.helius-rpc.com/?api-key=abcdef0123456789";
    const mask = masker([rpc, KEY]);
    const out = mask(`${rpc} ${KEY} Authorization: Bearer ${KEY} https://x.test/?api-key=zzz`);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("abcdef0123456789");
    expect(out).not.toContain("zzz");
  });

  it("threshold defaults to 8 and must be 1-10; RANGE_API_KEY can come from a .env file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screener-env-"));
    try {
      const env = path.join(dir, ".env");
      fs.writeFileSync(env, `HELIUS_DEVNET_RPC=https://rpc.test/?api-key=1\nRANGE_API_KEY="${KEY}"\n`);
      const cfg = loadConfig({ SCREENER_DOTENV: env } as any);
      // Booleans, so a failure can't print the repo's real RPC URL in a diff.
      expect([cfg.threshold, cfg.rangeApiKey === KEY, cfg.rpcUrl === "https://rpc.test/?api-key=1", cfg.pollMs, cfg.dryRun]).toEqual([8, true, true, 5000, false]);
      expect(() => loadConfig({ SCREENER_DOTENV: env, SCREENER_THRESHOLD: "11" } as any)).toThrow(/1-10/);
      expect(() => loadConfig({ SCREENER_DOTENV: env, SCREENER_THRESHOLD: "0" } as any)).toThrow(/1-10/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
