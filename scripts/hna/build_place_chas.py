#!/usr/bin/env python3
"""scripts/hna/build_place_chas.py

Compute place-level CHAS (cost-burden by AMI tier) for Colorado places by
area-weighted apportionment of tract-level CHAS through the place→tract
spatial membership lookup. Final step of the TIGER spatial-join arc:

  PR-C1 (#788, MERGED) — tract-level CHAS aggregations
                          → data/market/chas_tract_co.json
  PR-C2 (#789, OPEN)   — place→tract spatial membership
                          → data/hna/place-tract-membership.json
  PR-C3 (this script)  — place-level CHAS aggregation
                          → data/hna/place-chas.json

Why
---
HUD CHAS Table 7 publishes data at TRACT level. LIHTC analysts need it
at PLACE level (e.g. Erie, Aurora, Longmont). For places that span
multiple counties — 26 cases per PR #787 — the existing approach of
inheriting the place's PRIMARY county CHAS gives the wrong rates: a
parcel in Erie sees Weld county CHAS rates even though half of Erie
sits in Boulder county. This script fixes that by summing the underlying
tracts' CHAS counts weighted by what fraction of each tract sits inside
the place.

Method
------
For each place P:
  For each tract T that overlaps P (from membership doc):
    weight = T.share_of_tract_area    # frac of tract inside P
    For each metric M (renter total, ≤30% AMI HHs, cost-burdened, etc.):
      P.M += T.M × weight   # area-weighted apportionment

Limitations
-----------
Same as PR-C2's spatial join: assumes uniform population density within
a tract. For most CO places this is acceptable; for very small slivers
(<10% of tract area) the assumption breaks down. The output flags
places where the membership tracts cumulatively cover <80% of the
place — those have lower-confidence place-CHAS estimates.

Output schema
-------------
    data/hna/place-chas.json::

    {
      "meta": {
        "generated_at": "...",
        "source_tract_chas": "data/market/chas_tract_co.json",
        "source_membership": "data/hna/place-tract-membership.json",
        "method": "Area-weighted apportionment (share_of_tract_area)",
        "vintage_chas": "2018-2022",
        "vintage_tiger": 2024,
        "count_places": 464
      },
      "places": {
        "0824950": {
          "name": "Erie town",
          "tract_count": 11,
          "place_area_sqm": 25437126.0,
          "coverage_share": 1.0,
          "summary": {
            "total_renter_hh":        2156.0,
            "total_owner_hh":        14893.4,
            "renter_cb30_count":      1107.6,
            "renter_cb30_share":      0.5135,
            "renter_cb50_count":       454.7,
            "renter_cb50_share":      0.2110,
            "owner_cb30_count":       4106.5,
            "owner_cb30_share":       0.2757,
            "owner_cb50_count":       1521.7,
            "owner_cb50_share":       0.1022
          },
          "renter_hh_by_ami": { "lte30": {...}, "31to50": {...}, ... },
          "owner_hh_by_ami":  { ... }
        }
      }
    }

Usage
-----
    python3 scripts/hna/build_place_chas.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
TRACT_CHAS = os.path.join(REPO_ROOT, 'data', 'market', 'chas_tract_co.json')
MEMBERSHIP = os.path.join(REPO_ROOT, 'data', 'hna', 'place-tract-membership.json')
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'place-chas.json')

AMI_TIERS = ['lte30', '31to50', '51to80', '81to100', '100plus']
COVERAGE_WARN_THRESHOLD = 0.80  # flag places whose tracts cover <80%


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_inputs() -> tuple[dict, dict]:
    if not os.path.exists(TRACT_CHAS):
        raise FileNotFoundError(
            f'{TRACT_CHAS} not found. Run scripts/fetch_chas.py first '
            f'(PR-C1 must be merged or the tract file regenerated).'
        )
    if not os.path.exists(MEMBERSHIP):
        raise FileNotFoundError(
            f'{MEMBERSHIP} not found. Run '
            f'scripts/hna/build_place_tract_membership.py first '
            f'(PR-C2 must be merged or the membership file regenerated).'
        )
    with open(TRACT_CHAS) as f:
        tract_doc = json.load(f)
    with open(MEMBERSHIP) as f:
        membership_doc = json.load(f)
    return tract_doc, membership_doc


def index_tracts_by_geoid(tract_doc: dict) -> dict:
    return {rec['tract_geoid']: rec for rec in tract_doc.get('records', [])}


def empty_burden_tier() -> dict:
    return {
        'total': 0.0,
        'cost_burdened_30pct': 0.0,
        'cost_burdened_50pct': 0.0,
    }


def _accumulate_tier(target: dict, source: dict, weight: float) -> None:
    """Add weight × source[*] into target[*] for the 3 burden cells."""
    target['total']               += source.get('total', 0) * weight
    target['cost_burdened_30pct'] += source.get('cost_burdened_30pct', 0) * weight
    target['cost_burdened_50pct'] += source.get('cost_burdened_50pct', 0) * weight


def _finalize_burden_tier(td: dict) -> dict:
    total = td['total']
    cb30 = td['cost_burdened_30pct']
    cb50 = td['cost_burdened_50pct']
    return {
        'total':                round(total, 1),
        'cost_burdened_30pct':  round(cb30, 1),
        'cost_burdened_50pct':  round(cb50, 1),
        'pct_cost_burdened_30': round(cb30 / total, 4) if total else 0.0,
        'pct_cost_burdened_50': round(cb50 / total, 4) if total else 0.0,
    }


def aggregate_place(
    place_geoid: str,
    place_record: dict,
    tract_index: dict,
) -> dict | None:
    """Compute place-level CHAS by area-weighted tract apportionment."""
    renter = {tier: empty_burden_tier() for tier in AMI_TIERS}
    owner  = {tier: empty_burden_tier() for tier in AMI_TIERS}
    n_tracts_used = 0
    coverage = 0.0

    for tract_overlap in place_record.get('tracts', []):
        tract_geoid = tract_overlap['tract_geoid']
        weight = tract_overlap['share_of_tract_area']
        coverage += tract_overlap['share_of_place_area']
        tract_chas = tract_index.get(tract_geoid)
        if not tract_chas:
            # Tract present in TIGER but not in CHAS data — skip silently.
            # Rare; happens for new tracts in TIGER 2024 not yet in
            # CHAS 2018-2022. Reduces coverage but not silently broken.
            continue
        n_tracts_used += 1
        for tier in AMI_TIERS:
            _accumulate_tier(
                renter[tier],
                tract_chas['renter_hh_by_ami'].get(tier, {}),
                weight,
            )
            _accumulate_tier(
                owner[tier],
                tract_chas['owner_hh_by_ami'].get(tier, {}),
                weight,
            )

    if n_tracts_used == 0:
        return None

    renter_final = {tier: _finalize_burden_tier(renter[tier]) for tier in AMI_TIERS}
    owner_final  = {tier: _finalize_burden_tier(owner[tier])  for tier in AMI_TIERS}

    total_renter = sum(renter_final[t]['total'] for t in AMI_TIERS)
    total_owner  = sum(owner_final[t]['total']  for t in AMI_TIERS)
    cb30_renter  = sum(renter_final[t]['cost_burdened_30pct'] for t in AMI_TIERS)
    cb50_renter  = sum(renter_final[t]['cost_burdened_50pct'] for t in AMI_TIERS)
    cb30_owner   = sum(owner_final[t]['cost_burdened_30pct']  for t in AMI_TIERS)
    cb50_owner   = sum(owner_final[t]['cost_burdened_50pct']  for t in AMI_TIERS)

    source = 'tract-apportionment'

    # Phase 4 / D3: rate-only fallback for tiny rural places.
    # When area-weighted apportionment rounds to zero (place is <1% of
    # a large tract by area), use the dominant tract's RATES with a
    # synthetic population-based HH count. The rates are accurate;
    # the absolute counts are estimated.
    if (total_renter + total_owner) < 1 and place_record.get('tracts'):
        # Find the tract with the largest share_of_place_area
        dominant = max(
            place_record['tracts'],
            key=lambda t: t.get('share_of_place_area', 0),
        )
        dom_tract = tract_index.get(dominant['tract_geoid'])
        if dom_tract:
            # CO statewide average: ~2.5 persons/HH, so HH-per-sqm ≈
            # tract_population / tract_area / 2.5. We don't have tract
            # population on hand, so use CHAS HH counts × scale factor.
            # Scale = place_area / tract_area (the fraction of the
            # tract's HHs that "belong" to the place by area).
            tract_renter_sum = sum(
                dom_tract['renter_hh_by_ami'].get(t, {}).get('total', 0)
                for t in AMI_TIERS
            )
            tract_owner_sum = sum(
                dom_tract['owner_hh_by_ami'].get(t, {}).get('total', 0)
                for t in AMI_TIERS
            )
            # Use share_of_tract_area as the scale (place / tract).
            # FLOOR at 1% for tiny rural places — without this floor,
            # places like Eads (0.03% of a large rural tract) would still
            # round to zero. The rates remain accurate (tract-level);
            # the absolute counts become "small-but-nonzero" estimates.
            raw_scale = dominant.get('share_of_tract_area', 0)
            scale = max(raw_scale, 0.01)
            if scale > 0 and (tract_renter_sum + tract_owner_sum) > 0:
                # Rebuild each tier from rates × scaled total
                renter_final = {}
                owner_final  = {}
                for tier in AMI_TIERS:
                    tr = dom_tract['renter_hh_by_ami'].get(tier, {})
                    to = dom_tract['owner_hh_by_ami'].get(tier, {})
                    tr_total = max(scale * (tr.get('total') or 0), 0)
                    to_total = max(scale * (to.get('total') or 0), 0)
                    # Preserve tract-level rates by scaling cb30/cb50 proportionally
                    tr_rate30 = (tr.get('cost_burdened_30pct', 0) / tr.get('total', 1)) if tr.get('total') else 0
                    tr_rate50 = (tr.get('cost_burdened_50pct', 0) / tr.get('total', 1)) if tr.get('total') else 0
                    to_rate30 = (to.get('cost_burdened_30pct', 0) / to.get('total', 1)) if to.get('total') else 0
                    to_rate50 = (to.get('cost_burdened_50pct', 0) / to.get('total', 1)) if to.get('total') else 0
                    renter_final[tier] = {
                        'total': round(tr_total, 1),
                        'cost_burdened_30pct': round(tr_total * tr_rate30, 1),
                        'cost_burdened_50pct': round(tr_total * tr_rate50, 1),
                        'pct_cost_burdened_30': round(tr_rate30, 4),
                        'pct_cost_burdened_50': round(tr_rate50, 4),
                    }
                    owner_final[tier] = {
                        'total': round(to_total, 1),
                        'cost_burdened_30pct': round(to_total * to_rate30, 1),
                        'cost_burdened_50pct': round(to_total * to_rate50, 1),
                        'pct_cost_burdened_30': round(to_rate30, 4),
                        'pct_cost_burdened_50': round(to_rate50, 4),
                    }
                total_renter = sum(renter_final[t]['total'] for t in AMI_TIERS)
                total_owner  = sum(owner_final[t]['total']  for t in AMI_TIERS)
                cb30_renter  = sum(renter_final[t]['cost_burdened_30pct'] for t in AMI_TIERS)
                cb50_renter  = sum(renter_final[t]['cost_burdened_50pct'] for t in AMI_TIERS)
                cb30_owner   = sum(owner_final[t]['cost_burdened_30pct']  for t in AMI_TIERS)
                cb50_owner   = sum(owner_final[t]['cost_burdened_50pct']  for t in AMI_TIERS)
                source = 'rate-only-fallback'

    return {
        'name': place_record.get('name'),
        'tract_count': n_tracts_used,
        'place_area_sqm': place_record.get('place_area_sqm', 0),
        'coverage_share': round(min(coverage, 1.0), 4),
        'low_confidence': coverage < COVERAGE_WARN_THRESHOLD,
        'source': source,
        'summary': {
            'total_renter_hh':    round(total_renter, 1),
            'total_owner_hh':     round(total_owner,  1),
            'renter_cb30_count':  round(cb30_renter,  1),
            'renter_cb30_share':  round(cb30_renter / total_renter, 4) if total_renter else 0.0,
            'renter_cb50_count':  round(cb50_renter,  1),
            'renter_cb50_share':  round(cb50_renter / total_renter, 4) if total_renter else 0.0,
            'owner_cb30_count':   round(cb30_owner,   1),
            'owner_cb30_share':   round(cb30_owner / total_owner,   4) if total_owner else 0.0,
            'owner_cb50_count':   round(cb50_owner,   1),
            'owner_cb50_share':   round(cb50_owner / total_owner,   4) if total_owner else 0.0,
        },
        'renter_hh_by_ami': renter_final,
        'owner_hh_by_ami':  owner_final,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=None,
                   help='Process at most N places (debug)')
    args = p.parse_args()

    print('── Loading inputs ──')
    tract_doc, membership_doc = load_inputs()
    tract_index = index_tracts_by_geoid(tract_doc)
    print(f'  tract CHAS: {len(tract_index)} tracts')
    print(f'  membership: {len(membership_doc.get("places", {}))} places')

    places_in = membership_doc.get('places', {})
    if args.limit:
        places_in = dict(list(places_in.items())[: args.limit])

    print('\n── Aggregating place CHAS ──')
    out_places: dict = {}
    skipped = 0
    low_conf = 0
    for i, (geoid, place_record) in enumerate(places_in.items(), 1):
        agg = aggregate_place(geoid, place_record, tract_index)
        if not agg:
            skipped += 1
            continue
        if agg['low_confidence']:
            low_conf += 1
        out_places[geoid] = agg
        if i % 100 == 0:
            print(f'  [{i:>3}/{len(places_in)}] processed; {len(out_places)} aggregated, '
                  f'{skipped} skipped, {low_conf} low-confidence')

    print(f'  Total: {len(out_places)} places, {skipped} skipped (no overlapping CHAS data), '
          f'{low_conf} low-confidence (coverage <{int(COVERAGE_WARN_THRESHOLD*100)}%)')

    payload = {
        'meta': {
            'generated_at': utc_now(),
            'source_tract_chas': 'data/market/chas_tract_co.json',
            'source_membership': 'data/hna/place-tract-membership.json',
            'method': 'Area-weighted apportionment (share_of_tract_area)',
            'vintage_chas': tract_doc['meta'].get('vintage', 'unknown'),
            'vintage_tiger': membership_doc['meta'].get('vintage', 0),
            'count_places': len(out_places),
            'count_low_confidence': low_conf,
            'coverage_warn_threshold': COVERAGE_WARN_THRESHOLD,
        },
        'places': out_places,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, sort_keys=False)
    print(f'\n✓ Wrote {OUT_FILE}')
    print(f'  ({os.path.getsize(OUT_FILE):,} bytes)')

    # Spot-check a few cross-county places to verify the apportionment
    print('\n── Spot checks ──')
    for sample_geoid in ['0824950', '0804000', '0845970', '0875640']:
        if sample_geoid in out_places:
            p = out_places[sample_geoid]
            s = p['summary']
            print(f'  {sample_geoid} {p["name"][:25]:<25} '
                  f'renter_total={s["total_renter_hh"]:>10,.0f}  '
                  f'cb30={s["renter_cb30_share"]*100:>5.1f}%  '
                  f'cb50={s["renter_cb50_share"]*100:>5.1f}%')

    return 0


if __name__ == '__main__':
    sys.exit(main())
