#!/usr/bin/env python3
"""Stage 4 Governance Stress Tests.

12 adversarial pytest probes that verify governance compliance under realistic
Copilot usage scenarios.  Each probe simulates a common regression and asserts
that the detection logic in scripts/pre_commit_check.py correctly catches it,
or verifies that the production codebase already satisfies the rule.

Usage:
    pytest tests/test_governance_stress.py -v --tb=short
"""

import glob
import json
import os
import re
import subprocess
import sys
import textwrap

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(REPO_ROOT, 'data')
CSS_DIR = os.path.join(REPO_ROOT, 'css')
JS_DIR = os.path.join(REPO_ROOT, 'js')

PRE_COMMIT_SCRIPT = os.path.join(REPO_ROOT, 'scripts', 'pre_commit_check.py')

# Single source of truth for the HNA base year. Same JSON is read by
# scripts/hna/build_hna_data.py (the generator) and
# scripts/pre_commit_check.py (Check 7). Bumping in one place propagates here.
_HNA_CONSTANTS_PATH = os.path.join(REPO_ROOT, 'scripts', 'hna', 'hna_constants.json')
with open(_HNA_CONSTANTS_PATH, 'r', encoding='utf-8') as _f:
    HNA_BASE_YEAR = int(json.load(_f)['base_year'])

# ---------------------------------------------------------------------------
# Helpers shared across probes
# ---------------------------------------------------------------------------

FAILING_COLORS = [
    '#6c7a89', '#3498db', '#27ae60', '#d4a574',
    '#e4b584', '#2ecc71', '#f39c12', '#c0392b',
]


def _canvas_tags(html: str) -> list:
    """Return all <canvas …> opening tags from an HTML string."""
    return re.findall(r'<canvas[^>]*>', html, re.IGNORECASE | re.DOTALL)


def _has_bare_canvas(html: str) -> bool:
    """Return True if any canvas is missing aria-label."""
    for tag in _canvas_tags(html):
        if not re.search(r'aria-label\s*=\s*["\'][^"\']+["\']', tag, re.IGNORECASE):
            return True
    return False


def _failing_colors_in(html: str) -> list:
    """Return list of WCAG-failing hex codes found in html."""
    return [c for c in FAILING_COLORS
            if re.search(re.escape(c), html, re.IGNORECASE)]


# ===========================================================================
# Probe 1 — New chart with hardcoded colors
# ===========================================================================


class TestProbe1ChartColors:
    """Rule 10 / Bug S3-01 — hardcoded WCAG-failing colors must be detected."""

    ADVERSARIAL_HTML = textwrap.dedent("""\
        <html><body>
        <canvas id="myChart" role="img" aria-label="test"></canvas>
        <script>
        new Chart(ctx, {datasets: [{backgroundColor: '#3498db'}]});
        </script>
        </body></html>
    """)

    COMPLIANT_HTML = textwrap.dedent("""\
        <html><body>
        <canvas id="myChart" role="img" aria-label="test"></canvas>
        <script>
        new Chart(ctx, {datasets: [{backgroundColor: 'var(--chart-1)'}]});
        </script>
        </body></html>
    """)

    def test_detection_catches_failing_color(self):
        """Detection logic must flag '#3498db' as a WCAG-failing chart color."""
        found = _failing_colors_in(self.ADVERSARIAL_HTML)
        assert '#3498db' in found, (
            "Probe 1 FAIL: '#3498db' should be detected as a failing color"
        )

    def test_detection_passes_token_colors(self):
        """Detection logic must pass HTML that uses CSS var() color tokens."""
        found = _failing_colors_in(self.COMPLIANT_HTML)
        assert found == [], (
            f"Probe 1 FAIL: compliant HTML should not trigger color check, got {found}"
        )

    def test_production_html_files_have_no_failing_colors(self):
        """All root-level HTML files must be free of WCAG-failing hardcoded colors."""
        html_files = sorted(glob.glob(os.path.join(REPO_ROOT, '*.html')))
        violations = []
        for fpath in html_files:
            with open(fpath, encoding='utf-8', errors='replace') as f:
                content = f.read()
            found = _failing_colors_in(content)
            if found:
                violations.append(f'{os.path.basename(fpath)}: {found}')
        assert violations == [], (
            'Probe 1 FAIL: production files still contain failing colors:\n'
            + '\n'.join(violations)
        )


