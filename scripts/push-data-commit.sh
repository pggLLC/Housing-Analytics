#!/usr/bin/env bash
# scripts/push-data-commit.sh — commit a data workflow's own files, rebase onto
# the target branch, then rebuild both manifests from the rebased tree and push.
#
# For a workflow whose files feed nothing in the derived chain (that is
# scripts/commit-with-derived-chain.sh's job). The order is the point:
# almost every commit to main rewrites data/_manifest.json and
# data/manifest.json, so a workflow that commits them and then rebases
# conflicts whenever anything landed on main while it ran. Polymarket's
# 2026-10-17 run failed exactly that way. Here the first commit carries only
# the workflow's own paths, which rebase cleanly; the manifests are rebuilt
# after the rebase, describe the tree that is actually pushed, and are folded
# into the same commit.
#
# Usage: scripts/push-data-commit.sh "<commit subject>" -- <path>...
# DATA_COMMIT_BRANCH defaults to main. Writes pushed=true|false to $GITHUB_OUTPUT.
set -euo pipefail

subject="${1:?commit subject required}"; shift
[ "${1:-}" = "--" ] && shift
PATHS=("$@")
[ "${#PATHS[@]}" -gt 0 ] || { echo "::error::no paths given" >&2; exit 2; }
branch="${DATA_COMMIT_BRANCH:-main}"
git check-ref-format --branch "$branch" >/dev/null
out="${GITHUB_OUTPUT:-/dev/null}"
echo "pushed=false" >> "$out"

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -- "${PATHS[@]}"
if git diff --cached --quiet; then
  echo "No changes in ${PATHS[*]}; nothing to commit."
  exit 0
fi
git commit -q -m "$subject"

# A push is refused when anything lands on the branch between the fetch and
# the push: a PR merged at 11:09Z failed Polymarket's 2026-10-19 run that way
# (PR merges are not in the data-commits queue). On a refusal, take the
# manifests back out of the commit and go round again from the fetch.
MANIFESTS=(data/_manifest.json data/manifest.json)
for attempt in 1 2 3; do
  git fetch origin "$branch"
  # No -X theirs and no || true: a conflict here means another commit changed
  # this workflow's own files, which needs a person, not a silent pick.
  git rebase "origin/$branch"

  # Two manifests, in this order: data/manifest.json records the byte count of
  # data/_manifest.json (AGENTS.md, two-manifest trap).
  npm run -s audit:file-manifest
  python3 scripts/rebuild_manifest.py
  node scripts/validate-schemas.js
  git add "${MANIFESTS[@]}"
  if ! git diff --cached --quiet; then
    git commit -q --amend --no-edit
  fi
  if git push origin "HEAD:$branch"; then
    echo "pushed=true" >> "$out"
    exit 0
  fi
  echo "::warning::push attempt $attempt refused; $branch moved, rebasing again."
  git checkout HEAD~1 -- "${MANIFESTS[@]}"
  git commit -q --amend --no-edit --allow-empty
done
echo "::error::push refused three times; $branch keeps moving." >&2
exit 1
