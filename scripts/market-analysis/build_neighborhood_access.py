"""
scripts/market-analysis/build_neighborhood_access.py

Generates data/derived/market-analysis/neighborhood_access.json.

This is a placeholder script. Live amenity access buffering requires a
PostGIS/OSM pipeline. Running this script writes a valid stub JSON so that
downstream consumers have a well-formed file to parse.

Writes: data/derived/market-analysis/neighborhood_access.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "neighborhood_access.json"


def build(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    result = {
        "meta": {
            "generated": now,
            "note": "Stub — run with OSM data for live access scores",
        },
        "amenities": [],
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Wrote stub → {output_path}")


if __name__ == "__main__":
    print("Building neighborhood_access.json …")
    build(OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
