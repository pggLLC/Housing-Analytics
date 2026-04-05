#!/usr/bin/env bash
# scripts/health_check.sh
#
# Pre-flight health check for the market data build pipeline.
#
# Validates the availability of critical data sources before the main build
# script starts, so the pipeline can fail fast with a clear error message
# rather than consuming minutes of retry time before an obvious outage.
#
# Exit codes:
#   0 — all required endpoints responded with HTTP 2xx
#   1 — one or more required endpoints are unreachable
#
# Usage:
#   bash scripts/health_check.sh
#   bash scripts/health_check.sh --warn-only     # exit 0 even on failure
#
# Environment variables:
#   HEALTH_CHECK_TIMEOUT   — curl timeout per request in seconds (default: 15)
#   HEALTH_CHECK_WARN_ONLY — set to "1" to exit 0 regardless of failures

set -euo pipefail

TIMEOUT="${HEALTH_CHECK_TIMEOUT:-15}"
WARN_ONLY="${HEALTH_CHECK_WARN_ONLY:-0}"

# Allow --warn-only CLI flag
for arg in "$@"; do
  if [[ "$arg" == "--warn-only" ]]; then
    WARN_ONLY=1
  fi
done

# ── Colour helpers ─────────────────────────────────────────────────────────────
_green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
_yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
_red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

# ── Endpoints to check ─────────────────────────────────────────────────────────
# Format: "LABEL|URL|REQUIRED(true/false)"
#
# REQUIRED=true  → failure causes the script to exit 1 (unless --warn-only)
# REQUIRED=false → failure emits a warning but does not block the build
declare -a ENDPOINTS=(
  "TIGERweb Tracts_Blocks MapServer|https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer?f=json|true"
  "Census ACS API|https://api.census.gov/data.json|true"
  "HUD LIHTC public dataset|https://hudgis-hud.opendata.arcgis.com/datasets/8c3c3b26-38f1-4e06-a8f7-a0f2a60cc4d2_0.geojson|false"
  "Census Cartographic Boundaries (GENZ2024)|https://www2.census.gov/geo/tiger/GENZ2024/json/cb_2024_08_tract_500k.json|false"
  "Census Cartographic Boundaries (GENZ2023)|https://www2.census.gov/geo/tiger/GENZ2023/json/cb_2023_08_tract_500k.json|false"
)

# ── Check function ─────────────────────────────────────────────────────────────
check_endpoint() {
  local label="$1"
  local url="$2"
  local required="$3"

  # Use curl with --head (HEAD request) and follow redirects.
  # --silent suppresses progress; --output /dev/null discards body.
  local http_code
  http_code=$(
    curl \
      --silent \
      --head \
      --location \
      --max-time "$TIMEOUT" \
      --write-out '%{http_code}' \
      --output /dev/null \
      --user-agent "pma-health-check/1.0" \
      "$url" 2>/dev/null
  ) || http_code="000"

  local status_class="${http_code:0:1}"

  if [[ "$http_code" == "000" ]]; then
    if [[ "$required" == "true" ]]; then
      _red    "  ✗ [REQUIRED] $label — connection failed (curl error)"
    else
      _yellow "  ⚠ [optional] $label — connection failed (curl error)"
    fi
    return 1
  elif [[ "$status_class" == "2" ]] || [[ "$http_code" == "301" ]] || [[ "$http_code" == "302" ]]; then
    _green "  ✓ $label — HTTP $http_code"
    return 0
  else
    if [[ "$required" == "true" ]]; then
      _red    "  ✗ [REQUIRED] $label — HTTP $http_code"
    else
      _yellow "  ⚠ [optional] $label — HTTP $http_code"
    fi
    return 1
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════"
echo "  Market Data Pipeline — Health Check"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Checking data source availability (timeout: ${TIMEOUT}s per endpoint)…"
echo ""

required_failures=0
optional_failures=0

for entry in "${ENDPOINTS[@]}"; do
  IFS='|' read -r label url required <<< "$entry"
  if check_endpoint "$label" "$url" "$required"; then
    :  # success
  else
    if [[ "$required" == "true" ]]; then
      (( required_failures++ )) || true
    else
      (( optional_failures++ )) || true
    fi
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════"

if [[ "$required_failures" -gt 0 ]]; then
  _red "RESULT: $required_failures required source(s) unreachable — build may degrade."
  echo ""
  echo "  The build will attempt to use cached fallback data when available."
  echo "  Re-run once the upstream services recover, or investigate the URLs above."
  if [[ "$WARN_ONLY" == "1" ]]; then
    _yellow "  (--warn-only / HEALTH_CHECK_WARN_ONLY=1 set — continuing despite failures)"
    exit 0
  fi
  exit 1
elif [[ "$optional_failures" -gt 0 ]]; then
  _yellow "RESULT: $optional_failures optional source(s) unreachable — build will use cached data."
  exit 0
else
  _green "RESULT: All data sources are reachable ✓"
  exit 0
fi
