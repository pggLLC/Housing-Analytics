#!/usr/bin/env bash
# scripts/commit-summary-backfill.sh — commit an ACS summary backfill together
# with everything derived from it, or commit nothing and fail.
#
# Used by the three backfill-hna-*.yml workflows. Each one rewrites
# data/hna/summary/*.json. Those summaries are inputs to the ranking index and
# the jurisdiction digests, so committing them alone leaves main describing
# data that no longer exists. On 2026-10-01 (91971a979) that left 30 digests
# stale on main with no failing run: data commits skip CI, and every open PR
# then failed on files it never touched (#2063). The repair was by hand (#2062).
#
# Order, each step for a reason:
#   1. npm run rebuild:derived — the whole chain, never a subset. It ends with
#      data/_manifest.json then data/manifest.json, in that order (the second
#      records the first's byte count).
#   2. validate-schemas — the data must still parse against its schemas.
#   3. commit the summaries AND every derived path, in one commit. Anything the
#      chain writes outside that list fails the job instead of being dropped.
#   4. the freshness checkers, AFTER the commit — they rebuild their targets and
#      restore them with `git checkout --`, so they refuse a dirty tree.
#   5. rebase onto main and push. A rebase that does not apply cleanly fails;
#      it is never swallowed.
#
# Usage: scripts/commit-summary-backfill.sh "<commit subject>" [--no-push]
# Writes pushed=true|false to $GITHUB_OUTPUT when that is set.
set -euo pipefail

subject="${1:?commit subject required}"
push=true
[ "${2:-}" = "--no-push" ] && push=false
out="${GITHUB_OUTPUT:-/dev/null}"
echo "pushed=false" >> "$out"

if [ -z "$(git status --porcelain -- 'data/hna/summary/')" ]; then
  echo "No summary changes — nothing to rebuild or commit."
  exit 0
fi

# Every path the derived chain writes, plus the summaries themselves. Measured
# from a full chain run; keep in step with scripts/rebuild-derived.mjs CHAIN.
PATHS=(
  data/hna/summary
  data/hna/ranking-index.json
  data/hna/ranking-scenarios
  data/hna/jurisdiction-metrics-digest
  data/hna/ownership-need.json
  data/jurisdiction-briefs
  data/home-snapshot.json
  places
  data/paper
  working-paper.html
  methods.html
  AGENTS.md
  README.md
  data/_manifest.json
  data/manifest.json
)

npm run rebuild:derived
node scripts/validate-schemas.js

excludes=()
for p in "${PATHS[@]}"; do excludes+=(":!$p"); done
outside="$(git status --porcelain -- . "${excludes[@]}" | head -20)"
if [ -n "$outside" ]; then
  echo "::error::rebuild:derived wrote files outside the committed path list:" >&2
  echo "$outside" >&2
  echo "Add them to PATHS in scripts/commit-summary-backfill.sh, or stop writing them." >&2
  exit 1
fi

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -- "${PATHS[@]}"
n_summary=$(git diff --cached --name-only -- data/hna/summary | wc -l | tr -d ' ')
n_total=$(git diff --cached --name-only | wc -l | tr -d ' ')
msg=$(mktemp)
{
  printf '%s\n\n' "$subject"
  printf '%s\n' "${n_summary} summary files, ${n_total} files in total with the derived chain"
  printf '%s\n' '(ranking index, scenarios, digests, briefs, snapshot, place pages, paper,'
  printf '%s\n\n' 'inventory and both manifests), rebuilt by npm run rebuild:derived.'
  printf '%s\n' "Committed by scripts/commit-summary-backfill.sh from ${GITHUB_WORKFLOW:-a local run}."
} > "$msg"
git commit -q -F "$msg"
rm -f "$msg"

# After the commit: the checkers refuse a dirty tree, and restore what they build.
node scripts/check-jurisdiction-digest-fresh.mjs
python3 scripts/check-ranking-index-fresh.py

if [ "$push" != true ]; then
  echo "Committed locally (--no-push)."
  exit 0
fi

git fetch origin main
if ! git rebase origin/main; then
  git rebase --abort || true
  echo "::error::the backfill commit does not rebase cleanly onto main; nothing was pushed." >&2
  exit 1
fi
# main may have moved under us; the manifests record byte counts of the tree.
npm run audit:file-manifest
python3 scripts/rebuild_manifest.py
if ! git diff --quiet -- data/_manifest.json data/manifest.json; then
  git add data/_manifest.json data/manifest.json
  git commit -q --amend --no-edit
fi
git push origin HEAD:main
echo "pushed=true" >> "$out"
