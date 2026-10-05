// Every explorer.solana.com tx / address link in the Markdown files named on stdin must exist on its cluster:
// a tx through getSignatureStatuses (with history search), an address through getMultipleAccounts. Explorer itself
// answers 200 for any path, so an HTTP check proves nothing. Read-only. Devnet RPC: HELIUS_DEVNET_RPC from .env
// (masked in errors), else public devnet. Exit 1 if anything is missing.
const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");

const root = path.resolve(__dirname, "../..");
const env = fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "";
const keyed = /^HELIUS_DEVNET_RPC=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
const DEVNET = keyed || "https://api.devnet.solana.com";
const MAINNET = "https://api.mainnet-beta.solana.com";
const mask = (s) => (keyed ? String(s).split(keyed).join("<RPC>") : String(s));

const files = fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
const re = /https:\/\/explorer\.solana\.com\/(tx|address)\/([1-9A-HJ-NP-Za-km-z]{32,90})(\?[^)\s>"]*)?/g;
const found = new Map(); // "cluster|kind|id" -> files
for (const f of files) {
  for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(re)) {
    const q = m[3] || "";
    const cluster = /cluster=devnet/.test(q) ? "devnet" : /cluster=/.test(q) ? "other" : "mainnet";
    const key = `${cluster}|${m[1]}|${m[2]}`;
    if (!found.has(key)) found.set(key, new Set());
    found.get(key).add(f);
  }
}
const where = (key) => [...found.get(key)].join(", ");

(async () => {
  const conns = { devnet: new Connection(DEVNET, "confirmed"), mainnet: new Connection(MAINNET, "confirmed") };
  const bad = [];
  const counts = {};
  for (const cluster of ["devnet", "mainnet", "other"]) {
    for (const kind of ["tx", "address"]) {
      const ids = [...found.keys()].filter((k) => k.startsWith(`${cluster}|${kind}|`)).map((k) => k.split("|")[2]);
      counts[`${cluster} ${kind}`] = ids.length;
      if (!ids.length) continue;
      if (cluster === "other") {
        ids.forEach((id) => bad.push(`${kind} ${id}: unknown cluster (${where(`other|${kind}|${id}`)})`));
        continue;
      }
      const c = conns[cluster];
      const step = kind === "tx" ? 200 : 100;
      for (let i = 0; i < ids.length; i += step) {
        const chunk = ids.slice(i, i + step);
        if (kind === "tx") {
          const { value } = await c.getSignatureStatuses(chunk, { searchTransactionHistory: true });
          value.forEach((s, j) => s || bad.push(`${cluster} tx ${chunk[j]} not found (${where(`${cluster}|tx|${chunk[j]}`)})`));
        } else {
          const keys = chunk.map((a) => { try { return new PublicKey(a); } catch { return null; } });
          const infos = await c.getMultipleAccountsInfo(keys.filter(Boolean));
          let v = 0;
          keys.forEach((k, j) => {
            if (!k) return bad.push(`${cluster} address ${chunk[j]} is not a public key`);
            if (!infos[v++]) bad.push(`${cluster} address ${chunk[j]} has no account (${where(`${cluster}|address|${chunk[j]}`)})`);
          });
        }
      }
    }
  }
  console.log(JSON.stringify(counts));
  console.log(bad.length ? bad.join("\n") : "all explorer links exist on chain");
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => {
  console.error(mask(e && e.stack ? e.stack : e));
  process.exit(1);
});
