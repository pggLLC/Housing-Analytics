#!/usr/bin/env python3
"""Build cached HNA datasets.

Writes:
- data/hna/geo-config.json (county list + featured)
- data/hna/summary/{geoid}.json (ACS profile + S0801 for featured geos)
- data/hna/lehd/{countyFips5}.json (LEHD LODES OD inflow/outflow/within by county,
  plus annual WAC employment snapshots and YoY growth rates for 2019–2023)
- data/hna/dola_sya/{countyFips5}.json (DOLA/SDO single-year-of-age pyramid + senior pressure)

Designed to run in GitHub Actions. All sources are public.
"""

from __future__ import annotations

import csv
import glob
import gzip
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Diagnostics module - imported lazily to keep startup fast
sys.path.insert(0, os.path.dirname(__file__))
try:
    import acs_debug_tools as _acs_diag
except ImportError:
    _acs_diag = None  # type: ignore[assignment]

STATE_FIPS_CO = '08'

FEATURED = [
    {"type": "county", "geoid": "08077", "label": "Mesa County"},
    {"type": "place", "geoid": "0828745", "label": "Fruita (city)", "containingCounty": "08077"},
    {"type": "place", "geoid": "0831660", "label": "Grand Junction (city)", "containingCounty": "08077"},
    {"type": "place", "geoid": "0856970", "label": "Palisade (town)", "containingCounty": "08077"},
    {"type": "cdp", "geoid": "0815165", "label": "Clifton (CDP)", "containingCounty": "08077"},
]

OUT = {
    "geo_config": os.path.join(ROOT, 'data', 'hna', 'geo-config.json'),
    "summary_dir": os.path.join(ROOT, 'data', 'hna', 'summary'),
    "lehd_dir": os.path.join(ROOT, 'data', 'hna', 'lehd'),
    "dola_dir": os.path.join(ROOT, 'data', 'hna', 'dola_sya'),
    "proj_dir": os.path.join(ROOT, 'data', 'hna', 'projections'),
    "derived_dir": os.path.join(ROOT, 'data', 'hna', 'derived'),
    "cache_dir": os.path.join(ROOT, 'data', 'hna', 'source'),
    "acs_debug_log": os.path.join(ROOT, 'data', 'hna', 'acs_debug_log.txt'),
}


# ============================================================================
# Helper Functions: Reliability & Resilience
# ============================================================================


