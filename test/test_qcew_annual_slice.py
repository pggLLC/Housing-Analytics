#!/usr/bin/env python3
"""
Guard for the QCEW construction-wage fetch in
scripts/build_co_housing_costs_insight.py.

Why this exists
---------------
update-co-housing-costs.yml failed on every run from 2026-05-02 to 2026-09-14.
The pipeline pointed at the BLS national *quarterly* singlefile ZIP
(2025_qtrly_singlefile.zip: ~287 MB compressed, 2.2 GB and 14,639,988 rows
expanded). Two defects compounded:

  1. Reading that archive with pandas exhausted the GitHub runner, which the
     OS killed mid-download of the second year's archive -- the job log shows
     "The runner has received a shutdown signal", not a timeout.
  2. It could never have worked anyway. Quarterly files carry qtr values
     1/2/3/4 and no `avg_annual_pay` column, so the pipeline's `qtr == "A"`
     annual filter matched nothing on every single run.

The fix reads the ~1 MB QCEW Open Data Access annual single-industry slice
instead. These assertions pin both halves down, offline.

Fixtures below are hand-built from the published BLS column layouts -- they
deliberately do not reuse the parser they are checking.
"""
import importlib.util
import pathlib
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_co_housing_costs_insight.py"

failures = []


def check(condition, message):
    if condition:
        print(f"  ✓ {message}")
    else:
        print(f"  ✗ {message}")
        failures.append(message)


