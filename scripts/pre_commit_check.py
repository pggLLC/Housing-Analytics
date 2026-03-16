#!/usr/bin/env python3
"""
pre_commit_check.py — Fast pre-commit governance guard for Housing Analytics.

Rejects 13 regression patterns derived from 30 confirmed production bugs
fixed in Stages 1–3 of the Solutions Architecture audit.  Target runtime:
< 5 seconds on the full repository.

Exit 0 = all checks pass.
Exit 1 = one or more checks failed (details printed to stdout).

Usage:
    python scripts/pre_commit_check.py
"""

import glob
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(REPO_ROOT, 'data')
JS_DIR = os.path.join(REPO_ROOT, 'js')
CSS_DIR = os.path.join(REPO_ROOT, 'css')

PASS = 'PASS'
FAIL = 'FAIL'
_results = []


def _check(name, condition, detail=''):
    status = PASS if condition else FAIL
    _results.append((status, name, detail))
    icon = '✓' if condition else '✗'
    msg = f'  [{icon}] {name}'
    if detail:
        msg += f' — {detail}'
    print(msg)
    return condition


# ---------------------------------------------------------------------------
# Check 1: 3-digit FIPS codes in JSON (Rule 1, Bug S1-01/S1-06/S1-09)
# ---------------------------------------------------------------------------
print('\n── Check 1: 3-digit FIPS codes in county JSON ────────')

fips_violations = []
fips_files = glob.glob(os.path.join(DATA_DIR, '**', '*.json'), recursive=True)
# Only scan small county-level files (skip large geojson / observation arrays)
for fpath in fips_files:
    if os.path.getsize(fpath) > 2_000_000:
        continue
    rel = os.path.relpath(fpath, REPO_ROOT)
    try:
        with open(fpath) as f:
            raw = f.read()
        # Quick pre-filter: only files that mention fips/FIPS
        raw_lower = raw.lower()
        if 'fips' not in raw_lower and 'county_fips' not in raw_lower:
            continue
        data = json.loads(raw)
    except Exception:
        continue

    def _extract_fips_values(obj, depth=0):
        """Recursively yield (key, value) for county FIPS keys.

        Only yields keys that represent county-level FIPS codes.  State FIPS
        fields (``state_fips``, ``statefips``, ``state_fp``) are 2-digit by
        design and are intentionally excluded from this check.
        """
        if depth > 6:
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                k_lower = k.lower()
                is_county_fips = (
                    k_lower.endswith('fips')
                    and 'state' not in k_lower
                    and isinstance(v, str)
                )
                if is_county_fips:
                    yield k, v
                else:
                    yield from _extract_fips_values(v, depth + 1)
        elif isinstance(obj, list):
            for item in obj[:200]:  # cap iteration for speed
                yield from _extract_fips_values(item, depth + 1)

    for key, val in _extract_fips_values(data):
        # Flag 3- or 4-digit values: clearly a county code missing its state prefix
        if len(val) in (3, 4) and val.isdigit():
            fips_violations.append(f'{rel}: {key}="{val}"')

_check(
    '3-digit FIPS codes absent from county JSON files',
    len(fips_violations) == 0,
    f'violations={fips_violations[:3]}' if fips_violations else '',
)

# ---------------------------------------------------------------------------
# Check 2: Canvas elements missing aria-label (Rule 15, Bug S3-02)
# ---------------------------------------------------------------------------
print('\n── Check 2: Canvas elements missing aria-label ───────')

canvas_violations = []
html_files = sorted(glob.glob(os.path.join(REPO_ROOT, '*.html')))
for fpath in html_files:
    fname = os.path.basename(fpath)
    with open(fpath, encoding='utf-8', errors='replace') as f:
        content = f.read()
    canvases = re.findall(r'<canvas[^>]*>', content, re.IGNORECASE | re.DOTALL)
    for tag in canvases:
        has_label = bool(re.search(r'aria-label\s*=\s*["\'][^"\']+["\']', tag, re.IGNORECASE))
        if not has_label:
            canvas_violations.append(f'{fname}: {tag[:80]}')

