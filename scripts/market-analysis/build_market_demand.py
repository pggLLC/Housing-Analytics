"""
scripts/market-analysis/build_market_demand.py

Generates data/derived/market-analysis/market_demand.json from ACS tract data.
Reads:  data/market/acs_tract_metrics_co.json
Writes: data/derived/market-analysis/market_demand.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = REPO_ROOT / "data" / "market" / "acs_tract_metrics_co.json"
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "market_demand.json"

STUB = {
    "meta": {
        "generated": "",
        "source": "ACS 5-Year",
        "tract_count": 0,
        "note": "Stub — input file not found. Run ACS data fetch first.",
    },
    "statewide": {
        "mean_cost_burden_rate": 0.0,
        "mean_median_gross_rent": 0,
        "mean_renter_share": 0.0,
        "total_population": 0,
        "high_burden_tracts": 0,
    },
    "tracts": [],
}


def _safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(val, default=0):
    try:
        return int(val) if val is not None else default
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
    tracts = raw.get("tracts", [])
    print(f"  Found {len(tracts)} tracts.")

    cost_burdens, rents, renter_shares, populations = [], [], [], []
    high_burden_count = 0
    output_tracts = []

    for t in tracts:
        cb = _safe_float(t.get("cost_burden_rate"))
        rent = _safe_int(t.get("median_gross_rent"))
        # ACS tract data stores raw counts; compute renter share from them
        total_hh = _safe_int(t.get("total_hh"))
        renter_hh = _safe_int(t.get("renter_hh"))
        rs = round(renter_hh / total_hh, 4) if total_hh > 0 else 0.0
        # ACS tract data uses "pop" (not "total_population")
        total_pop = _safe_int(t.get("pop"))

        cost_burdens.append(cb)
        if rent > 0:
            rents.append(rent)
        renter_shares.append(rs)
        if total_pop > 0:
            populations.append(total_pop)
        if cb >= 0.3:
            high_burden_count += 1

        output_tracts.append({
            "geoid": t.get("geoid", ""),
            "cost_burden_rate": cb,
            "median_gross_rent": rent,
            "renter_share": rs,
            "total_population": total_pop,
        })

    def _mean(lst):
        return round(sum(lst) / len(lst), 4) if lst else 0.0

    result = {
        "meta": {
            "generated": now,
            "source": "ACS 5-Year",
            "tract_count": len(tracts),
        },
        "statewide": {
            "mean_cost_burden_rate": _mean(cost_burdens),
            "mean_median_gross_rent": round(_mean(rents)),
            "mean_renter_share": _mean(renter_shares),
            "total_population": sum(populations),
            "high_burden_tracts": high_burden_count,
        },
        "tracts": output_tracts,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Wrote {len(output_tracts)} tracts → {output_path}")


if __name__ == "__main__":
    print("Building market_demand.json …")
    build(INPUT_PATH, OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
