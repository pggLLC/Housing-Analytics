"""
tests/test_gtfs_transit_fallback.py

When the Mobility Database catalog fetch fails, fetch_gtfs_transit.py must
leave the committed transit_routes_co.geojson exactly as it is.

It used to log "[fallback] Using existing transit_routes_co.geojson", set
`result = existing`, and then overwrite result["features"] with the empty
fetch list during dedup, so a catalog outage committed a transit layer with
zero routes and exit code 0. Rewriting the file at all is also unsafe: the
workflow simplifies the file whenever its bytes change, and simplifying an
already-simplified file compounds (the tract-boundary damage fixed in #1990).
"""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "market" / "fetch_gtfs_transit.py"


def load_module():
    spec = importlib.util.spec_from_file_location("fetch_gtfs_transit_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FIXTURE = (
    '{"type":"FeatureCollection","meta":{"feature_count":2},"features":['
    '{"type":"Feature","properties":{"agency":"A","route_type":3,"shape_id":"s1"},'
    '"geometry":{"type":"LineString","coordinates":[[-104.99,39.74],[-104.98,39.75]]}},'
    '{"type":"Feature","properties":{"agency":"B","route_type":3,"shape_id":"s2"},'
    '"geometry":{"type":"LineString","coordinates":[[-105.27,40.01],[-105.26,40.02]]}}]}'
)


def run_with_failed_catalog(tmp_path, monkeypatch, initial):
    mod = load_module()
    out = tmp_path / "transit_routes_co.geojson"
    if initial is not None:
        out.write_text(initial)
    monkeypatch.setattr(mod, "OUT_FILE", out)

    def boom(use_cache=False):
        raise RuntimeError("simulated catalog outage")

    monkeypatch.setattr(mod, "fetch_mdb_catalog", boom)
    monkeypatch.setattr(sys, "argv", ["fetch_gtfs_transit.py"])
    return mod.main(), out


def test_catalog_outage_keeps_committed_routes_byte_for_byte(tmp_path, monkeypatch):
    code, out = run_with_failed_catalog(tmp_path, monkeypatch, FIXTURE)
    assert code == 0
    assert out.read_text() == FIXTURE, (
        "a failed catalog fetch rewrote the committed transit file; "
        "it must be left untouched so no routes are lost and no simplify pass runs"
    )


def test_outage_with_no_committed_file_still_writes_a_valid_empty_layer(tmp_path, monkeypatch):
    # Nothing to preserve: the old behaviour (an empty FeatureCollection) is right here.
    import json
    code, out = run_with_failed_catalog(tmp_path, monkeypatch, None)
    assert code == 0
    data = json.loads(out.read_text())
    assert data["type"] == "FeatureCollection" and data["features"] == []
