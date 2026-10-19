#!/usr/bin/env python3
"""
scripts/cra/fetch_fdic_branches_co.py

Build the Colorado bank-branch file behind the CRA coverage map on
affordable-deal-team.html, from the FDIC's public BankFind API:

  * Summary of Deposits (SOD): every FDIC-insured bank and savings
    institution office in Colorado as of June 30 of the survey year.
  * Institutions: each bank's primary federal regulator.
  * Financials: total assets on December 31 of the two prior years, which
    set the bank's CRA size class (small / intermediate small / large).

A branch county is a screen, not a bank's assessment area: CRA rules make an
assessment area include the bank's branches (12 CFR 228.41(c)), but a bank can
draw it around only part of a county. The page says so; this file only lists
where branches are. Credit unions are not covered by the CRA and are not in
these FDIC files.

Output:
    data/cra/co-bank-branches.json

Usage:
    python3 scripts/cra/fetch_fdic_branches_co.py [--year 2026]

A failed download exits non-zero and leaves the committed file untouched.
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "cra" / "co-bank-branches.json"
# Full endpoint URLs: the bare API root returns 404, so the repo's link
# sweep would flag it.
ENDPOINTS = {
    "sod": "https://api.fdic.gov/banks/sod",
    "institutions": "https://api.fdic.gov/banks/institutions",
    "financials": "https://api.fdic.gov/banks/financials",
}

# 2026 CRA asset-size thresholds (Federal Reserve, FDIC and OCC, Dec 30 2025):
# large = at least this on Dec 31 of BOTH prior years; intermediate small =
# at least the lower figure on both years but not large; otherwise small.
THRESHOLDS = {2026: (1_649_000, 412_000)}  # thousands of dollars

# Colorado has about 1,360 FDIC-insured offices; far fewer means a bad pull.
MIN_BRANCHES = 1000
# Share of those banks the institutions and financials lookups must return.
MIN_COVERAGE = 0.95


def get(endpoint, params):
    url = ENDPOINTS[endpoint] + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def fetch_branches(year):
    rows, offset = [], 0
    while True:
        d = get("sod", {
            "filters": f"STALPBR:CO AND YEAR:{year}",
            "fields": ("CERT,NAMEFULL,STCNTYBR,CNTYNAMB,CITYBR,BRNUM,DEPSUMBR,STALP,"
                       "ADDRESBR,ZIPBR,SIMS_LATITUDE,SIMS_LONGITUDE"),
            "limit": 1000, "offset": offset,
        })
        rows += [x["data"] for x in d["data"]]
        offset += 1000
        if offset >= d["meta"]["total"]:
            break
    # A successful but empty or tiny answer (survey year not out yet, a changed
    # filter) must not replace the file with a branchless Colorado.
    if len(rows) < MIN_BRANCHES:
        raise RuntimeError(f"only {len(rows)} Colorado offices returned for {year}")
    return rows


def fetch_by_cert(endpoint, certs, fields, extra=""):
    out = {}
    certs = sorted(certs)
    for i in range(0, len(certs), 50):
        chunk = certs[i:i + 50]
        flt = "CERT:(" + " OR ".join(str(c) for c in chunk) + ")" + extra
        d = get(endpoint, {"filters": flt, "fields": fields, "limit": 1000})
        for x in d["data"]:
            out.setdefault(x["data"]["CERT"], []).append(x["data"])
    return out


def size_class(a1, a2, year):
    large, isb = THRESHOLDS[year]
    if a1 is None or a2 is None:
        return None
    if a1 >= large and a2 >= large:
        return "large"
    if a1 >= isb and a2 >= isb:
        return "intermediate"
    return "small"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    year = ap.parse_args().year
    if year not in THRESHOLDS:
        sys.exit(f"no CRA thresholds recorded for {year}")
    try:
        branches = fetch_branches(year)
        certs = {b["CERT"] for b in branches}
        inst = fetch_by_cert("institutions", certs, "CERT,NAME,REGAGNT,STALP,CITY")
        y1, y2 = f"{year - 2}1231", f"{year - 1}1231"
        fin = fetch_by_cert("financials", certs, "CERT,REPDTE,ASSET",
                            f" AND REPDTE:({y1} OR {y2})")
        # Same guard for the lookups: an empty or partial answer would leave
        # most banks with no size or examiner.
        for label, got in (("institutions", inst), ("financials", fin)):
            if len(set(got) & certs) < MIN_COVERAGE * len(certs):
                raise RuntimeError(f"{label} covered {len(set(got) & certs)} of {len(certs)} banks")
    except Exception as e:  # network or API failure: keep the committed file
        sys.exit(f"FDIC download failed: {e}")

    banks = {}
    offices = []
    # Seed all 64 counties so a county with no branch is present with no banks.
    geo = json.loads((ROOT / "data" / "hna" / "geo-config.json").read_text())
    counties = {c["geoid"]: {"name": c["label"].replace(" County", ""), "banks": {}}
                for c in geo["counties"]}
    for b in branches:
        c = b["CERT"]
        fips = f"{int(b['STCNTYBR']):05d}"
        if c not in banks:
            i = (inst.get(c) or [{}])[0]
            assets = {f["REPDTE"]: f.get("ASSET") for f in fin.get(c, [])}
            a1, a2 = assets.get(y1), assets.get(y2)
            banks[c] = {
                "name": b["NAMEFULL"],
                "hq": f"{i.get('CITY', '')}, {i.get('STALP', b.get('STALP', ''))}".strip(", "),
                "regulator": i.get("REGAGNT"),
                "assets_k": {y1[:4]: a1, y2[:4]: a2},
                "cra_size": size_class(a1, a2, year),
                "co_branches": 0,
                "co_counties": [],
            }
        bk = banks[c]
        bk["co_branches"] += 1
        if fips not in bk["co_counties"]:
            bk["co_counties"].append(fips)
        cty = counties.setdefault(fips, {"name": b["CNTYNAMB"], "banks": {}})
        e = cty["banks"].setdefault(str(c), {"branches": 0, "deposits_k": 0})
        e["branches"] += 1
        # An office with no reported deposits makes the county total unknown
        # (None), not smaller.
        # One map point per office; the FDIC geocodes each one (SIMS_*).
        lat, lon = b.get("SIMS_LATITUDE"), b.get("SIMS_LONGITUDE")
        if lat is not None and lon is not None:
            offices.append([str(c), round(lat, 5), round(lon, 5),
                            b.get("ADDRESBR") or "", b.get("CITYBR") or "",
                            str(b.get("ZIPBR") or "")])
        dep = b.get("DEPSUMBR")
        if dep is None or e["deposits_k"] is None:
            e["deposits_k"] = None
        else:
            e["deposits_k"] += dep

    for bk in banks.values():
        bk["co_counties"].sort()
    out = {
        "meta": {
            "source": "FDIC BankFind Suite API: Summary of Deposits, Institutions, Financials",
            "source_url": "https://api.fdic.gov/banks/docs/",
            "sod_as_of": f"{year}-06-30",
            "assets_as_of": [f"{year - 2}-12-31", f"{year - 1}-12-31"],
            "cra_thresholds_k": {"large": THRESHOLDS[year][0], "intermediate": THRESHOLDS[year][1]},
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": ("Branch counties are a screen for CRA assessment areas, not the "
                     "areas themselves. Credit unions are not covered by the CRA."),
            "branch_count": len(branches),
            "bank_count": len(banks),
            "office_points": len(offices),
        },
        "banks": {str(k): v for k, v in sorted(banks.items())},
        "counties": dict(sorted(counties.items())),
        # [cert, lat, lon, street, city, zip] for each office with a location.
        "offices": sorted(offices),
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT_FILE.relative_to(ROOT)}: {len(branches)} branches, "
          f"{len(banks)} banks, {len(counties)} counties, {len(offices)} mapped")


if __name__ == "__main__":
    main()
