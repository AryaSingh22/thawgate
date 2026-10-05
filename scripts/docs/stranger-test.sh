#!/usr/bin/env bash
# The README stranger test: fetch the README from GitHub, as a stranger reads it, and run the bash blocks of its
# "Quickstart (devnet)" section verbatim, line by line, timed, in a fresh directory with an empty HOME (no keys, no
# yarn or npm cache). Every timing line starts with STEP_SECONDS; grep for them rather than cutting the output.
#
#   scripts/docs/stranger-test.sh [ref]   phase A: clone → install → build → pack → first run. The first
#                                         `node quickstart.mjs` is expected to exit 1 when the faucet refuses.
#   (fund the printed address: faucet.solana.com, or a transfer)
#   scripts/docs/stranger-test.sh rerun   phase B: the funded run.
#   rm -rf /tmp/tg-stranger               afterwards (about 2 GB).
#
# PATH is reduced to /usr/local/bin:/usr/bin:/bin, where the README's prerequisites (Node ≥ 22.12, yarn 1, git) must be.
set -uo pipefail
BASE=${STRANGER_DIR:-/tmp/tg-stranger}
export HOME=$BASE/home
export PATH=/usr/local/bin:/usr/bin:/bin
secs() { awk -v s="$1" -v e="$2" 'BEGIN { printf "%.1f", e - s }'; }

if [ "${1:-}" = "rerun" ]; then
  cd "$BASE/thawgate-quickstart" || exit 1
  s=$EPOCHREALTIME; node quickstart.mjs; rc=$?; e=$EPOCHREALTIME
  echo "STEP_SECONDS $(secs "$s" "$e") rc=$rc :: node quickstart.mjs (funded run)"
  exit $rc
fi

REF=${1:-main}
rm -rf "$BASE" && mkdir -p "$HOME" && cd "$BASE" || exit 1
echo "PREREQ node $(node -v) yarn $(yarn -v) npm $(npm -v) $(git --version)"
curl -fsSL "https://raw.githubusercontent.com/AryaSingh22/thawgate/$REF/README.md" -o "$BASE/README.md" || exit 1
awk '/^## Quickstart \(devnet\)/ { q = 1; next } /^## / { q = 0 } q && /^```bash/ { inb = 1; next } q && /^```/ { inb = 0; next } q && inb' \
  "$BASE/README.md" > "$BASE/steps.txt"
echo "README steps:"; cat -n "$BASE/steps.txt"

runner=$BASE/run-steps.sh
{
  echo 'secs() { awk -v s="$1" -v e="$2" '"'"'BEGIN { printf "%.1f", e - s }'"'"'; }'
  echo 't0=$EPOCHREALTIME'
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    q=${line//\'/\'\\\'\'}
    echo "echo '+ $q'"
    echo 's=$EPOCHREALTIME'
    echo "$line"
    echo 'rc=$?; e=$EPOCHREALTIME'
    echo "echo \"STEP_SECONDS \$(secs \$s \$e) rc=\$rc :: $q\""
    echo "if [ \$rc -ne 0 ] && [ '$q' != 'node quickstart.mjs' ]; then echo STEP_FAILED; exit \$rc; fi"
  done < "$BASE/steps.txt"
  echo 'echo "PHASE_A_SECONDS $(secs $t0 $EPOCHREALTIME)"'
} > "$runner"
bash "$runner"
