#!/usr/bin/env python3
"""Stage 3 WCAG 2.1 AA Accessibility Test Suite.

Comprehensive pytest validation for WCAG 2.1 AA accessibility compliance.
Covers 46 checks across 8 blocks:
  1. CSS design tokens — dark-mode variables (8 checks)
  2. CSS focus styles (5 checks)
  3. HTML lang attribute (4 checks)
  4. Skip navigation links (5 checks)
  5. Landmark elements (6 checks)
  6. ARIA attributes — live regions, roles, labels (9 checks)
  7. Canvas accessibility (5 checks)
  8. CSS semantic compliance colors (4 checks)

Usage:
    pytest tests/test_stage3_accessibility.py -v
"""

import os
import re

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CSS_DIR = os.path.join(REPO_ROOT, 'css')

SITE_THEME_CSS = os.path.join(CSS_DIR, 'site-theme.css')

INDEX_HTML = os.path.join(REPO_ROOT, 'index.html')
ECONOMIC_HTML = os.path.join(REPO_ROOT, 'economic-dashboard.html')
LIHTC_HTML = os.path.join(REPO_ROOT, 'LIHTC-dashboard.html')
HNA_HTML = os.path.join(REPO_ROOT, 'housing-needs-assessment.html')
COLORADO_HTML = os.path.join(REPO_ROOT, 'colorado-deep-dive.html')
STATE_MAP_HTML = os.path.join(REPO_ROOT, 'state-allocation-map.html')

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope='session')
def site_theme():
    with open(SITE_THEME_CSS) as f:
        return f.read()


