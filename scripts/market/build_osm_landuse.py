#!/usr/bin/env python3
"""
scripts/market/build_osm_landuse.py

Fetches land-use polygons from OpenStreetMap Overpass API for Colorado
and outputs a simplified GeoJSON with zoning-proxy classifications.

Output: data/market/landuse_zoning_proxy_co.geojson

Each feature gets a standardized `zone_proxy` classification:
  - multifamily_residential  (apartments, flats, residential + building:levels >= 3)
  - townhome_residential     (terrace/row housing, residential medium density)
  - single_family            (detached residential, low density)
  - mixed_use                (commercial + residential land use overlap)
  - commercial               (retail, commercial)
  - industrial               (industrial)
  - vacant_developable       (brownfield, greenfield, construction sites)

This serves as a FREE proxy for actual zoning data. For authoritative
parcel-level zoning, use the Regrid connector (js/data-connectors/regrid-zoning.js).

Usage:
    python scripts/market/build_osm_landuse.py

Environment:
    OVERPASS_URL  - Override default Overpass endpoint (optional)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "data" / "market" / "landuse_zoning_proxy_co.geojson"

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

# Colorado bounding box: south, west, north, east
CO_BBOX = "36.9,-109.1,41.1,-102.0"
TIMEOUT_S = 300
THROTTLE_S = 5.0

# Points of one category that fall in the same grid cell (about 85 m by
# 110 m in Colorado) are written as one point carrying a count. The full
# 49,421-point pull was 12 MiB, over the 5 MiB data-file guard and slow on a
# phone. Nothing scores from this layer; it is a map display only, and at
# map scale one point per block per category reads the same.
GRID_DEG = 0.001


def log(msg):
    print(f"[osm-landuse] {msg}", file=sys.stderr)


def overpass_query(query_body):
    """Execute an Overpass query and return parsed JSON."""
    data = urllib.parse.urlencode({"data": query_body}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data,
                                headers={"User-Agent": "COHO-Housing-Analytics/1.0"})
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT_S)
        return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            log("Rate-limited (429). Waiting 30s…")
            time.sleep(30)
            resp = urllib.request.urlopen(req, timeout=TIMEOUT_S)
            return json.loads(resp.read().decode("utf-8"))
        raise


import urllib.parse


# ── Queries ──────────────────────────────────────────────────────────────────

QUERIES = {
    "multifamily": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["building"="apartments"]({CO_BBOX});
  way["building"="residential"]["building:levels"~"^[3-9]"]({CO_BBOX});
  way["landuse"="residential"]["residential"="apartments"]({CO_BBOX});
  relation["building"="apartments"]({CO_BBOX});
);
out center;
""",
    "townhome": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["building"="terrace"]({CO_BBOX});
  way["building"="semidetached_house"]({CO_BBOX});
  way["building"~"^(townhouse|row)$"]({CO_BBOX});
);
out center;
""",
    "mixed_use": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="mixed"]({CO_BBOX});
  way["building"="commercial"]["building:use"~"residential"]({CO_BBOX});
  way["building:use"="residential"]["shop"]({CO_BBOX});
);
out center;
""",
    "vacant": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="brownfield"]({CO_BBOX});
  way["landuse"="greenfield"]({CO_BBOX});
  way["landuse"="construction"]({CO_BBOX});
  node["vacant"="yes"]({CO_BBOX});
);
out center;
""",
    "commercial": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="commercial"]({CO_BBOX});
  way["landuse"="retail"]({CO_BBOX});
);
out center;
""",
    "industrial": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="industrial"]({CO_BBOX});
);
out center;
""",
}

PLAIN_NAMES = {
    "multifamily_residential": "apartment",
    "townhome_residential": "townhome",
    "mixed_use": "mixed-use",
    "vacant_developable": "vacant-land",
    "commercial": "commercial",
    "industrial": "industrial",
}

ZONE_PROXY_MAP = {
    "multifamily": "multifamily_residential",
    "townhome":    "townhome_residential",
    "mixed_use":   "mixed_use",
    "vacant":      "vacant_developable",
    "commercial":  "commercial",
    "industrial":  "industrial",
}


def element_to_feature(elem, zone_proxy):
    """Convert an Overpass element to a GeoJSON Point feature."""
    # Use center for ways/relations, direct coords for nodes
    if "center" in elem:
        lon, lat = elem["center"]["lon"], elem["center"]["lat"]
    elif "lon" in elem and "lat" in elem:
        lon, lat = elem["lon"], elem["lat"]
    else:
        return None

    tags = elem.get("tags", {})
    name = tags.get("name", tags.get("addr:street", ""))
    levels = tags.get("building:levels", "")
    building = tags.get("building", "")
    landuse = tags.get("landuse", "")

    # Suitability score (0-100) based on zone proxy
    suitability = {
        "multifamily_residential": 90,
        "townhome_residential": 85,
        "mixed_use": 75,
        "vacant_developable": 80,
        "commercial": 40,
        "industrial": 20,
    }.get(zone_proxy, 50)

    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {
            "name": name,
            "zone_proxy": zone_proxy,
            "building": building,
            "landuse": landuse,
            "levels": levels,
            "osm_id": elem.get("id", ""),
            "osm_type": elem.get("type", ""),
            "mf_suitability": suitability,
        },
    }


def _most_common(values):
    counts = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    return max(counts, key=lambda k: (counts[k], k)) if counts else ""


def thin_features(features, grid=GRID_DEG):
    """Merge same-category points that share a grid cell into one point.

    The merged point sits at the members' mean position and carries
    `count` (OSM features merged). Re-thinning an already thinned file keeps
    the counts, so a category kept from the previous file is not undercounted.
    Only the properties a page reads are written: name, zone_proxy,
    building, landuse, mf_suitability.
    """
    cells = {}
    order = []
    for f in features:
        lon, lat = f["geometry"]["coordinates"][:2]
        p = f.get("properties", {})
        key = (round(lon / grid), round(lat / grid), p.get("zone_proxy"))
        if key not in cells:
            cells[key] = []
            order.append(key)
        cells[key].append(f)

    out = []
    for key in order:
        members = cells[key]
        weights = [int(m["properties"].get("count") or 1) for m in members]
        total = sum(weights)
        lon = sum(m["geometry"]["coordinates"][0] * w for m, w in zip(members, weights)) / total
        lat = sum(m["geometry"]["coordinates"][1] * w for m, w in zip(members, weights)) / total
        first = members[0]["properties"]
        props = {"zone_proxy": first.get("zone_proxy")}
        name = _most_common(m["properties"].get("name") for m in members)
        building = _most_common(m["properties"].get("building") for m in members)
        landuse = _most_common(m["properties"].get("landuse") for m in members)
        if name:
            props["name"] = name
        if building:
            props["building"] = building
        if landuse:
            props["landuse"] = landuse
        if first.get("mf_suitability") is not None:
            props["mf_suitability"] = first["mf_suitability"]
        if total > 1:
            props["count"] = total
        out.append({
            "type": "Feature",
            # 4 decimals is about 10 m, finer than the grid cell.
            "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
            "properties": props,
        })
    return out


def main():
    log("Building OSM land-use zoning proxy for Colorado…")
    all_features = []
    kept_thinned = []
    counts = {}
    failed = []

    # A category whose query fails keeps the features it had in the previous
    # file instead of silently dropping out. The April 2026 file had no
    # apartments, mixed-use or vacant features at all because those three
    # queries failed and the file was written anyway.
    previous = {}
    prev_pulled = {}
    prev_thinned = False
    if OUT_PATH.exists():
        try:
            prev_doc = json.loads(OUT_PATH.read_text())
            for f in prev_doc.get("features", []):
                previous.setdefault(f.get("properties", {}).get("zone_proxy"), []).append(f)
            prev_meta = prev_doc.get("metadata") or {}
            prev_thinned = bool(prev_meta.get("thinning"))
            prev_date = str(prev_meta.get("generated") or "")[:10]
            prev_pulled = {c: prev_meta.get("category_pulled", {}).get(c, prev_date)
                           for c in ZONE_PROXY_MAP.values()}
        except (OSError, ValueError, AttributeError):
            previous, prev_pulled, prev_thinned = {}, {}, False
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pulled = {}

    for category, query_body in QUERIES.items():
        log(f"  Fetching {category}…")
        try:
            result = overpass_query(query_body)
            # Overpass reports a timeout or memory limit as HTTP 200 with a
            # "remark" and empty or partial elements. That is a failed query,
            # not an answer, so it goes to the keep-previous branch below.
            remark = str(result.get("remark") or "")
            if remark:
                raise RuntimeError(f"Overpass remark: {remark[:160]}")
            elements = result.get("elements", [])
            zone_proxy = ZONE_PROXY_MAP[category]
            feats = [f for f in (element_to_feature(e, zone_proxy) for e in elements) if f]
            # Every category has thousands of Colorado features, so an empty
            # answer is a failed query whether or not the last file had any.
            if not feats:
                raise RuntimeError("Overpass returned no features")
            all_features.extend(feats)
            count = len(feats)
            log(f"    → {count} features")
            counts[zone_proxy] = count
            pulled[zone_proxy] = today
        except Exception as e:
            log(f"    ⚠ Failed: {e}")
            zone_proxy = ZONE_PROXY_MAP[category]
            kept = previous.get(zone_proxy, [])
            # An already thinned category is kept exactly as it was: thinning
            # it again would move and re-merge points with no new data.
            (kept_thinned if prev_thinned else all_features).extend(kept)
            counts[zone_proxy] = sum(int(f["properties"].get("count") or 1) for f in kept)
            if kept:
                pulled[zone_proxy] = prev_pulled.get(zone_proxy) or "an earlier pull"
            failed.append({"category": zone_proxy, "reason": str(e)[:200], "kept_from_previous": len(kept)})
        time.sleep(THROTTLE_S)

    # Deduplicate by osm_id
    seen = set()
    unique = []
    for f in all_features:
        oid = f["properties"].get("osm_id", "")
        if oid and oid in seen:
            continue
        seen.add(oid)
        unique.append(f)

    osm_feature_count = sum(int(f["properties"].get("count") or 1) for f in unique + kept_thinned)
    thinned = thin_features(unique) + kept_thinned

    output = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap Overpass API",
            "description": "Land-use zoning proxy for multifamily/townhome suitability",
            "generated": datetime.now(timezone.utc).isoformat(),
            "feature_count": len(thinned),
            "osm_feature_count": osm_feature_count,
            "thinning": f"Same-category points within one {GRID_DEG} degree grid cell are merged into one point; 'count' is the number of OSM features merged.",
            "note": "Proxy only — for authoritative zoning use Regrid API",
            "categories": list(ZONE_PROXY_MAP.values()),
            "category_counts": counts,
            "category_pulled": pulled,
            "categories_failed": failed,
        },
        "features": thinned,
    }

    def listed(cats, joiner):
        names = [PLAIN_NAMES.get(c, c) for c in cats]
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {joiner} " + names[-1]

    note = ("OpenStreetMap proxy, not zoning; nearby features of one type are merged into one point "
            f"({osm_feature_count:,} features shown as {len(thinned):,} points)")
    missing = [c for c, n in counts.items() if n == 0]
    if missing:
        note += "; this pull has no " + listed(missing, "or") + " features"
    # A category kept from an older pull says so, with that pull's date, so it
    # is not read as current after an Overpass outage.
    retained = [f["category"] for f in failed if f["kept_from_previous"]]
    for date in sorted({pulled[c] for c in retained}):
        cats = [c for c in retained if pulled[c] == date]
        note += "; " + listed(cats, "and") + " features are from the " + date + " pull"
    output["metadata"]["coverage_note"] = note

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1024
    log(f"✅ Wrote {len(thinned)} points ({osm_feature_count} OSM features) → {OUT_PATH.name} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
