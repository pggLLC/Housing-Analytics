"""
tests/test_transit_stop_selection.py

Both transit amenity builders must count exactly the stops the statewide stop
file's OWN fields define (owner decision 2026-09-27):

    counted  = reliability "confirmed", operator not "private_shuttle",
               service not "demand_response"   (CDOT-only stops included)
    fallback = reliability "unconfirmed" (OpenStreetMap only), same exclusions,
               used only where no counted stop is within the builder's radius

The expected sets are computed here from the file, independently of
scripts/lib/transit_stops.py — never a hard-coded count — and compared with
what each builder actually selected and wrote:

  * scripts/hna/build_ranking_index.py        -> amenity_access_score and
                                                 metrics.transit_stop_basis
  * scripts/market-analysis/build_neighborhood_access.py
                                              -> transit_stop records and
                                                 meta.transit

A builder that reads the old OpenStreetMap-only file, lets OpenStreetMap-only
stops in where a confirmed stop is in range, drops CDOT-only stops, counts
private shuttles or demand-response stops, scores a fallback place 0, or
flags a basis other than the stops it used, fails here.
"""

import collections
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
STOPS_REL = "data/amenities/transit_stops_statewide_co.geojson"
STOPS = REPO_ROOT / STOPS_REL
INDEX = REPO_ROOT / "data" / "hna" / "ranking-index.json"
NEIGHBORHOOD = REPO_ROOT / "data" / "derived" / "market-analysis" / "neighborhood_access.json"
CENTROIDS = REPO_ROOT / "data" / "co-place-centroids.json"
CONNECTOR = REPO_ROOT / "js" / "data-connectors" / "osm-amenities.js"
TRANSIT_ZONE_JS = REPO_ROOT / "js" / "transit-zone.js"
RANKING_BUILDER = REPO_ROOT / "scripts" / "hna" / "build_ranking_index.py"
NEIGHBORHOOD_BUILDER = REPO_ROOT / "scripts" / "market-analysis" / "build_neighborhood_access.py"
HELPER = REPO_ROOT / "scripts" / "lib" / "transit_stops.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# ── The file's own definition, computed here ────────────────────────────────

def _expected(features):
    counted, fallback = [], []
    for f in features:
        p = f["properties"]
        if p.get("operator") == "private_shuttle" or p.get("service") == "demand_response":
            continue
        if p.get("reliability") == "confirmed":
            counted.append(f)
        elif p.get("reliability") == "unconfirmed":
            fallback.append(f)
    return counted, fallback


