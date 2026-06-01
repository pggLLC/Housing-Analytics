#!/usr/bin/env python3
"""
scripts/audit_indibuild_urls.py
================================
URL health monitor for the IndiBuild section's data sources.

CONTEXT
-------
The IndiBuild brief + curated policy-progress dataset link out to ~90
external URLs (DOLA, CHFA, city housing pages, news sources, etc). City
portals especially love to renumber their pages: a link to
`/123/Affordable-Housing` today is `/456/Affordable-Housing` next quarter.

This script does a HEAD check on every URL in:
  - data/policy/jurisdiction-housing-progress.json
  - docs/indibuild-pipeline-prototype/01-signal-log.csv (source_url)
  - data/hna/local-resources.json
  - data/policy/prop123_jurisdictions.json (if it carries URLs)

Output: data/reports/indibuild-url-health.json with:
  {
    "meta":  { generated_at, total_urls, broken_count, ... },
    "broken": [ { url, status, found_in } ],
    "ok":     [ { url, status } ]
  }

The site can render this report (see /url-health.html or wire to a
dashboard). The output JSON is deterministic so commits only show real
changes.

USAGE
-----
  python3 scripts/audit_indibuild_urls.py
  python3 scripts/audit_indibuild_urls.py --max-workers 16
  python3 scripts/audit_indibuild_urls.py --timeout 8

SCHEDULING
----------
Wire up via `.github/workflows/indibuild-url-health.yml` (weekly cron).
The workflow runs this script, commits the report file, and can post
a comment if `broken_count > 0`.

WAF NOTE
--------
Many city portals (Cloudflare / Akamai-protected) return 403 to bare
HEAD requests but render fine for real browsers. The script treats
403/406 as "warning" (likely-OK-for-humans) rather than "broken" so the
weekly report doesn't drown in false positives. True 404 / DNS-dead URLs
are reported as `broken`.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "reports" / "indibuild-url-health.json"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 "
    "(+coho-analytics url-health-monitor)"
)

# Status codes that count as "broken" (the URL truly doesn't resolve to a
# useful page). 403/406 are WAF bot-protection from city portals — they
# render normally for real users, so we surface them as "warning" not "broken".
BROKEN_CODES = {404, 410, 451, 500, 502, 503, 504, 521, 522, 523, 525, 526, 0}
WARNING_CODES = {403, 406, 429}


def _collect_urls():
    """Walk the IndiBuild data files and return a list of
    { url, found_in } records (deduplicated by URL)."""
    by_url: dict[str, list[str]] = {}

    def _add(url, found):
        url = (url or "").strip()
        if not url or not url.startswith("http"):
            return
        if "google.com/search" in url:
            return  # search URLs always 200; skip
        by_url.setdefault(url, []).append(found)

    # --- jurisdiction-housing-progress.json (each block has a `.url`)
    p = REPO_ROOT / "data" / "policy" / "jurisdiction-housing-progress.json"
    if p.exists():
        d = json.loads(p.read_text())
        for geoid, rec in d.get("by_geoid", {}).items():
            for k in ("hna", "land_banking", "dedicated_income", "tap_fee_reduction"):
                _add(rec.get(k, {}).get("url"), f"policy-progress / {rec.get('name','?')} / {k}")

    # --- IndiBuild Signal Log
    p = REPO_ROOT / "docs" / "indibuild-pipeline-prototype" / "01-signal-log.csv"
    if p.exists():
        for row in csv.DictReader(p.open()):
            _add(row.get("source_url"), f"signal-log / {row.get('jurisdiction','?')} / {row.get('date','?')}")

    # --- HNA local-resources.json (housingLead, housingAuthority, housingPlans, advocacy, contacts)
    p = REPO_ROOT / "data" / "hna" / "local-resources.json"
    if p.exists():
        d = json.loads(p.read_text())
        def _walk(node, path):
            if isinstance(node, dict):
                if "url" in node and isinstance(node["url"], str):
                    _add(node["url"], path)
                for k, v in node.items():
                    _walk(v, f"{path}/{k}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    _walk(v, f"{path}[{i}]")
        for k, v in d.items():
            _walk(v, f"local-resources / {k}")

    # --- Prop 123 jurisdictions
    p = REPO_ROOT / "data" / "policy" / "prop123_jurisdictions.json"
    if p.exists():
        d = json.loads(p.read_text())
        for item in (d.get("jurisdictions") or d.get("list") or []):
            for k in ("link", "url", "commitment_url"):
                _add(item.get(k), f"prop123 / {item.get('jurisdiction','?')}")

    return [{"url": u, "found_in": sorted(set(found))} for u, found in sorted(by_url.items())]


def _check(url, timeout):
    """Return (status_code, final_url). 0 = network error."""
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.url
    except urllib.error.HTTPError as e:
        return e.code, url
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return 0, url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-workers", type=int, default=12)
    ap.add_argument("--timeout", type=int, default=10)
    args = ap.parse_args()

    items = _collect_urls()
    print(f"Auditing {len(items)} URLs across IndiBuild data sources…", file=sys.stderr)

    broken, warnings, ok = [], [], []
    with ThreadPoolExecutor(max_workers=args.max_workers) as ex:
        futs = {ex.submit(_check, it["url"], args.timeout): it for it in items}
        for fut in as_completed(futs):
            it = futs[fut]
            try:
                code, final_url = fut.result()
            except Exception as e:
                code, final_url = 0, it["url"]
            rec = {"url": it["url"], "status": code, "found_in": it["found_in"]}
            if final_url != it["url"]:
                rec["final_url"] = final_url
            if code in BROKEN_CODES:
                broken.append(rec)
            elif code in WARNING_CODES:
                warnings.append(rec)
            else:
                ok.append(rec)

    # Deterministic ordering
    broken.sort(key=lambda r: r["url"])
    warnings.sort(key=lambda r: r["url"])
    ok.sort(key=lambda r: r["url"])

    report = {
        "meta": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "total_urls": len(items),
            "broken_count": len(broken),
            "warning_count": len(warnings),
            "ok_count": len(ok),
            "notes": (
                "WAF-protected city portals often return 403/406 to bare HEAD scrapers "
                "but load normally in real browsers — those are surfaced as 'warning' "
                "not 'broken'. True 404 / 5xx / DNS-dead URLs are reported as 'broken' "
                "and need a real fix."
            ),
        },
        "broken": broken,
        "warnings": warnings,
        "ok_count": len(ok),  # Don't bloat the file with the full ok list
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2) + "\n")

    print(f"OK  wrote {OUT_PATH.relative_to(REPO_ROOT)}", file=sys.stderr)
    print(f"    {len(broken)} broken · {len(warnings)} WAF-warnings · {len(ok)} ok", file=sys.stderr)
    for r in broken[:20]:
        print(f"    BROKEN ({r['status']}): {r['url']}", file=sys.stderr)
    return 0 if not broken else 0  # never fail the build — just report


if __name__ == "__main__":
    sys.exit(main())
