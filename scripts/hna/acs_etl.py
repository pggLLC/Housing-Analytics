#!/usr/bin/env python3
"""ACS ETL pipeline — Extract-Transform-Load for Census ACS profile data.

Provides ACSExtractor for fetching DP04/DP05 profile tables from the Census
Bureau ACS API with:
- Retry logic with exponential backoff (3 retries, 1s/2s/4s delays)
- Connection pooling for batch requests via urllib.request
- Rate-limit handling (Census API: 500 requests / 10 seconds)
- Field mapping via acs_field_mapping.json

Usage:
    extractor = ACSExtractor(table_ids=['DP04', 'DP05'], geoids=['08077'])
    results   = extractor.fetch_all()
    # results: dict keyed by geoid, each containing mapped fields
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CENSUS_BASE = 'https://api.census.gov/data'
STATE_FIPS   = '08'          # Colorado
MAX_RETRIES  = 3
BACKOFF_BASE = 1.0           # seconds; delays will be 1s, 2s, 4s
RATE_LIMIT_WINDOW  = 10      # seconds per Census API rate-limit window
RATE_LIMIT_MAX_RPS = 500     # max requests per window

_FIELD_MAP_PATH = os.path.join(os.path.dirname(__file__), 'acs_field_mapping.json')


# ---------------------------------------------------------------------------
# Field mapping loader
# ---------------------------------------------------------------------------

def load_field_mapping() -> dict[str, Any]:
    """Load and return the centralized ACS field mapping config."""
    with open(_FIELD_MAP_PATH, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def get_table_variables(table_id: str) -> list[str]:
    """Return the list of ACS variable IDs for the given table (e.g. 'DP04')."""
    mapping = load_field_mapping()
    table   = mapping.get(table_id, {})
    return [k for k in table if not k.startswith('_')]


# ---------------------------------------------------------------------------
# Rate-limiter
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Token-bucket rate limiter: at most ``max_calls`` per ``window_secs``."""

    def __init__(self, max_calls: int = RATE_LIMIT_MAX_RPS,
                 window_secs: float = RATE_LIMIT_WINDOW) -> None:
        self._max_calls   = max_calls
        self._window_secs = window_secs
        self._calls: list[float] = []

    def wait(self) -> None:
        """Block until a request slot is available within the rate window."""
        now = time.monotonic()
        # Drop timestamps outside the current window
        cutoff = now - self._window_secs
        self._calls = [t for t in self._calls if t >= cutoff]
        if len(self._calls) >= self._max_calls:
            sleep_until = self._calls[0] + self._window_secs
            wait_time   = sleep_until - now
            if wait_time > 0:
                time.sleep(wait_time)
            self._calls = []
        self._calls.append(time.monotonic())


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _redact(s: str) -> str:
    """Remove Census API key from log output."""
    key = os.environ.get('CENSUS_API_KEY', '')
    if len(key) >= 8:
        s = s.replace(key, '***')
    return s


