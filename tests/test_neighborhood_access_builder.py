"""
tests/test_neighborhood_access_builder.py

scripts/market-analysis/build_neighborhood_access.py must reproduce the
committed data/derived/market-analysis/neighborhood_access.json.

Until 2026-09 it could not: hospital and childcare records had been appended
to the committed file by hand, and the builder's source map never listed
them, so a rerun would have silently dropped 2,860 childcare and 121 hospital
records that OsmAmenities.getAccessScore() scores in site selection.

Every type list here is derived — from GEOJSON_SOURCES, from the committed
file, and from the JS connector's SCORE_KEY_TO_TYPE (the map getAccessScore()
iterates; AMENITY_TYPES is not read at runtime) — never hardcoded.
"""

import collections
import importlib.util
import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILDER = REPO_ROOT / "scripts" / "market-analysis" / "build_neighborhood_access.py"
COMMITTED = REPO_ROOT / "data" / "derived" / "market-analysis" / "neighborhood_access.json"
CONNECTOR = REPO_ROOT / "js" / "data-connectors" / "osm-amenities.js"


def _load_builder():
    spec = importlib.util.spec_from_file_location("build_neighborhood_access", BUILDER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def builder():
    return _load_builder()


@pytest.fixture(scope="module")
def committed():
    return json.loads(COMMITTED.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rebuilt(builder, tmp_path_factory):
    out = tmp_path_factory.mktemp("neighborhood_access") / "neighborhood_access.json"
    builder.build(out)
    return json.loads(out.read_text(encoding="utf-8"))


def _type_counts(doc):
    return collections.Counter(a["type"] for a in doc["amenities"])


def test_every_committed_type_is_a_builder_source(builder, committed):
    source_types = set(builder.GEOJSON_SOURCES.values())
    committed_types = set(_type_counts(committed))
    assert committed_types, "committed file has no amenity records to check"
    missing = committed_types - source_types
    assert not missing, (
        f"committed neighborhood_access.json has types {sorted(missing)} that no "
        "GEOJSON_SOURCES entry produces — a rerun would drop them"
    )


def test_every_connector_type_is_a_builder_source(builder):
    """Every type OsmAmenities scores must be something the builder writes."""
    m = re.search(r"var SCORE_KEY_TO_TYPE\s*=\s*\{([^}]*)\}", CONNECTOR.read_text(encoding="utf-8"))
    assert m, "SCORE_KEY_TO_TYPE not found in osm-amenities.js"
    connector_types = set(re.findall(r":\s*'([a-z_]+)'", m.group(1)))
    assert connector_types, "SCORE_KEY_TO_TYPE parsed empty"
    missing = connector_types - set(builder.GEOJSON_SOURCES.values())
    assert not missing, f"OsmAmenities scores {sorted(missing)} but the builder never produces them"


def test_every_source_file_exists(builder):
    for rel_path in builder.GEOJSON_SOURCES:
        assert (REPO_ROOT / rel_path).is_file(), f"{rel_path} is listed in GEOJSON_SOURCES but missing"


def test_rebuild_reproduces_committed_counts_per_type(committed, rebuilt):
    assert _type_counts(rebuilt) == _type_counts(committed)


def test_rebuild_reproduces_committed_records(committed, rebuilt):
    assert rebuilt["amenities"] == committed["amenities"]
    assert rebuilt["meta"]["record_count"] == len(committed["amenities"])
    assert committed["meta"]["record_count"] == len(committed["amenities"])
