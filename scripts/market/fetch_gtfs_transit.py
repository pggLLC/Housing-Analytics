#!/usr/bin/env python3
"""
scripts/market/fetch_gtfs_transit.py

Fetch Colorado transit route data from GTFS feeds published by ALL Colorado
transit agencies — sourced dynamically from the Mobility Database catalog
(formerly the TransitFeeds.com / Google Transit feed registry).

Background — why catalog-driven instead of hardcoded list
----------------------------------------------------------
The pre-2026-05-08 version of this script had 5 hand-curated agency feeds
(RTD, Bustang, Mountain Metro, Transfort, Greeley-Evans) — but Mountain
Metro's URL was dead, leaving only 4 working agencies in production
data. That covered <5% of CO transit (RTD + 3 small Front Range systems).

The Mobility Database (https://mobilitydata.org/) maintains a registry
of ~88 active CO GTFS feeds covering: Mountain Metropolitan (Colorado
Springs, ~700K pop), Roaring Fork Transportation Authority (Aspen/
Glenwood), Eagle County (Vail), Summit Stage (Breckenridge), Pueblo
Transit, Vail Transit, Steamboat Springs, Durango Transit, Mountain
Express (Crested Butte), Town of Telluride, plus ~20 senior /
dial-a-ride / county-level services across rural CO.

This script reads the MDB catalog dynamically, filters to CO active
feeds, and fetches each. Per-feed timeouts + graceful failure mean
one broken feed doesn't sink the whole run. Final output is a single
merged GeoJSON FeatureCollection.

Sources
-------
  - Mobility Database catalog: https://bit.ly/catalogs-csv (CSV mirror;
    redirects to GitHub raw URL maintained by mobilitydata.org)
  - Each agency's GTFS .zip from the `urls.latest` column

Output
------
    data/market/transit_routes_co.geojson

Usage
-----
    python3 scripts/market/fetch_gtfs_transit.py
    python3 scripts/market/fetch_gtfs_transit.py --max-agencies 10  # for testing
    python3 scripts/market/fetch_gtfs_transit.py --use-cache         # use cached catalog
"""

import argparse
import csv
import io
import json
import os
import sys
import time
import hashlib
import zipfile
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "transit_routes_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_gtfs_cache"
CACHE_TTL_HOURS = 168  # 1 week

# Mobility Database catalog. Stable redirect to the latest CSV.
# Mirror: https://github.com/MobilityData/mobility-database-catalogs
MDB_CATALOG_URL = "https://bit.ly/catalogs-csv"
MDB_CACHE_FILE = CACHE_DIR / "mdb_catalog.csv"


