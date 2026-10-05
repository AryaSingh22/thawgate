#!/usr/bin/env bash
# Devnet deploy of the Token ACL release (S7): a fresh deploy of the ThawGate gate, then upgrades of sss-token and
# the transfer hook to the S6 builds, each extended first when the new .so is longer than its on-chain program data
# (by at least MIN_EXTEND bytes, Agave 4.x's minimum). S12-venue adds a fresh deploy of demo_pool, the demo venue
# (programs/demo-pool: any protocol that separates pool init from deposit works the same way).
#
#   DRY_RUN=1 scripts/deploy-devnet-acl.sh   every step, its signers and its SOL cost; reads the chain, sends nothing
#   scripts/deploy-devnet-acl.sh             sends, after typing "deploy" (YES=1 skips the prompt)
#
# RPC: HELIUS_DEVNET_RPC from .env. It carries an API key, so it is never printed: commands are shown with "$RPC", and
# all CLI output goes through a filter that masks the URL and any api-key. RPC_URL overrides it (only the host is
# printed). The genesis hash must be devnet's; REHEARSAL=1 allows another cluster (a local validator loaded with the
# devnet programs), never mainnet.
#
# Signers (the CLI gets keypair paths; this script never reads or prints a keypair's contents):
#   5BXg… ~/.config/solana/sss-authority.json   fee payer for every buffer, deploy and upgrade (upgrade spills come back
#                                               to it); sss-token upgrade authority; gate and demo_pool upgrade
#                                               authority (GATE_AUTHORITY=<keypair path> overrides both)
#   3YnV… ~/.config/solana/id.json              transfer hook upgrade authority: signs the hook's buffer writes and upgrade,
#                                               and pays the hook's `extend` (a tx fee: its ProgramData already holds the rent)
#   THAW… ~/.keys/thawgate/thawgate_gate-keypair.json   the gate's program keypair (first deploy only)
#   9oYx… ~/.keys/thawgate/demo_pool-keypair.json       demo_pool's program keypair (first deploy only)
#
# Other settings: CU_PRICE (priority fee in micro-lamports per CU for buffer writes and deploys, default 50000;
# `extend` has no priority fee option in CLI 3.0.14) · USE_RPC=1 (send buffer writes through the RPC instead of leader
# TPUs) · SKIP_BUILD=1 · SO_DIR=<dir> (read the four .so files from <dir> instead of target/deploy, e.g. the
# verifiable-build artifact; implies SKIP_BUILD).
#
# S17: the gate and demo_pool are deployed fresh when absent, and upgraded (authority GATE_AUTHORITY) when they exist
# with other bytes, e.g. to redeploy the solana-verify builds.
#
# Reruns are safe. A program whose on-chain bytes already equal the local .so is skipped. Buffer keypairs are kept in
# ~/.keys/thawgate/buffers/, so a rerun resumes a half-written buffer. On failure the script prints the buffer address
# and the `solana program close` command that refunds its rent.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN="${DRY_RUN:-0}"
CU_PRICE="${CU_PRICE:-50000}"
SSS_AUTH="$HOME/.config/solana/sss-authority.json"
HOOK_AUTH="$HOME/.config/solana/id.json"
GATE_KP="$HOME/.keys/thawgate/thawgate_gate-keypair.json"
POOL_KP="$HOME/.keys/thawgate/demo_pool-keypair.json"
GATE_AUTHORITY="${GATE_AUTHORITY:-$SSS_AUTH}"
BUFFER_DIR="${BUFFER_DIR:-$HOME/.keys/thawgate/buffers}" # a rehearsal uses its own
EXPECT_SSS_AUTH=5BXgjuDBcMr4r4xtKMTctZebgTbZYgzzmsdqtpLayE1e # CLAUDE.md
EXPECT_HOOK_AUTH=3YnVTN8gWWnvgn4AFmtZu4vFDpMAn4vu27uF5ppKS1EM
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
MAINNET_GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d
LAMPORTS_PER_SIGNATURE=5000
# Priority fee bound: CU_PRICE x the 200,000 CU default limit per transaction. The CLI sets each limit from a
# simulation, so the real priority fee is lower.
CU_LIMIT_BOUND=200000
# Program bytes per buffer-write transaction with one and with two signers: a 1,232-byte packet less the signatures,
# account keys and compute-budget instructions. Estimates; the local rehearsal (LOG.md S7a) measured the real counts.
CHUNK_1_SIGNER=960
CHUNK_2_SIGNERS=870
# Agave 4.x rejects a smaller ExtendProgram: "ExtendProgram requires a minimum of 10240 additional bytes or to extend
# to maximum size" (devnet 4.3.0, S7b). Agave 3.0.14, the rehearsal validator, has no minimum.
MIN_EXTEND=10240
[ -d "$HOME/.cargo/targets/solana-stablecoin-standard" ] && export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cargo/targets/solana-stablecoin-standard}"

