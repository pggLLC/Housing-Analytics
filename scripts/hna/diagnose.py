#!/usr/bin/env python3
"""HNA data pipeline pre-flight diagnostics.

Independently verifies:
- HTTP connectivity to all 7 data-source endpoints
  (Census ACS, TIGERweb, LEHD LODES, DOLA/SDO)
- Available disk space (warns when < 500 MB free)
- Output directory writability

Exit codes:
  0 – all clear, or only non-critical warnings (connectivity/disk)
  1 – critical failure (cannot write output files)

Connectivity and disk-space failures are reported as warnings so that the
main build step still runs; it may succeed using on-disk cached data.

Usage:
  python3 scripts/hna/diagnose.py
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Minimum key length before CENSUS_API_KEY is considered "configured".
_MIN_KEY_LEN = 8

# Per-check request timeout (seconds).
_TIMEOUT = 20

# Disk-space warning threshold (bytes).
_DISK_WARN_BYTES = 500 * 1024 * 1024  # 500 MB

STATE_FIPS_CO = '08'
# Mesa County — reliably has ACS data and is the primary HNA featured county.
TEST_COUNTY_FIPS = '077'

# Project root (two levels above this script).
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# HNA output directories that must be writable.
OUTPUT_DIRS = [
    os.path.join(ROOT, 'data', 'hna'),
    os.path.join(ROOT, 'data', 'hna', 'summary'),
    os.path.join(ROOT, 'data', 'hna', 'lehd'),
    os.path.join(ROOT, 'data', 'hna', 'dola_sya'),
    os.path.join(ROOT, 'data', 'hna', 'projections'),
    os.path.join(ROOT, 'data', 'hna', 'derived'),
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _probe(url: str, timeout: int = _TIMEOUT) -> tuple[int, str]:
    """GET *url* and return (http_status, body_preview).

    Returns (0, error_message) on network-level failure.
    """
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'HNA-Diagnose/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(512).decode('utf-8', errors='replace')
            return (r.status, body[:200])
    except urllib.error.HTTPError as e:
        try:
            body = e.read(512).decode('utf-8', errors='replace')
        except Exception:
            body = ''
        return (e.code, body[:200])
    except Exception as exc:
        return (0, str(exc)[:200])


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_census_api_key() -> tuple[bool, bool, str]:
    """Verify CENSUS_API_KEY is set and has the expected length.

    Returns (ok, critical, message).
    Missing or short key is a warning, not a critical failure, because
    unauthenticated Census API calls still work for small request volumes.
    """
    key = os.environ.get('CENSUS_API_KEY', '').strip()
    if not key:
        return (False, False, 'CENSUS_API_KEY is not set — API calls will be unauthenticated')
    if len(key) < _MIN_KEY_LEN:
        return (False, False,
                f'CENSUS_API_KEY is suspiciously short ({len(key)} chars); '
                'expected a 40-character hex string')
    return (True, False, f'CENSUS_API_KEY is configured ({len(key)} chars)')


def check_census_acs(key: str) -> tuple[bool, bool, str]:
    """Probe the Census ACS 5-year API (Mesa County, Colorado)."""
    qs = f'get=NAME&for=county:{TEST_COUNTY_FIPS}&in=state:{STATE_FIPS_CO}'
    if key:
        qs += f'&key={urllib.parse.quote(key, safe="")}'
    url = f'https://api.census.gov/data/2023/acs/acs5?{qs}'
    status, body = _probe(url)
    if status == 200:
        return (True, False, f'Census ACS 5-year API → HTTP {status}')
    return (False, False, f'Census ACS 5-year API → HTTP {status}: {body[:120]}')


def check_tigerweb() -> tuple[bool, bool, str]:
    """Probe the TIGERweb MapServer used to enumerate Colorado counties."""
    url = (
        'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/'
        "MapServer/1/query?where=STATEFP='08'&outFields=NAME,GEOID"
        '&returnGeometry=false&f=json&resultRecordCount=1'
    )
    status, body = _probe(url)
    if status == 200 and 'features' in body:
        return (True, False, f'TIGERweb State/County API → HTTP {status}')
    return (False, False, f'TIGERweb State/County API → HTTP {status}: {body[:120]}')


def check_lehd() -> tuple[bool, bool, str]:
    """Confirm the LEHD LODES8 index page is reachable."""
    url = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/'
    status, body = _probe(url)
    if status == 200:
        return (True, False, f'LEHD LODES8 index → HTTP {status}')
    return (False, False, f'LEHD LODES8 index → HTTP {status}: {body[:120]}')


def check_dola_sya() -> tuple[bool, bool, str]:
    """Confirm the DOLA/SDO single-year-of-age county CSV is reachable."""
    url = 'https://storage.googleapis.com/co-publicdata/sya-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, False, f'DOLA SYA county CSV → HTTP {status}')
    return (False, False, f'DOLA SYA county CSV → HTTP {status}: {body[:120]}')


def check_dola_components() -> tuple[bool, bool, str]:
    """Confirm the DOLA county components-of-change CSV is reachable."""
    url = 'https://storage.googleapis.com/co-publicdata/components-change-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, False, f'DOLA components-of-change CSV → HTTP {status}')
    return (False, False, f'DOLA components-of-change CSV → HTTP {status}: {body[:120]}')


def check_dola_profiles() -> tuple[bool, bool, str]:
    """Confirm the DOLA county population profiles CSV is reachable."""
    url = 'https://storage.googleapis.com/co-publicdata/profiles-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, False, f'DOLA county profiles CSV → HTTP {status}')
    return (False, False, f'DOLA county profiles CSV → HTTP {status}: {body[:120]}')


def check_disk_space() -> tuple[bool, bool, str]:
    """Warn when available disk space on the output volume is below 500 MB."""
    try:
        usage = shutil.disk_usage(ROOT)
        free_mb = usage.free // (1024 * 1024)
        if usage.free < _DISK_WARN_BYTES:
            return (False, False,
                    f'Low disk space: {free_mb} MB free (< 500 MB threshold)')
        return (True, False, f'Disk space OK: {free_mb} MB free')
    except Exception as exc:
        return (False, False, f'Could not check disk space: {exc}')


def check_output_writability() -> tuple[bool, bool, str]:
    """Verify all HNA output directories are (or can be) created and written to.

    This is the only *critical* check: if the script cannot write output files
    the entire build is pointless.
    """
    for path in OUTPUT_DIRS:
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as exc:
            return (False, True, f'Cannot create output directory {path}: {exc}')
        try:
            with tempfile.NamedTemporaryFile(dir=path, delete=True):
                pass
        except OSError as exc:
            return (False, True, f'Output directory not writable: {path}: {exc}')
    return (True, False, f'All {len(OUTPUT_DIRS)} output directories are writable')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    print(f'HNA pre-flight diagnostics — {_utc_now()}')
    print('=' * 60)

    key = os.environ.get('CENSUS_API_KEY', '').strip()

    checks: list[tuple[str, tuple[bool, bool, str]]] = [
        ('CENSUS_API_KEY',              check_census_api_key()),
        ('Census ACS 5-year API',       check_census_acs(key)),
        ('TIGERweb State/County API',   check_tigerweb()),
        ('LEHD LODES8 index',           check_lehd()),
        ('DOLA SYA county CSV',         check_dola_sya()),
        ('DOLA components-of-change',   check_dola_components()),
        ('DOLA county profiles CSV',    check_dola_profiles()),
        ('Disk space',                  check_disk_space()),
        ('Output directory writability', check_output_writability()),
    ]

    warnings = 0
    critical_failures = 0

    for label, (ok, critical, msg) in checks:
        if ok:
            icon = '✓'
        elif critical:
            icon = '✗'
            critical_failures += 1
        else:
            icon = '⚠'
            warnings += 1
        print(f'  {icon} {label}: {msg}')

    print('=' * 60)

    if critical_failures > 0:
        print(f'CRITICAL: {critical_failures} failure(s) prevent the build from running.')
        if warnings > 0:
            print(f'  ({warnings} additional warning(s) — see above)')
        return 1

    if warnings > 0:
        print(f'{warnings} warning(s) — build will proceed; some data may use cached files.')
    else:
        print('All checks passed.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
