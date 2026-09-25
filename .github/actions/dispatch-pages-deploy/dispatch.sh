#!/usr/bin/env bash
# Dispatch deploy.yml for the commit this job pushed. See action.yml.
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA (set by Actions).
# DISPATCH_ATTEMPTS / DISPATCH_SLEEP tune the wait for main (tests set them).
set -uo pipefail

head=$(git rev-parse HEAD 2>/dev/null) || {
  echo "::warning::Not in a git checkout; deploy.yml not dispatched."
  exit 0
}
if [ "$head" = "$GITHUB_SHA" ]; then
  echo "This run made no commit (HEAD is still ${GITHUB_SHA:0:7}); nothing to deploy."
  exit 0
fi

attempts=${DISPATCH_ATTEMPTS:-10}
pause=${DISPATCH_SLEEP:-3}
status=unknown
for i in $(seq 1 "$attempts"); do
  # "ahead" or "identical": main is this commit or descends from it, so a
  # deploy of main now includes it.
  status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$head...main" --jq .status 2>/dev/null) || status=error
  if [ "$status" = "ahead" ] || [ "$status" = "identical" ]; then
    gh workflow run deploy.yml --ref main --repo "$GITHUB_REPOSITORY" || {
      echo "::error::Dispatching deploy.yml failed. Does this workflow grant actions: write?"
      exit 1
    }
    echo "::notice::Dispatched deploy.yml; main contains ${head:0:7}."
    exit 0
  fi
  [ "$i" -lt "$attempts" ] && sleep "$pause"
done

# The commit never reached main (a failed or rejected push, or a push to
# another branch). There is nothing of this run's to deploy.
echo "::warning::${head:0:7} is not on main (compare status: $status); deploy.yml not dispatched."
exit 0
