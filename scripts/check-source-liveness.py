#!/usr/bin/env python3
"""
Check jurisdiction-brief source URLs for URL rot.

The script intentionally exits 0 even when URLs are stale; callers should
interpret data/jurisdiction-briefs/_liveness.json rather than the process
status.
"""
from __future__ import annotations

import json
import socket
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
BRIEFS_DIR = ROOT / "data" / "jurisdiction-briefs"
OUT_PATH = BRIEFS_DIR / "_liveness.json"
USER_AGENT = "COHO-source-liveness/1.0 (+github.com/pggLLC/Housing-Analytics)"
TIMEOUT_SECONDS = 15


class RedirectLoop(Exception):
    pass


class TrackingRedirectHandler(HTTPRedirectHandler):
    """Small urllib handler that records final URLs and stops redirect loops."""

    max_repeats = 10
    max_redirections = 10

    def __init__(self) -> None:
        self.redirects: list[str] = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if len(self.redirects) >= self.max_redirections or newurl in self.redirects:
            raise RedirectLoop(newurl)
        self.redirects.append(newurl)
        return Request(newurl, headers=dict(req.header_items()), method=req.get_method())

    http_error_301 = http_error_302 = http_error_303 = http_error_307 = http_error_308 = redirect_request


def iter_sources() -> list[dict]:
    rows: list[dict] = []
    for path in sorted(BRIEFS_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            brief = json.loads(path.read_text())
        except Exception as exc:
            print(f"{path.name}\tread_error\t{exc}", file=sys.stderr)
            continue
        for source in brief.get("sources") or []:
            rows.append(
                {
                    "geoid": brief.get("geoid") or path.stem,
                    "jurisdiction": brief.get("jurisdiction") or "",
                    "source_id": source.get("id") or "",
                    "url": source.get("url") or "",
                }
            )
    return rows


def classify_error(exc: BaseException) -> str:
    if isinstance(exc, RedirectLoop):
        return "redirect_loop"
    if isinstance(exc, socket.timeout) or isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, URLError):
        reason = exc.reason
        if isinstance(reason, socket.timeout) or isinstance(reason, TimeoutError):
            return "timeout"
        if isinstance(reason, socket.gaierror):
            return "dns_failure"
        if isinstance(reason, ssl.SSLError):
            return "other"
    return "other"


def check_url(url: str, checked_at: str) -> dict:
    if not url:
        return {
            "status_code": None,
            "final_url": "",
            "last_checked": checked_at,
            "error_type": "other",
        }

    redirect_handler = TrackingRedirectHandler()
    opener = build_opener(redirect_handler)
    request = Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")

    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            status = int(response.getcode())
            final_url = response.geturl()
    except HTTPError as exc:
        status = int(exc.code)
        final_url = exc.geturl() or url
    except Exception as exc:
        return {
            "status_code": None,
            "final_url": redirect_handler.redirects[-1] if redirect_handler.redirects else url,
            "last_checked": checked_at,
            "error_type": classify_error(exc),
        }

    if 200 <= status < 300:
        error_type = "ok"
    elif 400 <= status < 500:
        error_type = "client_error"
    elif 500 <= status < 600:
        error_type = "server_error"
    else:
        error_type = "other"

    return {
        "status_code": status,
        "final_url": final_url,
        "last_checked": checked_at,
        "error_type": error_type,
    }


def main() -> int:
    checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    records = []
    counts = {
        "ok": 0,
        "redirect_loop": 0,
        "client_error": 0,
        "server_error": 0,
        "timeout": 0,
        "dns_failure": 0,
        "other": 0,
    }

    for source in iter_sources():
        result = check_url(source["url"], checked_at)
        row = {**source, **result}
        records.append(row)
        counts[row["error_type"]] = counts.get(row["error_type"], 0) + 1

    payload = {
        "summary": {
            "generated_at": checked_at,
            "total": len(records),
            **counts,
        },
        "records": records,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")

    summary = payload["summary"]
    print(
        "\t".join(
            [
                "source-liveness",
                f"total={summary['total']}",
                f"ok={summary['ok']}",
                f"client_error={summary['client_error']}",
                f"server_error={summary['server_error']}",
                f"timeout={summary['timeout']}",
                f"dns_failure={summary['dns_failure']}",
                f"redirect_loop={summary['redirect_loop']}",
                f"other={summary['other']}",
            ]
        ),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
