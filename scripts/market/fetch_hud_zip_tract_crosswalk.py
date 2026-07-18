#!/usr/bin/env python3
"""
Fetch the HUD-USPS ZIP-to-tract crosswalk for Colorado.

The HUD User USPS API requires a Bearer token. In CI this script reads the
existing HUD_API_TOKEN repository secret and commits only the Colorado subset
needed by downstream market-data work.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "market" / "hud_zip_tract_crosswalk_co.json"

HUD_USPS_API_URL = "https://www.huduser.gov/hudapi/public/usps"
HUD_USPS_DOCS_URL = "https://www.huduser.gov/portal/dataset/uspszip-api.html"
HUD_USPS_APP_URL = "https://www.huduser.gov/apps/public/uspscrosswalk/home"
HUD_DATALUMOS_FILE_URL = (
    "https://www.datalumos.org/datalumos/project/219325/version/V3/view"
    "?path=%2Fdatalumos%2F219325%2Ffcr%3Aversions%2FV3%2FHUD-USPS-ZIP-Crosswalk"
    "%2FZIP-Tract%2FZIP_TRACT_032024.xlsx&type=file"
)

TYPE_ZIP_TRACT = "1"
QUERY_STATE = "CO"
MIN_CO_ROWS = 2_000
MIN_CO_ZIPS = 300
MIN_CO_TRACTS = 1_000


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def normalize_digits(raw: object, width: int) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    return digits.zfill(width) if digits else ""


def as_ratio(raw: object, field: str) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} is not numeric: {raw!r}") from exc
    if value < 0 or value > 1:
        raise ValueError(f"{field} out of [0,1] bounds: {value}")
    return value


def request_json(url: str, token: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "Housing-Analytics HUD USPS crosswalk fetcher",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read()
            if not body:
                raise RuntimeError("HUD USPS API returned an empty response body")
            return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HUD USPS API HTTP {exc.code}: {body}") from exc


def extract_payload(payload: dict) -> tuple[dict, list[dict]]:
    data = payload.get("data")
    if isinstance(data, dict):
        results = data.get("results")
        if isinstance(results, list):
            return data, results
    if isinstance(data, list):
        if data and all(isinstance(item, dict) and isinstance(item.get("results"), list) for item in data):
            rows: list[dict] = []
            for item in data:
                rows.extend(item["results"])
            return data[0], rows
        return {"results": data}, data
    results = payload.get("results")
    if isinstance(results, list):
        return payload, results
    raise ValueError("HUD USPS API response did not contain data.results")


def normalize_rows(raw_rows: list[dict]) -> list[dict]:
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_rows:
        zip_code = normalize_digits(
            raw.get("zip") or raw.get("zipcode") or raw.get("zip_code") or raw.get("input"),
            5,
        )
        tract = normalize_digits(raw.get("geoid") or raw.get("tract"), 11)
        if not zip_code or not tract:
            raise ValueError(f"missing zip or tract in row: {raw!r}")
        if not tract.startswith("08"):
            continue
        key = (zip_code, tract)
        if key in seen:
            raise ValueError(f"duplicate ZIP/tract row: {zip_code} {tract}")
        seen.add(key)
        rows.append({
            "zip": zip_code,
            "tract": tract,
            "res_ratio": as_ratio(raw.get("res_ratio"), "res_ratio"),
            "bus_ratio": as_ratio(raw.get("bus_ratio"), "bus_ratio"),
            "oth_ratio": as_ratio(raw.get("oth_ratio"), "oth_ratio"),
            "tot_ratio": as_ratio(raw.get("tot_ratio"), "tot_ratio"),
            "city": str(raw.get("city") or "").strip() or None,
            "state": str(raw.get("state") or QUERY_STATE).strip() or QUERY_STATE,
        })
    rows.sort(key=lambda row: (row["zip"], row["tract"]))
    return rows


def validate_rows(rows: list[dict]) -> None:
    zip_count = len({row["zip"] for row in rows})
    tract_count = len({row["tract"] for row in rows})
    if len(rows) < MIN_CO_ROWS:
        raise ValueError(f"Colorado ZIP-tract crosswalk has only {len(rows)} rows")
    if zip_count < MIN_CO_ZIPS:
        raise ValueError(f"Colorado ZIP-tract crosswalk has only {zip_count} ZIPs")
    if tract_count < MIN_CO_TRACTS:
        raise ValueError(f"Colorado ZIP-tract crosswalk has only {tract_count} tracts")


def build_output(payload_meta: dict, rows: list[dict]) -> dict:
    year = str(payload_meta.get("year") or "").strip() or None
    quarter = str(payload_meta.get("quarter") or "").strip() or None
    return {
        "meta": {
            "source": "HUD-USPS ZIP Code Crosswalk API",
            "source_url": HUD_USPS_API_URL,
            "source_docs_url": HUD_USPS_DOCS_URL,
            "source_app_url": HUD_USPS_APP_URL,
            "source_file_metadata_url": HUD_DATALUMOS_FILE_URL,
            "state": "Colorado",
            "state_fips": "08",
            "crosswalk_type": "zip-tract",
            "api_type": TYPE_ZIP_TRACT,
            "api_query": QUERY_STATE,
            "vintage_year": year,
            "vintage_quarter": quarter,
            "as_of": f"{year}-{quarter}" if year and quarter else utc_today(),
            "last_verified": utc_today(),
            "review_by": "2026-10-18",
            "row_count": len(rows),
            "zip_count": len({row["zip"] for row in rows}),
            "tract_count": len({row["tract"] for row in rows}),
            "methodology": (
                "Rows are fetched from HUD's ZIP-to-tract USPS crosswalk API "
                "with type=1&query=CO, then filtered to Census tracts whose "
                "11-digit GEOID begins with Colorado state FIPS 08."
            ),
            "notes": [
                "HUD ratio fields are preserved as published: residential, business, other, and total address ratios.",
                "The committed file is a Colorado subset only; downstream ZIP allocations must keep thin or missing ratios null rather than inventing values.",
            ],
        },
        "rows": rows,
    }


def main() -> int:
    token = os.environ.get("HUD_API_TOKEN", "").strip()
    if not token:
        print(
            "HUD_API_TOKEN is required. The repository has this as an Actions secret; "
            "run via the HUD workflow or export it locally.",
            file=sys.stderr,
        )
        return 1

    params = urllib.parse.urlencode({"type": TYPE_ZIP_TRACT, "query": QUERY_STATE})
    url = f"{HUD_USPS_API_URL}?{params}"
    print(f"Fetching HUD-USPS ZIP-to-tract crosswalk for Colorado: {url}")
    payload = request_json(url, token)
    payload_meta, raw_rows = extract_payload(payload)
    rows = normalize_rows(raw_rows)
    validate_rows(rows)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    output = build_output(payload_meta, rows)
    OUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT.relative_to(ROOT)} with {len(rows)} rows, "
        f"{output['meta']['zip_count']} ZIPs, {output['meta']['tract_count']} tracts"
    )
    time.sleep(0.1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
