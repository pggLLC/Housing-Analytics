#!/usr/bin/env python3
"""Fetch statewide Colorado NPL and ACRES records from EPA Envirofacts.

The two URLs below are executable queries documented by EPA's DMAP service.
The output is written atomically only after both statewide responses validate.
"""

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "environmental" / "epa-superfund-co.json"
PAGE_LIMIT = 10000
SEMS_QUERY_URL = (
    "https://data.epa.gov/dmapservice/sems.envirofacts_site/"
    "fk_ref_state_code/equals/CO/and/npl_status_code/in/F,D,P/1:10000/json"
)
ACRES_QUERY_URL = (
    "https://data.epa.gov/dmapservice/lookups.mv_new_geo_best_picks/"
    "state_code/equals/CO/join/frs.frs_program_facility/"
    "registry_id/equals/registry_id/and/pgm_sys_acrnm/equals/ACRES/1:10000/json"
)


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_json(url, opener=urllib.request.urlopen, sleep_fn=time.sleep,
               retries=3, timeout=120):
    """Fetch JSON; retry transient failures, but never deterministic 4xx."""
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "COHO-Analytics/1.0"}
            )
            with opener(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, list) or not payload:
                raise RuntimeError("EPA returned an empty or invalid record set")
            return payload
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                raise RuntimeError(f"EPA request failed with HTTP {exc.code}") from exc
            last_error = exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError,
                RuntimeError) as exc:
            last_error = exc
        if attempt < retries - 1:
            sleep_fn(2 ** attempt)
    raise RuntimeError(f"EPA request failed after {retries} attempts: {last_error}")


def _coordinate(row, latitude_key, longitude_key):
    try:
        latitude = float(row.get(latitude_key))
        longitude = float(row.get(longitude_key))
    except (TypeError, ValueError):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def _county_fips(value):
    text = str(value or "").strip()
    return text if len(text) == 5 and text.startswith("08") and text.isdigit() else None


def normalize_superfund(rows):
    records = []
    omitted_coordinates = 0
    for row in rows:
        point = _coordinate(
            row, "primary_latitude_decimal_val", "primary_longitude_decimal_val"
        )
        if point is None:
            omitted_coordinates += 1
            continue
        status_code = str(row.get("npl_status_code") or "").strip().upper()
        records.append({
            "id": str(row.get("epa_id") or row.get("site_id") or "").strip(),
            "name": str(row.get("name") or "").strip(),
            "county_fips": _county_fips(row.get("fips_code")),
            "county": str(row.get("county_name") or "").strip().title(),
            "lat": point[0],
            "lon": point[1],
            "status": str(row.get("npl_status_name") or "").strip(),
            "npl_status_code": status_code,
            "npl": status_code in {"F", "P"},
            "riskLevel": "moderate" if status_code == "D" else "high",
        })
    records.sort(key=lambda item: (item["name"], item["id"]))
    return records, omitted_coordinates


def normalize_brownfields(rows):
    records = []
    omitted_coordinates = 0
    for row in rows:
        point = _coordinate(row, "latitude", "longitude")
        if point is None:
            omitted_coordinates += 1
            continue
        records.append({
            "id": str(row.get("pgm_sys_id") or "").strip(),
            "registry_id": str(row.get("registry_id") or "").strip(),
            "name": str(
                row.get("frs.frs_program_facility.primary_name")
                or row.get("primary_name") or ""
            ).strip(),
            "county_fips": _county_fips(row.get("fips_code")),
            "county": str(row.get("county_name") or "").strip().title(),
            "lat": point[0],
            "lon": point[1],
            "status": "EPA ACRES program record",
            "riskLevel": "moderate",
        })
    records.sort(key=lambda item: (item["name"], item["id"]))
    return records, omitted_coordinates


def build_dataset(fetcher=fetch_json, retrieved_at=None):
    superfund_source = fetcher(SEMS_QUERY_URL)
    brownfield_source = fetcher(ACRES_QUERY_URL)
    if len(superfund_source) >= PAGE_LIMIT or len(brownfield_source) >= PAGE_LIMIT:
        raise RuntimeError("EPA response reached the page limit; statewide coverage is unproven")
    if any(row.get("fk_ref_state_code") != "CO" for row in superfund_source):
        raise RuntimeError("SEMS response contains records outside Colorado")
    if any(row.get("state_code") != "CO" for row in brownfield_source):
        raise RuntimeError("ACRES response contains records outside Colorado")

    superfund, superfund_omitted = normalize_superfund(superfund_source)
    brownfields, brownfield_omitted = normalize_brownfields(brownfield_source)
    if not superfund or not brownfields:
        raise RuntimeError("EPA normalization produced an empty statewide dataset")

    timestamp = retrieved_at or utc_now()
    return {
        "meta": {
            "source": "EPA Envirofacts SEMS and FRS/ACRES",
            "state": "Colorado",
            "retrieved_at": timestamp,
            "generated": timestamp,
            "coverage_status": "full_statewide",
            "coverage_reason": "Statewide Colorado queries of EPA SEMS NPL sites and FRS-linked ACRES brownfield program records.",
            "query_urls": {
                "superfund": SEMS_QUERY_URL,
                "brownfields": ACRES_QUERY_URL,
            },
            "superfund_source_records": len(superfund_source),
            "brownfield_source_records": len(brownfield_source),
            "superfund_records": len(superfund),
            "brownfield_records": len(brownfields),
            "superfund_omitted_missing_coordinates": superfund_omitted,
            "brownfield_omitted_missing_coordinates": brownfield_omitted,
            "note": "NPL query includes final, deleted, and proposed sites; ACRES records use EPA FRS representative coordinates.",
        },
        "superfundSites": superfund,
        "brownfieldSites": brownfields,
    }


def write_atomic(dataset, output_path=OUT_FILE):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=output_path.name + ".", suffix=".tmp", dir=output_path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(dataset, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.replace(temporary, output_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def run(output_path=OUT_FILE, fetcher=fetch_json, retrieved_at=None):
    dataset = build_dataset(fetcher=fetcher, retrieved_at=retrieved_at)
    write_atomic(dataset, output_path)
    return dataset


def main():
    try:
        dataset = run()
    except Exception as exc:  # Preserve the last-good file by failing before write.
        print(f"EPA environmental fetch failed: {exc}", file=sys.stderr)
        return 1
    meta = dataset["meta"]
    print(
        "Wrote "
        f"{meta['superfund_records']} Superfund and "
        f"{meta['brownfield_records']} brownfield records to {OUT_FILE}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
