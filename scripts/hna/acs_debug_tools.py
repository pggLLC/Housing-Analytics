"""ACS diagnostics tools.

Runs when ACS data fetch fails to help non-technical users and admins
understand the cause and take corrective action.

Probes all configured series/endpoint/year combinations and writes a
human-readable log file so support teams can diagnose the problem.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

STATE_FIPS_CO = '08'

# Subset of profile variables sufficient to validate a working response
_PROBE_VARS = ['DP05_0001E', 'DP03_0062E', 'DP04_0001E', 'NAME']


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _redact(s: str) -> str:
    """Redact Census API key from strings before logging."""
    key = os.environ.get('CENSUS_API_KEY', '').strip()
    if key:
        s = s.replace(key, '***CENSUS_API_KEY***')
    return s


def _http_probe(url: str, timeout: int = 20) -> tuple[int, str]:
    """Make a single HTTP request and return (status_code, response_preview).

    Returns up to 250 characters of the response body on error, or
    '(success – data received)' on a 200 response.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HNA-ETL-Diag/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(512).decode('utf-8', errors='replace')
            return (r.status, raw)
    except urllib.error.HTTPError as e:
        try:
            body = e.read(512).decode('utf-8', errors='replace')
        except Exception:
            body = ''
        return (e.code, body[:250])
    except Exception as exc:
        return (0, str(exc)[:250])


def _build_url(year: int, series: str, endpoint: str, geo_type: str, geoid: str) -> str:
    """Build a Census API URL for a given year/series/endpoint/geo."""
    base = f'https://api.census.gov/data/{year}/acs/{series}/{endpoint}'
    if geo_type == 'county':
        for_ = f"county:{geoid[-3:]}"
        params: dict = {'get': ','.join(_PROBE_VARS), 'for': for_}
    elif geo_type == 'place':
        for_ = f"place:{geoid[2:]}"
        params = {'get': ','.join(_PROBE_VARS), 'for': for_, 'in': f"state:{STATE_FIPS_CO}"}
    else:
        for_ = f"place:{geoid[2:]}"
        params = {'get': ','.join(_PROBE_VARS), 'for': for_, 'in': f"state:{STATE_FIPS_CO}"}
    key = os.environ.get('CENSUS_API_KEY', '').strip()
    if key:
        params['key'] = key
    return base + '?' + urllib.parse.urlencode(params)


# B-series probe variables for CDPs (ACS 5-year detailed tables)
_CDP_B_PROBE_VARS = ['B01003_001E', 'B19013_001E', 'B25001_001E', 'NAME']


def _build_b_series_url(year: int, geo_type: str, geoid: str) -> str:
    """Build an ACS 5-year B-series URL for CDP geography probe."""
    base = f'https://api.census.gov/data/{year}/acs/acs5'
    params: dict = {
        'get': ','.join(_CDP_B_PROBE_VARS),
        'for': f"place:{geoid[2:]}",
        'in': f"state:{STATE_FIPS_CO}",
    }
    key = os.environ.get('CENSUS_API_KEY', '').strip()
    if key:
        params['key'] = key
    return base + '?' + urllib.parse.urlencode(params)


