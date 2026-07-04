#!/usr/bin/env python3
"""Build ACS B25004 vacancy-status cache for ranking adjustments.

The ranking index uses active-market vacancy (for-rent + for-sale vacant
units) rather than raw ACS rental vacancy so resort/seasonal stock does not
look like market slack. Census Reporter is used because this repo's keyless
Census API path is not reliable in automation.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SUMMARY_DIR = os.path.join(ROOT, "data", "hna", "summary")
OUT_PATH = os.path.join(ROOT, "data", "hna", "vacancy-status.json")

B25004_COLUMNS = {
    "B25004001": "vacant_total",
    "B25004002": "for_rent",
    "B25004003": "rented_not_occupied",
    "B25004004": "for_sale_only",
    "B25004005": "sold_not_occupied",
    "B25004006": "seasonal_recreational_occasional",
    "B25004007": "migrant_workers",
    "B25004008": "other_vacant",
}


def utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_summary_geoids() -> list[tuple[str, str]]:
    geoids: list[tuple[str, str]] = []
    for fname in sorted(os.listdir(SUMMARY_DIR)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(SUMMARY_DIR, fname)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        geo = data.get("geo", {})
        geo_type = geo.get("type")
        geoid = str(geo.get("geoid") or fname[:-5])
        if geo_type == "county" and len(geoid) == 5:
            geoids.append((geoid, f"05000US{geoid}"))
        elif geo_type in ("place", "cdp") and len(geoid) == 7:
            geoids.append((geoid, f"16000US{geoid}"))
    return geoids


def fetch_batch(reporter_geoids: list[str], retries: int = 3) -> dict[str, Any]:
    params = urllib.parse.urlencode({
        "table_ids": "B25004",
        "geo_ids": ",".join(reporter_geoids),
    })
    url = f"https://api.censusreporter.org/1.0/data/show/latest?{params}"
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Housing-Analytics-Codex/1.0 (B25004 cache rebuild)",
                },
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"Census Reporter fetch failed after {retries} attempts: {last_error}")


def extract_estimates(payload: dict[str, Any], geoid_lookup: dict[str, str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    data = payload.get("data", {})
    geography = payload.get("geography", {})
    for reporter_geoid, tables in sorted(data.items()):
        geoid = geoid_lookup.get(reporter_geoid)
        if not geoid:
            continue
        table = tables.get("B25004", {})
        estimates = table.get("estimate", {})
        errors = table.get("error", {})
        values = {
            out_key: int(round(float(estimates.get(src_key, 0) or 0)))
            for src_key, out_key in B25004_COLUMNS.items()
        }
        moe = {
            out_key: int(round(float(errors.get(src_key, 0) or 0)))
            for src_key, out_key in B25004_COLUMNS.items()
        }
        vacant_total = values["vacant_total"]
        seasonal = values["seasonal_recreational_occasional"]
        active_market = values["for_rent"] + values["for_sale_only"]
        result[geoid] = {
            "geoid": geoid,
            "name": geography.get(reporter_geoid, {}).get("name"),
            "vacant_total": vacant_total,
            "for_rent": values["for_rent"],
            "for_sale_only": values["for_sale_only"],
            "active_market_vacant": active_market,
            "seasonal_recreational_occasional": seasonal,
            "seasonal_share_of_vacant": round(seasonal / vacant_total, 4) if vacant_total > 0 else None,
            "other_vacant": values["other_vacant"],
            "values": values,
            "moe": moe,
        }
    return result


def fetch_resilient(batch: list[tuple[str, str]], geoid_lookup: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Fetch a batch, splitting around Census Reporter geography rejects."""
    try:
        payload = fetch_batch([reporter for _geoid, reporter in batch])
        return extract_estimates(payload, geoid_lookup)
    except RuntimeError as exc:
        if len(batch) == 1:
            geoid, reporter = batch[0]
            print(f"[warn] skipping {geoid} ({reporter}): {exc}")
            return {}
        mid = len(batch) // 2
        left = fetch_resilient(batch[:mid], geoid_lookup)
        right = fetch_resilient(batch[mid:], geoid_lookup)
        left.update(right)
        return left


def main() -> None:
    geoid_pairs = load_summary_geoids()
    by_reporter = {reporter: geoid for geoid, reporter in geoid_pairs}
    records: dict[str, dict[str, Any]] = {}
    batch_size = 45
    for i in range(0, len(geoid_pairs), batch_size):
        batch = geoid_pairs[i:i + batch_size]
        records.update(fetch_resilient(batch, by_reporter))
        print(f"Fetched B25004 {min(i + batch_size, len(geoid_pairs))}/{len(geoid_pairs)}")

    output = {
        "meta": {
            "generated_at": utc_now_z(),
            "source": "Census Reporter ACS 2024 5-year API",
            "table": "B25004 Vacancy Status",
            "method": (
                "Active-market vacancy is for-rent plus for-sale-only vacant units. "
                "Seasonal share is seasonal/recreational/occasional vacant units divided by all vacant units."
            ),
            "geography_count": len(records),
        },
        "geographies": dict(sorted(records.items())),
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {OUT_PATH} ({len(records)} geographies)")


if __name__ == "__main__":
    main()
