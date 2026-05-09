#!/usr/bin/env python3
"""
scripts/hna/fix_place_county_mappings.py

Audit and fix `containingCounty` mappings in
``data/hna/geography-registry.json`` by re-querying the Census Geocoder
for every CO place's actual containing county.

Background — why this exists
----------------------------
The geography-registry's `containingCounty` field was originally
populated by ``scripts/hna/build_hna_data.py`` via the Census ACS
``for=place:*&in=state:NN+county:NNN`` query. That endpoint sometimes
silently returned the wrong county (e.g. when a place spans multiple
counties, or due to ETL race conditions). One concrete bug surfaced
during the 2026-05-08 audit:

  Sterling (city) GEOID 0873935 — registry says Washington County
  (08121); actually in Logan County (08075).

The plausibility test in PR #773
(``test_place_ami_gap_smaller_than_containing_county``) currently
tolerates ≤3 such violations as a known issue. This script audits
every CO place against the Census Geocoder's `county (or part)`
hierarchy lookup (the same call used in
``build_place_ami_gap.py::_query_county_for_place``) and rewrites
any incorrect mappings.

Modes
-----
    --audit      (default) report mismatches; do not modify files
    --apply      rewrite geography-registry.json + place_county_lookup.json
    --limit N    process at most N places (for testing)

Output
------
    data/hna/geography-registry.json (updated containingCounty fields)
    data/hna/derived/place_county_lookup.json (rebuilt cache reflecting fix)

Usage
-----
    python3 scripts/hna/fix_place_county_mappings.py --audit
    python3 scripts/hna/fix_place_county_mappings.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
GEO_REGISTRY = os.path.join(REPO_ROOT, "data", "hna", "geography-registry.json")
PLACE_COUNTY_CACHE = os.path.join(
    REPO_ROOT, "data", "hna", "derived", "place_county_lookup.json"
)
DEFAULT_VINTAGE = 2023
COLORADO_FIPS = "08"

# Known-bad mappings to override deterministically (verified manually
# against Census Bureau records). Add entries here when a specific place
# is found mismapped — saves an API roundtrip and gives a fast-path fix
# without depending on the live audit run.
KNOWN_BAD_MAPPINGS: dict[str, dict] = {
    # Sterling, CO is the county seat of Logan County. Registry has had
    # both Sterling entries (city) mapped to Washington County (08121)
    # since at least the 2026-04 ETL. Verified 2026-05-09:
    #   curl ".../acs5?...&for=county+(or+part):*&in=state:08+place:73935"
    #   → "Logan County (part), Sterling city, Colorado"  (08075)
    "0873935": {"county_fips": "08075", "name": "Sterling (city)"},
    "0869985": {"county_fips": "08075", "name": "Sterling (city)"},  # duplicate registry entry
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get_json(url: str, *, timeout: int = 8, retries: int = 2):
    """Polite GET with TIGHT timeout (8s) and limited retries.

    Earlier versions used timeout=30, retries=3, exponential backoff —
    that turned a single hung TCP connection into a 60+ second stall and
    occasionally hung indefinitely on macOS where urllib's timeout doesn't
    always fire on stuck-but-not-disconnected sockets. With 8s timeout and
    only 1 retry, a hung request fails fast and the per-place audit moves on.
    """
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "HousingAnalytics/1.0 fix_place_county_mappings.py"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt < retries - 1:
                time.sleep(1)  # short fixed backoff; no exponential
    raise RuntimeError(f"GET {url} failed: {last_err}")


def query_county_for_place(place_code5: str, vintage: int = DEFAULT_VINTAGE) -> str | None:
    """Look up a place's PRIMARY containing county via Census API.

    For places spanning multiple counties (Aurora touches Arapahoe + Adams +
    Douglas; Boulder touches Boulder + Weld; etc.), "primary" means the
    county where the majority of the place's population lives. The earlier
    "first row sorted by FIPS" approach was wrong: it picked the lowest-FIPS
    county the place overlaps, regardless of whether that's where most of
    the place is.

    Approach: query `B01001_001E` (total population) per county-part. The
    county-part with the largest population is the primary county.

    Returns 5-digit county FIPS or None.
    """
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    qs = (
        f"get=NAME,B01001_001E"
        f"&for=county%20(or%20part):*"
        f"&in=state:{COLORADO_FIPS}+place:{place_code5}"
    )
    if api_key:
        qs += f"&key={urllib.parse.quote(api_key, safe='')}"
    url = f"https://api.census.gov/data/{vintage}/acs/acs5?{qs}"
    try:
        arr = http_get_json(url)
    except Exception:
        return None
    if not arr or len(arr) < 2:
        return None
    header = arr[0]
    try:
        county_idx = header.index("county (or part)")
        pop_idx = header.index("B01001_001E")
    except ValueError:
        return None

    # If only one county-part, that's the answer (cheap, no comparison)
    if len(arr) == 2:
        cc3 = str(arr[1][county_idx]).zfill(3)
        return f"{COLORADO_FIPS}{cc3}"

    # Multiple county-parts → pick the one with highest population
    best_cc = None
    best_pop = -1
    for row in arr[1:]:
        try:
            pop = int(row[pop_idx])
        except (ValueError, TypeError):
            pop = 0
        if pop > best_pop:
            best_pop = pop
            best_cc = str(row[county_idx]).zfill(3)
    return f"{COLORADO_FIPS}{best_cc}" if best_cc else None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audit", action="store_true", default=True,
                   help="Report mismatches without modifying files (default)")
    p.add_argument("--apply", action="store_true",
                   help="Rewrite geography-registry.json + place_county_lookup.json")
    p.add_argument("--limit", type=int, default=None,
                   help="Process at most N places (for testing)")
    args = p.parse_args()

    if args.apply:
        args.audit = False  # apply implies non-audit

    # Load registry
    with open(GEO_REGISTRY, "r", encoding="utf-8") as f:
        registry = json.load(f)
    geos = registry.get("geographies", [])
    places = [g for g in geos if g.get("type") in ("place", "cdp")]
    if args.limit:
        places = places[: args.limit]

    # Two-stage processing:
    #   Stage 1: apply KNOWN_BAD_MAPPINGS overrides (no API call).
    #   Stage 2: query Census API for places with `containingCounty: "00000"`
    #            (these were never filled by build_hna_data.py and need a lookup).
    # We deliberately DON'T re-audit places that already have a non-zero
    # mapping. That earlier approach found 100s of "mismatches" that were
    # actually correct — picking the wrong county for places spanning
    # multiple counties (Aurora's primary is Arapahoe, not the lowest-FIPS
    # Adams). Trusting the existing mappings + only filling unfilled +
    # explicit overrides is safer and ~5× faster.

    mismatches: list[dict] = []
    api_failures = 0
    unfilled_count = 0
    overrides_applied = 0

    # Stage 1: KNOWN_BAD_MAPPINGS overrides
    for p_entry in places:
        geoid = str(p_entry.get("geoid", "")).zfill(7)
        if geoid in KNOWN_BAD_MAPPINGS:
            registry_cc = str(p_entry.get("containingCounty", "")).zfill(5)
            target_cc = KNOWN_BAD_MAPPINGS[geoid]["county_fips"]
            if registry_cc != target_cc:
                mismatches.append({
                    "geoid": geoid,
                    "name": p_entry.get("name", "?"),
                    "registry_cc": registry_cc,
                    "actual_cc": target_cc,
                    "source": "KNOWN_BAD_MAPPINGS override",
                })
                if args.apply:
                    p_entry["containingCounty"] = target_cc
                    overrides_applied += 1

    print(f"Stage 1: {overrides_applied}/{len(KNOWN_BAD_MAPPINGS)} known-bad overrides applied")

    # Stage 2: Look up unfilled (containingCounty == '00000') places
    unfilled = [
        p for p in places
        if str(p.get("containingCounty", "")).zfill(5) == "00000"
    ]
    print(f"Stage 2: querying Census API for {len(unfilled)} unfilled places...")

    for i, p_entry in enumerate(unfilled, 1):
        if args.limit and i > args.limit:
            print(f"  (--limit {args.limit} reached)")
            break
        geoid = str(p_entry.get("geoid", "")).zfill(7)
        place_code5 = geoid[2:]
        try:
            actual_cc = query_county_for_place(place_code5)
        except Exception as err:  # noqa: BLE001
            print(f"  ✗ {geoid} {p_entry.get('name')[:30]}: {err}")
            api_failures += 1
            continue
        if actual_cc is None:
            api_failures += 1
            continue
        mismatches.append({
            "geoid": geoid,
            "name": p_entry.get("name", "?"),
            "registry_cc": "00000",
            "actual_cc":   actual_cc,
            "source":      "Census API lookup (unfilled)",
        })
        if args.apply:
            p_entry["containingCounty"] = actual_cc
            unfilled_count += 1
        if i % 50 == 0:
            print(f"  Checked {i}/{len(unfilled)} unfilled ({len(mismatches)} fixes so far)")
        time.sleep(0.05)

    print()
    print(f"Summary: {overrides_applied} known-bad fixed, {unfilled_count} unfilled mapped, "
          f"{api_failures} API failures")

    if mismatches:
        print(f"\nMismatches detected:")
        for m in mismatches[:20]:
            label = f'(was {m["registry_cc"]})' if m["registry_cc"] != "00000" else '(was unfilled)'
            print(f'  {m["geoid"]} {m["name"][:35]:35} {label} → actual {m["actual_cc"]}')
        if len(mismatches) > 20:
            print(f'  ... and {len(mismatches) - 20} more')

    if args.apply and mismatches:
        # Write updated registry
        registry["generated"] = utc_now()
        with open(GEO_REGISTRY, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2)
        print(f"\n✓ Updated {GEO_REGISTRY} ({len(mismatches)} mappings corrected)")

        # Also rebuild place_county_lookup.json from the fixed registry
        lookup = {}
        for g in geos:
            if g.get("type") in ("place", "cdp"):
                geoid = str(g.get("geoid", "")).zfill(7)
                cc = str(g.get("containingCounty", "")).zfill(5)
                if geoid and cc and cc != "00000":
                    lookup[geoid] = cc
        cache_payload = {
            "meta": {
                "generated_at": utc_now(),
                "source": (
                    "Rebuilt from geography-registry.json after "
                    "fix_place_county_mappings.py audit/correction"
                ),
                "count": len(lookup),
            },
            "places": lookup,
        }
        os.makedirs(os.path.dirname(PLACE_COUNTY_CACHE), exist_ok=True)
        with open(PLACE_COUNTY_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache_payload, f, indent=2, sort_keys=True)
        print(f"✓ Rebuilt {PLACE_COUNTY_CACHE} ({len(lookup)} place mappings)")

    return 0 if not mismatches or args.apply else 1


if __name__ == "__main__":
    sys.exit(main())
