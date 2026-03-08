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
        # FIPS: prefer fips5 → county_fips → first 5 chars of tract GEOID
        fips = (
            props.get("fips5")
            or props.get("county_fips")
            or props.get("COUNTY_FIPS")
            or props.get("censustract", "")[:5]
        )
        if not fips:
            fips = "UNKNOWN"
        # Pad to 5 digits if it looks like a short code, then validate
        if fips.isdigit() and len(fips) <= 5:
            fips = fips.zfill(5)
        # Only accept valid Colorado county FIPS (08001–08125); reject anything else
        if len(fips) != 5 or not fips.startswith('08'):
            fips = "UNKNOWN"

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