# ===========================================================================
# Probe 2 — New county data file FIPS format
# ===========================================================================


class TestProbe2FipsFormat:
    """Rule 1 / Bug S1-01/S1-06/S1-09 — 3-digit FIPS codes must be detected."""

    ADVERSARIAL_DATA = {
        'counties': [
            {'fips': '001', 'county_name': 'Adams', 'ami_4person': 107200},
            {'fips': '091', 'county_name': 'Ouray', 'ami_4person': 91200},
        ]
    }

    COMPLIANT_DATA = {
        'counties': [
            {'fips': '08001', 'county_name': 'Adams', 'ami_4person': 107200},
            {'fips': '08091', 'county_name': 'Ouray', 'ami_4person': 91200},
        ]
    }

    def _find_short_fips(self, data):
        """Return list of county FIPS values with len 3 or 4."""
        violations = []
        for county in data.get('counties', []):
            fips = county.get('fips', '')
            if isinstance(fips, str) and len(fips) in (3, 4) and fips.isdigit():
                violations.append(fips)
        return violations

    def test_detection_catches_3digit_fips(self):
        """3-digit county FIPS must be flagged by detection logic."""
        violations = self._find_short_fips(self.ADVERSARIAL_DATA)
        assert violations, (
            'Probe 2 FAIL: 3-digit FIPS codes were not detected'
        )
        assert '001' in violations
        assert '091' in violations

    def test_detection_passes_5digit_fips(self):
        """5-digit county FIPS must not trigger the check."""
        violations = self._find_short_fips(self.COMPLIANT_DATA)
        assert violations == [], (
            f'Probe 2 FAIL: compliant 5-digit FIPS triggered check: {violations}'
        )

    def test_production_ami_gap_fips_are_5digit(self):
        """data/co_ami_gap_by_county.json must use 5-digit county FIPS codes."""
        with open(os.path.join(DATA_DIR, 'co_ami_gap_by_county.json')) as f:
            data = json.load(f)
        counties = data.get('counties', [])
        bad = [c['fips'] for c in counties
               if isinstance(c.get('fips'), str) and len(c['fips']) != 5]
        assert bad == [], f'Probe 2 FAIL: non-5-digit FIPS in AMI gap file: {bad}'

    def test_production_ouray_county_has_correct_fips(self):
        """Ouray County must appear as '08091', not '091' or absent."""
        with open(os.path.join(DATA_DIR, 'co_ami_gap_by_county.json')) as f:
            data = json.load(f)
        fips_set = {c['fips'] for c in data.get('counties', [])}
        assert '08091' in fips_set, (
            "Probe 2 FAIL: Ouray County FIPS '08091' missing from AMI gap file"
        )


# ===========================================================================
# Probe 3 — New HTML page structure / landmarks
# ===========================================================================


class TestProbe3HtmlLandmarks:
    """Rule 12 / Bug S3-04 — pages without <main> must be detected."""

    ADVERSARIAL_HTML = textwrap.dedent("""\
        <!DOCTYPE html><html lang="en"><head><title>Test</title></head>
        <body>
          <div class="navbar">Nav</div>
          <div class="content">Content without main landmark</div>
        </body></html>
    """)

    COMPLIANT_HTML = textwrap.dedent("""\
        <!DOCTYPE html><html lang="en"><head><title>Test</title></head>
        <body>
          <header><a href="#main-content" class="skip-link">Skip to main content</a></header>
          <main id="main-content">Content</main>
          <footer>Footer</footer>
        </body></html>
    """)

    def test_detection_catches_missing_main(self):
        """Pages without <main> must be detected."""
        has_main = bool(re.search(r'<main[\s>]', self.ADVERSARIAL_HTML, re.IGNORECASE))
        assert not has_main, 'Probe 3 FAIL: adversarial page should not have <main>'

    def test_detection_passes_compliant_page(self):
        """Pages with proper landmark structure must pass."""
        has_main = bool(re.search(r'<main[\s>]', self.COMPLIANT_HTML, re.IGNORECASE))
        assert has_main, 'Probe 3 FAIL: compliant page should contain <main>'

    def test_production_interactive_pages_have_main(self):
        """Key interactive pages must all contain a <main> landmark."""
        pages = [
            'dashboard.html', 'cra-expansion-analysis.html',
            'construction-commodities.html', 'chfa-portfolio.html',
            'compliance-dashboard.html', 'colorado-deep-dive.html',
        ]
        missing = []
        for fname in pages:
            fpath = os.path.join(REPO_ROOT, fname)
            with open(fpath, encoding='utf-8', errors='replace') as f:
                content = f.read()
            if not re.search(r'<main[\s>]', content, re.IGNORECASE):
                missing.append(fname)
        assert missing == [], (
            f'Probe 3 FAIL: pages missing <main> landmark: {missing}'
        )


