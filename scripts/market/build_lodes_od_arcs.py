#!/usr/bin/env python3
"""
scripts/market/build_lodes_od_arcs.py

Downloads LEHD LODES Origin-Destination (OD) data for Colorado and
creates a GeoJSON of commuting flow arcs between tract centroids.

Output: data/market/lodes_od_arcs_co.geojson

Each feature is a LineString connecting a home tract centroid to a
work tract centroid, with properties: home_tract, work_tract, jobs,
distance_miles, wage_breakdown.

Only the top N flows (by job count) are kept to keep file size manageable.

Usage:
    python3 scripts/market/build_lodes_od_arcs.py [--top N] [--min-jobs M]

Data source:
    LEHD LODES8 Origin-Destination (OD Main, All Jobs)
    https://lehd.ces.census.gov/data/lodes/LODES8/co/od/
"""

import argparse
import csv
import gzip
import io
import json
import math
import os
import sys
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "data" / "market" / "lodes_od_arcs_co.geojson"
CENTROIDS_PATH = ROOT / "data" / "market" / "tract_centroids_co.json"

# LODES8 OD Main file — All Jobs (JT00), most recent year
# Try years in descending order until one works. Keep in sync with
# scripts/market/fetch_lodes.py CANDIDATE_YEARS — both scripts must
# pick the same vintage for lodes_co.json + lodes_od_arcs_co.geojson
# to tell a consistent story.
LODES_YEARS = ["2023", "2022", "2021", "2020"]
LODES_URL_TEMPLATE = (
    "https://lehd.ces.census.gov/data/lodes/LODES8/co/od/"
    "co_od_main_JT00_{year}.csv.gz"
)

TIMEOUT = 120


def log(msg):
    print(f"[lodes-od] {msg}", file=sys.stderr)


def haversine(lat1, lon1, lat2, lon2):
    """Distance in miles between two lat/lon points."""
    R = 3958.8
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dLon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_centroids():
    """Load tract centroids from existing JSON file."""
    if not CENTROIDS_PATH.exists():
        log(f"⚠ Centroids file not found: {CENTROIDS_PATH}")
        return {}

    with open(CENTROIDS_PATH) as f:
        data = json.load(f)

    centroids = {}
    items = data if isinstance(data, list) else data.get("tracts", data.get("features", []))
    for item in items:
        if isinstance(item, dict):
            geoid = item.get("geoid", item.get("GEOID", ""))
            lat = item.get("lat", item.get("latitude", 0))
            lon = item.get("lon", item.get("longitude", 0))
            if geoid and lat and lon:
                centroids[geoid] = (float(lat), float(lon))
    log(f"Loaded {len(centroids)} tract centroids")
    return centroids


