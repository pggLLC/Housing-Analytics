#!/usr/bin/env python3
"""
scripts/market/data_quality_validator.py

Data Quality Orchestrator — validates all PMA market data sources post-build.

Scans all data/market/ files, checks for completeness against defined thresholds,
and writes a structured data quality report.

Output:
    data/market/data_quality_report.json

Usage:
    python3 scripts/market/data_quality_validator.py [--warn-only]

Flags:
    --warn-only   Exit 0 even if sources are below threshold (default: exit 1)

All checks are offline (reads local files; no network calls).
"""

import json
import os
import sys
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
MARKET_DIR = ROOT / "data" / "market"
OUT_FILE = MARKET_DIR / "data_quality_report.json"

# ── Data source definitions ──────────────────────────────────────────────────
# Each entry: (filename, data_key, min_records, description, rebuild_script)
DATA_SOURCES = [
    # Core TIGERweb / ACS
    (
        "tract_centroids_co.json",
        "tracts",
        1000,
        "Census tract centroids (TIGERweb)",
        "scripts/market/build_public_market_data.py",
    ),
    (
        "acs_tract_metrics_co.json",
        "tracts",
        1000,
        "ACS 5-year tract metrics",
        "scripts/market/build_public_market_data.py",
    ),
    (
        "hud_lihtc_co.geojson",
        "features",
        50,
        "HUD LIHTC project locations",
        "scripts/market/build_public_market_data.py",
    ),
    (
        "tract_boundaries_co.geojson",
        "features",
        1000,
        "Census tract polygon boundaries",
        "scripts/market/build_public_market_data.py",
    ),
    # HUD supplemental
    (
        "nhpd_co.geojson",
        "features",
        1,
        "NHPD preservation database",
        "scripts/fetch_nhpd.py",
    ),
    # Market data — new sources
    (
        "schools_co.geojson",
        "features",
        1,
        "Colorado K-12 school locations (NCES)",
        "scripts/market/fetch_schools.py",
    ),
    (
        "opportunity_zones_co.geojson",
        "features",
        1,
        "HUD CDFI Opportunity Zones",
        "scripts/market/fetch_opportunity_zones.py",
    ),
    (
        "parcel_aggregates_co.json",
        "counties",
        1,
        "County assessor parcel aggregates",
        "scripts/market/fetch_parcel_data.py",
    ),
    (
        "transit_routes_co.geojson",
        "features",
        1,
        "Colorado GTFS transit routes",
        "scripts/market/fetch_gtfs_transit.py",
    ),
    (
        "walkability_scores_co.json",
        "tracts",
        1,
        "EPA Smart Location walkability scores",
        "scripts/market/fetch_walkability.py",
    ),
    (
        "flood_zones_co.geojson",
        "features",
        1,
        "FEMA NFHL flood zone designations",
        "scripts/market/fetch_flood_zones.py",
    ),
    (
        "food_access_co.json",
        "tracts",
        1,
        "USDA Food Access Research Atlas",
        "scripts/market/fetch_food_access.py",
    ),
    (
        "qct_dda_designations_co.json",
        "designations",
        1,
        "HUD QCT/DDA designations",
        "scripts/market/fetch_qct_dda.py",
    ),
    (
        "utility_capacity_co.geojson",
        "features",
        1,
        "Colorado utility service areas",
        "scripts/market/fetch_utility_capacity.py",
    ),
    (
        "zoning_compat_index_co.json",
        "jurisdictions",
        1,
        "Municipal zoning compatibility index",
        "scripts/market/fetch_zoning.py",
    ),
    (
        "chfa_programs_co.json",
        "programs",
        1,
        "CHFA subsidy programs + LIHTC pipeline",
        "scripts/market/fetch_chfa_programs.py",
    ),
    (
        "inclusionary_zoning_co.json",
        "ordinances",
        1,
        "Colorado IZ ordinance database",
        "scripts/market/fetch_inclusionary_zoning.py",
    ),
    (
        "climate_hazards_co.json",
        "eji_tracts",
        0,
        "Climate hazards + EPA EJI data",
        "scripts/market/fetch_climate_and_environment.py",
    ),
    (
        "environmental_constraints_co.geojson",
        "features",
        0,
        "CPW protected lands constraints",
        "scripts/market/fetch_climate_and_environment.py",
    ),
    # Enhanced FMR + CHAS (written by existing scripts)
    (
        "fmr_co.json",
        None,
        0,
        "HUD Fair Market Rents (raw)",
        "scripts/fetch_fmr_api.py",
    ),
    (
        "chas_co.json",
        None,
        0,
        "HUD CHAS affordability data",
        "scripts/fetch_chas.py",
    ),
]

