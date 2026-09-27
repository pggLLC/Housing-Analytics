"""School transport cannot enter transit data/scoring; bus depots are not schools.

Runs in ci:part-4 via test:transit-stops-consumers, as well as the Python suite.
Published-data assertions deliberately do not call the production classifier.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from lib import transit_stops


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


OSM = module("school_osm", "scripts/amenities/build_osm_amenities.py")
STATE = module("school_state", "scripts/market/build_transit_stops_co.py")

SCHOOL_CASES = [
    ({"name": "BVSD school bus stop"}, "school_bus_name"),
    ({"name": "SCHOOL-BUS stop"}, "school_bus_name"),
    ({"bus": "school"}, "tag:bus"),
    ({"school_bus": "yes"}, "tag:school_bus"),
    ({"bus:school": "designated"}, "tag:bus:school"),
    ({"route": "school_bus"}, "tag:route"),
    ({"route": "school"}, "tag:route"),
    ({"network": "School Transport"}, "tag:network"),
    ({"network": "BVSD School Bus Network"}, "tag:network"),
    ({"route": "District School Service"}, "tag:route"),
    ({"service": "school_service"}, "tag:service"),
    ({"route": "bus;school_bus"}, "tag:route"),
]


def element(eid, tags):
    return {"type": "node", "id": eid, "lat": 39.7392, "lon": -104.9903,
            "tags": {"name": "Town Hall", "highway": "bus_stop", **tags}}


@pytest.mark.parametrize("tags,reason", SCHOOL_CASES)
def test_live_osm_builder_drops_and_counts(tmp_path, monkeypatch, tags, reason):
    monkeypatch.setattr(OSM, "overpass_query", lambda _: {
        "elements": [element(1, tags), element(2, {"name": "High School & Main"}), element(1, tags)]})
    assert OSM.build_category("transit_stops", OSM.CATEGORIES["transit_stops"], tmp_path)
    doc = json.loads((tmp_path / "transit_stops_co.geojson").read_text())
    assert [f["properties"]["name"] for f in doc["features"]] == ["High School & Main"]
    assert doc["meta"]["count"] == 1
    assert doc["meta"]["dropped"] == {
        "count": 1, "by_reason": {reason: 1},
        "rows": [{"osm_id": 1, "name": tags.get("name", "Town Hall"), "reason": reason}],
    }


@pytest.mark.parametrize("tags,reason", SCHOOL_CASES)
def test_statewide_builder_checks_unfiltered_osm_input(tmp_path, monkeypatch, tags, reason):
    """Exercise file loading, merge, and both real output writers with raw tags."""
    source = tmp_path / "osm.geojson"
    source.write_text(json.dumps(OSM.osm_to_geojson({"elements": [element(1, tags)]})))
    monkeypatch.setattr(STATE, "OSM_STOPS", source)
    monkeypatch.setattr(STATE, "OUT_STOPS", tmp_path / "statewide.geojson")
    monkeypatch.setattr(STATE, "OUT_REPORT", tmp_path / "coverage.json")
    monkeypatch.setattr(STATE, "ROOT", tmp_path)
    monkeypatch.setattr(STATE, "fetch_cdot", lambda: [{
        "name": "Rubey Park", "agency": "RFTA", "lon": -106.8175, "lat": 39.1911}])
    monkeypatch.setattr(STATE, "fetch_feed_stops", lambda: ([], []))
    monkeypatch.setattr(sys, "argv", ["build_transit_stops_co.py"])
    assert STATE.main() == 0
    doc = json.loads(STATE.OUT_STOPS.read_text())
    report = json.loads(STATE.OUT_REPORT.read_text())
    assert [f["properties"]["name"] for f in doc["features"]] == ["Rubey Park"]
    assert doc["meta"]["dropped_osm_school_transport"]["by_reason"] == {reason: 1}
    assert doc["meta"]["dropped_osm_school_transport"]["count"] == 1
    assert doc["meta"]["dropped_osm_school_transport"] == report["meta"]["dropped_osm_school_transport"]
    assert doc["meta"]["totals"] == report["totals"]


@pytest.mark.parametrize("tags,reason", SCHOOL_CASES)
def test_selection_also_rejects_school_transport(tags, reason):
    for props in (tags, {"tags": tags}):
        assert transit_stops.school_transport_reason(props) == reason
        assert not transit_stops.is_osm_fallback({**props, "reliability": "unconfirmed"})
        assert not transit_stops.counts_as_confirmed({**props, "reliability": "confirmed"})


@pytest.mark.parametrize("name", ["High School & Main", "School Road", "Schoolhouse Road", "Bus Station"])
def test_public_stops_near_schools_remain(name):
    props = {"name": name, "bus": "yes", "school_bus": "no", "route": "bus", "network": "RTD"}
    kept, dropped = transit_stops.exclude_school_transport([props])
    assert kept == [props]
    assert dropped["count"] == 0
    assert transit_stops.is_osm_fallback({**props, "reliability": "unconfirmed"})


def test_schools_builder_removes_garages_not_schools(tmp_path, monkeypatch):
    names = ["Eads School Bus Garage", "District BUS DEPOT", "Town Bus-Garage", "Eads High School"]
    monkeypatch.setattr(OSM, "overpass_query", lambda _: {
        "elements": [element(i, {"name": n, "amenity": "school"}) for i, n in enumerate(names)]})
    assert OSM.build_category("schools", OSM.CATEGORIES["schools"], tmp_path)
    doc = json.loads((tmp_path / "schools_co.geojson").read_text())
    assert [f["properties"]["name"] for f in doc["features"]] == ["Eads High School"]
    assert doc["meta"]["count"] == 1
    assert doc["meta"]["dropped"]["by_reason"] == {"bus_garage_depot_name": 3}


@pytest.mark.parametrize("category,name", [("schools", "Eads School Bus Garage"),
                                           ("transit_stops", "School Bus Stop")])
def test_cached_source_filter_is_idempotent(tmp_path, category, name):
    doc = OSM.osm_to_geojson({"elements": [element(1, {"name": name}), element(2, {"name": "Main"})]})
    doc["meta"] = {"generated": "original-source-date", "count": 2}
    path = tmp_path / OSM.CATEGORIES[category]["output"]
    path.write_text(json.dumps(doc))
    for _ in range(2):
        OSM.filter_cached_category(category, OSM.CATEGORIES[category], tmp_path)
        corrected = json.loads(path.read_text())
        assert corrected["meta"]["generated"] == "original-source-date"
        assert corrected["meta"]["dropped"]["count"] == 1
        assert len(corrected["features"]) == 1


def test_cached_statewide_filter_preserves_confirmed_and_coverage(tmp_path, monkeypatch):
    monkeypatch.setattr(STATE, "OUT_STOPS", tmp_path / "statewide.geojson")
    monkeypatch.setattr(STATE, "OUT_REPORT", tmp_path / "coverage.json")
    stops = json.loads((ROOT / "data/amenities/transit_stops_statewide_co.geojson").read_text())
    report = json.loads((ROOT / "data/market/transit_stops_coverage_co.json").read_text())
    confirmed = [f for f in stops["features"] if f["properties"]["sources"] != ["osm"]]
    # Inject a tag-only school stop, independent of the committed exclusions.
    stops["features"].append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [-104.99, 39.739]},
                              "properties": {"name": "Fixture", "sources": ["osm"], "school_bus": "yes"}})
    STATE.OUT_STOPS.write_text(json.dumps(stops))
    STATE.OUT_REPORT.write_text(json.dumps(report))
    assert STATE.filter_cached() == 0
    first = STATE.OUT_STOPS.read_bytes(), STATE.OUT_REPORT.read_bytes()
    assert STATE.filter_cached() == 0
    assert first == (STATE.OUT_STOPS.read_bytes(), STATE.OUT_REPORT.read_bytes())
    fresh = json.loads(first[0])
    fresh_report = json.loads(first[1])
    assert [f for f in fresh["features"] if f["properties"]["sources"] != ["osm"]] == confirmed
    assert fresh["meta"]["generated"] == stops["meta"]["generated"]
    assert fresh_report["cdot_gaps"] == report["cdot_gaps"]
    assert fresh["meta"]["totals"] == fresh_report["totals"]
    assert fresh["meta"]["dropped_osm_school_transport"]["by_reason"]["tag:school_bus"] == 1


def assert_public_stop(props):
    """Independent scan of the published contract, including flattened/nested tags."""
    assert not re.search(r"\bschool[\s_-]+bus\b", props.get("name") or "", re.I), props
    tags = {**props, **(props.get("tags") or {})}
    for key in ("school_bus", "bus:school"):
        assert str(tags.get(key, "")).strip().lower() not in ("yes", "true", "1", "designated", "only"), props
    for key in ("bus", "route", "network", "service"):
        values = str(tags.get(key, "")).lower().replace("_", " ").replace("-", " ").split(";")
        assert not any(" ".join(v.split()) == "school"
                       or re.search(r"\bschool (bus|transport|service)\b", " ".join(v.split()))
                       for v in values), props


@pytest.mark.parametrize("relative", ["data/amenities/transit_stops_co.geojson",
                                      "data/amenities/transit_stops_statewide_co.geojson",
                                      "data/derived/market-analysis/neighborhood_access.json"])
def test_published_transit_has_no_school_transport(relative):
    doc = json.loads((ROOT / relative).read_text())
    records = ([f["properties"] for f in doc["features"]] if "features" in doc
               else [r for r in doc["amenities"] if r["type"] == "transit_stop"])
    assert records, f"no transit records scanned in {relative}"
    for props in records:
        assert_public_stop(props)


@pytest.mark.parametrize("relative", ["data/amenities/schools_co.geojson",
                                      "data/derived/market-analysis/neighborhood_access.json"])
def test_published_schools_have_no_bus_garages(relative):
    doc = json.loads((ROOT / relative).read_text())
    records = ([f["properties"] for f in doc["features"]] if "features" in doc
               else [r for r in doc["amenities"] if r["type"] == "school"])
    assert records, f"no schools scanned in {relative}"
    for props in records:
        assert not re.search(r"\bbus[\s_-]+(?:garage|depot)\b", props.get("name") or "", re.I), props
