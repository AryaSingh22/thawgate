#!/bin/bash
# Runs the gate suite (tests/gate) on a throwaway local validator (Agave 3.0.14) that has:
#   - the ThawGate gate (target/deploy/thawgate_gate.so) at its declare_id! address
#   - Token ACL from tests/fixtures
#   - devnet Token-2022 from tests/fixtures (the bundled one fails TokenMetadata initialize on 3.x)
#   - sss-token registry entries injected at genesis (tests/gate/registry-fixtures.ts), since sss-token can
#     only write them for Token ACL mints from S6 on
# Usage: [SKIP_BUILD=1] scripts/test-gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PAYER=test-keypair.json
LEDGER="${HOME}/.cache/thawgate-gate-test-ledger"
LOG=tests/gate/.validator.log
FIXTURES="$(mktemp -d)"
# The deploy keypair is random in CI (anchor build makes one), so take the ID from the source.
GATE_ID=$(grep 'declare_id!' programs/thawgate-gate/src/lib.rs | grep -oP '"[^"]+"' | tr -d '"')

[ -n "${SKIP_BUILD:-}" ] || anchor build -p thawgate_gate
scripts/verify-ids.sh

npx ts-node --transpile-only tests/gate/registry-fixtures.ts "$FIXTURES" > "$FIXTURES/accounts.txt"
ACCOUNTS=()
while read -r address file; do ACCOUNTS+=(--account "$address" "$file"); done < "$FIXTURES/accounts.txt"

solana-test-validator --reset --ledger "$LEDGER" --quiet \
  --mint "$(solana-keygen pubkey "$PAYER")" \
  --bpf-program "$GATE_ID" target/deploy/thawgate_gate.so \
  --bpf-program TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP tests/fixtures/token_acl.so \
  --bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb tests/fixtures/token_2022.so \
  "${ACCOUNTS[@]}" > "$LOG" 2>&1 &
VPID=$!
# `|| true`: wait returns the killed validator's 143, and under set -e a failing command in the EXIT trap becomes the
# script's exit status, masking the test result.
trap 'kill $VPID 2>/dev/null || true; wait $VPID 2>/dev/null || true; rm -rf "$FIXTURES"' EXIT

for _ in $(seq 1 60); do
  solana cluster-version -u l > /dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || { echo "validator exited, see $LOG"; exit 1; }
  sleep 2
done
echo "local validator $(solana cluster-version -u l)"

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET="$PAYER" \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/gate/**/*.test.ts'