die() { echo "ERROR: $*" >&2; exit 1; }
program_id() { grep 'declare_id!' "programs/$1/src/lib.rs" | grep -oP '"[^"]+"' | tr -d '"'; }
sol() { awk -v l="$1" 'BEGIN { printf "%.9f SOL", l / 1e9 }'; }
max() { [ "$1" -gt "$2" ] && echo "$1" || echo "$2"; }

# ---------------------------------------------------------------------------------------------
# RPC and output masking
# ---------------------------------------------------------------------------------------------
if [ -n "${RPC_URL:-}" ]; then
  RPC="$RPC_URL"
  RPC_SOURCE="RPC_URL"
  RPC_PLACEHOLDER='"$RPC_URL"'
else
  [ -f .env ] || die ".env not found; it needs HELIUS_DEVNET_RPC"
  RPC=$(sed -n 's/^HELIUS_DEVNET_RPC=//p' .env | head -n 1 | tr -d '\r' | sed -E "s/^[\"']//; s/[\"']\$//")
  [ -n "$RPC" ] || die "HELIUS_DEVNET_RPC is not set in .env"
  RPC_SOURCE="HELIUS_DEVNET_RPC from .env"
  RPC_PLACEHOLDER='"$HELIUS_DEVNET_RPC"'
fi
RPC_HOST=$(printf '%s' "$RPC" | sed -E 's#^[a-z]+://([^/?]+).*#\1#')

# Masks the RPC URL and any api-key in a stream.
mask() { RPC_MASK="$RPC" perl -pe 'BEGIN { $| = 1; $u = $ENV{RPC_MASK} } s/\Q$u\E/<RPC>/g; s/api-key=[^&\s"\x27]+/api-key=<redacted>/g'; }
# Runs a command with its output masked; fails when the command fails.
run() { "$@" 2>&1 | mask; }
# Prints a command as it will run, with the RPC URL and $HOME as placeholders.
show() {
  local out=() a
  for a in "$@"; do
    if [ "$a" = "$RPC" ]; then out+=("$RPC_PLACEHOLDER"); else out+=("${a/#$HOME/\~}"); fi
  done
  echo "      \$ ${out[*]}"
}
# DRY_RUN prints the command; otherwise it is printed and run.
step() {
  show "$@"
  [ "$DRY_RUN" = 1 ] || run "$@"
}
# A read-only CLI query; prints its (masked) error and exits when it fails.
query() {
  local out
  out=$("$@" 2>&1) || { printf '%s\n' "$out" | mask >&2; die "query failed: ${*/"$RPC"/<RPC>}"; }
  printf '%s\n' "$out"
}
rent() { query solana rent "$1" --lamports --url "$RPC" | grep -oP '\d+(?= lamports)'; }
balance() { query solana balance "$1" --lamports --url "$RPC" | grep -oP '^\d+'; }