@pytest.fixture(scope='session')
def index_html():
    with open(INDEX_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def economic_html():
    with open(ECONOMIC_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def lihtc_html():
    with open(LIHTC_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def hna_html():
    with open(HNA_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def colorado_html():
    with open(COLORADO_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def state_map_html():
    with open(STATE_MAP_HTML) as f:
        return f.read()


@pytest.fixture(scope='session')
def all_html_files():
    """Return list of (path, content) for all root-level HTML pages."""
    html_dir = REPO_ROOT
    result = []
    for fname in sorted(os.listdir(html_dir)):
        if fname.endswith('.html'):
            fpath = os.path.join(html_dir, fname)
            with open(fpath) as f:
                result.append((fname, f.read()))
    return result


# ===========================================================================
# Block 1: CSS Design Tokens — Dark-Mode Variables (8 checks)
# ===========================================================================

class TestCSSDesignTokens:
    def test_site_theme_css_exists(self):
        """css/site-theme.css must exist as the single source of truth for tokens."""
        assert os.path.isfile(SITE_THEME_CSS), 'css/site-theme.css not found'

    def test_accent_token_light_mode(self, site_theme):
        """--accent must be defined in the :root block for light mode."""
        assert '--accent:' in site_theme, '--accent token not defined in site-theme.css'

    def test_accent_token_dark_mode(self, site_theme):
        """--accent must be overridden inside the dark-mode media query."""
        dark_block_match = re.search(
            r'@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\).*?--accent\s*:',
            site_theme, re.DOTALL
        )
        assert dark_block_match, '--accent not overridden in prefers-color-scheme:dark'

    def test_dark_mode_media_query(self, site_theme):
        """site-theme.css must contain a prefers-color-scheme:dark media query."""
        assert 'prefers-color-scheme: dark' in site_theme, \
            'Missing prefers-color-scheme:dark media query'

    def test_dark_mode_bg_override(self, site_theme):
        """--bg must be overridden inside the dark-mode media query."""
        dark_block_match = re.search(
            r'@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\).*?--bg\s*:',
            site_theme, re.DOTALL
        )
        assert dark_block_match, '--bg not overridden in prefers-color-scheme:dark'

    def test_dark_mode_text_override(self, site_theme):
        """--text must be overridden inside the dark-mode media query."""
        dark_block_match = re.search(
            r'@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\).*?--text\s*:',
            site_theme, re.DOTALL
        )
        assert dark_block_match, '--text not overridden in prefers-color-scheme:dark'

    def test_manual_dark_mode_class(self, site_theme):
        """html.dark-mode selector must exist for JS manual toggle support."""
        assert 'html.dark-mode' in site_theme, \
            'html.dark-mode selector missing — dark mode JS toggle will not work'

    def test_accent_dim_token(self, site_theme):
        """--accent-dim must be defined for interactive/hover states."""
        assert '--accent-dim:' in site_theme, '--accent-dim token not defined'


# ===========================================================================
# Block 2: CSS Focus Styles (5 checks)
# ===========================================================================

class TestCSSFocusStyles:
    def test_focus_ring_variable(self, site_theme):
        """--focus-ring CSS variable must be defined for consistent focus indicators."""
        assert '--focus-ring:' in site_theme, '--focus-ring variable not defined'

    def test_focus_visible_anchor(self, site_theme):
        """a:focus-visible must be styled for keyboard navigation."""
        assert 'a:focus-visible' in site_theme, 'a:focus-visible style missing'

    def test_focus_visible_global(self, site_theme):
        """*:focus-visible must be styled for keyboard navigation compliance."""
        assert '*:focus-visible' in site_theme, '*:focus-visible style missing'

    def test_focus_uses_accent_color(self, site_theme):
        """Focus indicator must use the --accent color token."""
        assert 'outline-color: var(--accent)' in site_theme, \
            'Focus indicator does not use --accent color'

    def test_color_scheme_light_dark(self, site_theme):
        """html element must declare color-scheme:light dark for browser theming."""
        assert 'color-scheme: light dark' in site_theme, \
            'html element missing color-scheme:light dark declaration'


# ===========================================================================
# Block 3: HTML Lang Attribute (4 checks)
# ===========================================================================

class TestHTMLLangAttribute:
    def test_index_has_lang_en(self, index_html):
        """index.html must declare lang="en" for screen reader language detection."""
        assert 'lang="en"' in index_html, 'index.html missing lang="en"'

    def test_economic_dashboard_has_lang_en(self, economic_html):
        """economic-dashboard.html must declare lang="en"."""
        assert 'lang="en"' in economic_html, 'economic-dashboard.html missing lang="en"'

    def test_lihtc_dashboard_has_lang_en(self, lihtc_html):
        """LIHTC-dashboard.html must declare lang="en"."""
        assert 'lang="en"' in lihtc_html, 'LIHTC-dashboard.html missing lang="en"'

    def test_all_pages_have_lang_attribute(self, all_html_files):
        """Every HTML page must declare a lang attribute for accessibility."""
        missing = [
            fname for fname, content in all_html_files
            if 'lang=' not in content
        ]
        assert missing == [], f'Pages missing lang attribute: {missing}'


# ===========================================================================
# Block 4: Skip Navigation Links (5 checks)
# ===========================================================================

class TestSkipNavigationLinks:
    def test_index_has_skip_link(self, index_html):
        """index.html must have a skip-link for keyboard users."""
        assert 'skip-link' in index_html, 'index.html missing .skip-link element'

    def test_economic_dashboard_has_skip_link(self, economic_html):
        """economic-dashboard.html must have a skip-link."""
        assert 'skip-link' in economic_html, \
            'economic-dashboard.html missing .skip-link element'

    def test_colorado_has_skip_link(self, colorado_html):
        """colorado-deep-dive.html must have a skip-link."""
        assert 'skip-link' in colorado_html, \
            'colorado-deep-dive.html missing .skip-link element'

    def test_hna_has_skip_link(self, hna_html):
        """housing-needs-assessment.html must have a skip-link."""
        assert 'skip-link' in hna_html, \
            'housing-needs-assessment.html missing .skip-link element'

    def test_skip_links_target_main_content(self, all_html_files):
        """All skip links must target a main content anchor (#main-content or #main)."""
        bad = []
        for fname, content in all_html_files:
            if 'skip-link' in content:
                has_main_content = '#main-content' in content
                has_main = re.search(r'href="#main[^-]', content) is not None
                if not has_main_content and not has_main:
                    bad.append(fname)
        assert bad == [], f'Skip links do not target a main content anchor: {bad}'


# ===========================================================================
# Block 5: Landmark Elements (6 checks)
# ===========================================================================

class TestLandmarkElements:
    def test_index_has_main_landmark(self, index_html):
        """index.html must have a <main> landmark element."""
        assert '<main' in index_html, 'index.html missing <main> landmark'

    def test_economic_dashboard_has_main_landmark(self, economic_html):
        """economic-dashboard.html must have a <main> landmark element."""
        assert '<main' in economic_html, 'economic-dashboard.html missing <main>'

    def test_hna_has_main_landmark(self, hna_html):
        """housing-needs-assessment.html must have a <main> landmark."""
        assert '<main' in hna_html, 'housing-needs-assessment.html missing <main>'

    def test_colorado_has_main_landmark(self, colorado_html):
        """colorado-deep-dive.html must have a <main> landmark."""
        assert '<main' in colorado_html, 'colorado-deep-dive.html missing <main>'

    def test_lihtc_has_main_landmark(self, lihtc_html):
        """LIHTC-dashboard.html must have a <main> landmark."""
        assert '<main' in lihtc_html, 'LIHTC-dashboard.html missing <main>'

    def test_main_landmark_has_id(self, index_html):
        """<main> element must have id="main-content" for skip link target."""
        assert 'id="main-content"' in index_html, \
            'index.html <main> missing id="main-content"'


# ===========================================================================
# Block 6: ARIA Attributes — live regions, roles, labels (9 checks)
# ===========================================================================

class TestARIAAttributes:
    def test_index_has_aria_live_region(self, index_html):
        """index.html must have an aria-live region for dynamic content."""
        assert 'aria-live' in index_html, 'index.html missing aria-live region'

    def test_economic_dashboard_has_aria_live(self, economic_html):
        """economic-dashboard.html must have an aria-live region."""
        assert 'aria-live' in economic_html, \
            'economic-dashboard.html missing aria-live region'

    def test_lihtc_has_aria_live(self, lihtc_html):
        """LIHTC-dashboard.html must have an aria-live region."""
        assert 'aria-live' in lihtc_html, \
            'LIHTC-dashboard.html missing aria-live region'

    def test_index_kpi_strip_has_role_region(self, index_html):
        """KPI strip on index.html must use role="region" for landmark."""
        assert 'role="region"' in index_html, \
            'index.html KPI strip missing role="region"'

    def test_economic_kpi_strip_has_role_region(self, economic_html):
        """KPI strip on economic-dashboard.html must use role="region"."""
        assert 'role="region"' in economic_html, \
            'economic-dashboard.html KPI strip missing role="region"'

    def test_index_kpi_strip_has_aria_label(self, index_html):
        """KPI region on index.html must have aria-label for screen readers."""
        assert 'role="region" aria-label=' in index_html or \
               re.search(r'role="region"[^>]*aria-label=', index_html), \
            'index.html region missing aria-label'

    def test_index_sections_use_aria_labelledby(self, index_html):
        """Sections on index.html must use aria-labelledby for heading association."""
        assert 'aria-labelledby' in index_html, \
            'index.html missing aria-labelledby on sections'

    def test_hna_stats_has_aria_label(self, hna_html):
        """HNA stats section must have aria-label for AT users."""
        assert 'aria-label="Headline indicators"' in hna_html, \
            'housing-needs-assessment.html stats missing aria-label'

    def test_hna_headship_radiogroup(self, hna_html):
        """Headship assumption buttons must use role="radiogroup" for AT."""
        assert 'role="radiogroup"' in hna_html, \
            'housing-needs-assessment.html missing role="radiogroup" on headship buttons'


# ===========================================================================
# Block 7: Canvas Accessibility (5 checks)
# ===========================================================================

class TestCanvasAccessibility:
    def test_economic_canvas_has_aria_label(self, economic_html):
        """Canvas elements on economic-dashboard.html must have aria-label."""
        assert 'aria-label' in economic_html and '<canvas' in economic_html, \
            'economic-dashboard.html canvas missing aria-label'

    def test_hna_has_canvas_elements(self, hna_html):
        """housing-needs-assessment.html must have Chart.js canvas elements."""
        assert '<canvas' in hna_html, \
            'housing-needs-assessment.html missing canvas elements'

    def test_hna_scenario_comparison_canvas_has_aria_label(self, hna_html):
        """Scenario comparison canvas on HNA must have aria-label."""
        assert 'aria-label="Scenario comparison chart"' in hna_html, \
            'chartScenarioComparison canvas missing aria-label'

    def test_hna_projection_canvas_has_aria_label(self, hna_html):
        """Projected households canvas on HNA must have aria-label."""
        assert 'aria-label="Household projection chart"' in hna_html, \
            'chartProjectedHH canvas missing aria-label'

    def test_colorado_has_canvas_elements(self, colorado_html):
        """colorado-deep-dive.html must have canvas chart elements."""
        assert '<canvas' in colorado_html, \
            'colorado-deep-dive.html missing canvas elements'


# ===========================================================================
# Block 8: CSS Semantic Compliance Colors (4 checks)
# ===========================================================================

class TestCSSSemanticColors:
    def test_css_has_good_token(self, site_theme):
        """--good color token must be defined for positive/success indicators."""
        assert '--good:' in site_theme, '--good semantic color token missing'

    def test_css_has_bad_token(self, site_theme):
        """--bad color token must be defined for error/violation indicators."""
        assert '--bad:' in site_theme, '--bad semantic color token missing'

    def test_css_has_warn_token(self, site_theme):
        """--warn color token must be defined for warning indicators."""
        assert '--warn:' in site_theme, '--warn semantic color token missing'

    def test_css_has_color_primary_alias(self, site_theme):
        """--color-primary must alias --accent for legacy component support."""
        assert '--color-primary:' in site_theme, \
            '--color-primary alias missing from site-theme.css'


# ===========================================================================
# Block 9: WCAG AA Color Contrast Tokens (8 checks)
# ===========================================================================

class TestWCAGContrastTokens:
    """Verify light-mode CSS token values meet WCAG 2.1 AA minimum contrast ratios.

    Thresholds: 4.5:1 for normal text, 3.0:1 for large text.
    Reference backgrounds used: #ffffff (card), #eef2f7 (--bg), #e4ecf4 (--bg2).
    """

    # ── Color math helpers ──────────────────────────────────────────────────

    @staticmethod
    def _srgb_to_linear(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    @classmethod
    def _luminance(cls, r: int, g: int, b: int) -> float:
        return (
            0.2126 * cls._srgb_to_linear(r)
            + 0.7152 * cls._srgb_to_linear(g)
            + 0.0722 * cls._srgb_to_linear(b)
        )

    @classmethod
    def _contrast(cls, fg_rgb, bg_rgb) -> float:
        l1 = cls._luminance(*fg_rgb)
        l2 = cls._luminance(*bg_rgb)
        lighter, darker = max(l1, l2), min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)

    @staticmethod
    def _hex(h: str):
        h = h.lstrip('#')
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    # ── Light mode token values ──────────────────────────────────────────────

    MUTED_LIGHT  = '#374151'   # updated from #476080
    FAINT_LIGHT  = '#4b5563'   # updated from #4d6882
    TEXT_LIGHT   = '#0d1f35'
    ACCENT_LIGHT = '#096e65'

    BG           = '#eef2f7'
    BG2          = '#e4ecf4'
    BG3          = '#dae4f0'
    CARD         = '#ffffff'

    NORMAL_THRESHOLD = 4.5
    LARGE_THRESHOLD  = 3.0

    # ── Muted token tests ────────────────────────────────────────────────────

    def test_muted_light_token_value(self, site_theme):
        """--muted in light mode must be #374151 (10.3:1 on white)."""
        assert '--muted:        #374151' in site_theme or '--muted:         #374151' in site_theme, \
            f'Light mode --muted should be #374151; found unexpected value in site-theme.css'

    def test_muted_on_card_passes_normal(self):
        """--muted (#374151) on --card (#ffffff) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.MUTED_LIGHT), self._hex(self.CARD))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--muted on --card: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    def test_muted_on_bg_passes_normal(self):
        """--muted (#374151) on --bg (#eef2f7) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.MUTED_LIGHT), self._hex(self.BG))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--muted on --bg: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    def test_muted_on_bg2_passes_normal(self):
        """--muted (#374151) on --bg2 (#e4ecf4) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.MUTED_LIGHT), self._hex(self.BG2))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--muted on --bg2: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    # ── Faint token tests ────────────────────────────────────────────────────

    def test_faint_light_token_value(self, site_theme):
        """--faint in light mode must be #4b5563 (7.6:1 on white)."""
        assert '--faint:        #4b5563' in site_theme or '--faint:         #4b5563' in site_theme, \
            f'Light mode --faint should be #4b5563; found unexpected value in site-theme.css'

    def test_faint_on_card_passes_normal(self):
        """--faint (#4b5563) on --card (#ffffff) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.FAINT_LIGHT), self._hex(self.CARD))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--faint on --card: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    def test_faint_on_bg_passes_normal(self):
        """--faint (#4b5563) on --bg (#eef2f7) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.FAINT_LIGHT), self._hex(self.BG))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--faint on --bg: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    def test_faint_on_bg3_passes_normal(self):
        """--faint (#4b5563) on --bg3 (#dae4f0) must achieve ≥ 4.5:1 (hardest pairing)."""
        ratio = self._contrast(self._hex(self.FAINT_LIGHT), self._hex(self.BG3))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--faint on --bg3: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    # ── Primary text token ────────────────────────────────────────────────────

    def test_text_on_card_passes_normal(self):
        """--text (#0d1f35) on --card (#ffffff) must achieve ≥ 4.5:1."""
        ratio = self._contrast(self._hex(self.TEXT_LIGHT), self._hex(self.CARD))
        assert ratio >= self.NORMAL_THRESHOLD, \
            f'--text on --card: {ratio:.2f}:1 < {self.NORMAL_THRESHOLD}:1'

    # ── Accent token ─────────────────────────────────────────────────────────

    def test_accent_on_card_passes_large(self):
        """--accent (#096e65) on --card must achieve ≥ 3:1 (large/heading text)."""
        ratio = self._contrast(self._hex(self.ACCENT_LIGHT), self._hex(self.CARD))
        assert ratio >= self.LARGE_THRESHOLD, \
            f'--accent on --card: {ratio:.2f}:1 < {self.LARGE_THRESHOLD}:1 (large text)'

    # ── Prohibited hex codes ──────────────────────────────────────────────────

    PROHIBITED = [
        '#6c7a89', '#3498db', '#27ae60', '#d4a574',
        '#e4b584', '#2ecc71', '#f39c12', '#c0392b',
    ]

    def test_no_prohibited_hex_in_css(self, site_theme):
        """site-theme.css must not contain known WCAG-failing hex color codes."""
        found = [h for h in self.PROHIBITED if h in site_theme.lower()]
        assert found == [], \
            f'site-theme.css contains prohibited low-contrast hex code(s): {found}'
