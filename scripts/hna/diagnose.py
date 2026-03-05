#!/usr/bin/env python3
"""HNA pre-build diagnostics.

Checks connectivity to each API endpoint, validates the Python environment,
and reports disk space before the main build runs.

Exit code 0 — all checks passed (warnings may exist).
Exit code 1 — a critical check failed (build will likely fail).
"""

from __future__ import annotations

import os
import shutil
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Endpoints to probe
# ---------------------------------------------------------------------------

STATE_FIPS_CO = "08"
ACS_YEAR = int(os.environ.get("ACS_START_YEAR", "2024"))
LODES_YEAR = os.environ.get("LODES_YEAR", "2022").strip() or "2022"
CENSUS_KEY = os.environ.get("CENSUS_API_KEY", "").strip()

ENDPOINTS: list[dict] = [
    {
        "label": "Census ACS 5-year profile (county)",
        "url": (
            f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5/profile"
            f"?get=NAME&for=county:077&in=state:{STATE_FIPS_CO}"
            + (f"&key={CENSUS_KEY}" if CENSUS_KEY else "")
        ),
        "critical": True,
    },
    {
        "label": "Census ACS 5-year place names (state)",
        "url": (
            f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
            f"?get=NAME&for=place:*&in=state:{STATE_FIPS_CO}"
            + (f"&key={CENSUS_KEY}" if CENSUS_KEY else "")
        ),
        "critical": True,
    },
    {
        "label": "TIGERweb county list (Colorado)",
        "url": (
            "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query"
            f"?where=STATEFP%3D%2708%27&outFields=NAME%2CGEOID&returnGeometry=false&f=json"
        ),
        "critical": True,
    },
    {
        "label": f"LEHD LODES8 OD file ({LODES_YEAR})",
        "url": (
            f"https://lehd.ces.census.gov/data/lodes/LODES8/co/od/"
            f"co_od_main_JT00_{LODES_YEAR}.csv.gz"
        ),
        "critical": False,
        "head_only": True,
    },
    {
        "label": "DOLA/SDO single-year-of-age county CSV",
        "url": "https://storage.googleapis.com/co-publicdata/sya-county.csv",
        "critical": False,
        "head_only": True,
    },
    {
        "label": "DOLA/SDO county components-of-change CSV",
        "url": "https://storage.googleapis.com/co-publicdata/components-change-county.csv",
        "critical": False,
        "head_only": True,
    },
    {
        "label": "DOLA/SDO county profiles CSV",
        "url": "https://storage.googleapis.com/co-publicdata/profiles-county.csv",
        "critical": False,
        "head_only": True,
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _redact(s: str) -> str:
    if CENSUS_KEY:
        s = s.replace(CENSUS_KEY, "***CENSUS_API_KEY***")
    return s


def _probe(url: str, head_only: bool = False, timeout: int = 20) -> tuple[int, str]:
    """Return (status_code, info_string)."""
    method = "HEAD" if head_only else "GET"
    try:
        req = urllib.request.Request(url, method=method, headers={"User-Agent": "HNA-Diag/1.0"})
        t0 = time.monotonic()
        with urllib.request.urlopen(req, timeout=timeout) as r:
            elapsed = time.monotonic() - t0
            if head_only:
                content_length = r.headers.get("Content-Length", "unknown")
                return (r.status, f"{elapsed:.1f}s  Content-Length: {content_length}")
            preview = r.read(256).decode("utf-8", errors="replace").replace("\n", " ")
            elapsed = time.monotonic() - t0
            return (r.status, f"{elapsed:.1f}s  preview: {preview[:120]}")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(256).decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return (e.code, body[:200])
    except Exception as exc:
        return (0, str(exc)[:200])


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_python_env() -> bool:
    """Verify Python version and required stdlib modules."""
    print("\n[Python environment]")
    print(f"  Python: {sys.version}")
    required = ["csv", "gzip", "io", "json", "os", "sys", "time", "urllib.request"]
    missing = []
    for mod in required:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        print(f"  ✗ Missing modules: {missing}", file=sys.stderr)
        return False
    print(f"  ✓ All required stdlib modules present")
    return True


def check_census_key() -> bool:
    """Report whether CENSUS_API_KEY is set."""
    print("\n[CENSUS_API_KEY]")
    if CENSUS_KEY:
        masked = CENSUS_KEY[:4] + "***" + CENSUS_KEY[-2:] if len(CENSUS_KEY) > 6 else "***"
        print(f"  ✓ Set  (masked: {masked}  length: {len(CENSUS_KEY)})")
        return True
    print("  ⚠ Not set — unauthenticated Census requests may be rate-limited or fail",
          file=sys.stderr)
    return True  # warning, not fatal


def check_disk_space() -> bool:
    """Ensure at least 500 MB free on the working volume."""
    print("\n[Disk space]")
    total, used, free = shutil.disk_usage("/")
    free_mb = free // (1024 * 1024)
    print(f"  Total: {total // (1024**2):,} MB   Used: {used // (1024**2):,} MB   Free: {free_mb:,} MB")
    if free_mb < 500:
        print(f"  ✗ Less than 500 MB free ({free_mb} MB)", file=sys.stderr)
        return False
    print(f"  ✓ Sufficient disk space")
    return True


def check_endpoints() -> bool:
    """Probe all API endpoints and report results."""
    print("\n[API endpoint connectivity]")
    any_critical_failed = False
    for ep in ENDPOINTS:
        label = ep["label"]
        url = ep["url"]
        critical = ep.get("critical", False)
        head_only = ep.get("head_only", False)
        status, info = _probe(url, head_only=head_only)
        if status == 200:
            print(f"  ✓ [{status}] {label}  ({info})")
        else:
            icon = "✗" if critical else "⚠"
            print(f"  {icon} [{status}] {label}  ({info})", file=sys.stderr)
            print(f"      URL: {_redact(url)}", file=sys.stderr)
            if critical:
                any_critical_failed = True
    return not any_critical_failed


def check_output_dirs() -> bool:
    """Verify we can write to the expected output directories."""
    print("\n[Output directories]")
    import tempfile

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dirs_to_check = [
        os.path.join(repo_root, "data", "hna"),
        os.path.join(repo_root, "data", "hna", "summary"),
        os.path.join(repo_root, "data", "hna", "lehd"),
        os.path.join(repo_root, "data", "hna", "dola_sya"),
        os.path.join(repo_root, "data", "hna", "projections"),
        os.path.join(repo_root, "data", "hna", "source"),
    ]
    all_ok = True
    for d in dirs_to_check:
        os.makedirs(d, exist_ok=True)
        try:
            tmp = tempfile.NamedTemporaryFile(dir=d, delete=True)
            tmp.close()
            print(f"  ✓ writable: {d}")
        except Exception as exc:
            print(f"  ✗ not writable: {d}: {exc}", file=sys.stderr)
            all_ok = False
    return all_ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 60)
    print("HNA Build Diagnostics")
    print("=" * 60)

    results = {
        "python_env": check_python_env(),
        "census_key": check_census_key(),
        "disk_space": check_disk_space(),
        "endpoints": check_endpoints(),
        "output_dirs": check_output_dirs(),
    }

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    all_passed = True
    for name, ok in results.items():
        icon = "✓" if ok else "✗"
        print(f"  {icon} {name}")
        if not ok:
            all_passed = False

    if all_passed:
        print("\nAll checks passed — proceeding with build.")
        return 0
    else:
        print("\n⚠ One or more checks failed — build may produce empty/incomplete output.",
              file=sys.stderr)
        # Non-zero only when a truly critical check fails
        critical_failed = not results["python_env"] or not results["disk_space"] or not results["output_dirs"]
        return 1 if critical_failed else 0


if __name__ == "__main__":
    sys.exit(main())