# ---------------------------------------------------------------------------------------------
# Failure: say which buffer holds the rent and how to resume or refund it
# ---------------------------------------------------------------------------------------------
CURRENT_STEP="preflight"
CURRENT_BUFFER=""
CURRENT_BUFFER_AUTH=""
on_error() {
  local status=$?
  trap - ERR INT TERM
  echo
  echo "FAILED (exit $status) during: $CURRENT_STEP"
  if [ -n "$CURRENT_BUFFER" ] && [ -f "$CURRENT_BUFFER" ]; then
    local addr
    addr=$(solana-keygen pubkey "$CURRENT_BUFFER")
    echo "Buffer account: $addr"
    echo "  keypair ${CURRENT_BUFFER/#$HOME/\~}; buffer authority $(solana-keygen pubkey "$CURRENT_BUFFER_AUTH")"
    echo "  resume: run this script again (it reuses the buffer keypair and rewrites only the chunks that differ)"
    echo "  refund: solana program close $addr --url $RPC_PLACEHOLDER --keypair ${SSS_AUTH/#$HOME/\~} --authority ${CURRENT_BUFFER_AUTH/#$HOME/\~} --recipient $EXPECT_SSS_AUTH"
  fi
  exit "$status"
}
trap on_error ERR INT TERM

# ---------------------------------------------------------------------------------------------
# Preflight (local, then read-only RPC)
# ---------------------------------------------------------------------------------------------
GATE_ID=$(program_id thawgate-gate)
SSS_ID=$(program_id sss-token)
HOOK_ID=$(program_id transfer-hook)
POOL_ID=$(program_id demo-pool)
if [ -n "${SO_DIR:-}" ]; then SO_DIR="${SO_DIR%/}"; SKIP_BUILD=1; else SO_DIR=target/deploy; fi
GATE_SO=$SO_DIR/thawgate_gate.so
SSS_SO=$SO_DIR/sss_token.so
HOOK_SO=$SO_DIR/transfer_hook.so
POOL_SO=$SO_DIR/demo_pool.so

echo "== ThawGate devnet deploy (Token ACL release)$([ "$DRY_RUN" = 1 ] && echo ", DRY RUN: nothing is sent")"
echo "RPC: $RPC_SOURCE (host $RPC_HOST)"

echo
echo "== Local checks"
if [ -n "${SKIP_BUILD:-}" ]; then echo "anchor build: skipped (SKIP_BUILD or SO_DIR)"; else echo "anchor build"; anchor build 2>&1 | tail -n 3; fi
echo ".so files from ${SO_DIR/#$HOME/\~}:"
for f in "$GATE_SO" "$SSS_SO" "$HOOK_SO" "$POOL_SO"; do [ -f "$f" ] && echo "    $(sha256sum "$f" | cut -c1-64)  $(stat -c%s "$f") B  $(basename "$f")"; done
scripts/verify-ids.sh
for f in "$SSS_AUTH" "$HOOK_AUTH" "$GATE_KP" "$POOL_KP" "$GATE_AUTHORITY" "$GATE_SO" "$SSS_SO" "$HOOK_SO" "$POOL_SO"; do [ -f "$f" ] || die "missing ${f/#$HOME/\~}"; done
[ "$(solana-keygen pubkey "$SSS_AUTH")" = "$EXPECT_SSS_AUTH" ] || die "~/.config/solana/sss-authority.json is not $EXPECT_SSS_AUTH"
[ "$(solana-keygen pubkey "$HOOK_AUTH")" = "$EXPECT_HOOK_AUTH" ] || die "~/.config/solana/id.json is not $EXPECT_HOOK_AUTH"
[ "$(solana-keygen pubkey "$GATE_KP")" = "$GATE_ID" ] || die "${GATE_KP/#$HOME/\~} is not the gate's declare_id! ($GATE_ID)"
[ "$(solana-keygen pubkey "$POOL_KP")" = "$POOL_ID" ] || die "${POOL_KP/#$HOME/\~} is not demo_pool's declare_id! ($POOL_ID)"
GATE_AUTH_KEY=$(solana-keygen pubkey "$GATE_AUTHORITY")
echo "signers: 5BXg = $EXPECT_SSS_AUTH, 3YnV = $EXPECT_HOOK_AUTH; program keypairs: gate = $GATE_ID, demo_pool = $POOL_ID; their upgrade authority = $GATE_AUTH_KEY"

