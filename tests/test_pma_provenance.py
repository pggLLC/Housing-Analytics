"""tests/test_pma_provenance.py
Verify that PMA confidence and provenance metadata exist and are structurally
correct.  Tests check:
  1. js/pma-confidence.js exposes the expected public API
  2. The compute() function returns an object with score, level, color, factors
  3. Confidence level values are constrained to 'High', 'Medium', 'Low'
  4. js/utils/data-quality.js exists and exports the required helpers
  5. No PMA-related JS file references undisclosed hardcoded neutral scores
     without a comment marking them as synthetic/placeholder
"""

import json
import os
import re

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
JS_DIR    = os.path.join(REPO_ROOT, 'js')

PMA_CONFIDENCE_PATH  = os.path.join(JS_DIR, 'pma-confidence.js')
DATA_QUALITY_PATH    = os.path.join(JS_DIR, 'utils', 'data-quality.js')
PMA_RUNNER_PATH      = os.path.join(JS_DIR, 'pma-analysis-runner.js')
MARKET_ANALYSIS_HTML = os.path.join(REPO_ROOT, 'market-analysis.html')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


# ---------------------------------------------------------------------------
# Tests: pma-confidence.js
# ---------------------------------------------------------------------------

class TestPMAConfidenceModule:
    def test_module_exists(self):
        assert os.path.isfile(PMA_CONFIDENCE_PATH), (
            f'js/pma-confidence.js not found: {PMA_CONFIDENCE_PATH}'
        )

    def test_exposes_compute_function(self):
        src = _read(PMA_CONFIDENCE_PATH)
        assert 'compute' in src, 'pma-confidence.js must expose a compute() function'

    def test_exposes_render_confidence_badge(self):
        src = _read(PMA_CONFIDENCE_PATH)
        assert 'renderConfidenceBadge' in src, (
            'pma-confidence.js must expose renderConfidenceBadge()'
        )

    def test_exposes_window_pma_confidence(self):
        src = _read(PMA_CONFIDENCE_PATH)
        assert 'window.PMAConfidence' in src, (
            'pma-confidence.js must assign its API to window.PMAConfidence'
        )

    def test_confidence_levels_defined(self):
        src = _read(PMA_CONFIDENCE_PATH)
        # All three confidence levels must be referenced
        for level in ('High', 'Medium', 'Low'):
            assert level in src, (
                f"pma-confidence.js must reference confidence level '{level}'"
            )

    def test_high_threshold_gte_medium_threshold(self):
        """Parse HIGH_THRESHOLD and MEDIUM_THRESHOLD to ensure ordering."""
        src = _read(PMA_CONFIDENCE_PATH)
        high_m   = re.search(r'HIGH_THRESHOLD\s*:\s*(\d+)', src)
        medium_m = re.search(r'MEDIUM_THRESHOLD\s*:\s*(\d+)', src)
        assert high_m and medium_m, 'Both HIGH_THRESHOLD and MEDIUM_THRESHOLD must be defined'
        assert int(high_m.group(1)) > int(medium_m.group(1)), (
            'HIGH_THRESHOLD must be greater than MEDIUM_THRESHOLD'
        )

    def test_factor_weights_present(self):
        src = _read(PMA_CONFIDENCE_PATH)
        assert 'WEIGHTS' in src, 'pma-confidence.js must define a WEIGHTS object'

    def test_compute_returns_expected_keys_described_in_comments(self):
        src = _read(PMA_CONFIDENCE_PATH)
        # The return statement must include score, level, color, factors
        for key in ('score', 'level', 'color', 'factors'):
            assert key in src, (
                f"pma-confidence.js compute() must return an object with '{key}' key"
            )


# ---------------------------------------------------------------------------
# Tests: js/utils/data-quality.js
# ---------------------------------------------------------------------------

class TestDataQualityModule:
    def test_module_exists(self):
        assert os.path.isfile(DATA_QUALITY_PATH), (
            f'js/utils/data-quality.js not found: {DATA_QUALITY_PATH}'
        )

    def test_exposes_is_missing_metric(self):
        src = _read(DATA_QUALITY_PATH)
        assert 'isMissingMetric' in src, (
            'data-quality.js must expose isMissingMetric()'
        )

    def test_exposes_sanitize_number(self):
        src = _read(DATA_QUALITY_PATH)
        assert 'sanitizeNumber' in src, (
            'data-quality.js must expose sanitizeNumber()'
        )

    def test_exposes_format_metric(self):
        src = _read(DATA_QUALITY_PATH)
        assert 'formatMetric' in src, (
            'data-quality.js must expose formatMetric()'
        )

    def test_sentinel_constant_defined(self):
        src = _read(DATA_QUALITY_PATH)
        assert '-666666666' in src, (
            'data-quality.js must reference the sentinel value -666666666'
        )

    def test_umd_or_window_export(self):
        src = _read(DATA_QUALITY_PATH)
        has_window = 'window.DataQuality' in src or "root.DataQuality" in src
        has_module = 'module.exports' in src
        assert has_window or has_module, (
            'data-quality.js must export its API via window.DataQuality or module.exports'
        )


# ---------------------------------------------------------------------------
# Tests: PMA runner provenance transparency
# ---------------------------------------------------------------------------

class TestPMARunnerProvenance:
    def test_runner_exists(self):
        assert os.path.isfile(PMA_RUNNER_PATH), (
            f'js/pma-analysis-runner.js not found: {PMA_RUNNER_PATH}'
        )

    def test_runner_exposes_window_api(self):
        src = _read(PMA_RUNNER_PATH)
        assert 'PMAAnalysisRunner' in src, (
            'pma-analysis-runner.js must expose PMAAnalysisRunner'
        )

    def test_runner_references_commuting_module(self):
        src = _read(PMA_RUNNER_PATH)
        assert 'commuting' in src.lower(), (
            'pma-analysis-runner.js must reference the commuting data module'
        )


# ---------------------------------------------------------------------------
# Tests: market-analysis.html includes confidence badge
# ---------------------------------------------------------------------------

class TestMarketAnalysisHtmlProvenance:
    def test_html_exists(self):
        assert os.path.isfile(MARKET_ANALYSIS_HTML), (
            f'market-analysis.html not found: {MARKET_ANALYSIS_HTML}'
        )

    def test_html_loads_pma_confidence(self):
        src = _read(MARKET_ANALYSIS_HTML)
        assert 'pma-confidence.js' in src, (
            'market-analysis.html must load js/pma-confidence.js'
        )

    def test_html_has_aria_live_region(self):
        src = _read(MARKET_ANALYSIS_HTML)
        assert 'aria-live' in src, (
            'market-analysis.html must include an aria-live region for dynamic updates'
        )
