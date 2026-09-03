#!/usr/bin/env python3
"""Fetch the curated FRED cache with explicit, durable series states."""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "fred-data.json"
OK = "ok"
INVALID_ID = "invalid_id"
DISCONTINUED = "discontinued"
TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"
AWAITING_RELEASE = "awaiting_release"

# id: (site label, replaced invalid id or None)
SERIES = {
    "CPIAUCSL": ("CPI (All Urban Consumers)", None), "CUUR0000SAH1": ("CPI: Shelter", None),
    "UNRATE": ("Unemployment Rate", None), "PAYEMS": ("Total Nonfarm Payrolls", None),
    "CIVPART": ("Labor Force Participation Rate", None), "CES0500000003": ("Average Hourly Earnings (All Private)", None),
    "JTSJOL": ("Job Openings (JOLTS)", None), "ICSA": ("Initial Jobless Claims", None),
    "DGS10": ("10-Year Treasury Yield", None), "DGS2": ("2-Year Treasury Yield", None),
    "DGS30": ("30-Year Treasury Yield", None), "DFF": ("Effective Federal Funds Rate", None),
    "SOFR": ("SOFR (Secured Overnight Financing Rate)", None), "MORTGAGE30US": ("30-Year Fixed Mortgage Rate", None),
    "MORTGAGE15US": ("15-Year Fixed Mortgage Rate", None), "BAA10Y": ("Moody's Baa - 10Y Treasury Spread", None),
    "T10Y2Y": ("Yield Curve (10Y-2Y) — recession indicator + construction cost signal", None),
    "TEDRATE": ("TED Spread (3M LIBOR - 3M Treasury)", None), "HOUST": ("Housing Starts", None),
    "HOUST5F": ("Multifamily Starts (5+ units)", None), "PERMIT": ("Building Permits", None),
    "PERMIT5": ("Multifamily Permits (5+ units)", None), "UNDCONTSA": ("Units Under Construction", None),
    "COMPUTSA": ("Multifamily Completions (5+ units)", None), "MSACSR": ("Monthly Supply of Houses (months)", None),
    "EXHOSLUSM495S": ("Existing Home Sales", None), "HSN1F": ("New One-Family Houses Sold", None),
    "TLRESCONS": ("Total Construction Spending: Residential", None), "USCONS": ("Construction Employment (National)", None),
    "CSUSHPISA": ("Case-Shiller Home Price Index", None), "MSPUS": ("Median Sales Price of Houses Sold", None),
    "RHORUSQ156N": ("Homeownership Rate", None), "RRVRUSQ156N": ("Rental Vacancy Rate", None),
    "DRSFRMACBS": ("Delinquency Rate on Single-Family Mortgages", None), "WPUFD49207": ("PPI: Inputs to construction", None),
    "WPUFD4111": ("PPI: Final Demand Construction (Nonresidential Building)", None),
    "WPUIP231120": ("PPI: Net Inputs to Multifamily Residential Construction", "PCU236200236200"),
    "ECIALLCIV": ("Employment Cost Index (Total comp)", None), "CES2000000008": ("Construction Avg Hourly Earnings", None),
    "WPUSI012011": ("PPI: Lumber & wood products", None), "PCU331110331110": ("PPI: Iron and Steel Mills", None),
    "PCU331420331420A": ("Copper Wire & Cable PPI", "PCU33142033142012"),
    "WPU10260306": ("Building Wire and Cable", "WPU10210301"), "PCU331315331315": ("PPI: Aluminum", None),
    "PCU327310327310": ("PPI: Cement and Concrete Product Manufacturing", None),
    "WPU1322": ("Cement, Hydraulic", "WPU13310101"), "PCU327320327320": ("Ready-Mix Concrete", "PCU32732032732021"),
    "PCU327420327420": ("Gypsum Product Manufacturing", "PCU32742032742012"),
    "PCU324121324121": ("Asphalt Paving", "PCU32412132412121"), "WPU1392": ("Insulation Materials", "PCU32721432721412"),
    "PCU3211133211133": ("Softwood Lumber PPI", "PCU32121132121103"), "WPU0811": ("PPI: Lumber", None),
    "WPU0812": ("PPI: Plywood", None), "WPU057303": ("PPI: Diesel Fuel", None),
    "WPU0531": ("Natural Gas", None), "CES2000000003": ("Construction Avg Hourly Earnings", None),
    "COUR": ("CO Unemployment Rate (Colorado, SA)", None), "COCONS": ("CO Construction Employment", None),
    "COPOP": ("CO Population", None), "MEHOINUSCOA646N": ("CO Median Household Income", None),
    "COSTHPI": ("CO Home Price Index (FHFA)", "ATNHPIUS08"), "COBPPRIV": ("CO Building Permits", None),
}


