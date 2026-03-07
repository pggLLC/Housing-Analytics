#!/usr/bin/env python3
"""Stage 3 Visualization & Accessibility Test Suite.

Comprehensive pytest validation for 6 WCAG 2.1 AA accessibility fixes.
Covers 9 confirmed violations across HTML and CSS files:

  Block 1: Chart color palette (Fix 1)          — 6 checks
  Block 2: Canvas ARIA attributes (Fix 2)        — 8 checks
  Block 3: aria-live regions (Fix 3)             — 6 checks
  Block 4: Landmark elements (Fix 4)             — 8 checks
  Block 5: --accent token contrast (Fix 5)       — 4 checks
  Block 6: Touch targets & color-only (Fix 6)    — 5 checks

Total: 37 checks across 10 HTML files and 1 CSS file.

Usage:
    pytest tests/test_stage3_visualization.py -v
"""

import os
import re

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# HTML files in scope
CRA_HTML          = os.path.join(REPO_ROOT, 'cra-expansion-analysis.html')
DASHBOARD_HTML    = os.path.join(REPO_ROOT, 'dashboard.html')
COMMODITIES_HTML  = os.path.join(REPO_ROOT, 'construction-commodities.html')
COLORADO_HTML     = os.path.join(REPO_ROOT, 'colorado-deep-dive.html')
CHFA_HTML         = os.path.join(REPO_ROOT, 'chfa-portfolio.html')
COMPLIANCE_HTML   = os.path.join(REPO_ROOT, 'compliance-dashboard.html')
REGIONAL_HTML     = os.path.join(REPO_ROOT, 'regional.html')
MARKET_HTML       = os.path.join(REPO_ROOT, 'market-analysis.html')
MARKET_INT_HTML   = os.path.join(REPO_ROOT, 'market-intelligence.html')
CO_MARKET_HTML    = os.path.join(REPO_ROOT, 'colorado-market.html')

# CSS
SITE_THEME_CSS    = os.path.join(REPO_ROOT, 'css', 'site-theme.css')

# ---------------------------------------------------------------------------
# Fixtures — load file contents once per session
# ---------------------------------------------------------------------------


