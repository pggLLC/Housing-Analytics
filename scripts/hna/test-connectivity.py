#!/usr/bin/env python3
"""HNA data pipeline connectivity diagnostic.

Checks that all external APIs required by build_hna_data.py are reachable and
that mandatory environment variables (CENSUS_API_KEY) are configured.

Exit codes:
  0 – all checks passed
  1 – one or more checks failed (see stdout for details)

Usage:
  python3 scripts/hna/test-connectivity.py
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Minimum key length before we treat CENSUS_API_KEY as "configured".
# Real Census API keys are 40 hex chars; anything shorter is likely a placeholder.
_MIN_KEY_LEN = 8

# Per-check timeout (seconds)
_TIMEOUT = 20

STATE_FIPS_CO = '08'
# Mesa County is Colorado's only featured county in the HNA pipeline and is used
# as the probe target for connectivity checks because it reliably has ACS data.
TEST_COUNTY_FIPS = '077'


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _probe(url: str, timeout: int = _TIMEOUT) -> tuple[int, str]:
    """GET *url* and return (http_status, body_preview).

    Returns (0, error_message) on network-level failure.
    """
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'HNA-Connectivity-Check/1.0'})
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


def check_census_api_key() -> tuple[bool, str]:
    """Verify CENSUS_API_KEY is set and meets minimum length."""
    key = os.environ.get('CENSUS_API_KEY', '').strip()
    if not key:
        return (False, 'CENSUS_API_KEY is not set')
    if len(key) < _MIN_KEY_LEN:
        return (False, f'CENSUS_API_KEY is set but suspiciously short ({len(key)} chars); '
                       'expected a 40-character hex string')
    return (True, f'CENSUS_API_KEY is set ({len(key)} chars)')


def check_census_api(key: str) -> tuple[bool, str]:
    """Hit the Census ACS 5-year API with a minimal query for Mesa County."""
    qs = f'get=NAME&for=county:{TEST_COUNTY_FIPS}&in=state:{STATE_FIPS_CO}'
    if key:
        qs += f'&key={urllib.parse.quote(key, safe="")}'
    url = f'https://api.census.gov/data/2023/acs/acs5?{qs}'
    status, body = _probe(url)
    if status == 200:
        return (True, f'Census ACS API responded HTTP {status}')
    return (False, f'Census ACS API responded HTTP {status}: {body[:120]}')


def check_tigerweb() -> tuple[bool, str]:
    """Probe the TIGERweb MapServer used to enumerate Colorado counties."""
    url = (
        'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/'
        "MapServer/1/query?where=STATEFP='08'&outFields=NAME,GEOID"
        '&returnGeometry=false&f=json&resultRecordCount=1'
    )
    status, body = _probe(url)
    if status == 200 and 'features' in body:
        return (True, f'TIGERweb API responded HTTP {status}')
    return (False, f'TIGERweb API responded HTTP {status}: {body[:120]}')


def check_lehd() -> tuple[bool, str]:
    """Confirm the LEHD LODES8 index page is reachable."""
    url = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/'
    status, body = _probe(url)
    if status == 200:
        return (True, f'LEHD LODES8 index responded HTTP {status}')
    return (False, f'LEHD LODES8 index responded HTTP {status}: {body[:120]}')


def check_dola_sya() -> tuple[bool, str]:
    """Confirm the DOLA/SDO single-year-of-age CSV is reachable (HEAD-style range probe)."""
    url = 'https://storage.googleapis.com/co-publicdata/sya-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, f'DOLA SYA CSV responded HTTP {status}')
    return (False, f'DOLA SYA CSV responded HTTP {status}: {body[:120]}')


def check_dola_components() -> tuple[bool, str]:
    """Confirm the DOLA county components-of-change CSV is reachable."""
    url = 'https://storage.googleapis.com/co-publicdata/components-change-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, f'DOLA components-of-change CSV responded HTTP {status}')
    return (False, f'DOLA components-of-change CSV responded HTTP {status}: {body[:120]}')


def check_dola_profiles() -> tuple[bool, str]:
    """Confirm the DOLA county population profiles CSV is reachable."""
    url = 'https://storage.googleapis.com/co-publicdata/profiles-county.csv'
    status, body = _probe(url)
    if status == 200:
        return (True, f'DOLA profiles CSV responded HTTP {status}')
    return (False, f'DOLA profiles CSV responded HTTP {status}: {body[:120]}')


def main() -> int:
    print(f'HNA connectivity check — {_utc_now()}')
    print('=' * 60)

    key = os.environ.get('CENSUS_API_KEY', '').strip()

    checks = [
        ('CENSUS_API_KEY env var', check_census_api_key()),
        ('Census ACS 5-year API', check_census_api(key)),
        ('TIGERweb State/County API', check_tigerweb()),
        ('LEHD LODES8 index', check_lehd()),
        ('DOLA SYA county CSV', check_dola_sya()),
        ('DOLA components-of-change CSV', check_dola_components()),
        ('DOLA county profiles CSV', check_dola_profiles()),
    ]

    failures = 0
    for label, (ok, msg) in checks:
        status_icon = '✓' if ok else '✗'
        print(f'  {status_icon} {label}: {msg}')
        if not ok:
            failures += 1

    print('=' * 60)
    if failures == 0:
        print(f'All {len(checks)} checks passed.')
    else:
        print(f'{failures}/{len(checks)} check(s) FAILED — see details above.')

    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
