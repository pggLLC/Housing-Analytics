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
#   5. take the repo-wide tail (TAIL below) back out of the commit, then
#      rebase onto the target branch. On conflict, or when the branch changed
#      anything besides the tail, retry once from its new tip: re-apply only
#      the input diff and rebuild the whole chain. An input
#      diff that cannot apply, or a second rebase conflict, fails without pushing.
#   6. rebuild the tail from the rebased tree, fold it into the commit, and push.
#
# The tail is the paper, methods and working-paper pages, the inventory line and
# both manifests. They measure the whole repository, so nearly every commit to
# main rewrites them, and a commit that carries them into a rebase conflicts
# whenever anything lands during the six-minute chain. On 2026-11-04 the BPS
# rebuild conflicted on exactly these six files twice, on the first rebase and
# on the retry, and pushed nothing. Rebuilt after the rebase they describe the
# tree that is pushed, as scripts/push-data-commit.sh does for the manifests.
#
# Usage: scripts/commit-with-derived-chain.sh "<commit subject>" [--no-push] [--validate-critical] -- <input path>...
#   --validate-critical also runs scripts/validate-critical-data.js (the data
#   bounds, ranking-index metrics included) on every rebuilt tree before it is
#   committed, so out-of-range output from a retry cannot be pushed either.
#   The input paths are what the workflow itself wrote; the chain's outputs are
#   added below. Nothing happens unless one of the input paths changed.
# DERIVED_COMMIT_BRANCH defaults to main; a caller may preserve its selected ref.
# Writes pushed=true|false to $GITHUB_OUTPUT when that is set.
set -euo pipefail

subject="${1:?commit subject required}"; shift
push=true
validate_critical=false
while [ "${1:-}" = "--no-push" ] || [ "${1:-}" = "--validate-critical" ]; do
  case "$1" in
    --no-push) push=false ;;
    --validate-critical) validate_critical=true ;;
  esac
  shift
done
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
  docs/qa/metric-digest-coverage-2026-06-30.md
  data/hna/ownership-need.json
  data/jurisdiction-briefs
  data/home-snapshot.json
  places
  data/market/acs_median_rent_co.json
  data/derived/funding-vs-need.json
  data/market/development-activity.json
  data/policy/prop123-land-banking-status.json
  data/derived/funding-map.json
  data/market/market-direction.json
  data/policy/leading-signals.json
  data/market/market-types.json
  data/paper
  working-paper.html
  methods.html
  AGENTS.md
  README.md
  data/_manifest.json
  data/manifest.json
)

# Outputs that measure the whole repository (see step 5). Rebuilt after every
# rebase, in the chain's own order: paper, inventory, then the two manifests.
TAIL=(
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
  if [ "$validate_critical" = true ]; then
    node scripts/validate-critical-data.js
  fi

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

# Take the tail back out of the last commit, so a rebase never meets it.
drop_tail() {
  # --no-overlay also removes tail files the chain created; a plain checkout
  # would leave them in the commit to meet main's copy in an add/add conflict.
  git checkout --no-overlay HEAD~1 -- "${TAIL[@]}"
  git commit -q --amend --no-edit --allow-empty
}

rebuild_and_commit

if [ "$push" != true ]; then
  echo "Committed locally (--no-push)."
  exit 0
fi

drop_tail
built_on=$(git rev-parse HEAD~1)
git fetch origin "$target_branch"
tail_excludes=()
for p in "${TAIL[@]}"; do tail_excludes+=(":!$p"); done
retry=""
if ! git rebase "origin/$target_branch"; then
  git rebase --abort
  retry="Rebase conflicted"
elif [ -n "$(git diff --name-only "$built_on" "origin/$target_branch" -- . "${tail_excludes[@]}")" ]; then
  # A clean rebase is not enough when the branch changed more than the tail:
  # a chain input may have moved, so the derived outputs are rebuilt from the
  # new tip, as the always-conflicting manifests used to force.
  retry="$target_branch changed more than the tail"
fi
if [ -n "$retry" ]; then
  git fetch origin "$target_branch"
  echo "$retry; retrying once from the new tip with inputs only."
  git reset --hard "origin/$target_branch"
  if ! git apply --3way --index "$input_patch"; then
    git reset --hard "origin/$target_branch"
    echo "::error::input changes conflict with the new tip; nothing was pushed." >&2
    exit 1
  fi
  rebuild_and_commit
  drop_tail
  built_on=$(git rev-parse HEAD~1)
  git fetch origin "$target_branch"
  if ! git rebase "origin/$target_branch"; then
    git rebase --abort
    echo "::error::rebase still conflicts after one complete rebuild retry; nothing was pushed." >&2
    exit 1
  fi
  # The retry's outputs describe built_on; a clean rebase over a branch that
  # changed more than the tail could carry outputs of inputs that moved.
  if [ -n "$(git diff --name-only "$built_on" "origin/$target_branch" -- . "${tail_excludes[@]}")" ]; then
    echo "::error::$target_branch changed more than the tail again during the rebuild retry; nothing was pushed." >&2
    exit 1
  fi
fi
# Rebuild the tail from the rebased tree; the manifests record its byte counts.
npm run paper:build
node scripts/compute-inventory.mjs --write
npm run audit:file-manifest
python3 scripts/rebuild_manifest.py
git add -- "${TAIL[@]}"
if ! git diff --cached --quiet; then
  git commit -q --amend --no-edit
fi
git push origin "HEAD:$target_branch"
echo "pushed=true" >> "$out"
