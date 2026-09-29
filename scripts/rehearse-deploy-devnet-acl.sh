#!/usr/bin/env bash
# Rehearses scripts/deploy-devnet-acl.sh (a real run, not DRY_RUN) on a local validator set up like devnet:
#   - sss-token and the transfer hook as upgradeable programs holding today's devnet bytes, under their real upgrade
#     authorities (5BXg…, 3YnV…). The bytes are dumped read-only from public devnet into ~/.cache/thawgate-rehearsal.
#   - no gate program, so the gate's deploy is a first deploy
#   - ExtendProgramChecked deactivated, as it is on devnet (`solana feature status -u d`, 2026-09-29)
# Rent differs from devnet (the local validator charges 6,960 lamports/byte, devnet 5,080), so the SOL figures here
# are not devnet's. What the rehearsal checks is the commands, their signers and the rerun path.
#
# INTERRUPT_AFTER=<seconds> kills the first run's process group with SIGTERM after that long (not SIGINT: a background
# job of a non-interactive shell starts with SIGINT ignored, and bash can't trap a signal ignored on entry). A second
# run then has to finish the job, reusing the kept buffer keypair.
# Usage: [SKIP_BUILD=1] [INTERRUPT_AFTER=8] scripts/rehearse-deploy-devnet-acl.sh
set -euo pipefail
cd "$(dirname "$0")/.."
R="$HOME/.cache/thawgate-rehearsal"
SSS_AUTH=5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e
HOOK_AUTH=3YnVTN8gWWnvgn4AFmtZu4vFDpMAn4vu27uF5ppKS1EM
EXTEND_PROGRAM_CHECKED=2oMRZEDWT2tqtYMofhmmfQ8SsjqUFzT6sYXppQDavxwz
program_id() { grep 'declare_id!' "programs/$1/src/lib.rs" | grep -oP '"[^"]+"' | tr -d '"'; }
SSS_ID=$(program_id sss-token)
HOOK_ID=$(program_id transfer-hook)

mkdir -p "$R"
[ -f "$R/sss_token.devnet.so" ] || solana program dump "$SSS_ID" "$R/sss_token.devnet.so" -u d > /dev/null
[ -f "$R/transfer_hook.devnet.so" ] || solana program dump "$HOOK_ID" "$R/transfer_hook.devnet.so" -u d > /dev/null
rm -rf "$R/buffers"

solana-test-validator --reset --ledger "$R/ledger" --quiet --mint "$SSS_AUTH" \
  --upgradeable-program "$SSS_ID" "$R/sss_token.devnet.so" "$SSS_AUTH" \
  --upgradeable-program "$HOOK_ID" "$R/transfer_hook.devnet.so" "$HOOK_AUTH" \
  --deactivate-feature "$EXTEND_PROGRAM_CHECKED" > "$R/validator.log" 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null || true; wait $VPID 2>/dev/null || true' EXIT
ready() { [ "$(solana slot -u l --commitment confirmed 2>/dev/null || echo 0)" -ge 1 ]; }
for _ in $(seq 1 120); do ready && break; sleep 1; done
ready || { echo "validator not ready, see $R/validator.log"; exit 1; }
solana airdrop 1 "$HOOK_AUTH" -u l > /dev/null # 3YnV pays the hook's extend
before=$(solana balance "$SSS_AUTH" -u l --lamports | grep -oP '^\d+')

export RPC_URL=http://127.0.0.1:8899 REHEARSAL=1 YES=1 BUFFER_DIR="$R/buffers"
if [ -n "${INTERRUPT_AFTER:-}" ]; then
  setsid scripts/deploy-devnet-acl.sh &
  pid=$!
  sleep "$INTERRUPT_AFTER"
  kill -TERM -- "-$pid" 2>/dev/null || true
  wait "$pid" && echo "== first run finished before the interrupt" || echo "== first run interrupted (exit $?); running again"
  SKIP_BUILD=1 scripts/deploy-devnet-acl.sh
else
  scripts/deploy-devnet-acl.sh
fi

after=$(solana balance "$SSS_AUTH" -u l --lamports | grep -oP '^\d+')
echo
echo "== Rehearsal: 5BXg spent $(awk -v l=$((before - after)) 'BEGIN { printf "%.9f", l / 1e9 }') SOL at local rent"
# Every transaction either authority signed (the airdrop excluded): count, signatures, fees paid, and the priority
# part of those fees (fee - 5,000 lamports per signature).
node - "$SSS_AUTH" "$HOOK_AUTH" << 'EOF'
const rpc = async (method, params) => (await (await fetch("http://127.0.0.1:8899", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
(async () => {
  const seen = new Map();
  for (const who of process.argv.slice(2)) {
    let before;
    for (;;) {
      const page = await rpc("getSignaturesForAddress", [who, { limit: 1000, before, commitment: "confirmed" }]);
      for (const s of page) if (!s.err) seen.set(s.signature, true);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
  }
  const byPayer = {};
  for (const sig of seen.keys()) {
    const t = await rpc("getTransaction", [sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    const payer = t.transaction.message.accountKeys[0];
    if (!process.argv.slice(2).includes(payer)) continue; // the airdrop
    const sigs = t.transaction.signatures.length;
    const row = (byPayer[payer] ??= { txs: 0, signatures: 0, fee: 0, priority: 0 });
    row.txs += 1;
    row.signatures += sigs;
    row.fee += t.meta.fee;
    row.priority += t.meta.fee - 5000 * sigs;
  }
  for (const [payer, r] of Object.entries(byPayer)) console.log(`fee payer ${payer}: ${JSON.stringify(r)}`);
})();
EOF
