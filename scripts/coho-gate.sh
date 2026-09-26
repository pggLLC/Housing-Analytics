#!/usr/bin/env bash
# Portable entry point; requires Python 3.9+, git and authenticated gh.
set -eu
exec python3 "$(cd -- "$(dirname -- "$0")" && pwd)/coho_gate.py" "$@"
