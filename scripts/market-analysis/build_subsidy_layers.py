"""
scripts/market-analysis/build_subsidy_layers.py

Generates data/derived/market-analysis/subsidy_layers.json from HUD LIHTC data.
Reads:  data/market/hud_lihtc_co.geojson
Writes: data/derived/market-analysis/subsidy_layers.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = REPO_ROOT / "data" / "market" / "hud_lihtc_co.geojson"
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "subsidy_layers.json"

# Colorado county name → 5-digit FIPS mapping (all 64 counties, Rule 1)
CO_COUNTY_FIPS = {
    "adams": "08001", "alamosa": "08003", "arapahoe": "08005", "archuleta": "08007",
    "baca": "08009", "bent": "08011", "boulder": "08013", "broomfield": "08014",
    "chaffee": "08015", "cheyenne": "08017", "clear creek": "08019", "conejos": "08021",
    "costilla": "08023", "crowley": "08025", "custer": "08027", "delta": "08029",
    "denver": "08031", "dolores": "08033", "douglas": "08035", "eagle": "08037",
    "el paso": "08041", "elbert": "08039", "fremont": "08043", "garfield": "08045",
    "gilpin": "08047", "grand": "08049", "gunnison": "08051", "hinsdale": "08053",
    "huerfano": "08055", "jackson": "08057", "jefferson": "08059", "kiowa": "08061",
    "kit carson": "08063", "la plata": "08067", "lake": "08065", "larimer": "08069",
    "las animas": "08071", "lincoln": "08073", "logan": "08075", "mesa": "08077",
    "mineral": "08079", "moffat": "08081", "montezuma": "08083", "montrose": "08085",
    "morgan": "08087", "otero": "08089", "ouray": "08091", "park": "08093",
    "phillips": "08095", "pitkin": "08097", "prowers": "08099", "pueblo": "08101",
    "rio blanco": "08103", "rio grande": "08105", "routt": "08107", "saguache": "08109",
    "san juan": "08111", "san miguel": "08113", "sedgwick": "08115", "summit": "08117",
    "teller": "08119", "washington": "08121", "weld": "08123", "yuma": "08125",
}


def _county_name_to_fips(county_raw: str) -> str | None:
    """Map a county name string to a 5-digit Colorado FIPS code.
    Returns the FIPS string if found, or None if the county is unrecognized.
    """
    normalized = county_raw.strip().lower()
    # Strip common suffixes like " county", " co."
    for suffix in (" county", " co.", " co"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)].strip()
    return CO_COUNTY_FIPS.get(normalized)


STUB = {
    "meta": {
        "generated": "",
        "source": "HUD LIHTC",
        "note": "Stub — input file not found. Run LIHTC data fetch first.",
    },
    "summary": {"total_projects": 0, "total_units": 0},
    "by_county": {},
}


def _safe_int(val, default=0):
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def build(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    if not input_path.exists():
        print(f"  WARNING: {input_path} not found — writing stub output.")
        stub = STUB.copy()
        stub["meta"]["generated"] = now
        output_path.write_text(json.dumps(stub, indent=2))
        print(f"  Wrote stub → {output_path}")
        return

    print(f"  Reading {input_path} …")
    raw = json.loads(input_path.read_text())
    features = raw.get("features", [])
    print(f"  Found {len(features)} LIHTC features.")

    by_county: dict = {}
    total_units = 0

    for feat in features:
        props = feat.get("properties") or {}
        # HUD LIHTC GeoJSON uses a COUNTY name field, not a numeric FIPS code.
        # Map county name → 5-digit Colorado FIPS (Rule 1: must be 5-digit string).
        county_raw = (
            props.get("COUNTY")
            or props.get("county")
            or props.get("COUNTY_NAME")
            or ""
        )
        fips = _county_name_to_fips(county_raw) if county_raw else None
        if not fips:
            if county_raw:
                print(f"  WARNING: unrecognized county '{county_raw}' — skipping record.")
            else:
                print("  WARNING: record has no COUNTY field — skipping.")
            continue

        units = _safe_int(
            props.get("li_units")
            or props.get("LI_UNITS")
            or props.get("n_units")
            or props.get("N_UNITS")
            or 0
        )
        yr = _safe_int(
            props.get("yr_pis") or props.get("YR_PIS") or props.get("year") or 0
        )

        if fips not in by_county:
            by_county[fips] = {"projects": 0, "units": 0, "_yr_sum": 0, "_yr_count": 0}

        by_county[fips]["projects"] += 1
        by_county[fips]["units"] += units
        total_units += units
        if yr > 0:
            by_county[fips]["_yr_sum"] += yr
            by_county[fips]["_yr_count"] += 1

    # Compute avg year and remove internal accumulators
    clean_by_county = {}
    for fips, data in by_county.items():
        avg_yr = (
            round(data["_yr_sum"] / data["_yr_count"])
            if data["_yr_count"] > 0
            else 0
        )
        clean_by_county[fips] = {
            "projects": data["projects"],
            "units": data["units"],
            "avg_year": avg_yr,
        }

    result = {
        "meta": {
            "generated": now,
            "source": "HUD LIHTC",
        },
        "summary": {
            "total_projects": len(features),
            "total_units": total_units,
        },
        "by_county": clean_by_county,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Aggregated {len(features)} projects across {len(clean_by_county)} counties → {output_path}")


if __name__ == "__main__":
    print("Building subsidy_layers.json …")
    build(INPUT_PATH, OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
