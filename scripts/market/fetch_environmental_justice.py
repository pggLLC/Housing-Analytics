#!/usr/bin/env python3
"""
scripts/market/fetch_environmental_justice.py

Fetch CDC Environmental Justice Index (EJI) data for Colorado census tracts.
Replaces the defunct EPA EJScreen service (offline since Feb 2025).

The EJI provides tract-level environmental burden, social vulnerability,
and health vulnerability scores used for LIHTC site feasibility assessments.

Output:
    data/market/environmental_constraints_co.geojson

Usage:
    python3 scripts/market/fetch_environmental_justice.py

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "environmental_constraints_co.geojson"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_eji_cache"
CACHE_TTL_HOURS = 720  # 30 days

# CDC Environmental Justice Index 2022 — public ArcGIS MapServer
EJI_URL = (
    "https://onemap.cdc.gov/onemapservices/rest/services/"
    "EJI/Environmental_Justice_Index_2022/MapServer/64"
)


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg, level="INFO"):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / hashlib.md5(url.encode()).hexdigest()


def fetch_url(url, retries=3, timeout=90):
    cache_file = _cache_key(url)
    if cache_file.exists():
        age = (time.time() - cache_file.stat().st_mtime) / 3600
        if age < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 5 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def fetch_eji():
    """Fetch CDC EJI data for Colorado tracts with polygon geometry."""
    log("Fetching CDC Environmental Justice Index for Colorado…")
    all_features = []
    offset = 0

    while True:
        params = urllib.parse.urlencode({
            "where": "STATEFP='08'",
            "outFields": "GEOID,STATEFP,COUNTYFP,TRACTCE,"
                         "RPL_EJI,RPL_EBM,RPL_SVM,RPL_HVM",
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": "2000",
            "resultOffset": str(offset),
        })
        url = f"{EJI_URL}/query?{params}"
        try:
            data = json.loads(fetch_url(url, timeout=120))
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError(data["error"].get("message", ""))
            feats = data.get("features", [])
            # Convert ArcGIS JSON to pseudo-GeoJSON features
            for feat in feats:
                attrs = feat.get("attributes", {})
                feat["properties"] = attrs
            all_features.extend(feats)
            log(f"  Page {offset // 2000 + 1}: {len(feats)} tracts (total: {len(all_features)})")
            if not feats or not data.get("exceededTransferLimit"):
                break
            offset += len(feats)
            time.sleep(0.3)
        except Exception as exc:
            log(f"  Fetch failed at offset {offset}: {exc}", level="WARN")
            break

    log(f"Total EJI tracts fetched: {len(all_features)}")
    return all_features


def classify_risk(eji_percentile):
    """Classify EJI percentile into risk categories."""
    if eji_percentile is None or eji_percentile < 0:
        return "unknown"
    if eji_percentile >= 0.75:
        return "high"
    if eji_percentile >= 0.50:
        return "moderate"
    return "low"


def load_tract_centroids():
    """Load tract centroids for point geometry."""
    centroid_file = ROOT / "data" / "market" / "tract_centroids_co.json"
    if centroid_file.exists():
        data = json.loads(centroid_file.read_text())
        return {t["geoid"]: (t["lat"], t["lon"]) for t in data.get("tracts", [])}
    return {}


def normalize_features(raw_features):
    """Normalize EJI features to consistent schema with point geometry from centroids."""
    centroids = load_tract_centroids()
    features = []
    for f in raw_features:
        p = f.get("properties") or {}
        geoid = str(p.get("GEOID", ""))
        eji = p.get("RPL_EJI")
        ebm = p.get("RPL_EBM")
        svm = p.get("RPL_SVM")
        hvm = p.get("RPL_HVM")

        # Convert -999 sentinel values to None
        if eji is not None and eji < 0:
            eji = None
        if ebm is not None and ebm < 0:
            ebm = None
        if svm is not None and svm < 0:
            svm = None
        if hvm is not None and hvm < 0:
            hvm = None

        # Get geometry from centroids
        geom = None
        if geoid in centroids:
            lat, lon = centroids[geoid]
            geom = {"type": "Point", "coordinates": [lon, lat]}
        elif f.get("geometry"):
            geom = f.get("geometry")
        else:
            continue  # Skip tracts without coordinates

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "geoid": geoid,
                "name": f"Tract {geoid[-6:]}" if len(geoid) >= 6 else geoid,
                "county_fips": geoid[:5] if len(geoid) >= 5 else "",
                "eji_percentile": round(eji, 3) if eji is not None else None,
                "env_burden": round(ebm, 3) if ebm is not None else None,
                "social_vuln": round(svm, 3) if svm is not None else None,
                "health_vuln": round(hvm, 3) if hvm is not None else None,
                "risk_category": classify_risk(eji),
                "source": "CDC EJI 2022",
            },
        })

    return features


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    raw = fetch_eji()
    features = normalize_features(raw)

    high_risk = sum(1 for f in features if f["properties"]["risk_category"] == "high")
    moderate = sum(1 for f in features if f["properties"]["risk_category"] == "moderate")

    log(f"Built {len(features)} EJI features ({high_risk} high-risk, {moderate} moderate)")

    if not features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing environmental_constraints_co.geojson")
            return 0

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "CDC Environmental Justice Index (EJI) 2022",
            "url": "https://www.atsdr.cdc.gov/placeandhealth/eji/index.html",
            "state": "Colorado",
            "state_fips": "08",
            "generated": generated,
            "feature_count": len(features),
            "high_risk_tracts": high_risk,
            "moderate_risk_tracts": moderate,
            "note": "Replaces defunct EPA EJScreen. Rebuild via scripts/market/fetch_environmental_justice.py",
        },
        "features": features,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(features)} EJI features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
