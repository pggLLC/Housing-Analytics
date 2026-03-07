#!/usr/bin/env python3
"""Unit tests for scripts/boundaries/build_counties_co.py.

Tests the resilience improvements:
  - ArcGIS error response detection in fetch_all_pages
  - WHERE-clause fallback candidates
  - Cached file preservation when API returns 0 features

Usage
-----
    python test/build_counties_co_test.py
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import types
import unittest.mock as mock
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup — allow running from the repo root or from test/
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ---------------------------------------------------------------------------
# Mini test harness
# ---------------------------------------------------------------------------

_passed = 0
_failed = 0


def _assert(condition: bool, message: str) -> None:
    global _passed, _failed
    if condition:
        print(f"  ✅ PASS: {message}")
        _passed += 1
    else:
        print(f"  ❌ FAIL: {message}", file=sys.stderr)
        _failed += 1


def _test(name: str, fn) -> None:
    print(f"\n[test] {name}")
    try:
        fn()
    except Exception as exc:
        global _failed
        print(f"  ❌ FAIL: threw unexpected error — {exc}", file=sys.stderr)
        _failed += 1


# ---------------------------------------------------------------------------
# Load module under test
# ---------------------------------------------------------------------------

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "build_counties_co",
    os.path.join(_ROOT, "scripts", "boundaries", "build_counties_co.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

fetch_all_pages = _mod.fetch_all_pages
build_geojson   = _mod.build_geojson
WHERE_CANDIDATES = _mod.WHERE_CANDIDATES
EXPECTED         = _mod.EXPECTED
STATE_FIPS       = _mod.STATE_FIPS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_feature(name: str) -> dict:
    """Return a minimal GeoJSON Feature that mimics a TIGERweb county record."""
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [[]]},
        "properties": {"NAME": name, "GEOID": f"08{name[:3].upper()}"},
    }


def _geojson_page(features: list[dict], extra: dict | None = None) -> dict:
    """Return a minimal GeoJSON FeatureCollection page."""
    page: dict = {"type": "FeatureCollection", "features": features}
    if extra:
        page.update(extra)
    return page


# ---------------------------------------------------------------------------
# Tests: WHERE_CANDIDATES constant
# ---------------------------------------------------------------------------

def test_where_candidates_includes_statefp():
    _assert(
        any("STATEFP" in c for c in WHERE_CANDIDATES),
        "WHERE_CANDIDATES includes a STATEFP filter",
    )


def test_where_candidates_includes_state_fallback():
    _assert(
        any("STATE=" in c for c in WHERE_CANDIDATES),
        "WHERE_CANDIDATES includes a STATE= fallback",
    )


def test_where_candidates_includes_geoid_fallback():
    _assert(
        any("GEOID" in c for c in WHERE_CANDIDATES),
        "WHERE_CANDIDATES includes a GEOID LIKE fallback",
    )


def test_where_candidates_all_reference_state_fips():
    for candidate in WHERE_CANDIDATES:
        _assert(
            STATE_FIPS in candidate,
            f"Candidate '{candidate}' references STATE_FIPS '{STATE_FIPS}'",
        )


# ---------------------------------------------------------------------------
# Tests: fetch_all_pages — ArcGIS error detection
# ---------------------------------------------------------------------------

def test_fetch_all_pages_raises_on_arcgis_error():
    """fetch_all_pages must raise RuntimeError when response contains 'error' key."""
    error_response = {"error": {"code": 400, "message": "Unable to complete operation."}}

    with mock.patch.object(_mod, "http_get_json", return_value=error_response):
        try:
            fetch_all_pages("http://example.com", {"where": "STATEFP='08'"})
            _assert(False, "RuntimeError was raised for ArcGIS error response")
        except RuntimeError as exc:
            _assert("ArcGIS error" in str(exc), "error message mentions 'ArcGIS error'")
            _assert("400" in str(exc), "error message includes the ArcGIS error code")


def test_fetch_all_pages_raises_with_error_message():
    """RuntimeError text includes the server-supplied message."""
    error_response = {"error": {"code": 999, "message": "Field does not exist."}}

    with mock.patch.object(_mod, "http_get_json", return_value=error_response):
        try:
            fetch_all_pages("http://example.com", {"where": "BADFIELD='08'"})
            _assert(False, "RuntimeError was raised")
        except RuntimeError as exc:
            _assert(
                "Field does not exist" in str(exc),
                "error includes server-supplied message",
            )


def test_fetch_all_pages_single_page_success():
    """fetch_all_pages returns features from a single-page (non-paginated) response."""
    features = [_make_feature("Adams"), _make_feature("Arapahoe")]
    # Fewer features than PAGE_SIZE → no additional pages
    page = _geojson_page(features)

    with mock.patch.object(_mod, "http_get_json", return_value=page):
        result = fetch_all_pages("http://example.com", {"where": "STATEFP='08'"})

    _assert(len(result) == 2, "returns 2 features from single-page response")


# ---------------------------------------------------------------------------
# Tests: build_geojson
# ---------------------------------------------------------------------------

def test_build_geojson_structure():
    features = [_make_feature("Adams")]
    gj = build_geojson(features, "2026-01-01T00:00:00Z")
    _assert(gj["type"] == "FeatureCollection", "type is FeatureCollection")
    _assert("meta" in gj, "meta key is present")
    _assert(gj["meta"]["state_fips"] == STATE_FIPS, "meta.state_fips matches STATE_FIPS")
    _assert(gj["features"] is features, "features list is the same object passed in")


# ---------------------------------------------------------------------------
# Tests: main() — cached file preservation when API returns 0 features
# ---------------------------------------------------------------------------

def test_main_preserves_cache_on_zero_features():
    """main() must exit 0 (not 1) when API returns 0 features but cache exists."""
    dummy_geojson = json.dumps({"type": "FeatureCollection", "features": []})

    with tempfile.TemporaryDirectory() as tmpdir:
        # Create dummy cached output files
        boundaries_path = Path(tmpdir) / "co-county-boundaries.json"
        counties_path   = Path(tmpdir) / "boundaries" / "counties_co.geojson"
        counties_path.parent.mkdir(parents=True)
        boundaries_path.write_text(dummy_geojson)
        counties_path.write_text(dummy_geojson)

        # Patch the module's output paths and http_get_json to return 0 features
        empty_page = _geojson_page([])
        with (
            mock.patch.object(_mod, "OUT_BOUNDARIES", boundaries_path),
            mock.patch.object(_mod, "OUT_COUNTIES_CO", counties_path),
            mock.patch.object(_mod, "http_get_json", return_value=empty_page),
        ):
            exit_code = _mod.main()

    _assert(exit_code == 0, "main() exits 0 when cache exists and API returns 0 features")


def test_main_fails_on_zero_features_without_cache():
    """main() must exit 1 when API returns 0 features AND no cache exists."""
    empty_page = _geojson_page([])

    with tempfile.TemporaryDirectory() as tmpdir:
        missing_boundaries = Path(tmpdir) / "co-county-boundaries.json"
        missing_counties   = Path(tmpdir) / "boundaries" / "counties_co.geojson"
        # Do NOT create the files — they should not exist

        with (
            mock.patch.object(_mod, "OUT_BOUNDARIES", missing_boundaries),
            mock.patch.object(_mod, "OUT_COUNTIES_CO", missing_counties),
            mock.patch.object(_mod, "http_get_json", return_value=empty_page),
        ):
            exit_code = _mod.main()

    _assert(exit_code == 1, "main() exits 1 when cache is absent and API returns 0 features")


def test_main_writes_files_on_success():
    """main() writes both output files when features are returned."""
    features = [_make_feature(f"County{i}") for i in range(EXPECTED)]
    page = _geojson_page(features)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        boundaries_path = tmppath / "co-county-boundaries.json"
        counties_path   = tmppath / "boundaries" / "counties_co.geojson"

        with (
            mock.patch.object(_mod, "ROOT", tmppath),
            mock.patch.object(_mod, "OUT_BOUNDARIES", boundaries_path),
            mock.patch.object(_mod, "OUT_COUNTIES_CO", counties_path),
            mock.patch.object(_mod, "http_get_json", return_value=page),
        ):
            exit_code = _mod.main()

        # Assertions inside the tempdir context so files still exist
        _assert(exit_code == 0, "main() exits 0 when features are returned")
        _assert(boundaries_path.exists(), "co-county-boundaries.json was written")
        _assert(counties_path.exists(), "counties_co.geojson was written")

        written = json.loads(boundaries_path.read_text())
        _assert(written["type"] == "FeatureCollection", "output is a FeatureCollection")
        _assert(len(written["features"]) == EXPECTED, f"output has {EXPECTED} features")


# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

_test("WHERE_CANDIDATES includes STATEFP",        test_where_candidates_includes_statefp)
_test("WHERE_CANDIDATES includes STATE= fallback", test_where_candidates_includes_state_fallback)
_test("WHERE_CANDIDATES includes GEOID fallback",  test_where_candidates_includes_geoid_fallback)
_test("WHERE_CANDIDATES all reference STATE_FIPS", test_where_candidates_all_reference_state_fips)

_test("fetch_all_pages raises on ArcGIS error response",   test_fetch_all_pages_raises_on_arcgis_error)
_test("fetch_all_pages includes server message in error",   test_fetch_all_pages_raises_with_error_message)
_test("fetch_all_pages returns features from single page",  test_fetch_all_pages_single_page_success)

_test("build_geojson produces correct structure", test_build_geojson_structure)

_test("main exits 0 when cache exists and API returns 0", test_main_preserves_cache_on_zero_features)
_test("main exits 1 when no cache and API returns 0",     test_main_fails_on_zero_features_without_cache)
_test("main writes both output files on success",         test_main_writes_files_on_success)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print("\n" + "=" * 60)
print(f"Results: {_passed} passed, {_failed} failed")
if _failed > 0:
    print("\nSome tests failed.", file=sys.stderr)
    sys.exit(1)
else:
    print("\nAll tests passed ✅")