def fetch_mdb_catalog(use_cache: bool = False) -> str:
    """Fetch the Mobility Database catalog CSV. Caches under TMPDIR."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if use_cache and MDB_CACHE_FILE.exists():
        log(f"Using cached MDB catalog: {MDB_CACHE_FILE}")
        return MDB_CACHE_FILE.read_text()
    log(f"Fetching MDB catalog from {MDB_CATALOG_URL}...")
    req = urllib.request.Request(
        MDB_CATALOG_URL,
        headers={"User-Agent": "HousingAnalytics/1.0 fetch_gtfs_transit.py"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    MDB_CACHE_FILE.write_text(text)
    return text


def load_co_feeds(catalog_csv: str) -> list[dict]:
    """Parse MDB catalog → list of active CO transit feeds.

    Returns: [{agency, agency_id, url, municipality, status}, ...]
    Filters to: subdivision_name == 'Colorado' AND status != 'deprecated'.
    Deduplicates by `urls.latest` (MDB has multiple entries per agency in
    some cases; canonical URL is the dedup key).
    """
    feeds: list[dict] = []
    seen_urls: set[str] = set()
    reader = csv.DictReader(io.StringIO(catalog_csv))
    for row in reader:
        if row.get("location.subdivision_name", "").strip().lower() != "colorado":
            continue
        if row.get("status", "").strip().lower() == "deprecated":
            continue
        if row.get("data_type", "").strip().lower() != "gtfs":
            continue  # skip GTFS-RT / other feeds
        url = (row.get("urls.latest") or row.get("urls.direct_download") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        provider = (row.get("provider") or row.get("name") or "?").strip()
        # Build a stable agency_id from provider + municipality
        muni = row.get("location.municipality", "").strip()
        slug = ("_".join((provider, muni)) if muni else provider).lower()
        agency_id = "".join(c if c.isalnum() else "_" for c in slug).strip("_")[:50]

        feeds.append({
            "agency":       provider,
            "agency_id":    agency_id,
            "municipality": muni,
            "url":          url,
            "status":       row.get("status", "active"),
            "mdb_id":       row.get("mdb_source_id", ""),
        })
    return feeds


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
    cache_file = _cache_key(url)
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 10 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def parse_gtfs_shapes(zip_bytes: bytes, agency_id: str, agency_name: str) -> list:
    """Extract route LineString features from a GTFS ZIP file's shapes.txt."""
    features = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()

            # Load routes for metadata
            routes_map = {}
            if "routes.txt" in names:
                with zf.open("routes.txt") as rf:
                    reader = csv.DictReader(io.TextIOWrapper(rf, encoding="utf-8-sig"))
                    for row in reader:
                        routes_map[row.get("route_id", "")] = {
                            "short_name": row.get("route_short_name", ""),
                            "long_name":  row.get("route_long_name", ""),
                            "route_type": int(row.get("route_type", 3) or 3),
                            "color":      row.get("route_color", ""),
                        }

            # Load trips.txt to map shape_id → route_id (for route_type linkage)
            shape_to_route: dict = {}
            if "trips.txt" in names:
                with zf.open("trips.txt") as tf:
                    reader = csv.DictReader(io.TextIOWrapper(tf, encoding="utf-8-sig"))
                    for row in reader:
                        sid = row.get("shape_id", "")
                        rid = row.get("route_id", "")
                        if sid and rid and sid not in shape_to_route:
                            shape_to_route[sid] = rid

            # Load shapes grouped by shape_id
            if "shapes.txt" not in names:
                log(f"  ⚠ No shapes.txt in {agency_id} GTFS", level="WARN")
                return features

            shapes: dict = {}
            with zf.open("shapes.txt") as sf:
                reader = csv.DictReader(io.TextIOWrapper(sf, encoding="utf-8-sig"))
                for row in reader:
                    sid = row.get("shape_id", "")
                    seq = int(row.get("shape_pt_sequence", 0) or 0)
                    lat = float(row.get("shape_pt_lat", 0) or 0)
                    lon = float(row.get("shape_pt_lon", 0) or 0)
                    if sid not in shapes:
                        shapes[sid] = []
                    shapes[sid].append((seq, lon, lat))

            # Build LineString features (one per shape)
            for shape_id, pts in shapes.items():
                pts.sort(key=lambda x: x[0])
                coords = [[p[1], p[2]] for p in pts]
                if len(coords) < 2:
                    continue
                # Look up actual route_type via shape→trip→route linkage
                linked_route_id = shape_to_route.get(shape_id, "")
                linked_route = routes_map.get(linked_route_id, {})
                actual_route_type = linked_route.get("route_type", 3)  # GTFS: 0=tram, 1=subway, 2=rail, 3=bus
                route_name = linked_route.get("short_name") or linked_route.get("long_name") or ""

                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "shape_id":   shape_id,
                        "agency_id":  agency_id,
                        "agency":     agency_name,
                        "route_type": actual_route_type,
                        "route_name": route_name,
                    },
                })

    except Exception as exc:
        log(f"  ✗ GTFS parse error for {agency_id}: {exc}", level="WARN")

    return features


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-agencies", type=int, default=None,
                        help="Limit to first N agencies (for testing)")
    parser.add_argument("--use-cache", action="store_true",
                        help="Use cached MDB catalog instead of refetching")
    args = parser.parse_args()

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()
    all_features = []
    agencies_ok = []
    agencies_failed = []

    # Read MDB catalog → CO active feeds
    try:
        catalog_csv = fetch_mdb_catalog(use_cache=args.use_cache)
        feeds = load_co_feeds(catalog_csv)
        log(f"Mobility Database: {len(feeds)} active CO transit feeds discovered.")
    except Exception as exc:
        log(f"✗ MDB catalog fetch failed: {exc}", level="ERROR")
        log("  Falling back to existing transit_routes_co.geojson if present.", level="WARN")
        feeds = []

    if args.max_agencies:
        feeds = feeds[: args.max_agencies]
        log(f"  (limited to first {len(feeds)} agencies for testing)")

    for i, feed in enumerate(feeds, 1):
        agency_id = feed["agency_id"]
        agency_name = feed["agency"]
        url = feed["url"]
        log(f"[{i}/{len(feeds)}] Fetching GTFS for {agency_name} ({feed.get('municipality') or 'CO'})…")
        try:
            zip_bytes = fetch_url(url)
            features = parse_gtfs_shapes(zip_bytes, agency_id, agency_name)
            if features:
                all_features.extend(features)
                agencies_ok.append(agency_name)
                log(f"  ✓ {agency_name}: {len(features)} shapes")
            else:
                # Empty ZIP or no shapes.txt — soft failure
                agencies_failed.append({"agency": agency_name, "reason": "no shapes parsed"})
                log(f"  ⚠ {agency_name}: no shapes parsed (empty or malformed GTFS)", level="WARN")
        except Exception as exc:
            agencies_failed.append({"agency": agency_name, "reason": str(exc)[:200]})
            log(f"  ✗ {agency_name}: {exc}", level="WARN")
        time.sleep(0.5)  # be polite to upstreams

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Colorado Transit Agency GTFS feeds via Mobility Database catalog",
            "agencies": agencies_ok,
            "agencies_failed": agencies_failed,
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": generated[:10],
            "generated": generated,
            "feature_count": len(all_features),
            "agency_count_total":  len(feeds),
            "agency_count_ok":     len(agencies_ok),
            "agency_count_failed": len(agencies_failed),
            "coverage_pct": round(
                len(agencies_ok) / max(len(feeds), 1) * 100, 1
            ),
            "note": "Rebuild via scripts/market/fetch_gtfs_transit.py. "
                    "MDB catalog drives the agency list; per-feed failures "
                    "are surfaced in agencies_failed without blocking other agencies.",
        },
        "features": all_features,
    }

    # Fallback to existing file when fetch produced nothing
    if not all_features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing transit_routes_co.geojson", level="WARN")
            result = existing

    # Dedup duplicate routes from agencies with multiple MDB feeds
    # (e.g. RTD Denver appears in MDB twice with slightly different
    # bundles, producing 7x duplicate route geometries). Dedup key is
    # (normalized_agency_name, shape_id) — same shape from same agency
    # is the same route regardless of which MDB feed it came through.
    import re as _re
    def _norm_agency(name: str) -> str:
        if not name: return ""
        n = _re.sub(r"\([^)]*\)", "", name)        # strip parenthetical suffixes
        n = _re.sub(r"[^a-z0-9]+", "_", n.lower()).strip("_")
        return n

    seen_keys: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    pre_count = len(all_features)
    for f in all_features:
        p = f.get("properties", {})
        key = (_norm_agency(p.get("agency", "")), p.get("shape_id", ""))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        # Canonicalize known duplicate-prone agency names so display is
        # consistent regardless of which MDB feed published the route.
        if _norm_agency(p.get("agency", "")) == "regional_transportation_district":
            p["agency"] = "RTD Denver"
            p["agency_id"] = "rtd"
        deduped.append(f)
    all_features = deduped
    log(f"Dedup: {pre_count} → {len(all_features)} unique routes "
        f"({pre_count - len(all_features)} duplicates removed across "
        f"agencies with multiple MDB entries)")
    # Reflect the dedup back into the result dict (assignment above
    # broke the original reference, so result["features"] still points
    # at the un-deduped list).
    result["features"] = all_features
    result["meta"]["feature_count"] = len(all_features)

    # Trim coordinate precision to 5 decimal places (~1.1m at equator,
    # ample for transit route polylines). Combined with compact JSON
    # (no indent), this keeps the output ~50 MB even at 60+ agencies —
    # well under GitHub's 100 MB single-file limit.
    def _trim_coords(geom: dict) -> dict:
        if not geom:
            return geom
        gt = geom.get("type")
        coords = geom.get("coordinates")
        if gt == "LineString":
            geom["coordinates"] = [[round(c[0], 5), round(c[1], 5)] for c in coords]
        elif gt == "MultiLineString":
            geom["coordinates"] = [
                [[round(c[0], 5), round(c[1], 5)] for c in line] for line in coords
            ]
        elif gt == "Polygon":
            geom["coordinates"] = [
                [[round(c[0], 5), round(c[1], 5)] for c in ring] for ring in coords
            ]
        return geom

    for f in result.get("features", []):
        if "geometry" in f:
            _trim_coords(f["geometry"])

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        # Compact: no indent, no whitespace separators. Saves ~70% of file
        # size vs `indent=2`. The file is read programmatically; pretty-
        # printing adds no human value at this scale.
        json.dump(result, fh, separators=(",", ":"), ensure_ascii=False)

    n = len(result.get("features", []))
    out_size_mb = OUT_FILE.stat().st_size / 1024 / 1024
    log(f"✓ Wrote {n} transit route features from "
        f"{len(agencies_ok)}/{len(feeds)} agencies to {OUT_FILE} ({out_size_mb:.1f} MB)")
    if agencies_failed:
        log(f"  ⚠ {len(agencies_failed)} agencies failed (see agencies_failed in output)", level="WARN")
    return 0


if __name__ == "__main__":
    sys.exit(main())