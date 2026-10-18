"""
tests/test_gtfs_transit_carry_forward.py

A feed that fails must not remove its agency from the transit layer.

On 2026-10-18 the Mobility Database's hosted copy of the Transfort feed
returned 404, fetch_gtfs_transit.py wrote the file without any Transfort
route (1,675 -> 1,622 features), and the site showed no Fort Collins transit.
Two fixes are pinned here: the agency's own download URL is tried when the
hosted copy fails, and an agency whose feed still fails keeps the routes
from the previous file.
"""

import csv
import importlib.util
import io
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "market" / "fetch_gtfs_transit.py"


def load_module():
    spec = importlib.util.spec_from_file_location("fetch_gtfs_transit_carry_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def feature(agency, shape_id, lon=-105.08):
    return {"type": "Feature",
            "properties": {"agency": agency, "route_type": 3, "shape_id": shape_id},
            "geometry": {"type": "LineString", "coordinates": [[lon, 40.55], [lon + 0.01, 40.56]]}}


PREVIOUS = {
    "type": "FeatureCollection",
    "features": [feature("Transfort", "t1"), feature("Transfort", "t2"),
                 feature("RTD Denver", "r1", -104.99), feature("Pueblo Transit", "p1", -104.6)],
    "meta": {"generated": "2026-10-11T11:32:30Z"},
}

CATALOG_FIELDS = ["mdb_source_id", "data_type", "location.subdivision_name", "status",
                  "provider", "location.municipality", "urls.latest", "urls.direct_download"]


def catalog(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CATALOG_FIELDS)
    w.writeheader()
    for r in rows:
        w.writerow({"data_type": "gtfs", "location.subdivision_name": "Colorado", **r})
    return buf.getvalue()


def run(tmp_path, monkeypatch, rows, responses, parsed):
    """responses: url -> 'ok' or an exception; parsed: url -> features."""
    mod = load_module()
    out = tmp_path / "transit_routes_co.geojson"
    out.write_text(json.dumps(PREVIOUS))
    monkeypatch.setattr(mod, "OUT_FILE", out)
    monkeypatch.setattr(mod, "fetch_mdb_catalog", lambda use_cache=False: catalog(rows))
    fetched = []

    def fake_fetch(url, **kw):
        fetched.append(url)
        if responses[url] != "ok":
            raise responses[url]
        return url.encode()

    monkeypatch.setattr(mod, "fetch_url", fake_fetch)
    monkeypatch.setattr(mod, "parse_gtfs_shapes", lambda b, aid, name: parsed.get(b.decode(), []))
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    monkeypatch.setattr(sys, "argv", ["fetch_gtfs_transit.py"])
    assert mod.main() == 0
    return json.loads(out.read_text()), fetched


def agencies(doc):
    return sorted(f["properties"]["agency"] for f in doc["features"])


def test_failed_feed_keeps_previous_routes(tmp_path, monkeypatch):
    rows = [{"provider": "Transfort", "urls.latest": "https://mdb/t.zip"},
            {"provider": "Pueblo Transit", "urls.latest": "https://mdb/p.zip"}]
    doc, _ = run(tmp_path, monkeypatch, rows,
                 {"https://mdb/t.zip": RuntimeError("HTTP Error 404"), "https://mdb/p.zip": "ok"},
                 {"https://mdb/p.zip": [feature("Pueblo Transit", "p1", -104.6)]})
    assert agencies(doc) == ["Pueblo Transit", "Transfort", "Transfort"]
    assert doc["meta"]["carried_forward"] == {
        "Transfort": {"features": 2, "last_fetched": "2026-10-11T11:32:30Z"}}
    assert [f["agency"] for f in doc["meta"]["agencies_failed"]] == ["Transfort"]


def test_carry_is_skipped_when_another_feed_served_the_agency(tmp_path, monkeypatch):
    # RTD has two catalog entries; the provider name differs from the
    # "RTD Denver" label its routes carry. One failing must not duplicate it.
    rows = [{"provider": "Regional Transportation District", "urls.latest": "https://mdb/r1.zip"},
            {"provider": "Regional Transportation District", "urls.latest": "https://mdb/r2.zip"}]
    doc, _ = run(tmp_path, monkeypatch, rows,
                 {"https://mdb/r1.zip": RuntimeError("HTTP Error 404"), "https://mdb/r2.zip": "ok"},
                 {"https://mdb/r2.zip": [feature("Regional Transportation District", "r1", -104.99)]})
    assert agencies(doc) == ["RTD Denver"]
    assert doc["meta"]["carried_forward"] == {}


def test_agency_url_is_tried_when_the_hosted_copy_is_gone(tmp_path, monkeypatch):
    rows = [{"provider": "Transfort", "urls.latest": "https://mdb/t.zip",
             "urls.direct_download": "https://ridetransfort.com/transfort_gtfs.zip"}]
    doc, fetched = run(tmp_path, monkeypatch, rows,
                       {"https://mdb/t.zip": RuntimeError("HTTP Error 404"),
                        "https://ridetransfort.com/transfort_gtfs.zip": "ok"},
                       {"https://ridetransfort.com/transfort_gtfs.zip": [feature("Transfort", "t9")]})
    assert fetched == ["https://mdb/t.zip", "https://ridetransfort.com/transfort_gtfs.zip"]
    assert agencies(doc) == ["Transfort"]
    assert doc["meta"]["carried_forward"] == {}
    assert doc["meta"]["agencies_failed"] == []


def _zip(*members):
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for m in members:
            zf.writestr(m, "x\n")
    return buf.getvalue()


def _fetch_feed_with(monkeypatch, bodies, require, nested=False):
    mod = load_module()
    fetched = []

    def fake_fetch(url, **kw):
        fetched.append(url)
        return bodies[url]

    monkeypatch.setattr(mod, "fetch_url", fake_fetch)
    feed = {"url": "https://mdb/t.zip", "fallback_url": "https://agency/t.zip"}
    return mod.fetch_feed(feed, require=require, nested=nested), fetched


def test_agency_url_is_tried_when_the_hosted_copy_is_unusable(monkeypatch):
    good = _zip("stops.txt", "shapes.txt")
    for bad in (b"<html>Not here</html>", _zip("agency.txt")):
        data, fetched = _fetch_feed_with(
            monkeypatch, {"https://mdb/t.zip": bad, "https://agency/t.zip": good}, "shapes.txt")
        assert data == good and fetched == ["https://mdb/t.zip", "https://agency/t.zip"]


def test_usable_hosted_copy_is_used_without_trying_the_agency(monkeypatch):
    good = _zip("stops.txt")
    data, fetched = _fetch_feed_with(monkeypatch, {"https://mdb/t.zip": good}, "stops.txt")
    assert data == good and fetched == ["https://mdb/t.zip"]


def test_date_only_vintage_still_carries_routes(capsys):
    # A previous file with only meta.vintage gives a timezone-naive date.
    mod = load_module()
    previous = {"features": [feature("Transfort", "t1")], "meta": {"vintage": "2026-01-02"}}
    kept = []
    carried = mod.carry_forward_failed(kept, [{"agency": "Transfort"}], previous)
    assert carried == {"Transfort": {"features": 1, "last_fetched": "2026-01-02"}}
    assert len(kept) == 1
    assert "::warning::Transfort feed has failed since 2026-01-02" in capsys.readouterr().out


def test_nested_member_counts_only_where_the_reader_resolves_it(monkeypatch):
    # parse_gtfs_shapes reads root-level shapes.txt; the stops builder
    # resolves a member inside a folder.
    nested = _zip("feed/shapes.txt", "feed/stops.txt")
    good = _zip("shapes.txt")
    bodies = {"https://mdb/t.zip": nested, "https://agency/t.zip": good}
    data, _ = _fetch_feed_with(monkeypatch, bodies, "shapes.txt")
    assert data == good
    data, fetched = _fetch_feed_with(monkeypatch, bodies, "stops.txt", nested=True)
    assert data == nested and fetched == ["https://mdb/t.zip"]
