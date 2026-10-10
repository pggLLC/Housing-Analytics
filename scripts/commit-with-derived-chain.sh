#!/usr/bin/env bash
# scripts/commit-with-derived-chain.sh — commit files that feed the ranking
# index together with everything derived from them, or commit nothing and fail.
#
# For any workflow that writes an input of the derived chain (the ACS summary
# backfills, the HUD QCT/DDA cache, the CHAS fetch). Committing such an input
# alone leaves main describing data that no longer exists. On 2026-10-01 (91971a979) that left 30 digests
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
#   5. rebase onto the target branch. On conflict, retry once from its new
#      tip: re-apply only the input diff and rebuild the whole chain. An input
#      diff that cannot apply, or a second rebase conflict, fails without pushing.
#   6. regenerate manifests from the rebased tree, and push.
#
# Usage: scripts/commit-with-derived-chain.sh "<commit subject>" [--no-push] -- <input path>...
#   The input paths are what the workflow itself wrote; the chain's outputs are
#   added below. Nothing happens unless one of the input paths changed.
# DERIVED_COMMIT_BRANCH defaults to main; a caller may preserve its selected ref.
# Writes pushed=true|false to $GITHUB_OUTPUT when that is set.
set -euo pipefail

subject="${1:?commit subject required}"; shift
push=true
if [ "${1:-}" = "--no-push" ]; then push=false; shift; fi
[ "${1:-}" = "--" ] && shift
INPUTS=("$@")
[ "${#INPUTS[@]}" -gt 0 ] || { echo "::error::no input paths given" >&2; exit 2; }
target_branch="${DERIVED_COMMIT_BRANCH:-main}"
git check-ref-format --branch "$target_branch" >/dev/null
out="${GITHUB_OUTPUT:-/dev/null}"
echo "pushed=false" >> "$out"

if [ -z "$(git status --porcelain -- "${INPUTS[@]}")" ]; then
  echo "No changes in ${INPUTS[*]} — nothing to rebuild or commit."
  exit 0
fi

# The workflow's own inputs plus every path the derived chain writes. Measured
# from a full chain run; keep in step with scripts/rebuild-derived.mjs CHAIN.
PATHS=(
  "${INPUTS[@]}"
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

# Capture the fetcher's changes before rebuilding; include newly created inputs.
# Generated outputs must never be carried into a conflict retry from the old tip.
input_patch=$(mktemp)
trap 'rm -f "$input_patch"' EXIT
git add -- "${INPUTS[@]}"
git diff --cached --binary HEAD -- "${INPUTS[@]}" > "$input_patch"

rebuild_and_commit() {
  npm run rebuild:derived
  node scripts/validate-schemas.js

  excludes=()
  for p in "${PATHS[@]}"; do excludes+=(":!$p"); done
  outside="$(git status --porcelain -- . "${excludes[@]}" | head -20)"
  if [ -n "$outside" ]; then
    echo "::error::rebuild:derived wrote files outside the committed path list:" >&2
    echo "$outside" >&2
    echo "Add them to PATHS in scripts/commit-with-derived-chain.sh, or stop writing them." >&2
    exit 1
  fi

  git config user.name  "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add -- "${PATHS[@]}"
  n_inputs=$(git diff --cached --name-only -- "${INPUTS[@]}" | wc -l | tr -d ' ')
  n_total=$(git diff --cached --name-only | wc -l | tr -d ' ')
  msg=$(mktemp)
  {
    printf '%s\n\n' "$subject"
    printf '%s\n' "${n_inputs} input files, ${n_total} files in total with the derived chain"
    printf '%s\n' '(ranking index, scenarios, digests, briefs, snapshot, place pages, paper,'
    printf '%s\n\n' 'inventory and both manifests), rebuilt by npm run rebuild:derived.'
    printf '%s\n' "Committed by scripts/commit-with-derived-chain.sh from ${GITHUB_WORKFLOW:-a local run}."
  } > "$msg"
  git commit -q -F "$msg"
  rm -f "$msg"

  # After the commit: the checkers refuse a dirty tree, and restore what they build.
  node scripts/check-jurisdiction-digest-fresh.mjs
  python3 scripts/check-ranking-index-fresh.py
}

rebuild_and_commit

if [ "$push" != true ]; then
  echo "Committed locally (--no-push)."
  exit 0
fi

git fetch origin "$target_branch"
if ! git rebase "origin/$target_branch"; then
  git rebase --abort
  git fetch origin "$target_branch"
  echo "Rebase conflicted; retrying once from the new tip with inputs only."
  git reset --hard "origin/$target_branch"
  if ! git apply --3way --index "$input_patch"; then
    git reset --hard "origin/$target_branch"
    echo "::error::input changes conflict with the new tip; nothing was pushed." >&2
    exit 1
  fi
  rebuild_and_commit
  git fetch origin "$target_branch"
  if ! git rebase "origin/$target_branch"; then
    git rebase --abort
    echo "::error::rebase still conflicts after one complete rebuild retry; nothing was pushed." >&2
    exit 1
  fi
fi
# main may have moved under us; the manifests record byte counts of the tree.
npm run audit:file-manifest
python3 scripts/rebuild_manifest.py
if ! git diff --quiet -- data/_manifest.json data/manifest.json; then
  git add data/_manifest.json data/manifest.json
  git commit -q --amend --no-edit
fi
git push origin "HEAD:$target_branch"
echo "pushed=true" >> "$out"