def download_lodes():
    """Download and parse LODES OD CSV (gzipped)."""
    for year in LODES_YEARS:
        url = LODES_URL_TEMPLATE.format(year=year)
        log(f"Trying LODES OD for {year}: {url}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "COHO-Analytics/1.0"})
            resp = urllib.request.urlopen(req, timeout=TIMEOUT)
            raw = resp.read()
            log(f"Downloaded {len(raw) / 1024 / 1024:.1f} MB (compressed)")

            # Decompress and parse CSV
            with gzip.open(io.BytesIO(raw), "rt") as gz:
                reader = csv.DictReader(gz)
                rows = []
                for row in reader:
                    rows.append(row)
            log(f"Parsed {len(rows):,} OD rows for year {year}")
            return rows, year
        except Exception as e:
            log(f"  Failed: {e}")
            continue

    log("⚠ All LODES years failed")
    return [], "unknown"


def build_arcs(rows, centroids, top_n=500, min_jobs=20):
    """Build GeoJSON LineString arcs from top OD flows."""
    # Aggregate OD pairs (LODES has block-level, we need tract-level)
    od_pairs = {}
    for row in rows:
        # w_geocode = work block (15-digit), h_geocode = home block (15-digit)
        # Tract = first 11 digits
        w_tract = row.get("w_geocode", "")[:11]
        h_tract = row.get("h_geocode", "")[:11]
        if not w_tract or not h_tract or w_tract == h_tract:
            continue  # skip intra-tract flows

        key = (h_tract, w_tract)
        s000 = int(row.get("S000", 0))  # total jobs
        se01 = int(row.get("SE01", 0))  # low wage ($1,250/mo or less)
        se02 = int(row.get("SE02", 0))  # mid wage ($1,251-$3,333/mo)
        se03 = int(row.get("SE03", 0))  # high wage ($3,333+/mo)

        if key not in od_pairs:
            od_pairs[key] = {"jobs": 0, "low": 0, "mid": 0, "high": 0}
        od_pairs[key]["jobs"] += s000
        od_pairs[key]["low"] += se01
        od_pairs[key]["mid"] += se02
        od_pairs[key]["high"] += se03

    log(f"Aggregated {len(od_pairs):,} unique tract-to-tract OD pairs")

    # Filter to minimum job threshold and sort by jobs descending
    filtered = [(k, v) for k, v in od_pairs.items() if v["jobs"] >= min_jobs]
    filtered.sort(key=lambda x: x[1]["jobs"], reverse=True)
    top = filtered[:top_n]
    log(f"Top {len(top)} flows (min {min_jobs} jobs, max requested {top_n})")

    # Build GeoJSON features
    features = []
    skipped = 0
    for (h_tract, w_tract), vals in top:
        h_coord = centroids.get(h_tract)
        w_coord = centroids.get(w_tract)
        if not h_coord or not w_coord:
            skipped += 1
            continue

        dist = haversine(h_coord[0], h_coord[1], w_coord[0], w_coord[1])

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [round(h_coord[1], 5), round(h_coord[0], 5)],  # home [lon, lat]
                    [round(w_coord[1], 5), round(w_coord[0], 5)],  # work [lon, lat]
                ],
            },
            "properties": {
                "home_tract": h_tract,
                "work_tract": w_tract,
                "jobs": vals["jobs"],
                "low_wage": vals["low"],
                "mid_wage": vals["mid"],
                "high_wage": vals["high"],
                "distance_miles": round(dist, 1),
            },
        })

    if skipped:
        log(f"  Skipped {skipped} arcs (missing centroids)")

    return features


def main():
    parser = argparse.ArgumentParser(description="Build LODES OD flow arcs")
    parser.add_argument("--top", type=int, default=500, help="Top N flows to keep")
    parser.add_argument("--min-jobs", type=int, default=20, help="Minimum jobs per flow")
    args = parser.parse_args()

    log("Building LODES OD flow arcs for Colorado…")

    centroids = load_centroids()
    if not centroids:
        log("Cannot proceed without centroids. Run build_public_market_data.py first.")
        sys.exit(1)

    rows, year = download_lodes()
    if not rows:
        log("No LODES data available. Exiting.")
        sys.exit(1)

    features = build_arcs(rows, centroids, top_n=args.top, min_jobs=args.min_jobs)

    output = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "LEHD LODES8 Origin-Destination (OD Main, All Jobs)",
            "url": LODES_URL_TEMPLATE.format(year=year),
            "year": year,
            "generated": datetime.now(timezone.utc).isoformat(),
            "flow_count": len(features),
            "top_n": args.top,
            "min_jobs": args.min_jobs,
            "note": "Tract-to-tract commuting flows. LineString from home to work centroid.",
        },
        "features": features,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1024
    log(f"✅ Wrote {len(features)} arcs → {OUT_PATH.name} ({size_kb:.0f} KB)")
    if features:
        top3 = sorted(features, key=lambda f: f["properties"]["jobs"], reverse=True)[:3]
        for arc in top3:
            p = arc["properties"]
            log(f"   {p['home_tract']} → {p['work_tract']}: {p['jobs']:,} jobs ({p['distance_miles']} mi)")


if __name__ == "__main__":
    main()
