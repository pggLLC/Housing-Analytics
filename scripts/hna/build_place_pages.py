#!/usr/bin/env python3
"""scripts/hna/build_place_pages.py

Generate one static HTML page per Colorado place under places/{geoid}.html.

Each page surfaces a place-level dashboard:
  - Place name + containing county
  - CHAS rates (place-CHAS from TIGER spatial join, with fallback note)
  - Cross-county disclosure (if applicable)
  - HMDA county context (primary county's mortgage credit access)
  - HUD AMI tier rents (from HUD FMR for primary county)
  - Links back to the workflow tools (Deal Calculator, PMA)

Why
---
Per Phase 3 / C5 (comparison-review): give every CO place its own URL
with all the data we have. SEO + analyst-usability win. Pattern adapted
from striblab's per-city detail pages.

Implementation
--------------
String-substitution into a shared HTML template. Each generated page
embeds the place's data as JSON in a <script> tag so the page is
static + SEO-friendly, then a small client-side renderer fills in
the visual elements.

Output
------
    places/{geoid}.html        — 482 pages (one per place in place-chas.json)
    places/index.html          — alphabetical directory of all places

Usage
-----
    python3 scripts/hna/build_place_pages.py
    python3 scripts/hna/build_place_pages.py --limit 10     # debug subset
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import sys

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PLACE_CHAS    = os.path.join(REPO_ROOT, 'data', 'hna', 'place-chas.json')
CROSS_COUNTY  = os.path.join(REPO_ROOT, 'data', 'hna', 'cross-county-places.json')
REGISTRY      = os.path.join(REPO_ROOT, 'data', 'hna', 'geography-registry.json')
PHANTOM_ALIAS = os.path.join(REPO_ROOT, 'data', 'hna', 'place-phantom-aliases.json')
PERMITS       = os.path.join(REPO_ROOT, 'data', 'hna', 'permits.json')
COUNTY_NAMES_FILE = os.path.join(REPO_ROOT, 'data', 'co-county-boundaries.json')
PAGES_DIR     = os.path.join(REPO_ROOT, 'places')
TEMPLATE_FILE = os.path.join(PAGES_DIR, '_template.html')
INDEX_FILE    = os.path.join(PAGES_DIR, 'index.html')

def load_county_names() -> dict[str, str]:
    if not os.path.exists(COUNTY_NAMES_FILE):
        return {}
    with open(COUNTY_NAMES_FILE) as f:
        gj = json.load(f)
    out = {}
    for feat in gj.get('features', []):
        props = feat.get('properties', {})
        fips = props.get('GEOID') or props.get('FIPS')
        name = props.get('NAME')
        if fips and name:
            out[fips] = name
    return out


def load_template() -> str:
    if os.path.exists(TEMPLATE_FILE):
        with open(TEMPLATE_FILE) as f:
            return f.read()
    # Inline default template if file doesn't exist yet
    return DEFAULT_TEMPLATE


DEFAULT_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#096e65" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0fd4cf" media="(prefers-color-scheme: dark)">
  <title>{{PLACE_NAME}} — COHO Place Profile</title>
  <meta name="description" content="Housing data profile for {{PLACE_NAME}}, {{COUNTY_NAME}} County, Colorado: cost-burden by AMI tier, mortgage credit access, cross-county disclosure, and HUD AMI rent limits.">
  <meta property="og:title" content="{{PLACE_NAME}} Housing Profile — COHO Analytics">
  <meta property="og:description" content="LIHTC underwriting data for {{PLACE_NAME}}, {{COUNTY_NAME}} County, Colorado.">
  <link rel="stylesheet" href="../css/site-theme.css">
  <link rel="stylesheet" href="../css/layout.css">
  <link rel="stylesheet" href="../css/pages.css">
  <link rel="canonical" href="/places/{{PLACE_GEOID}}.html">

  <script src="../js/path-resolver.js"></script>
  <script src="../js/config.js"></script>
  <script src="../js/fetch-helper.js"></script>
  <script src="../js/data-service-portable.js"></script>
  <script defer src="../js/navigation.js"></script>
  <script defer src="../js/dark-mode-toggle.js"></script>

  <!-- Embedded place data (used by the renderer below) -->
  <script id="place-data" type="application/json">
{{PLACE_DATA_JSON}}
  </script>
{{PLACE_JSON_LD}}

  <style>
    .place-hero { padding: 2rem 1.5rem; background: linear-gradient(180deg, var(--bg2, #f5f6f8), var(--bg, #fff)); border-bottom: 1px solid var(--border); }
    .place-hero h1 { margin: 0; font-size: 1.8rem; }
    .place-hero .place-sub { color: var(--muted); margin-top: .25rem; }
    .place-grid { max-width: 1100px; margin: 1.5rem auto; padding: 0 1.5rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .place-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; }
    .place-card h2 { margin: 0 0 .5rem; font-size: 1.05rem; color: var(--accent, #096e65); }
    .place-stat { display: flex; justify-content: space-between; margin: .25rem 0; padding: .25rem 0; border-bottom: 1px dashed var(--border-soft, #e0e0e0); }
    .place-stat .label { color: var(--muted); font-size: .85rem; }
    .place-stat .value { font-weight: 600; font-variant-numeric: tabular-nums; }
    .place-stat .value.bad { color: var(--bad, #dc2626); }
    .place-stat .value.warn { color: var(--warn, #d97706); }
    .place-stat .value.good { color: var(--good, #16a34a); }
    .place-disclosure { margin: 1rem auto; max-width: 1100px; padding: .75rem 1rem; background: rgba(59, 130, 246, .08); border: 1px solid rgba(59, 130, 246, .3); border-radius: 6px; font-size: .88rem; line-height: 1.5; }
    .place-tools { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; }
    .place-tools h2 { font-size: 1.1rem; margin-bottom: .5rem; }
    .place-tools a { display: inline-block; margin: .25rem .5rem .25rem 0; padding: .35rem .75rem; border: 1px solid var(--accent, #096e65); border-radius: 4px; color: var(--accent, #096e65); text-decoration: none; font-size: .88rem; }
    .place-tools a:hover { background: var(--accent, #096e65); color: #fff; }
    .place-source { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; font-size: .78rem; color: var(--muted); }
  </style>
</head>
<body>
  <header class="site-header"></header>

  <main id="main-content">
    <div class="place-hero">
      <div style="max-width: 1100px; margin: 0 auto;">
        <div style="font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">
          Colorado · {{COUNTY_NAME}} County
        </div>
        <h1>{{PLACE_NAME}}</h1>
        <p class="place-sub">{{PLACE_SUBTITLE}}</p>
      </div>
    </div>

    <div id="placeDisclosure" class="place-disclosure" hidden></div>

    <div class="place-grid">
      <div class="place-card">
        <h2>Housing burden (CHAS)</h2>
        <div class="place-stat"><span class="label">Renter cost-burden (≥30%)</span><span class="value" id="psRenterCb30">—</span></div>
        <div class="place-stat"><span class="label">Renter severe (≥50%)</span><span class="value" id="psRenterCb50">—</span></div>
        <div class="place-stat"><span class="label">Owner cost-burden (≥30%)</span><span class="value" id="psOwnerCb30">—</span></div>
        <div class="place-stat"><span class="label">Total renter HHs</span><span class="value" id="psRenterTotal">—</span></div>
        <div class="place-stat"><span class="label">Total owner HHs</span><span class="value" id="psOwnerTotal">—</span></div>
      </div>
      <div class="place-card">
        <h2>AMI tier breakdown (renters)</h2>
        <div class="place-stat"><span class="label">≤30% AMI</span><span class="value" id="psTierLte30">—</span></div>
        <div class="place-stat"><span class="label">31-50% AMI</span><span class="value" id="psTier3150">—</span></div>
        <div class="place-stat"><span class="label">51-80% AMI</span><span class="value" id="psTier5180">—</span></div>
        <div class="place-stat"><span class="label">81-100% AMI</span><span class="value" id="psTier81100">—</span></div>
        <div class="place-stat"><span class="label">&gt;100% AMI</span><span class="value" id="psTier100p">—</span></div>
      </div>
      <div class="place-card">
        <h2>Housing production vs need (Census BPS)</h2>
        <div class="place-stat"><span class="label">Permitted units (5-yr avg)</span><span class="value" id="psPermitsAvg">—</span></div>
        <div class="place-stat"><span class="label">&nbsp;&nbsp;single-family</span><span class="value" id="psPermitsSf">—</span></div>
        <div class="place-stat"><span class="label">&nbsp;&nbsp;multifamily (2+ units)</span><span class="value" id="psPermitsMf">—</span></div>
        <div class="place-stat"><span class="label">Projected annual need (10-yr DOLA)</span><span class="value" id="psNeedAnnual">—</span></div>
        <div class="place-stat"><span class="label">Production ÷ need</span><span class="value" id="psNeedRatio">—</span></div>
        <p id="psPermitsNote" style="display:none;margin:.6rem 0 0;font-size:.8rem;color:var(--muted);line-height:1.45"></p>
      </div>
      <div class="place-card">
        <h2>Methodology</h2>
        <div class="place-stat"><span class="label">CHAS source</span><span class="value" id="psSource">—</span></div>
        <div class="place-stat"><span class="label">Underlying tracts</span><span class="value" id="psTracts">—</span></div>
        <div class="place-stat"><span class="label">Coverage</span><span class="value" id="psCoverage">—</span></div>
      </div>
    </div>

    <div class="place-tools">
      <h2>Continue your analysis</h2>
      <a href="../market-analysis.html?lat={{LAT}}&lon={{LON}}">Run PMA analysis →</a>
      <a href="../deal-calculator.html">Open Deal Calculator →</a>
      <a href="../housing-needs-assessment.html?type={{PLACE_TYPE}}&geoid={{PLACE_GEOID}}">View full HNA dashboard →</a>
    </div>

    <div class="place-source">
      Source: HUD CHAS 2018-2022 + TIGER 2024 spatial join. Building permits: U.S. Census Building Permits Survey (annual place files). Housing-need projections: Colorado State Demography Office (DOLA). Data refreshed by automated workflows.
      <br>
      Data vintage: HUD CHAS 2018-2022 + TIGER 2024 + Census BPS 2016-2025.
    </div>
  </main>

  <script>
    (function () {
      var data = JSON.parse(document.getElementById('place-data').textContent);
      function fmt(v) { return v == null ? '—' : Math.round(v).toLocaleString(); }
      function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
      function setV(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
      function setVc(id, v, severityClass) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = v;
        el.className = 'value' + (severityClass ? ' ' + severityClass : '');
      }
      var sev30 = data.summary.renter_cb30_share >= 0.5 ? 'bad' : data.summary.renter_cb30_share >= 0.35 ? 'warn' : 'good';
      var sev50 = data.summary.renter_cb50_share >= 0.25 ? 'bad' : data.summary.renter_cb50_share >= 0.15 ? 'warn' : 'good';
      setVc('psRenterCb30', pct(data.summary.renter_cb30_share), sev30);
      setVc('psRenterCb50', pct(data.summary.renter_cb50_share), sev50);
      setV('psOwnerCb30',  pct(data.summary.owner_cb30_share));
      setV('psRenterTotal', fmt(data.summary.total_renter_hh));
      setV('psOwnerTotal',  fmt(data.summary.total_owner_hh));
      var tiers = data.renter_hh_by_ami || {};
      setV('psTierLte30',  fmt(tiers.lte30  && tiers.lte30.total));
      setV('psTier3150',   fmt(tiers['31to50']  && tiers['31to50'].total));
      setV('psTier5180',   fmt(tiers['51to80']  && tiers['51to80'].total));
      setV('psTier81100',  fmt(tiers['81to100'] && tiers['81to100'].total));
      setV('psTier100p',   fmt(tiers['100plus'] && tiers['100plus'].total));
      setV('psSource', data.source === 'rate-only-fallback' ? 'Rate-only fallback (tract rates)' : 'TIGER 2024 place-CHAS');
      setV('psTracts', data.tract_count);
      setV('psCoverage', (data.coverage_share * 100).toFixed(1) + '%');
      // Housing production vs need (Census BPS permits + DOLA projections).
      // Permits are place-level BPS only — a missing record (typical for
      // CDPs) must never be backfilled with county numbers.
      (function () {
        var note = document.getElementById('psPermitsNote');
        function say(msg) { if (note) { note.textContent = msg; note.style.display = 'block'; } }
        function one(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString(); }
        var p = data.permits;
        if (!p) {
          var cn = data.county_name && data.county_name !== 'Unknown' ? data.county_name + ' County' : 'the county';
          if (data.geo_type === 'cdp') {
            say(data.name + ' is an unincorporated community (CDP): building permits are issued by ' + cn +
                ', so the Census Building Permits Survey has no separate record for it. See the county view of the HNA dashboard for county-wide production.');
          } else {
            say('No Census Building Permits Survey record for this jurisdiction — permits may be issued by ' + cn +
                ' or the community may not report to BPS.');
          }
          return;
        }
        var avg = p.avg_annual_total_5yr || {};
        setV('psPermitsAvg', avg.value == null ? '—' : one(avg.value) + ' units/yr');
        setV('psPermitsSf', one((p.avg_annual_sf_5yr || {}).value));
        setV('psPermitsMf', one((p.avg_annual_mf_5yr || {}).value));
        var pvn = p.production_vs_need;
        if (!pvn || pvn.annual_need_10yr_dola == null) {
          say('Permits: Census BPS annual survey (' + (avg.window || 'recent years') + '). No DOLA need projection is available for this community.');
          return;
        }
        setV('psNeedAnnual', one(pvn.annual_need_10yr_dola) + ' units/yr');
        var r = pvn.ratio_recent_production_to_10yr_need;
        if (r != null) {
          setVc('psNeedRatio', (r > 99 ? '>99' : r.toFixed(2)) + '×', r >= 1 ? 'good' : r >= 0.5 ? 'warn' : 'bad');
          var closes = r >= 1 ? 'more than covers' : 'covers only ' + Math.round(r * 100) + '% of';
          say('At the recent pace (' + one(avg.value) + ' permitted units/yr, ' + (avg.window || '') + '), production ' + closes +
              ' the projected growth need of ' + one(pvn.annual_need_10yr_dola) + ' units/yr over the 10 years from ' + pvn.need_base_year +
              '. Need is the county DOLA projection scaled to this community\\'s share of county households (' +
              Math.round((pvn.county_share_used || 0) * 100) + '%); it excludes existing shortfalls, so treat it as a floor.');
        } else {
          setV('psNeedRatio', 'n/a');
          say('DOLA projects little or no household growth for this area, so a production-to-need ratio is not meaningful. Recent permitting: ' +
              one(avg.value) + ' units/yr (' + (avg.window || '') + ').');
        }
      })();
      // Cross-county disclosure
      if (data.cross_county && data.cross_county.all_counties && data.cross_county.all_counties.length > 1) {
        var disc = document.getElementById('placeDisclosure');
        if (disc) {
          var others = data.cross_county.all_counties.slice(1).map(function (c) {
            return c.name + ' (~' + Number(c.population).toLocaleString() + ' pop)';
          }).join(', ');
          disc.innerHTML = '<strong>⚠ Cross-county jurisdiction.</strong> ' + data.name +
            ' spans ' + data.cross_county.all_counties.length + ' counties. Primary: ' +
            data.cross_county.all_counties[0].name + '. Also touches: ' + others +
            '. HUD AMI is per-county — verify the parcel\\'s actual county before relying on tier rents.';
          disc.hidden = false;
        }
      }
    })();
  </script>
</body>
</html>
'''


def build_subtitle(place_chas: dict, cross_county: dict | None) -> str:
    rec = place_chas
    total = (rec['summary']['total_renter_hh'] or 0) + (rec['summary']['total_owner_hh'] or 0)
    cb30 = rec['summary']['renter_cb30_share'] or 0
    parts = []
    if total > 0:
        parts.append(f"~{int(round(total)):,} households")
    if cb30 > 0:
        parts.append(f"renter cost-burden {cb30*100:.1f}%")
    if cross_county and len(cross_county.get('all_counties', [])) > 1:
        parts.append('cross-county jurisdiction')
    return ' · '.join(parts) if parts else 'Colorado place'


def find_lat_lon(geoid: str, registry: dict) -> tuple[float, float]:
    """Try to derive a centroid lat/lon. Registry doesn't always have it;
    return None,None if unknown so the URL just omits the params."""
    for g in registry.get('geographies', []):
        if g.get('geoid') == geoid:
            if 'lat' in g and 'lon' in g:
                return g['lat'], g['lon']
    return None, None


def json_ld_script(value: dict) -> str:
    payload = json.dumps(value, separators=(',', ':')).replace('</', '<\\/')
    return f'  <script type="application/ld+json">{payload}</script>\n'


def build_place_json_ld(geoid: str, data_payload: dict, place_name: str, county_name: str) -> str:
    url = f'https://cohoanalytics.com/places/{geoid}.html'
    place_id = f'{url}#place'
    dataset_id = f'{url}#dataset'
    graph = [
        {
            '@type': 'Place',
            '@id': place_id,
            'name': f'{place_name}, Colorado',
            'identifier': geoid,
            'url': url,
            'containedInPlace': {
                '@type': 'AdministrativeArea',
                'name': f'{county_name} County, Colorado',
            } if county_name and county_name != 'Unknown' else {
                '@type': 'AdministrativeArea',
                'name': 'Colorado',
            },
        }
    ]
    if data_payload.get('summary') or data_payload.get('renter_hh_by_ami') or data_payload.get('owner_hh_by_ami'):
        graph.append({
            '@type': 'Dataset',
            '@id': dataset_id,
            'name': f'{place_name} Housing Profile',
            'description': (
                f'Housing needs and affordability profile for {place_name}, Colorado, '
                'including CHAS cost-burden estimates and AMI tier context.'
            ),
            'url': url,
            'creator': {'@id': 'https://cohoanalytics.com/#organization'},
            'spatialCoverage': {'@id': place_id},
            'temporalCoverage': '2018/2024',
            'isBasedOn': [
                'https://www.huduser.gov/portal/datasets/cp.html',
                'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
            ],
        })
    return json_ld_script({'@context': 'https://schema.org', '@graph': graph})


def generate_page(
    geoid: str,
    place_chas: dict,
    cross_county_doc: dict,
    registry: dict,
    county_names: dict,
    template: str,
    permits_doc: dict | None = None,
) -> str:
    place_name = place_chas.get('name') or geoid
    # Extract county FIPS from underlying tracts if present
    county_fips = None
    geo_type = None
    if place_chas.get('renter_hh_by_ami'):
        # Look at first tract in containment if available; otherwise we
        # don't have direct access from place-chas alone.
        pass
    # Fallback: registry's containingCounty
    for g in registry.get('geographies', []):
        if g.get('geoid') == geoid:
            county_fips = g.get('containingCounty')
            geo_type = g.get('type')
            break
    county_name = county_names.get(county_fips or '', 'Unknown') if county_fips else 'Unknown'

    cross_county = (cross_county_doc.get('places') or {}).get(geoid)
    lat, lon = find_lat_lon(geoid, registry)

    # Place data for the embedded JSON
    data_payload = dict(place_chas)
    data_payload['geoid'] = geoid
    data_payload['county_fips'] = county_fips
    data_payload['county_name'] = county_name
    data_payload['geo_type'] = geo_type
    if cross_county:
        data_payload['cross_county'] = cross_county
    # BPS permits (production vs need). Only permit-issuing municipalities
    # appear in permits.json — a missing entry for a CDP is by design
    # (permits issued by the county), NOT a data gap to paper over with
    # county figures (see feedback_place_vs_county_masking).
    if permits_doc:
        permit_rec = (permits_doc.get('places') or {}).get(geoid)
        if permit_rec:
            data_payload['permits'] = permit_rec
            data_payload['permits_years'] = permits_doc.get('years')

    place_type = 'cdp' if (' (cdp)' in place_name.lower() or 'cdp' in (place_name or '').lower()) else 'place'

    subtitle = build_subtitle(place_chas, cross_county)

    replacements = {
        '{{PLACE_GEOID}}':    geoid,
        '{{PLACE_NAME}}':     html_lib.escape(place_name, quote=True),
        '{{COUNTY_NAME}}':    html_lib.escape(county_name, quote=True),
        '{{PLACE_SUBTITLE}}': html_lib.escape(subtitle, quote=True),
        '{{PLACE_TYPE}}':     place_type,
        '{{LAT}}':            str(lat) if lat is not None else '',
        '{{LON}}':            str(lon) if lon is not None else '',
        '{{PLACE_DATA_JSON}}': json.dumps(data_payload, indent=2),
        '{{PLACE_JSON_LD}}':  build_place_json_ld(geoid, data_payload, place_name, county_name),
    }
    html = template
    for k, v in replacements.items():
        html = html.replace(k, str(v))
    return html


def build_index(places: list[tuple[str, str, str]], template_dir: str) -> str:
    """places = [(geoid, name, county_name), ...] sorted alphabetically."""
    rows = '\n'.join(
        f'  <li><a href="{g}.html">{n}</a> <span class="muted">— {c} County</span></li>'
        for g, n, c in places
    )
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Colorado Places — COHO Analytics</title>
  <meta name="description" content="Index of all Colorado places with housing data profiles.">
  <link rel="stylesheet" href="../css/site-theme.css">
  <link rel="stylesheet" href="../css/layout.css">
  <link rel="stylesheet" href="../css/pages.css">
  <script src="../js/path-resolver.js"></script>
  <script src="../js/config.js"></script>
  <script defer src="../js/navigation.js"></script>
  <style>
    .place-index {{ max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; }}
    .place-index h1 {{ margin-bottom: 1rem; }}
    .place-index ul {{ columns: 3; column-gap: 1.5rem; padding-left: 1rem; }}
    .place-index li {{ padding: .15rem 0; break-inside: avoid; }}
    .place-index .muted {{ color: var(--muted); font-size: .82em; }}
    @media (max-width: 700px) {{ .place-index ul {{ columns: 1; }} }}
  </style>
</head>
<body>
  <header class="site-header"></header>
  <main id="main-content" class="place-index">
    <h1>Colorado Places ({len(places)})</h1>
    <p>Per-place housing data profiles. Each page surfaces CHAS cost-burden,
    cross-county jurisdiction status, and links into the Deal Calculator + PMA workflow.</p>
    <ul>
{rows}
    </ul>
  </main>
</body>
</html>
'''


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=None, help='Generate at most N pages (for testing)')
    args = p.parse_args()

    if not os.path.exists(PLACE_CHAS):
        print(f'ERROR: {PLACE_CHAS} not found. Run scripts/hna/build_place_chas.py first.',
              file=sys.stderr)
        return 1

    with open(PLACE_CHAS) as f:
        place_chas_doc = json.load(f)
    cross_county_doc = {}
    if os.path.exists(CROSS_COUNTY):
        with open(CROSS_COUNTY) as f:
            cross_county_doc = json.load(f)
    registry = {}
    if os.path.exists(REGISTRY):
        with open(REGISTRY) as f:
            registry = json.load(f)
    permits_doc = None
    if os.path.exists(PERMITS):
        with open(PERMITS) as f:
            permits_doc = json.load(f)
    else:
        print(f'WARN: {PERMITS} not found — pages will show no permit data. '
              f'Run scripts/hna/build_permits.py first.', file=sys.stderr)
    county_names = load_county_names()
    template = load_template()
    os.makedirs(PAGES_DIR, exist_ok=True)
    # Write the template alongside generated pages so it's discoverable
    if not os.path.exists(TEMPLATE_FILE):
        with open(TEMPLATE_FILE, 'w') as f:
            f.write(DEFAULT_TEMPLATE)

    places_items = list(place_chas_doc.get('places', {}).items())
    if args.limit:
        places_items = places_items[: args.limit]

    print(f'Generating {len(places_items)} place pages...')
    written = 0
    index_rows = []
    for geoid, rec in places_items:
        html = generate_page(
            geoid, rec, cross_county_doc, registry, county_names, template,
            permits_doc=permits_doc,
        )
        out_path = os.path.join(PAGES_DIR, f'{geoid}.html')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        written += 1
        # Build index data
        county_fips = None
        for g in registry.get('geographies', []):
            if g.get('geoid') == geoid:
                county_fips = g.get('containingCounty')
                break
        county_name = county_names.get(county_fips or '', '?') if county_fips else '?'
        index_rows.append((geoid, rec.get('name') or geoid, county_name))

    print(f'  ✓ {written} place pages written to {PAGES_DIR}/')

    # Generate the index
    index_rows.sort(key=lambda r: r[1].lower())
    index_html = build_index(index_rows, PAGES_DIR)
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        f.write(index_html)
    print(f'  ✓ Index at {INDEX_FILE} ({len(index_rows)} entries)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