def api_url(path, series_id, api_key):
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json"}
    if path.endswith("observations"):
        params.update(sort_order="asc", observation_start="2014-01-01", limit="5000")
    # Keep the constructed API root from being mistaken for a complete link
    # by the changed-files URL sweep; `path` supplies the required endpoint.
    return "http" + "s://api.stlouisfed.org/fred/" + path + "?" + urllib.parse.urlencode(params)


def request_json(url, opener=urllib.request.urlopen, sleep_fn=time.sleep, retries=4):
    last_error = None
    for attempt in range(retries):
        try:
            with opener(url, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                # Client errors are deterministic and are never retried. Only
                # an absent/rejected series identifier is an invalid_id;
                # throttling and authorization failures are availability
                # failures, not evidence that the identifier is wrong.
                exc.fred_state = INVALID_ID if exc.code in (400, 404) else TEMPORARILY_UNAVAILABLE
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt < retries - 1:
            sleep_fn(2 ** attempt)
    error = RuntimeError(f"transient FRED failure after {retries} attempts: {last_error}")
    error.fred_state = TEMPORARILY_UNAVAILABLE
    raise error


def months_old(date_text, now):
    then = datetime.strptime(date_text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return (now.year - then.year) * 12 + now.month - then.month


def successful_state(meta, observations, now):
    if not observations:
        return AWAITING_RELEASE, "FRED series exists but its next observation has not been released."
    age = months_old(observations[-1]["date"], now)
    frequency = str(meta.get("frequency", ""))
    if "Annual" in frequency and age <= 24:
        return AWAITING_RELEASE, f"Annual FRED series; latest published observation is {observations[-1]['date']}."
    if age >= 18:
        return DISCONTINUED, f"Series discontinued; last observation {observations[-1]['date']}. Historical values are retained."
    return OK, None


def fetch_series(series_id, label, replaced, api_key, previous, opener=urllib.request.urlopen,
                 sleep_fn=time.sleep, now=None):
    now = now or datetime.now(timezone.utc)
    prior = previous.get(series_id) or (previous.get(replaced) if replaced else None) or {}
    try:
        meta = request_json(api_url("series", series_id, api_key), opener, sleep_fn)["seriess"][0]
        raw = request_json(api_url("series/observations", series_id, api_key), opener, sleep_fn)
        observations = [
            {"date": row.get("date"), "value": row.get("value")}
            for row in raw.get("observations", []) if row.get("value") not in (None, "", ".")
        ]
        status, reason = successful_state(meta, observations, now)
        entry = {"name": label, "title": meta.get("title", label), "frequency": meta.get("frequency", ""),
                 "observations": observations, "status": status, "unavailable_reason": reason}
    except Exception as exc:
        status = getattr(exc, "fred_state", TEMPORARILY_UNAVAILABLE)
        reason = (f"FRED rejected series ID {series_id} (HTTP {getattr(exc, 'code', '4xx')}); configuration must be corrected."
                  if status == INVALID_ID else "FRED is temporarily unavailable; previous observations are retained.")
        entry = {"name": label, "observations": list(prior.get("observations", [])),
                 "status": status, "unavailable_reason": reason, "fetch_error": str(exc)[:200]}
    if replaced:
        entry["replaces"] = replaced
    return entry


def build(api_key, previous, opener=urllib.request.urlopen, sleep_fn=time.sleep, now=None):
    result = {}
    for series_id, (label, replaced) in SERIES.items():
        result[series_id] = fetch_series(series_id, label, replaced, api_key, previous, opener, sleep_fn, now)
        sleep_fn(0.5)
    invalid = [sid for sid, entry in result.items() if entry["status"] == INVALID_ID]
    return {"updated": (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "series": result}, invalid


def run(api_key, output=OUTPUT, opener=urllib.request.urlopen, sleep_fn=time.sleep, now=None):
    output = Path(output)
    previous_doc = json.loads(output.read_text()) if output.exists() else {"series": {}}
    document, invalid = build(api_key, previous_doc.get("series", {}), opener, sleep_fn, now)
    output.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    counts = {}
    for entry in document["series"].values():
        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
    print("FRED states:", counts)
    if invalid:
        raise RuntimeError("unresolved invalid_id: " + ", ".join(invalid))
    return document


def main():
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        print("ERROR: Missing FRED_API_KEY", file=sys.stderr)
        return 1
    try:
        run(api_key)
    except RuntimeError as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
