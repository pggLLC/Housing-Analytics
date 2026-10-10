#!/usr/bin/env python3
"""
scripts/fetch_co_construction_labor_cost.py

Builds data/market/co-construction-labor-cost.json: a monthly Colorado
construction LABOR dataset (wage rates and labor availability) plus a MATERIALS
summary read from data/fred-data.json. The two are kept apart on purpose — the
Colorado Deep Dive shows a labor panel and a materials panel side by side, never
a blended "construction cost index".

Labor (BLS Public Data API v2):
  - CES state construction: employment, average hourly and weekly earnings (NSA)
  - LAUS Colorado unemployment rate (SA)
  - JOLTS US construction job openings and hires rates (national context)
  - OEWS May-reference annual wages and employment for ten construction trades,
    statewide and seven Colorado metros

Materials: no fetch. data/fred-data.json is refreshed daily by fetch-fred-data;
this script only computes latest value and year-over-year change per PPI series.

API limits: with BLS_API_KEY,
50 series and 20 years per request; without it, 25 series, 10 years and 25
requests a day. Requests here are always sized for the unauthenticated limits'
10-year window and chunked to whichever series limit applies.

Absence is never zero. A series BLS answers with no data is kept with value null
and an `unavailableReason`. A request that FAILS (network, HTTP error, quota
refusal) is different: the script writes nothing and exits 1, so the previously
committed file — which the workflow will not overwrite — keeps its good data.

Usage:
    python3 scripts/fetch_co_construction_labor_cost.py
    BLS_API_KEY=<key> python3 scripts/fetch_co_construction_labor_cost.py
    python3 scripts/fetch_co_construction_labor_cost.py --save-raw /tmp/bls-raw.json
    python3 scripts/fetch_co_construction_labor_cost.py --from-raw /tmp/bls-raw.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "market" / "co-construction-labor-cost.json"
FRED_FILE = ROOT / "data" / "fred-data.json"
FRED_FILE_REL = "data/fred-data.json"

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
WINDOW_YEARS = 10           # unauthenticated limit; also the ~10-year history asked for
CHUNK_WITH_KEY = 50
CHUNK_WITHOUT_KEY = 25
REQUEST_RETRIES = 2

SOURCES = [
    {"id": "bls-ces-state", "name": "BLS Current Employment Statistics, State and Metro Area (Colorado construction)",
     "url": "https://www.bls.gov/sae/"},
    {"id": "bls-laus", "name": "BLS Local Area Unemployment Statistics (Colorado)",
     "url": "https://www.bls.gov/lau/"},
    {"id": "bls-jolts", "name": "BLS Job Openings and Labor Turnover Survey (US construction)",
     "url": "https://www.bls.gov/jlt/"},
    {"id": "bls-oews", "name": "BLS Occupational Employment and Wage Statistics (Colorado and metros)",
     "url": "https://www.bls.gov/oes/"},
    {"id": "bls-api-v2", "name": "BLS Public Data API v2 (all labor series above)",
     "url": BLS_API_URL},
    {"id": "fred-ppi", "name": "BLS Producer Price Indexes via FRED, read from data/fred-data.json",
     "url": "https://fred.stlouisfed.org/"},
]

# basis: "pct" = percent change; "pts" = percentage-point difference (rates).
MONTHLY_SERIES: list[dict[str, str]] = [
    {"id": "SMU08000002000000001", "label": "Colorado construction employment", "unit": "thousands of jobs",
     "geography": "Colorado", "panel": "labor-availability", "seasonalAdjustment": "NSA", "basis": "pct"},
    {"id": "SMU08000002000000003", "label": "Colorado construction average hourly earnings, all employees",
     "unit": "dollars per hour", "geography": "Colorado", "panel": "labor-rates",
     "seasonalAdjustment": "NSA", "basis": "pct"},
    {"id": "SMU08000002000000011", "label": "Colorado construction average weekly earnings, all employees",
     "unit": "dollars per week", "geography": "Colorado", "panel": "labor-rates",
     "seasonalAdjustment": "NSA", "basis": "pct"},
    {"id": "LASST080000000000003", "label": "Colorado unemployment rate (all industries)", "unit": "percent",
     "geography": "Colorado", "panel": "labor-availability", "seasonalAdjustment": "SA", "basis": "pts"},
    {"id": "JTU230000000000000JOR", "label": "US construction job openings rate", "unit": "percent",
     "geography": "United States", "panel": "labor-availability", "seasonalAdjustment": "NSA", "basis": "pts"},
    {"id": "JTU230000000000000HIR", "label": "US construction hires rate", "unit": "percent",
     "geography": "United States", "panel": "labor-availability", "seasonalAdjustment": "NSA", "basis": "pts"},
]
WAGE_SERIES = "SMU08000002000000003"
EMPLOYMENT_SERIES = "SMU08000002000000001"

# OEWS series: OEU + S|M + area(7) + industry(6, 000000 = cross-industry) + SOC(6) + datatype(2)
OEWS_AREAS: list[dict[str, str]] = [
    {"code": "0800000", "type": "S", "name": "Colorado (statewide)"},
    {"code": "0019740", "type": "M", "name": "Denver-Aurora-Centennial, CO"},
    {"code": "0017820", "type": "M", "name": "Colorado Springs, CO"},
    {"code": "0022660", "type": "M", "name": "Fort Collins-Loveland, CO"},
    {"code": "0014500", "type": "M", "name": "Boulder, CO"},
    {"code": "0024540", "type": "M", "name": "Greeley, CO"},
    {"code": "0024300", "type": "M", "name": "Grand Junction, CO"},
    {"code": "0039380", "type": "M", "name": "Pueblo, CO"},
]
OEWS_OCCUPATIONS: list[dict[str, str]] = [
    {"soc": "47-1011", "title": "First-line supervisors of construction trades and extraction workers"},
    {"soc": "47-2031", "title": "Carpenters"},
    {"soc": "47-2061", "title": "Construction laborers"},
    {"soc": "47-2111", "title": "Electricians"},
    {"soc": "47-2152", "title": "Plumbers, pipefitters, and steamfitters"},
    {"soc": "47-2073", "title": "Operating engineers and other construction equipment operators"},
    {"soc": "47-2181", "title": "Roofers"},
    {"soc": "47-2081", "title": "Drywall and ceiling tile installers"},
    {"soc": "47-2051", "title": "Cement masons and concrete finishers"},
    {"soc": "47-2221", "title": "Structural iron and steel workers"},
]
OEWS_EMPLOYMENT = "01"
OEWS_HOURLY_MEAN = "03"

# Materials: PPI series already in data/fred-data.json. Labels are BLS's series
# titles, written here rather than read from the FRED file because that file's
# `name` for WPUSI012011 is wrong ("Lumber & wood products"; BLS titles it
# Construction materials).
MATERIALS_HEADLINE = "WPUIP231120"
MATERIALS_SERIES: list[dict[str, str]] = [
    {"id": "WPUIP231120", "label": "PPI: Net inputs to multifamily residential construction (headline)"},
    {"id": "WPUSI012011", "label": "PPI: Construction materials (special index)"},
    {"id": "PCU327320327320", "label": "PPI: Ready-mix concrete"},
    {"id": "PCU331110331110", "label": "PPI: Iron and steel mills"},
    {"id": "WPU0811", "label": "PPI: Lumber"},
    {"id": "PCU327420327420", "label": "PPI: Gypsum products"},
    {"id": "PCU331420331420A", "label": "PPI: Copper wire and cable"},
    {"id": "PCU324121324121", "label": "PPI: Asphalt paving mixtures and blocks"},
]

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


class FetchError(RuntimeError):
    """A BLS request failed outright (not a series with no data)."""


def _log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tests/test_co_construction_labor_cost.py)
# ---------------------------------------------------------------------------

def oews_series_id(area: dict[str, str], soc: str, datatype: str) -> str:
    return f"OEU{area['type']}{area['code']}000000{soc.replace('-', '')}{datatype}"


def parse_number(raw: Any) -> float | None:
    """BLS and FRED values arrive as strings; '-', '.', '*', '' and footnoted
    suppression markers mean no value. Never coerce absence to 0."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    text = str(raw).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def shift_period(period: str, months: int) -> str:
    year, month = (int(p) for p in period.split("-"))
    index = year * 12 + (month - 1) + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def period_label(period: str) -> str:
    year, month = period.split("-")
    return f"{MONTH_NAMES[int(month) - 1]} {year}"