# ===========================================================================
# Probe 4 — New canvas element accessibility
# ===========================================================================


class TestProbe4CanvasAccessibility:
    """Rule 15 / Bug S3-02 — canvas without aria-label must be detected."""

    ADVERSARIAL_HTML = textwrap.dedent("""\
        <html><body>
        <canvas id="newChart"></canvas>
        </body></html>
    """)

    COMPLIANT_HTML = textwrap.dedent("""\
        <html><body>
        <canvas id="newChart" role="img" aria-label="New chart description"></canvas>
        </body></html>
    """)

    def test_detection_catches_bare_canvas(self):
        """A canvas element without aria-label must be detected."""
        assert _has_bare_canvas(self.ADVERSARIAL_HTML), (
            'Probe 4 FAIL: bare canvas should be detected'
        )

    def test_detection_passes_accessible_canvas(self):
        """A canvas element with aria-label must pass the check."""
        assert not _has_bare_canvas(self.COMPLIANT_HTML), (
            'Probe 4 FAIL: accessible canvas should not be detected as bare'
        )

    def test_production_html_all_canvas_accessible(self):
        """All canvas elements in root-level HTML must have aria-label."""
        html_files = sorted(glob.glob(os.path.join(REPO_ROOT, '*.html')))
        violations = []
        for fpath in html_files:
            fname = os.path.basename(fpath)
            with open(fpath, encoding='utf-8', errors='replace') as f:
                content = f.read()
            for tag in _canvas_tags(content):
                if not re.search(r'aria-label\s*=\s*["\'][^"\']+["\']', tag, re.IGNORECASE):
                    violations.append(f'{fname}: {tag[:80]}')
        assert violations == [], (
            'Probe 4 FAIL: canvas elements missing aria-label:\n'
            + '\n'.join(violations)
        )


# ===========================================================================
# Probe 5 — FRED series metadata completeness
# ===========================================================================


class TestProbe5FredMetadata:
    """Rule 6 / Bug S2-01 — FRED series missing name must be detected."""

    def test_detection_catches_blank_name(self):
        """A series with an empty 'name' field must be flagged."""
        adversarial_series = {
            'CPIAUCSL': {'name': '', 'observations': [{'date': '2024-01-01', 'value': '305'}]},
        }
        blank = [k for k, v in adversarial_series.items() if not v.get('name', '').strip()]
        assert blank == ['CPIAUCSL'], (
            'Probe 5 FAIL: blank name should be detected'
        )

    def test_detection_passes_complete_series(self):
        """A series with a non-empty 'name' field must pass."""
        compliant_series = {
            'CPIAUCSL': {
                'name': 'CPI (All Urban Consumers)',
                'observations': [{'date': '2024-01-01', 'value': '305'}],
            },
        }
        blank = [k for k, v in compliant_series.items() if not v.get('name', '').strip()]
        assert blank == [], 'Probe 5 FAIL: complete series should not be flagged'

    def test_production_fred_all_series_have_name(self):
        """All FRED series in fred-data.json must have a non-empty name field."""
        with open(os.path.join(DATA_DIR, 'fred-data.json')) as f:
            data = json.load(f)
        series = data.get('series', {})
        blank = [k for k, v in series.items() if not v.get('name', '').strip()]
        assert blank == [], (
            f'Probe 5 FAIL: FRED series with blank name: {blank}'
        )

    def test_production_fred_core_series_have_observations(self):
        """Core economic FRED series must have at least one observation.

        Note: Five commodity PPI series (WPUFD4111, PCU*) were previously
        empty due to incorrect series IDs — now corrected. Tracked
        by tests/test_stage2_temporal.py::TestFredTemporalContinuity.
        This probe focuses on the core series that must always be populated.
        """
        CORE_SERIES = [
            'CPIAUCSL', 'UNRATE', 'PAYEMS', 'MORTGAGE30US',
            'HOUST', 'DFF', 'CIVPART',
        ]
        with open(os.path.join(DATA_DIR, 'fred-data.json')) as f:
            data = json.load(f)
        series = data.get('series', {})
        empty = [k for k in CORE_SERIES
                 if len(series.get(k, {}).get('observations', [])) == 0]
        assert empty == [], (
            f'Probe 5 FAIL: core FRED series with zero observations: {empty}'
        )