echo
echo "== Cluster (read-only)"
GENESIS=$(query solana genesis-hash --url "$RPC")
[ "$GENESIS" != "$MAINNET_GENESIS" ] || die "the RPC is mainnet; this script is devnet only"
if [ "$GENESIS" = "$DEVNET_GENESIS" ]; then
  CLUSTER_NAME=devnet
else
  [ "${REHEARSAL:-0}" = 1 ] || die "genesis $GENESIS is not devnet's (set REHEARSAL=1 for a local rehearsal)"
  CLUSTER_NAME="rehearsal cluster (genesis $GENESIS)"
fi
echo "cluster: $CLUSTER_NAME, $(query solana cluster-version --url "$RPC")"
FEES=$(curl -s --max-time 30 "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getRecentPrioritizationFees","params":[]}' |
  jq -r '[.result[].prioritizationFee] | sort | "\(length) slots: median \(.[length/2|floor]), max \(max)"' 2>/dev/null || echo "unavailable")
echo "recent priority fees (micro-lamports/CU, $FEES); using CU_PRICE=$CU_PRICE"

# program_state <id> <so>: "absent", "same" (on-chain bytes = the .so, zeros after) or "different"
program_state() {
  local out tmp n state=different
  out=$(solana program show "$1" --output json --url "$RPC" 2>&1) || {
    if grep -q "Unable to find the account" <<< "$out"; then echo absent; return; fi
    printf '%s\n' "$out" | mask >&2
    die "solana program show $1 failed"
  }
  tmp=$(mktemp)
  query solana program dump "$1" "$tmp" --url "$RPC" > /dev/null
  n=$(stat -c%s "$2")
  if cmp -s -n "$n" "$2" "$tmp" && [ -z "$(tail -c +"$((n + 1))" "$tmp" | tr -d '\0' | head -c 1)" ]; then state=same; fi
  rm -f "$tmp"
  echo "$state"
}
program_field() { query solana program show "$1" --output json --url "$RPC" | jq -r ".$2"; }
buffer_keypair() { echo "$BUFFER_DIR/$1-buffer.json"; }
buffer_label() {
  local f
  f=$(buffer_keypair "$1")
  if [ -f "$f" ]; then echo "$(solana-keygen pubkey "$f") (${f/#$HOME/\~}, exists: a rerun resumes it)"; else echo "new keypair at ${f/#$HOME/\~}"; fi
}
ensure_buffer_keypair() {
  local f
  f=$(buffer_keypair "$1")
  if [ ! -f "$f" ]; then
    mkdir -p "$BUFFER_DIR" && chmod 700 "$BUFFER_DIR"
    solana-keygen new --no-bip39-passphrase --silent --outfile "$f" > /dev/null
    chmod 600 "$f"
  fi
  echo "$f"
}
send_flags=(--with-compute-unit-price "$CU_PRICE" --max-sign-attempts 30)
[ "${USE_RPC:-0}" = 1 ] && send_flags+=(--use-rpc)

BAL_SSS_AUTH=$(balance "$EXPECT_SSS_AUTH")
BAL_HOOK_AUTH=$(balance "$EXPECT_HOOK_AUTH")
RENT_PROGRAM=$(rent 36)
echo "balances: 5BXg $(sol "$BAL_SSS_AUTH"), 3YnV $(sol "$BAL_HOOK_AUTH")"

# Costs per step, in lamports. PAYER_* is 5BXg's side, HOOK_AUTH_* 3YnV's.
PAYER_NET=0
PAYER_NEED=0 # the most 5BXg must hold at any point: the net of the steps before, plus the current step's peak
HOOK_AUTH_NET=0
TX_TOTAL=0

# fees <txs> <signatures per tx> -> base fees + priority fee bound
fees() { echo $(($1 * $2 * LAMPORTS_PER_SIGNATURE + $1 * CU_PRICE * CU_LIMIT_BOUND / 1000000)); }

