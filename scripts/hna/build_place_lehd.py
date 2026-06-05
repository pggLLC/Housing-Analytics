#!/usr/bin/env python3
"""scripts/hna/build_place_lehd.py

Compute place-level LEHD WAC (Workplace Area Characteristics) totals
for Colorado places by population-weighted apportionment of each
containing county's WAC blob through the place→tract spatial
membership lookup.

  PR (earlier)         — TIGER 2024 place→tract spatial membership
                          → data/hna/place-tract-membership.json
  PR (this script)     — place-level LEHD WAC aggregation
                          → data/hna/place-lehd.json

Why
---
LEHD LODES WAC publishes employment data only at the county level for
the cached pipeline. LIHTC analysts need it at PLACE level so the
"Wage Distribution" and "Top Industries" cards on HNA reflect Aurora
or Paonia rather than their containing county. Without this, every
place selection silently inherits the parent county's wage / industry
profile — which can dramatically misstate a smaller community's mix.

Method
------
For each place P with tract members {T1, T2, …}:
  pop_in_place_from_T_i  = T_i.pop × T_i.share_of_tract_area
  place_pop              = Σ pop_in_place_from_T_i

  For each county C that any T_i lies inside:
    place_pop_in_C       = Σ pop_in_place_from_T_i for T_i with geoid[:5]==C
    county_total_pop     = Σ tract_pop for all tracts in C
    place_share_of_C     = place_pop_in_C / county_total_pop

    For each LEHD WAC metric M (CE01–CE03, CNS01–CNS20, C000, within,
    inflow, outflow, annualEmployment, annualWages):
      P.M += county_C.M × place_share_of_C

  industries[] is rebuilt from the apportioned CNS01–CNS20 totals so
  every consumer (HNA charts, exports) sees consistent numbers.

Why population weighting? LEHD WAC is workplace-based, but we don't
have tract-level employment density in the cache. Resident population
is a reasonable proxy — places denser than their county get a fair
share, places sparser get less. Tract-area weighting (the approach
used for place-CHAS in PR #803) would over-weight low-density slivers
that happen to be physically large.

Limitations
-----------
  - Population is a residence proxy; large workplace centers can sit
    in low-population tracts and get underweighted.
  - Place→tract membership covers ~482 of 577 CO places; the rest
    get no place-LEHD entry and callers must fall back to county.
  - When place tracts cumulatively cover <50% of a county, the
    apportionment is flagged with coverage_share so the UI can
    disclose "low-confidence place estimate".

Output schema
-------------
    data/hna/place-lehd.json::

    {
      "meta": {
        "generated_at": "...",
        "source_tract_metrics": "data/market/acs_tract_metrics_co.json",
        "source_membership":   "data/hna/place-tract-membership.json",
        "source_county_lehd":  "data/hna/lehd/{county}.json",
        "method": "Population-weighted apportionment from tract overlap",
        "count_places": 460,
        "count_skipped": 22
      },
      "places": {
        "0857300": {
          "name": "Paonia town",
          "tract_count":  4,
          "place_pop":    1601,
          "counties_spanned": ["08029"],
          "place_share_of_counties": {"08029": 0.054},
          "coverage_confidence": "high",  // high|medium|low
          "lehd": {
            "C000":    14002,
            "CE01":    1942,
            "CE02":    3047,
            "CE03":    4810,
            "CNS01":    501,
            "CNS02":    132,
            …
            "within":  246,
            "inflow":  132,
            "outflow": 283,
            "industries": [
              {"naics": "CNS16", "label": "Healthcare & Social Assistance", "count": 1770, "pct": 12.6},
              …
            ]
          }
        }
      }
    }

Usage
-----
    python3 scripts/hna/build_place_lehd.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MEMBERSHIP_PATH = REPO / "data/hna/place-tract-membership.json"
TRACT_METRICS   = REPO / "data/market/acs_tract_metrics_co.json"
SUMMARY_DIR     = REPO / "data/hna/summary"
LEHD_DIR        = REPO / "data/hna/lehd"
LODES_TRACT     = REPO / "data/market/lodes_co.json"
PLACE_OD_FLOWS  = REPO / "data/hna/place-od-flows.json"
OUT_PATH        = REPO / "data/hna/place-lehd.json"

# NAICS sector label dictionary (matches the JS-side NAICS_LABELS in
# js/hna/hna-utils.js — keep in sync if a label is renamed).
NAICS_LABELS = {
    "CNS01": "Agriculture",
    "CNS02": "Mining, Quarrying & Oil/Gas",
    "CNS03": "Utilities",
    "CNS04": "Construction",
    "CNS05": "Manufacturing",
    "CNS06": "Wholesale Trade",
    "CNS07": "Retail Trade",
    "CNS08": "Transportation & Warehousing",
    "CNS09": "Information",
    "CNS10": "Finance & Insurance",
    "CNS11": "Real Estate",
    "CNS12": "Professional Services",
    "CNS13": "Management",
    "CNS14": "Administrative & Support",
    "CNS15": "Educational Services",
    "CNS16": "Healthcare & Social Assistance",
    "CNS17": "Arts & Entertainment",
    "CNS18": "Accommodation & Food Services",
    "CNS19": "Other Services",
    "CNS20": "Public Administration",
}
CNS_KEYS = list(NAICS_LABELS.keys())
CE_KEYS = ["CE01", "CE02", "CE03"]
FLOW_KEYS = ["within", "inflow", "outflow"]
TOTAL_KEYS = ["C000"]
SCALAR_KEYS = TOTAL_KEYS + CE_KEYS + CNS_KEYS + FLOW_KEYS


def _load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _build_tract_pop_index() -> dict[str, dict]:
    """Return {tract_geoid: {pop, county_fips}}."""
    raw = _load_json(TRACT_METRICS)
    out = {}
    for tract in raw.get("tracts", []):
        g = str(tract.get("geoid") or "")
        if len(g) != 11:
            continue
        out[g] = {"pop": int(tract.get("pop") or 0), "county_fips": g[:5]}
    return out


def _build_county_pop_index(tract_pop: dict) -> dict[str, int]:
    """Return {county_fips: total_population_summed_from_tracts}."""
    out = defaultdict(int)
    for t in tract_pop.values():
        out[t["county_fips"]] += t["pop"]
    return dict(out)


def _load_place_od_flows() -> dict[str, dict]:
    """Return {place_geoid: {within, inflow, outflow, jobs, residentWorkers}}
    from the block-level LODES OD aggregation (build_place_od_flows.py). Empty
    dict if the file is absent — caller falls back to tract-weighted flows."""
    if not PLACE_OD_FLOWS.exists():
        return {}
    try:
        raw = _load_json(PLACE_OD_FLOWS)
    except Exception as e:  # noqa: BLE001
        print(f"[warn] failed to load {PLACE_OD_FLOWS}: {e}", file=sys.stderr)
        return {}
    return raw.get("places") or {}


def _load_lodes_tracts() -> dict[str, dict]:
    """Return {tract_geoid: lodes_tract_blob} from the tract-level OD cache
    (data/market/lodes_co.json). Carries home_workers, work_workers,
    inCommuters, outCommuters per tract — the basis for accurate place flows."""
    try:
        raw = _load_json(LODES_TRACT)
    except Exception as e:  # noqa: BLE001
        print(f"[warn] failed to load {LODES_TRACT}: {e}", file=sys.stderr)
        return {}
    out = {}
    for t in raw.get("tracts", []):
        g = str(t.get("geoid") or "")
        if len(g) == 11:
            out[g] = t
    return out


def _load_county_lehd() -> dict[str, dict]:
    """Return {county_fips: lehd_blob} for every cache file present."""
    out = {}
    for p in sorted(LEHD_DIR.glob("*.json")):
        fips = p.stem
        if not fips.isdigit():
            continue
        try:
            out[fips] = _load_json(p)
        except Exception as e:  # noqa: BLE001 — diagnostic
            print(f"[warn] failed to load {p}: {e}", file=sys.stderr)
    return out


def _apportion_scalar(county_value, share):
    """county_value × share, rounded; null-safe."""
    try:
        v = float(county_value)
    except (TypeError, ValueError):
        return None
    if v != v:                          # NaN guard
        return None
    return int(round(v * share))


def _apportion_annual_dict(d, share):
    """For annualEmployment ({year: total}) and annualWages
    ({year: {low, medium, high}}). Returns None if d isn't a dict."""
    if not isinstance(d, dict):
        return None
    out = {}
    for year, value in d.items():
        if isinstance(value, dict):
            out[year] = {
                k: _apportion_scalar(v, share) for k, v in value.items()
            }
        else:
            out[year] = _apportion_scalar(value, share)
    return out


