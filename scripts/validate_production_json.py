#!/usr/bin/env python3
"""scripts/validate_production_json.py
Pre-commit / CI validation: ensure no ACS sentinel values (-666666666) or
other invalid numerics have leaked into production JSON data files.

Scans all JSON files under ``data/hna/`` (and optionally additional paths)
and reports any value that matches one of the forbidden patterns:

* Exact sentinel integer -666666666
* Any integer or float ≤ -1,000,000 (catches related Census suppression codes)
* JSON-serialised NaN or Infinity (not valid JSON, but guard against it)

Exit codes
----------
0   No problems found — safe to proceed.
1   One or more sentinel / invalid values detected — block the commit.

Usage
-----
    python scripts/validate_production_json.py                # default paths
    python scripts/validate_production_json.py data/hna/summary  # custom path
    python scripts/validate_production_json.py --help
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Iterator

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SENTINEL_EXACT          = -666666666
EXTREME_NEGATIVE_THRESH = -1_000_000   # any value at or below this is suspicious
REPO_ROOT               = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Production directories that should never contain raw sentinel values.
DEFAULT_SCAN_DIRS = [
    os.path.join(REPO_ROOT, 'data', 'hna'),
]

# ---------------------------------------------------------------------------
# Traversal helpers
# ---------------------------------------------------------------------------


def iter_json_files(root: str) -> Iterator[str]:
    """Yield absolute paths to every .json file under *root*."""
    for dirpath, _dirs, files in os.walk(root):
        for fname in files:
            if fname.endswith('.json'):
                yield os.path.join(dirpath, fname)


def _walk_value(obj, path: list) -> Iterator[tuple[list, object]]:
    """Recursively yield (json_path, leaf_value) pairs from a parsed JSON tree."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_value(v, path + [str(k)])
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_value(v, path + [str(i)])
    else:
        yield path, obj


# ---------------------------------------------------------------------------
# Value validators
# ---------------------------------------------------------------------------


def is_sentinel(value: object) -> bool:
    """Return True if *value* is a known ACS sentinel or extreme negative."""
    if not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return True
    return value <= EXTREME_NEGATIVE_THRESH


def classify_sentinel(value: object) -> str:
    """Return a human-readable description of why *value* is invalid."""
    if isinstance(value, float) and math.isnan(value):
        return 'NaN (not a number — invalid in production JSON)'
    if isinstance(value, float) and math.isinf(value):
        return f'Infinity ({value!r} — invalid in production JSON)'
    if value == SENTINEL_EXACT:
        return f'ACS sentinel {SENTINEL_EXACT} ("not available" — must be null)'
    return f'extreme negative {value!r} (≤ {EXTREME_NEGATIVE_THRESH})'


# ---------------------------------------------------------------------------
# File scanner
# ---------------------------------------------------------------------------


def scan_file(path: str) -> list[dict]:
    """Scan a single JSON file; return a list of violation dicts."""
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        return [{'file': path, 'path': [], 'value': None, 'reason': f'JSON parse error: {exc}'}]
    except OSError as exc:
        return [{'file': path, 'path': [], 'value': None, 'reason': f'File error: {exc}'}]

    violations: list[dict] = []
    for json_path, value in _walk_value(data, []):
        if is_sentinel(value):
            violations.append({
                'file':   path,
                'path':   json_path,
                'value':  value,
                'reason': classify_sentinel(value),
            })
    return violations


# ---------------------------------------------------------------------------
# Report helpers
# ---------------------------------------------------------------------------


def _relpath(path: str) -> str:
    try:
        return os.path.relpath(path, REPO_ROOT)
    except ValueError:
        return path


def print_violations(violations: list[dict]) -> None:
    """Print a human-readable summary of all violations."""
    for v in violations:
        json_path_str = ' → '.join(v['path']) if v['path'] else '(root)'
        print(f"  ❌  {_relpath(v['file'])}")
        print(f"       path  : {json_path_str}")
        print(f"       value : {v['value']!r}")
        print(f"       reason: {v['reason']}")
        print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Scan production JSON files for leaked ACS sentinel values.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        'paths',
        nargs='*',
        metavar='PATH',
        help='Directories or files to scan (default: data/hna/).',
    )
    parser.add_argument(
        '--quiet', '-q',
        action='store_true',
        help='Suppress per-violation details; only print summary counts.',
    )
    parser.add_argument(
        '--threshold',
        type=float,
        default=EXTREME_NEGATIVE_THRESH,
        metavar='N',
        help=f'Extreme-negative threshold (default: {EXTREME_NEGATIVE_THRESH}).',
    )
    return parser


def resolve_scan_targets(raw_paths: list[str]) -> list[str]:
    """Resolve CLI path arguments to absolute paths, falling back to defaults."""
    if not raw_paths:
        return DEFAULT_SCAN_DIRS
    resolved = []
    for p in raw_paths:
        abs_p = p if os.path.isabs(p) else os.path.join(os.getcwd(), p)
        if not os.path.exists(abs_p):
            print(f'[warn] path not found, skipping: {abs_p}', file=sys.stderr)
        else:
            resolved.append(abs_p)
    return resolved or DEFAULT_SCAN_DIRS


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args   = parser.parse_args(argv)

    # Override global threshold if the user supplied --threshold
    global EXTREME_NEGATIVE_THRESH  # noqa: PLW0603
    EXTREME_NEGATIVE_THRESH = args.threshold

    targets = resolve_scan_targets(args.paths)

    all_violations: list[dict] = []
    scanned_count = 0

    for target in targets:
        if os.path.isfile(target):
            json_files = [target]
        else:
            json_files = list(iter_json_files(target))

        for json_file in sorted(json_files):
            violations = scan_file(json_file)
            scanned_count += 1
            all_violations.extend(violations)

    print(f'Scanned {scanned_count} JSON file(s) across {len(targets)} target(s).')
    print()

    if not all_violations:
        print('✅  No sentinel values or invalid numerics detected.')
        return 0

    print(f'🚨  {len(all_violations)} violation(s) found:\n')
    if not args.quiet:
        print_violations(all_violations)

    print(
        f'Run `python scripts/hna/build_hna_data.py` (or the relevant ETL '
        f'script) to regenerate production JSON with sentinel values normalized '
        f'to null, then re-run this validation.'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())