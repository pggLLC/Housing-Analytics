#!/usr/bin/env bash
#
# push-inventory-sync.sh — commit the inventory/manifest corrections produced
# by the sync scripts and land them on the branch, re-reconciling if the
# branch moved underneath us.
#
# Why the re-reconcile
# -------------------
# The numbers the sync scripts produce describe the tree that was checked out.
# On main we rebase onto origin/main before pushing, and another data workflow
# may have advanced it in the meantime. Git reports no conflict — nothing
# upstream touched these two files — so the rebase replays our inventory-only
# commit cleanly onto data it never saw, and we push counts describing the
# previous revision. Nothing downstream would catch it either: this push uses
# GITHUB_TOKEN, and GitHub does not trigger workflows for such pushes, so
# ci-checks never runs on the result.
#
# So after every rebase we re-run the sync scripts against the tip we are
# actually landing on, amend if the numbers moved, and retry the whole cycle
# if the push is rejected because main advanced again.
#
# Lives in a script rather than inline in the workflow so it can be tested —
# see test/inventory-sync-push.test.js, which drives it against real git
# repositories with a genuine concurrent push.
#
# Usage:
#     scripts/audit/push-inventory-sync.sh <branch-name>
#
# Environment:
#     PUSH_ATTEMPTS   max push attempts before giving up (default 3)
#     GITHUB_OUTPUT   when set, `pushed=true|false` is appended to it

set -euo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: push-inventory-sync.sh <branch-name>" >&2
  exit 2
fi

FILES=(js/data-source-inventory.js DATA-MANIFEST.json)
SYNC_SCRIPTS=(
  scripts/audit/sync-manifest-mtimes.mjs
  scripts/audit/refresh-inventory-mtimes.mjs
)
MAX_ATTEMPTS="${PUSH_ATTEMPTS:-3}"

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

emit "pushed=false"

if git diff --quiet -- "${FILES[@]}"; then
  echo "No mtime or feature-count drift to fix today."
  exit 0
fi

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# F157 — this message used to be a `git commit -m "…"` quoted string spanning
# several unindented YAML lines, which terminated the workflow's `run: |` block
# scalar early ("Invalid workflow file: error in yaml syntax on line 66").
# Building it in a tmpfile keeps every line inside the envelope. It is still
# built here so the retry path below can reuse it verbatim.
msg=$(mktemp)
trap 'rm -f "$msg"' EXIT
{
  printf 'chore(data): sync inventory mtimes + feature counts to on-disk files\n\n'
  printf 'Automated by .github/workflows/sync-data-mtimes.yml — keeps the\n'
  printf "dashboard's stale count honest by walking each tracked file's\n"
  printf 'actual mtime and rewriting the declared lastUpdated / last_update\n'
  printf 'stamp when on-disk is newer than declared, and recomputes the\n'
  printf 'features: count for each inventory source from its committed data\n'
  printf 'file so test/data-source-inventory-drift.test.js stays green as\n'
  printf 'append-only series grow.\n'
} > "$msg"

git add -- "${FILES[@]}"
git commit -F "$msg"

if [ "$BRANCH" != "main" ]; then
  git push
  emit "pushed=true"
  exit 0
fi

attempt=1
while :; do
  git fetch origin main
  git rebase --autostash origin/main

  # Recompute against the tip we are landing on, not the one we checked out.
  # A hard failure here (an inventory the parser refuses to read) stops the
  # push: better to land nothing than to land numbers we could not verify.
  for sync_script in "${SYNC_SCRIPTS[@]}"; do
    node "$sync_script"
  done

  if ! git diff --quiet -- "${FILES[@]}"; then
    echo "origin/main advanced — re-reconciled against the new tip."
    git add -- "${FILES[@]}"
    if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
      # Our commit became empty during the rebase and was dropped. Start a
      # fresh one rather than amending someone else's tip commit.
      git commit -F "$msg"
    else
      git commit --amend --no-edit
    fi
  fi

  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    echo "Nothing left to push — origin/main already carries these corrections."
    exit 0
  fi

  if git push; then
    break
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
    echo "::error::push rejected after ${MAX_ATTEMPTS} attempts — origin/main keeps advancing"
    exit 1
  fi
  echo "Push rejected; origin/main advanced. Retry ${attempt}/${MAX_ATTEMPTS}."
done

emit "pushed=true"