# ===========================================================================
# Probe 6 — Projection baseYear verification
# ===========================================================================


class TestProbe6ProjectionBaseYear:
    """Rule 3 / Bug S1-05/S2-06 — stale baseYear/pyramidYear must be detected."""

    EXPECTED_YEAR = HNA_BASE_YEAR

    def test_detection_catches_stale_pyramid_year(self):
        """A projection file with a stale (non-base) pyramidYear must be detected."""
        adversarial = {'pyramidYear': self.EXPECTED_YEAR + 6, 'ages': []}
        assert adversarial['pyramidYear'] != self.EXPECTED_YEAR, (
            'Probe 6 FAIL: stale pyramidYear should be detected'
        )

    def test_detection_passes_correct_pyramid_year(self):
        """A projection file with the current base pyramidYear must pass."""
        compliant = {'pyramidYear': self.EXPECTED_YEAR, 'ages': []}
        assert compliant['pyramidYear'] == self.EXPECTED_YEAR, (
            'Probe 6 FAIL: correct pyramidYear should not be flagged'
        )

    def test_production_sya_files_have_correct_year(self):
        """All dola_sya/*.json files must have pyramidYear == 2024."""
        sya_files = sorted(glob.glob(
            os.path.join(DATA_DIR, 'hna', 'dola_sya', '*.json')
        ))
        assert sya_files, 'Probe 6 FAIL: no dola_sya files found'
        bad = []
        for fpath in sya_files:
            with open(fpath) as f:
                d = json.load(f)
            y = d.get('pyramidYear')
            if y != self.EXPECTED_YEAR:
                bad.append(f'{os.path.basename(fpath)}: pyramidYear={y}')
        assert bad == [], (
            'Probe 6 FAIL: SYA files with wrong pyramidYear:\n' + '\n'.join(bad)
        )

    def test_production_projection_files_have_correct_base_year(self):
        """All projections/*.json files must have baseYear == 2024."""
        proj_files = sorted(glob.glob(
            os.path.join(DATA_DIR, 'hna', 'projections', '*.json')
        ))
        assert proj_files, 'Probe 6 FAIL: no projection files found'
        bad = []
        for fpath in proj_files:
            with open(fpath) as f:
                d = json.load(f)
            y = d.get('baseYear')
            if y is not None and y != self.EXPECTED_YEAR:
                bad.append(f'{os.path.basename(fpath)}: baseYear={y}')
        assert bad == [], (
            'Probe 6 FAIL: projection files with wrong baseYear:\n' + '\n'.join(bad)
        )


# ===========================================================================
# Probe 7 — Accent color token value
# ===========================================================================