_check(
    'All canvas elements have aria-label',
    len(canvas_violations) == 0,
    f'missing={canvas_violations[:3]}' if canvas_violations else '',
)

# ---------------------------------------------------------------------------
# Check 3: Hardcoded WCAG-failing chart colors (Rule 10, Bug S3-01)
# ---------------------------------------------------------------------------
print('\n── Check 3: Hardcoded WCAG-failing chart colors ──────')

FAILING_COLORS = [
    '#6c7a89', '#3498db', '#27ae60', '#d4a574',
    '#e4b584', '#2ecc71', '#f39c12', '#c0392b',
]
color_violations = []
for fpath in html_files:
    fname = os.path.basename(fpath)
    with open(fpath, encoding='utf-8', errors='replace') as f:
        content = f.read()
    content_lower = content.lower()
    found = [c for c in FAILING_COLORS if c in content_lower]
    if found:
        color_violations.append(f'{fname}: {found}')

_check(
    'No hardcoded WCAG-failing chart colors in HTML files',
    len(color_violations) == 0,
    f'violations={color_violations[:3]}' if color_violations else '',
)

# ---------------------------------------------------------------------------
# Check 4: Missing HTML landmark <main> elements (Rule 12, Bug S3-04)
# ---------------------------------------------------------------------------
print('\n── Check 4: HTML landmark elements present ───────────')

INTERACTIVE_PAGES = [
    'dashboard.html', 'cra-expansion-analysis.html',
    'construction-commodities.html', 'chfa-portfolio.html',
    'compliance-dashboard.html', 'regional.html',
    'colorado-deep-dive.html', 'LIHTC-dashboard.html',
    'housing-needs-assessment.html', 'economic-dashboard.html',
]
landmark_violations = []
for fname in INTERACTIVE_PAGES:
    fpath = os.path.join(REPO_ROOT, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath, encoding='utf-8', errors='replace') as f:
        content = f.read()
    if not re.search(r'<main[\s>]', content, re.IGNORECASE):
        landmark_violations.append(f'{fname}: missing <main>')

_check(
    'All interactive pages have <main> landmark',
    len(landmark_violations) == 0,
    f'missing={landmark_violations[:3]}' if landmark_violations else '',
)

# ---------------------------------------------------------------------------
# Check 5: ArcGIS FeatureServer queries without outSR=4326 (Rule 9, Bug S3-07)
# ---------------------------------------------------------------------------
print('\n── Check 5: ArcGIS query strings include outSR=4326 ──')

arcgis_violations = []
js_files = sorted(glob.glob(os.path.join(JS_DIR, '*.js')))
for fpath in js_files:
    fname = os.path.basename(fpath)
    with open(fpath, encoding='utf-8', errors='replace') as f:
        content = f.read()
    # Find query parameter strings that contain f=geojson (ArcGIS REST calls)
    query_strings = re.findall(
        r'["\']([^"\']*f(?:=|%3D)geojson[^"\']*)["\']',
        content, re.IGNORECASE
    )
    for qs in query_strings:
        if 'outSR' not in qs:
            arcgis_violations.append(f'{fname}: {qs[:100]}')

_check(
    'All ArcGIS f=geojson query strings include outSR=4326',
    len(arcgis_violations) == 0,
    f'missing_outSR={arcgis_violations[:3]}' if arcgis_violations else '',
)

# ---------------------------------------------------------------------------
# Check 6: FRED series with blank name/metadata (Rule 6, Bug S2-01)
# ---------------------------------------------------------------------------
print('\n── Check 6: FRED series have non-blank name field ────')