def yoy_change(values: dict[str, float], period: str, basis: str) -> float | None:
    """Year-over-year change at `period`: percent change for levels, percentage
    points for rates. None when either side is missing, or (pct) when the base
    is not a positive number — a zero base means unknown, not a real level."""
    current = values.get(period)
    prior = values.get(shift_period(period, -12))
    if current is None or prior is None:
        return None
    if basis == "pts":
        return round(current - prior, 2)
    if prior <= 0:
        return None
    return round((current / prior - 1.0) * 100.0, 2)


def bls_monthly_observations(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """BLS `data` rows -> [{period, value, preliminary}] oldest first. Annual
    averages (M13) are dropped; a row with no numeric value is dropped rather
    than recorded as 0."""
    out = []
    for row in data or []:
        period = str(row.get("period", ""))
        if not (period.startswith("M") and period[1:].isdigit()) or period == "M13":
            continue
        value = parse_number(row.get("value"))
        if value is None:
            continue
        preliminary = any((f or {}).get("code") == "P" for f in row.get("footnotes") or [])
        out.append({"period": f"{int(row['year']):04d}-{int(period[1:]):02d}",
                    "value": value, "preliminary": preliminary})
    out.sort(key=lambda o: o["period"])
    return out


def build_monthly_series(spec: dict[str, str], raw: dict[str, Any] | None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "label": spec["label"], "unit": spec["unit"], "geography": spec["geography"],
        "panel": spec["panel"], "frequency": "monthly",
        "seasonalAdjustment": spec["seasonalAdjustment"],
        "observations": [], "latest": None, "yoy": None,
        "yoyUnavailableReason": None, "unavailableReason": None,
    }
    if raw is None:
        entry["unavailableReason"] = "BLS did not return this series in its response."
        entry["yoyUnavailableReason"] = "No observations."
        return entry
    obs = bls_monthly_observations(raw.get("data") or [])
    if not obs:
        note = "; ".join(raw.get("messages") or []) or "no observations in the requested window"
        entry["unavailableReason"] = f"BLS returned no data for this series ({note})."
        entry["yoyUnavailableReason"] = "No observations."
        return entry
    entry["observations"] = obs
    last = obs[-1]
    entry["latest"] = {"period": last["period"], "value": last["value"], "preliminary": last["preliminary"]}
    values = {o["period"]: o["value"] for o in obs}
    change = yoy_change(values, last["period"], spec["basis"])
    if change is None:
        entry["yoyUnavailableReason"] = (
            f"No usable {period_label(shift_period(last['period'], -12))} observation to compare against.")
    else:
        entry["yoy"] = {"period": last["period"], "value": change, "basis": spec["basis"]}
    return entry


def oews_value(raw: dict[str, Any] | None, year: int | None) -> tuple[float | None, str | None]:
    """(value, reason) for one OEWS series in `year`."""
    if raw is None:
        return None, "BLS did not return this series."
    rows = [r for r in raw.get("data") or [] if year is None or str(r.get("year")) == str(year)]
    if not rows:
        return None, "BLS publishes no estimate for this area and occupation."
    value = parse_number(rows[0].get("value"))
    if value is None:
        notes = "; ".join((f or {}).get("text", "") for f in rows[0].get("footnotes") or [] if (f or {}).get("text"))
        return None, "BLS suppressed this estimate" + (f" ({notes})." if notes else ".")
    return value, None


def oews_year(raw: dict[str, Any]) -> int | None:
    years = [int(r["year"]) for sid, s in raw.items() if sid.startswith("OEU")
             for r in s.get("data") or [] if str(r.get("year", "")).isdigit()
             and parse_number(r.get("value")) is not None]
    return max(years) if years else None


def build_oews(raw: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    year = oews_year(raw)
    prior_rows: dict[tuple[str, str], Any] = {}
    prior_year_source = None
    if previous and year is not None:
        prev = previous.get("oews") or {}
        if prev.get("year") == year - 1:
            prior_rows = {(r["area"], r["soc"]): r.get("hourlyMean") for r in prev.get("rows") or []}
        elif prev.get("year") == year:
            prior_rows = {(r["area"], r["soc"]): r.get("hourlyMeanPrior") for r in prev.get("rows") or []}
        if any(v is not None for v in prior_rows.values()):
            prior_year_source = "previous file"
    rows = []
    for area in OEWS_AREAS:
        for occ in OEWS_OCCUPATIONS:
            emp_raw = raw.get(oews_series_id(area, occ["soc"], OEWS_EMPLOYMENT))
            wage_raw = raw.get(oews_series_id(area, occ["soc"], OEWS_HOURLY_MEAN))
            employment, emp_reason = oews_value(emp_raw, year)
            hourly, wage_reason = oews_value(wage_raw, year)
            prior = None
            if year is not None:
                prior, _ = oews_value(wage_raw, year - 1)
                if prior is not None:
                    prior_year_source = "BLS API"
            if prior is None:
                prior = parse_number(prior_rows.get((area["code"], occ["soc"])))
            change = None
            change_reason = None
            if hourly is None:
                change_reason = "No current-year hourly mean wage."
            elif prior is None or prior <= 0:
                change_reason = (f"No May {year - 1} hourly mean wage on record: the BLS API serves only the "
                                 "latest OEWS year, and this file did not yet hold the prior one."
                                 if year is not None else "No OEWS year returned.")
                prior = None
            else:
                change = round((hourly / prior - 1.0) * 100.0, 2)
            reasons = []
            if employment is None:
                reasons.append(f"Employment: {emp_reason}")
            if hourly is None:
                reasons.append(f"Hourly mean wage: {wage_reason}")
            rows.append({
                "area": area["code"], "soc": occ["soc"],
                "employment": employment, "hourlyMean": hourly,
                "hourlyMeanPrior": prior, "changePct": change,
                "unavailableReason": " ".join(reasons) or None,
                "changeUnavailableReason": change_reason,
            })
    return {
        "year": year,
        "referencePeriod": f"May {year}" if year is not None else None,
        "priorYearSource": prior_year_source,
        "areas": [{"code": a["code"], "name": a["name"]} for a in OEWS_AREAS],
        "occupations": [dict(o) for o in OEWS_OCCUPATIONS],
        "rows": rows,
    }


def fred_monthly_values(series: dict[str, Any] | None) -> dict[str, float]:
    out: dict[str, float] = {}
    for o in (series or {}).get("observations") or []:
        value = parse_number(o.get("value"))
        date = str(o.get("date", ""))
        if value is None or len(date) < 7:
            continue
        out[date[:7]] = value
    return out


def build_materials(fred: dict[str, Any] | None) -> dict[str, Any]:
    all_series = (fred or {}).get("series") or {}
    rows = []
    for spec in MATERIALS_SERIES:
        values = fred_monthly_values(all_series.get(spec["id"]))
        row: dict[str, Any] = {"id": spec["id"], "label": spec["label"], "latestPeriod": None,
                               "latest": None, "yoyPct": None, "unavailableReason": None}
        if spec["id"] not in all_series:
            row["unavailableReason"] = f"Series is not in {FRED_FILE_REL}."
        elif not values:
            row["unavailableReason"] = f"{FRED_FILE_REL} holds no numeric observations for this series."
        else:
            last = max(values)
            row["latestPeriod"] = last
            row["latest"] = values[last]
            row["yoyPct"] = yoy_change(values, last, "pct")
            if row["yoyPct"] is None:
                row["unavailableReason"] = (
                    f"No {period_label(shift_period(last, -12))} observation to compute year-over-year change.")
        rows.append(row)
    return {"source": FRED_FILE_REL, "headline": MATERIALS_HEADLINE, "series": rows}


def _direction(value: float, up: str, down: str) -> str:
    if value > 0:
        return f"{up} {abs(value):.1f}%"
    if value < 0:
        return f"{down} {abs(value):.1f}%"
    return "were unchanged"


def build_summary(monthly: dict[str, Any], fred: dict[str, Any] | None) -> dict[str, Any]:
    wage = monthly.get(WAGE_SERIES) or {}
    emp = monthly.get(EMPLOYMENT_SERIES) or {}
    latest = wage.get("latest") or emp.get("latest")
    if not latest:
        return {"period": None, "text": "Colorado construction labor data are unavailable.",
                "laborWageYoyPct": None, "employmentYoyPct": None, "materialsYoyPct": None}
    period = latest["period"]
    wage_vals = {o["period"]: o["value"] for o in wage.get("observations") or []}
    emp_vals = {o["period"]: o["value"] for o in emp.get("observations") or []}
    mat_vals = fred_monthly_values(((fred or {}).get("series") or {}).get(MATERIALS_HEADLINE))
    wage_yoy = yoy_change(wage_vals, period, "pct")
    emp_yoy = yoy_change(emp_vals, period, "pct")
    mat_yoy = yoy_change(mat_vals, period, "pct")
    when = period_label(period)
    prelim = " (preliminary)" if latest.get("preliminary") else ""
    parts = []
    if wage_yoy is None:
        parts.append(f"Colorado construction average hourly earnings for {when} have no year-earlier comparison")
    else:
        verb = _direction(wage_yoy, "rose", "fell")
        parts.append(f"Colorado construction average hourly earnings {verb} year over year in {when}{prelim}")
    if mat_yoy is None:
        parts.append(f"multifamily construction input prices for {when} are not yet published")
    else:
        parts.append("prices of net inputs to multifamily construction "
                     + _direction(mat_yoy, "rose", "fell"))
    text = parts[0] + ", while " + parts[1]
    if emp_yoy is None:
        text += "; construction employment has no year-earlier comparison."
    elif emp_yoy == 0:
        text += "; construction employment was unchanged from a year earlier."
    else:
        text += (f"; construction employment was {abs(emp_yoy):.1f}% "
                 f"{'higher' if emp_yoy > 0 else 'lower'} than a year earlier.")
    return {"period": period, "text": text, "laborWageYoyPct": wage_yoy,
            "employmentYoyPct": emp_yoy, "materialsYoyPct": mat_yoy}


def build_history(monthly: dict[str, Any], fred: dict[str, Any] | None,
                  previous: dict[str, Any] | None) -> list[dict[str, Any]]:
    """One row per month. Rebuilt from observations every run (so CES benchmark
    revisions flow through), merged over the previous file's rows so months
    that have aged out of the 10-year request window are kept."""
    wage_vals = {o["period"]: o["value"] for o in (monthly.get(WAGE_SERIES) or {}).get("observations") or []}
    emp_vals = {o["period"]: o["value"] for o in (monthly.get(EMPLOYMENT_SERIES) or {}).get("observations") or []}
    mat_vals = fred_monthly_values(((fred or {}).get("series") or {}).get(MATERIALS_HEADLINE))
    rows: dict[str, dict[str, Any]] = {}
    for row in (previous or {}).get("history") or []:
        if isinstance(row, dict) and row.get("period"):
            rows[row["period"]] = row
    for period in sorted(set(wage_vals) | set(emp_vals)):
        built = {"period": period,
                 "laborWageYoyPct": yoy_change(wage_vals, period, "pct"),
                 "employmentYoyPct": yoy_change(emp_vals, period, "pct"),
                 "materialsYoyPct": yoy_change(mat_vals, period, "pct")}
        if all(built[k] is None for k in ("laborWageYoyPct", "employmentYoyPct", "materialsYoyPct")):
            continue
        rows[period] = built
    return [rows[p] for p in sorted(rows)]


def build_payload(raw: dict[str, Any], fred: dict[str, Any] | None,
                  previous: dict[str, Any] | None, now: datetime) -> dict[str, Any]:
    monthly = {spec["id"]: build_monthly_series(spec, raw.get(spec["id"])) for spec in MONTHLY_SERIES}
    return {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": SOURCES,
        "monthly": monthly,
        "oews": build_oews(raw, previous),
        "materials": build_materials(fred),
        "summary": build_summary(monthly, fred),
        "history": build_history(monthly, fred, previous),
    }


def has_any_data(payload: dict[str, Any]) -> bool:
    if any(s.get("observations") for s in payload["monthly"].values()):
        return True
    return any(r.get("hourlyMean") is not None for r in payload["oews"]["rows"])


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

def _post(payload: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        BLS_API_URL, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "HousingAnalytics-ETL/1.0"})
    last_err: Exception | None = None
    for attempt in range(REQUEST_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_err = exc
            if attempt < REQUEST_RETRIES:
                time.sleep(5 * (attempt + 1))
    raise FetchError(f"BLS request failed: {last_err}")


def _request_chunk(ids: list[str], start_year: int, end_year: int, api_key: str | None,
                   catalog: bool, out: dict[str, Any]) -> None:
    """One BLS request. A REQUEST_FAILED answer ("check your input parameters")
    is retried without the catalog, then split in halves, so one series BLS
    rejects becomes a null-with-reason instead of failing the whole run. Any
    other non-success answer (quota, outage) raises."""
    body: dict[str, Any] = {"seriesid": ids, "startyear": str(start_year), "endyear": str(end_year)}
    if api_key:
        body["registrationkey"] = api_key
        if catalog:
            body["catalog"] = True
    resp = _post(body)
    status = resp.get("status")
    messages = [str(m) for m in resp.get("message") or []]
    if status == "REQUEST_FAILED":
        _log(f"  BLS REQUEST_FAILED for {len(ids)} series ({'; '.join(messages) or 'no message'})")
        if catalog and api_key:
            time.sleep(1)
            _request_chunk(ids, start_year, end_year, api_key, False, out)
            return
        if len(ids) > 1:
            mid = len(ids) // 2
            for part in (ids[:mid], ids[mid:]):
                time.sleep(1)
                _request_chunk(part, start_year, end_year, api_key, False, out)
            return
        out[ids[0]] = {"data": [], "catalog": None,
                       "messages": [f"BLS rejected this series: {'; '.join(messages) or 'REQUEST_FAILED'}"]}
        return
    if status != "REQUEST_SUCCEEDED":
        raise FetchError(f"BLS answered {status}: {'; '.join(messages) or 'no message'}")
    for s in (resp.get("Results") or {}).get("series") or []:
        sid = s.get("seriesID")
        out[sid] = {"data": s.get("data") or [],
                    "messages": [m for m in messages if sid in m],
                    "catalog": s.get("catalog")}


def fetch_bls(series_ids: list[str], api_key: str | None, end_year: int) -> dict[str, Any]:
    """Returns {seriesID: {"data": [...], "messages": [...], "catalog": {...}|None}}.
    Raises FetchError when a request is refused (quota) or fails outright."""
    chunk = CHUNK_WITH_KEY if api_key else CHUNK_WITHOUT_KEY
    start_year = end_year - WINDOW_YEARS + 1
    out: dict[str, Any] = {}
    for i in range(0, len(series_ids), chunk):
        ids = series_ids[i:i + chunk]
        _log(f"  BLS request {i // chunk + 1}: {len(ids)} series, {start_year}-{end_year}")
        _request_chunk(ids, start_year, end_year, api_key, True, out)
        if i + chunk < len(series_ids):
            time.sleep(1)
    return out


def all_series_ids() -> list[str]:
    ids = [s["id"] for s in MONTHLY_SERIES]
    for area in OEWS_AREAS:
        for occ in OEWS_OCCUPATIONS:
            for dt in (OEWS_EMPLOYMENT, OEWS_HOURLY_MEAN):
                ids.append(oews_series_id(area, occ["soc"], dt))
    return ids


def check_area_names(raw: dict[str, Any]) -> None:
    """With a key, BLS returns a catalog naming each OEWS area; warn on drift
    from the names written above (an OMB redelineation renames metros)."""
    for area in OEWS_AREAS:
        sid = oews_series_id(area, OEWS_OCCUPATIONS[0]["soc"], OEWS_HOURLY_MEAN)
        catalog = (raw.get(sid) or {}).get("catalog") or {}
        name = catalog.get("area")
        if name and name.strip().lower() not in area["name"].lower() and area["name"].lower() not in name.lower():
            _log(f"::warning::OEWS area {area['code']} is named '{name}' by BLS, '{area['name']}' here")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(OUT_FILE))
    ap.add_argument("--save-raw", help="also write the raw BLS responses (by series) to this path")
    ap.add_argument("--from-raw", help="build from a saved raw file instead of calling BLS")
    args = ap.parse_args(argv)

    out_path = Path(args.out)
    previous = _read_json(out_path)
    fred = _read_json(FRED_FILE)
    if fred is None:
        _log(f"::warning::{FRED_FILE_REL} is missing or unreadable; materials will be null with reasons")

    if args.from_raw:
        raw = _read_json(Path(args.from_raw))
        if raw is None:
            _log(f"::error::cannot read {args.from_raw}")
            return 1
    else:
        api_key = (os.environ.get("BLS_API_KEY") or "").strip() or None
        _log(f"BLS_API_KEY {'set' if api_key else 'NOT set (25 series/request, 25 requests/day)'}")
        try:
            raw = fetch_bls(all_series_ids(), api_key, datetime.now(timezone.utc).year)
        except FetchError as exc:
            _log(f"::error::{exc}")
            _log(f"Leaving {out_path} untouched.")
            return 1
        if args.save_raw:
            Path(args.save_raw).write_text(json.dumps(raw), encoding="utf-8")

    check_area_names(raw)
    payload = build_payload(raw, fred, previous, datetime.now(timezone.utc))
    if not has_any_data(payload):
        _log("::error::BLS returned no data for any series; leaving the previous file untouched.")
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    for sid, s in payload["monthly"].items():
        latest = s["latest"]
        _log(f"  {sid}: {latest['period'] + ' = ' + str(latest['value']) if latest else 'UNAVAILABLE'}"
             f"{'' if not s['yoy'] else '  yoy ' + str(s['yoy']['value']) + ' ' + s['yoy']['basis']}")
    missing = sum(1 for r in payload["oews"]["rows"] if r["hourlyMean"] is None)
    _log(f"  OEWS {payload['oews']['referencePeriod']}: {len(payload['oews']['rows'])} rows, "
         f"{missing} without an hourly mean")
    _log(f"  Summary: {payload['summary']['text']}")
    _log(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
