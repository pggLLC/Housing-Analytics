#!/usr/bin/env python3
"""
scripts/build_apartment_list_co.py
==================================
Scrape Apartment List's monthly rent-report pages for Colorado cities.

Apartment List does not publish a public CSV; their data lives in the
narrative prose of their per-city "rent report" pages (Next.js client-
rendered). The figures we want — citywide overall median, 1BR median,
2BR median, YoY change — DO appear as static text in the SSR'd HTML
in a stable pattern:

  > "Currently, the overall median rent in the city stands at $1,602..."
  > "the median rent currently stands at $1,417 for a 1-bedroom apartment
  >  and $1,766 for a 2-bedroom"
  > "...has now decreased by a total of 5.1% over the past 12 months"

This script fetches a fixed list of CO city rent-reports, extracts those
fields with regex, and writes a JSON file at
data/market/apartment_list_co.json. Soft-fail on individual cities so a
report-format tweak on one page doesn't kill the build.

Triangulates with Zillow ZORI (data/market/zori_rents_co.json) — ZORI is
a smoothed all-BR index, Apartment List publishes specific BR cuts, so
the two together let you sanity-check median market rent per BR for the
major CO cities.

Output schema:
  {
    "meta": { source, source_pattern, vintage_label, generated_at, ... },
    "statewide_average_overall": <number or null>,
    "cities": {
      "denver": { name, slug, rent_overall, rent_1br, rent_2br, yoy_change_pct,
                  national_rank, source_url },
      ...
    }
  }
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "market" / "apartment_list_co.json"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36 (+COHO-Analytics market-rent integration)"
)

# CO cities that Apartment List covers as of 2026-05. Slugs match their
# /rent-report/co/<slug> URL pattern. If a slug stops resolving we just
# skip that city (soft-fail per fetch).
CITIES: list[tuple[str, str]] = [
    ("denver",           "Denver"),
    ("aurora",           "Aurora"),
    ("colorado-springs", "Colorado Springs"),
    ("boulder",          "Boulder"),
    ("fort-collins",     "Fort Collins"),
    ("lakewood",         "Lakewood"),
    ("thornton",         "Thornton"),
    ("arvada",           "Arvada"),
    ("westminster",      "Westminster"),
    ("pueblo",           "Pueblo"),
    ("centennial",       "Centennial"),
    ("greeley",          "Greeley"),
    ("longmont",         "Longmont"),
    ("loveland",         "Loveland"),
    ("broomfield",       "Broomfield"),
    ("commerce-city",    "Commerce City"),
    ("castle-rock",      "Castle Rock"),
    ("parker",           "Parker"),
    ("littleton",        "Littleton"),
    ("englewood",        "Englewood"),
    ("wheat-ridge",      "Wheat Ridge"),
    ("northglenn",       "Northglenn"),
    ("brighton",         "Brighton"),
]

BASE = "https://www.apartmentlist.com/rent-report/co/{slug}"


def _fetch(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  fetch failed for {url}: {e}", file=sys.stderr)
        return None


# Regex patterns matched against the narrative.
# Numbers are inside $X,YYY format. Negative changes have a 'decreased by'
# clause; positive use 'increased by' or 'risen'.
_RE_OVERALL = re.compile(r"the overall median rent in the city stands at \$([0-9,]+)", re.I)
_RE_BR_PAIR = re.compile(
    r"the median rent currently stands at \$([0-9,]+) for a 1-bedroom apartment "
    r"and \$([0-9,]+) for a 2-bedroom",
    re.I,
)
_RE_YOY_DOWN = re.compile(r"decreased by a total of ([0-9.]+)% over the past 12 months", re.I)
_RE_YOY_UP   = re.compile(r"(?:increased by a total of|risen by) ([0-9.]+)% over the past 12 months", re.I)
_RE_RANK     = re.compile(r"#(\d+) most expensive (?:large )?city in the U\.S\.", re.I)


def _parse_money(s: str) -> int | None:
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return None


def parse_report(html: str) -> dict | None:
    """Extract fields from one city's rent-report HTML."""
    if not html:
        return None
    out: dict = {}

    m = _RE_OVERALL.search(html)
    if m:
        out["rent_overall"] = _parse_money(m.group(1))

    m = _RE_BR_PAIR.search(html)
    if m:
        out["rent_1br"] = _parse_money(m.group(1))
        out["rent_2br"] = _parse_money(m.group(2))

    m = _RE_YOY_DOWN.search(html)
    if m:
        try:
            out["yoy_change_pct"] = -float(m.group(1))
        except ValueError:
            pass
    else:
        m = _RE_YOY_UP.search(html)
        if m:
            try:
                out["yoy_change_pct"] = float(m.group(1))
            except ValueError:
                pass

    m = _RE_RANK.search(html)
    if m:
        try:
            out["national_rank"] = int(m.group(1))
        except ValueError:
            pass

    return out if out else None


def main() -> int:
    print("Fetching Apartment List rent reports for CO cities…")
    results: dict[str, dict] = {}
    failures: list[str] = []

    for slug, name in CITIES:
        url = BASE.format(slug=slug)
        print(f"  {name} ({slug}) …", end=" ", flush=True)
        html = _fetch(url)
        rec = parse_report(html or "")
        if not rec:
            print("no data")
            failures.append(name)
            continue
        rec["name"] = name
        rec["slug"] = slug
        rec["source_url"] = url
        # Lookup key matches ZORI / OF normalisation: lowercase, no state.
        key = name.lower()
        results[key] = rec
        bits = []
        if "rent_overall" in rec: bits.append(f"${rec['rent_overall']:,}")
        if "yoy_change_pct" in rec: bits.append(f"{rec['yoy_change_pct']:+.1f}% YoY")
        print(" · ".join(bits) if bits else "ok")

    overall_vals = [r["rent_overall"] for r in results.values() if r.get("rent_overall")]
    statewide_avg = round(sum(overall_vals) / len(overall_vals)) if overall_vals else None

    output = {
        "meta": {
            "source": "Apartment List monthly Rent Report — narrative-scraped",
            "source_pattern": "https://www.apartmentlist.com/rent-report/co/<slug>",
            "vintage_label": "report current at fetch time; AL refreshes monthly mid-month",
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "scope": f"Colorado: scraped {len(results)} cities, {len(failures)} failures",
            "failures": failures,
            "notes": (
                "Apartment List does not publish a public CSV; figures are extracted "
                "from the narrative prose of each city's rent-report page using "
                "stable regex patterns. Brittle to page-copy changes — re-run "
                "regularly and check fetch logs. Complements Zillow ZORI: AL "
                "publishes specific 1BR/2BR median rents, ZORI is a smoothed "
                "all-BR index. Together they triangulate per-BR achievable rent "
                "for the 23 largest CO cities."
            ),
        },
        "statewide_average_overall": statewide_avg,
        "cities": results,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nOK  wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"    cities:   {len(results)} CO cities tracked")
    if failures:
        print(f"    failures: {failures}")
    if statewide_avg:
        print(f"    avg overall: ${statewide_avg:,}/mo")
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