def _coverage_confidence(coverage_share: float) -> str:
    if coverage_share >= 0.85:
        return "high"
    if coverage_share >= 0.5:
        return "medium"
    return "low"


def _load_place_pop(geoid: str) -> int:
    """Direct ACS place population from the cached summary file.

    Area-weighted tract apportionment systematically under-counts
    dense urban places inside large rural tracts (Paonia inside one
    big Delta tract is the canonical case). Using DP05_0001E from
    the place's own ACS profile sidesteps that bias entirely.
    Returns 0 if no summary is cached (caller falls back to area-
    weighted estimation).
    """
    path = SUMMARY_DIR / f"{geoid}.json"
    if not path.exists():
        return 0
    try:
        d = _load_json(path)
        ap = d.get("acsProfile") or {}
        return int(ap.get("DP05_0001E") or 0)
    except Exception:
        return 0


def build():
    membership = _load_json(MEMBERSHIP_PATH)
    tract_pop  = _build_tract_pop_index()
    county_pop = _build_county_pop_index(tract_pop)
    county_lehd = _load_county_lehd()
    lodes_tracts = _load_lodes_tracts()
    place_od_flows = _load_place_od_flows()

    places_out = {}
    used_tract_flows = 0
    used_block_flows = 0
    skipped = 0
    used_acs_pop = 0
    used_area_estimate = 0

    for geoid, place in (membership.get("places") or {}).items():
        tracts = place.get("tracts") or []
        if not tracts:
            skipped += 1
            continue

        # Method A (preferred): direct ACS place pop from the cached
        # place summary. Method B (fallback): area-weighted tract pop
        # apportionment — only used for places without a cached summary.
        actual_place_pop = _load_place_pop(geoid)

        # Aggregate place's distribution across spanning counties using
        # the share_of_place_area weights (what fraction of THE PLACE
        # sits in each county). This is the right partitioner — we know
        # the place's total pop, we just need to split it by county.
        place_share_in_county: dict[str, float] = defaultdict(float)
        area_estimate_pop = 0.0
        area_estimate_in_county: dict[str, float] = defaultdict(float)

        for entry in tracts:
            tract_g = entry.get("tract_geoid")
            share_of_place = float(entry.get("share_of_place_area") or 0)
            share_of_tract = float(entry.get("share_of_tract_area") or 0)
            if not tract_g:
                continue
            c_fips = tract_g[:5]
            place_share_in_county[c_fips] += share_of_place
            t_pop = tract_pop.get(tract_g, {}).get("pop", 0)
            apportioned_pop = t_pop * share_of_tract
            area_estimate_pop += apportioned_pop
            area_estimate_in_county[c_fips] += apportioned_pop

        if actual_place_pop > 0:
            place_pop = actual_place_pop
            used_acs_pop += 1
            place_pop_in_county = {
                c: place_pop * w for c, w in place_share_in_county.items() if w > 0
            }
        elif area_estimate_pop > 0:
            place_pop = int(round(area_estimate_pop))
            used_area_estimate += 1
            place_pop_in_county = dict(area_estimate_in_county)
        else:
            skipped += 1
            continue

        # Per-county share + sanity check that county LEHD blobs exist.
        place_share_of_counties: dict[str, float] = {}
        for c_fips, pop_in_place in place_pop_in_county.items():
            c_pop = county_pop.get(c_fips, 0)
            if c_pop <= 0:
                continue
            place_share_of_counties[c_fips] = pop_in_place / c_pop

        if not place_share_of_counties:
            skipped += 1
            continue

        # Apportion each scalar LEHD field across spanning counties.
        lehd_out: dict[str, object] = {k: 0 for k in SCALAR_KEYS}
        annual_emp_acc: dict[str, float] = defaultdict(float)
        annual_wages_acc: dict[str, dict[str, float]] = defaultdict(
            lambda: defaultdict(float)
        )

        for c_fips, share in place_share_of_counties.items():
            blob = county_lehd.get(c_fips)
            if not blob:
                continue
            for key in SCALAR_KEYS:
                contrib = _apportion_scalar(blob.get(key), share)
                if contrib is not None:
                    lehd_out[key] = (lehd_out.get(key) or 0) + contrib
            ae = blob.get("annualEmployment")
            if isinstance(ae, dict):
                for year, total in ae.items():
                    contrib = _apportion_scalar(total, share)
                    if contrib is not None:
                        annual_emp_acc[year] += contrib
            aw = blob.get("annualWages")
            if isinstance(aw, dict):
                for year, tiers in aw.items():
                    if not isinstance(tiers, dict):
                        continue
                    for tier_name, count in tiers.items():
                        contrib = _apportion_scalar(count, share)
                        if contrib is not None:
                            annual_wages_acc[year][tier_name] += contrib

        # Re-derive industries[] from apportioned CNS totals so all
        # downstream consumers see a single source of truth.
        cns_total = sum(int(lehd_out.get(k) or 0) for k in CNS_KEYS)
        industries = []
        if cns_total > 0:
            for k in CNS_KEYS:
                count = int(lehd_out.get(k) or 0)
                if count <= 0:
                    continue
                industries.append({
                    "naics": k,
                    "label": NAICS_LABELS[k],
                    "count": count,
                    "pct":   round(count / cns_total * 100, 1),
                })
            industries.sort(key=lambda d: d["count"], reverse=True)
        lehd_out["industries"] = industries

        lehd_out["annualEmployment"] = {
            y: int(v) for y, v in sorted(annual_emp_acc.items())
        } if annual_emp_acc else {}
        lehd_out["annualWages"] = {
            y: {k: int(v) for k, v in tiers.items()}
            for y, tiers in sorted(annual_wages_acc.items())
        } if annual_wages_acc else {}

        # ── Commute FLOWS from tract-level LODES (NOT county pop-weighting) ──
        # within / inflow / outflow are not proportional to population: a
        # bedroom town has far more out-commuters than its pop share of the
        # county's flows. Pop-apportioning the county's flows therefore erases
        # the place's actual commuting pattern (New Castle looked balanced like
        # Garfield County when it is really ~90% out-commuting). Override the
        # apportioned flow scalars with values aggregated from the tract-level
        # LODES cache, weighted by the place's population share OF EACH TRACT
        # (place_pop_in_tract / tract_pop). For multi-tract places this still
        # counts intra-place tract-to-tract commutes as in/out flow, so it's
        # directional — but far closer than the county pop-weight.
        f_rw = f_jobs = f_in = f_out = 0.0
        f_low = f_mid = f_high = 0.0
        flows_from_tracts = False
        for entry in tracts:
            tg = entry.get("tract_geoid")
            sop = float(entry.get("share_of_place_area") or 0)
            lt = lodes_tracts.get(tg)
            tpopv = tract_pop.get(tg, {}).get("pop", 0)
            if not lt or tpopv <= 0 or sop <= 0:
                continue
            w = min(1.0, (place_pop * sop) / tpopv)
            f_rw   += float(lt.get("home_workers") or 0) * w
            f_jobs += float(lt.get("work_workers") or 0) * w
            f_in   += float(lt.get("inCommuters")  or 0) * w
            f_out  += float(lt.get("outCommuters") or 0) * w
            f_low  += float(lt.get("low_wage")  or 0) * w
            f_mid  += float(lt.get("mid_wage")  or 0) * w
            f_high += float(lt.get("high_wage") or 0) * w
            flows_from_tracts = True
        if flows_from_tracts:
            lehd_out["within"]          = max(0, int(round(f_rw - f_out)))
            lehd_out["inflow"]          = int(round(f_in))
            lehd_out["outflow"]         = int(round(f_out))
            lehd_out["residentWorkers"] = int(round(f_rw))
            lehd_out["jobs"]            = int(round(f_jobs))
            lehd_out["flows_source"]    = "tract-lodes"
            used_tract_flows += 1
            # WAC totals (Total Jobs + Wage Distribution) from tract LODES too,
            # so the Labor Market cards reflect the place, not its county. The
            # 20-NAICS sector MIX isn't published below county, so rescale the
            # county-apportioned CNS sectors to the tract job total (county
            # shares, place magnitude) and rebuild industries[].
            if f_jobs > 0:
                lehd_out["C000"] = int(round(f_jobs))
                lehd_out["CE01"] = int(round(f_low))
                lehd_out["CE02"] = int(round(f_mid))
                lehd_out["CE03"] = int(round(f_high))
                # (F101 annualWages-preference workaround removed 2026-06-02
                #  after data/market/lodes_co.json was rebuilt with the
                #  correct CE01/CE02/CE03 wage columns — see fetch_lodes.py
                #  docstring. Tract-LODES f_low/f_mid/f_high now carry real
                #  values for all three tiers, so we no longer need to
                #  override them from annualWages.)
                cns_prev = sum(int(lehd_out.get(k) or 0) for k in CNS_KEYS)
                if cns_prev > 0:
                    scale = f_jobs / cns_prev
                    for k in CNS_KEYS:
                        lehd_out[k] = int(round((lehd_out.get(k) or 0) * scale))
                cns_total = sum(int(lehd_out.get(k) or 0) for k in CNS_KEYS)
                rebuilt = []
                if cns_total > 0:
                    for k in CNS_KEYS:
                        cnt = int(lehd_out.get(k) or 0)
                        if cnt <= 0:
                            continue
                        rebuilt.append({"naics": k, "label": NAICS_LABELS[k],
                                        "count": cnt, "pct": round(cnt / cns_total * 100, 1)})
                    rebuilt.sort(key=lambda d: d["count"], reverse=True)
                lehd_out["industries"] = rebuilt
                lehd_out["wac_source"] = "tract-scaled"
        else:
            lehd_out["flows_source"] = "county-apportioned"
            lehd_out["wac_source"]   = "county-apportioned"

        # ── Block-level OD override (preferred when available) ──────────────
        # When build_place_od_flows.py has produced a per-place row from the
        # block-level LODES OD + LEHD crosswalk, replace the tract-weighted
        # flows with those exact block-classified counts. Block-level OD
        # classifies every (home_block, work_block) pair against the place
        # boundary, so it doesn't suffer the tract approximation's intra-place
        # double-counting (Boulder's job-center inflow finally surfaces; New
        # Castle's bedroom pattern stays intact but tightens slightly).
        # Wages stay tract-derived (LODES OD doesn't carry wage bins).
        block = place_od_flows.get(geoid)
        if block:
            lehd_out["within"]          = int(block.get("within")          or 0)
            lehd_out["inflow"]          = int(block.get("inflow")          or 0)
            lehd_out["outflow"]         = int(block.get("outflow")         or 0)
            lehd_out["residentWorkers"] = int(block.get("residentWorkers") or 0)
            lehd_out["jobs"]            = int(block.get("jobs")            or 0)
            lehd_out["flows_source"]    = "block-od"
            used_block_flows += 1
            # Use block-OD jobs as C000 too, and rescale CNS sectors to match.
            jobs_b = int(block.get("jobs") or 0)
            if jobs_b > 0:
                lehd_out["C000"] = jobs_b
                cns_prev = sum(int(lehd_out.get(k) or 0) for k in CNS_KEYS)
                if cns_prev > 0:
                    scale_b = jobs_b / cns_prev
                    for k in CNS_KEYS:
                        lehd_out[k] = int(round((lehd_out.get(k) or 0) * scale_b))
                cns_total = sum(int(lehd_out.get(k) or 0) for k in CNS_KEYS)
                rebuilt = []
                if cns_total > 0:
                    for k in CNS_KEYS:
                        cnt = int(lehd_out.get(k) or 0)
                        if cnt <= 0:
                            continue
                        rebuilt.append({"naics": k, "label": NAICS_LABELS[k],
                                        "count": cnt, "pct": round(cnt / cns_total * 100, 1)})
                    rebuilt.sort(key=lambda d: d["count"], reverse=True)
                lehd_out["industries"] = rebuilt
                lehd_out["wac_source"] = "block-scaled"

        # Coverage: how much of the place is covered by the tract
        # overlaps we know about? Re-uses the place-CHAS convention.
        coverage_share = sum(
            float(t.get("share_of_place_area") or 0) for t in tracts
        )

        places_out[geoid] = {
            "name": place.get("name") or geoid,
            "tract_count": len(tracts),
            "place_pop": int(round(place_pop)),
            "counties_spanned": sorted(place_share_of_counties.keys()),
            "place_share_of_counties": {
                c: round(s, 6) for c, s in place_share_of_counties.items()
            },
            "coverage_share": round(coverage_share, 4),
            "coverage_confidence": _coverage_confidence(coverage_share),
            "lehd": lehd_out,
        }

    out = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_tract_metrics": str(TRACT_METRICS.relative_to(REPO)),
            "source_membership":   str(MEMBERSHIP_PATH.relative_to(REPO)),
            "source_place_summary": "data/hna/summary/{place_geoid}.json",
            "source_county_lehd":   "data/hna/lehd/{county}.json",
            "method":
                "WAC scalars (CE01–03, CNS01–20, C000, annualEmployment, annualWages) "
                "are county totals apportioned by place_pop_in_county / county_total_pop. "
                "Commute FLOWS (within/inflow/outflow + residentWorkers/jobs) are instead "
                "aggregated from tract-level LODES (data/market/lodes_co.json), weighted "
                "by place_pop_in_tract / tract_pop — flows are NOT proportional to "
                "population, so county pop-weighting would erase a place's actual commute "
                "pattern (bedroom town vs job center). Per-place `flows_source` records "
                "which path produced the flows.",
            "count_places":  len(places_out),
            "count_skipped": skipped,
            "count_used_acs_pop":       used_acs_pop,
            "count_used_area_estimate": used_area_estimate,
            "count_used_tract_flows":   used_tract_flows,
            "count_used_block_flows":   used_block_flows,
        },
        "places": places_out,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, sort_keys=False)
        f.write("\n")
    print(f"[place-lehd] wrote {len(places_out)} places "
          f"(acs_pop={used_acs_pop}, area_est={used_area_estimate}, "
          f"tract_flows={used_tract_flows}, block_flows={used_block_flows}, "
          f"skipped={skipped}) → {OUT_PATH.relative_to(REPO)}")


if __name__ == "__main__":
    build()
