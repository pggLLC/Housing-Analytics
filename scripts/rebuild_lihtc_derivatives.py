#!/usr/bin/env python3
"""
scripts/rebuild_lihtc_derivatives.py
=====================================
Rebuild LIHTC files that derive from data/chfa-lihtc.json so they stay
consistent with the canonical snapshot after each CHFA refresh.

Targets
-------
1. data/lihtc-trends-by-county.json
     Per-county allocation counts by year (used by market-intelligence
     chart). Built fresh: every county × every year in coverage range.

2. data/co-historical-allocations.json
     Statewide yearly rollup with project counts, unit counts, credit-type
     split, QCT/DDA share. Preserves manual fields (irsPerCapita,
     policyNote, hudDataStatus) on existing rows; appends new years.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = REPO_ROOT / "data" / "chfa-lihtc.json"
TRENDS_OUT = REPO_ROOT / "data" / "lihtc-trends-by-county.json"
HISTORY_OUT = REPO_ROOT / "data" / "co-historical-allocations.json"


def _yes(v) -> bool:
    return str(v or "").strip().upper() in ("Y", "YES", "1", "TRUE", "2")


def _int(v, default=None):
    try:
        n = int(v)
        return n
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def rebuild_trends_by_county(features: list) -> dict:
    """Per-county YR_ALLOC year-count series for 2015–latest year."""
    years_in_data = set()
    by_county_year = defaultdict(lambda: defaultdict(int))
    for f in features:
        p = (f or {}).get("properties") or {}
        county = (p.get("CNTY_NAME") or "").strip()
        year = _int(p.get("YR_ALLOC"))
        if not county or not year or year < 1988 or year > 2030:
            continue
        years_in_data.add(year)
        by_county_year[county][year] += 1

    # Trend chart covers the last ~11 years of meaningful CHFA detail.
    max_year = max(years_in_data) if years_in_data else 2025
    min_year = max(2015, max_year - 10)
    years = list(range(min_year, max_year + 1))

    counties_out = {}
    for county, series in sorted(by_county_year.items()):
        counties_out[county] = {str(y): series.get(y, 0) for y in years}

    return {
        "updated": _now_iso()[:10],
        "source": "CHFA Housing Tax Credit Properties (live ArcGIS FeatureServer)",
        "note": (
            "Counts derive from YR_ALLOC (reservation year). Built by "
            "scripts/rebuild_lihtc_derivatives.py from data/chfa-lihtc.json."
        ),
        "years": years,
        "counties": counties_out,
    }


def rebuild_historical_allocations(features: list, existing: dict) -> dict:
    """Statewide yearly aggregate with manual fields preserved."""
    # Aggregate raw features by YR_ALLOC.
    agg = defaultdict(lambda: {
        "projects": 0, "liUnits": 0, "totalUnits": 0,
        "credit9pct": 0, "credit4pct": 0, "creditBoth": 0,
        "nonProfit": 0, "qct": 0, "dda": 0,
    })
    for f in features:
        p = (f or {}).get("properties") or {}
        year = _int(p.get("YR_ALLOC"))
        if not year or year < 1988 or year > 2030:
            continue
        row = agg[year]
        row["projects"] += 1
        row["liUnits"] += _int(p.get("LI_UNITS"), 0) or 0
        row["totalUnits"] += _int(p.get("N_UNITS"), 0) or 0
        credit_str = str(p.get("CREDIT") or p.get("TypeOfCredits") or "").strip()
        has_9 = "9%" in credit_str or "9pct" in credit_str.lower()
        has_4 = "4%" in credit_str or "4pct" in credit_str.lower() or "Bond" in credit_str
        if has_9 and has_4:
            row["creditBoth"] += 1
        elif has_9:
            row["credit9pct"] += 1
        elif has_4:
            row["credit4pct"] += 1
        if _yes(p.get("NON_PROF")):
            row["nonProfit"] += 1
        if _yes(p.get("QCT")):
            row["qct"] += 1
        if _yes(p.get("DDA")):
            row["dda"] += 1

    # Preserve manual fields from the existing file on matching years.
    existing_by_year = {row.get("year"): row for row in (existing.get("allocations") or [])}
    out_rows = []
    for year in sorted(agg.keys()):
        new_row = {"year": year, **agg[year]}
        # Preserve hudDataStatus / irsPerCapita / policyNote if previously set.
        prev = existing_by_year.get(year, {})
        for k in ("hudDataStatus", "irsPerCapita", "policyNote"):
            if k in prev and k not in new_row:
                new_row[k] = prev[k]
        out_rows.append(new_row)

    return {
        "updated": _now_iso(),
        "generated": _now_iso(),
        "state": existing.get("state", "Colorado"),
        "fips": existing.get("fips", "08"),
        "firstYear": out_rows[0]["year"] if out_rows else 1988,
        "lastYear": out_rows[-1]["year"] if out_rows else 2024,
        "source": existing.get("source") or {
            "projectData": {
                "name": "CHFA Housing Tax Credit Properties (live ArcGIS FeatureServer)",
                "url": "https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer",
                "localFile": "data/chfa-lihtc.json",
            }
        },
        "fieldDefinitions": existing.get("fieldDefinitions") or {
            "year": "Reservation year (YR_ALLOC)",
            "projects": "Project count with YR_ALLOC = year",
            "liUnits": "Sum of LI_UNITS (low-income units)",
            "totalUnits": "Sum of N_UNITS (total units)",
            "credit9pct": "Projects classified as 9% Competitive",
            "credit4pct": "Projects classified as 4% Tax-Exempt Bond",
            "creditBoth": "Projects with both 9% and 4% credits",
            "nonProfit": "Projects with non-profit sponsor (NON_PROF flag)",
            "qct": "Projects in a Qualified Census Tract",
            "dda": "Projects in a Difficult Development Area",
        },
        "methodologyDoc": existing.get("methodologyDoc") or "docs/lihtc-historical-methodology.md",
        "allocations": out_rows,
    }


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: {SRC} not found")
        return 1
    payload = json.loads(SRC.read_text())
    features = payload.get("features") or []
    print(f"Source: {SRC.relative_to(REPO_ROOT)} ({len(features)} features, fetched {payload.get('fetchedAt', '?')})")

    # 1. Trends-by-county
    trends = rebuild_trends_by_county(features)
    TRENDS_OUT.write_text(json.dumps(trends, indent=2) + "\n")
    print(f"  wrote {TRENDS_OUT.relative_to(REPO_ROOT)} "
          f"({len(trends['counties'])} counties × {len(trends['years'])} years)")

    # 2. Historical allocations (statewide aggregate, preserves manual fields)
    try:
        existing = json.loads(HISTORY_OUT.read_text()) if HISTORY_OUT.exists() else {}
    except Exception:
        existing = {}
    history = rebuild_historical_allocations(features, existing)
    HISTORY_OUT.write_text(json.dumps(history, indent=2) + "\n")
    print(f"  wrote {HISTORY_OUT.relative_to(REPO_ROOT)} "
          f"({history['firstYear']}–{history['lastYear']}, "
          f"{len(history['allocations'])} year rows)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
