// LOCALNET SIMULATION ONLY. Writes Orca's devnet WhirlpoolsConfigExtension account with
// token_badge_authority (bytes 72..104) replaced by <badge-authority>, so a local validator can
// simulate "Orca issued our mint a Token Badge". Edits the base64 data in the raw JSON text so
// rentEpoch (u64::MAX) keeps its exact value.
//   node scripts/spikes/orca-badge-sim.js <badge-authority> <out.json>
const c = require("@orca-so/whirlpools-client");
const { getAddressEncoder } = require("@solana/kit");
const { execSync } = require("child_process");
const fs = require("fs");

(async () => {
  const [badgeAuthority, out] = process.argv.slice(2);
  const deployment = c.WhirlpoolDeployment.devnet;
  const [extension] = await c.getWhirlpoolsConfigExtensionAddress(deployment);
  const raw = execSync(`solana account -u d ${extension} --output json`).toString();
  const m = raw.match(/"data":\s*\[\s*"([^"]+)",\s*"base64"\s*\]/);
  const data = Buffer.from(m[1], "base64");
  Buffer.from(getAddressEncoder().encode(badgeAuthority)).copy(data, 72);
  fs.writeFileSync(out, raw.replace(m[1], data.toString("base64")));
  console.log(`patched ${extension} (Orca devnet config ${deployment.configAddress}) -> ${out}`);
})();
