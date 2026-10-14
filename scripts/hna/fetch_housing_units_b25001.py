#!/usr/bin/env python3
"""Cache ACS B25001 (total housing units) for every HNA geography.

The second homes panel divides seasonal/recreational/occasional vacant units
(B25004_006, already cached in data/hna/vacancy-status.json) by all housing
units. Both must come from the same ACS release, so this script refuses to
write when Census Reporter's latest release differs from the one the vacancy
cache names.

    python3 scripts/hna/fetch_housing_units_b25001.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VACANCY_PATH = os.path.join(ROOT, "data", "hna", "vacancy-status.json")
OUT_PATH = os.path.join(ROOT, "data", "hna", "housing-units-b25001.json")


def reporter_id(geoid: str) -> str:
    return f"05000US{geoid}" if len(geoid) == 5 else f"16000US{geoid}"


def fetch(ids: list[str], retries: int = 3) -> dict:
    params = urllib.parse.urlencode({"table_ids": "B25001", "geo_ids": ",".join(ids)})
    url = f"https://api.censusreporter.org/1.0/data/show/latest?{params}"
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "Accept": "application/json",
                "User-Agent": "Housing-Analytics/1.0 (B25001 cache rebuild)",
            })
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"Census Reporter fetch failed: {last}")


def main() -> int:
    with open(VACANCY_PATH, encoding="utf-8") as fh:
        vacancy = json.load(fh)
    geoids = sorted(vacancy["geographies"])
    expected = vacancy["meta"]["source"]  # e.g. "Census Reporter ACS 2024 5-year API"
    records: dict[str, dict] = {}
    release = None
    for i in range(0, len(geoids), 45):
        batch = geoids[i:i + 45]
        payload = fetch([reporter_id(g) for g in batch])
        release = payload.get("release", {})
        if release.get("name") and release["name"] not in expected:
            print(f"[error] latest release {release['name']} != vacancy cache ({expected}); rebuild both", file=sys.stderr)
            return 2
        for g in batch:
            table = payload.get("data", {}).get(reporter_id(g), {}).get("B25001", {})
            est = table.get("estimate", {}).get("B25001001")
            moe = table.get("error", {}).get("B25001001")
            records[g] = {
                "housing_units": int(round(est)) if isinstance(est, (int, float)) else None,
                "moe": int(round(moe)) if isinstance(moe, (int, float)) else None,
            }
        print(f"Fetched B25001 {min(i + 45, len(geoids))}/{len(geoids)}")
    out = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "source": f"Census Reporter {release.get('name')} API" if release else None,
            "release": release,
            "table": "B25001 Housing Units",
            "geography_count": len(records),
        },
        "geographies": records,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {OUT_PATH} ({len(records)} geographies)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
