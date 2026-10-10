#!/usr/bin/env bash
# scripts/commit-summary-backfill.sh — the ACS summary backfills' entry point
# (#2063). The work is in scripts/commit-with-derived-chain.sh, shared with
# every workflow that commits an input of the derived chain (#2092).
#
# Usage: scripts/commit-summary-backfill.sh "<commit subject>" [--no-push]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
subject="${1:?commit subject required}"; shift
exec "$here/commit-with-derived-chain.sh" "$subject" "$@" -- data/hna/summary
