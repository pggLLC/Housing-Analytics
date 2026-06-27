#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${COHO_BACKEND_REPO:-$HOME/coho-backend}"

if [[ ! -x "$BACKEND/build-bundle.sh" ]]; then
  echo "ERROR: gated backend not found at $BACKEND" >&2
  echo "Set COHO_BACKEND_REPO to the coho-backend checkout." >&2
  exit 1
fi

"$BACKEND/build-bundle.sh" "$ROOT"
echo "Gated test bundle synced from $ROOT."
