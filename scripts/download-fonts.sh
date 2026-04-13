#!/usr/bin/env bash
# scripts/download-fonts.sh
#
# Downloads self-hosted web font files for the COHO Analytics platform.
# Requires curl (available on macOS, most Linux distributions, and WSL).
#
# Usage:
#   bash scripts/download-fonts.sh
#
# The script places .woff2 files under assets/fonts/ so that
# css/site-theme.css can load them without any external CDN dependency.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FONTS_DIR="$REPO_ROOT/assets/fonts"

PJS_DIR="$FONTS_DIR/plus-jakarta-sans"
DMM_DIR="$FONTS_DIR/dm-mono"

mkdir -p "$PJS_DIR" "$DMM_DIR"

# ── Plus Jakarta Sans ──────────────────────────────────────────────────────
# Source: https://fonts.google.com/specimen/Plus+Jakarta+Sans (OFL 1.1)
# GitHub: https://github.com/tokotype/PlusJakartaSans

BASE_PJS="https://fonts.gstatic.com/s/plusjakartasans"

echo "Downloading Plus Jakarta Sans..."

# Weight 400 — Regular
curl -fsSL "${BASE_PJS}/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-Regular.woff2"

# Weight 400 — Italic
curl -fsSL "${BASE_PJS}/v8/LDIqaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-Italic.woff2"

# Weight 500 — Medium
curl -fsSL "${BASE_PJS}/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuB.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-Medium.woff2"

# Weight 600 — SemiBold
curl -fsSL "${BASE_PJS}/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuC.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-SemiBold.woff2"

# Weight 700 — Bold
curl -fsSL "${BASE_PJS}/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuD.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-Bold.woff2"

# Weight 800 — ExtraBold
curl -fsSL "${BASE_PJS}/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuE.woff2" \
     -o "$PJS_DIR/PlusJakartaSans-ExtraBold.woff2"

echo "  ✅ Plus Jakarta Sans — 6 files downloaded"

# ── DM Mono ───────────────────────────────────────────────────────────────
# Source: https://fonts.google.com/specimen/DM+Mono (OFL 1.1)
# GitHub: https://github.com/googlefonts/dm-mono

BASE_DMM="https://fonts.gstatic.com/s/dmmono"

echo "Downloading DM Mono..."

# Weight 400 — Regular
curl -fsSL "${BASE_DMM}/v14/aFTR7PB1QTsUX8KYth-orYataIf4.woff2" \
     -o "$DMM_DIR/DMMono-Regular.woff2"

# Weight 500 — Medium
curl -fsSL "${BASE_DMM}/v14/aFTU7PB1QTsUX8KYth-QAa2LXGnGxA.woff2" \
     -o "$DMM_DIR/DMMono-Medium.woff2"

echo "  ✅ DM Mono — 2 files downloaded"

echo ""
echo "Fonts downloaded to: $FONTS_DIR"
echo ""
echo "Next: verify that css/site-theme.css @font-face declarations reference these files."
echo "      The font paths in @font-face use 'assets/fonts/...' relative to the repo root."