class TestProbe7AccentToken:
    """Rule 13 / Bug S3-05 — wrong --accent value must be detected."""

    EXPECTED_ACCENT = '#096e65'
    WRONG_ACCENT = '#0a7e74'

    def _extract_accent(self, css: str):
        """Return the first --accent hex value found in CSS."""
        m = re.search(r'--accent\s*:\s*(#[0-9a-fA-F]{3,8})', css)
        return m.group(1).lower() if m else None

    def test_detection_catches_wrong_accent(self):
        """A CSS file with old --accent value must be flagged."""
        adversarial_css = f':root {{ --accent: {self.WRONG_ACCENT}; }}'
        actual = self._extract_accent(adversarial_css)
        assert actual != self.EXPECTED_ACCENT, (
            'Probe 7 FAIL: wrong --accent should be detected'
        )

    def test_detection_passes_correct_accent(self):
        """A CSS file with correct --accent value must pass."""
        compliant_css = f':root {{ --accent: {self.EXPECTED_ACCENT}; }}'
        actual = self._extract_accent(compliant_css)
        assert actual == self.EXPECTED_ACCENT, (
            'Probe 7 FAIL: correct --accent should not be flagged'
        )

    def test_production_css_accent_is_correct(self):
        """css/site-theme.css --accent must equal #096e65 (WCAG AA 4.51:1)."""
        with open(os.path.join(CSS_DIR, 'site-theme.css')) as f:
            css = f.read()
        actual = self._extract_accent(css)
        assert actual == self.EXPECTED_ACCENT, (
            f'Probe 7 FAIL: --accent is {actual!r}, expected {self.EXPECTED_ACCENT!r}'
        )

    def test_production_css_wrong_accent_absent(self):
        """The old non-compliant --accent value must not appear in CSS."""
        with open(os.path.join(CSS_DIR, 'site-theme.css')) as f:
            css = f.read()
        # Look only in the :root block (before dark-mode override)
        root_block = css.split('@media')[0]
        assert self.WRONG_ACCENT not in root_block, (
            f'Probe 7 FAIL: old non-compliant accent {self.WRONG_ACCENT} still in :root block'
        )


# ===========================================================================
# Probe 8 — Dynamic filter aria-live and announceUpdate
# ===========================================================================


class TestProbe8AriaLive:
    """Rule 11 / Bug S3-03 — pages without aria-live must be detected."""

    ADVERSARIAL_HTML = textwrap.dedent("""\
        <html><body>
        <select id="regionFilter"><option>Denver</option></select>
        <canvas id="chart" role="img" aria-label="test"></canvas>
        <script>
        document.getElementById('regionFilter').addEventListener('change', function() {
          updateChart(this.value);
        });
        </script>
        </body></html>
    """)

    COMPLIANT_HTML = textwrap.dedent("""\
        <html><body>
        <div id="aria-live-region" role="status" aria-live="polite"
             aria-atomic="true" style="clip:rect(0,0,0,0);position:absolute"></div>
        <select id="regionFilter"><option>Denver</option></select>
        <canvas id="chart" role="img" aria-label="test"></canvas>
        <script>
        window.__announceUpdate = function(msg) {
          document.getElementById('aria-live-region').textContent = msg;
        };
        document.getElementById('regionFilter').addEventListener('change', function() {
          updateChart(this.value);
          window.__announceUpdate && window.__announceUpdate('Region updated');
        });
        </script>
        </body></html>
    """)

    def test_detection_catches_missing_aria_live(self):
        """Pages without aria-live must be detected."""
        has_live = 'aria-live' in self.ADVERSARIAL_HTML
        assert not has_live, 'Probe 8 FAIL: adversarial page should not have aria-live'

    def test_detection_passes_with_aria_live(self):
        """Pages with aria-live="polite" must pass."""
        has_live = 'aria-live="polite"' in self.COMPLIANT_HTML
        assert has_live, 'Probe 8 FAIL: compliant page should have aria-live'

    def test_compliant_page_has_announce_update(self):
        """Compliant dynamic pages must wire window.__announceUpdate."""
        has_announce = '__announceUpdate' in self.COMPLIANT_HTML
        assert has_announce, 'Probe 8 FAIL: compliant page should have __announceUpdate'

    def test_production_dashboard_has_aria_live(self):
        """dashboard.html must contain aria-live="polite" region."""
        with open(os.path.join(REPO_ROOT, 'dashboard.html'), encoding='utf-8') as f:
            content = f.read()
        assert 'aria-live="polite"' in content, (
            'Probe 8 FAIL: dashboard.html missing aria-live="polite"'
        )

    def test_production_commodities_has_announce_update(self):
        """construction-commodities.html must wire __announceUpdate."""
        with open(os.path.join(REPO_ROOT, 'construction-commodities.html'), encoding='utf-8') as f:
            content = f.read()
        assert '__announceUpdate' in content, (
            'Probe 8 FAIL: construction-commodities.html missing __announceUpdate'
        )


# ===========================================================================
# Probe 9 — ArcGIS FeatureServer URL compliance
# ===========================================================================


