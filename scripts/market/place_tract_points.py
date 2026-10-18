#!/usr/bin/env python3
"""Put each tract-point layer's points at its own tract's TIGER internal point.

employment_centers_co.geojson and environmental_constraints_co.geojson are one
Point per census tract, keyed by `geoid`. Their committed coordinates (both
generated 2026-04-09) came from an earlier tract_centroids_co.json and did not
belong to the tract named on the point: the median point sat 138 mi from its
tract, and La Plata County (08067) tracts were drawn near Trinidad. The
attributes are keyed correctly (totalJobs matches lodes_co.json by geoid), so
only the geometry is wrong.

This rewrites each Point from data/market/tract_centroids_co.json (TIGER 2020
internal points, rebuilt 2026-06-11). A feature whose geoid is not a 2020
tract is dropped, as fetch_environmental_justice.py already does: CDC EJI 2022
still uses some 2010 tract ids that have no single 2020 location.

Usage: python3 scripts/market/place_tract_points.py
Guarded by test/tract-point-placement.test.js.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CENTROIDS = ROOT / "data" / "market" / "tract_centroids_co.json"
LAYERS = [
    ROOT / "data" / "market" / "employment_centers_co.geojson",
    ROOT / "data" / "market" / "environmental_constraints_co.geojson",
]


def main():
    tracts = json.loads(CENTROIDS.read_text())["tracts"]
    points = {t["geoid"]: [round(t["lon"], 4), round(t["lat"], 4)] for t in tracts}
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
            "source": "data/market/tract_centroids_co.json (TIGER 2020 internal points)",
            "placed": stamp,
            "dropped_not_2020_tracts": dropped,
            "script": "scripts/market/place_tract_points.py",
        }
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"{path.name}: {len(kept)} placed, {len(dropped)} dropped {dropped}")


if __name__ == "__main__":
    main()