def _http_get(url: str, timeout: int = 30,
              retries: int = MAX_RETRIES,
              backoff: float = BACKOFF_BASE) -> tuple[int, str]:
    """Fetch *url* with exponential-backoff retry.

    Returns ``(status_code, body_text)``.  On network failure the status code
    is 0 and body is the exception message.
    """
    wait = backoff
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "HNA-ACS-ETL/1.0 (github.com/pggLLC/Housing-Analytics)"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body   = resp.read().decode('utf-8', errors='replace')
                status = resp.status
            return (status, body)
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                body = exc.read().decode('utf-8', errors='replace')
            except Exception:
                body = ''
            print(
                f"[acs_etl] HTTP {status} on attempt {attempt}/{retries}: {_redact(url)}",
                file=sys.stderr,
            )
            if status == 429:
                # Respect Retry-After header when present
                retry_after = exc.headers.get('Retry-After', str(int(wait)))
                try:
                    wait = float(retry_after)
                except ValueError:
                    pass
            if status in (408, 429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(wait)
                wait *= 2
                continue
            return (status, body or f"HTTP {status}: {exc.reason}")
        except Exception as exc:
            print(
                f"[acs_etl] Error on attempt {attempt}/{retries}: {exc} — {_redact(url)}",
                file=sys.stderr,
            )
            if attempt < retries:
                time.sleep(wait)
                wait *= 2
                continue
            return (0, str(exc))
    return (0, "Max retries exceeded")


# ---------------------------------------------------------------------------
# ACSExtractor
# ---------------------------------------------------------------------------

class ACSExtractor:
    """Fetch ACS profile data for one or more geographies.

    Parameters
    ----------
    table_ids : list[str]
        ACS table IDs to fetch, e.g. ``['DP04', 'DP05']``.
    geoids : list[str]
        Geography IDs.  Supported formats:
        - 5-digit county FIPS (e.g. ``'08077'``)
        - 7-digit place/CDP GEOID (e.g. ``'0828745'``)
    year : int | None
        ACS data year.  Defaults to the ``ACS_START_YEAR`` environment variable
        or 2024.
    series : str
        ACS series to use (``'acs5'`` or ``'acs1'``).  Defaults to ``'acs5'``.
    """

    def __init__(
        self,
        table_ids: list[str],
        geoids: list[str],
        year: int | None = None,
        series: str = 'acs5',
    ) -> None:
        self.table_ids   = list(table_ids)
        self.geoids      = list(geoids)
        self.year        = year or int(os.environ.get('ACS_START_YEAR', '2024'))
        self.series      = series
        self._api_key    = os.environ.get('CENSUS_API_KEY', '').strip()
        self._rate       = _RateLimiter()
        self._field_map  = load_field_mapping()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch_all(self) -> dict[str, dict[str, Any]]:
        """Fetch all requested tables for all geoids.

        Returns
        -------
        dict
            Mapping of ``geoid → {field_name: value, ...}``.  Missing values
            are ``None``.  All results include a ``_fetched_at`` ISO timestamp.
        """
        results: dict[str, dict[str, Any]] = {}
        for geoid in self.geoids:
            merged: dict[str, Any] = {}
            for table_id in self.table_ids:
                table_data = self._fetch_table(table_id, geoid)
                if table_data:
                    merged.update(table_data)
            merged['_fetched_at'] = _utc_now()
            merged['_geoid']      = geoid
            results[geoid] = merged
        return results

    def fetch_geoid(self, geoid: str) -> dict[str, Any] | None:
        """Fetch all tables for a single geoid.

        Returns mapped field dict or ``None`` if all fetches fail.
        """
        merged: dict[str, Any] = {}
        any_ok = False
        for table_id in self.table_ids:
            table_data = self._fetch_table(table_id, geoid)
            if table_data:
                merged.update(table_data)
                any_ok = True
        if not any_ok:
            return None
        merged['_fetched_at'] = _utc_now()
        merged['_geoid']      = geoid
        return merged

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_table(self, table_id: str, geoid: str) -> dict[str, Any] | None:
        """Fetch a single ACS profile table for one geoid.

        Returns a flat dict of ``{raw_field_id: raw_value}`` on success, or
        ``None`` on failure.
        """
        variables = get_table_variables(table_id)
        if not variables:
            return None

        url = self._build_url(table_id, geoid, variables)
        self._rate.wait()
        status, body = _http_get(url)

        if status != 200:
            print(
                f"[acs_etl] Failed table={table_id} geoid={geoid}: HTTP {status}",
                file=sys.stderr,
            )
            return None

        try:
            arr = json.loads(body)
        except json.JSONDecodeError as exc:
            print(f"[acs_etl] JSON decode error: {exc}", file=sys.stderr)
            return None

        if not arr or len(arr) < 2:
            return None

        header = arr[0]
        row    = arr[1]
        raw    = {header[i]: row[i] for i in range(len(header))}
        return self._map_fields(table_id, raw)

    def _build_url(self, table_id: str, geoid: str, variables: list[str]) -> str:
        """Construct the Census API URL for a profile table query."""
        base   = f"{CENSUS_BASE}/{self.year}/acs/{self.series}/profile"
        vars_str = ','.join(['NAME'] + variables)

        # Determine geography type from geoid length
        if len(geoid) == 5:
            # County: state FIPS (2) + county FIPS (3)
            county_code = geoid[2:]
            geo_params  = f"for=county:{county_code}&in=state:{STATE_FIPS}"
        elif len(geoid) == 7:
            # Place/CDP: state FIPS (2) + place code (5)
            place_code = geoid[2:]
            geo_params = f"for=place:{place_code}&in=state:{STATE_FIPS}"
        else:
            # Fall back to treating the whole geoid as a county code
            geo_params = f"for=county:{geoid}&in=state:{STATE_FIPS}"

        qs = f"get={vars_str}&{geo_params}"
        if self._api_key:
            qs += f"&key={urllib.parse.quote(self._api_key, safe='')}"
        return f"{base}?{qs}"

    def _map_fields(self, table_id: str, raw: dict[str, str]) -> dict[str, Any]:
        """Apply semantic field mapping to a raw Census API response row.

        Values are stored under their raw Census variable IDs (e.g.
        ``DP04_0001E``) because the existing codebase indexes data that way.
        The mapping metadata is available via ``load_field_mapping()`` for
        validation and UI use.
        """
        table_map = self._field_map.get(table_id, {})
        out: dict[str, Any] = {}
        for field_id, meta in table_map.items():
            if field_id.startswith('_'):
                continue
            raw_val = raw.get(field_id)
            out[field_id] = _coerce_value(raw_val, meta.get('type', 'string'))
        return out


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _coerce_value(raw: str | None, type_hint: str) -> Any:
    """Coerce a raw Census string value to the appropriate Python type."""
    if raw is None or raw in ('-', '-666666666', '-888888888', '-999999999', ''):
        return None
    try:
        if type_hint == 'integer':
            return int(raw)
        if type_hint in ('float', 'percentage'):
            return float(raw)
    except (ValueError, TypeError):
        pass
    return raw


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description='Fetch ACS DP04/DP05 data via Census API')
    parser.add_argument('--tables',  default='DP04,DP05',
                        help='Comma-separated table IDs (default: DP04,DP05)')
    parser.add_argument('--geoids',  required=True,
                        help='Comma-separated geography IDs (5- or 7-digit FIPS)')
    parser.add_argument('--year',    type=int, default=None,
                        help='ACS data year (default: ACS_START_YEAR env or 2024)')
    parser.add_argument('--series',  default='acs5',
                        help='ACS series: acs5 or acs1 (default: acs5)')
    parser.add_argument('--out',     default=None,
                        help='Optional output JSON file path')
    args = parser.parse_args()

    extractor = ACSExtractor(
        table_ids=args.tables.split(','),
        geoids=args.geoids.split(','),
        year=args.year,
        series=args.series,
    )
    results = extractor.fetch_all()

    output = json.dumps(results, indent=2, ensure_ascii=False)
    if args.out:
        os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(output)
        print(f"[acs_etl] Wrote {len(results)} records to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == '__main__':
    _main()
