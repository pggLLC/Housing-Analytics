#!/usr/bin/env bash
# Dispatch ci-checks.yml on a branch this job just pushed, once GitHub's API
# reports the pushed commit as that branch's tip. See action.yml.
#
# Usage: dispatch.sh <branch> <sha>
# Env:   GH_TOKEN, GITHUB_REPOSITORY (set by Actions).
#        DISPATCH_ATTEMPTS / DISPATCH_SLEEP tune the wait (tests set them).
#
# Why wait: `git push` returns before every replica of the ref store has the
# new tip. `gh workflow run --ref <branch>` resolves the branch server-side at
# dispatch time, so dispatching immediately can run ci-checks on the PREVIOUS
# tip -- a green check for a commit nobody changed, while the new head goes
# unverified. Same race as F-WD-01 (qa-status.yml) and
# .github/actions/dispatch-pages-deploy (#1875); this one fails loudly instead
# of dispatching anyway, because a check on the wrong commit is worse than none.
set -uo pipefail

branch=${1:-}
sha=${2:-}
if [ -z "$branch" ] || [ -z "$sha" ]; then
  echo "::error::dispatch-ci-checks needs a branch and the pushed SHA (got branch='$branch' sha='$sha')."
  exit 1
fi
if [ "$branch" = "main" ]; then
  echo "::error::dispatch-ci-checks is for PR branches; main is verified by ci-checks' own triggers."
  exit 1
fi

attempts=${DISPATCH_ATTEMPTS:-20}
pause=${DISPATCH_SLEEP:-3}
tip=unknown
for i in $(seq 1 "$attempts"); do
  tip=$(gh api "repos/$GITHUB_REPOSITORY/branches/$branch" --jq .commit.sha 2>/dev/null) || tip=error
  if [ "$tip" = "$sha" ]; then
    gh workflow run ci-checks.yml --repo "$GITHUB_REPOSITORY" --ref "$branch" || {
      echo "::error::Dispatching ci-checks.yml failed. Does this workflow grant actions: write?"
      exit 1
    }
    echo "::notice::Dispatched ci-checks.yml on $branch at ${sha:0:7}."
    exit 0
  fi
  echo "Waiting for $branch to report ${sha:0:7} (API has ${tip:0:7}), attempt $i/$attempts…"
  [ "$i" -lt "$attempts" ] && sleep "$pause"
done

echo "::error::$branch still reports ${tip:0:7}, not the pushed ${sha:0:7}, after $attempts attempts; ci-checks NOT dispatched. The PR head is unverified -- dispatch ci-checks.yml on $branch by hand."
exit 1
