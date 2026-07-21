#!/usr/bin/env python3
"""Build a compact Colorado tract-to-tract LODES OD matrix.

D-F1 data substrate for the future commute-shaped PMA mode. This script is
data-only: it aggregates block-level LODES OD Main rows exactly to 2020 tract
GEOIDs, retains the smallest descending jobs pair set that covers the declared
statewide flow share, and writes a minified JSON artifact for later opt-in use.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from build_place_od_flows import OD_URL_TMPL, RAW_DIR, _download

REPO = Path(__file__).resolve().parents[2]
OUT_PATH = REPO / "data" / "market" / "lodes_tract_od_co.json"

LODES_VERSION = "LODES8"
STATE_FIPS = "08"
DEFAULT_YEAR = 2023
DEFAULT_COVERAGE_FLOOR = 0.95
FALLBACK_COVERAGE_FLOOR = 0.90
MAX_MINIFIED_BYTES = 25 * 1024 * 1024


def iso_today() -> str:
    return date.today().isoformat()


def review_by(days: int = 90) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _tract_from_block(raw: str) -> str | None:
    geocode = (raw or "").strip()
    if len(geocode) < 11:
        return None
    tract = geocode[:11]
    if len(tract) != 11 or not tract.isdigit() or not tract.startswith(STATE_FIPS):
        return None
    return tract


def _stream_tract_pairs(od_path: Path) -> tuple[dict[tuple[str, str], int], int, int]:
    pairs: dict[tuple[str, str], int] = defaultdict(int)
    rows_streamed = 0
    total_flow = 0
    with gzip.open(od_path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows_streamed += 1
            home_tract = _tract_from_block(row.get("h_geocode") or "")
            work_tract = _tract_from_block(row.get("w_geocode") or "")
            if not home_tract or not work_tract:
                continue
            try:
                jobs = int(row.get("S000") or 0)
            except ValueError:
                continue
            if jobs <= 0:
                continue
            pairs[(home_tract, work_tract)] += jobs
            total_flow += jobs
    return pairs, rows_streamed, total_flow


def _select_pairs(sorted_pairs: list[tuple[tuple[str, str], int]], total_flow: int, floor: float):
    retained = []
    retained_flow = 0
    cutoff = None
    for (home_tract, work_tract), jobs in sorted_pairs:
        retained.append([home_tract, work_tract, jobs])
        retained_flow += jobs
        cutoff = jobs
        if total_flow and retained_flow / total_flow >= floor:
            break
    return retained, retained_flow, cutoff


def _build_payload(year: int, od_url: str, od_path: Path, refetch: bool):
    pairs, rows_streamed, total_flow = _stream_tract_pairs(od_path)
    if not pairs or not total_flow:
        raise RuntimeError("LODES OD aggregation produced no Colorado tract pairs")

    sorted_pairs = sorted(pairs.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))
    coverage_floor = DEFAULT_COVERAGE_FLOOR
    retained, retained_flow, cutoff = _select_pairs(sorted_pairs, total_flow, coverage_floor)

    generated_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "meta": {
            "source": "LEHD LODES8 Origin-Destination (OD Main, All Jobs)",
            "source_url": od_url,
            "lodes_version": LODES_VERSION,
            "vintage": str(year),
            "year": year,
            "fetch_date": iso_today(),
            "generated_at": generated_at,
            "as_of": iso_today(),
            "last_verified": iso_today(),
            "review_by": review_by(),
            "generated_by": "scripts/hna/build_tract_od_matrix.py",
            "raw_cache_file": str(od_path.relative_to(REPO)),
            "context_only": True,
            "not_scoring_input": True,
            "state_fips": STATE_FIPS,
            "rows_streamed": rows_streamed,
            "unique_pair_count": len(pairs),
            "total_flow": total_flow,
            "coverage_floor": coverage_floor,
            "retained_pair_count": len(retained),
            "retained_flow": retained_flow,
            "dropped_flow": total_flow - retained_flow,
            "retained_flow_share": round(retained_flow / total_flow, 6),
            "dropped_flow_share": round((total_flow - retained_flow) / total_flow, 6),
            "minimum_jobs_cutoff": cutoff,
            "compression_rule": (
                "Rows are sorted by descending S000 jobs and the smallest pair set "
                "covering the declared statewide flow share is retained. The cutoff "
                "is an implied compression disclosure, not a modeling threshold."
            ),
            "methodology": (
                "Aggregates Colorado LODES OD Main JT00 block-level rows exactly to "
                "2020 Census tract GEOIDs using the first 11 digits of each 15-digit "
                "home and work block geocode; sums S000 per home_tract/work_tract pair."
            ),
            "citation": (
                "U.S. Census Bureau, Longitudinal Employer-Household Dynamics, "
                "LODES Origin-Destination Employment Statistics, public-domain data."
            ),
            "limitations": [
                "LODES is synthetic-noise-protected jobs data and is not a household survey.",
                "This artifact is context-only until the D-F2 commute-shaped PMA mode consumes it behind an explicit default-off toggle.",
                "The retained-pair floor is coverage-defined compression only; it is not a scoring or tract-selection rule.",
            ],
        },
        "pairs": retained,
    }

    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_MINIFIED_BYTES and coverage_floor > FALLBACK_COVERAGE_FLOOR:
        coverage_floor = FALLBACK_COVERAGE_FLOOR
        retained, retained_flow, cutoff = _select_pairs(sorted_pairs, total_flow, coverage_floor)
        payload["pairs"] = retained
        payload["meta"]["coverage_floor"] = coverage_floor
        payload["meta"]["retained_pair_count"] = len(retained)
        payload["meta"]["retained_flow"] = retained_flow
        payload["meta"]["dropped_flow"] = total_flow - retained_flow
        payload["meta"]["retained_flow_share"] = round(retained_flow / total_flow, 6)
        payload["meta"]["dropped_flow_share"] = round((total_flow - retained_flow) / total_flow, 6)
        payload["meta"]["minimum_jobs_cutoff"] = cutoff
        payload["meta"]["size_floor_adjustment"] = (
            "95% coverage exceeded the ~25 MB minified size target; retained floor lowered to 90% and disclosed."
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR, help=f"LODES OD year (default {DEFAULT_YEAR})")
    parser.add_argument("--refetch", action="store_true", help="force re-download even if cached")
    args = parser.parse_args()

    od_url = OD_URL_TMPL.format(year=args.year)
    od_path = RAW_DIR / f"co_od_main_JT00_{args.year}.csv.gz"
    _download(od_url, od_path, args.refetch)

    print("[lodes-tract-od] streaming OD rows and aggregating tract pairs…", file=sys.stderr)
    payload = _build_payload(args.year, od_url, od_path, args.refetch)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)
        handle.write("\n")

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    meta = payload["meta"]
    print(
        f"[lodes-tract-od] wrote {meta['retained_pair_count']:,} pairs "
        f"covering {meta['retained_flow_share']:.2%} of {meta['total_flow']:,} jobs "
        f"→ {OUT_PATH.relative_to(REPO)} ({size_mb:.1f} MB)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
