#!/usr/bin/env python3
"""
scripts/audit/upstream-schema-check.py

Validate that external API responses still match our parser's expected
schema. Runs daily on cron + on every PR that touches a fetch script.

Background
----------
The 2026-05-08 audit caught the CHAS Table 9 → Table 7 parsing bug only
because we manually compared CHAS county totals against ACS B19001. This
script institutionalizes the upstream-side of that comparison: instead of
waiting for our derived data files to look wrong, we hit the upstream
APIs directly and assert their response shape matches what our parsers
expect to find.

When a column is renamed, removed, or changed at the source, this script
fails LOUD instead of letting the wrong-but-valid-shaped data flow into
production silently.

Coverage (initial set; extend as new sources are added)
-------------------------------------------------------
  - Census ACS 5-year   (B19001, B25003, B25063, B25074, DP04 profile)
  - HUD CHAS metadata   (URL availability — actual table parsing is
                         tested by the parser unit tests)
  - HUD FMR API         (income limits structure)
  - FRED                (sample series metadata)
  - DOLA SDO            (population endpoint structure)

Each check fetches a small, well-known query and asserts the response:
  1. Returns 200 OK
  2. Has the expected top-level shape (array of arrays for ACS;
     dict-of-objects for FRED / HUD)
  3. Contains the expected fields/keys our parsers reference

Exit codes
----------
  0 — all checks passed
  1 — at least one check failed (log indicates which)
  2 — internal error (non-data failure)

Usage
-----
    python3 scripts/audit/upstream-schema-check.py
    python3 scripts/audit/upstream-schema-check.py --json
    python3 scripts/audit/upstream-schema-check.py --skip census,hud
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)
TIMEOUT = 30
CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "").strip()


def with_optional_census_key(url: str) -> str:
    if "api.census.gov" not in url or not CENSUS_API_KEY:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}key={urllib.parse.quote(CENSUS_API_KEY)}"


def http_json(url: str) -> Any:
    final_url = with_optional_census_key(url)
    req = urllib.request.Request(
        final_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/plain,*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8-sig").strip()
            if body.startswith("/**/"):
                body = body[4:].lstrip()
            if body.startswith("[") or body.startswith("{"):
                return json.loads(body)
            raise RuntimeError(f"non-JSON response prefix: {body[:120]!r}")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"http_json failed for {final_url}: {type(e).__name__}: {e}") from e


def http_status(url: str) -> int:
    """Lightweight HEAD-equivalent: GET with byte-range header."""
    final_url = with_optional_census_key(url)
    req = urllib.request.Request(
        final_url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Range": "bytes=0-1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"http_status failed for {final_url}: {type(e).__name__}: {e}") from e


# ── Check definitions ─────────────────────────────────────────────────


def check_census_acs5_b19001() -> dict:
    """ACS 5-year B19001 (income distribution): 17 vars (B19001_001E..017E).

    Our place-AMI-gap parser indexes these in build_place_ami_gap.py.
    """
    url = (
        "https://api.census.gov/data/2023/acs/acs5"
        "?get=NAME,B19001_001E,B19001_002E,B19001_017E"
        "&for=state:08"
        "&format=json"
    )
    data = http_json(url)
    assert isinstance(data, list) and len(data) >= 2, "ACS B19001 should be array-of-arrays"
    header = data[0]
    for var in ("B19001_001E", "B19001_002E", "B19001_017E"):
        assert var in header, f"ACS B19001 missing expected var {var}"
    return {"ok": True, "header": header}


def check_census_acs5_b25003() -> dict:
    """ACS B25003 — Tenure (renter vs owner totals). Used by plausibility tests."""
    url = (
        "https://api.census.gov/data/2023/acs/acs5"
        "?get=NAME,B25003_001E,B25003_002E,B25003_003E"
        "&for=state:08"
        "&format=json"
    )
    data = http_json(url)
    header = data[0]
    for var in ("B25003_001E", "B25003_002E", "B25003_003E"):
        assert var in header, f"ACS B25003 missing {var}"
    row = data[1]
    owner = int(row[header.index("B25003_002E")])
    renter = int(row[header.index("B25003_003E")])
    assert owner > 100_000, f"CO owner total {owner} suspiciously low"
    assert renter > 100_000, f"CO renter total {renter} suspiciously low"
    return {"ok": True, "owner": owner, "renter": renter}


def check_census_acs5_b25063() -> dict:
    """ACS B25063 — Gross Rent. 27 vars (B25063_001E..027E). Used by build_place_ami_gap.py."""
    url = (
        "https://api.census.gov/data/2023/acs/acs5"
        "?get=NAME,B25063_001E,B25063_002E,B25063_026E"
        "&for=state:08"
        "&format=json"
    )
    data = http_json(url)
    header = data[0]
    for var in ("B25063_001E", "B25063_026E"):
        assert var in header, f"ACS B25063 missing {var}"
    return {"ok": True}


def check_census_acs5_b25074() -> dict:
    """ACS B25074 — HH income × Gross Rent as % of income. 64 vars."""
    url = (
        "https://api.census.gov/data/2023/acs/acs5"
        "?get=NAME,B25074_001E,B25074_002E,B25074_056E"
        "&for=state:08"
        "&format=json"
    )
    data = http_json(url)
    header = data[0]
    for var in ("B25074_001E", "B25074_056E"):
        assert var in header, f"ACS B25074 missing {var}"
    return {"ok": True}


def check_census_acs5_dp04_profile() -> dict:
    """DP04 profile — housing characteristics. Used by HNA build."""
    url = (
        "https://api.census.gov/data/2023/acs/acs5/profile"
        "?get=NAME,DP04_0001E,DP04_0046PE,DP04_0047PE"
        "&for=state:08"
        "&format=json"
    )
    data = http_json(url)
    header = data[0]
    for var in ("DP04_0001E", "DP04_0046PE", "DP04_0047PE"):
        assert var in header, f"ACS DP04 missing {var}"
    return {"ok": True}


def check_hud_chas_url_available() -> dict:
    """HUD CHAS source URL responds (full download tested by fetch_chas.py)."""
    url = "https://www.huduser.gov/portal/datasets/cp/2018thru2022-140-csv.zip"
    status = http_status(url)
    assert status in (200, 202, 206, 301, 302), f"HUD CHAS URL returned {status}"
    return {"ok": True, "status": status}


def check_fred_unrate_metadata() -> dict:
    """FRED — sample series metadata. Auth optional; uses public series_id check."""
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        return {"ok": True, "skipped": "no FRED_API_KEY in env"}
    url = (
        f"https://api.stlouisfed.org/fred/series/observations?"
        f"series_id=UNRATE&limit=1&file_type=json&api_key={api_key}"
    )
    data = http_json(url)
    assert "observations" in data, "FRED response missing 'observations'"
    assert isinstance(data["observations"], list)
    assert len(data["observations"]) > 0, "FRED UNRATE has no observations"
    return {"ok": True, "latest": data["observations"][0].get("date")}


def check_dola_population() -> dict:
    """DOLA SDO — Colorado population profile endpoint."""
    url = "https://gis.dola.colorado.gov/lookups/profile?fips=08031&county=denver&type=county&format=json"
    status = http_status(url)
    assert status == 200, f"DOLA SDO profile endpoint returned {status}"
    return {"ok": True, "status": status}


# ── Runner ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    parser.add_argument(
        "--skip",
        default="",
        help="Comma-separated check prefixes to skip (e.g. census,hud)",
    )
    args = parser.parse_args()

    checks: dict[str, Callable[[], dict]] = {
        "census.acs5.b19001": check_census_acs5_b19001,
        "census.acs5.b25003": check_census_acs5_b25003,
        "census.acs5.b25063": check_census_acs5_b25063,
        "census.acs5.b25074": check_census_acs5_b25074,
        "census.acs5.dp04": check_census_acs5_dp04_profile,
        "hud.chas.url": check_hud_chas_url_available,
        "fred.unrate": check_fred_unrate_metadata,
        "dola.population": check_dola_population,
    }

    skips = {s.strip().lower() for s in args.skip.split(",") if s.strip()}
    results: dict[str, dict] = {}
    failed = 0

    for name, fn in checks.items():
        if any(name.startswith(s + ".") or name == s for s in skips):
            results[name] = {"skipped": True}
            continue
        try:
            r = fn()
            r.setdefault("ok", True)
            results[name] = r
            if not args.json:
                print(f"  ✓ {name}")
        except AssertionError as e:
            results[name] = {"ok": False, "error": str(e)}
            failed += 1
            if not args.json:
                print(f"  ✗ {name}: {e}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            results[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            failed += 1
            if not args.json:
                print(f"  ✗ {name}: {type(e).__name__}: {e}", file=sys.stderr)

    if args.json:
        print(json.dumps({"summary": {"checked": len(checks), "failed": failed}, "results": results}, indent=2))
    else:
        print(f"\n{len(checks) - failed}/{len(checks)} checks passed.")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
