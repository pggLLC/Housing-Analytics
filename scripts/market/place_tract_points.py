#!/usr/bin/env python3
"""Put each tract-point layer's points at its own tract's TIGER internal point.

employment_centers_co.geojson and environmental_constraints_co.geojson are one
Point per census tract, keyed by `geoid`. Their committed coordinates (both
generated 2026-04-09) came from an earlier tract_centroids_co.json and did not
belong to the tract named on the point: the median point sat 138 mi from its
tract, and La Plata County (08067) tracts were drawn near Trinidad. The
attributes are keyed correctly (totalJobs matches lodes_co.json by geoid), so
only the geometry is wrong.

This rewrites each Point from the tract's INTPTLAT/INTPTLON in Census TIGERweb
(Census 2020 tracts layer), read directly rather than from
tract_centroids_co.json, whose stored point differs from TIGER for 14 tracts
(up to 402 m). A feature whose geoid is not a 2020 tract is dropped, as
fetch_environmental_justice.py already does: CDC EJI 2022 still uses some 2010 tract ids that have no single 2020 location.

Usage: python3 scripts/market/place_tract_points.py
(fetch_environmental_justice.py runs it after every EJI rebuild.)
Guarded by test/tract-point-placement.test.js.
"""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TIGERWEB = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
            "tigerWMS_Census2020/MapServer/6/query")
LAYERS = [
    ROOT / "data" / "market" / "employment_centers_co.geojson",
    ROOT / "data" / "market" / "environmental_constraints_co.geojson",
]


def main():
    query = urllib.parse.urlencode({
        "where": "STATE='08'", "outFields": "GEOID,INTPTLAT,INTPTLON",
        "returnGeometry": "false", "outSR": 4326, "resultRecordCount": 2000, "f": "json",
    })
    with urllib.request.urlopen(f"{TIGERWEB}?{query}", timeout=120) as resp:
        payload = json.load(resp)
    if payload.get("exceededTransferLimit"):
        raise SystemExit("TIGERweb truncated the tract list; page the query")
    points = {
        a["GEOID"]: [round(float(a["INTPTLON"]), 4), round(float(a["INTPTLAT"]), 4)]
        for a in (f["attributes"] for f in payload["features"])
    }
    if len(points) != 1447:
        raise SystemExit(f"expected 1447 Colorado tracts from TIGERweb, got {len(points)}")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for path in LAYERS:
        data = json.loads(path.read_text())
        kept, dropped = [], []
        for feat in data["features"]:
            geoid = feat["properties"]["geoid"]
            if geoid not in points:
                dropped.append(geoid)
                continue
            feat["geometry"] = {"type": "Point", "coordinates": points[geoid]}
            kept.append(feat)
        data["features"] = kept

        meta = data["meta"]
        meta["feature_count"] = len(kept)
        if "high_risk_tracts" in meta:
            cats = [f["properties"].get("risk_category") for f in kept]
            meta["high_risk_tracts"] = cats.count("high")
            meta["moderate_risk_tracts"] = cats.count("moderate")
        meta["points_placed"] = {
            "source": f"Census TIGERweb Census 2020 tracts, INTPTLAT/INTPTLON ({TIGERWEB})",
            "placed": stamp,
            "dropped_not_2020_tracts": dropped,
            "script": "scripts/market/place_tract_points.py",
        }
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"{path.name}: {len(kept)} placed, {len(dropped)} dropped {dropped}")


if __name__ == "__main__":
    main()