fred_path = os.path.join(DATA_DIR, 'fred-data.json')
fred_violations = []
try:
    with open(fred_path) as f:
        fred_data = json.load(f)
    series = fred_data.get('series', {})
    for series_id, meta in series.items():
        name = meta.get('name', '')
        if not name or not name.strip():
            fred_violations.append(series_id)
    _check(
        'All FRED series have non-blank name field',
        len(fred_violations) == 0,
        f'blank_name={fred_violations[:5]}' if fred_violations else '',
    )
except Exception as e:
    _check('All FRED series have non-blank name field', False, str(e))

# ---------------------------------------------------------------------------
# Check 7: Stale projection baseYear (Rule 3, Bug S1-05/S2-06)
# ---------------------------------------------------------------------------
print('\n── Check 7: Projection baseYear/pyramidYear == 2024 ──')

EXPECTED_BASE_YEAR = 2024
stale_year_violations = []

sya_files = sorted(glob.glob(os.path.join(DATA_DIR, 'hna', 'dola_sya', '*.json')))
for fpath in sya_files[:5]:  # sample first 5 for speed
    try:
        with open(fpath) as f:
            d = json.load(f)
        y = d.get('pyramidYear')
        if y != EXPECTED_BASE_YEAR:
            stale_year_violations.append(f'{os.path.basename(fpath)}: pyramidYear={y}')
    except Exception:
        pass

proj_files = sorted(glob.glob(os.path.join(DATA_DIR, 'hna', 'projections', '*.json')))
for fpath in proj_files[:5]:  # sample first 5 for speed
    try:
        with open(fpath) as f:
            d = json.load(f)
        y = d.get('baseYear')
        if y is not None and y != EXPECTED_BASE_YEAR:
            stale_year_violations.append(f'{os.path.basename(fpath)}: baseYear={y}')
    except Exception:
        pass

_check(
    f'Projection baseYear/pyramidYear == {EXPECTED_BASE_YEAR}',
    len(stale_year_violations) == 0,
    f'stale={stale_year_violations[:3]}' if stale_year_violations else '',
)

# ---------------------------------------------------------------------------
# Check 8: CAR report null fields (Rule 8, Bug S2-04/S2-05)
# ---------------------------------------------------------------------------
print('\n── Check 8: CAR report statewide fields are non-null ─')

CAR_REQUIRED_FIELDS = [
    'median_sale_price', 'active_listings', 'median_days_on_market',
    'median_price_per_sqft', 'closed_sales', 'new_listings', 'months_of_supply',
]
car_violations = []
car_report_files = sorted(glob.glob(os.path.join(DATA_DIR, 'car-market-report-*.json')))
for fpath in car_report_files:
    fname = os.path.basename(fpath)
    try:
        with open(fpath) as f:
            report = json.load(f)
        sw = report.get('statewide', {})
        null_fields = [field for field in CAR_REQUIRED_FIELDS if sw.get(field) is None]
        if null_fields:
            car_violations.append(f'{fname} statewide: {null_fields}')
    except Exception as e:
        car_violations.append(f'{fname}: {e}')

_check(
    'CAR report statewide fields are non-null',
    len(car_violations) == 0,
    f'null_fields={car_violations[:3]}' if car_violations else '',
)

# ---------------------------------------------------------------------------
# Check 9: Incorrect --accent token value (Rule 13, Bug S3-05)
# ---------------------------------------------------------------------------
print('\n── Check 9: CSS --accent token == #096e65 ────────────')

EXPECTED_ACCENT = '#096e65'
site_theme_path = os.path.join(CSS_DIR, 'site-theme.css')
accent_ok = False
try:
    with open(site_theme_path) as f:
        css = f.read()
    # Must appear in the :root block (before dark-mode override)
    # Look for --accent: <value> in the root (non-dark) block
    match = re.search(r'--accent\s*:\s*(#[0-9a-fA-F]{3,8})', css)
    if match:
        actual = match.group(1).lower()
        accent_ok = (actual == EXPECTED_ACCENT)
        _check(
            f'CSS --accent token is {EXPECTED_ACCENT}',
            accent_ok,
            f'found={actual}' if not accent_ok else '',
        )
    else:
        _check(f'CSS --accent token is {EXPECTED_ACCENT}', False, '--accent not found in CSS')