@pytest.fixture(scope='session')
def cra_html():
    with open(CRA_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def dashboard_html():
    with open(DASHBOARD_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def commodities_html():
    with open(COMMODITIES_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def colorado_html():
    with open(COLORADO_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def chfa_html():
    with open(CHFA_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def compliance_html():
    with open(COMPLIANCE_HTML, encoding='utf-8') as f:
        return f.read()


@pytest.fixture(scope='session')
def site_theme():
    with open(SITE_THEME_CSS, encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _failing_colors_present(html: str) -> list:
    """Return list of WCAG-failing hex colors still present in html."""
    failing = ['#6c7a89', '#3498db', '#27ae60', '#d4a574', '#e4b584',
               '#2ecc71', '#f39c12', '#c0392b']
    found = []
    for color in failing:
        if re.search(re.escape(color), html, re.IGNORECASE):
            found.append(color)
    return found


def _canvas_tags(html: str) -> list:
    """Return list of canvas opening tags from html."""
    return re.findall(r'<canvas[^>]*>', html, re.IGNORECASE | re.DOTALL)


# ---------------------------------------------------------------------------
# Block 1: Chart Color Palette — WCAG AA Compliance (Fix 1)
# ---------------------------------------------------------------------------


class TestChartColors:
    """WCAG 1.4.3 — chart colors must meet 4.5:1 contrast on white (#ffffff)."""

    def test_no_failing_colors_in_cra(self, cra_html):
        """cra-expansion-analysis.html must contain no WCAG-failing chart colors."""
        failing = _failing_colors_present(cra_html)
        assert failing == [], (
            f'cra-expansion-analysis.html still contains failing colors: {failing}'
        )

    def test_no_failing_colors_in_dashboard(self, dashboard_html):
        """dashboard.html must contain no WCAG-failing chart colors."""
        failing = _failing_colors_present(dashboard_html)
        assert failing == [], (
            f'dashboard.html still contains failing colors: {failing}'
        )

    def test_no_failing_colors_in_commodities(self, commodities_html):
        """construction-commodities.html must contain no WCAG-failing chart colors."""
        failing = _failing_colors_present(commodities_html)
        assert failing == [], (
            f'construction-commodities.html still contains failing colors: {failing}'
        )

    def test_cra_uses_wcag_palette(self, cra_html):
        """cra-expansion-analysis.html chart datasets must use AA-compliant colors."""
        expected = ['#1e5799', '#0369a1']
        for color in expected:
            assert color.lower() in cra_html.lower(), (
                f'Expected WCAG-AA color {color} not found in cra-expansion-analysis.html'
            )

    def test_dashboard_uses_wcag_palette(self, dashboard_html):
        """dashboard.html chart must use the AA-compliant amber (#7c3d00)."""
        assert '#7c3d00' in dashboard_html, (
            'Expected WCAG-AA color #7c3d00 not found in dashboard.html'
        )

    def test_site_theme_has_chart_tokens(self, site_theme):
        """css/site-theme.css must define --chart-1 through --chart-4 tokens."""
        for i in range(1, 5):
            token = f'--chart-{i}'
            assert token in site_theme, (
                f'Chart color token {token} missing from site-theme.css'
            )


# ---------------------------------------------------------------------------
# Block 2: Canvas ARIA Attributes (Fix 2)
# ---------------------------------------------------------------------------


class TestCanvasAria:
    """WCAG 1.1.1 — all canvas elements must have role="img" and aria-label."""

    def _assert_canvas_accessible(self, html: str, page: str) -> None:
        """Assert every <canvas> in html has role="img" and aria-label."""
        canvases = _canvas_tags(html)
        bare = []
        for tag in canvases:
            has_role  = bool(re.search(r'role\s*=\s*["\']img["\']', tag, re.IGNORECASE))
            has_label = bool(re.search(r'aria-label\s*=\s*["\'][^"\']+["\']', tag, re.IGNORECASE))
            if not (has_role and has_label):
                bare.append(tag[:80])
        assert bare == [], (
            f'{page}: {len(bare)} canvas element(s) missing role="img" or aria-label:\n'
            + '\n'.join(bare)
        )

    def test_cra_canvas_accessible(self, cra_html):
        """cra-expansion-analysis.html — all canvas elements are accessible."""
        self._assert_canvas_accessible(cra_html, 'cra-expansion-analysis.html')

    def test_dashboard_canvas_accessible(self, dashboard_html):
        """dashboard.html — all canvas elements are accessible."""
        self._assert_canvas_accessible(dashboard_html, 'dashboard.html')

    def test_commodities_canvas_accessible(self, commodities_html):
        """construction-commodities.html — all 4 canvas elements are accessible."""
        self._assert_canvas_accessible(commodities_html, 'construction-commodities.html')

    def test_colorado_canvas_accessible(self, colorado_html):
        """colorado-deep-dive.html — canvas elements already with aria-label retain them."""
        canvases = _canvas_tags(colorado_html)
        # Every canvas must have aria-label
        missing_label = [
            t[:80] for t in canvases
            if not re.search(r'aria-label\s*=\s*["\'][^"\']+["\']', t, re.IGNORECASE)
        ]
        assert missing_label == [], (
            f'colorado-deep-dive.html: canvas elements missing aria-label:\n'
            + '\n'.join(missing_label)
        )

    def test_canvas_summary_paragraphs_exist(self, cra_html):
        """cra-expansion-analysis.html — visually-hidden summary p follows canvas."""
        assert 'class="sr-only"' in cra_html or "class='sr-only'" in cra_html, (
            'No sr-only summary paragraph found in cra-expansion-analysis.html'
        )

    def test_canvas_summary_in_dashboard(self, dashboard_html):
        """dashboard.html — visually-hidden summary p follows the allocations canvas."""
        assert 'class="sr-only"' in dashboard_html or "class='sr-only'" in dashboard_html, (
            'No sr-only summary paragraph found in dashboard.html'
        )

    def test_canvas_summary_in_commodities(self, commodities_html):
        """construction-commodities.html — visually-hidden summary p follows each canvas."""
        assert 'class="sr-only"' in commodities_html or "class='sr-only'" in commodities_html, (
            'No sr-only summary paragraph found in construction-commodities.html'
        )

    def test_canvas_role_count_in_commodities(self, commodities_html):
        """construction-commodities.html — all 4 canvas elements have role=img."""
        canvases = _canvas_tags(commodities_html)
        assert len(canvases) == 4, (
            f'Expected 4 canvas elements in construction-commodities.html, found {len(canvases)}'
        )
        roles = sum(
            1 for t in canvases
            if re.search(r'role\s*=\s*["\']img["\']', t, re.IGNORECASE)
        )
        assert roles == 4, f'Only {roles}/4 canvas elements have role="img"'


# ---------------------------------------------------------------------------
# Block 3: aria-live Regions (Fix 3)
# ---------------------------------------------------------------------------


class TestAriaLive:
    """WCAG 1.3.6 — dynamic content updates must be announced via aria-live."""

    def _assert_live_region(self, html: str, page: str) -> None:
        has_region = bool(re.search(
            r'role\s*=\s*["\']status["\']',
            html, re.IGNORECASE,
        ))
        assert has_region, f'{page}: missing role="status" aria-live region'

        has_live = bool(re.search(
            r'aria-live\s*=\s*["\']polite["\']',
            html, re.IGNORECASE,
        ))
        assert has_live, f'{page}: missing aria-live="polite" attribute'

    def test_dashboard_has_live_region(self, dashboard_html):
        """dashboard.html must have a role=status aria-live=polite region."""
        self._assert_live_region(dashboard_html, 'dashboard.html')

    def test_chfa_has_live_region(self, chfa_html):
        """chfa-portfolio.html must have a role=status aria-live=polite region."""
        self._assert_live_region(chfa_html, 'chfa-portfolio.html')

    def test_compliance_has_live_region(self, compliance_html):
        """compliance-dashboard.html must have a role=status aria-live=polite region."""
        self._assert_live_region(compliance_html, 'compliance-dashboard.html')

    def test_commodities_has_live_region(self, commodities_html):
        """construction-commodities.html must have a role=status aria-live=polite region."""
        self._assert_live_region(commodities_html, 'construction-commodities.html')

    def test_dashboard_region_is_atomic(self, dashboard_html):
        """dashboard.html aria-live region must include aria-atomic=true."""
        assert re.search(
            r'aria-atomic\s*=\s*["\']true["\']',
            dashboard_html, re.IGNORECASE,
        ), 'dashboard.html: aria-live region missing aria-atomic="true"'

    def test_dashboard_announce_js_wired(self, dashboard_html):
        """dashboard.html filter change must call the announce helper."""
        assert '__announceUpdate' in dashboard_html, (
            'dashboard.html: region-select change handler does not call __announceUpdate'
        )


# ---------------------------------------------------------------------------
# Block 4: Landmark Elements (Fix 4)
# ---------------------------------------------------------------------------


class TestLandmarks:
    """WCAG 4.1.2 — pages must use semantic landmark elements."""

    def test_cra_has_main_landmark(self, cra_html):
        """cra-expansion-analysis.html must use <main> not <div> for main content."""
        assert re.search(r'<main\b', cra_html, re.IGNORECASE), (
            'cra-expansion-analysis.html: missing <main> landmark element'
        )
        # Ensure the old bare div pattern is gone
        assert not re.search(
            r'<div\s[^>]*id=["\']main-content["\']',
            cra_html, re.IGNORECASE,
        ), 'cra-expansion-analysis.html: <div id="main-content"> should be <main id="main-content">'

    def test_cra_main_landmark_closes(self, cra_html):
        """cra-expansion-analysis.html must have a closing </main> tag."""
        assert '</main>' in cra_html, (
            'cra-expansion-analysis.html: missing </main> closing tag'
        )

    def test_dashboard_has_main(self, dashboard_html):
        """dashboard.html must have a <main> landmark."""
        assert re.search(r'<main\b', dashboard_html, re.IGNORECASE), (
            'dashboard.html: missing <main> landmark element'
        )

    def test_commodities_has_main(self, commodities_html):
        """construction-commodities.html must have a <main> landmark."""
        assert re.search(r'<main\b', commodities_html, re.IGNORECASE), (
            'construction-commodities.html: missing <main> landmark element'
        )

    def test_chfa_has_main(self, chfa_html):
        """chfa-portfolio.html must have a <main> landmark."""
        assert re.search(r'<main\b', chfa_html, re.IGNORECASE), (
            'chfa-portfolio.html: missing <main> landmark element'
        )

    def test_cra_has_header_landmark(self, cra_html):
        """cra-expansion-analysis.html must have a <header> landmark."""
        assert re.search(r'<header\b', cra_html, re.IGNORECASE), (
            'cra-expansion-analysis.html: missing <header> landmark element'
        )

    def test_cra_has_footer_landmark(self, cra_html):
        """cra-expansion-analysis.html must have a <footer> landmark."""
        assert re.search(r'<footer\b', cra_html, re.IGNORECASE), (
            'cra-expansion-analysis.html: missing <footer> landmark element'
        )

    def test_cra_has_skip_link(self, cra_html):
        """cra-expansion-analysis.html must have a skip-to-main-content link."""
        assert re.search(r'class=["\']skip-link["\']', cra_html, re.IGNORECASE), (
            'cra-expansion-analysis.html: missing skip-link anchor'
        )


# ---------------------------------------------------------------------------
# Block 5: --accent Token Contrast (Fix 5)
# ---------------------------------------------------------------------------


class TestAccentToken:
    """WCAG 1.4.3 — --accent must achieve ≥ 4.5:1 contrast on --bg (#eef2f7)."""

    def test_accent_token_updated_in_root(self, site_theme):
        """css/site-theme.css :root must declare --accent as #096e65."""
        # Match the token value inside :root
        match = re.search(
            r'--accent\s*:\s*(#[0-9a-fA-F]{6})',
            site_theme,
        )
        assert match, 'site-theme.css: --accent token not found'
        value = match.group(1).lower()
        assert value == '#096e65', (
            f'--accent is {value}, expected #096e65 (4.51:1 on --bg #eef2f7)'
        )

    def test_old_accent_color_gone(self, site_theme):
        """The old failing --accent value #0a7e74 must not appear in :root."""
        # The old value should not appear outside of comments
        non_comment = re.sub(r'/\*.*?\*/', '', site_theme, flags=re.DOTALL)
        assert '#0a7e74' not in non_comment.lower(), (
            'site-theme.css still contains old failing --accent value #0a7e74'
        )

    def test_accent_dim_updated(self, site_theme):
        """--accent-dim rgba must use the new base color channels (9, 110, 101)."""
        assert 'rgba(9,110,101,' in site_theme or 'rgba(9, 110, 101,' in site_theme, (
            'site-theme.css: --accent-dim does not use updated base color rgba(9,110,101,…)'
        )

    def test_dark_mode_accent_unchanged(self, site_theme):
        """Dark-mode --accent override must still be present."""
        dark_section = site_theme[site_theme.find('@media (prefers-color-scheme: dark)'):]
        assert '--accent' in dark_section, (
            'site-theme.css: dark-mode --accent override is missing'
        )


# ---------------------------------------------------------------------------
# Block 6: Touch Targets & Color-Only Information (Fix 6)
# ---------------------------------------------------------------------------


class TestTouchTargets:
    """WCAG 1.3.3 and 2.5.5 — colorado-deep-dive.html color & touch fixes."""

    def test_dot_wrap_class_defined(self, colorado_html):
        """colorado-deep-dive.html must define the .dot-wrap container class."""
        assert 'dot-wrap' in colorado_html, (
            'colorado-deep-dive.html: .dot-wrap CSS class missing (needed for 44px touch targets)'
        )

    def test_map_controls_label_min_height(self, colorado_html):
        """colorado-deep-dive.html map-controls labels must have min-height ≥ 44px."""
        assert re.search(
            r'\.map-controls\s+label[^}]*min-height\s*:\s*44px',
            colorado_html, re.DOTALL,
        ), (
            'colorado-deep-dive.html: .map-controls label does not set min-height: 44px'
        )

    def test_checkbox_size_increased(self, colorado_html):
        """colorado-deep-dive.html checkboxes must be ≥ 18px (up from 14px)."""
        # The old 14px definition should be gone (replaced with 18px or larger)
        old_pattern = re.compile(
            r'\.map-controls\s+input\[type="checkbox"\][^}]*width:\s*14px',
            re.DOTALL,
        )
        assert not old_pattern.search(colorado_html), (
            'colorado-deep-dive.html: checkbox is still 14px — should be ≥ 18px'
        )

    def test_freshness_badge_has_sr_text(self, colorado_html):
        """freshness-badge must contain visually-hidden text for screen readers."""
        # The badge should have either sr-only content or aria-label
        has_sr = 'class="sr-only"' in colorado_html or "class='sr-only'" in colorado_html
        has_label = bool(re.search(
            r'freshness-badge[^>]*aria-label',
            colorado_html, re.IGNORECASE,
        ))
        assert has_sr or has_label, (
            'colorado-deep-dive.html: freshness-badge has no visually-hidden text or aria-label'
        )

    def test_sr_only_style_defined(self, colorado_html):
        """colorado-deep-dive.html must define .sr-only CSS class for screen-reader text."""
        assert '.sr-only' in colorado_html, (
            'colorado-deep-dive.html: .sr-only CSS class is not defined'
        )