spec = importlib.util.spec_from_file_location("co_housing_costs", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["co_housing_costs"] = mod
spec.loader.exec_module(mod)

cfg = mod.Config()

print("\nqcew-annual-slice")

# ── 1. The singlefile ZIP must not come back ────────────────────────────────
print("\n  source selection")
config_text = SCRIPT.read_text(encoding="utf-8")
check(
    "qtrly_singlefile" not in cfg.QCEW_INDUSTRY_URL,
    "QCEW URL does not point at the quarterly singlefile archive",
)
check(
    "/a/industry/" in cfg.QCEW_INDUSTRY_URL,
    "QCEW URL uses the annual single-industry Open Data Access slice",
)
singlefile_code_lines = [
    line for line in config_text.splitlines()
    if "_qtrly_singlefile" in line and not line.lstrip().startswith("#")
]
check(
    not singlefile_code_lines,
    "the singlefile archive URL survives only in comments, never in executed code",
)
check(cfg.QCEW_INDUSTRY_CODE == "23", "industry code is NAICS 23 (Construction)")


# ── 2. Annual slice parses into county wage rows ────────────────────────────
ANNUAL_COLUMNS = [
    "area_fips", "own_code", "industry_code", "agglvl_code", "size_code",
    "year", "qtr", "disclosure_code", "annual_avg_estabs", "annual_avg_emplvl",
    "total_annual_wages", "taxable_annual_wages", "annual_contributions",
    "annual_avg_wkly_wage", "avg_annual_pay",
]


def annual_row(area, *, own="5", agglvl="74", industry="23", qtr="A",
               disclosure="", pay="80000", weekly="1538"):
    row = {c: "" for c in ANNUAL_COLUMNS}
    row.update(
        area_fips=area, own_code=own, industry_code=industry, agglvl_code=agglvl,
        size_code="0", year="2025", qtr=qtr, disclosure_code=disclosure,
        annual_avg_wkly_wage=weekly, avg_annual_pay=pay,
    )
    return row


annual = pd.DataFrame([
    annual_row("08001", pay="86501", weekly="1663"),          # keep
    annual_row("08003", disclosure="N", pay="0", weekly="0"),  # suppressed
    annual_row("08005", pay="96377", weekly="1853"),          # keep
    annual_row("08999", pay="70000"),                         # pseudo-county
    annual_row("08007", own="2", pay="55000"),                # state government
    annual_row("08009", agglvl="75", pay="61000"),            # 3-digit NAICS
    annual_row("08011", industry="10", pay="59000"),          # all industries
    annual_row("08013", qtr="1", pay="77000"),                # quarterly record
    annual_row("35001", pay="72000"),                         # New Mexico
    annual_row("08", agglvl="54", pay="90000"),               # statewide
], dtype=str)

parsed = mod._parse_qcew_annual_slice(annual, 2025, cfg)

print("\n  annual slice parsing")
check(
    list(parsed["county_fips"]) == ["08001", "08003", "08005"],
    "keeps only private, county-level, NAICS-23, annual Colorado rows",
)
check("08999" not in set(parsed["county_fips"]),
      "excludes the 08999 'Unknown Or Undefined' pseudo-county")
check(
    list(parsed.columns) == mod.QCEW_OUTPUT_COLUMNS,
    f"emits the documented schema {mod.QCEW_OUTPUT_COLUMNS}",
)
check(set(parsed["qcew_year"]) == {2025}, "stamps the requested vintage year")

by_fips = parsed.set_index("county_fips")
check(by_fips.loc["08001", "avg_annual_wage"] == 86501,
      "reads avg_annual_pay (the annual-file column) as the annual wage")
check(by_fips.loc["08001", "avg_weekly_wage"] == 1663,
      "reads annual_avg_wkly_wage as the weekly wage")


# ── 3. Suppressed counties are missing, never zero ──────────────────────────
# BLS publishes withheld rows with a disclosure_code and a literal 0. Stored as
# zero they would enter the ElasticNet drivers model as $0-wage counties; the
# model's dropna() only excludes them if they are NaN.
print("\n  disclosure suppression")
check(pd.isna(by_fips.loc["08003", "avg_annual_wage"]),
      "a disclosure-suppressed county's annual wage is NaN, not 0")
check(pd.isna(by_fips.loc["08003", "avg_weekly_wage"]),
      "a disclosure-suppressed county's weekly wage is NaN, not 0")
check(not (parsed["avg_annual_wage"].fillna(1) <= 0).any(),
      "no zero or negative wage survives into the output")


# ── 4. A quarterly singlefile must yield nothing, loudly ────────────────────
# The exact shape that produced "no matching rows" on every run: qtr 1-4 and no
# avg_annual_pay column at all.
print("\n  quarterly input is rejected")
QUARTERLY_COLUMNS = [
    "area_fips", "own_code", "industry_code", "agglvl_code", "size_code",
    "year", "qtr", "disclosure_code", "qtrly_estabs", "month1_emplvl",
    "total_qtrly_wages", "avg_wkly_wage",
]
quarterly = pd.DataFrame([
    {
        **{c: "" for c in QUARTERLY_COLUMNS},
        "area_fips": "08001", "own_code": "5", "industry_code": "23",
        "agglvl_code": "74", "size_code": "0", "year": "2025", "qtr": q,
        "avg_wkly_wage": "1600",
    }
    for q in ("1", "2", "3", "4")
], dtype=str)

quarterly_parsed = mod._parse_qcew_annual_slice(quarterly, 2025, cfg)
check(quarterly_parsed.empty,
      "quarterly records (qtr 1-4) produce no rows — they carry no annual averages")
check(list(quarterly_parsed.columns) == mod.QCEW_OUTPUT_COLUMNS,
      "the empty result still carries the documented schema")
check("avg_annual_pay" not in quarterly.columns,
      "fixture matches the real quarterly layout: no avg_annual_pay column")


# ── 5. A thin vintage falls back rather than shipping 3 counties ────────────
print("\n  vintage floor")
check(
    isinstance(cfg.QCEW_MIN_COUNTIES, int) and cfg.QCEW_MIN_COUNTIES >= 10,
    f"a usable vintage needs at least {cfg.QCEW_MIN_COUNTIES} unsuppressed counties",
)
check(
    int(parsed["avg_annual_wage"].notna().sum()) < cfg.QCEW_MIN_COUNTIES,
    "the 2-county fixture is below that floor, so fetch would try an older year",
)

print()
if failures:
    print(f"FAIL — {len(failures)} assertion(s) failed")
    sys.exit(1)
print("PASS — QCEW annual slice guards hold")
