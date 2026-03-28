#!/usr/bin/env bash
# scripts/setup-census-api-key.sh
# Guided setup for the CENSUS_API_KEY GitHub Actions secret.
#
# Resolves issues #408 (Market Data build failure) and #409 (Weekly Data Sync failure).
#
# Usage:
#   bash scripts/setup-census-api-key.sh [--repo owner/repo] [--check-only]
#
# Requirements:
#   - GitHub CLI (gh) authenticated with repo access
#   - curl (for key validation)
#
# Exit codes:
#   0 — key set (or already present) and validated
#   1 — key missing or invalid
#   2 — gh CLI not available or not authenticated

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
REPO="${GH_REPO:-}"
CHECK_ONLY=false
KEY_URL="https://api.census.gov/data/key_signup.html"
VALIDATION_URL="https://api.census.gov/data/2022/acs/acs5?get=NAME&for=state:08&key="
SECRET_NAME="CENSUS_API_KEY"

# ── Colours ───────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo "${CYAN}ℹ${RESET}  $*"; }
success() { echo "${GREEN}✅${RESET} $*"; }
warn()    { echo "${YELLOW}⚠️${RESET}  $*"; }
error()   { echo "${RED}❌${RESET} $*" >&2; }
header()  { echo ""; echo "${BOLD}$*${RESET}"; echo "$(printf '─%.0s' $(seq 1 ${#1}))"; }

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)        REPO="$2";    shift 2 ;;
    --check-only)  CHECK_ONLY=true; shift ;;
    -h|--help)
      echo "Usage: bash scripts/setup-census-api-key.sh [--repo owner/repo] [--check-only]"
      echo ""
      echo "  --repo owner/repo   Target GitHub repository (defaults to current repo)"
      echo "  --check-only        Only verify whether the secret is set; do not prompt to add it"
      exit 0
      ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Check prerequisites ───────────────────────────────────────────────────────
header "Pre-flight checks"

if ! command -v gh &>/dev/null; then
  error "GitHub CLI (gh) is not installed."
  echo "  Install from https://cli.github.com/ then run:"
  echo "  gh auth login"
  exit 2
fi

if ! gh auth status &>/dev/null; then
  error "GitHub CLI is not authenticated. Run: gh auth login"
  exit 2
fi
success "GitHub CLI authenticated"

# Resolve repo if not provided
if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
fi
if [[ -z "$REPO" ]]; then
  error "Could not determine repository. Pass --repo owner/repo or run from the repo directory."
  exit 1
fi
info "Repository: $REPO"

# ── Check if secret is already set ───────────────────────────────────────────
header "Checking ${SECRET_NAME} secret"

SECRET_STATUS=$(gh secret list --repo "$REPO" 2>/dev/null | grep -c "^${SECRET_NAME}" || true)

if [[ "$SECRET_STATUS" -gt 0 ]]; then
  success "${SECRET_NAME} is already configured in GitHub Secrets"
  info "To verify the key works, re-run the workflow:"
  echo "  gh workflow run build-market-data.yml --repo $REPO"
  exit 0
fi

warn "${SECRET_NAME} is NOT set in GitHub Secrets"
echo "  This is the root cause of issues #408 and #409."

if [[ "$CHECK_ONLY" == "true" ]]; then
  error "Secret missing (--check-only mode; not prompting)"
  exit 1
fi

# ── Guide the user through getting a key ─────────────────────────────────────
header "Getting a Census API key"

echo "  1. Open ${KEY_URL}"
echo "     (A free key will be emailed within a few minutes)"
echo ""
echo "  ${YELLOW}Press ENTER to open the signup page (if a browser is available),${RESET}"
echo "  ${YELLOW}or Ctrl-C to skip and enter your key manually below.${RESET}"
read -r _ENTER || true

# Try to open the browser (non-fatal if xdg-open/open not available)
if command -v xdg-open &>/dev/null; then
  xdg-open "$KEY_URL" 2>/dev/null || true
elif command -v open &>/dev/null; then
  open "$KEY_URL" 2>/dev/null || true
fi

# ── Prompt for the key ────────────────────────────────────────────────────────
header "Enter your Census API key"

while true; do
  echo -n "  Paste your key (40 hex characters): "
  read -r CENSUS_KEY

  CENSUS_KEY="${CENSUS_KEY// /}"   # strip whitespace

  if [[ ${#CENSUS_KEY} -ne 40 ]]; then
    warn "Census keys are exactly 40 characters (got ${#CENSUS_KEY}). Try again."
    continue
  fi

  if ! [[ "$CENSUS_KEY" =~ ^[a-fA-F0-9]+$ ]]; then
    warn "Census keys contain only hex characters (a-f, 0-9). Try again."
    continue
  fi

  break
done

# ── Validate the key against the Census API ───────────────────────────────────
header "Validating key"

info "Checking key against Census ACS endpoint…"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${VALIDATION_URL}${CENSUS_KEY}" 2>/dev/null || true)

case "$HTTP_CODE" in
  200) success "Key validated (HTTP 200 ✅)" ;;
  401) error "Census API returned 401 — key is invalid or not yet activated (keys can take up to 1 hour to activate). Set the secret anyway and re-run the workflow in an hour."
       echo -n "  Set secret anyway? [y/N] "
       read -r CONFIRM
       if [[ "${CONFIRM,,}" != "y" ]]; then
         warn "Aborted — secret not set."
         exit 1
       fi ;;
  429) warn "Rate-limited (HTTP 429) — key appears valid but is rate-limited. Setting secret." ;;
  000) warn "Could not reach Census API (network issue?). Setting secret without online validation." ;;
  *)   warn "Unexpected HTTP $HTTP_CODE — setting secret without online validation." ;;
esac

# ── Set the secret ────────────────────────────────────────────────────────────
header "Setting GitHub secret"

echo "$CENSUS_KEY" | gh secret set "$SECRET_NAME" --repo "$REPO" --body -
success "${SECRET_NAME} added to $REPO"

# ── Next steps ────────────────────────────────────────────────────────────────
header "Next steps"

echo "  1. Re-run the market data build:"
echo "     gh workflow run build-market-data.yml --repo $REPO"
echo ""
echo "  2. Monitor the run:"
echo "     gh run watch --repo $REPO"
echo ""
echo "  3. Close issues #408 and #409 once the build succeeds."
echo ""
echo "  See .github/WORKFLOW_TROUBLESHOOTING.md for additional guidance."
echo ""
success "Done"
