// Devnet mints gated by ThawGate: Token ACL MintConfig accounts (100 bytes, discriminator 1) whose gating_program
// (offset 68) is the gate (RESEARCH.md §1.4). Prints each mint, then the count and how many have permissionless thaw
// and freeze on. Read-only. RPC: HELIUS_DEVNET_RPC from .env (masked in errors), else public devnet, which may refuse
// getProgramAccounts.
const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");

const root = path.resolve(__dirname, "../..");
const env = fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "";
const keyed = /^HELIUS_DEVNET_RPC=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
const RPC = keyed || "https://api.devnet.solana.com";
const TOKEN_ACL = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
const GATE = "THAW2daLXyUtCLtTsJWDTKZctiAGmGX4wT1kqKXugUZ";

(async () => {
  const c = new Connection(RPC, "confirmed");
  const all = await c.getProgramAccounts(TOKEN_ACL, { filters: [{ dataSize: 100 }, { memcmp: { offset: 68, bytes: GATE } }] });
  const configs = all.filter((a) => a.account.data[0] === 1);
  for (const a of configs) console.log("mint", new PublicKey(a.account.data.subarray(4, 36)).toBase58());
  const slot = await c.getSlot();
  console.log(
    JSON.stringify({
      mints: configs.length,
      permissionlessThaw: configs.filter((a) => a.account.data[2] === 1).length,
      permissionlessFreeze: configs.filter((a) => a.account.data[3] === 1).length,
      slot,
      clusterTime: new Date((await c.getBlockTime(slot)) * 1000).toISOString(),
    }),
  );
})().catch((e) => {
  console.error(keyed ? String(e && e.stack ? e.stack : e).split(keyed).join("<RPC>") : e);
  process.exit(1);
});