# ---------------------------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------------------------
echo
echo "== Plan (costs from this cluster's rent; write-tx counts and priority fees are estimates, see the header)"

declare -A STATE EXTEND MODE

# Steps 1 and 4: the gate and demo_pool. plan_fresh <label> <id> <so> records the on-chain state it read, for do_fresh.
# Absent: a first deploy. Present with other bytes: an upgrade by GATE_AUTHORITY (plan_upgrade below).
plan_fresh() {
  local label=$1 id=$2 so=$3
  local len state buf pd writes txs fee peak net
  len=$(stat -c%s "$so")
  state=$(program_state "$id" "$so")
  STATE[$id]=$state
  MODE[$id]=fresh
  if [ "$state" = different ]; then
    MODE[$id]=upgrade
    plan_upgrade "$label" "$id" "$so" "$GATE_AUTHORITY" "$GATE_AUTH_KEY" "$([ "$GATE_AUTH_KEY" = "$EXPECT_SSS_AUTH" ] && echo 1 || echo 2)"
    return
  fi
  echo
  echo "$label $id: fresh deploy of $len bytes (on chain: $state)"
  case "$state" in
    same) echo "    already deployed with these bytes: skip" ;;
    absent)
      buf=$(rent $((len + 37)))
      pd=$(rent $((len + 45)))
      writes=$(((len + CHUNK_1_SIGNER - 1) / CHUNK_1_SIGNER))
      txs=$((writes + 2))
      fee=$(fees "$txs" 1)
      echo "    signers: fee payer + buffer authority + upgrade authority $GATE_AUTH_KEY; program keypair $id"
      echo "    buffer: $(buffer_label "$(basename "$so" .so)")"
      echo "    txs: ~$txs (create buffer, ~$writes writes, deploy), fees ≤ $(sol "$fee")"
      echo "    rent: buffer $(sol "$buf") while writing (returned to the payer by the deploy); ProgramData $(sol "$pd") + program account $(sol "$RENT_PROGRAM")"
      peak=$((buf + RENT_PROGRAM + fee))
      net=$((pd + RENT_PROGRAM + fee))
      echo "    5BXg: peak $(sol "$peak"), net $(sol "$net")"
      PAYER_NEED=$(max "$PAYER_NEED" $((PAYER_NET + peak)))
      PAYER_NET=$((PAYER_NET + net))
      TX_TOTAL=$((TX_TOTAL + txs))
      ;;
  esac
}