except Exception as e:
    _check(f'CSS --accent token is {EXPECTED_ACCENT}', False, str(e))

# ---------------------------------------------------------------------------
# Check 10: LIHTC county coverage gaps (Rule 4, Bug S2-07)
# ---------------------------------------------------------------------------
print('\n── Check 10: LIHTC trends covers 64 Colorado counties ─')

lihtc_path = os.path.join(DATA_DIR, 'lihtc-trends-by-county.json')
try:
    with open(lihtc_path) as f:
        lihtc_data = json.load(f)
    counties = lihtc_data.get('counties', {})
    county_count = len(counties) if isinstance(counties, dict) else len(counties)
    _check(
        'lihtc-trends-by-county.json covers all 64 Colorado counties',
        county_count == 64,
        f'found={county_count}',
    )
except Exception as e:
    _check('lihtc-trends-by-county.json covers all 64 Colorado counties', False, str(e))

# ---------------------------------------------------------------------------
# Check 11: Stale manifest.json (Rule 5, Bug S1-08)
# ---------------------------------------------------------------------------
print('\n── Check 11: manifest.json is current and complete ───')

manifest_path = os.path.join(DATA_DIR, 'manifest.json')
try:
    with open(manifest_path) as f:
        manifest = json.load(f)
    generated_str = manifest.get('generated', '')
    files_count = len(manifest.get('files', {}))

    # Parse ISO timestamp
    generated_dt = None
    if generated_str:
        try:
            generated_dt = datetime.fromisoformat(
                generated_str.rstrip('Z')
            ).replace(tzinfo=timezone.utc)
        except Exception:
            pass

    now_utc = datetime.now(timezone.utc)
    max_age = timedelta(days=30)
    age_ok = generated_dt is not None and (now_utc - generated_dt) <= max_age
    count_ok = files_count >= 100

    _check(
        'manifest.json is not stale (< 30 days old)',
        age_ok,
        f'generated={generated_str}' if not age_ok else f'age_ok generated={generated_str}',
    )
    _check(
        'manifest.json lists 100+ files',
        count_ok,
        f'count={files_count}',
    )
except Exception as e:
    _check('manifest.json is not stale (< 30 days old)', False, str(e))
    _check('manifest.json lists 100+ files', False, str(e))

# ---------------------------------------------------------------------------
# Check 12: Missing aria-live regions on pages with dynamic content (Rule 11, Bug S3-03)
# ---------------------------------------------------------------------------
print('\n── Check 12: aria-live regions present on chart pages ─')

DYNAMIC_PAGES = [
    'dashboard.html',
    'construction-commodities.html',
    'chfa-portfolio.html',
    'compliance-dashboard.html',
]
aria_live_violations = []
for fname in DYNAMIC_PAGES:
    fpath = os.path.join(REPO_ROOT, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath, encoding='utf-8', errors='replace') as f:
        content = f.read()
    if 'aria-live' not in content:
        aria_live_violations.append(fname)

_check(
    'Dynamic chart pages have aria-live region',
    len(aria_live_violations) == 0,
    f'missing={aria_live_violations}' if aria_live_violations else '',
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total = len(_results)
passed = sum(1 for r in _results if r[0] == PASS)
failed = total - passed
pct = int(round(passed / total * 100)) if total else 0

print('\n' + '═' * 60)
print(f'GOVERNANCE CHECKS : {total}')
print(f'PASSED            : {passed}')
print(f'FAILED            : {failed}')
print(f'\nGOVERNANCE SCORE  : {pct}%')
print('═' * 60)

if failed:
    print('\nFAILED CHECKS:')
    for status, name, detail in _results:
        if status == FAIL:
            print(f'  ✗ {name}' + (f' — {detail}' if detail else ''))
    sys.exit(1)
else:
    print('\nAll governance checks PASSED. ✓')
    sys.exit(0)
