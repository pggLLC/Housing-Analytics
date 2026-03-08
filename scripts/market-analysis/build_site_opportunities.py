"""
scripts/market-analysis/build_site_opportunities.py

Generates data/derived/market-analysis/site_opportunities.json.
Scores each Colorado census tract using a simplified demand/supply model and
returns the top-50 tracts sorted by composite score.

Reads:
  data/market/acs_tract_metrics_co.json
  data/market/tract_centroids_co.json
Writes:
  data/derived/market-analysis/site_opportunities.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ACS_PATH = REPO_ROOT / "data" / "market" / "acs_tract_metrics_co.json"
CENTROIDS_PATH = REPO_ROOT / "data" / "market" / "tract_centroids_co.json"
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "site_opportunities.json"

TOP_N = 50

STUB = {
    "meta": {
        "generated": "",
        "note": "Stub — input files not found. Run ACS/centroids data fetch first.",
    },
    "opportunities": [],
}


def _safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _score_tract(cb: float, rs: float) -> dict:
    """
    Simplified demand score (0-100):
      - Cost burden weight: 60 % (higher burden → more affordable-housing need)
      - Renter share weight: 40 % (higher renter share → broader eligible pool)
    Both inputs normalized to [0, 1] using expected ranges:
      cost_burden_rate: 0.0 – 0.6
      renter_share:     0.0 – 1.0
    """
    cb_norm = min(max(cb / 0.6, 0.0), 1.0)
    rs_norm = min(max(rs, 0.0), 1.0)
    demand = cb_norm * 0.6 + rs_norm * 0.4
    score = round(demand * 100, 1)
    return {"score": score, "demand_score": round(demand * 100, 1)}


def build(acs_path: Path, centroids_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    if not acs_path.exists() or not centroids_path.exists():
        missing = [str(p) for p in (acs_path, centroids_path) if not p.exists()]
        print(f"  WARNING: missing input(s): {missing} — writing stub output.")
        stub = STUB.copy()
        stub["meta"]["generated"] = now
        output_path.write_text(json.dumps(stub, indent=2))
        print(f"  Wrote stub → {output_path}")
        return

    print(f"  Reading {acs_path} …")
    acs_raw = json.loads(acs_path.read_text())
    acs_tracts = {t["geoid"]: t for t in acs_raw.get("tracts", []) if t.get("geoid")}
    print(f"  {len(acs_tracts)} ACS tracts loaded.")

    print(f"  Reading {centroids_path} …")
    cent_raw = json.loads(centroids_path.read_text())
    centroids = {t["geoid"]: t for t in cent_raw.get("tracts", []) if t.get("geoid")}
    print(f"  {len(centroids)} centroid records loaded.")

    opportunities = []
    for geoid, acs in acs_tracts.items():
        centroid = centroids.get(geoid)
        lat = _safe_float((centroid or {}).get("lat"))
        lon = _safe_float((centroid or {}).get("lon"))
        cb = _safe_float(acs.get("cost_burden_rate"))
        # Compute renter share from raw household counts (field is "pop"/"renter_hh")
        total_hh = _safe_float(acs.get("total_hh"))
        renter_hh = _safe_float(acs.get("renter_hh"))
        rs = round(renter_hh / total_hh, 4) if total_hh > 0 else 0.0
        scores = _score_tract(cb, rs)
        opportunities.append({
            "geoid": geoid,
            "lat": lat,
            "lon": lon,
            "score": scores["score"],
            "demand_score": scores["demand_score"],
            "cost_burden_rate": round(cb, 4),
            "renter_share": round(rs, 4),
        })

    # Sort descending by score, take top N
    opportunities.sort(key=lambda x: x["score"], reverse=True)
    top = opportunities[:TOP_N]

    result = {
        "meta": {"generated": now},
        "opportunities": top,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Scored {len(opportunities)} tracts, top {len(top)} written → {output_path}")


if __name__ == "__main__":
    print("Building site_opportunities.json …")
    build(ACS_PATH, CENTROIDS_PATH, OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