def _latlon(features):
    return sorted((f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for f in features)


def _miles(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 3958.8 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _basis(lat, lon, radius, counted, fallback, rnd):
    dist = (lambda a, b: round(_miles(lat, lon, a, b), 4)) if rnd else (lambda a, b: _miles(lat, lon, a, b))
    if any(dist(a, b) <= radius for a, b in counted):
        return "confirmed"
    if any(dist(a, b) <= radius for a, b in fallback):
        return "openstreetmap_unconfirmed"
    return "none"


@pytest.fixture(scope="module")
def stops_doc():
    return _json(STOPS)


@pytest.fixture(scope="module")
def expected(stops_doc):
    counted, fallback = _expected(stops_doc["features"])
    return {"counted": counted, "fallback": fallback,
            "counted_pts": _latlon(counted), "fallback_pts": _latlon(fallback)}


@pytest.fixture(scope="module")
def ranking():
    return _load(RANKING_BUILDER, "build_ranking_index_stop_selection")


@pytest.fixture(scope="module")
def neighborhood():
    return _load(NEIGHBORHOOD_BUILDER, "build_neighborhood_access_stop_selection")


@pytest.fixture(scope="module")
def centroids():
    return {str(g).zfill(7): c for g, c in _json(CENTROIDS)["byGeoid"].items()}


# ── The file really exercises every rule (non-vacuity on the scan) ──────────

def test_the_stop_file_exercises_every_class(stops_doc, expected):
    feats = stops_doc["features"]
    props = [f["properties"] for f in feats]
    assert {p["reliability"] for p in props} <= {"confirmed", "unconfirmed"}
    assert {p.get("service") for p in props} <= {"fixed_route", "demand_response", "unknown"}
    cdot_only = [p for p in props if p["sources"] == ["cdot"] and p["reliability"] == "confirmed"]
    private = [p for p in props if p["operator"] == "private_shuttle"]
    assert cdot_only, "no CDOT-only stop in the file: the CDOT-only rule is not being checked"
    assert private, "no private shuttle in the file: the exclusion is not being checked"
    assert expected["fallback"], "no OpenStreetMap-only stop in the file: the fallback is not being checked"
    assert len(expected["counted"]) + len(expected["fallback"]) < len(feats)


def test_helper_tokens_are_the_ones_js_transit_zone_compares():
    """The screen (js/transit-zone.js) and the builders read the same file with
    the same tokens for private shuttles and unconfirmed stops."""
    helper = _load(HELPER, "transit_stops_tokens")
    js = TRANSIT_ZONE_JS.read_text(encoding="utf-8")
    ops = set(re.findall(r"\.operator\s*===\s*'([^']+)'", js))
    rels = set(re.findall(r"\.reliability\s*===\s*'([^']+)'", js))
    assert ops and rels, "js/transit-zone.js compares no operator/reliability token — the scan found nothing"
    assert not helper.counts_as_confirmed({"reliability": "confirmed", "operator": next(iter(ops))})
    for tok in rels:
        assert not helper.counts_as_confirmed({"reliability": tok, "operator": "public"})
        assert helper.is_osm_fallback({"reliability": tok, "operator": "public"})


def test_helper_selects_exactly_the_file_defined_sets(expected):
    helper = _load(HELPER, "transit_stops_sets")
    got = helper.load_stops(STOPS)
    assert _latlon(got["confirmed"]) == expected["counted_pts"]
    assert _latlon(got["openstreetmap_unconfirmed"]) == expected["fallback_pts"]


# ── Ranking index ───────────────────────────────────────────────────────────

def test_ranking_builder_reads_exactly_the_file_defined_sets(ranking, expected):
    assert ranking.TRANSIT_STOPS_REL_PATH == STOPS_REL
    counted, fallback = ranking.load_transit_points()
    assert counted == expected["counted_pts"], (
        f"ranking builder counts {len(counted)} stops; the stop file defines {len(expected['counted_pts'])}")
    assert fallback == expected["fallback_pts"], (
        f"ranking builder's fallback holds {len(fallback)} stops; the file defines {len(expected['fallback_pts'])}")


def test_ranking_metadata_records_the_selected_counts(expected):
    meta = _json(INDEX)["metadata"]["transitStops"]
    assert meta["source"] == STOPS_REL
    assert meta["confirmed_stops"] == len(expected["counted"])
    assert meta["openstreetmap_fallback_candidates"] == len(expected["fallback"])


def _place_rows(index, centroids):
    rows = [r for r in index["rankings"]
            if r["metrics"].get("opportunity_geography_level") == "place" and r["geoid"] in centroids]
    assert len(rows) > 400, "the scan found almost no place rows to check"
    return rows


def test_ranking_basis_agrees_with_the_file(ranking, expected, centroids):
    """Every place row's transit_stop_basis equals the basis the file gives at
    its centroid within the builder's radius — computed here, not by the helper."""
    index = _json(INDEX)
    radius = ranking.TRANSIT_RADIUS_MILES
    seen = collections.Counter()
    wrong = []
    for r in _place_rows(index, centroids):
        c = centroids[r["geoid"]]
        want = _basis(c["lat"], c["lng"], radius, expected["counted_pts"], expected["fallback_pts"], rnd=True)
        seen[want] += 1
        if r["metrics"].get("transit_stop_basis") != want:
            wrong.append((r["geoid"], r["name"], r["metrics"].get("transit_stop_basis"), want))
    assert not wrong, f"transit_stop_basis disagrees with the stop file at {len(wrong)} place(s): {wrong[:5]}"
    assert seen["confirmed"] and seen["none"], f"the scan did not cover both common bases: {dict(seen)}"
    for r in index["rankings"]:
        level = r["metrics"].get("opportunity_geography_level")
        if level == "county_context":
            assert r["metrics"]["transit_stop_basis"] == "county_context"


def test_ranking_amenity_score_uses_the_flagged_stops(ranking, expected, centroids):
    """amenity_access_score must equal the score recomputed with the stops the
    flag names: confirmed stops for "confirmed"/"none", the OpenStreetMap-only
    stops for a fallback row. A fallback row must get a transit component above
    0 from them (and 0 from the confirmed stops, or it would not be a fallback)."""
    index = _json(INDEX)
    fixed = ranking.load_fixed_amenity_points()
    radius = ranking.TRANSIT_RADIUS_MILES
    stops_for = {"confirmed": expected["counted_pts"], "none": expected["counted_pts"],
                 "openstreetmap_unconfirmed": expected["fallback_pts"]}
    wrong, fallback_rows = [], 0
    for r in _place_rows(index, centroids):
        basis = r["metrics"]["transit_stop_basis"]
        c = centroids[r["geoid"]]
        comps = [ranking.amenity_component(c["lat"], c["lng"], pts, rad)[0] for pts, rad in fixed.values()]
        transit = ranking.amenity_component(c["lat"], c["lng"], stops_for[basis], radius)[0]
        if basis == "openstreetmap_unconfirmed":
            fallback_rows += 1
            assert transit > 0, f"{r['geoid']} {r['name']}: a fallback place scored 0 on transit"
            assert ranking.amenity_component(c["lat"], c["lng"], expected["counted_pts"], radius)[0] == 0
        want = ranking._round_half_up(ranking._weighted([(v, 1.0) for v in comps + [transit]]), 0)
        if r["metrics"].get("amenity_access_score") != want:
            wrong.append((r["geoid"], r["name"], basis, r["metrics"].get("amenity_access_score"), want))
    assert not wrong, f"amenity_access_score disagrees with the stops its basis names at {len(wrong)} place(s): {wrong[:5]}"
    assert fallback_rows, "no fallback row in the index — the fallback rule is not being checked"


# ── Neighborhood access ─────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def na_doc():
    return _json(NEIGHBORHOOD)


def test_neighborhood_radius_is_where_the_connector_stops_giving_credit(neighborhood):
    src = CONNECTOR.read_text(encoding="utf-8")
    body = re.search(r"function distanceToScore\([^)]*\)\s*\{([\s\S]*?)\n  \}", src)
    assert body, "distanceToScore not found in osm-amenities.js"
    bands = [(float(m), int(s)) for m, s in re.findall(r"<=\s*([0-9.]+)\)\s*\{\s*return\s+(\d+)", body.group(1))]
    assert bands, "distanceToScore parsed to no bands"
    assert neighborhood.TRANSIT_FALLBACK_RADIUS_MILES == max(m for m, s in bands if s > 0)


def test_neighborhood_reads_the_statewide_file(neighborhood, na_doc):
    assert neighborhood.TRANSIT_SOURCE == STOPS_REL
    assert [p for p, t in neighborhood.GEOJSON_SOURCES.items() if t == "transit_stop"] == [STOPS_REL]
    assert na_doc["meta"]["transit"]["source"] == STOPS_REL


def test_neighborhood_confirmed_records_are_exactly_the_file_defined_set(na_doc, expected):
    """Compared on 4-dp positions, the builder's own de-duplication grain, so
    its (name, ~11 m) de-duplication cannot hide a missing or extra stop."""
    recs = [a for a in na_doc["amenities"] if a["type"] == "transit_stop"]
    assert {a.get("transit_stop_basis") for a in recs} <= {"confirmed", "openstreetmap_unconfirmed"}
    got = {(round(a["lat"], 4), round(a["lon"], 4)) for a in recs if a["transit_stop_basis"] == "confirmed"}
    want = {(round(lat, 4), round(lon, 4)) for lat, lon in expected["counted_pts"]}
    assert got == want, (
        f"{len(got - want)} confirmed record position(s) the file does not define "
        f"(e.g. {sorted(got - want)[:3]}), {len(want - got)} it defines are missing (e.g. {sorted(want - got)[:3]})")


def test_neighborhood_fallback_is_only_where_no_confirmed_stop_is_in_range(na_doc, expected, centroids, neighborhood):
    radius = neighborhood.TRANSIT_FALLBACK_RADIUS_MILES
    bases = {g: _basis(c["lat"], c["lng"], radius, expected["counted_pts"], expected["fallback_pts"], rnd=False)
             for g, c in centroids.items()}
    meta = na_doc["meta"]["transit"]
    assert {p["geoid"] for p in meta["fallback_places"]} == {g for g, b in bases.items() if b == "openstreetmap_unconfirmed"}
    assert meta["places_by_basis"] == dict(collections.Counter(bases.values()), **{
        k: 0 for k in ("confirmed", "openstreetmap_unconfirmed", "none") if k not in bases.values()})

    osm_recs = [a for a in na_doc["amenities"]
                if a["type"] == "transit_stop" and a["transit_stop_basis"] == "openstreetmap_unconfirmed"]
    fallback_pts = {(round(lat, 6), round(lon, 6)) for lat, lon in expected["fallback_pts"]}
    served = [centroids[g] for g, b in bases.items() if b == "confirmed"]
    for a in osm_recs:
        assert (a["lat"], a["lon"]) in fallback_pts, f"{a['name']}: not an OpenStreetMap-only stop in the file"
        leak = [c["name"] for c in served if _miles(c["lat"], c["lng"], a["lat"], a["lon"]) <= radius]
        assert not leak, f"OpenStreetMap-only stop {a['name']!r} leaks into place(s) with a confirmed stop: {leak}"

    for p in meta["fallback_places"]:
        c = centroids[p["geoid"]]
        near = [a for a in osm_recs if _miles(c["lat"], c["lng"], a["lat"], a["lon"]) <= radius]
        assert len(near) == p["openstreetmap_stops"], p
        if near:
            assert not p["withheld_because_near"], p
            continue
        # Scoring 0 is allowed only when the no-mixing rule forced it, and the
        # file must show why: an OSM-only stop in range that is also in range
        # of each named place, and each of those places has a confirmed stop.
        assert p["withheld_because_near"], f"{p['name']}: a fallback place was left scoring 0 with no reason"
        for g in p["withheld_because_near"]:
            assert bases[g] == "confirmed", (p, g)


def test_neighborhood_has_a_fallback_record_somewhere(na_doc):
    """Non-vacuity: at least one fallback record exists to be checked."""
    assert any(a.get("transit_stop_basis") == "openstreetmap_unconfirmed" for a in na_doc["amenities"])
