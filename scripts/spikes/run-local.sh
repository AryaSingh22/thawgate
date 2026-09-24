#!/bin/bash
# Runs a spike script (scripts/spikes/$SPIKE.ts, default dex-pool) on a throwaway local validator (Agave 3.0.14) that has:
#   - Token ACL + ABL gate from tests/fixtures
#   - devnet Token-2022 (the bundled one fails TokenMetadata initialize on 3.x)
#   - devnet Raydium CPMM + its 6 amm_configs + pool-fee account
#   - devnet Orca Whirlpools + Orca's devnet config + fee tier 64, and the config extension with
#     token_badge_authority patched to the payer (LOCALNET SIMULATION of an Orca-issued badge)
#   - devnet Solana Attestation Service (SAS)
# Usage: [SPIKE=dex-pool|sas-credential] [EXTENSIONS=minimal] [ORCA_CONFIG=devnet] scripts/spikes/run-local.sh [steps...]
set -u
cd "$(dirname "$0")/../.."
SPIKE="${SPIKE:-dex-pool}"
PAYER=test-keypair.json
LEDGER="${HOME}/.cache/thawgate-spike-ledger"
EXT_JSON="${HOME}/.cache/thawgate-spike-orca-ext.json"
LOG=scripts/spikes/.validator.log

node scripts/spikes/orca-badge-sim.js "$(solana-keygen pubkey "$PAYER")" "$EXT_JSON"

solana-test-validator --reset --ledger "$LEDGER" --quiet \
  --mint "$(solana-keygen pubkey "$PAYER")" \
  --bpf-program TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP tests/fixtures/token_acl.so \
  --bpf-program GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz tests/fixtures/abl_gate.so \
  --url devnet \
  --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --clone-upgradeable-program DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb \
  --clone 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy --clone HTVWgp8CbUsRNmRE1p9RBYqopxe2qiyApSkiTFLrfxaW \
  --clone A9qBhPy4k5UYW72hSgAkh1Epr2do69P54yzzcMV3yv6b --clone EsTevfacYXpuho5VBuzBjDZi8dtWidGnXoSYAr8krTvz \
  --clone 5Gt9qrPJ6FVe9VHtwF2W2JrFR6p9jmx4DxBkgfPdaApk --clone G7YfJJp1TX1VtzN4V2yhPNSU23AKPSy1U2miRdwAByK5 \
  --clone 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy \
  --clone-upgradeable-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc \
  --clone FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR \
  --clone nhg1SS1hNFnJKZrJ9FBf3L6SxTjwEnkehN7dmAbg25t \
  --clone-upgradeable-program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG \
  --account 475EJ7JqnRpVLoFVzp2ruEYvWWMCf6Z8KMWRujtXXNSU "$EXT_JSON" > "$LOG" 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null; wait $VPID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  solana cluster-version -u l > /dev/null 2>&1 && break
  kill -0 $VPID 2>/dev/null || { echo "validator exited, see $LOG"; exit 1; }
  sleep 2
done
echo "local validator $(solana cluster-version -u l)"

rm -f "scripts/spikes/.${SPIKE}.localnet.json"
CLUSTER=localnet PAYER="$PAYER" npx ts-node --transpile-only "scripts/spikes/${SPIKE}.ts" "$@"
