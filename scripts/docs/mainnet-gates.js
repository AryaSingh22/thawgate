// Mainnet Token ACL mints by gating program: MintConfig accounts (100 bytes, discriminator 1) grouped by
// gating_program (offset 68), the RESEARCH.md §1.4 method. Prints one line per gate, then the totals. Read-only, on
// public mainnet (it serves getProgramAccounts on Token ACL).
const { Connection, PublicKey } = require("@solana/web3.js");

const RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_ACL = new PublicKey("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
const REFERENCE_GATE = "GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz"; // the Foundation's allow/block-list gate

(async () => {
  const c = new Connection(RPC, "confirmed");
  const all = await c.getProgramAccounts(TOKEN_ACL, { filters: [{ dataSize: 100 }] });
  const configs = all.filter((a) => a.account.data[0] === 1);
  const byGate = {};
  for (const a of configs) {
    const gate = new PublicKey(a.account.data.subarray(68, 100)).toBase58();
    byGate[gate] = (byGate[gate] || 0) + 1;
  }
  for (const [gate, n] of Object.entries(byGate).sort((x, y) => y[1] - x[1]))
    console.log("gate", gate, n, gate === REFERENCE_GATE ? "(reference gate)" : "");
  const slot = await c.getSlot();
  console.log(
    JSON.stringify({
      mints: configs.length,
      gates: Object.keys(byGate).length,
      onReferenceGate: byGate[REFERENCE_GATE] || 0,
      slot,
      clusterTime: new Date((await c.getBlockTime(slot)) * 1000).toISOString(),
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
