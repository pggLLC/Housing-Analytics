#!/bin/bash
# verify-phase2.sh
# Verifies that Phase 2.1 constraint modules and supporting data files are present
# and structurally valid. Exits with code 0 on success, 1 on failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0

check_file() {
  local path="$REPO_ROOT/$1"
  if [ -f "$path" ]; then
    echo "  ✓  $1"
    PASS=$((PASS + 1))
  else
    echo "  ✗  $1  — MISSING"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local path="$REPO_ROOT/$1"
  if [ -f "$path" ] && node -e "JSON.parse(require('fs').readFileSync('$path','utf8'))" 2>/dev/null; then
    echo "  ✓  $1  (valid JSON)"
    PASS=$((PASS + 1))
  elif [ ! -f "$path" ]; then
    echo "  ✗  $1  — MISSING"
    FAIL=$((FAIL + 1))
  else
    echo "  ✗  $1  — INVALID JSON"
    FAIL=$((FAIL + 1))
  fi
}

echo "Phase 2.1 constraint module verification"
echo "========================================"

echo ""
echo "JS modules:"
check_file "js/environmental-screening.js"
check_file "js/public-land-overlay.js"
check_file "js/soft-funding-tracker.js"
check_file "js/chfa-award-predictor.js"

echo ""
echo "Data files:"
check_json "data/environmental/epa-superfund-co.json"
check_json "data/policy/soft-funding-status.json"
check_json "data/policy/chfa-awards-historical.json"
check_json "data/policy/county-ownership.json"
check_file "data/environmental/fema-flood-co.geojson"

echo ""
echo "========================================"
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  echo "ERROR: ${FAIL} check(s) failed."
  exit 1
fi

echo "All Phase 2.1 checks passed."
exit 0
