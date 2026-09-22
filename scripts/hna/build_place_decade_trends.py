#!/usr/bin/env python3
"""
scripts/hna/build_place_decade_trends.py

F226 — Place-level companion to data/co-housing-costs/county-trends.json.

Today, the "How Affordable Has Housing Become Over the Last 15 Years?" chart
on hna-what-households-can-afford.html falls back to the containing county
for every place selection (renderDecadeAffordTrend() in hna-renderers.js),
with an honest "these figures are the county's, not yours" banner — because
the only source it has, county-trends.json, is built from a one-off county-
level parquet with no place-level equivalent. That's accurate but narrower
than it needs to be: ACS 5-Year DP03/DP04 profile tables (the same tables
already used for the page's CURRENT-vintage place-level rent/income/burden
numbers) also publish at place geography for the 2009 and 2014 vintages,
not just 2024 — nothing about the underlying Census data forces a
county-only chart, it's just that no one had fetched the historical place
vintages yet.

This script fetches those historical vintages at PLACE geography via
ACSExtractor (the same fetcher class + rate limiter used throughout
scripts/hna/), for the 482-place universe already tracked in
data/hna/place-tract-membership.json (the same universe
scripts/market/build_fhfa_hpi_subcounty.py aggregates FHFA tract HPI up to),
and merges in each place's 15-year home-price change from
data/market/fhfa_hpi_subcounty_co.json when available.

Variable IDs are NOT stable across ACS profile vintages. The first live run
(build-hna-data.yml run 35722034824, 2026-09-22) requested the 2024 IDs from
acs_field_mapping.json for every vintage: the 2009 DP03 response returned
the "$200,000 or more" household COUNT under DP03_0062E (Fruita: 111), and
every 2009/2014 DP04 request failed with HTTP 400 (964 of them = 482 places
x 2 vintages) because the Census API rejects a request wholesale when any
one variable in it is unknown for that year — DP04_0142PE/DP04_0143PE do
not exist in the 2009 or 2014 profile — so rent and the GRAPI bins came
back null for both historical vintages. VINTAGE_VARIABLES below carries each
vintage's own IDs (verified against the public
api.census.gov/data/<year>/acs/acs5/profile/variables.json), and
fetch_cohort() passes exactly those four IDs per vintage to ACSExtractor
instead of the mapping file's current-vintage list.

Requires CENSUS_API_KEY (see scripts/hna/acs_etl.py's ACSExtractor) — keyless
Census API calls always fail (the .github/workflows/build-hna-data.yml
"Environment check" step hard-gates on this for the same reason). Run this
via a GitHub Actions workflow with that secret, not locally without one.

Output: data/hna/place-decade-trends.json, keyed by 7-digit place GEOID,
with an `acs_cohorts` array shaped exactly like county-trends.json's, so
hna-renderers.js's renderDecadeAffordTrend() can read either file through
the same rendering code — only the LOOKUP (place file first, county
fallback second) needs to change.

Coverage: the 2005-2009 ACS 5-year estimate was the first 5-year ACS ever
published, and very small places may not have a reliable place-level
estimate that far back — or ANY place-level estimate for some sparse-data
variables. A place missing either its earliest (2009) or latest (2024)
cohort is left OUT of this file entirely: a 15-year comparison with only
one end of the comparison isn't a 15-year comparison, and the existing
county-inherits fallback already covers that place honestly.

meta records WHY each unusable (place, vintage) pair was not written, as
three separate counts (see classify_cohort): cohorts_missing_geography
(Census answered HTTP 204 — the place did not exist in that vintage),
cohorts_suppressed (fields present but the median rent or income is
suppressed), and cohorts_rejected_implausible (values present but failing
the >= $200 rent / >= $5,000 income gate). Only the last one indicates a
problem worth investigating.

Usage:
  CENSUS_API_KEY=... python3 scripts/hna/build_place_decade_trends.py
  CENSUS_API_KEY=... python3 scripts/hna/build_place_decade_trends.py --limit 5   # smoke test
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from acs_etl import ACSExtractor  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MEMBERSHIP_PATH = os.path.join(ROOT, 'data', 'hna', 'place-tract-membership.json')
HPI_SUBCOUNTY_PATH = os.path.join(ROOT, 'data', 'market', 'fhfa_hpi_subcounty_co.json')
OUT_PATH = os.path.join(ROOT, 'data', 'hna', 'place-decade-trends.json')

VINTAGES = [2009, 2014, 2024]

# The four semantic fields a cohort needs, and the ACS type each is coerced
# to (same type vocabulary as acs_field_mapping.json).
COHORT_FIELD_TYPES = {
    'income': 'integer',          # Median household income (dollars)
    'rent': 'integer',            # Median gross rent (dollars), occupied units paying rent
    'grapi_30_34': 'percentage',  # Gross rent as % of household income: 30.0-34.9%
    'grapi_35_plus': 'percentage',  # Gross rent as % of household income: 35.0%+
}

# Per-vintage ACS 5-year PROFILE variable IDs for those four fields. Each
# row was read off the public variables.json for that year (the labels are
# quoted in tests/test_build_place_decade_trends.py). Where the numbering
# shifted between vintages:
#   - median household income: DP03_0063E in 2009 (DP03_0062E there is the
#     "$200,000 or more" household count), DP03_0062E from 2014 on.
#   - median gross rent: DP04_0132E in 2009 and 2014 (DP04_0134E there is
#     the GRAPI universe count), DP04_0134E in 2024.
#   - GRAPI 30.0-34.9% / 35.0%+: DP04_0139PE / DP04_0140PE in 2009 and 2014,
#     DP04_0141PE / DP04_0142PE in 2024 (DP04_0141PE was "Not computed" in
#     the older vintages; DP04_0142PE did not exist).
# The 2024 row must stay identical to acs_field_mapping.json's IDs — a test
# enforces that so the two can't drift apart.
VINTAGE_VARIABLES = {
    2009: {'income': 'DP03_0063E', 'rent': 'DP04_0132E', 'grapi_30_34': 'DP04_0139PE', 'grapi_35_plus': 'DP04_0140PE'},
    2014: {'income': 'DP03_0062E', 'rent': 'DP04_0132E', 'grapi_30_34': 'DP04_0139PE', 'grapi_35_plus': 'DP04_0140PE'},
    2024: {'income': 'DP03_0062E', 'rent': 'DP04_0134E', 'grapi_30_34': 'DP04_0141PE', 'grapi_35_plus': 'DP04_0142PE'},
}


def vintage_variables(year: int) -> dict[str, dict[str, str]]:
    """The ACSExtractor ``variables`` override for one vintage:
    ``{table_id: {variable_id: type_hint}}`` covering exactly the four cohort
    fields — nothing else, so a 2024-only ID can never sneak into a 2009
    request and void the whole batch."""
    ids = VINTAGE_VARIABLES[year]
    out: dict[str, dict[str, str]] = {}
    for field, var_id in ids.items():
        table_id = var_id.split('_', 1)[0]
        out.setdefault(table_id, {})[var_id] = COHORT_FIELD_TYPES[field]
    return out


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def load_places() -> dict:
    with open(MEMBERSHIP_PATH, encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('places', {})


def load_hpi_subcounty() -> dict:
    # Additive-only dependency: if this file is missing, stale, or the
    # separate FHFA county-parquet-schema bug (see the task this script's PR
    # description links) still blocks regenerating it, this script still
    # produces a fully valid output — just without a hpi.change_15y figure
    # for any place. renderDecadeAffordTrend() already tolerates a missing
    # hpi block (see its `hpi.change_15y != null ? ... : null` handling).
    if not os.path.exists(HPI_SUBCOUNTY_PATH):
        return {}
    with open(HPI_SUBCOUNTY_PATH, encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('places', {})


def rent_burden_30_plus_pct(fields: dict, year: int = VINTAGES[-1]) -> float | None:
    """Share of renter households paying >=30% of income on rent, as a
    percentage: the sum of that vintage's GRAPI 30-34.9% and 35%+ bins
    (see VINTAGE_VARIABLES for which IDs those are in *year*)."""
    ids = VINTAGE_VARIABLES[year]
    g30 = fields.get(ids['grapi_30_34'])
    g35 = fields.get(ids['grapi_35_plus'])
    if g30 is None and g35 is None:
        return None
    return round((g30 or 0) + (g35 or 0), 1)


def is_plausible_cohort(rent, income) -> bool:
    """A cohort counts only with a plausible median gross rent (>= $200/mo) AND
    median household income (>= $5,000/yr). Anything else is a wrong field,
    a sentinel, or a suppressed estimate — never publishable as history.
    Mirrors _plausibleCohort() in js/hna/hna-renderers.js."""
    try:
        return float(rent) >= 200 and float(income) >= 5000
    except (TypeError, ValueError):
        return False


# The three reasons a fetched vintage does not become a cohort. None of them
# is written; they differ only in what they mean for the place:
#   missing_geography — ACSExtractor returned no data fields at all for the
#       place at that vintage (only its own _fetched_at/_geoid bookkeeping).
#       Census answered HTTP 204 for both DP03 and DP04: the geography did not
#       exist in that vintage (CDPs delineated after 2009/2014). Not an error,
#       and not "implausible" — there was nothing to judge.
#   suppressed — fields came back, but the median rent or median income is
#       None: the Census suppressed the estimate (too few sample cases in a
#       very small place). A legitimate outcome of the gate, not a bug.
#   rejected_implausible — both medians are present but fail the gate above:
#       a wrong variable ID (the first live run's $111 "income"), a sentinel,
#       or some other value that must never be charted as history.
COHORT_MISSING_GEOGRAPHY = 'missing_geography'
COHORT_SUPPRESSED = 'suppressed'
COHORT_REJECTED_IMPLAUSIBLE = 'rejected_implausible'


def data_fields(fields: dict | None) -> dict:
    """The ACS variables in an ACSExtractor result, without the extractor's
    own ``_fetched_at`` / ``_geoid`` bookkeeping keys. ACSExtractor.fetch_all()
    returns a dict for EVERY requested geoid, even one whose every table
    fetch failed, so ``if not fields`` cannot tell "no data" from "data"."""
    if not fields:
        return {}
    return {k: v for k, v in fields.items() if not k.startswith('_')}


def classify_cohort(fields: dict | None, year: int) -> str | None:
    """Why a fetched vintage is NOT usable as a cohort — one of the three
    COHORT_* reasons — or None when it passes the plausibility gate."""
    if not data_fields(fields):
        return COHORT_MISSING_GEOGRAPHY
    ids = VINTAGE_VARIABLES[year]
    income = fields.get(ids['income'])
    rent = fields.get(ids['rent'])
    if rent is None or income is None:
        return COHORT_SUPPRESSED
    if not is_plausible_cohort(rent, income):
        return COHORT_REJECTED_IMPLAUSIBLE
    return None


def fetch_cohort(geoids: list[str], year: int) -> dict:
    """Fetch DP03 (median household income) + DP04 (median gross rent, GRAPI
    rent-burden bins) for every geoid at one ACS 5-year vintage, requesting
    that vintage's own variable IDs (VINTAGE_VARIABLES) rather than
    acs_field_mapping.json's current-vintage list. Results are keyed by the
    raw variable ID actually requested for *year*."""
    variables = vintage_variables(year)
    fetcher = ACSExtractor(sorted(variables), geoids, year=year, variables=variables)
    results = fetcher.fetch_all()
    if fetcher.no_content_count:
        print(
            f'[place-decade-trends] {year}: {fetcher.no_content_count} table fetches returned '
            f'HTTP 204 (geography not published in this vintage; expected for CDPs delineated later)',
            file=sys.stderr,
        )
    return results


def build(geoids: list[str]) -> dict:
    places = load_places()
    hpi_subcounty = load_hpi_subcounty()

    by_year = {}
    for year in VINTAGES:
        print(f'[place-decade-trends] fetching {len(geoids)} places for {year}...', file=sys.stderr)
        by_year[year] = fetch_cohort(geoids, year)

    out_places = {}
    skipped_incomplete = 0
    unusable = {COHORT_MISSING_GEOGRAPHY: 0, COHORT_SUPPRESSED: 0, COHORT_REJECTED_IMPLAUSIBLE: 0}
    implausible: list[dict] = []
    for geoid in geoids:
        cohorts = []
        for year in VINTAGES:
            fields = (by_year.get(year) or {}).get(geoid)
            # Plausibility gate. The first live run published 2009/2014
            # cohorts with null rent and "incomes" of 0-11 for every place
            # because it requested the 2024 variable IDs from every vintage
            # (see the module docstring). VINTAGE_VARIABLES is the real fix;
            # this gate stays as the backstop so a wrong field, a sentinel,
            # or a suppressed estimate can never be written as history. An
            # unusable vintage is counted under WHY it was unusable (see
            # classify_cohort: absent geography, suppressed median, or a
            # value that is present but implausible), and the place then
            # fails the earliest/latest check below and is omitted, so the
            # renderer keeps its county fallback. The first correct run
            # (2026-09-22) lumped all three under "implausible": 502 of
            # them, of which 161 were CDPs that simply did not exist in
            # 2009/2014 and most of the rest were suppressed medians.
            reason = classify_cohort(fields, year)
            if reason is not None:
                unusable[reason] += 1
                if reason == COHORT_REJECTED_IMPLAUSIBLE:
                    # The only one of the three that can mean a bug (a wrong
                    # variable ID, a sentinel). Name it, in the run log and
                    # in meta, so it can be looked at without re-fetching:
                    # the first correct run reported 3 of these and nothing
                    # said which places or what values.
                    ids = VINTAGE_VARIABLES[year]
                    rec = {
                        'geoid': geoid,
                        'place_name': places.get(geoid, {}).get('name'),
                        'year': year,
                        'median_gross_rent': fields.get(ids['rent']),
                        'median_hh_income': fields.get(ids['income']),
                    }
                    implausible.append(rec)
                    print(
                        f"[place-decade-trends] implausible cohort rejected: {geoid} "
                        f"({rec['place_name']}) {year}: rent={rec['median_gross_rent']} "
                        f"income={rec['median_hh_income']} (gate: rent >= 200 and income >= 5000)",
                        file=sys.stderr,
                    )
                continue
            ids = VINTAGE_VARIABLES[year]
            income = fields.get(ids['income'])
            rent = fields.get(ids['rent'])
            burden_pct = rent_burden_30_plus_pct(fields, year)
            cohorts.append({
                'year': year,
                'median_gross_rent': rent,
                'median_hh_income': income,
                'rent_burden_30_plus': (burden_pct / 100.0) if burden_pct is not None else None,
            })

        has_earliest = any(c['year'] == VINTAGES[0] for c in cohorts)
        has_latest = any(c['year'] == VINTAGES[-1] for c in cohorts)
        if not (has_earliest and has_latest):
            skipped_incomplete += 1
            continue

        hpi = hpi_subcounty.get(geoid) or {}
        change_15y = hpi.get('change_15y')
        # Schema matches county-trends.json's hpi block exactly (change_15y_pct,
        # not change_15y) so hna-renderers.js's renderDecadeAffordTrend() reads
        # `hpi.change_15y_pct` the same way for either file.
        out_places[geoid] = {
            'place_name': places.get(geoid, {}).get('name'),
            'acs_cohorts': sorted(cohorts, key=lambda c: c['year']),
            'hpi': {'change_15y_pct': change_15y} if change_15y is not None else None,
        }

    return {
        'meta': {
            'generated': _utc_now(),
            'vintage_years': VINTAGES,
            'vintage_variables': {str(y): VINTAGE_VARIABLES[y] for y in VINTAGES},
            'source': (
                'ACS 5-Year DP03 (median household income) + DP04 (median gross rent, '
                'GRAPI rent-burden bins), place geography'
            ),
            'hpi_source': (
                'data/market/fhfa_hpi_subcounty_co.json (FHFA tract HPI aggregated to '
                'place via TIGER place-tract membership); omitted per-place when that '
                'file has no change_15y for the place'
            ),
            'place_count': len(out_places),
            'places_skipped_incomplete_history': skipped_incomplete,
            # Per-vintage-per-place counts of why a fetched vintage was not
            # written (see classify_cohort). They sum to the number of
            # (place, vintage) pairs that did not become a cohort.
            'cohorts_missing_geography': unusable[COHORT_MISSING_GEOGRAPHY],
            'cohorts_suppressed': unusable[COHORT_SUPPRESSED],
            'cohorts_rejected_implausible': unusable[COHORT_REJECTED_IMPLAUSIBLE],
            # Each implausible rejection, named (geoid, place, year, the two
            # medians as fetched) so the file itself says which places
            # tripped the gate and on what values. Always a list, empty when
            # nothing was rejected.
            'implausible_cohorts': implausible,
            'total_places_considered': len(geoids),
        },
        'places': out_places,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--limit', type=int, default=None,
                         help='Only process the first N places, sorted by GEOID (smoke test).')
    args = parser.parse_args()

    all_geoids = sorted(load_places().keys())
    geoids = all_geoids[:args.limit] if args.limit else all_geoids

    payload = build(geoids)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
        fh.write('\n')

    meta = payload['meta']
    print(
        f"[place-decade-trends] wrote {os.path.relpath(OUT_PATH, ROOT)}: "
        f"{meta['place_count']} places with full {VINTAGES[0]}-{VINTAGES[-1]} history, "
        f"{meta['places_skipped_incomplete_history']} skipped (incomplete history); "
        f"unusable cohorts: {meta['cohorts_missing_geography']} geography absent in that vintage, "
        f"{meta['cohorts_suppressed']} median suppressed, "
        f"{meta['cohorts_rejected_implausible']} rejected as implausible",
        file=sys.stderr,
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