# Steps 2 and 3: upgrades. plan_upgrade <label> <id> <so> <authority keypair> <expected authority> <signers per write tx>
# records the on-chain state it read and the extend size, for do_upgrade.
plan_upgrade() {
  local label=$1 id=$2 so=$3 auth_kp=$4 auth=$5 sigs=$6
  local len on_len on_bal on_auth state need extend rent_new extend_rent buf writes txs fee refund peak net chunk
  len=$(stat -c%s "$so")
  on_auth=$(program_field "$id" authority)
  on_len=$(program_field "$id" dataLen)
  on_bal=$(program_field "$id" lamports)
  [ "$on_auth" = "$auth" ] || die "$id upgrade authority is $on_auth on chain, expected $auth"
  state=$(program_state "$id" "$so")
  STATE[$id]=$state
  need=$((len > on_len ? len - on_len : 0))
  extend=$((need > 0 && need < MIN_EXTEND ? MIN_EXTEND : need))
  EXTEND[$id]=$extend
  rent_new=$(rent $((45 + on_len + extend)))
  extend_rent=$((extend > 0 && rent_new > on_bal ? rent_new - on_bal : 0))
  echo
  echo "$label $id: upgrade to $len bytes (on chain: program length $on_len, ProgramData balance $(sol "$on_bal"), authority $on_auth; bytes $state)"
  if [ "$state" = same ]; then
    echo "    already upgraded to these bytes: skip"
    return
  fi
  if [ "$extend" -gt 0 ]; then
    echo "    extend by $extend bytes$([ "$extend" != "$need" ] && echo " ($need needed; the minimum is $MIN_EXTEND)"): signer $auth (fee payer and authority), cost $(sol "$extend_rent") rent (ProgramData needs $(sol "$rent_new") for $((45 + on_len + extend)) bytes, holds $(sol "$on_bal")) + $(sol $LAMPORTS_PER_SIGNATURE) fee"
    if [ "$auth" = "$EXPECT_SSS_AUTH" ]; then
      PAYER_NEED=$(max "$PAYER_NEED" $((PAYER_NET + extend_rent + LAMPORTS_PER_SIGNATURE)))
      PAYER_NET=$((PAYER_NET + extend_rent + LAMPORTS_PER_SIGNATURE))
    else
      HOOK_AUTH_NET=$((HOOK_AUTH_NET + extend_rent + LAMPORTS_PER_SIGNATURE))
    fi
    TX_TOTAL=$((TX_TOTAL + 1))
  else
    echo "    extend: not needed"
  fi
  buf=$(rent $((len + 37)))
  chunk=$([ "$sigs" = 1 ] && echo $CHUNK_1_SIGNER || echo $CHUNK_2_SIGNERS)
  writes=$(((len + chunk - 1) / chunk))
  txs=$((writes + 2))
  fee=$(fees "$txs" "$sigs")
  refund=$((on_bal + extend_rent + buf - rent_new))
  peak=$((buf + fee))
  net=$((buf + fee - refund))
  echo "    signers: fee payer $EXPECT_SSS_AUTH; buffer + upgrade authority $auth"
  echo "    buffer: $(buffer_label "$(basename "$so" .so)")"
  echo "    txs: ~$txs (create buffer, ~$writes writes, upgrade; $sigs signature(s) each), fees ≤ $(sol "$fee")"
  echo "    rent: buffer $(sol "$buf") while writing; the upgrade leaves ProgramData at $(sol "$rent_new") and spills $(sol "$refund") to 5BXg"
  echo "    5BXg: peak $(sol "$peak"), net $(sol "$net")"
  PAYER_NEED=$(max "$PAYER_NEED" $((PAYER_NET + peak)))
  PAYER_NET=$((PAYER_NET + net))
  TX_TOTAL=$((TX_TOTAL + txs))
}
plan_fresh "[1] thawgate_gate" "$GATE_ID" "$GATE_SO"
plan_upgrade "[2] sss_token" "$SSS_ID" "$SSS_SO" "$SSS_AUTH" "$EXPECT_SSS_AUTH" 1
plan_upgrade "[3] transfer_hook" "$HOOK_ID" "$HOOK_SO" "$HOOK_AUTH" "$EXPECT_HOOK_AUTH" 2
plan_fresh "[4] demo_pool" "$POOL_ID" "$POOL_SO"

echo
echo "== Totals"
echo "transactions: ~$TX_TOTAL"
echo "5BXg: needs $(sol "$PAYER_NEED") at the peak, has $(sol "$BAL_SSS_AUTH"); net cost ≈ $(sol "$PAYER_NET") (negative = refund)"
echo "3YnV: net cost ≈ $(sol "$HOOK_AUTH_NET"), has $(sol "$BAL_HOOK_AUTH")"
[ "$BAL_SSS_AUTH" -ge "$PAYER_NEED" ] || die "5BXg can't cover the peak"
[ "$BAL_HOOK_AUTH" -ge "$HOOK_AUTH_NET" ] || die "3YnV can't cover its extend"

# ---------------------------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "== Commands (DRY RUN: printed, not run)"
else
  if [ "${YES:-0}" != 1 ]; then
    read -r -p "Send ~$TX_TOTAL transactions to $CLUSTER_NAME? Type 'deploy': " answer || true
    [ "${answer:-}" = deploy ] || die "aborted, nothing sent"
  fi
  LOG_FILE="$HOME/.cache/thawgate/deploy-devnet-acl-$(date -u +%Y%m%dT%H%M%SZ).log"
  mkdir -p "$(dirname "$LOG_FILE")"
  # tee ignores Ctrl-C (sent to the whole process group), so the recovery message after an interrupt still prints.
  exec > >(trap '' INT TERM; exec tee -a "$LOG_FILE") 2>&1
  echo
  echo "== Sending (masked output also in ${LOG_FILE/#$HOME/\~})"
