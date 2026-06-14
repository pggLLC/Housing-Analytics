#!/usr/bin/env python3
"""
scripts/fetch_chfa_limits.py
=============================================================================
Download and parse CHFA's published "Income Limit and Maximum Rent Tables for
All Colorado Counties" into a structured JSON keyed by county FIPS.

CHFA publishes one canonical PDF per year. The 2026 file (effective May 1,
2026; implementation cutoff June 15, 2026) is at:

  https://www.chfainfo.com/getattachment/620a2abf-e2d3-44a6-868b-4318906acc3e/2026-Rent-and-income-limits.pdf

Per county × AMI tier (20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120),
CHFA publishes:
  • Maximum gross rents by bedroom (0/1/2/3/4 BR)
  • Income limits by household size (1-8 person)

37 counties have HERA Special limits (different max rents / income limits
for projects placed in service on or before 12.31.2008). 12 rural resort
counties get additional Prop 123 tiers (130/140/150/160% AMI). Both are
captured.

Usage:
    python3 scripts/fetch_chfa_limits.py
    # writes data/chfa-income-rent-limits-<year>.json

Requires pdfplumber (`pip install pdfplumber`). On this dev box it's at:
    PYTHONPATH=~/Library/Python/3.9/lib/python/site-packages
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.stderr.write("pdfplumber not installed. pip install pdfplumber\n")
    sys.exit(1)


YEAR = 2026
URL = (
    "https://www.chfainfo.com/getattachment/"
    "620a2abf-e2d3-44a6-868b-4318906acc3e/2026-Rent-and-income-limits.pdf"
)
EFFECTIVE_DATE = "2026-05-01"
IMPLEMENTATION_CUTOFF = "2026-06-15"
RURAL_RESORT_COUNTIES = {
    "Archuleta", "Chaffee", "Eagle", "Grand", "Gunnison", "La Plata",
    "Ouray", "Pitkin", "Routt", "San Juan", "San Miguel", "Summit",
}

ROOT = Path(__file__).resolve().parent.parent
HUD_FILE = ROOT / "data" / "hud-fmr-income-limits.json"
OUT_FILE = ROOT / "data" / f"chfa-income-rent-limits-{YEAR}.json"
PDF_LOCAL = ROOT / f".cache/chfa-{YEAR}.pdf"


def load_fips_map() -> dict[str, str]:
    """Build county_name -> FIPS map from existing HUD file."""
    with HUD_FILE.open() as f:
        hud = json.load(f)
    out: dict[str, str] = {}
    for c in hud.get("counties", []):
        nm = c["county_name"].replace(" County", "").strip()
        out[nm] = c["fips"]
    # CHFA names that may differ slightly
    return out


# Line format:
#   <County> [Y] <tier>% <r0> <r1> <r2> <r3> <r4> [<i1> <i2> <i3> <i4> <i5> <i6> <i7> <i8>]
# County may have spaces (e.g., "La Plata", "El Paso", "Saint Charles" -> "St.").
LINE_RE = re.compile(
    r"^(?P<county>[A-Za-z][A-Za-z\.\s\-]+?)\s+(?P<hera>Y\s+)?"
    r"(?P<tier>\d{1,3})%\s+"
    r"(?P<rents>(?:\d[\d,]*\s+){4}\d[\d,]*)"
    r"(?:\s+(?P<incomes>(?:\d[\d,]*\s+){7}\d[\d,]*))?\s*$"
)


def _num(s: str) -> int:
    return int(s.replace(",", "").strip())


def _parse_line(line: str):
    m = LINE_RE.match(line.strip())
    if not m:
        return None
    rents = [_num(x) for x in m.group("rents").split()]
    incomes = [_num(x) for x in m.group("incomes").split()] if m.group("incomes") else None
    return {
        "county": m.group("county").strip(),
        "hera": bool(m.group("hera")),
        "tier": int(m.group("tier")),
        "rents": rents,
        "incomes": incomes,
    }


def download():
    PDF_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    if PDF_LOCAL.exists():
        print(f"using cached {PDF_LOCAL}")
        return
    print(f"downloading {URL}")
    req = urllib.request.Request(URL, headers={"User-Agent": "coho-housing-analytics"})
    with urllib.request.urlopen(req, timeout=60) as r, PDF_LOCAL.open("wb") as f:
        f.write(r.read())
    print(f"wrote {PDF_LOCAL}")


def parse() -> dict:
    """Walk the PDF text, return {county_name: {hera_special, regular_tiers, hera_tiers}}."""
    by_county: dict[str, dict] = {}
    with pdfplumber.open(str(PDF_LOCAL)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.split("\n"):
                row = _parse_line(line)
                if not row:
                    continue
                cname = row["county"]
                if cname not in by_county:
                    by_county[cname] = {
                        "county_name": cname,
                        "hera_special": False,
                        "regular_tiers": {},
                        "hera_tiers": {},
                    }
                if row["hera"]:
                    by_county[cname]["hera_special"] = True
                    bucket = by_county[cname]["hera_tiers"]
                else:
                    bucket = by_county[cname]["regular_tiers"]
                rents = row["rents"]
                tier_data = {
                    "tier": row["tier"],
                    "max_rents": {
                        "0br": rents[0], "1br": rents[1], "2br": rents[2],
                        "3br": rents[3], "4br": rents[4],
                    }
                }
                if row["incomes"]:
                    inc = row["incomes"]
                    tier_data["income_limits"] = {
                        "1p": inc[0], "2p": inc[1], "3p": inc[2], "4p": inc[3],
                        "5p": inc[4], "6p": inc[5], "7p": inc[6], "8p": inc[7],
                    }
                bucket[str(row["tier"])] = tier_data
    return by_county


def attach_fips(by_county: dict) -> list[dict]:
    fips_map = load_fips_map()
    out = []
    unmatched = []
    for cname, body in by_county.items():
        fips = fips_map.get(cname)
        if not fips:
            # Try common normalizations
            alt = cname.replace(".", "").strip()
            fips = fips_map.get(alt)
        if not fips:
            unmatched.append(cname)
            continue
        out.append({
            "fips": fips,
            "county_name": cname,
            "hera_special": body["hera_special"],
            "rural_resort": cname in RURAL_RESORT_COUNTIES,
            "regular_tiers": body["regular_tiers"],
            "hera_tiers": body["hera_tiers"],
        })
    if unmatched:
        sys.stderr.write(f"WARN: {len(unmatched)} counties without FIPS: {sorted(unmatched)}\n")
    # Sort by FIPS
    out.sort(key=lambda c: c["fips"])
    return out


def build():
    download()
    parsed = parse()
    counties = attach_fips(parsed)
    # Sanity-check: every county should have at least the 60% tier
    missing_60 = [c["county_name"] for c in counties if "60" not in c["regular_tiers"] and "60" not in c["hera_tiers"]]
    if missing_60:
        sys.stderr.write(f"WARN: missing 60% tier for: {missing_60[:5]}\n")
    payload = {
        "meta": {
            "source": "CHFA — 2026 Income Limit and Maximum Rent Tables for All Colorado Counties",
            "source_url": URL,
            "publisher": "Colorado Housing and Finance Authority (CHFA)",
            "effective_date": EFFECTIVE_DATE,
            "implementation_cutoff": IMPLEMENTATION_CUTOFF,
            "fiscal_year": YEAR,
            "ami_tiers_regular": [20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120],
            "ami_tiers_rural_resort": [20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160],
            "household_sizes": [1, 2, 3, 4, 5, 6, 7, 8],
            "bedrooms": ["0br", "1br", "2br", "3br", "4br"],
            "hera_special_note": (
                "HERA Special limits apply only to Housing Tax Credit projects "
                "placed in service on or before 12.31.2008. The same county can "
                "have BOTH HERA and non-HERA limits; consumers should pick the "
                "set that matches the project's PIS date."
            ),
            "rural_resort_note": (
                "Prop 123 (CO 2022) extends income/rent eligibility up to 160% AMI "
                "in 12 rural-resort counties: Archuleta, Chaffee, Eagle, Grand, "
                "Gunnison, La Plata, Ouray, Pitkin, Routt, San Juan, San Miguel, "
                "Summit. CHFA publishes the additional 130-160% tiers for these "
                "counties only."
            ),
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator": "scripts/fetch_chfa_limits.py",
        },
        "county_count": len(counties),
        "counties": counties,
    }
    OUT_FILE.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT_FILE} ({len(counties)} counties)")
    # Print a quick spot-check
    pitkin = next((c for c in counties if c["county_name"] == "Pitkin"), None)
    if pitkin:
        print("Spot-check Pitkin 60% tier:", json.dumps(pitkin["regular_tiers"].get("60"), indent=2))


if __name__ == "__main__":
    build()
