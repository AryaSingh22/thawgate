#!/bin/bash
# Runs the gate suite (tests/gate) on a throwaway local validator (Agave 3.0.14) that has:
#   - the ThawGate gate, sss-token and the transfer hook (target/deploy/*.so) at their declare_id! addresses
#   - Token ACL from tests/fixtures
#   - devnet Token-2022 from tests/fixtures (the bundled one fails TokenMetadata initialize on 3.x)
#   - the Solana Attestation Service (SAS) from tests/fixtures
#   - sss-token registry entries injected at genesis (tests/gate/registry-fixtures.ts) for the S4/S5 gate suites,
#     plus one malformed SAS attestation (tests/gate/keys.ts). hook.test.ts and issuer.test.ts write theirs
#     through sss-token. GENESIS_FIXTURES=0 starts the validator without them (tests/e2e/acl-story.ts: `yarn test:story`).
# Usage: [SKIP_BUILD=1] [GENESIS_FIXTURES=0] [GATE_TESTS=tests/gate/hook.test.ts] scripts/test-gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PAYER=test-keypair.json
LEDGER="${HOME}/.cache/thawgate-gate-test-ledger"
LOG=tests/gate/.validator.log
FIXTURES="$(mktemp -d)"
# The deploy keypairs are random in CI (anchor build makes them), so take the IDs from the source.
program_id() { grep 'declare_id!' "programs/$1/src/lib.rs" | grep -oP '"[^"]+"' | tr -d '"'; }
GATE_ID=$(program_id thawgate-gate)
SSS_ID=$(program_id sss-token)
HOOK_ID=$(program_id transfer-hook)

[ -n "${SKIP_BUILD:-}" ] || anchor build
scripts/verify-ids.sh

ACCOUNTS=()
if [ "${GENESIS_FIXTURES:-1}" != 0 ]; then
  npx ts-node --transpile-only tests/gate/registry-fixtures.ts "$FIXTURES" > "$FIXTURES/accounts.txt"
  while read -r address file; do ACCOUNTS+=(--account "$address" "$file"); done < "$FIXTURES/accounts.txt"
fi
echo "genesis fixture accounts: $(( ${#ACCOUNTS[@]} / 3 ))"

solana-test-validator --reset --ledger "$LEDGER" --quiet \
  --mint "$(solana-keygen pubkey "$PAYER")" \
  --bpf-program "$GATE_ID" target/deploy/thawgate_gate.so \
  --bpf-program "$SSS_ID" target/deploy/sss_token.so \
  --bpf-program "$HOOK_ID" target/deploy/transfer_hook.so \
  --bpf-program TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP tests/fixtures/token_acl.so \
  --bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb tests/fixtures/token_2022.so \
  --bpf-program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG tests/fixtures/sas.so \
  "${ACCOUNTS[@]}" > "$LOG" 2>&1 &
VPID=$!
# `|| true`: wait returns the killed validator's 143, and under set -e a failing command in the EXIT trap becomes the
# script's exit status, masking the test result.
trap 'kill $VPID 2>/dev/null || true; wait $VPID 2>/dev/null || true; rm -rf "$FIXTURES"' EXIT

# Ready = the confirmed bank is past slot 0. The RPC answers before that, but rejects v0 transactions (all of this
# suite's) with "invalid transaction: Attempt to debit an account but found no record of a prior credit" while the
# confirmed bank is still slot 0; legacy transactions pass.
ready() { [ "$(solana slot -u l --commitment confirmed 2>/dev/null || echo 0)" -ge 1 ]; }
for _ in $(seq 1 120); do
  ready && break
  kill -0 $VPID 2>/dev/null || { echo "validator exited, see $LOG"; exit 1; }
  sleep 1
done
ready || { echo "validator not ready after 120 s, see $LOG"; exit 1; }
echo "local validator $(solana cluster-version -u l)"

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET="$PAYER" \
  npx ts-mocha -p ./tsconfig.json -t 1000000 "${GATE_TESTS:-tests/gate/**/*.test.ts}"
