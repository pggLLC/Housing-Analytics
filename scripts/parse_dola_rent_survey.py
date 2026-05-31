#!/usr/bin/env python3
"""
scripts/parse_dola_rent_survey.py
==================================
Parse the DOLA *Colorado Multi-Family Housing Vacancy & Rental Survey*
into a JSON snapshot consumed by the Opportunity Finder + Deal Calc.

WHY THIS IS A LOCAL-INPUT SCRIPT
--------------------------------
DOLA's `cdola.colorado.gov` host is WAF-protected against unauthenticated
direct downloads — the same constraint we hit with HUD SAFMR. The
practical workflow is:

  1. Twice a year (Q1 ~April, Q3 ~October), open the DOLA survey page
     in a real browser:
       https://cdola.colorado.gov/colorado-multi-family-housing-vacancy-and-rental-survey
     Download the latest PDF.

  2. Save the file to `data/market/raw/dola_rent_survey_<YYYYQX>.pdf`.

  3. Run:
       python3 scripts/parse_dola_rent_survey.py \
         data/market/raw/dola_rent_survey_2025Q3.pdf

  4. This writes `data/market/dola_rent_survey_co.json` consumed by
     `js/lihtc-opportunity-finder.js` and `js/deal-calculator.js`.

The script uses `pdftotext` (installed via `brew install poppler` on
macOS, or `apt-get install poppler-utils` on Debian). If it isn't on
PATH the script tells you how to install it and exits with code 2 so
CI doesn't treat the missing dependency as a successful no-op.

PARSING APPROACH
----------------
DOLA reports group data by region (the 14-region scheme published by
Apartment Insights Worldwide for DOLA). Each region's table contains:

  Median rent by BR (Studio / 1BR / 2BR / 3BR)
  Average rent by BR
  Vacancy %

We extract those rows for each region. Region IDs map to Colorado
counties via `_REGION_COUNTIES` below (curated; revise if DOLA
restructures their region scheme).

WHEN FORMAT CHANGES
-------------------
DOLA reformats roughly every 3-4 years. When this script breaks, the
likely culprit is one of:
  (a) Section header text in the PDF changed — update `_REGION_HEADERS`
  (b) Column order shifted — update `_BR_COL_INDEX`
  (c) New region added/dropped — update `_REGION_COUNTIES`

Inspect the raw `pdftotext -layout` output of the survey to diagnose.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "market" / "dola_rent_survey_co.json"

# ---------------------------------------------------------------------------
# DOLA region → CO county FIPS mapping.
#
# DOLA's Multi-Family Vacancy & Rental Survey uses 14 regions for CO. This
# mapping lets us look up which region a county falls in so the Deal Calc
# can surface the right regional rent benchmark when the user picks a
# county. Sourced from DOLA's published region map — verify against the
# most recent PDF when refreshing.
# ---------------------------------------------------------------------------
_REGION_COUNTIES: dict[str, dict] = {
    "boulder_broomfield": {
        "name": "Boulder / Broomfield",
        "counties": ["08013", "08014"],  # Boulder, Broomfield
    },
    "colorado_springs": {
        "name": "Colorado Springs Metro",
        "counties": ["08041"],  # El Paso
    },
    "denver_metro": {
        "name": "Denver Metro",
        "counties": [
            "08001",  # Adams
            "08005",  # Arapahoe
            "08031",  # Denver
            "08035",  # Douglas
            "08039",  # Elbert
            "08047",  # Gilpin
            "08059",  # Jefferson
        ],
    },
    "fort_collins_loveland": {
        "name": "Fort Collins / Loveland (Larimer)",
        "counties": ["08069"],
    },
    "greeley": {
        "name": "Greeley (Weld)",
        "counties": ["08123"],
    },
    "pueblo": {
        "name": "Pueblo",
        "counties": ["08101"],
    },
    "grand_junction": {
        "name": "Grand Junction (Mesa)",
        "counties": ["08077"],
    },
    "northeast": {
        "name": "Northeastern Plains",
        "counties": ["08075", "08087", "08095", "08115", "08121", "08125"],
        # Logan, Morgan, Phillips, Sedgwick, Washington, Yuma
    },
    "southeast": {
        "name": "Southeastern Plains",
        "counties": ["08009", "08017", "08025", "08099", "08109"],
        # Baca, Cheyenne, Crowley, Prowers, Saguache (note Saguache is also in SLV)
    },
    "san_luis_valley": {
        "name": "San Luis Valley",
        "counties": ["08003", "08021", "08023", "08079", "08105", "08109"],
        # Alamosa, Conejos, Costilla, Mineral, Rio Grande, Saguache
    },
    "south_central": {
        "name": "South Central Mountains",
        "counties": ["08027", "08043", "08055", "08065", "08071"],
        # Custer, Fremont, Huerfano, Lake, Las Animas
    },
    "western_resort": {
        "name": "Western Resort (Vail/Aspen/Steamboat)",
        "counties": ["08037", "08049", "08097", "08107", "08117"],
        # Eagle, Grand, Pitkin, Routt, Summit
    },
    "western_slope": {
        "name": "Western Slope (Glenwood/Durango/etc.)",
        "counties": ["08029", "08033", "08045", "08051", "08053", "08057",
                     "08067", "08081", "08083", "08085", "08091", "08103",
                     "08111", "08113"],
    },
    "san_juan_se": {
        "name": "San Juan / SE Mountains",
        "counties": ["08007", "08011", "08015", "08019", "08061", "08063", "08073", "08089", "08093", "08119"],
    },
}


def _check_pdftotext() -> bool:
    """Return True iff pdftotext is on PATH."""
    try:
        subprocess.run(["pdftotext", "-v"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _extract_text(pdf_path: Path) -> str:
    """Run pdftotext -layout to preserve the regional tables."""
    out = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        check=True,
        text=True,
    )
    return out.stdout


# Match region headers as they appear in DOLA's reports. Add aliases when
# DOLA restructures.
_REGION_HEADERS: dict[str, list[str]] = {
    "boulder_broomfield":   ["Boulder/Broomfield", "Boulder / Broomfield"],
    "colorado_springs":     ["Colorado Springs", "El Paso County"],
    "denver_metro":         ["Denver Metro", "Denver Metropolitan", "Metro Denver"],
    "fort_collins_loveland":["Fort Collins/Loveland", "Larimer County", "Fort Collins-Loveland"],
    "greeley":              ["Greeley", "Weld County"],
    "pueblo":               ["Pueblo"],
    "grand_junction":       ["Grand Junction", "Mesa County"],
    "northeast":            ["Northeast", "Northeastern"],
    "southeast":            ["Southeast", "Southeastern"],
    "san_luis_valley":      ["San Luis Valley", "SLV"],
    "south_central":        ["South Central"],
    "western_resort":       ["Resort Region", "Western Resort"],
    "western_slope":        ["Western Slope"],
    "san_juan_se":          ["San Juan", "SE Mountains"],
}


# Within a region's block, look for these row labels and extract the
# rent / vacancy values that follow them.
_MEDIAN_ROW_PATTERNS = [
    re.compile(r"Median\s+Rent\s+([0-9\$,\s\.\-]+)", re.I),
    re.compile(r"Median\s+([0-9\$,\s\.\-]+)", re.I),
]
_VACANCY_ROW_PATTERN = re.compile(r"Vacancy(?:\s+(?:Rate|%))?\s+([0-9\.,\s\-]+)", re.I)
_QUARTER_PATTERN = re.compile(r"(Q[1-4])\s*[\-\s]*(\d{4})|(\d{4})\s*Q([1-4])", re.I)


def _parse_money_cells(text: str) -> list[int]:
    """Extract a row of $-prefixed integers from a table row."""
    nums = re.findall(r"\$\s*([0-9,]+)", text)
    out = []
    for n in nums:
        try:
            out.append(int(n.replace(",", "")))
        except ValueError:
            pass
    # Fall back: bare integers
    if not out:
        for n in re.findall(r"\b([0-9]{3,4})\b", text):
            out.append(int(n))
    return out


def _parse_vacancy_cells(text: str) -> list[float]:
    nums = re.findall(r"([0-9]+\.[0-9]+)", text)
    out = []
    for n in nums:
        try:
            v = float(n)
            if 0 <= v <= 100:
                out.append(v)
        except ValueError:
            pass
    return out


def _find_region_block(text: str, region_aliases: list[str]) -> str | None:
    """Slice the survey text from a region header to the next header."""
    text_lower = text.lower()
    start = -1
    for alias in region_aliases:
        idx = text_lower.find(alias.lower())
        if idx >= 0:
            start = idx
            break
    if start < 0:
        return None
    # Find the next region header
    all_aliases = sum(_REGION_HEADERS.values(), [])
    next_idxs = [text_lower.find(a.lower(), start + 1) for a in all_aliases if a.lower() != region_aliases[0].lower()]
    next_idxs = [i for i in next_idxs if i > start]
    end = min(next_idxs) if next_idxs else len(text)
    return text[start:end]


def parse_survey(text: str) -> dict:
    """Parse the survey text into a regions dict + countyToRegion map."""
    # Vintage detection from "Q3 2025" or "2025 Q3" anywhere in the doc
    quarter = None
    m = _QUARTER_PATTERN.search(text)
    if m:
        if m.group(1):
            quarter = f"{m.group(2)} {m.group(1).upper()}"
        else:
            quarter = f"{m.group(3)} Q{m.group(4)}"

    regions: dict[str, dict] = {}
    for region_id, headers in _REGION_HEADERS.items():
        block = _find_region_block(text, headers)
        if not block:
            continue
        # Extract median row
        med_nums: list[int] = []
        for pat in _MEDIAN_ROW_PATTERNS:
            mm = pat.search(block)
            if mm:
                med_nums = _parse_money_cells(mm.group(0))
                if med_nums:
                    break
        # Extract vacancy
        vac_nums: list[float] = []
        mm = _VACANCY_ROW_PATTERN.search(block)
        if mm:
            vac_nums = _parse_vacancy_cells(mm.group(0))
        if not med_nums and not vac_nums:
            continue

        # Column order is conventionally [studio, 1BR, 2BR, 3BR, all].
        # Some surveys publish [overall, studio, 1BR, 2BR, 3BR]. Try to
        # detect which by ordering — typically 2BR > 1BR > studio.
        rec: dict = {"name": _REGION_COUNTIES.get(region_id, {}).get("name") or region_id}
        if quarter:
            rec["quarter"] = quarter
        if len(med_nums) >= 4:
            # Heuristic: smallest is studio, largest of first 4 is 3BR
            asc = sorted(med_nums[:4])
            rec["rent_studio"] = asc[0]
            rec["rent_1br"]    = asc[1]
            rec["rent_2br"]    = asc[2]
            rec["rent_3br"]    = asc[3]
            if len(med_nums) >= 5:
                rec["rent_overall"] = med_nums[4]
        elif med_nums:
            # Partial row — surface what we got under "rent_overall"
            rec["rent_overall"] = max(med_nums)
        if vac_nums:
            # Vacancy is usually a single number per region (or by BR).
            # Take the first or the mean.
            rec["vacancy_pct"] = round(sum(vac_nums) / len(vac_nums), 2)
        regions[region_id] = rec

    # county → region map
    county_to_region: dict[str, str] = {}
    for region_id, meta in _REGION_COUNTIES.items():
        for fips in meta.get("counties", []):
            # First-write-wins so duplicate-mapped counties (Saguache is in
            # both SLV and SE) end up in the most relevant region.
            if fips not in county_to_region:
                county_to_region[fips] = region_id

    return {"regions": regions, "countyToRegion": county_to_region, "quarter": quarter}


def main(argv: list[str]) -> int:
    if not _check_pdftotext():
        print("ERROR: pdftotext not found. Install with:", file=sys.stderr)
        print("  macOS:   brew install poppler", file=sys.stderr)
        print("  Debian:  sudo apt-get install poppler-utils", file=sys.stderr)
        return 2
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        print("\nUSAGE: python3 scripts/parse_dola_rent_survey.py <path-to-PDF>", file=sys.stderr)
        return 1
    pdf_path = Path(argv[1]).resolve()
    if not pdf_path.exists():
        print(f"ERROR: file not found: {pdf_path}", file=sys.stderr)
        return 1

    print(f"Extracting text from {pdf_path.name}…")
    text = _extract_text(pdf_path)
    print(f"  pdf size: {pdf_path.stat().st_size:,} bytes; extracted {len(text):,} chars")

    parsed = parse_survey(text)
    n_regions = len(parsed["regions"])
    n_counties = len(parsed["countyToRegion"])
    if n_regions == 0:
        print("WARN: parsed zero regions — PDF format may have changed. "
              "Inspect 'pdftotext -layout' output to update headers/patterns.", file=sys.stderr)
        return 1

    output = {
        "meta": {
            "source": "DOLA Colorado Multi-Family Housing Vacancy & Rental Survey",
            "source_url": "https://cdola.colorado.gov/colorado-multi-family-housing-vacancy-and-rental-survey",
            "source_pdf": pdf_path.name,
            "vintage": parsed.get("quarter"),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "scope": f"Colorado: {n_regions} regions, {n_counties} counties mapped",
            "notes": (
                "Parsed from a locally-downloaded DOLA PDF because the source "
                "host (cdola.colorado.gov) is WAF-protected against unauthenticated "
                "direct download. Twice-yearly refresh. CHFA QAP underwriters use "
                "this dataset; it's the authoritative source for CO regional "
                "median rent + vacancy."
            ),
        },
        "quarter": parsed.get("quarter"),
        "regions": parsed["regions"],
        "countyToRegion": parsed["countyToRegion"],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"    regions:  {n_regions}")
    print(f"    counties: {n_counties}")
    if parsed.get("quarter"):
        print(f"    vintage:  {parsed['quarter']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