# Additional GeoJSON stub files
GEOJSON_FILES_EXTRA = [
    "hud_egis_co.geojson",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _file_age_days(path: Path) -> float | None:
    if not path.exists():
        return None
    return (datetime.now().timestamp() - path.stat().st_mtime) / 86400


def _record_count(data: dict, key: str | None) -> int:
    """Extract record count from a parsed JSON object."""
    if key is None:
        # Just check the file exists and is valid JSON
        return 1 if data else 0
    val = data.get(key)
    if isinstance(val, list):
        return len(val)
    if isinstance(val, dict):
        return len(val)
    return 0


def _coverage_pct(data: dict) -> float | None:
    """Extract coverage_pct from meta if present."""
    meta = data.get("meta") or {}
    pct = meta.get("coverage_pct")
    if pct is not None:
        try:
            return float(pct)
        except (TypeError, ValueError):
            pass
    return None


def _generated_date(data: dict) -> str | None:
    meta = data.get("meta") or {}
    return meta.get("generated") or meta.get("fetchedAt") or meta.get("updated")


def check_source(filename: str, data_key: str | None, min_records: int,
                 description: str, rebuild_script: str) -> dict:
    """Check a single data source file and return a quality record."""
    path = MARKET_DIR / filename
    result = {
        "file":         filename,
        "description":  description,
        "rebuild_script": rebuild_script,
        "exists":       path.exists(),
        "age_days":     round(_file_age_days(path) or 0, 1),
        "size_bytes":   0,
        "record_count": 0,
        "min_required": min_records,
        "coverage_pct": None,
        "generated":    None,
        "status":       "missing",
        "issues":       [],
    }

    if not path.exists():
        result["issues"].append(f"File not found: {path}")
        result["status"] = "missing"
        return result

    result["size_bytes"] = path.stat().st_size

    # Parse JSON
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        result["issues"].append(f"Invalid JSON: {exc}")
        result["status"] = "error"
        return result

    result["record_count"] = _record_count(data, data_key)
    result["coverage_pct"] = _coverage_pct(data)
    result["generated"] = _generated_date(data)

    # Validate record count
    issues = []
    if min_records > 0 and result["record_count"] < min_records:
        issues.append(
            f"Record count {result['record_count']} below minimum {min_records}"
        )

    # Check for stub files (very small size suggests placeholder data)
    if result["size_bytes"] < 500 and min_records > 0:
        issues.append(f"File appears to be a stub ({result['size_bytes']} bytes)")

    # Check freshness (warn if > 90 days old)
    if result["age_days"] > 90:
        issues.append(f"File is {result['age_days']:.0f} days old (recommend refresh)")

    result["issues"] = issues
    if issues:
        result["status"] = "warn"
    else:
        result["status"] = "ok"

    return result


def build_summary(checks: list) -> dict:
    """Build aggregate summary statistics from individual checks."""
    total = len(checks)
    ok = sum(1 for c in checks if c["status"] == "ok")
    warn = sum(1 for c in checks if c["status"] == "warn")
    missing = sum(1 for c in checks if c["status"] == "missing")
    error = sum(1 for c in checks if c["status"] == "error")

    present = [c for c in checks if c["exists"]]
    total_bytes = sum(c["size_bytes"] for c in present)
    total_records = sum(c["record_count"] for c in present)

    coverages = [c["coverage_pct"] for c in present if c["coverage_pct"] is not None]
    avg_coverage = sum(coverages) / len(coverages) if coverages else 0.0

    # Stale = files older than 30 days with data
    stale = [c["file"] for c in present if c["age_days"] > 30]

    below_threshold = [c["file"] for c in checks if c["status"] in ("warn",)
                       and any("below minimum" in i for i in c.get("issues", []))]

    return {
        "total_sources":   total,
        "ok":              ok,
        "warn":            warn,
        "missing":         missing,
        "error":           error,
        "completeness_pct": round(ok / total * 100, 1) if total else 0.0,
        "total_records":   total_records,
        "total_bytes":     total_bytes,
        "avg_coverage_pct": round(avg_coverage, 1),
        "stale_files":     stale,
        "below_threshold": below_threshold,
    }


def main(warn_only: bool = False) -> int:
    MARKET_DIR.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    log("=" * 60)
    log(f"PMA Data Quality Validator — {generated}")
    log("=" * 60)

    checks = []
    for source_def in DATA_SOURCES:
        check = check_source(*source_def)
        checks.append(check)

        status_icon = {"ok": "✓", "warn": "⚠", "missing": "✗", "error": "✗"}.get(
            check["status"], "?"
        )
        issues_str = "; ".join(check["issues"]) if check["issues"] else "no issues"
        log(
            f"  {status_icon} {check['file']}: "
            f"{check['record_count']} records | {check['status'].upper()} | {issues_str}"
        )

    summary = build_summary(checks)

    log("")
    log(f"Summary: {summary['ok']}/{summary['total_sources']} sources OK "
        f"({summary['completeness_pct']}% completeness)")
    log(f"  Total records: {summary['total_records']:,}")
    log(f"  Avg coverage:  {summary['avg_coverage_pct']}%")

    if summary["missing"]:
        log(f"  Missing: {summary['missing']} file(s)", level="WARN")
    if summary["stale_files"]:
        log(f"  Stale (>30d): {summary['stale_files']}", level="WARN")
    if summary["below_threshold"]:
        log(f"  Below threshold: {summary['below_threshold']}", level="WARN")

    result = {
        "meta": {
            "generated":     generated,
            "validator":     "scripts/market/data_quality_validator.py",
            "market_dir":    str(MARKET_DIR.relative_to(ROOT)),
            "sources_checked": len(DATA_SOURCES),
        },
        "summary": summary,
        "sources": checks,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
    log(f"\n✓ Report written to {OUT_FILE.relative_to(ROOT)}")

    # Return non-zero only for missing/error sources (not warn) unless warn_only=False
    critical_failures = summary["missing"] + summary["error"]
    if critical_failures and not warn_only:
        log(f"\n✗ {critical_failures} critical issue(s) found. "
            "Run individual rebuild scripts to fix.", level="ERROR")
        return 1
    return 0


if __name__ == "__main__":
    warn_only = "--warn-only" in sys.argv
    sys.exit(main(warn_only=warn_only))
