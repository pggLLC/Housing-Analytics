#!/usr/bin/env python3
"""Build place-level housing-need projections from county DOLA projections.

The downscaling weight blends each place's ACS household share with its
complete-year 2020-2024 share of county Census BPS permits. Cross-county
municipalities use combined-region denominators because permits.json already
sums their place permits across county parts.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from collections import Counter
from typing import Any


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HNA = os.path.join(ROOT, "data", "hna")
SUMMARY_DIR = os.path.join(HNA, "summary")
PROJECTIONS_DIR = os.path.join(HNA, "projections")
REGISTRY_PATH = os.path.join(HNA, "geography-registry.json")
PERMITS_PATH = os.path.join(HNA, "permits.json")
CROSS_COUNTY_PATH = os.path.join(HNA, "cross-county-places.json")
OUT_PATH = os.path.join(PROJECTIONS_DIR, "places.json")

WINDOW_YEARS = list(range(2020, 2025))
PERMIT_WINDOW_LABEL = "2020-2024"
MAX_SHARE = 1.0
# Integrity review, 4 Nov 2026 (paul chose the hybrid): no share floor. A floor
# of 0.5% gave a 4-household town 130 homes. Below this many households the
# share is kept in the file but the page says the town is too small for a
# reliable forecast and points to the county.
SMALL_PLACE_HOUSEHOLDS = 250


def read_json(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str, payload: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)
        f.write("\n")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def rounded(value: float | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def series_sum(values: list[Any], years: list[int], window: list[int]) -> float:
    total = 0.0
    for year in window:
        if year not in years:
            continue
        idx = years.index(year)
        if idx >= len(values):
            continue
        value = values[idx]
        if isinstance(value, (int, float)):
            total += float(value)
    return total


def _period(profile: dict[str, Any]) -> str | None:
    series, year = profile.get("_acsSeries"), profile.get("_acsYear")
    if series not in ("acs1", "acs5") or not str(year or "").isdigit():
        return None
    return f"{series}:{int(year)}"


def summary_households_with_period(geoid: str) -> tuple[float | None, str | None]:
    """Households for the household share, from the ACS 5-year.

    Owner decision 2026-11-03 (paul): the place and its county use the same
    5-year period, so the share compares like with like (Census guidance on
    comparing ACS data: compare estimates of the same period length). A
    geography whose main profile is a 1-year (65,000+ people) reads its
    5-year twin (`acs5Profile`, written by build_hna_data.py). Until that twin
    carries DP02_0001E, the 1-year figure is used and its period is recorded,
    so the output says which rows are still mixed.
    """
    path = os.path.join(SUMMARY_DIR, f"{geoid}.json")
    if not os.path.exists(path):
        return None, None
    summary = read_json(path)
    profile = summary.get("acsProfile") or {}
    candidates = [profile]
    if profile.get("_acsSeries") != "acs5":
        candidates.insert(0, summary.get("acs5Profile") or {})
    for cand in candidates:
        hh = num(cand.get("DP02_0001E"))
        if hh and hh > 0:
            return hh, _period(cand)
    return None, None


def summary_households(geoid: str) -> float | None:
    return summary_households_with_period(geoid)[0]


def projection_path(fips: str) -> str:
    return os.path.join(PROJECTIONS_DIR, f"{fips}.json")


def load_county_projection(fips: str) -> dict[str, Any] | None:
    path = projection_path(fips)
    if not os.path.exists(path):
        return None
    return read_json(path)


def scale_series(values: list[Any], share: float) -> list[float | None]:
    out: list[float | None] = []
    for value in values:
        v = num(value)
        out.append(round(v * share, 3) if v is not None else None)
    return out


def combine_series(projections: list[dict[str, Any]], getter) -> list[float | None]:
    if not projections:
        return []
    length = len(projections[0].get("years") or [])
    combined: list[float | None] = []
    for i in range(length):
        total = 0.0
        any_value = False
        for proj in projections:
            values = getter(proj) or []
            if i >= len(values):
                continue
            v = num(values[i])
            if v is not None:
                total += v
                any_value = True
        combined.append(total if any_value else None)
    return combined


def main() -> int:
    registry = read_json(REGISTRY_PATH)
    permits = read_json(PERMITS_PATH)
    cross_county = read_json(CROSS_COUNTY_PATH).get("places") or {}
    permit_years = permits.get("years") or []
    counties_permits = permits.get("counties") or {}
    places_permits = permits.get("places") or {}

    geographies = registry.get("geographies") or []
    county_geoids = {g.get("geoid") for g in geographies if g.get("type") == "county"}
    places = [
        g for g in geographies
        if g.get("type") in {"place", "cdp"}
    ]

    county_hh_period = {
        fips: summary_households_with_period(fips)
        for fips in county_geoids
        if fips
    }
    county_households = {fips: hp[0] for fips, hp in county_hh_period.items()}
    county_projections = {
        fips: load_county_projection(fips)
        for fips in county_geoids
        if fips and os.path.exists(projection_path(fips))
    }
    county_permit_totals = {
        fips: series_sum((rec or {}).get("units_total") or [], permit_years, WINDOW_YEARS)
        for fips, rec in counties_permits.items()
    }

    draft: dict[str, dict[str, Any]] = {}
    ledger: dict[str, float] = {fips: 0.0 for fips in county_geoids if fips}

    for place in places:
        geoid = place.get("geoid")
        containing = place.get("containingCounty")
        place_hh, place_period = summary_households_with_period(geoid) if geoid else (None, None)
        if not geoid or not containing or not place_hh:
            continue

        is_cross = geoid in cross_county
        member_counties = []
        population_split: dict[str, float] = {}
        if is_cross:
            members = cross_county[geoid].get("all_counties") or []
            total_pop = sum(num(m.get("population")) or 0 for m in members)
            for member in members:
                fips = member.get("fips")
                pop = num(member.get("population")) or 0
                if fips and fips in county_projections:
                    member_counties.append(fips)
                    population_split[fips] = (pop / total_pop) if total_pop > 0 else 0
        else:
            member_counties = [containing] if containing in county_projections else []
            population_split = {containing: 1.0} if member_counties else {}
        if not member_counties:
            continue

        denominator_hh = sum(county_households.get(fips) or 0 for fips in member_counties)
        if denominator_hh <= 0:
            continue
        household_share = place_hh / denominator_hh
        county_periods = sorted({county_hh_period.get(fips, (None, None))[1] or "unknown" for fips in member_counties})
        periods = sorted(set(county_periods) | {place_period or "unknown"})
        household_period = periods[0] if len(periods) == 1 else "mixed"

        place_permits = series_sum((places_permits.get(geoid) or {}).get("units_total") or [], permit_years, WINDOW_YEARS)
        permit_denominator = sum(county_permit_totals.get(fips) or 0 for fips in member_counties)
        permit_share = place_permits / permit_denominator if permit_denominator > 0 else None
        if geoid not in places_permits or place_permits == 0:
            permit_share = None

        blended_share = household_share if permit_share is None else (0.5 * household_share + 0.5 * permit_share)
        blended_share = min(MAX_SHARE, max(0.0, blended_share))

        for fips, split in population_split.items():
            ledger[fips] = ledger.get(fips, 0.0) + blended_share * split

        draft[geoid] = {
            "place": place,
            "member_counties": member_counties,
            "population_split": population_split,
            "household_inputs": {
                "place_households": place_hh,
                "place_period": place_period,
                "county_households": denominator_hh,
                "county_periods": county_periods,
                "period": household_period,
            },
            "shares": {
                "household": household_share,
                "permit": permit_share,
                "blended": blended_share,
            },
        }

    normalization_factors = {
        fips: (1.0 / value)
        for fips, value in ledger.items()
        if value > 1.0
    }
    if normalization_factors:
        for geoid, rec in draft.items():
            factors = [
                normalization_factors[fips]
                for fips in rec["member_counties"]
                if fips in normalization_factors
            ]
            if factors:
                rec["shares"]["blended"] *= min(factors)

    post_ledger: dict[str, float] = {fips: 0.0 for fips in county_geoids if fips}
    for rec in draft.values():
        for fips, split in rec["population_split"].items():
            post_ledger[fips] = post_ledger.get(fips, 0.0) + rec["shares"]["blended"] * split

    outputs: dict[str, Any] = {}
    statewide_place_2044 = 0.0
    statewide_county_2044 = 0.0
    for proj in county_projections.values():
        if proj:
            series = (proj.get("housing_need") or {}).get("incremental_units_needed_dola") or []
            if series:
                statewide_county_2044 += num(series[-1]) or 0

    for geoid, rec in sorted(draft.items()):
        place = rec["place"]
        share = rec["shares"]["blended"]
        projections = [county_projections[fips] for fips in rec["member_counties"] if county_projections.get(fips)]
        years = projections[0].get("years") or []
        incremental = combine_series(
            projections,
            lambda p: (p.get("housing_need") or {}).get("incremental_units_needed_dola"),
        )
        replacement = combine_series(
            projections,
            lambda p: ((p.get("housing_need") or {}).get("replacement") or {}).get("cumulative_units"),
        )
        tenure = combine_series(
            projections,
            lambda p: ((p.get("housing_need") or {}).get("tenure_split") or {}).get("incremental_units_needed_tenure_adjusted"),
        )
        scaled_incremental = scale_series(incremental, share)
        if scaled_incremental:
            statewide_place_2044 += scaled_incremental[-1] or 0
        outputs[geoid] = {
            "name": place.get("name"),
            "containing_county": place.get("containingCounty"),
            "cross_county": bool(rec["member_counties"] and len(rec["member_counties"]) > 1),
            "years": years,
            "incremental_units_needed": scaled_incremental,
            "replacement_cumulative": scale_series(replacement, share),
            "incremental_tenure_adjusted": scale_series(tenure, share),
            "shares": {
                "household": rounded(rec["shares"]["household"]),
                "permit": rounded(rec["shares"]["permit"]),
                "blended": rounded(share),
                "permit_window": PERMIT_WINDOW_LABEL,
            },
            "household_inputs": rec["household_inputs"],
            "too_small": (num(rec["household_inputs"].get("place_households")) or 0) < SMALL_PLACE_HOUSEHOLDS,
            "method": "county_projection_x_blended_share_v2",
        }

    payload = {
        "meta": {
            "generated_at": utc_now(),
            "counts": {
                "places": len(outputs),
                "cross_county_places": sum(1 for rec in outputs.values() if rec["cross_county"]),
                "counties_in_ledger": len(post_ledger),
            },
            "formula": (
                "blended_share = 0.5 * household_share + 0.5 * permit_share; "
                "if permit_share is null, blended_share = household_share; clamped to [0, 1.0] (no floor since 2026-11-04). "
                "Permit and household denominators use combined-region math for cross-county places. "
                "household_share = place ACS 5-year households / county ACS 5-year households, same period "
                "(owner decision 2026-11-03); a row whose household_inputs.period is 'mixed' still uses a "
                "1-year figure because the 5-year count is not stored yet."
            ),
            "small_place_rule": (
                f"too_small is true below {SMALL_PLACE_HOUSEHOLDS} ACS households: the series is kept, but the page "
                "shows no town figure and points to the county forecast. Shown figures are estimates rounded to tens."
            ),
            "small_place_households": SMALL_PLACE_HOUSEHOLDS,
            "household_period_counts": dict(sorted(Counter(
                (rec.get("household_inputs") or {}).get("period") or "unknown" for rec in outputs.values()
            ).items())),
            "sanity_ledger": {
                fips: {
                    "place_share_sum": rounded(value),
                    "unincorporated_remainder": rounded(max(0.0, 1.0 - value)),
                    "normalization_factor": rounded(normalization_factors.get(fips, 1.0)),
                }
                for fips, value in sorted(post_ledger.items())
            },
            "normalization_factors": {
                fips: rounded(value)
                for fips, value in sorted(normalization_factors.items())
            },
            "statewide": {
                "place_2044_incremental_sum": round(statewide_place_2044, 3),
                "county_2044_incremental_total": round(statewide_county_2044, 3),
                "place_sum_lte_county_total": statewide_place_2044 <= statewide_county_2044 + 1e-6,
            },
        },
        "places": outputs,
    }
    write_json(OUT_PATH, payload)

    def value_at(geoid: str, year: int) -> float | None:
        rec = outputs.get(geoid)
        if not rec or year not in rec["years"]:
            return None
        return rec["incremental_units_needed"][rec["years"].index(year)]

    max_ledger = max((v["place_share_sum"] for v in payload["meta"]["sanity_ledger"].values()), default=0)
    print(f"[place-projections] wrote {len(outputs)} places to {os.path.relpath(OUT_PATH, ROOT)}")
    print(f"[place-projections] county ledger max={max_ledger:.6f}; normalization factors={payload['meta']['normalization_factors'] or '{}'}")
    print(
        "[place-projections] statewide 2044 place sum="
        f"{payload['meta']['statewide']['place_2044_incremental_sum']:.1f}; "
        f"county total={payload['meta']['statewide']['county_2044_incremental_total']:.1f}; "
        f"ok={payload['meta']['statewide']['place_sum_lte_county_total']}"
    )
    for geoid, label in [("0850480", "Milliken"), ("0824950", "Erie")]:
        rec = outputs.get(geoid)
        if rec:
            print(
                f"[place-projections] {label} {geoid} shares "
                f"household={rec['shares']['household']:.4f} "
                f"permit={(rec['shares']['permit'] if rec['shares']['permit'] is not None else float('nan')):.4f} "
                f"blended={rec['shares']['blended']:.4f}; "
                f"2030 incremental={value_at(geoid, 2030):.1f}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
