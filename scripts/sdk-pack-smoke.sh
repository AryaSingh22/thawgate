#!/bin/bash
# Installs @thawgate/sdk and @thawgate/cli the way an integrator would (from `npm pack` tarballs, into an empty
# project outside the repo) and checks that they load on this Node version: CommonJS require, native ESM import,
# the dependency-free "reasons" entry, the CLI binary. Run it on Node 20 and 22 (CI's sdk-node job).
# Needs sdk/dist and cli/dist built. Usage: scripts/sdk-pack-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "node $(node -v), npm $(npm -v)"

(cd sdk && npm pack --silent --pack-destination "$WORK" >/dev/null)
(cd cli && npm pack --silent --pack-destination "$WORK" >/dev/null)
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund ./thawgate-sdk-0.1.0.tgz ./thawgate-cli-0.1.0.tgz >/dev/null

node -e '
const sdk = require("@thawgate/sdk");
const reasons = require("@thawgate/sdk/reasons");
const c = sdk.SolanaStablecoin.fromConfig({ rpcUrl: "http://127.0.0.1:8899" });
if (!c.gate || typeof c.gate.explain !== "function") throw new Error("no gate client");
if (reasons.describe("DENY", "NO_CREDENTIAL", "thaw") !== sdk.describeGateCode("DENY", "NO_CREDENTIAL", "thaw")) throw new Error("reasons differ");
console.log("cjs ok:", c.programId.toBase58(), c.gate.gateProgramId.toBase58(), new sdk.BN(5).toString());
'
node --input-type=module -e '
import { SolanaStablecoin, BN, GateClient, sas, keypairWallet } from "@thawgate/sdk";
import { classifyGateLogs } from "@thawgate/sdk/reasons";
import { Keypair } from "@solana/web3.js";
const c = SolanaStablecoin.fromConfig({ rpcUrl: "http://127.0.0.1:8899" }, Keypair.generate());
const v = classifyGateLogs([], false, "thaw");
console.log("esm ok:", typeof GateClient, typeof sas.createCredentialIx, typeof keypairWallet, c.wallet !== undefined, v.outcome, new BN(7).toString());
'
npx --no-install thawgate --help | head -3
npx --no-install thawgate --version
echo "pack smoke ok"