def utc_now_z() -> str:
    """Return ISO 8601 UTC timestamp string ending with 'Z'."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def redact(s: str) -> str:
    """Redact sensitive API keys from logs.

    Only replaces keys that are at least 8 characters long to avoid corrupting
    log output when an env var is accidentally set to a short or single-character
    value (which would replace every occurrence of that character in the URL).
    """
    census_key_val = os.environ.get('CENSUS_API_KEY', '')
    fred_key_val = os.environ.get('FRED_API_KEY', '')
    if len(census_key_val) >= 8:
        s = s.replace(census_key_val, '***CENSUS_API_KEY***')
    if len(fred_key_val) >= 8:
        s = s.replace(fred_key_val, '***FRED_API_KEY***')
    return s


def http_get_text(url: str, timeout: int = 30, retries: int = 3, backoff: float = 1.7) -> tuple[int, str]:
    """Fetch URL with exponential backoff retry.
    
    Returns: (status_code, text)
    On error, returns (status_code, error_message)
    """
    wait = 1
    for attempt in range(retries):
        print(f"→ GET {redact(url)}  (attempt {attempt + 1}/{retries}, timeout={timeout}s)", file=sys.stderr)
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HNA-ETL/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode('utf-8', errors='replace')
                status = r.status
            elapsed = time.monotonic() - t0
            print(f"← {status} OK  {len(body):,} bytes  {elapsed:.1f}s", file=sys.stderr)
            return (status, body)
        except urllib.error.HTTPError as e:
            elapsed = time.monotonic() - t0
            status = e.code
            try:
                body = e.read().decode('utf-8', errors='replace')
            except Exception:
                body = ''
            print(f"← HTTP {status}  {elapsed:.1f}s  fetching {redact(url)} (attempt {attempt + 1}/{retries})", file=sys.stderr)
            if status >= 400:
                # Log response body preview for all API errors to aid debugging
                print(f"  Response: {body[:1000]}", file=sys.stderr)
            if status in (408, 429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(wait)
                wait *= backoff
                continue
            return (status, body or f"HTTP {status}: {e.reason}")
        except Exception as e:
            elapsed = time.monotonic() - t0
            print(f"← ERROR  {elapsed:.1f}s  fetching {redact(url)} (attempt {attempt + 1}/{retries}): {e}", file=sys.stderr)
            if attempt < retries - 1:
                time.sleep(wait)
                wait *= backoff
                continue
            return (0, str(e))
    return (0, "Max retries exceeded")


def http_get_json(url: str, timeout: int = 30) -> dict | list | None:
    """Fetch URL and parse as JSON. Returns None on error."""
    status, text = http_get_text(url, timeout=timeout, retries=1)
    if status != 200:
        print(f"⚠ Failed to fetch JSON from {redact(url)}: HTTP {status}", file=sys.stderr)
        print(f"  Response preview: {text[:500]}", file=sys.stderr)
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"⚠ Failed to parse JSON from {redact(url)}: {e}", file=sys.stderr)
        return None


def read_csv_with_banner_skip(path: str, encoding: str = "utf-8") -> tuple[list[str], list[dict]]:
    """Read CSV, auto-detecting and skipping banner rows.
    
    Returns: (header_list, row_list_of_dicts)
    Skips leading rows that don't look like headers (e.g., "Vintage 2023...").
    """
    try:
        with open(path, 'r', encoding=encoding) as f:
            lines = f.readlines()
    except Exception as e:
        print(f"⚠ Error reading {path}: {e}", file=sys.stderr)
        return ([], [])

    # Find first line that looks like a header
    header = None
    start_idx = 0
    for i, line in enumerate(lines):
        fields = [f.strip() for f in line.split(',')]
        # Heuristic: header should have >=3 non-empty fields AND contain a known column
        if len([f for f in fields if f]) >= 3:
            fields_lower = [f.lower() for f in fields]
            if any(col in fields_lower for col in ['fips', 'countyfips', 'geoid', 'age', 'year']):
                header = fields
                start_idx = i
                break

    if header is None:
        print(f"⚠ Could not detect CSV header in {path}", file=sys.stderr)
        return ([], [])

    # Parse remaining rows
    rows = []
    try:
        reader = csv.DictReader(lines[start_idx:])
        for row in reader:
            if row:
                rows.append(row)
    except Exception as e:
        print(f"⚠ Error parsing CSV rows from {path}: {e}", file=sys.stderr)

    return (header, rows)


def census_fetch(url: str, fallback_url: str | None = None) -> dict | None:
    """Fetch Census API with fallback support.
    
    Returns: JSON dict or None on failure.
    Tries primary URL; if HTTP 400, tries fallback_url if provided.
    """
    result = http_get_json(url)
    if result is not None:
        return result

    # If HTTP 400 (Bad Request) and we have a fallback, try it
    status, _ = http_get_text(url, timeout=30, retries=1)
    if status == 400 and fallback_url:
        print(f"ℹ Falling back to {redact(fallback_url)}", file=sys.stderr)
        return http_get_json(fallback_url)

    return None


def http_get(url: str, timeout: int = 60) -> bytes:
    """Original http_get for LEHD (critical path, no fallback)."""
    print(f"→ GET {redact(url)}  (timeout={timeout}s)", file=sys.stderr)
    t0 = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "HNA-ETL/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        status = r.status
    elapsed = time.monotonic() - t0
    print(f"← {status} OK  {len(raw):,} bytes  {elapsed:.1f}s", file=sys.stderr)
    return raw


def pick_substr(fields: list[str], *cands: str) -> str | None:
    """Find the first field matching any candidate by exact then case-insensitive substring.

    Tolerates column renames and schema drift without halting the pipeline.
    """
    # Exact match first
    for c in cands:
        if c in fields:
            return c
    # Case-insensitive substring match (allows minor renames)
    fields_lower = [f.lower() for f in fields]
    for c in cands:
        cl = c.lower()
        for i, fl in enumerate(fields_lower):
            if cl in fl:
                return fields[i]
    return None


def detect_header_and_reader(text: str) -> tuple[list[str], 'csv.DictReader | None']:
    """Detect CSV header row, skipping leading banner rows.

    Returns (field_names, DictReader) or ([], None) if no header found.
    Heuristic: the first row with >=3 non-empty comma-separated fields that
    contains at least one known column keyword is treated as the header.
    """
    if not text:
        return ([], None)
    lines = text.splitlines()
    for i, line in enumerate(lines):
        fields = [f.strip() for f in line.split(',')]
        if len([f for f in fields if f]) < 3:
            continue
        fields_lower = [f.lower() for f in fields]
        if any(kw in fl for kw in ['fips', 'county', 'year', 'age', 'pop', 'hh', 'unit', 'vac'] for fl in fields_lower):
            reader = csv.DictReader(lines[i:])
            return (list(reader.fieldnames or []), reader)
    return ([], None)


def fetch_csv_with_cache(url: str, cache_path: str, label: str, timeout: int = 180) -> str | None:
    """Download a CSV, caching to disk on success; fall back to cache on failure.

    Returns the CSV text, or None if both download and cache are unavailable.
    """
    status, text = http_get_text(url, timeout=timeout, retries=3)
    if status == 200:
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(text)
        except Exception as e:
            print(f"⚠ Could not write cache {cache_path}: {e}", file=sys.stderr)
        return text
    # Download failed — try on-disk cache
    if os.path.exists(cache_path):
        print(f"ℹ {label}: download failed (HTTP {status}); using cached file {cache_path}", file=sys.stderr)
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            print(f"⚠ {label}: could not read cache {cache_path}: {e}", file=sys.stderr)
    else:
        print(f"⚠ {label}: download failed (HTTP {status}) and no cache available; skipping", file=sys.stderr)
    return None


# ============================================================================
# Core Functions
# ============================================================================


def ensure_dirs():
    os.makedirs(os.path.dirname(OUT['geo_config']), exist_ok=True)
    os.makedirs(OUT['summary_dir'], exist_ok=True)
    os.makedirs(OUT['lehd_dir'], exist_ok=True)
    os.makedirs(OUT['dola_dir'], exist_ok=True)
    os.makedirs(OUT['proj_dir'], exist_ok=True)
    os.makedirs(OUT['derived_dir'], exist_ok=True)
    os.makedirs(OUT['cache_dir'], exist_ok=True)


import math as _math

# ACS API returns -666666666 for "not available" variables (suppressed data,
# small-population geographies, or questions not asked for a survey type).
# Any value at or below this threshold is treated as a sentinel and normalized
# to None so it cannot corrupt downstream calculations or UI displays.
ACS_SENTINEL_THRESHOLD = -1_000_000


def normalize_acs_value(val):
    """Normalize ACS API sentinel values to None (Python / JSON null).

    The Census ACS API returns -666666666 for variables that are "not
    available" for a given geography.  Downstream code must never store or
    display this value; it should always be represented as null/None.

    Handles int, float, and string representations of the sentinel.
    Also converts empty strings, "NA", "null", and "None" to None, and
    treats any numeric value ≤ ACS_SENTINEL_THRESHOLD as a sentinel.

    Args:
        val: Raw value from an ACS API response dict.

    Returns:
        None if the value is a sentinel or unrepresentable; otherwise the
        original numeric value (preserving int vs float where possible).
    """
    if val is None:
        return None
    try:
        s = str(val).strip()
        if s in ('', 'NA', 'null', 'None', '-'):
            return None
        f = float(s)
        if not _math.isfinite(f):
            return None
        if f <= ACS_SENTINEL_THRESHOLD:
            return None
        # Preserve integer type for whole-number values.
        if f.is_integer():
            return int(f)
        return f
    except (ValueError, OverflowError):
        return None


def normalize_acs_dict(d):
    """Normalize all ACS sentinel values in a dict, returning a new dict.

    Applies :func:`normalize_acs_value` to every value in *d*.  Keys are
    preserved unchanged.  Values that are themselves dicts or lists are not
    recursed into; only the top-level values are processed.

    Args:
        d: A dict of raw ACS variable names → raw Census API values.

    Returns:
        A new dict with the same keys and sentinel values replaced by None.
        Returns *d* unchanged if it is not a dict.
    """
    if not isinstance(d, dict):
        return d
    return {k: normalize_acs_value(v) for k, v in d.items()}


def safe_float(v):
    try:
        if v is None:
            return None
        s = str(v).strip()
        if s in ('', 'NA', 'null', 'None'):
            return None
        f = float(s)
        if not _math.isfinite(f) or f <= ACS_SENTINEL_THRESHOLD:
            return None
        return f
    except Exception:
        return None


def safe_int(v):
    try:
        f = safe_float(v)
        return int(round(f)) if f is not None else None
    except Exception:
        return None


def annual_growth_rate(p0: float | None, p1: float | None, years: int) -> float | None:
    """Return annualized growth rate (CAGR) between p0 and p1."""
    try:
        if p0 is None or p1 is None or years <= 0 or p0 <= 0 or p1 <= 0:
            return None
        return (p1 / p0) ** (1.0 / years) - 1.0
    except Exception:
        return None


def fetch_acs5_profile_year(year: int, geo_type: str, geoid: str, vars_: list[str]) -> tuple[dict, str]:
    """Fetch ACS 5-year profile for a given year. Returns (row_dict, url)."""
    base = f'https://api.census.gov/data/{year}/acs/acs5/profile'
    if geo_type == 'county':
        for_param = f"county:{geoid[-3:]}"
    else:
        # Both 'place' and 'cdp' geography types use the Census 'place:' prefix;
        # CDPs are classified as places in the Census API geography hierarchy.
        for_param = f"place:{geoid[2:]}"
    key = census_key()
    # Build the query string manually to preserve literal colons in the
    # Census API geography parameters (for= and in=).  urllib.parse.urlencode
    # encodes ':' as '%3A', which the Census API does not decode, causing it
    # to report "ambiguous geography" errors for county-level queries.
    # The API key is percent-encoded separately since it may contain arbitrary
    # characters (e.g. '+', '&', '=') that must be escaped.
    qs = f"get={','.join(vars_)}&for={for_param}&in=state:{STATE_FIPS_CO}"
    if key:
        qs += f"&key={urllib.parse.quote(key, safe='')}"
    url = f"{base}?{qs}"
    arr = json.loads(http_get(url))
    header, row = arr[0], arr[1]
    return ({header[i]: row[i] for i in range(len(header))}, url)


def fetch_counties() -> list[dict]:
    base = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query'
    params = urllib.parse.urlencode({
        # STATEFP is the correct TIGERweb field for the state FIPS code.
        # STATE= was the old alias; use STATEFP= to match the JS fetch logic.
        'where': f"STATEFP='{STATE_FIPS_CO}'",
        'outFields': 'NAME,GEOID',
        'returnGeometry': 'false',
        'orderByFields': 'NAME',
        'f': 'json'
    })
    url = f"{base}?{params}"
    try:
        data = json.loads(http_get(url))
    except Exception as e:
        print(f"⚠ fetch_counties: network unavailable ({e}); returning empty list", file=sys.stderr)
        return []
    out = []
    for f in data.get('features', []):
        a = f.get('attributes', {})
        geoid = str(a.get('GEOID', '')).zfill(5)
        name = a.get('NAME', '')
        if geoid and name:
            label = name if name.lower().endswith('county') else f"{name} County"
            out.append({'geoid': geoid, 'label': label})
    return out


def build_place_geoid(place_code: str) -> str:
    """Build a 7-digit Colorado place GEOID from a 5-digit Census place code."""
    return STATE_FIPS_CO + place_code.zfill(5)


def fetch_place_county_map(counties: list[dict]) -> dict[str, str]:
    """Build a map from place GEOID to primary containing county FIPS-5.

    Queries each Colorado county for its places using the Census ACS 5-year API.
    Counties are iterated in ascending GEOID order (i.e. ascending 5-digit FIPS,
    which includes the 2-digit state prefix).  For places that span multiple
    counties the county with the lowest full GEOID is recorded as primary.
    """
    key = census_key()
    acs5_year = acs_start_year()
    place_county: dict[str, str] = {}
    # Sort counties by GEOID so multi-county places get a deterministic primary county
    sorted_counties = sorted(counties, key=lambda c: c['geoid'])
    for c in sorted_counties:
        county_code = c['geoid'][2:]  # strip state prefix, get 3-digit county FIPS
        # Census API requires literal comma in geography hierarchy — build manually
        qs = f"get=NAME&for=place:*&in=state:{STATE_FIPS_CO},county:{county_code}"
        if key:
            qs += f"&key={urllib.parse.quote(key, safe='')}"
        url = f"https://api.census.gov/data/{acs5_year}/acs/acs5?{qs}"
        try:
            status, raw = http_get_text(url, timeout=15, retries=2)
            if status != 200:
                continue
            arr = json.loads(raw)
        except Exception:
            continue
        if len(arr) < 2:
            continue
        header = arr[0]
        place_idx = header.index('place') if 'place' in header else -1
        if place_idx < 0:
            continue
        for row in arr[1:]:
            place_code = row[place_idx] if place_idx < len(row) else ''
            if not place_code:
                continue
            geoid = build_place_geoid(place_code)
            if geoid not in place_county:
                place_county[geoid] = c['geoid']
    return place_county


def fetch_places(counties: list[dict] | None = None,
                 place_county: dict[str, str] | None = None) -> list[dict]:
    """Fetch all incorporated places (municipalities) in Colorado from Census API.

    Uses the ACS 5-year name lookup to get GEOIDs and names for all
    incorporated places (cities, towns) in Colorado, with containingCounty
    populated for each place via county-level queries.
    """
    key = census_key()
    acs5_year = acs_start_year()
    # Build query string manually to preserve literal colons in Census API
    # geography params (urlencode encodes ':' as '%3A', breaking the API).
    qs = f"get=NAME&for=place:*&in=state:{STATE_FIPS_CO}"
    if key:
        qs += f"&key={urllib.parse.quote(key, safe='')}"
    url = f"https://api.census.gov/data/{acs5_year}/acs/acs5?{qs}"
    try:
        raw = http_get(url)
        arr = json.loads(raw)
    except Exception as e:
        print(f"⚠ fetch_places: unavailable ({e}); returning empty list", file=sys.stderr)
        return []
    if len(arr) < 2:
        return []
    header = arr[0]
    name_idx = header.index('NAME') if 'NAME' in header else -1
    place_idx = header.index('place') if 'place' in header else -1
    if name_idx < 0 or place_idx < 0:
        return []
    # Build place→county map so every entry gets a containingCounty
    if place_county is None:
        if counties is None:
            counties = fetch_counties()
        place_county = fetch_place_county_map(counties) if counties else {}
    out = []
    cdp_suffixes = (' cdp', ' (cdp)')
    for row in arr[1:]:
        name = row[name_idx] if name_idx < len(row) else ''
        place_code = row[place_idx] if place_idx < len(row) else ''
        if not name or not place_code:
            continue
        # Split "City Name, Colorado" → "City Name"
        label = name.split(',')[0].strip()
        # Skip CDPs (they will be in fetch_cdps)
        label_lower = label.lower()
        if any(label_lower.endswith(s) for s in cdp_suffixes) or 'cdp' in label_lower.split():
            continue
        geoid = build_place_geoid(place_code)
        entry: dict = {'type': 'place', 'geoid': geoid, 'label': label}
        county_fips = place_county.get(geoid)
        if county_fips:
            entry['containingCounty'] = county_fips
        out.append(entry)
    out.sort(key=lambda x: x['label'])
    return out


def fetch_cdps(counties: list[dict] | None = None,
               place_county: dict[str, str] | None = None) -> list[dict]:
    """Fetch all Census-Designated Places (CDPs) in Colorado from Census API,
    with containingCounty populated for each CDP via county-level queries."""
    key = census_key()
    acs5_year = acs_start_year()
    # Build query string manually to preserve literal colons in Census API
    # geography params (urlencode encodes ':' as '%3A', breaking the API).
    qs = f"get=NAME&for=place:*&in=state:{STATE_FIPS_CO}"
    if key:
        qs += f"&key={urllib.parse.quote(key, safe='')}"
    url = f"https://api.census.gov/data/{acs5_year}/acs/acs5?{qs}"
    try:
        raw = http_get(url)
        arr = json.loads(raw)
    except Exception as e:
        print(f"⚠ fetch_cdps: unavailable ({e}); returning empty list", file=sys.stderr)
        return []
    if len(arr) < 2:
        return []
    header = arr[0]
    name_idx = header.index('NAME') if 'NAME' in header else -1
    place_idx = header.index('place') if 'place' in header else -1
    if name_idx < 0 or place_idx < 0:
        return []
    # Reuse place→county map (CDPs appear in the same Census place query)
    if place_county is None:
        if counties is None:
            counties = fetch_counties()
        place_county = fetch_place_county_map(counties) if counties else {}
    out = []
    for row in arr[1:]:
        name = row[name_idx] if name_idx < len(row) else ''
        place_code = row[place_idx] if place_idx < len(row) else ''
        if not name or not place_code:
            continue
        label = name.split(',')[0].strip()
        label_lower = label.lower()
        # Only include CDPs
        if not (any(label_lower.endswith(s) for s in (' cdp', ' (cdp)')) or
                '(cdp)' in label_lower):
            continue
        # Normalise label: strip trailing " CDP" / "(CDP)"
        for suffix in [' (CDP)', ' CDP', ' (cdp)', ' cdp']:
            if label.endswith(suffix):
                label = label[:-len(suffix)].strip() + ' (CDP)'
                break
        geoid = build_place_geoid(place_code)
        entry: dict = {'type': 'cdp', 'geoid': geoid, 'label': label}
        county_fips = place_county.get(geoid)
        if county_fips:
            entry['containingCounty'] = county_fips
        out.append(entry)
    out.sort(key=lambda x: x['label'])
    return out


def census_key() -> str:
    return os.environ.get('CENSUS_API_KEY', '').strip()


def acs_start_year() -> int:
    """Return the primary ACS data year to target (configurable via ACS_START_YEAR env var)."""
    return int(os.environ.get('ACS_START_YEAR', '2024'))


def _fetch_acs5_b_series(geo_type: str, geoid: str) -> dict | None:
    """Fetch ACS 5-year B-series data for any geography type.

    Used as a fallback when ACS profile (DP) tables fail.  B-series detailed
    tables support all geography types (county, place, CDP) and are more
    stable across ACS releases than DP profile variables.  Results are mapped
    to DP-series variable names for compatibility with the UI.
    """
    # B-series variables available via ACS 5-year for all geographies
    b_vars = [
        'B01003_001E',  # total population           → DP05_0001E
        'B11001_001E',  # total households            → DP02_0001E
        'B19013_001E',  # median household income     → DP03_0062E
        'B25001_001E',  # total housing units         → DP04_0001E
        'B25003_001E',  # occupied housing units total
        'B25003_002E',  # owner-occupied              → DP04_0046PE (%)
        'B25003_003E',  # renter-occupied             → DP04_0047PE (%)
        'B25077_001E',  # median home value           → DP04_0089E
        'B25064_001E',  # median gross rent           → DP04_0134E
        # Structure by units in building              → DP04_0003E–0010E
        'B25024_002E',  # 1-unit detached
        'B25024_003E',  # 1-unit attached
        'B25024_004E',  # 2 units
        'B25024_005E',  # 3–4 units
        'B25024_006E',  # 5–9 units
        'B25024_007E',  # 10–19 units
        'B25024_008E',  # 20–49 units
        'B25024_009E',  # 50+ units
        'B25024_010E',  # mobile home
        # GRAPI rent burden                           → DP04_0142PE–0146PE
        'B25070_001E',  # renter-occupied paying rent (GRAPI denominator)
        'B25070_006E',  # 25.0–29.9 percent
        'B25070_007E',  # 30.0–34.9 percent          → DP04_0145PE
        'B25070_008E',  # 35.0–39.9 percent
        'B25070_009E',  # 40.0–49.9 percent
        'B25070_010E',  # 50.0 percent or more
        'NAME',
    ]

    place_code = geoid[2:]  # strip 2-digit state prefix
    key = census_key()

    # Build geography parameters based on geo_type
    if geo_type == 'county':
        for_param = f"county:{geoid[-3:]}"
    else:
        for_param = f"place:{place_code}"

    start_year = acs_start_year()
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3'))
    years_to_try = list(range(start_year, start_year - n_fallback, -1))

    for year in years_to_try:
        base = f'https://api.census.gov/data/{year}/acs/acs5'
        # Build the query string manually to preserve literal colons in the
        # Census API geography parameters (for= and in=).  urllib.parse.urlencode
        # encodes ':' as '%3A', which the Census API does not decode, causing it
        # to report "ambiguous geography" errors for county-level queries.
        qs = f"get={','.join(b_vars)}&for={for_param}&in=state:{STATE_FIPS_CO}"
        if key:
            qs += f"&key={urllib.parse.quote(key, safe='')}"
        url = f"{base}?{qs}"
        result = http_get_json(url)
        if result and len(result) > 1:
            raw = {result[0][i]: result[1][i] for i in range(len(result[0]))}
            print(f"ℹ {geo_type}:{geoid}: resolved via ACS5 B-series year={year}", file=sys.stderr)

            def si(v):
                try:
                    n = int(v)
                    return n if n >= 0 else None
                except Exception:
                    return None

            def sf(v):
                try:
                    n = float(v)
                    return n if n >= 0 else None
                except Exception:
                    return None

            pop = si(raw.get('B01003_001E'))
            occ = si(raw.get('B25003_001E'))
            owner = si(raw.get('B25003_002E'))
            renter = si(raw.get('B25003_003E'))
            grapi_tot = si(raw.get('B25070_001E'))
            burden30 = si(raw.get('B25070_007E'))
            burden35a = si(raw.get('B25070_008E'))
            burden35b = si(raw.get('B25070_009E'))
            burden35c = si(raw.get('B25070_010E'))

            # Compute percentages that mirror DP-series fields
            # ACS 2023: DP04_0046PE = owner %, DP04_0047PE = renter % (not swapped)
            owner_pct = round(owner / occ * 100, 1) if (occ and owner is not None) else None
            renter_pct = round(renter / occ * 100, 1) if (occ and renter is not None) else None

            # Aggregate structure "20+" for DP04_0013E (20–49 + 50+)
            s20_49 = si(raw.get('B25024_008E'))
            s50p = si(raw.get('B25024_009E'))
            units_20p = (s20_49 or 0) + (s50p or 0) if (s20_49 is not None or s50p is not None) else None

            # GRAPI burden bins (% of renter-occupied paying rent)
            def grapi_pct(n):
                if n is None or grapi_tot is None or grapi_tot <= 0:
                    return None
                return round(n / grapi_tot * 100, 1)

            b30_34 = burden30
            burden35_total = sum(
                v for v in [burden35a, burden35b, burden35c] if v is not None
            ) if any(v is not None for v in [burden35a, burden35b, burden35c]) else None
            # Pre-compute ≥30% burdened for frontend renderHousingGapSummary (DP04_0136PE slot)
            burden30_plus = (b30_34 or 0) + (burden35_total or 0)

            mapped = {
                'DP05_0001E': raw.get('B01003_001E'),
                'DP02_0001E': raw.get('B11001_001E'),
                'DP03_0062E': raw.get('B19013_001E'),
                'DP04_0001E': raw.get('B25001_001E'),
                # Tenure — ACS 2023 correct orientation: DP04_0046PE=owner %, DP04_0047PE=renter %
                'DP04_0046PE': str(owner_pct) if owner_pct is not None else None,
                'DP04_0047PE': str(renter_pct) if renter_pct is not None else None,
                'DP04_0046E': raw.get('B25003_002E'),   # owner HH count
                'DP04_0047E': raw.get('B25003_003E'),   # renter HH count (used by Housing Gap panel)
                'DP04_0089E': raw.get('B25077_001E'),
                'DP04_0134E': raw.get('B25064_001E'),
                # Structure type — ACS 2023 codes: DP04_0007E=1-unit detached … DP04_0014E=mobile home
                # (In older ACS this section started at DP04_0003E; it shifted to DP04_0007E in 2023)
                'DP04_0007E': raw.get('B25024_002E'),   # 1-unit detached
                'DP04_0008E': raw.get('B25024_003E'),   # 1-unit attached
                'DP04_0009E': raw.get('B25024_004E'),   # 2 units
                'DP04_0010E': raw.get('B25024_005E'),   # 3-4 units
                'DP04_0011E': raw.get('B25024_006E'),   # 5-9 units
                'DP04_0012E': raw.get('B25024_007E'),   # 10-19 units
                'DP04_0013E': str(units_20p) if units_20p is not None else None,  # 20+ units
                'DP04_0014E': raw.get('B25024_010E'),   # mobile home
                # GRAPI — store pre-computed ≥30% in DP04_0136PE slot (frontend reads this as cost-burdened %)
                # DP04_0141PE = 30–34.9% bin, DP04_0142PE = 35%+ bin
                'DP04_0136PE': str(grapi_pct(burden30_plus)) if grapi_tot else None,   # ≥30% burdened
                'DP04_0141PE': str(grapi_pct(b30_34)) if b30_34 is not None else None,  # 30–34.9%
                'DP04_0142PE': str(grapi_pct(burden35_total)) if burden35_total is not None else None,  # 35%+
                'NAME': raw.get('NAME'),
            }
            return mapped

    print(f"⚠ {geo_type}:{geoid}: ACS5 B-series also failed (tried years {years_to_try})", file=sys.stderr)
    return None


def fetch_acs_profile(geo_type: str, geoid: str) -> dict | None:
    """Fetch ACS profile with fallback chain: ACS1/profile → ACS1/subject → ACS5/profile.
    For CDPs, adds ACS 5-year B-series as a final fallback.

    ACS variable code notes (verified against ACS 5-year 2023 variable list):
    - DP04_0046PE = Owner-occupied %  (DP04_0047PE = Renter-occupied %)
    - Structure type starts at DP04_0007E in ACS 2023 (older years had it at DP04_0003E)
    - GRAPI bins: DP04_0137PE (<15%) … DP04_0142PE (≥35%). DP04_0143–0146 do not exist
      in ACS 2023 and cause HTTP 400 for the entire request if included.
    """
    vars_ = [
        'DP05_0001E',   # Total population
        'DP03_0062E',   # Median household income
        'DP04_0001E',   # Total housing units
        # Housing tenure (ACS 2023: DP04_0046PE=owner %, DP04_0047PE=renter %)
        'DP04_0046PE',  # Owner-occupied %
        'DP04_0047PE',  # Renter-occupied %
        'DP04_0047E',   # Renter-occupied count (used by renderHousingGapSummary)
        'DP04_0089E',   # Median home value (owner)
        'DP04_0134E',   # Median gross rent
        # Occupancy/vacancy (DP04_0003E–0005E in ACS 2023 = vacant HH, homeowner vac rate, rental vac rate)
        'DP04_0005E',   # Rental vacancy rate
        # Structure type (ACS 2023: DP04_0007E = 1-unit detached … DP04_0014E = mobile home)
        # In older ACS years this section started at DP04_0003E; it now starts at DP04_0007E
        'DP04_0007E','DP04_0008E','DP04_0009E','DP04_0010E',
        'DP04_0011E','DP04_0012E','DP04_0013E','DP04_0014E',
        # GRAPI rent burden bins (ACS 2023 confirmed codes; DP04_0144–0146PE do not exist)
        # DP04_0137PE=<15%, DP04_0138PE=15–19.9%, DP04_0139PE=20–24.9%, DP04_0140PE=25–29.9%
        # DP04_0141PE=30–34.9%, DP04_0142PE=35%+
        'DP04_0137PE','DP04_0138PE','DP04_0139PE','DP04_0140PE',
        'DP04_0141PE','DP04_0142PE',
        'NAME'
    ]

    def build_url(year: int, endpoint: str, series: str = 'acs1') -> str:
        base = f'https://api.census.gov/data/{year}/acs/{series}/{endpoint}'
        if geo_type == 'county':
            for_ = f"county:{geoid[-3:]}"
        elif geo_type == 'place':
            for_ = f"place:{geoid[2:]}"
        else:
            for_ = f"place:{geoid[2:]}"
        key = census_key()
        # Build the query string manually to preserve literal colons in the
        # Census API geography parameters (for= and in=).  urllib.parse.urlencode
        # encodes ':' as '%3A', which the Census API does not decode, causing it
        # to report "ambiguous geography" errors for county-level queries.
        qs = f"get={','.join(vars_)}&for={for_}&in=state:{STATE_FIPS_CO}"
        if key:
            qs += f"&key={urllib.parse.quote(key, safe='')}"
        return f"{base}?{qs}"

    # Try each year from ACS_START_YEAR down, over ACS_FALLBACK_YEARS years;
    # for each year try ACS1/profile → ACS1/subject → ACS5/profile in order.
    # Years and depth are configurable via env vars for easy maintenance.
    start_year = acs_start_year()
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3'))
    years_to_try = list(range(start_year, start_year - n_fallback, -1))

    for year in years_to_try:
        for series, endpoint in [('acs1', 'profile'), ('acs1', 'subject'), ('acs5', 'profile')]:
            url = build_url(year, endpoint, series)
            result = http_get_json(url)
            if result and len(result) > 1:
                if year != start_year:
                    print(f"ℹ ACS profile {geo_type}:{geoid} resolved via {series}/{endpoint} year={year}", file=sys.stderr)
                return {result[0][i]: result[1][i] for i in range(len(result[0]))}

    print(f"⚠ Could not fetch ACS profile for {geo_type}:{geoid} (tried years {years_to_try})", file=sys.stderr)
    # ACS profile/subject tables may fail for some geographies and ACS years
    # (e.g. CDPs not in profile tables; DP variable numbering can shift between
    # releases).  Fall back to ACS 5-year B-series which covers all geography
    # types and uses stable variable codes.
    print(f"ℹ {geo_type}:{geoid}: attempting ACS5 B-series fallback", file=sys.stderr)
    return _fetch_acs5_b_series(geo_type, geoid)


def fetch_acs_s0801(geo_type: str, geoid: str) -> dict | None:
    """Fetch ACS S0801 with fallback: ACS1/subject → ACS5/subject."""
    vars_ = [
        'S0801_C01_001E',  # Workers 16+ (count)
        'S0801_C01_002E',  # Car/truck/van total parent (drove-alone + carpooled, %)
        'S0801_C01_003E',  # Drove alone (%)
        'S0801_C01_004E',  # Carpooled (%)
        'S0801_C01_005E',  # Public transit (%)
        'S0801_C01_006E',  # Walked (%)
        'S0801_C01_007E',  # Taxicab, motorcycle, bicycle, or other means (%)
        'S0801_C01_008E',  # Worked at home (%)
        'S0801_C01_018E',  # Mean travel time to work (minutes)
        'NAME'
    ]

    def build_url(year: int, endpoint: str, series: str = 'acs1') -> str:
        base = f'https://api.census.gov/data/{year}/acs/{series}/{endpoint}'
        if geo_type == 'county':
            for_ = f"county:{geoid[-3:]}"
        elif geo_type == 'place':
            for_ = f"place:{geoid[2:]}"
        else:
            for_ = f"place:{geoid[2:]}"
        key = census_key()
        # Build the query string manually to preserve literal colons in the
        # Census API geography parameters (for= and in=).  urllib.parse.urlencode
        # encodes ':' as '%3A', which the Census API does not decode, causing it
        # to report "ambiguous geography" errors for county-level queries.
        qs = f"get={','.join(vars_)}&for={for_}&in=state:{STATE_FIPS_CO}"
        if key:
            qs += f"&key={urllib.parse.quote(key, safe='')}"
        return f"{base}?{qs}"

    # Try ACS1/subject → ACS5/subject for each year
    # Years are configurable: ACS_START_YEAR (default 2024), ACS_FALLBACK_YEARS (default 3)
    start_year = acs_start_year()
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3'))
    years_to_try = list(range(start_year, start_year - n_fallback, -1))

    for year in years_to_try:
        url = build_url(year, 'subject', 'acs1')
        result = http_get_json(url)
        if result and len(result) > 1:
            if year != start_year:
                print(f"ℹ Using ACS1/subject {year} for {geo_type}:{geoid}", file=sys.stderr)
            data = {result[0][i]: result[1][i] for i in range(len(result[0]))}
            # Record which vintage and series were actually used (commuting reliability).
            data['_acsYear'] = year
            data['_acsSeries'] = 'acs1'
            return data

        url = build_url(year, 'subject', 'acs5')
        print(f"ℹ Falling back to ACS5/subject {year} for {geo_type}:{geoid}", file=sys.stderr)
        result = http_get_json(url)
        if result and len(result) > 1:
            data = {result[0][i]: result[1][i] for i in range(len(result[0]))}
            data['_acsYear'] = year
            data['_acsSeries'] = 'acs5'
            return data

    print(f"⚠ Could not fetch ACS S0801 for {geo_type}:{geoid} (tried years {years_to_try})", file=sys.stderr)
    return None


def fetch_acs_b08301(geo_type: str, geoid: str) -> dict | None:
    """Fetch ACS B08301 (Means of Transportation to Work) with ACS1→ACS5 fallback.

    Returns a normalised dict with keys:
        drive, carpool, transit, walk, bike, work_from_home, other, total
    All values are integer worker counts.
    """
    # B08301 variable mapping:
    #   B08301_001E – Total workers 16+
    #   B08301_003E – Drove alone
    #   B08301_004E – Carpooled
    #   B08301_010E – Public transit (excl. taxicab)
    #   B08301_018E – Bicycle
    #   B08301_019E – Walked
    #   B08301_020E – Taxicab / motorcycle / other means
    #   B08301_021E – Worked from home
    vars_ = [
        'B08301_001E',  # Total
        'B08301_003E',  # Drove alone
        'B08301_004E',  # Carpooled
        'B08301_010E',  # Public transit
        'B08301_018E',  # Bicycle
        'B08301_019E',  # Walked
        'B08301_020E',  # Taxicab / motorcycle / other
        'B08301_021E',  # Worked from home
        'NAME',
    ]

    def build_url(year: int, series: str = 'acs1') -> str:
        base = f'https://api.census.gov/data/{year}/acs/{series}'
        if geo_type == 'county':
            for_ = f"county:{geoid[-3:]}"
            in_ = f"state:{STATE_FIPS_CO}"
        elif geo_type in ('place', 'cdp'):
            for_ = f"place:{geoid[2:]}"
            in_ = f"state:{STATE_FIPS_CO}"
        else:
            for_ = f"state:{STATE_FIPS_CO}"
            in_ = None
        key = census_key()
        qs = f"get={','.join(vars_)}&for={for_}"
        if in_:
            qs += f"&in={in_}"
        if key:
            qs += f"&key={urllib.parse.quote(key, safe='')}"
        return f"{base}?{qs}"

    start_year = acs_start_year()
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3'))
    years_to_try = list(range(start_year, start_year - n_fallback, -1))

    raw = None
    for year in years_to_try:
        for series in ('acs1', 'acs5'):
            url = build_url(year, series)
            result = http_get_json(url)
            if result and len(result) > 1:
                raw = {result[0][i]: result[1][i] for i in range(len(result[0]))}
                break
        if raw:
            break

    if not raw:
        print(f"⚠ Could not fetch ACS B08301 for {geo_type}:{geoid}", file=sys.stderr)
        return None

    def _int(key: str) -> int:
        try:
            v = raw.get(key)
            return int(v) if v is not None and str(v) != '-1' else 0
        except (TypeError, ValueError):
            return 0

    return {
        'total':          _int('B08301_001E'),
        'drive':          _int('B08301_003E'),
        'carpool':        _int('B08301_004E'),
        'transit':        _int('B08301_010E'),
        'bike':           _int('B08301_018E'),
        'walk':           _int('B08301_019E'),
        'other':          _int('B08301_020E'),
        'work_from_home': _int('B08301_021E'),
    }


def _run_diagnostics(geo_type: str, geoid: str) -> None:
    """Run ACS diagnostics and log results when all fetch attempts fail."""
    if _acs_diag is None:
        print("⚠ acs_debug_tools not available; skipping diagnostics", file=sys.stderr)
        return
    log_path = OUT['acs_debug_log']
    print(f"ℹ Running ACS diagnostics for {geo_type}:{geoid} → {log_path}", file=sys.stderr)
    result = _acs_diag.run_acs_diagnostics(geo_type, geoid, log_path)
    if result['success']:
        print(f"ℹ Diagnostics found working endpoint: {result['source']}", file=sys.stderr)
    else:
        print(
            f"⚠ ACS diagnostics: all endpoints failed for {geo_type}:{geoid}. "
            f"Log written to {log_path}",
            file=sys.stderr,
        )


def build_summary_cache():
    # Build the full list of geographies to cache: FEATURED first, then all
    # counties, places, and CDPs from geo-config that are not already covered.
    all_geos: list[dict] = list(FEATURED)
    featured_geoids = {g['geoid'] for g in FEATURED}

    try:
        with open(OUT['geo_config'], 'r', encoding='utf-8') as _f:
            gc = json.load(_f)
        for c in gc.get('counties', []):
            if c['geoid'] not in featured_geoids:
                all_geos.append({'type': 'county', 'geoid': c['geoid'], 'label': c['label']})
        for p in gc.get('places', []):
            if p['geoid'] not in featured_geoids:
                all_geos.append({'type': 'place', 'geoid': p['geoid'], 'label': p['label']})
        for cdp in gc.get('cdps', []):
            if cdp['geoid'] not in featured_geoids:
                all_geos.append({'type': 'cdp', 'geoid': cdp['geoid'], 'label': cdp['label']})
    except Exception as e:
        print(f"ℹ build_summary_cache: could not load geo-config ({e}); caching featured geos only", file=sys.stderr)

    start_year = acs_start_year()
    for g in all_geos:
        geoid = g['geoid']
        geo_type = g['type']
        out_path = os.path.join(OUT['summary_dir'], f"{geoid}.json")
        try:
            acs_profile = fetch_acs_profile(geo_type, geoid)
            acs_s0801 = fetch_acs_s0801(geo_type, geoid)
            acs_b08301 = fetch_acs_b08301(geo_type, geoid)
            if acs_profile is None and acs_s0801 is None:
                print(f"⚠ summary {geo_type}:{geoid}: no ACS data available – running diagnostics", file=sys.stderr)
                _run_diagnostics(geo_type, geoid)
                continue
            if acs_profile is None:
                print(f"⚠ summary {geo_type}:{geoid}: ACS profile missing; writing partial summary", file=sys.stderr)
            if acs_s0801 is None:
                print(f"⚠ summary {geo_type}:{geoid}: ACS S0801 missing; writing partial summary", file=sys.stderr)
            # Derive actually-used series/year for source endpoint accuracy
            # (commuting reliability: the endpoint should reflect the data truly used).
            s0801_year = (acs_s0801 or {}).get('_acsYear', start_year)
            s0801_series = (acs_s0801 or {}).get('_acsSeries', 'acs1')
            payload = {
                'updated': utc_now_z(),
                'geo': g,
                'acsProfile': normalize_acs_dict(acs_profile),
                'acsS0801': normalize_acs_dict(acs_s0801),
                'acsB08301': normalize_acs_dict(acs_b08301),
                'source': {
                    'acs_profile_endpoint': f'https://api.census.gov/data/{start_year}/acs/acs1/profile',
                    'acs_s0801_endpoint': (
                        f'https://api.census.gov/data/{s0801_year}/acs/{s0801_series}/subject'
                    ),
                    'acs_b08301_endpoint': f'https://api.census.gov/data/{start_year}/acs/acs1'
                }
            }
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(payload, f)
            _log_file_written(out_path, f"summary:{geoid}")
        except Exception as e:
            print(f"✗ summary {geo_type}:{geoid}: {e}", file=sys.stderr)


def build_lehd_by_county():
    # LODES8 CO OD main file index: https://lehd.ces.census.gov/data/lodes/LODES8/co/od/
    year = os.environ.get('LODES_YEAR', '2022').strip() or '2022'
    url = f"https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_{year}.csv.gz"

    print(f"Downloading LEHD LODES OD (CO) {year}...")
    raw = http_get(url, timeout=120)
    bio = io.BytesIO(raw)

    within = {}
    inflow = {}
    outflow = {}

    with gzip.GzipFile(fileobj=bio, mode='rb') as gz:
        reader = csv.DictReader(io.TextIOWrapper(gz, encoding='utf-8', newline=''))
        for row in reader:
            try:
                h = row.get('h_geocode', '')
                w = row.get('w_geocode', '')
                c = int(row.get('S000', '0') or '0')
                if len(h) < 5 or len(w) < 5 or c <= 0:
                    continue
                hc = h[:5]
                wc = w[:5]
                if hc == wc:
                    within[hc] = within.get(hc, 0) + c
                else:
                    outflow[hc] = outflow.get(hc, 0) + c
                    inflow[wc] = inflow.get(wc, 0) + c
            except Exception:
                continue

    # Write one JSON per county
    counties = fetch_counties()
    county_ids = {c['geoid'] for c in counties}

    for c in sorted(county_ids):
        payload = {
            'updated': utc_now_z(),
            'year': int(year),
            'countyFips': c,
            'within': within.get(c, 0),
            'inflow': inflow.get(c, 0),
            'outflow': outflow.get(c, 0),
            'source': {
                'dataset': 'LEHD LODES8 OD main (JT00)',
                'url': url
            }
        }
        with open(os.path.join(OUT['lehd_dir'], f"{c}.json"), 'w', encoding='utf-8') as f:
            json.dump(payload, f)
        _log_file_written(os.path.join(OUT['lehd_dir'], f"{c}.json"), f"lehd:{c}")

    print(f"✓ LEHD county summaries written: {len(county_ids)}")


# WAC columns to aggregate: total employment + wage bands + top industries
_WAC_TOTAL_COL = 'C000'
_WAC_WAGE_COLS = ('CE01', 'CE02', 'CE03')
_WAC_INDUSTRY_COLS = (
    'CNS01', 'CNS02', 'CNS03', 'CNS04', 'CNS05', 'CNS06', 'CNS07',
    'CNS08', 'CNS09', 'CNS10', 'CNS11', 'CNS12', 'CNS13', 'CNS14',
    'CNS15', 'CNS16', 'CNS17', 'CNS18', 'CNS19', 'CNS20',
)
_WAC_INDUSTRY_LABELS = {
    'CNS01': 'Agriculture & Forestry',
    'CNS02': 'Mining & Oil/Gas',
    'CNS03': 'Utilities',
    'CNS04': 'Construction',
    'CNS05': 'Manufacturing',
    'CNS06': 'Wholesale Trade',
    'CNS07': 'Retail Trade',
    'CNS08': 'Transportation & Warehousing',
    'CNS09': 'Information',
    'CNS10': 'Finance & Insurance',
    'CNS11': 'Real Estate',
    'CNS12': 'Professional & Technical Services',
    'CNS13': 'Management',
    'CNS14': 'Admin & Waste Services',
    'CNS15': 'Educational Services',
    'CNS16': 'Healthcare & Social Assistance',
    'CNS17': 'Arts & Entertainment',
    'CNS18': 'Accommodation & Food Services',
    'CNS19': 'Other Services',
    'CNS20': 'Public Administration',
}
# Years to fetch for multi-year WAC snapshots (OD year is separate from WAC)
_WAC_SNAPSHOT_YEARS = [2019, 2020, 2021, 2022, 2023]

# Synthetic WAC fallback constants — used when LEHD downloads are unavailable
# (e.g., offline / CI environments without external network access).
# Employment growth factors relative to the 2022 LODES OD `within` baseline.
_SYNTHETIC_GROWTH_FACTORS: dict[int, float] = {
    2019: 1.03,   # pre-COVID baseline
    2020: 0.92,   # COVID-year contraction
    2021: 0.97,   # partial recovery
    2022: 1.00,   # LODES OD base year (`within` value)
    2023: 1.02,   # continued recovery / growth
}

# Wage band shares (CE01 low ≤$1,250/mo, CE02 medium, CE03 high >$3,333/mo)
# Based on Colorado statewide LEHD 2022 actuals.
_SYNTHETIC_WAGE_BANDS: dict[str, float] = {
    'CE01': 0.23,
    'CE02': 0.40,
    'CE03': 0.37,
}

# Industry sector shares (CNS01–CNS20) — Colorado statewide approximation.
_SYNTHETIC_INDUSTRY_SHARES: dict[str, float] = {
    'CNS01': 0.02,  # Agriculture & Forestry
    'CNS02': 0.02,  # Mining & Oil/Gas
    'CNS03': 0.01,  # Utilities
    'CNS04': 0.07,  # Construction
    'CNS05': 0.05,  # Manufacturing
    'CNS06': 0.03,  # Wholesale Trade
    'CNS07': 0.10,  # Retail Trade
    'CNS08': 0.04,  # Transportation & Warehousing
    'CNS09': 0.03,  # Information
    'CNS10': 0.04,  # Finance & Insurance
    'CNS11': 0.02,  # Real Estate
    'CNS12': 0.10,  # Professional & Technical Services
    'CNS13': 0.02,  # Management
    'CNS14': 0.07,  # Admin & Waste Services
    'CNS15': 0.03,  # Educational Services
    'CNS16': 0.13,  # Healthcare & Social Assistance
    'CNS17': 0.02,  # Arts & Entertainment
    'CNS18': 0.10,  # Accommodation & Food Services
    'CNS19': 0.04,  # Other Services
    'CNS20': 0.06,  # Public Administration
}


def _fetch_wac_gz(year: int, state: str = 'co') -> bytes | None:
    """Download a LEHD WAC gzip file for *year*.  Returns None on HTTP error."""
    url = (
        f"https://lehd.ces.census.gov/data/lodes/LODES8/{state}/wac/"
        f"{state}_wac_S000_JT00_{year}.csv.gz"
    )
    print(f"  Downloading WAC {year}: {url}", file=sys.stderr)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HNA-ETL/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            if r.status == 404:
                print(f"  WAC {year}: 404 (file not yet published)", file=sys.stderr)
                return None
            raw = r.read()
        print(f"  WAC {year}: {len(raw):,} bytes downloaded", file=sys.stderr)
        return raw
    except Exception as exc:
        print(f"  WAC {year}: download error — {exc}", file=sys.stderr)
        return None


def _parse_wac_by_county(raw_gz: bytes) -> dict[str, dict[str, int]]:
    """Parse a WAC gzip CSV and return {county_fips5: {col: total, …}}."""
    agg: dict[str, dict[str, int]] = {}
    cols_to_agg = (_WAC_TOTAL_COL,) + _WAC_WAGE_COLS + _WAC_INDUSTRY_COLS

    with gzip.GzipFile(fileobj=io.BytesIO(raw_gz), mode='rb') as gz:
        reader = csv.DictReader(io.TextIOWrapper(gz, encoding='utf-8', newline=''))
        for row in reader:
            geocode = row.get('w_geocode', '')
            if len(geocode) < 5:
                continue
            county = geocode[:5]
            bucket = agg.setdefault(county, {})
            for col in cols_to_agg:
                val = row.get(col)
                if val:
                    try:
                        bucket[col] = bucket.get(col, 0) + int(val)
                    except ValueError:
                        pass
    return agg


def _build_synthetic_wac_data(lehd_dir: str) -> dict[int, dict[str, dict[str, int]]]:
    """Generate synthetic WAC snapshots from existing LEHD OD county files.

    Used as a fallback when LEHD WAC downloads are unavailable (e.g., in CI or
    offline environments).  The synthetic data is derived from each county's
    existing ``within`` field (2022 LODES OD employment) using typical Colorado
    growth trajectories and industry / wage-band distributions defined in the
    ``_SYNTHETIC_*`` constants above.

    Returns a year_county mapping identical in structure to the one produced by
    real WAC downloads, so it can be passed directly into the WAC merge loop in
    ``build_lehd_wac_snapshots``.
    """
    year_county: dict[int, dict[str, dict[str, int]]] = {}
    if not os.path.isdir(lehd_dir):
        return year_county

    for filename in sorted(os.listdir(lehd_dir)):
        if not filename.endswith('.json'):
            continue
        fips = filename[:-5]
        try:
            with open(os.path.join(lehd_dir, filename), encoding='utf-8') as f:
                existing = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue

        base_emp = existing.get('within', 0) or 0
        if base_emp == 0:
            continue

        for yr, factor in _SYNTHETIC_GROWTH_FACTORS.items():
            total = max(1, round(base_emp * factor))
            agg: dict[str, int] = {'C000': total}
            for col, share in _SYNTHETIC_WAGE_BANDS.items():
                agg[col] = max(0, round(total * share))
            for col, share in _SYNTHETIC_INDUSTRY_SHARES.items():
                agg[col] = max(0, round(total * share))
            year_county.setdefault(yr, {})[fips] = agg

    return year_county


def build_lehd_wac_snapshots() -> None:
    """Fetch LEHD WAC data for 2019–2023 and merge into existing LEHD county files.

    For each county, adds/updates:
      - annualEmployment : {year: total_jobs, …}
      - annualWages      : {year: {low, medium, high}, …}
      - yoyGrowth        : {year: pct_change, …} (vs. prior year)
      - wacYear          : most recent WAC year successfully fetched
      - industries       : top-20 industry breakdown from the most recent year
    """
    print("\nBuilding LEHD WAC annual employment snapshots (2019–2023)…")
    year_county: dict[int, dict[str, dict[str, int]]] = {}

    for yr in _WAC_SNAPSHOT_YEARS:
        raw = _fetch_wac_gz(yr)
        if raw is None:
            print(f"  Skipping WAC {yr}", file=sys.stderr)
            continue
        by_county = _parse_wac_by_county(raw)
        year_county[yr] = by_county
        print(f"  WAC {yr}: {len(by_county)} counties parsed", file=sys.stderr)

    if not year_county:
        print("  No WAC data downloaded; falling back to synthetic WAC data from OD files …",
              file=sys.stderr)
        year_county = _build_synthetic_wac_data(OUT['lehd_dir'])
        if not year_county:
            print("  No LEHD OD county files found; skipping WAC snapshot update.", file=sys.stderr)
            return
        county_count = len(next(iter(year_county.values()), {}))
        print(f"  Synthetic WAC data generated for {county_count} counties (years: {sorted(_SYNTHETIC_GROWTH_FACTORS)}).",
              file=sys.stderr)
        _synthetic_wac = True
    else:
        _synthetic_wac = False

    sorted_years = sorted(year_county)
    primary_year = sorted_years[-1]
    print(f"  Primary WAC year: {primary_year}", file=sys.stderr)

    lehd_dir = OUT['lehd_dir']
    updated = 0

    for county_fips5 in sorted(
        {c for yr_data in year_county.values() for c in yr_data}
    ):
        # Annual total employment per year
        annual_emp: dict[str, int] = {}
        annual_wages: dict[str, dict[str, int]] = {}

        for yr in sorted_years:
            agg = year_county.get(yr, {}).get(county_fips5)
            if agg:
                annual_emp[str(yr)] = agg.get(_WAC_TOTAL_COL, 0)
                annual_wages[str(yr)] = {
                    'low':    agg.get('CE01', 0),
                    'medium': agg.get('CE02', 0),
                    'high':   agg.get('CE03', 0),
                }

        # YoY growth rates
        yoy_growth: dict[str, float | None] = {}
        yr_list = sorted_years
        for i in range(1, len(yr_list)):
            prev_yr = yr_list[i - 1]
            curr_yr = yr_list[i]
            prev_val = annual_emp.get(str(prev_yr))
            curr_val = annual_emp.get(str(curr_yr))
            if prev_val and curr_val and prev_val > 0:
                pct = round((curr_val - prev_val) / prev_val * 100.0, 2)
            else:
                pct = None
            yoy_growth[str(curr_yr)] = pct

        # Industry breakdown from primary year
        primary_agg = year_county.get(primary_year, {}).get(county_fips5, {})
        total = primary_agg.get(_WAC_TOTAL_COL, 0)
        industries = []
        for col in _WAC_INDUSTRY_COLS:
            count = primary_agg.get(col, 0)
            if count > 0:
                pct = round(count / total * 100.0, 1) if total > 0 else 0.0
                industries.append({
                    'naics': col,
                    'label': _WAC_INDUSTRY_LABELS.get(col, col),
                    'count': count,
                    'pct': pct,
                })
        industries.sort(key=lambda x: x['count'], reverse=True)

        # Also store top-level WAC fields for primary year (compatible with JS)
        wac_primary = primary_agg or {}

        # Merge into existing LEHD county file
        lehd_path = os.path.join(lehd_dir, f"{county_fips5}.json")
        try:
            with open(lehd_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            payload = {
                'updated': utc_now_z(),
                'countyFips': county_fips5,
                'within': 0,
                'inflow': 0,
                'outflow': 0,
            }

        payload.update({
            'wacYear':          primary_year,
            'annualEmployment': annual_emp,
            'annualWages':      annual_wages,
            'yoyGrowth':        yoy_growth,
            'industries':       industries,
        })
        if _synthetic_wac:
            payload['syntheticWac'] = True

        # Copy WAC primary-year fields (C000, CE01–CE03, CNS01–CNS20) for JS compatibility
        for col in (_WAC_TOTAL_COL,) + _WAC_WAGE_COLS + _WAC_INDUSTRY_COLS:
            if col in wac_primary:
                payload[col] = wac_primary[col]
        if total > 0:
            payload['C000'] = total

        with open(lehd_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f)
        _log_file_written(lehd_path, f"lehd-wac:{county_fips5}")
        updated += 1

    print(f"✓ LEHD WAC snapshots merged into {updated} county files (years: {sorted_years})")


def build_dola_sya_by_county():
    # URL discovered via SDO Data Download page: https://demography.dola.colorado.gov/assets/html/sdodata.html
    url = 'https://storage.googleapis.com/co-publicdata/sya-county.csv'
    cache_path = os.path.join(OUT['cache_dir'], 'dola_sya_county.csv')
    
    print('Downloading DOLA/SDO single-year-of-age county file...')
    status, text = http_get_text(url, timeout=120, retries=3)
    
    if status != 200:
        # Download failed; try cache
        if os.path.exists(cache_path):
            print(f"ℹ Using cached DOLA file: {cache_path}", file=sys.stderr)
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    text = f.read()
                status = 200
            except Exception as e:
                print(f"✗ Could not read cached DOLA file: {e}", file=sys.stderr)
                print(f"⚠ Skipped SYA build: download failed and no cached file available", file=sys.stderr)
                return
        else:
            print(f"⚠ Skipped SYA build: download failed and no cached file available", file=sys.stderr)
            return

    # Save to cache
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            f.write(text)
    except Exception as e:
        print(f"⚠ Could not cache DOLA file: {e}", file=sys.stderr)

    # Parse CSV with banner row tolerance
    fieldnames, reader = detect_header_and_reader(text)

    if reader is None or not fieldnames:
        print(f"⚠ Skipped SYA build: could not detect CSV header", file=sys.stderr)
        return

    # heuristics
    def pick(*cands):
        for c in cands:
            if c in fieldnames:
                return c
        return None

    f_county = pick('countyfips', 'county_fips', 'fips', 'county')
    f_year = pick('year', 'Year')
    f_age = pick('age', 'Age')
    f_sex = pick('sex', 'Sex')
    f_pop = pick('population', 'pop', 'Population', 'total')
    # Wide-format fallback: separate male/female columns per row
    f_male = pick('malepopulation', 'male_population', 'male', 'Male')
    f_female = pick('femalepopulation', 'female_population', 'female', 'Female')
    wide_format = f_male is not None and f_female is not None

    if not all([f_county, f_year, f_age]) or (not wide_format and not all([f_sex, f_pop])):
        print(f"⚠ Skipped SYA build: could not find required columns. Fields: {fieldnames}", file=sys.stderr)
        return

    # Gather available years and max age
    rows = []
    years = set()
    max_age = 0
    for r in reader:
        try:
            cf = STATE_FIPS_CO + str(int(float(r[f_county]))).zfill(3)
            yr = int(float(r[f_year]))
            age = int(float(r[f_age]))
            years.add(yr)
            max_age = max(max_age, age)
            if wide_format:
                rows.append((cf, yr, age, 'm', int(float(r[f_male]))))
                rows.append((cf, yr, age, 'f', int(float(r[f_female]))))
            else:
                rows.append((cf, yr, age, str(r[f_sex]).strip().lower(), int(float(r[f_pop]))))
        except Exception:
            continue

    if not rows:
        print(f"⚠ Skipped SYA build: no valid data rows found", file=sys.stderr)
        return

    years_sorted = sorted(years)
    # pick a pyramid year: 2030 if present else latest
    pyramid_year = 2030 if 2030 in years_sorted else years_sorted[-1]

    # senior pressure years
    target_years = [2020, 2024, 2030, 2035, 2040, 2045, 2050]
    avail_years = [y for y in target_years if y in years_sorted]
    if not avail_years:
        avail_years = [years_sorted[-1]]

    # bucket rows by county
    by_county: dict[str, dict] = {}
    for cf, yr, age, sex, pop in rows:
        d = by_county.setdefault(cf, {
            'pyramid': {'male': {}, 'female': {}},
            'totals_by_year': {},
            'age65_by_year': {}
        })

        if yr == pyramid_year:
            if 'm' in sex:
                d['pyramid']['male'][age] = d['pyramid']['male'].get(age, 0) + pop
            elif 'f' in sex:
                d['pyramid']['female'][age] = d['pyramid']['female'].get(age, 0) + pop

        if yr in avail_years:
            d['totals_by_year'][yr] = d['totals_by_year'].get(yr, 0) + pop
            if age >= 65:
                d['age65_by_year'][yr] = d['age65_by_year'].get(yr, 0) + pop

    # write json
    ages = list(range(0, max_age + 1))
    for cf, d in by_county.items():
        male = [d['pyramid']['male'].get(a, 0) for a in ages]
        female = [d['pyramid']['female'].get(a, 0) for a in ages]

        years_out = sorted(avail_years)
        pop65 = [d['age65_by_year'].get(y, 0) for y in years_out]
        tot = [d['totals_by_year'].get(y, 0) for y in years_out]
        share65 = [round((pop65[i] / tot[i] * 100), 3) if tot[i] else 0 for i in range(len(years_out))]

        payload = {
            'updated': utc_now_z(),
            'countyFips': cf,
            'pyramidYear': pyramid_year,
            'ages': ages,
            'male': male,
            'female': female,
            'seniorPressure': {
                'years': years_out,
                'pop65plus': pop65,
                'share65plus': share65
            },
            'source': {
                'dataset': 'Colorado SDO (DOLA) county single-year-of-age',
                'url': url,
                'notes': 'Pyramid uses the selected pyramidYear; senior pressure uses available years in the file.'
            }
        }
        with open(os.path.join(OUT['dola_dir'], f"{cf}.json"), 'w', encoding='utf-8') as f:
            json.dump(payload, f)
        _log_file_written(os.path.join(OUT['dola_dir'], f"{cf}.json"), f"dola_sya:{cf}")

    print(f"✓ DOLA SYA county files written: {len(by_county)}")


def build_dola_projections_by_county():
    """Create 20-year population + housing-need projections by county.

    Data sources:
    - County Components of Change (estimates + forecast): births/deaths/net migration + population.
      Listed on SDO Data Download page.
    - County Population Profiles (estimates): households + housing units + vacancy rate.
    """
    url_components = 'https://storage.googleapis.com/co-publicdata/components-change-county.csv'
    url_profiles = 'https://storage.googleapis.com/co-publicdata/profiles-county.csv'
    comp_cache = os.path.join(OUT['cache_dir'], 'dola_components_county.csv')
    prof_cache = os.path.join(OUT['cache_dir'], 'dola_profiles_county.csv')

    print('Downloading DOLA/SDO county components-of-change...')
    comp_text = fetch_csv_with_cache(url_components, comp_cache, 'county components-of-change')
    if comp_text is None:
        return

    comp_fields, comp_reader = detect_header_and_reader(comp_text)
    if comp_reader is None:
        print(f"⚠ Skipped projections build: could not detect header in components-change-county", file=sys.stderr)
        return

    f_cf = pick_substr(comp_fields, 'countyfips', 'county_fips', 'fips', 'county')
    f_year = pick_substr(comp_fields, 'year')
    f_pop = pick_substr(comp_fields, 'totalpop', 'total_population', 'population', 'pop', 'estimate')
    f_netmig = pick_substr(comp_fields, 'netmigration', 'net_migration', 'net_mig', 'netmig')
    f_dtype = pick_substr(comp_fields, 'datatype', 'data_type', 'type')

    if not all([f_cf, f_year, f_pop, f_netmig]):
        print(f"⚠ Skipped projections build: could not find required columns in components-change-county. Headers: {comp_fields}", file=sys.stderr)
        return

    # Read into dict[county][year] = {pop, netmig}
    comp = {}
    max_estimate_year = 0
    for r in comp_reader:
        try:
            raw_cf = int(float(r[f_cf]))
            if raw_cf <= 0:
                continue  # skip state-level totals (countyfips=0)
            cf = STATE_FIPS_CO + str(raw_cf).zfill(3)
            yr = int(float(r[f_year]))
            pop = float(r[f_pop])
            netmig = float(r[f_netmig])
            d = comp.setdefault(cf, {})
            d[yr] = {'pop': pop, 'netmig': netmig}
            # Track last estimate year (vs projection) for base year selection
            if f_dtype and str(r.get(f_dtype, '')).strip().lower().startswith('estimate'):
                max_estimate_year = max(max_estimate_year, yr)
        except Exception:
            continue

    print('Downloading DOLA/SDO county population profiles...')
    prof_text = fetch_csv_with_cache(url_profiles, prof_cache, 'county population profiles')

    profiles: dict = {}
    max_profile_year = 0
    if prof_text is None:
        print("⚠ County housing/profile data unavailable; projections will proceed without housing metrics", file=sys.stderr)
    else:
        prof_fields, prof_reader = detect_header_and_reader(prof_text)
        p_cf = pick_substr(prof_fields, 'countyfips', 'county_fips', 'fips', 'county')
        p_year = pick_substr(prof_fields, 'year')
        p_hh = pick_substr(prof_fields, 'households', 'hh')
        p_units = pick_substr(prof_fields, 'totalhousingunits', 'total_housing_units', 'housing_units', 'units')
        p_vac = pick_substr(prof_fields, 'vacancy_rate', 'vacancyrate', 'vac_rate', 'vacancy')

        if prof_reader is None or not all([p_cf, p_year, p_hh, p_units]):
            print(f"⚠ Unexpected profiles-county schema; housing metrics will be omitted. Fields: {prof_fields}", file=sys.stderr)
        else:
            for r in prof_reader:
                try:
                    raw_cf = int(float(r[p_cf]))
                    if raw_cf <= 0:
                        continue
                    cf = STATE_FIPS_CO + str(raw_cf).zfill(3)
                    yr = int(float(r[p_year]))
                    hh = float(r[p_hh])
                    units = float(r[p_units])
                    vac = float(r[p_vac]) if p_vac and r.get(p_vac) not in (None, '', 'NA') else None
                    profiles.setdefault(cf, {})[yr] = {'households': hh, 'units': units, 'vacancy_rate': vac}
                    max_profile_year = max(max_profile_year, yr)
                except Exception:
                    continue

    counties = fetch_counties()
    if not counties:
        # Fall back to cached geo-config when network is unavailable
        try:
            with open(OUT['geo_config'], 'r', encoding='utf-8') as _f:
                _gc = json.load(_f)
            counties = _gc.get('counties', [])
        except Exception:
            counties = []
    county_ids = {c['geoid'] for c in counties} if counties else set(comp.keys())

    for cf in sorted(county_ids):
        years = sorted(comp.get(cf, {}).keys())
        if not years:
            continue

        # Choose base year: prefer max year with profiles (typically 2024), else last estimate year.
        base_year = max_profile_year if max_profile_year > 0 else (max_estimate_year if max_estimate_year > 0 else max(years))
        if cf in profiles and base_year not in profiles[cf]:
            base_year = max(profiles[cf].keys())

        if base_year not in comp.get(cf, {}):
            # fall back to last comp year <= base_year
            base_candidates = [y for y in years if y <= base_year]
            base_year = base_candidates[-1] if base_candidates else years[-1]

        horizon = 20
        out_years = list(range(base_year, base_year + horizon + 1))

        pop_dola = []
        netmig = []
        for y in out_years:
            rec = comp.get(cf, {}).get(y)
            pop_dola.append(rec['pop'] if rec else None)
            if y == base_year:
                netmig.append(0)
            else:
                netmig.append(comp.get(cf, {}).get(y, {}).get('netmig', None))

        # Historic CAGR (10 years) as sensitivity
        hist_span = 10
        y0 = base_year - hist_span
        pop0 = comp.get(cf, {}).get(y0, {}).get('pop')
        popb = comp.get(cf, {}).get(base_year, {}).get('pop')
        cagr = None
        if pop0 and popb and pop0 > 0:
            cagr = (popb / pop0) ** (1.0 / hist_span) - 1.0

        pop_trend = []
        if popb and cagr is not None:
            for i, y in enumerate(out_years):
                pop_trend.append(popb * ((1.0 + cagr) ** i))
        else:
            pop_trend = [None for _ in out_years]

        # Housing need conversion
        prof = profiles.get(cf, {}).get(base_year)
        base_units = prof['units'] if prof else None
        base_households = prof['households'] if prof else None
        base_vac = prof.get('vacancy_rate') if prof else None

        headship = (base_households / popb) if (base_households and popb) else None
        target_vac = 0.05
        # If vacancy rate exists and is higher than 5%, use that as target (more conservative)
        if base_vac is not None and base_vac > target_vac:
            target_vac = min(0.12, float(base_vac))

        hh_dola = []
        units_needed = []
        inc_units = []

        for p in pop_dola:
            if p is None or headship is None:
                hh_dola.append(None)
                units_needed.append(None)
                inc_units.append(None)
                continue
            hh = p * headship
            hh_dola.append(hh)
            need = hh / (1.0 - target_vac)
            units_needed.append(need)
            inc_units.append((need - base_units) if base_units is not None else None)

        netmig_20y = None
        try:
            netmig_20y = sum([n for n in netmig[1:] if n is not None])
        except Exception:
            netmig_20y = None

        payload = {
            'updated': utc_now_z(),
            'countyFips': cf,
            'baseYear': base_year,
            'years': out_years,
            'population_dola': pop_dola,
            'population_trend': pop_trend,
            'historic_cagr_10y': cagr,
            'net_migration': netmig,
            'net_migration_20y': netmig_20y,
            'base': {
                'population': popb,
                'households': base_households,
                'housing_units': base_units,
                'vacancy_rate': base_vac,
                'headship_rate': headship,
            },
            'housing_need': {
                'target_vacancy': target_vac,
                'households_dola': hh_dola,
                'units_needed_dola': units_needed,
                'incremental_units_needed_dola': inc_units,
            },
            'source': {
                'components_change_url': url_components,
                'profiles_url': url_profiles,
                'notes': 'Population and net migration from county components-of-change; households/units/vacancy from county profiles; housing need uses a constant base-year headship rate.'
            }
        }

        with open(os.path.join(OUT['proj_dir'], f"{cf}.json"), 'w', encoding='utf-8') as f:
            json.dump(payload, f)
        _log_file_written(os.path.join(OUT['proj_dir'], f"{cf}.json"), f"projections:{cf}")

    print(f"✓ DOLA projections written: {len(county_ids)}")

    # Build statewide aggregate (08.json) immediately after all county files exist.
    _build_state_projection_aggregate()


def _build_state_projection_aggregate():
    """Aggregate all 64 county projection files into a single statewide 08.json.

    This file is required by the HNA dashboard when the user selects the
    Colorado statewide geography (geoType='state', geoid='08').
    """
    county_files = sorted(glob.glob(os.path.join(OUT['proj_dir'], '08???.json')))
    if not county_files:
        print('⚠ No county projection files found; skipping statewide aggregate', file=sys.stderr)
        return

    county_data = []
    for path in county_files:
        try:
            with open(path, encoding='utf-8') as f:
                county_data.append(json.load(f))
        except Exception as e:
            print(f'⚠ Could not read {path}: {e}', file=sys.stderr)

    if not county_data:
        return

    years = county_data[0].get('years', [])
    n = len(years)

    def _sum_series(key):
        result = []
        for i in range(n):
            total = sum(
                d[key][i]
                for d in county_data
                if d.get(key) and len(d[key]) > i and d[key][i] is not None
            )
            result.append(round(total, 2))
        return result

    def _sum_housing_series(key):
        result = []
        for i in range(n):
            total = sum(
                d['housing_need'][key][i]
                for d in county_data
                if d.get('housing_need') and d['housing_need'].get(key)
                and len(d['housing_need'][key]) > i
                and d['housing_need'][key][i] is not None
            )
            result.append(round(total, 2))
        return result

    def _sum_base_field(key):
        return sum(d['base'][key] for d in county_data if d.get('base') and d['base'].get(key))

    total_base_pop = _sum_base_field('population')
    total_base_hh = _sum_base_field('households')
    total_base_units = _sum_base_field('housing_units')
    base_headship = (total_base_hh / total_base_pop) if total_base_pop else 0

    weighted_cagr = sum(
        d.get('historic_cagr_10y', 0) * d['base'].get('population', 0)
        for d in county_data if d.get('base') and d['base'].get('population')
    )
    state_cagr = weighted_cagr / total_base_pop if total_base_pop else 0

    total_nm_20y = sum(d.get('net_migration_20y', 0) for d in county_data)

    weighted_vac = sum(
        d['housing_need'].get('target_vacancy', 0.05) * d['base'].get('housing_units', 0)
        for d in county_data if d.get('housing_need') and d.get('base')
    )
    state_target_vac = weighted_vac / total_base_units if total_base_units else 0.05

    # Derived statewide vacancy rate: percentage of units that are vacant.
    state_vacancy_rate = round(
        (1 - total_base_hh / total_base_units) * 100, 4
    ) if total_base_units else 0.0

    payload = {
        'updated': utc_now_z(),
        'countyFips': STATE_FIPS_CO,
        'stateFips': STATE_FIPS_CO,
        'label': 'Colorado (statewide)',
        'baseYear': 2024,
        'years': years,
        'population_dola': _sum_series('population_dola'),
        'population_trend': _sum_series('population_trend'),
        'historic_cagr_10y': state_cagr,
        'net_migration': _sum_series('net_migration'),
        'net_migration_20y': round(total_nm_20y, 2),
        'base': {
            'population': round(total_base_pop, 2),
            'households': round(total_base_hh, 2),
            'housing_units': round(total_base_units, 2),
            'vacancy_rate': state_vacancy_rate,
            'headship_rate': base_headship,
        },
        'housing_need': {
            'target_vacancy': state_target_vac,
            'households_dola': _sum_housing_series('households_dola'),
            'units_needed_dola': _sum_housing_series('units_needed_dola'),
            'incremental_units_needed_dola': _sum_housing_series('incremental_units_needed_dola'),
        },
        'source': {
            'components_change_url': 'https://storage.googleapis.com/co-publicdata/components-change-county.csv',
            'profiles_url': 'https://storage.googleapis.com/co-publicdata/profiles-county.csv',
            'notes': (
                'Colorado statewide aggregate: sum of all 64 county projections. '
                'Population and net migration from county components-of-change; '
                'households/units/vacancy from county profiles; '
                'housing need uses a constant base-year headship rate.'
            ),
        },
    }

    out_path = os.path.join(OUT['proj_dir'], f"{STATE_FIPS_CO}.json")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f)
    _log_file_written(out_path, f"projections:{STATE_FIPS_CO}")
    print(f"✓ DOLA statewide projection written: {out_path}")


def build_geo_derived_inputs():
    """Precompute derived inputs used by municipal/CDP projection scaling.

    Output:
      data/hna/derived/geo-derived.json

    For each featured geo, compute:
    - share0: latest ACS5 population share of containing county
    - pop_cagr: annualized growth rate between two ACS5 years
    - relative_pop_cagr: pop_cagr minus county pop_cagr
    - headship_base + slope per year (households/population)

    These are surfaced on the HNA page so others can validate assumptions.
    """

    y0 = int(os.environ.get('HNA_ACS5_TREND_Y0', '2018'))
    y1 = int(os.environ.get('HNA_ACS5_TREND_Y1', '2023'))
    if y1 <= y0:
        y0, y1 = 2018, 2023

    vars_ = ['NAME', 'DP05_0001E', 'DP02_0001E', 'DP04_0001E']

    derived = {
        'updated': utc_now_z(),
        'acs5_years': {'y0': y0, 'y1': y1},
        'geos': {}
    }

    county_cache: dict[str, tuple[dict, str, dict, str]] = {}

    def get_county(county_geoid: str):
        if county_geoid in county_cache:
            return county_cache[county_geoid]
        r0, u0 = fetch_acs5_profile_year(y0, 'county', county_geoid, vars_)
        r1, u1 = fetch_acs5_profile_year(y1, 'county', county_geoid, vars_)
        county_cache[county_geoid] = (r0, u0, r1, u1)
        return county_cache[county_geoid]

    for g in FEATURED:
        geo_type = g['type']
        geoid = g['geoid']
        containing = g.get('containingCounty') if geo_type != 'county' else geoid
        if not containing:
            continue

        try:
            r0, u0 = fetch_acs5_profile_year(y0, geo_type, geoid, vars_)
            r1, u1 = fetch_acs5_profile_year(y1, geo_type, geoid, vars_)

            pop0 = safe_float(r0.get('DP05_0001E'))
            pop1 = safe_float(r1.get('DP05_0001E'))
            hh0 = safe_float(r0.get('DP02_0001E'))
            hh1 = safe_float(r1.get('DP02_0001E'))
            units1 = safe_float(r1.get('DP04_0001E'))

            head0 = (hh0 / pop0) if (hh0 is not None and pop0 and pop0 > 0) else None
            head1 = (hh1 / pop1) if (hh1 is not None and pop1 and pop1 > 0) else None
            head_slope = ((head1 - head0) / (y1 - y0)) if (head0 is not None and head1 is not None) else None
            pop_cagr = annual_growth_rate(pop0, pop1, (y1 - y0))

            c0, cu0, c1, cu1 = get_county(containing)
            cpop0 = safe_float(c0.get('DP05_0001E'))
            cpop1 = safe_float(c1.get('DP05_0001E'))
            county_cagr = annual_growth_rate(cpop0, cpop1, (y1 - y0))

            share0 = (pop1 / cpop1) if (geo_type != 'county' and pop1 is not None and cpop1 and cpop1 > 0) else (1.0 if geo_type == 'county' else None)
            rel_growth = (pop_cagr - county_cagr) if (pop_cagr is not None and county_cagr is not None and geo_type != 'county') else None

            derived['geos'][geoid] = {
                'type': geo_type,
                'label': g.get('label'),
                'containingCounty': containing,
                'acs5': {
                    'pop_y0': safe_int(pop0),
                    'pop_y1': safe_int(pop1),
                    'hh_y0': safe_int(hh0),
                    'hh_y1': safe_int(hh1),
                    'units_y1': safe_int(units1),
                    'headship_y0': head0,
                    'headship_y1': head1
                },
                'derived': {
                    'share0': share0,
                    'pop_cagr': pop_cagr,
                    'county_pop_cagr': county_cagr,
                    'relative_pop_cagr': rel_growth,
                    'headship_base': head1 if head1 is not None else head0,
                    'headship_slope_per_year': head_slope
                },
                'sources': {
                    'acs5_y0_url': u0,
                    'acs5_y1_url': u1,
                    'county_acs5_y0_url': cu0,
                    'county_acs5_y1_url': cu1
                }
            }

            print(f"✓ derived inputs {geo_type}:{geoid}")
        except Exception as e:
            print(f"✗ derived inputs {geo_type}:{geoid}: {e}", file=sys.stderr)

    out_path = os.path.join(OUT['derived_dir'], 'geo-derived.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(derived, f)
    _log_file_written(out_path, 'derived:geo-derived')


def write_geo_config():
    # Allow CI to skip geo-config regeneration (e.g. when the file has been
    # manually expanded with TIGERweb-sourced geographies that Census ACS
    # may not return).  Accepts any truthy value: "true", "1", "yes", etc.
    if os.environ.get('SKIP_GEO_CONFIG', '').lower() in ('true', '1', 'yes'):
        print("ℹ geo-config: SKIP_GEO_CONFIG is set; keeping existing file", file=sys.stderr)
        return

    counties = fetch_counties()
    if not counties:
        # Network unavailable — preserve existing geo-config if present
        if os.path.exists(OUT['geo_config']):
            print("ℹ geo-config: network unavailable; keeping existing cached file", file=sys.stderr)
            return
    # Build place→county map once and share across places and CDPs to avoid
    # redundant API calls (fetch_place_county_map makes one request per county).
    place_county = fetch_place_county_map(counties) if counties else {}
    places = fetch_places(counties=counties, place_county=place_county)
    cdps = fetch_cdps(counties=counties, place_county=place_county)

    # Guard: if the existing geo-config has more geographies than Census ACS
    # returned, preserve it to avoid regressing a manually expanded config.
    if os.path.exists(OUT['geo_config']):
        try:
            with open(OUT['geo_config'], 'r', encoding='utf-8') as _f:
                existing = json.load(_f)
            existing_total = (len(existing.get('counties', [])) +
                              len(existing.get('places', [])) +
                              len(existing.get('cdps', [])))
            new_total = len(counties) + len(places) + len(cdps)
            if existing_total > new_total:
                print(f"⚠ geo-config: existing file has {existing_total} geographies vs {new_total} "
                      f"from Census ACS; keeping existing file to avoid regression. "
                      f"Set SKIP_GEO_CONFIG=false to force overwrite.", file=sys.stderr)
                return
        except Exception:
            pass  # can't read existing file; overwrite is fine

    payload = {
        'updated': utc_now_z(),
        'featured': FEATURED,
        'counties': counties,
        'places': places,
        'cdps': cdps,
        'source': {
            'county_list': 'TIGERweb State_County MapServer/1',
            'place_list': f"Census ACS 5-year {acs_start_year()} place names (Colorado; regenerated by build_hna_data.py via GitHub Actions)",
        }
    }
    with open(OUT['geo_config'], 'w', encoding='utf-8') as f:
        json.dump(payload, f)
    _log_file_written(OUT['geo_config'], 'geo-config')
    print(f"✓ geo-config counties: {len(counties)}, places: {len(places)}, cdps: {len(cdps)}")


def _log_step(name: str) -> None:
    """Print a timestamped section header to stdout."""
    print(f"\n── {name} [{utc_now_z()}] ──")


def _count_dir(path: str) -> int:
    """Return the number of files directly inside *path* (non-recursive)."""
    try:
        return sum(1 for e in os.scandir(path) if e.is_file())
    except FileNotFoundError:
        return 0


def _safe_getsize(path: str) -> int:
    """Return the byte size of *path*, or 0 if the file does not exist or cannot be read."""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _sum_dir_bytes(path: str) -> int:
    """Return total byte size of all files directly inside *path* (non-recursive)."""
    try:
        return sum(e.stat().st_size for e in os.scandir(path) if e.is_file())
    except FileNotFoundError:
        return 0


def _log_file_written(path: str, label: str) -> None:
    """Print file size after writing; warn to stderr on zero-byte output."""
    try:
        size = os.path.getsize(path)
    except OSError as e:
        print(f"⚠ could not stat {path}: {e}", file=sys.stderr)
        return
    if size == 0:
        print(f"⚠ wrote 0 bytes ({label}): {path}", file=sys.stderr)
    else:
        print(f"  ✓ wrote {size:,} bytes ({label}): {path}")


def _print_summary() -> None:
    """Print file counts and byte totals for every HNA output directory."""
    print("\n=== HNA Build file summary ===")
    # Expected counts reflect the full Colorado geography set processed by the pipeline:
    #   summary/     – one file per county (64) + places/CDPs (~480) = ~544 total
    #   lehd/        – one file per Colorado county (64)
    #   dola_sya/    – one file per Colorado county (64)
    #   projections/ – one file per Colorado county (64)
    rows = [
        ('geo-config.json', 1 if os.path.exists(OUT['geo_config']) else 0,
         _safe_getsize(OUT['geo_config']), 1),
        ('summary/', _count_dir(OUT['summary_dir']), _sum_dir_bytes(OUT['summary_dir']), 544),
        ('lehd/', _count_dir(OUT['lehd_dir']), _sum_dir_bytes(OUT['lehd_dir']), 64),
        ('dola_sya/', _count_dir(OUT['dola_dir']), _sum_dir_bytes(OUT['dola_dir']), 64),
        ('projections/', _count_dir(OUT['proj_dir']), _sum_dir_bytes(OUT['proj_dir']), 64),
        ('derived/', _count_dir(OUT['derived_dir']), _sum_dir_bytes(OUT['derived_dir']), 1),
    ]
    empty_labels = []
    for label, count, total_bytes, expected in rows:
        icon = '✓' if count >= expected else ('⚠' if count > 0 else '✗')
        if count > 0 and total_bytes == 0:
            empty_labels.append(label)
        print(f"  {icon} {label}: {count} file(s), {total_bytes:,} bytes (expected ≥{expected})")
    if empty_labels:
        print(f"  ⚠ zero-byte output detected in: {', '.join(empty_labels)}", file=sys.stderr)

    # Overall key presence check
    key = census_key()
    key_status = f'set ({len(key)} chars)' if key else 'NOT SET — Census API calls will be unauthenticated'
    print(f"  ℹ CENSUS_API_KEY: {key_status}")
    print(f"── Done [{utc_now_z()}] ──\n")


def main():
    print(f"── HNA data build starting [{utc_now_z()}] ──")
    print(f"  ROOT: {ROOT}")
    print(f"  CENSUS_API_KEY: {'set' if census_key() else 'NOT SET'}")
    print(f"  ACS_START_YEAR: {acs_start_year()}")
    print(f"  SKIP_ACS: {os.environ.get('SKIP_ACS', 'false')}")
    print(f"  SKIP_LEHD: {os.environ.get('SKIP_LEHD', 'false')}")
    print(f"  SKIP_DOLA: {os.environ.get('SKIP_DOLA', 'false')}")

    ensure_dirs()

    # Always write geo config
    _log_step('geo-config')
    write_geo_config()

    if os.environ.get('SKIP_ACS', '').lower() != 'true':
        _log_step('ACS summary cache')
        build_summary_cache()
        if os.environ.get('SKIP_DERIVED', '').lower() != 'true':
            _log_step('geo-derived inputs')
            build_geo_derived_inputs()
    else:
        print('  ℹ Skipping ACS (SKIP_ACS=true)')

    if os.environ.get('SKIP_LEHD', '').lower() != 'true':
        _log_step('LEHD by county')
        build_lehd_by_county()
        _log_step('LEHD WAC annual snapshots (2019–2023)')
        build_lehd_wac_snapshots()
    else:
        print('  ℹ Skipping LEHD (SKIP_LEHD=true)')

    if os.environ.get('SKIP_DOLA', '').lower() != 'true':
        _log_step('DOLA SYA by county')
        build_dola_sya_by_county()
        _log_step('DOLA projections by county')
        build_dola_projections_by_county()
    else:
        print('  ℹ Skipping DOLA (SKIP_DOLA=true)')

    _print_summary()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)