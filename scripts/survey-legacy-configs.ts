/**
 * Read-only survey of the sss-token `StablecoinConfig` accounts already on devnet, for the S6 layout change
 * (`compliance_mode: u8` appended; STABLECOIN_CONFIG_SIZE 350 -> 351, existing accounts stay 350 bytes).
 *
 *   npx ts-node --transpile-only scripts/survey-legacy-configs.ts
 *
 * The RPC URL is HELIUS_DEVNET_RPC, from the environment or ~/thawgate/.env. It carries an API key: this script never
 * prints it, and error messages are redacted before they are printed.
 *
 * A pre-S6 config decodes `compliance_mode` from the first spare byte after `bump` (0 = Hook, today's behavior) and
 * re-serializes in place. Spare bytes = 350 - (8 + 32 + 32 + 4+name + 4+symbol + 4+uri + 7 + 16 + 1); a config with 0
 * spare bytes (name, symbol and uri all at their maximum) can't be decoded after the upgrade.
 */
import fs from "fs";
import path from "path";

const PROGRAM = "HLvhfKVfGfKXVNS9tZ1q7SNS4w9mQmcjre758QFhbZDZ";
const DISCRIMINATOR = Buffer.from([127, 25, 244, 213, 1, 192, 101, 6]); // IDL: StablecoinConfig
const LEGACY_SIZE = 350;
const FIXED = 8 + 32 + 32 + 4 + 4 + 4 + 7 + 16 + 1; // everything but the three string bodies

function rpcUrl(): string {
  if (process.env.HELIUS_DEVNET_RPC) return process.env.HELIUS_DEVNET_RPC;
  const envFile = path.join(__dirname, "..", ".env");
  const line = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("HELIUS_DEVNET_RPC=")) : undefined;
  const url = line?.slice("HELIUS_DEVNET_RPC=".length).trim().replace(/^["']|["']$/g, "");
  if (!url) throw new Error("HELIUS_DEVNET_RPC is not set (environment or .env)");
  return url;
}
const URL_ = rpcUrl();
const redact = (s: string) => s.split(URL_).join("<HELIUS_DEVNET_RPC>").replace(/api-key=[^&\s"']+/g, "api-key=<redacted>");

async function call(method: string, params: unknown[]) {
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const discFilter = { memcmp: { offset: 0, bytes: DISCRIMINATOR.toString("base64"), encoding: "base64" } };

async function main() {
  const t0 = Date.now();
  // 1. Every config, any size (no data), to catch layouts other than 350 bytes.
  const all: any[] = await call("getProgramAccounts", [PROGRAM, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters: [discFilter] }]);
  const bySize: Record<number, number> = {};
  for (const a of all) bySize[a.account.space] = (bySize[a.account.space] ?? 0) + 1;

  // 2. The 350-byte ones in full.
  const legacy: any[] = await call("getProgramAccounts", [PROGRAM, { encoding: "base64", filters: [{ dataSize: LEGACY_SIZE }, discFilter] }]);
  const rows = legacy.map((a) => {
    const d = Buffer.from(a.account.data[0], "base64");
    let o = 8 + 32 + 32;
    const str = () => {
      const n = d.readUInt32LE(o);
      const s = d.subarray(o + 4, o + 4 + n).toString("utf8");
      o += 4 + n;
      return { n, s };
    };
    const mint = d.subarray(40, 72);
    const [name, symbol, uri] = [str(), str(), str()];
    const spare = LEGACY_SIZE - (FIXED + name.n + symbol.n + uri.n);
    // The byte a post-S6 program reads as compliance_mode (first byte after bump), when there is one.
    const modeByte = spare > 0 ? d[o + 7 + 16 + 1] : null;
    return { config: a.pubkey as string, mint: bs58(mint), name: name.s, symbol: symbol.s, lens: [name.n, symbol.n, uri.n], spare, modeByte };
  });
  const spareHist: Record<string, number> = {};
  for (const r of rows) {
    const bucket = r.spare === 0 ? "0" : r.spare < 10 ? "1-9" : r.spare < 100 ? "10-99" : "100+";
    spareHist[bucket] = (spareHist[bucket] ?? 0) + 1;
  }
  const outliers = rows.filter((r) => r.spare === 0);
  const nonZeroMode = rows.filter((r) => r.modeByte !== null && r.modeByte !== 0);

  console.log(`sss-token ${PROGRAM} on devnet, read ${new Date().toISOString()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`StablecoinConfig accounts (discriminator match), by size: ${JSON.stringify(bySize)}`);
  console.log(`350-byte configs: ${rows.length}; spare bytes: ${JSON.stringify(spareHist)}; min spare ${Math.min(...rows.map((r) => r.spare))}`);
  console.log(`first spare byte (read as compliance_mode) non-zero: ${nonZeroMode.length}`);
  console.log(`outliers (0 spare bytes, undecodable after the upgrade): ${outliers.length}`);
  for (const r of outliers) console.log(`  ${JSON.stringify(r)}`);
  for (const r of nonZeroMode) console.log(`  non-zero mode byte: ${JSON.stringify(r)}`);
  const other = all.filter((a) => a.account.space !== LEGACY_SIZE);
  for (const a of other) console.log(`  other size ${a.account.space}: ${a.pubkey}`);
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(bytes: Buffer): string {
  let n = BigInt("0x" + bytes.toString("hex"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

main().catch((e) => {
  console.error(redact(String(e?.stack ?? e)));
  process.exit(1);
});
