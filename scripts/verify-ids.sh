#!/usr/bin/env bash
# Verify every program ID agrees across declare_id!, Anchor.toml ([programs.localnet] and [programs.devnet]),
# the built IDL (target/idl/<name>.json, if built) and the deploy keypair (target/deploy/<name>-keypair.json),
# plus the DEPLOYMENT.md IDs of the deployed programs. Program IDs are set by hand (no `anchor keys sync`):
# run this after every build.
#
# The keypair check is skipped when CI is set: CI has no deploy keypairs, and `anchor build` generates random
# ones where they are missing.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# crate directory : Anchor program name
PROGRAMS=(
  "sss-token:sss_token"
  "transfer-hook:transfer_hook"
  "oracle-module:oracle_module"
  "thawgate-gate:thawgate_gate"
)

# Address of <name> in one [programs.<cluster>] section of Anchor.toml.
anchor_toml_id() {
  awk -v section="[programs.$1]" -v name="$2" '
    $0 == section { inside = 1; next }
    /^\[/ { inside = 0 }
    inside && $1 == name { match($0, /address = "[^"]+"/); print substr($0, RSTART + 11, RLENGTH - 12) }
  ' Anchor.toml
}

fail=0
check() { # label expected actual
  if [ "$2" != "$3" ]; then
    echo "  ERROR: $1 is '${3:-<missing>}', expected $2"
    fail=1
  fi
}

for entry in "${PROGRAMS[@]}"; do
  dir="${entry%%:*}"
  name="${entry##*:}"
  src_id=$(grep 'declare_id!' "programs/$dir/src/lib.rs" | grep -oP '"[^"]+"' | tr -d '"')
  echo "$name: $src_id"
  check "Anchor.toml [programs.localnet].$name" "$src_id" "$(anchor_toml_id localnet "$name")"
  check "Anchor.toml [programs.devnet].$name" "$src_id" "$(anchor_toml_id devnet "$name")"
  if [ -f "target/idl/$name.json" ]; then
    check "target/idl/$name.json address" "$src_id" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["address"])' "target/idl/$name.json")"
  fi
  if [ -z "${CI:-}" ] && [ -f "target/deploy/$name-keypair.json" ]; then
    check "target/deploy/$name-keypair.json" "$src_id" "$(solana-keygen pubkey "target/deploy/$name-keypair.json")"
  fi
done

# Deployed programs must match DEPLOYMENT.md.
for name in sss-token transfer-hook; do
  src_id=$(grep 'declare_id!' "programs/$name/src/lib.rs" | grep -oP '"[^"]+"' | tr -d '"')
  grep -q "$src_id" DEPLOYMENT.md || { echo "  ERROR: $name ID $src_id not in DEPLOYMENT.md"; fail=1; }
done

if [ "$fail" -ne 0 ]; then
  echo "Program ID mismatch"
  exit 1
fi
echo "Program IDs verified OK"
