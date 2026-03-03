#!/usr/bin/env python3
"""
build_public_market_data.py
Build Colorado market data artifacts from public sources.

Outputs (written to data/market/):
  tract_centroids_co.json    — Tract centroid FeatureCollection (TIGER)
  acs_tract_metrics_co.json  — ACS 5-year tract metrics (Census API)
  hud_lihtc_co.geojson       — HUD LIHTC Colorado projects (HUD LIHTC database)

Usage:
  python scripts/market/build_public_market_data.py [--out-dir data/market]

Optional environment variables:
  CENSUS_API_KEY   — Census Bureau API key (speeds up ACS requests; not required)
  HUD_LIHTC_URL    — Override HUD LIHTC CSV download URL

GitHub Actions: see .github/workflows/build-market-data.yml
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import zipfile
import io
from datetime import date

TIGERWEB_TRACTS = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/8/query"
    "?where=STATE%3D%2708%27&outFields=GEOID%2CNAME&returnGeometry=true&returnCentroid=true"
    "&geometryType=esriGeometryPolygon&f=geojson&outSR=4326&resultRecordCount=2000"
)

ACS_BASE = "https://api.census.gov/data/2022/acs/acs5"
ACS_VARS = [
    "B25070_001E",  # Renter households
    "B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E",  # Cost-burdened ≥30%
    "B25001_001E",  # Total housing units
    "B25002_003E",  # Vacant units
    "B25064_001E",  # Median gross rent
    "B19013_001E",  # Median household income
]

HUD_LIHTC_URL_DEFAULT = (
    "https://www.huduser.gov/portal/datasets/lihtc/LIHTCPUB.zip"
)
TODAY = date.today().isoformat()


def fetch_url(url, timeout=60, retries=2):
    """Fetch URL with retry logic."""
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch {url} after {retries+1} attempts: {last_err}")


def build_tract_centroids(out_dir):
    """Fetch Colorado tract centroids from TIGERweb."""
    print("Fetching tract centroids from TIGERweb...", flush=True)
    try:
        raw = fetch_url(TIGERWEB_TRACTS)
        geo = json.loads(raw)
        features = geo.get("features", [])
        # Extract centroids from polygon geometry
        centroids = []
        for f in features:
            geoid = (f.get("properties") or {}).get("GEOID", "")
            centroid = f.get("centroid") or {}
            if not centroid:
                # Fall back to computing centroid from first ring
                geom = f.get("geometry") or {}
                coords = geom.get("coordinates") or []
                if coords and coords[0]:
                    ring = coords[0]
                    cx = sum(p[0] for p in ring) / len(ring)
                    cy = sum(p[1] for p in ring) / len(ring)
                    centroid = {"x": cx, "y": cy}
            if centroid:
                centroids.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [centroid["x"], centroid["y"]]},
                    "properties": {"GEOID": geoid}
                })
        result = {
            "_updated": TODAY,
            "_source": "US Census TIGERweb ArcGIS REST API",
            "_note": "Tract centroids for Colorado census tracts.",
            "type": "FeatureCollection",
            "features": centroids
        }
        print(f"  → {len(centroids)} tract centroids", flush=True)
    except Exception as exc:
        print(f"  WARNING: TIGERweb fetch failed ({exc}). Writing empty seed.", flush=True)
        result = {
            "_updated": TODAY,
            "_source": "US Census TIGERweb (fetch failed)",
            "_error": str(exc),
            "type": "FeatureCollection",
            "features": []
        }
    out_path = os.path.join(out_dir, "tract_centroids_co.json")
    with open(out_path, "w") as f:
        json.dump(result, f, separators=(",", ":"))
    print(f"  Wrote {out_path}", flush=True)


def build_acs_metrics(out_dir, api_key=None):
    """Fetch ACS 5-year tract metrics for Colorado."""
    print("Fetching ACS 5-year tract metrics...", flush=True)
    var_str = ",".join(ACS_VARS)
    params = {"get": var_str, "for": "tract:*", "in": "state:08"}
    if api_key:
        params["key"] = api_key
    url = ACS_BASE + "?" + urllib.parse.urlencode(params)
    try:
        raw = fetch_url(url)
        rows = json.loads(raw)
        headers = rows[0]
        tracts = []
        for row in rows[1:]:
            def get_val(name):
                try:
                    i = headers.index(name)
                    v = row[i]
                    return int(v) if v not in (None, "-666666666", "") else None
                except (ValueError, IndexError):
                    return None

            renter_hh = get_val("B25070_001E")
            burdened = sum(filter(None, [
                get_val("B25070_007E"), get_val("B25070_008E"),
                get_val("B25070_009E"), get_val("B25070_010E")
            ]))
            total_units = get_val("B25001_001E")
            vacant = get_val("B25002_003E")
            med_rent = get_val("B25064_001E")
            med_inc = get_val("B19013_001E")

            state_fips = row[headers.index("state")] if "state" in headers else "08"
            county_fips = row[headers.index("county")] if "county" in headers else ""
            tract_fips = row[headers.index("tract")] if "tract" in headers else ""
            geoid = state_fips + county_fips + tract_fips

            tracts.append({
                "tract_geoid": geoid,
                "renter_households": renter_hh,
                "cost_burden_rate": (burdened / renter_hh) if renter_hh else None,
                "vacancy_rate": (vacant / total_units) if total_units else None,
                "median_gross_rent": med_rent,
                "median_household_income": med_inc,
            })
        result = {
            "_updated": TODAY,
            "_source": "US Census ACS 5-year estimates (2022), via api.census.gov",
            "_note": "Tract-level metrics for Colorado. Key fields: tract_geoid, cost_burden_rate, renter_households, median_gross_rent, median_household_income, vacancy_rate.",
            "tracts": tracts
        }
        print(f"  → {len(tracts)} tracts", flush=True)
    except Exception as exc:
        print(f"  WARNING: ACS fetch failed ({exc}). Writing empty seed.", flush=True)
        result = {
            "_updated": TODAY,
            "_source": "US Census ACS 5-year estimates (fetch failed)",
            "_error": str(exc),
            "tracts": []
        }
    out_path = os.path.join(out_dir, "acs_tract_metrics_co.json")
    with open(out_path, "w") as f:
        json.dump(result, f, separators=(",", ":"))
    print(f"  Wrote {out_path}", flush=True)


def build_hud_lihtc(out_dir, hud_url=None):
    """Download HUD LIHTC zip and extract Colorado records."""
    url = hud_url or os.environ.get("HUD_LIHTC_URL", HUD_LIHTC_URL_DEFAULT)
    print(f"Fetching HUD LIHTC data from {url}...", flush=True)
    features = []
    try:
        raw = fetch_url(url, timeout=120)
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            csv_files = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if not csv_files:
                raise RuntimeError("No CSV found in HUD LIHTC zip")
            with zf.open(csv_files[0]) as cf:
                import csv as csvmod
                reader = csvmod.DictReader(io.TextIOWrapper(cf, encoding="latin-1"))
                for row in reader:
                    st = (row.get("ST") or row.get("STATE") or "").strip().upper()
                    if st not in ("CO", "08", "COLORADO"):
                        continue
                    try:
                        lat = float(row.get("LATITUDE") or row.get("LAT") or 0)
                        lng = float(row.get("LONGITUDE") or row.get("LON") or 0)
                    except (ValueError, TypeError):
                        lat, lng = 0.0, 0.0
                    props = {
                        "PROJECT": row.get("PROJECT") or row.get("PROJ_NAME") or "",
                        "PROJ_CTY": row.get("PROJ_CTY") or row.get("CITY") or "",
                        "N_UNITS": row.get("N_UNITS") or row.get("UNITS") or 0,
                        "LI_UNITS": row.get("LI_UNITS") or row.get("LOW_INCOME_UNITS") or 0,
                        "YR_PIS": row.get("YR_PIS") or row.get("YEAR_PIS") or "",
                        "CREDIT": row.get("CREDIT") or "",
                        "CNTY_NAME": row.get("CNTY_NAME") or row.get("COUNTY") or "",
                    }
                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lng, lat]},
                        "properties": props
                    })
        print(f"  → {len(features)} Colorado LIHTC projects", flush=True)
    except Exception as exc:
        print(f"  WARNING: HUD LIHTC fetch failed ({exc}). Writing empty seed.", flush=True)

    result = {
        "_updated": TODAY,
        "_source": "HUD LIHTC Public Database",
        "_note": "HUD LIHTC projects in Colorado.",
        "type": "FeatureCollection",
        "features": features
    }
    out_path = os.path.join(out_dir, "hud_lihtc_co.geojson")
    with open(out_path, "w") as f:
        json.dump(result, f, separators=(",", ":"))
    print(f"  Wrote {out_path}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Build Colorado public market data artifacts.")
    parser.add_argument("--out-dir", default="data/market", help="Output directory (default: data/market)")
    parser.add_argument("--skip-lihtc", action="store_true", help="Skip HUD LIHTC download")
    args = parser.parse_args()

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    api_key = os.environ.get("CENSUS_API_KEY")
    hud_url = os.environ.get("HUD_LIHTC_URL")

    build_tract_centroids(out_dir)
    build_acs_metrics(out_dir, api_key=api_key)
    if not args.skip_lihtc:
        build_hud_lihtc(out_dir, hud_url=hud_url)
    else:
        print("Skipping HUD LIHTC (--skip-lihtc)", flush=True)

    print(f"\nDone. Artifacts written to {out_dir}/", flush=True)


if __name__ == "__main__":
    main()