fi

buffer_for_step() { # program name: the keypair path; created only when sending
  if [ "$DRY_RUN" = 1 ]; then buffer_keypair "$1"; else ensure_buffer_keypair "$1"; fi
}

# do_fresh <label> <id> <so> <program keypair>
do_fresh() {
  local label=$1 id=$2 so=$3 program_kp=$4
  if [ "${MODE[$id]}" = upgrade ]; then do_upgrade "$label" "$id" "$so" "$GATE_AUTHORITY"; return; fi
  if [ "${STATE[$id]}" != absent ]; then echo "$label: already deployed, skip"; return; fi
  CURRENT_STEP="$label deploy"
  CURRENT_BUFFER=$(buffer_for_step "$(basename "$so" .so)")
  CURRENT_BUFFER_AUTH="$GATE_AUTHORITY"
  echo "$CURRENT_STEP"
  step solana program deploy "$so" --program-id "$program_kp" --upgrade-authority "$GATE_AUTHORITY" \
    --buffer "$CURRENT_BUFFER" --fee-payer "$SSS_AUTH" --keypair "$SSS_AUTH" --url "$RPC" "${send_flags[@]}"
}

# do_upgrade <label> <id> <so> <authority keypair>
do_upgrade() {
  local label=$1 id=$2 so=$3 auth_kp=$4
  if [ "${STATE[$id]}" = same ]; then echo "$label: already upgraded, skip"; return; fi
  CURRENT_BUFFER=""
  if [ "${EXTEND[$id]}" -gt 0 ]; then
    CURRENT_STEP="$label extend"
    echo "$CURRENT_STEP"
    step solana program extend "$id" "${EXTEND[$id]}" --keypair "$auth_kp" --url "$RPC"
  fi
  CURRENT_STEP="$label upgrade"
  CURRENT_BUFFER=$(buffer_for_step "$(basename "$so" .so)")
  CURRENT_BUFFER_AUTH="$auth_kp"
  echo "$CURRENT_STEP"
  step solana program deploy "$so" --program-id "$id" --upgrade-authority "$auth_kp" --no-auto-extend \
    --buffer "$CURRENT_BUFFER" --fee-payer "$SSS_AUTH" --keypair "$SSS_AUTH" --url "$RPC" "${send_flags[@]}"
}
do_fresh "[1] thawgate_gate" "$GATE_ID" "$GATE_SO" "$GATE_KP"
do_upgrade "[2] sss_token" "$SSS_ID" "$SSS_SO" "$SSS_AUTH"
do_upgrade "[3] transfer_hook" "$HOOK_ID" "$HOOK_SO" "$HOOK_AUTH"
do_fresh "[4] demo_pool" "$POOL_ID" "$POOL_SO" "$POOL_KP"
CURRENT_BUFFER=""

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "== DRY RUN done: nothing was sent"
  exit 0
fi
CURRENT_STEP="final check"
echo "== Result"
for id in "$GATE_ID" "$SSS_ID" "$HOOK_ID" "$POOL_ID"; do run solana program show "$id" --url "$RPC"; echo; done
for pair in "$GATE_ID:$GATE_SO" "$SSS_ID:$SSS_SO" "$HOOK_ID:$HOOK_SO" "$POOL_ID:$POOL_SO"; do
  [ "$(program_state "${pair%%:*}" "${pair#*:}")" = same ] || die "${pair%%:*} does not hold ${pair#*:} after the deploy"
done
echo "balances after: 5BXg $(sol "$(balance "$EXPECT_SSS_AUTH")"), 3YnV $(sol "$(balance "$EXPECT_HOOK_AUTH")")"
echo "All four programs match ${SO_DIR/#$HOME/\~}. Record the signatures above (and in the log) in docs/gatekit/LOG.md."