def run_acs_diagnostics(geo_type: str, geoid: str, log_path: str) -> dict:
    """Probe all ACS series/endpoint/year combinations for a geography.

    Writes a human-readable diagnostic log to *log_path* and returns a
    summary dict with the following keys:

      success   – True if at least one endpoint returned usable data.
      source    – Description of the first successful endpoint, or None.
      data      – Parsed row dict from the first successful endpoint, or None.
      log_path  – Absolute path to the written log file.
      entries   – List of per-attempt result dicts.
    """
    start_year = int(os.environ.get('ACS_START_YEAR', '2024'))
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3'))
    years_to_try = list(range(start_year, start_year - n_fallback, -1))
    combos = [('acs1', 'profile'), ('acs1', 'subject'), ('acs5', 'profile')]

    entries: list[dict] = []
    success_data: dict | None = None
    success_source: str | None = None

    for year in years_to_try:
        for series, endpoint in combos:
            url = _build_url(year, series, endpoint, geo_type, geoid)
            status, raw = _http_probe(url)
            ok = False
            row_data: dict | None = None

            if status == 200:
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list) and len(parsed) > 1:
                        ok = True
                        row_data = {parsed[0][i]: parsed[1][i] for i in range(len(parsed[0]))}
                except Exception:
                    pass

            entry = {
                'year': year,
                'series': series,
                'endpoint': endpoint,
                'url': _redact(url),
                'status': status,
                'ok': ok,
                'response_preview': '(success – data received)' if ok else raw[:250],
            }
            entries.append(entry)

            if ok and success_data is None:
                success_data = row_data
                success_source = f'{series}/{endpoint} year={year}'

    # For CDPs, also probe ACS 5-year B-series (the profile/subject tables don't
    # support CDP geography, but B-series does).
    if geo_type == 'cdp' and success_data is None:
        for year in years_to_try:
            url = _build_b_series_url(year, geo_type, geoid)
            status, raw = _http_probe(url)
            ok = False
            row_data = None
            if status == 200:
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list) and len(parsed) > 1:
                        ok = True
                        row_data = {parsed[0][i]: parsed[1][i] for i in range(len(parsed[0]))}
                except Exception:
                    pass
            entry = {
                'year': year,
                'series': 'acs5',
                'endpoint': 'B-series (CDP fallback)',
                'url': _redact(url),
                'status': status,
                'ok': ok,
                'response_preview': '(success – data received)' if ok else raw[:250],
            }
            entries.append(entry)
            if ok and success_data is None:
                success_data = row_data
                success_source = f'acs5/B-series year={year}'

    # Write the diagnostic log
    _write_log(log_path, geo_type, geoid, entries, success_source)

    return {
        'success': success_data is not None,
        'source': success_source,
        'data': success_data,
        'log_path': log_path,
        'entries': entries,
    }


def _write_log(log_path: str, geo_type: str, geoid: str, entries: list[dict], success_source: str | None) -> None:
    """Write a human-readable diagnostic log file for support staff.

    The log records the timestamp, geography, overall outcome, and one
    section per attempted API endpoint showing the URL, HTTP status code,
    and (on failure) the first 250 characters of the response body.

    Intended audience: technical support teams and system administrators.
    Non-technical users can download the file via the UI and forward it to
    their support contact.

    Args:
        log_path:       Destination file path.
        geo_type:       Census geography type ('county', 'place', or 'cdp').
        geoid:          Census GEOID string for the geography.
        entries:        List of per-attempt dicts from run_acs_diagnostics().
        success_source: Human-readable description of the first successful
                        endpoint, or None if all attempts failed.
    """
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, 'w', encoding='utf-8') as fh:
            fh.write(f"ACS Diagnostics Log\n")
            fh.write(f"Generated : {_utc_now()}\n")
            fh.write(f"Geography : {geo_type}:{geoid}\n")
            fh.write(f"Outcome   : {'SUCCESS - ' + success_source if success_source else 'ALL ATTEMPTS FAILED'}\n")
            fh.write("\n")
            fh.write("=" * 72 + "\n")
            fh.write("Attempted endpoints\n")
            fh.write("=" * 72 + "\n\n")
            for e in entries:
                fh.write(f"[{'OK' if e['ok'] else 'FAIL':4s}] {e['year']} {e['series']}/{e['endpoint']}\n")
                fh.write(f"  URL    : {e['url']}\n")
                fh.write(f"  Status : {e['status']}\n")
                if not e['ok']:
                    fh.write(f"  Body   : {e['response_preview']}\n")
                fh.write("\n")
            fh.write("=" * 72 + "\n")
            if success_source:
                fh.write(f"Data successfully loaded from: {success_source}\n")
            else:
                fh.write("No ACS data could be retrieved for this geography.\n")
                fh.write(
                    "Please share this file with your technical support team.\n"
                )
    except Exception as exc:
        import sys
        print(f"⚠ acs_debug_tools: could not write log to {log_path}: {exc}", file=sys.stderr)
