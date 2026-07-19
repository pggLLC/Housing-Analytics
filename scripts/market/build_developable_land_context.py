#!/usr/bin/env python3
"""
Build tract-level developable-land context for PMA research.

This is deliberately context-only. It does not change PMA scoring, tract
selection, weights, buffers, or the shipped landSupply score.

Method:
  * Census tract land/water areas come from the committed TIGER tract geometry.
  * PAD-US public/protected-open-space records are fetched from the public USGS
    ArcGIS FeatureServer as centroids + source acres, assigned to the containing
    tract, and capped at tract land acres.
  * Optional local NLCD/COMaP summaries may be supplied later, but raw rasters
    and restricted COMaP source data are never committed by this builder.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TRACTS_PATH = ROOT / "data" / "market" / "tract_boundaries_co.geojson"
OUT_PATH = ROOT / "data" / "market" / "developable_land_context_co.json"

PADUS_LAYER_URL = (
    "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
    "PADUS_Protection_Status_by_GAP_Status_Code/FeatureServer/0"
)
PADUS_QUERY_URL = f"{PADUS_LAYER_URL}/query"
PADUS_ITEM_URL = "https://www.arcgis.com/home/item.html?id=98fce3fb0c8241ce8847e9f7d0d212e9"
PADUS_OVERVIEW_URL = "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview"
COMAP_TERMS_URL = "https://comap.cnhp.colostate.edu/terms-of-use/"
NLCD_DATA_URL = "https://www.mrlc.gov/data"

STATE_FIPS = "08"
CO_BBOX = (-109.0602, 36.9924, -102.0415, 41.0034)
SQM_PER_ACRE = 4046.8564224
PADUS_CHUNK_SIZE = 100


def iso_today() -> str:
    return date.today().isoformat()


def review_by(days: int = 92) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def request_json(url: str, retries: int = 3, timeout: int = 90):
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # pragma: no cover - exercised only during live fetch failures
            last_error = exc
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def feature_geoid(feature) -> str | None:
    props = feature.get("properties") or {}
    return props.get("GEOID") or props.get("geoid") or props.get("GEOID20")


def ring_bbox(ring):
    xs = [pt[0] for pt in ring]
    ys = [pt[1] for pt in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def geom_bbox(geometry):
    rings = []
    if geometry.get("type") == "Polygon":
        rings = [geometry["coordinates"][0]]
    elif geometry.get("type") == "MultiPolygon":
        rings = [poly[0] for poly in geometry["coordinates"] if poly]
    if not rings:
        return None
    boxes = [ring_bbox(ring) for ring in rings]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def point_in_ring(point, ring) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (
            x < ((xj - xi) * (y - yi)) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_in_polygon(point, polygon) -> bool:
    if not polygon or not point_in_ring(point, polygon[0]):
        return False
    return not any(point_in_ring(point, hole) for hole in polygon[1:])


def point_in_geometry(point, geometry) -> bool:
    if geometry.get("type") == "Polygon":
        return point_in_polygon(point, geometry.get("coordinates") or [])
    if geometry.get("type") == "MultiPolygon":
        return any(point_in_polygon(point, poly) for poly in geometry.get("coordinates") or [])
    return False


def load_tracts():
    source = read_json(TRACTS_PATH)
    tracts = []
    for feature in source.get("features") or []:
        geoid = feature_geoid(feature)
        geometry = feature.get("geometry")
        props = feature.get("properties") or {}
        bbox = geom_bbox(geometry or {})
        if not geoid or not geometry or not bbox:
            continue
        land_acres = (float(props.get("AREALAND") or 0) / SQM_PER_ACRE)
        water_acres = (float(props.get("AREAWATER") or 0) / SQM_PER_ACRE)
        tracts.append({
            "geoid": geoid,
            "county_fips": geoid[:5],
            "name": props.get("NAME") or f"Census Tract {geoid[-6:]}",
            "geometry": geometry,
            "bbox": bbox,
            "land_acres": land_acres,
            "water_acres": water_acres,
            "total_acres": land_acres + water_acres,
        })
    return tracts


def locate_tract(point, tracts):
    x, y = point
    for tract in tracts:
        minx, miny, maxx, maxy = tract["bbox"]
        if x < minx or x > maxx or y < miny or y > maxy:
            continue
        if point_in_geometry(point, tract["geometry"]):
            return tract["geoid"]
    return None


def padus_query_url(params):
    base = {
        "f": "json",
        "outSR": "4326",
        "returnGeometry": "false",
        "returnCentroid": "true",
        "outFields": "OBJECTID,GAP_Sts,GIS_Acres,MngTp_Desc,Pub_Access,Unit_Nm",
    }
    base.update(params)
    return f"{PADUS_QUERY_URL}?{urllib.parse.urlencode(base)}"


def fetch_padus_records(offline_path: Path | None = None):
    if offline_path:
        payload = read_json(offline_path)
        return payload.get("features") or payload

    bbox = ",".join(str(v) for v in CO_BBOX)
    ids_url = padus_query_url({
        "where": "1=1",
        "geometry": bbox,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnIdsOnly": "true",
    })
    ids_payload = request_json(ids_url, timeout=120)
    object_ids = ids_payload.get("objectIds") or []
    if not object_ids:
        raise RuntimeError("PAD-US query returned zero object IDs for Colorado bbox")

    records = []
    for i in range(0, len(object_ids), PADUS_CHUNK_SIZE):
        chunk = object_ids[i:i + PADUS_CHUNK_SIZE]
        url = padus_query_url({
            "where": "1=1",
            "objectIds": ",".join(str(v) for v in chunk),
        })
        payload = request_json(url, timeout=120)
        records.extend(payload.get("features") or [])
        time.sleep(0.1)
    return records


def summarize_padus(records, tracts):
    by_tract = defaultdict(lambda: {
        "padus_protected_open_space_acres": 0.0,
        "padus_feature_count": 0,
        "gap_status_counts": Counter(),
        "manager_type_counts": Counter(),
        "unassigned_padus_acres": 0.0,
    })
    statewide = {
        "source_feature_count": 0,
        "assigned_feature_count": 0,
        "assigned_acres": 0.0,
        "unassigned_feature_count": 0,
        "unassigned_acres": 0.0,
        "gap_status_counts": Counter(),
        "manager_type_counts": Counter(),
    }

    for record in records:
        attrs = record.get("attributes") or record.get("properties") or {}
        centroid = record.get("centroid") or {}
        acres = float(attrs.get("GIS_Acres") or attrs.get("GIS_AcrsDb") or 0)
        if acres <= 0 or not math.isfinite(acres):
            continue
        x = centroid.get("x")
        y = centroid.get("y")
        if not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
            statewide["unassigned_feature_count"] += 1
            statewide["unassigned_acres"] += acres
            continue
        geoid = locate_tract((x, y), tracts)
        statewide["source_feature_count"] += 1
        gap = str(attrs.get("GAP_Sts") or "unknown")
        manager = str(attrs.get("MngTp_Desc") or "unknown")
        statewide["gap_status_counts"][gap] += 1
        statewide["manager_type_counts"][manager] += 1
        if not geoid:
            statewide["unassigned_feature_count"] += 1
            statewide["unassigned_acres"] += acres
            continue
        bucket = by_tract[geoid]
        bucket["padus_protected_open_space_acres"] += acres
        bucket["padus_feature_count"] += 1
        bucket["gap_status_counts"][gap] += 1
        bucket["manager_type_counts"][manager] += 1
        statewide["assigned_feature_count"] += 1
        statewide["assigned_acres"] += acres

    return by_tract, statewide


def compact_counter(counter: Counter, limit: int = 8):
    return dict(counter.most_common(limit))


def build(offline_padus: Path | None = None):
    tracts = load_tracts()
    padus_records = fetch_padus_records(offline_padus)
    padus_by_tract, padus_statewide = summarize_padus(padus_records, tracts)

    rows = {}
    county_counts = Counter()
    protected_tracts = 0
    constrained_tracts = 0
    for tract in tracts:
        total_acres = tract["total_acres"]
        land_acres = tract["land_acres"]
        water_acres = tract["water_acres"]
        pad = padus_by_tract[tract["geoid"]]
        pad_acres_raw = pad["padus_protected_open_space_acres"]
        pad_acres_capped = min(pad_acres_raw, land_acres)
        excluded_acres = min(total_acres, water_acres + pad_acres_capped)
        developable_acres = max(0.0, total_acres - excluded_acres)
        share = developable_acres / total_acres if total_acres > 0 else None
        protected_share = pad_acres_capped / total_acres if total_acres > 0 else None
        water_share = water_acres / total_acres if total_acres > 0 else None
        if pad_acres_capped > 0:
            protected_tracts += 1
        if share is not None and share < 0.5:
            constrained_tracts += 1
        county_counts[tract["county_fips"]] += 1
        rows[tract["geoid"]] = {
            "geoid": tract["geoid"],
            "county_fips": tract["county_fips"],
            "name": tract["name"],
            "source_level": "tract_context_modeled",
            "context_only": True,
            "not_scoring_input": True,
            "developable_share_context": None if share is None else round(share, 6),
            "developable_acres_context": round(developable_acres, 2),
            "total_acres": round(total_acres, 2),
            "census_land_acres": round(land_acres, 2),
            "census_water_acres": round(water_acres, 2),
            "census_water_share": None if water_share is None else round(water_share, 6),
            "padus_protected_open_space_acres": round(pad_acres_capped, 2),
            "padus_protected_open_space_share": None if protected_share is None else round(protected_share, 6),
            "padus_feature_count": pad["padus_feature_count"],
            "padus_gap_status_counts": compact_counter(pad["gap_status_counts"]),
            "padus_manager_type_counts": compact_counter(pad["manager_type_counts"]),
            "limitations": [
                "PAD-US exclusions are centroid-allocated source acres, not polygon-overlaid acreage.",
                "NLCD raster and COMaP restricted-source summaries are not included unless supplied as local derived inputs.",
            ],
        }

    today = iso_today()
    output = {
        "meta": {
            "source": "Colorado tract developable-land context",
            "as_of": today,
            "last_verified": today,
            "review_by": review_by(),
            "state_fips": STATE_FIPS,
            "generated_by": "scripts/market/build_developable_land_context.py",
            "tract_boundaries_file": "data/market/tract_boundaries_co.geojson",
            "padus_source": "PAD-US Protection Status by GAP Status Code",
            "padus_source_url": PADUS_LAYER_URL,
            "padus_item_url": PADUS_ITEM_URL,
            "padus_overview_url": PADUS_OVERVIEW_URL,
            "nlcd_source_url": NLCD_DATA_URL,
            "comap_terms_url": COMAP_TERMS_URL,
            "context_only": True,
            "not_scoring_input": True,
            "methodology": (
                "Census tract AREALAND/AREAWATER establish total area. PAD-US records intersecting "
                "Colorado are fetched as centroids with source GIS_Acres, assigned to containing "
                "tracts, summed, and capped at tract land acres. Developable context share is "
                "(total acres - Census water acres - capped PAD-US protected/open-space acres) / "
                "total acres. This is a context artifact only and is not wired into PMA scoring."
            ),
            "source_status": {
                "pad_us_4_1": {
                    "status": "included_public_domain_context",
                    "license_note": "USGS/PAD-US content identifies the dataset as public domain; service warranty disclaimer still applies.",
                },
                "nlcd": {
                    "status": "not_included_without_local_raster_summary",
                    "license_note": "Public MRLC/NLCD source verified, but raw rasters are not committed and this environment lacks raster processing dependencies.",
                },
                "comap": {
                    "status": "verified_excluded_restricted_redistribution",
                    "license_note": "COMaP terms prohibit redistribution of the underlying data and require direct registration/download.",
                },
            },
            "limitations": [
                "First-pass context-only indicator; not a buildable-parcel analysis and not a regulatory entitlement screen.",
                "PAD-US is centroid-allocated by source acres rather than polygon-overlaid, so large multi-tract holdings may be approximate.",
                "COMaP and NLCD are tracked as source statuses pending a license-clean/local derived summary path.",
                "Any scoring use must go through the #1238 disclosed-migration protocol.",
            ],
            "tract_count": len(rows),
            "county_count": len(county_counts),
            "protected_tract_count": protected_tracts,
            "constrained_tract_count_share_below_50pct": constrained_tracts,
            "padus": {
                "source_feature_count": padus_statewide["source_feature_count"],
                "assigned_feature_count": padus_statewide["assigned_feature_count"],
                "assigned_acres": round(padus_statewide["assigned_acres"], 2),
                "unassigned_feature_count": padus_statewide["unassigned_feature_count"],
                "unassigned_acres": round(padus_statewide["unassigned_acres"], 2),
                "gap_status_counts": compact_counter(padus_statewide["gap_status_counts"]),
                "manager_type_counts": compact_counter(padus_statewide["manager_type_counts"]),
            },
        },
        "tracts": rows,
    }
    return output


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--padus-fixture", type=Path, default=None,
                        help="Optional PAD-US centroid JSON fixture for offline QA.")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args(argv)
    output = build(args.padus_fixture)
    write_json(args.out, output)
    print(
        "developable-land-context: wrote "
        f"{output['meta']['tract_count']} tracts with "
        f"{output['meta']['padus']['assigned_feature_count']} assigned PAD-US features"
    )


if __name__ == "__main__":
    main()
