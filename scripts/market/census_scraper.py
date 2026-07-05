#!/usr/bin/env python3
"""
scripts/market/census_scraper.py

Dynamically locates and returns the latest Census Cartographic Boundary
GeoJSON file URL for Colorado census tracts.

The Census Bureau publishes these at:
  https://www2.census.gov/geo/tiger/GENZ{year}/json/cb_{year}_08_tract_500k.json

The year in the URL changes with each data vintage release.  This scraper
tries recent vintages newest-first so the build pipeline never breaks on a
stale hardcoded URL.

Usage (standalone):
    python scripts/market/census_scraper.py

Returns (stdout):
    The first URL that returns HTTP 200, or exits non-zero if none found.

Usage (as library):
    from scripts.market.census_scraper import find_census_cb_url
    url = find_census_cb_url()   # raises RuntimeError if none found
"""

import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Candidate years, newest first.  We probe starting from the current year
# and look back 5 years to stay robust across data vintage releases.
_CURRENT_YEAR = datetime.now(timezone.utc).year
_CANDIDATE_YEARS = list(range(_CURRENT_YEAR, _CURRENT_YEAR - 6, -1))

_CB_URL_TEMPLATE = (
    "https://www2.census.gov/geo/tiger/GENZ{year}/json/cb_{year}_08_tract_500k.json"
)


def _url_for_year(year: int) -> str:
    # The census.gov WAF hard-blocks some URL signatures (hangs or returns
    # "Request Rejected" HTML at HTTP 200 — see the BPS permits pipeline,
    # which hit the same wall on www2.census.gov). Appending a harmless
    # query string changes the signature and gets through, so the probe AND
    # the URL we hand to the builder both carry ?dl=1.
    return _CB_URL_TEMPLATE.format(year=year) + "?dl=1"


def probe_url(url: str, timeout: int = 10) -> bool:
    """Return True if the URL serves what looks like GeoJSON.

    Uses a ranged GET rather than HEAD: the census.gov WAF is more likely
    to drop HEAD requests, and a 200 alone is not proof — the WAF returns
    "Request Rejected" HTML with HTTP 200, so we check the payload starts
    like a JSON document.
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) pma-build/1.0"
                ),
                "Range": "bytes=0-255",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status not in (200, 206):
                return False
            head = resp.read(256).lstrip()
            return head.startswith(b"{")
    except urllib.error.HTTPError:
        return False
    except Exception:
        return False


def find_census_cb_url(timeout: int = 10) -> str:
    """Return the URL of the most recent available Census Cartographic
    Boundary GeoJSON for Colorado census tracts (500k resolution).

    Tries vintages from newest to oldest, probing each with a HEAD request.

    Parameters
    ----------
    timeout : int
        Per-request timeout in seconds (default 10).

    Returns
    -------
    str
        A URL that responded HTTP 200.

    Raises
    ------
    RuntimeError
        If none of the candidate URLs are reachable.
    """
    for year in _CANDIDATE_YEARS:
        url = _url_for_year(year)
        print(f"[census_scraper] Probing {url} …", flush=True)
        if probe_url(url, timeout=timeout):
            print(f"[census_scraper] Found: {url}", flush=True)
            return url
    raise RuntimeError(
        f"Census Cartographic Boundary file not found for any candidate year "
        f"({_CANDIDATE_YEARS[0]}–{_CANDIDATE_YEARS[-1]}). "
        "Check https://www2.census.gov/geo/tiger/ for the latest available vintage."
    )


if __name__ == "__main__":
    try:
        url = find_census_cb_url()
        print(url)
        sys.exit(0)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