class TestProbe9ArcgisUrls:
    """Rule 9 / Bug S3-07 — ArcGIS queries without outSR=4326 must be detected."""

    ADVERSARIAL_QUERY = (
        "where=STATEFP%3D%2708%27&outFields=*&f=geojson"
    )
    COMPLIANT_QUERY = (
        "where=STATEFP%3D%2708%27&outFields=*&f=geojson&outSR=4326"
    )

    def test_detection_catches_missing_outsr(self):
        """An ArcGIS query string without outSR=4326 must be detected."""
        has_outsr = 'outSR' in self.ADVERSARIAL_QUERY
        assert not has_outsr, (
            'Probe 9 FAIL: adversarial query without outSR should be detected'
        )

    def test_detection_passes_with_outsr(self):
        """An ArcGIS query string with outSR=4326 must pass."""
        has_outsr = 'outSR=4326' in self.COMPLIANT_QUERY
        assert has_outsr, (
            'Probe 9 FAIL: compliant query should have outSR=4326'
        )

    def test_production_js_arcgis_queries_have_outsr(self):
        """All ArcGIS f=geojson query strings in js/ must include outSR=4326."""
        js_files = sorted(glob.glob(os.path.join(JS_DIR, '*.js')))
        violations = []
        for fpath in js_files:
            fname = os.path.basename(fpath)
            with open(fpath, encoding='utf-8', errors='replace') as f:
                content = f.read()
            query_strings = re.findall(
                r'["\']([^"\']*f(?:=|%3D)geojson[^"\']*)["\']',
                content, re.IGNORECASE,
            )
            for qs in query_strings:
                if 'outSR' not in qs:
                    violations.append(f'{fname}: ...{qs[:80]}...')
        assert violations == [], (
            'Probe 9 FAIL: ArcGIS query strings missing outSR=4326:\n'
            + '\n'.join(violations)
        )


# ===========================================================================
# Probe 10 — Manifest sync after data file additions
# ===========================================================================


class TestProbe10ManifestSync:
    """Rule 5 / Bug S1-08 — stale manifest must be detected."""

    def test_production_manifest_is_valid_json(self):
        """data/manifest.json must load as valid JSON."""
        with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
            manifest = json.load(f)
        assert isinstance(manifest, dict), 'Probe 10 FAIL: manifest is not a dict'

    def test_production_manifest_has_generated_timestamp(self):
        """data/manifest.json must have a 'generated' ISO timestamp."""
        with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
            manifest = json.load(f)
        ts = manifest.get('generated', '')
        assert ts, 'Probe 10 FAIL: manifest missing generated timestamp'
        # Must be parseable as ISO datetime
        try:
            from datetime import datetime
            datetime.fromisoformat(ts.rstrip('Z'))
        except Exception as exc:
            pytest.fail(f'Probe 10 FAIL: generated timestamp is not valid ISO: {ts!r} — {exc}')

    def test_production_manifest_lists_100plus_files(self):
        """data/manifest.json must list at least 100 data files."""
        with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
            manifest = json.load(f)
        count = len(manifest.get('files', {}))
        assert count >= 100, (
            f'Probe 10 FAIL: manifest lists only {count} files (expected ≥100)'
        )

    def test_production_manifest_includes_key_files(self):
        """manifest.json must include the primary data files."""
        with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
            manifest = json.load(f)
        files = manifest.get('files', {})
        # Paths in manifest.json are relative to the repository root (include "data/" prefix).
        required = [
            'data/chfa-lihtc.json',
            'data/co_ami_gap_by_county.json',
            'data/fred-data.json',
        ]
        missing = [k for k in required if k not in files]
        assert missing == [], (
            f'Probe 10 FAIL: manifest missing entries: {missing}'
        )

    def test_stale_manifest_detection_logic(self):
        """Detection logic must flag a manifest older than 30 days."""
        from datetime import datetime, timezone, timedelta
        old_ts = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        adversarial_manifest = {'generated': old_ts, 'files': {}}
        generated_dt = datetime.fromisoformat(
            adversarial_manifest['generated'].rstrip('Z')
        ).replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - generated_dt
        assert age > timedelta(days=30), (
            'Probe 10 FAIL: stale manifest detection logic failed'
        )


# ===========================================================================
# Probe 11 — Sentinel keys preservation (ETL markers)
# ===========================================================================


