#!/usr/bin/env bash
# Link check for every tracked Markdown file except evidence/ (historical logs, never rewritten):
#   1. lychee, offline: relative links and #anchors;
#   2. lychee, online: external links (explorer.solana.com is checked on chain instead, in step 3);
#   3. explorer-check.js: every explorer tx / address link exists on its cluster;
#   4. gh-anchors.js: every file#anchor link against GitHub's own rendering of a pushed commit (default origin/main).
# Needs lychee on PATH or in $LYCHEE (a release binary; S16 used 0.24.2), gh, node, and HELIUS_DEVNET_RPC in .env.
# Usage: scripts/docs/check-links.sh [commit pushed to GitHub]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
LYCHEE=${LYCHEE:-lychee}
REF=${1:-$(git rev-parse origin/main)}
mapfile -t files < <(git ls-files '*.md' | grep -v '^evidence/')
# GlobeNewswire refuses non-browser clients (HTTP/2 INTERNAL_ERROR); the page loads in a browser (checked in S16).
exclude=(--exclude 'explorer\.solana\.com' --exclude '^https?://(localhost|127\.0\.0\.1)' --exclude 'globenewswire\.com')
status=0
echo "== lychee, offline"
"$LYCHEE" --offline --include-fragments --no-progress --format compact "${files[@]}" || status=1
echo "== lychee, online"
GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token)} "$LYCHEE" --no-progress --format compact "${exclude[@]}" \
  --max-concurrency 4 --timeout 30 --max-retries 3 "${files[@]}" || status=1
echo "== explorer links on chain"
printf '%s\n' "${files[@]}" | node scripts/docs/explorer-check.js || status=1
echo "== anchors against GitHub at $REF"
printf '%s\n' "${files[@]}" | node scripts/docs/gh-anchors.js "$REF" || status=1
exit $status