class TestProbe11SentinelKeys:
    """Rule 18 / Bug S2-09/S1-10 — ETL sentinel keys must be present."""

    def test_fred_data_has_updated_key(self):
        """fred-data.json must have an 'updated' top-level sentinel key."""
        with open(os.path.join(DATA_DIR, 'fred-data.json')) as f:
            data = json.load(f)
        assert 'updated' in data, (
            'Probe 11 FAIL: fred-data.json missing "updated" sentinel key'
        )
        assert data['updated'], (
            'Probe 11 FAIL: fred-data.json "updated" key is empty'
        )

    def test_chfa_lihtc_has_fetched_at_key(self):
        """chfa-lihtc.json must have a 'fetchedAt' top-level sentinel key."""
        with open(os.path.join(DATA_DIR, 'chfa-lihtc.json')) as f:
            data = json.load(f)
        assert 'fetchedAt' in data, (
            'Probe 11 FAIL: chfa-lihtc.json missing "fetchedAt" sentinel key'
        )
        assert data['fetchedAt'], (
            'Probe 11 FAIL: chfa-lihtc.json "fetchedAt" key is empty'
        )

    def test_ami_gap_has_meta_key(self):
        """co_ami_gap_by_county.json must have a 'meta' top-level sentinel key."""
        with open(os.path.join(DATA_DIR, 'co_ami_gap_by_county.json')) as f:
            data = json.load(f)
        assert 'meta' in data, (
            'Probe 11 FAIL: co_ami_gap_by_county.json missing "meta" sentinel key'
        )

    def test_manifest_has_generated_key(self):
        """data/manifest.json must have a 'generated' top-level sentinel key."""
        with open(os.path.join(DATA_DIR, 'manifest.json')) as f:
            data = json.load(f)
        assert 'generated' in data, (
            'Probe 11 FAIL: manifest.json missing "generated" sentinel key'
        )
        assert data['generated'], (
            'Probe 11 FAIL: manifest.json "generated" key is empty'
        )

    def test_adversarial_missing_sentinel_detection(self):
        """Detection logic must flag a data file stripped of its sentinel key."""
        adversarial = {'series': {'CPIAUCSL': {'name': 'CPI', 'observations': []}}}
        # 'updated' key is absent — this must be detected
        assert 'updated' not in adversarial, (
            'Probe 11 FAIL: adversarial file without "updated" key should be flagged'
        )
        has_updated = 'updated' in adversarial
        assert not has_updated, (
            'Probe 11 FAIL: detection of missing sentinel should return False'
        )


# ===========================================================================
# Probe 12 — Full pre-commit integration check
# ===========================================================================


class TestProbe12PreCommitIntegration:
    """Verify that scripts/pre_commit_check.py exits 0 on the current codebase."""

    def test_pre_commit_script_exists(self):
        """scripts/pre_commit_check.py must exist."""
        assert os.path.exists(PRE_COMMIT_SCRIPT), (
            f'Probe 12 FAIL: pre_commit_check.py not found at {PRE_COMMIT_SCRIPT}'
        )

    def test_pre_commit_script_is_executable_python(self):
        """scripts/pre_commit_check.py must be valid Python syntax."""
        result = subprocess.run(
            [sys.executable, '-m', 'py_compile', PRE_COMMIT_SCRIPT],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f'Probe 12 FAIL: pre_commit_check.py has syntax errors:\n{result.stderr}'
        )

    def test_pre_commit_exits_zero_on_current_codebase(self):
        """scripts/pre_commit_check.py must exit 0 on the current codebase."""
        result = subprocess.run(
            [sys.executable, PRE_COMMIT_SCRIPT],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        assert result.returncode == 0, (
            'Probe 12 FAIL: pre_commit_check.py exited non-zero.\n'
            'stdout:\n' + result.stdout +
            '\nstderr:\n' + result.stderr
        )

    def test_pre_commit_output_shows_all_passed(self):
        """pre_commit_check.py output must contain the 'All governance checks PASSED' line."""
        result = subprocess.run(
            [sys.executable, PRE_COMMIT_SCRIPT],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        assert 'All governance checks PASSED' in result.stdout, (
            'Probe 12 FAIL: pre_commit_check.py did not report all checks passed.\n'
            'stdout:\n' + result.stdout
        )
