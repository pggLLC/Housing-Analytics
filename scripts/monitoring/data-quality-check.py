#!/usr/bin/env python3
"""
Data Quality Check — Housing Analytics
=======================================
Validates all data artifacts produced by the workflow pipelines.
Can be run locally or in CI after any fetch/build step.

Usage:
    python3 scripts/monitoring/data-quality-check.py [--json] [--min-features N]

Exit codes:
    0  All checks passed (or only warnings)
    1  One or more critical checks failed
"""

import json
import os
import sys
import datetime
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # repo root

# ---------------------------------------------------------------------------
# Artifact definitions
# key → { path, type, min_records, required }
# type: "geojson" | "json_array" | "json_object" | "fred" | "any_json"
# ---------------------------------------------------------------------------
ARTIFACTS = {
    "qct-colorado": {
        "path": "data/qct-colorado.json",
        "type": "geojson",
        "min_features": 1,
        "required": True,
    },
    "dda-colorado": {
        "path": "data/dda-colorado.json",
        "type": "geojson",
        "min_features": 1,
        "required": True,
    },
    "fred-data": {
        "path": "data/fred-data.json",
        "type": "fred",
        "min_series": 1,
        "required": True,
    },
    "tract-centroids-co": {
        "path": "data/market/tract_centroids_co.json",
        "type": "json_object",
        "required": True,
    },
    "acs-tract-metrics-co": {
        "path": "data/market/acs_tract_metrics_co.json",
        "type": "json_object",
        "required": True,
    },
    "hud-lihtc-co": {
        "path": "data/market/hud_lihtc_co.geojson",
        "type": "geojson",
        "min_features": 1,
        "required": True,
    },
    "kalshi-prediction-market": {
        "path": "data/kalshi/prediction-market.json",
        "type": "any_json",
        "required": False,
    },
    "manifest": {
        "path": "data/manifest.json",
        "type": "any_json",
        "required": False,
    },
}


def _load_json(path: Path):
    """Load JSON file; return (data, error_message)."""
    try:
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return None, "zero-byte / empty file"
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"
    except OSError as exc:
        return None, f"read error: {exc}"


def check_artifact(name: str, spec: dict) -> dict:
    """Run all checks for one artifact. Returns a result dict."""
    result = {
        "name": name,
        "path": spec["path"],
        "required": spec.get("required", False),
        "status": "ok",
        "issues": [],
        "info": {},
    }

    path = ROOT / spec["path"]

    # ── existence ──────────────────────────────────────────────────────────
    if not path.exists():
        level = "critical" if spec.get("required") else "warning"
        result["status"] = level
        result["issues"].append(f"[{level.upper()}] File not found: {spec['path']}")
        return result

    # ── size ───────────────────────────────────────────────────────────────
    size = path.stat().st_size
    result["info"]["bytes"] = size
    if size == 0:
        result["status"] = "critical"
        result["issues"].append(f"[CRITICAL] Zero-byte file: {spec['path']}")
        return result

    # ── JSON validity ──────────────────────────────────────────────────────
    data, err = _load_json(path)
    if err:
        result["status"] = "critical"
        result["issues"].append(f"[CRITICAL] {err}")
        return result

    artifact_type = spec.get("type", "any_json")

    # ── GeoJSON checks ─────────────────────────────────────────────────────
    if artifact_type == "geojson":
        if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
            result["status"] = "critical"
            result["issues"].append("[CRITICAL] Not a valid FeatureCollection")
            return result
        features = data.get("features")
        if not isinstance(features, list):
            result["status"] = "critical"
            result["issues"].append("[CRITICAL] Missing 'features' array")
            return result
        count = len(features)
        result["info"]["feature_count"] = count
        min_f = spec.get("min_features", 0)
        if count < min_f:
            result["status"] = "warning"
            result["issues"].append(
                f"[WARNING] Only {count} features (expected ≥ {min_f})"
            )
        elif count == 0:
            result["status"] = "warning"
            result["issues"].append("[WARNING] Empty FeatureCollection (0 features)")

    # ── FRED data checks ───────────────────────────────────────────────────
    elif artifact_type == "fred":
        if not isinstance(data, dict):
            result["status"] = "critical"
            result["issues"].append("[CRITICAL] FRED data is not a JSON object")
            return result
        series = data.get("series", {})
        if not isinstance(series, dict):
            result["status"] = "critical"
            result["issues"].append("[CRITICAL] FRED data missing 'series' object")
            return result
        result["info"]["series_count"] = len(series)
        result["info"]["updated"] = data.get("updated", "unknown")
        empty_series = [k for k, v in series.items() if not v.get("observations")]
        if empty_series:
            result["status"] = "warning"
            result["issues"].append(
                f"[WARNING] {len(empty_series)} series with no observations: "
                + ", ".join(empty_series[:5])
                + ("…" if len(empty_series) > 5 else "")
            )
        min_s = spec.get("min_series", 1)
        if len(series) < min_s:
            result["status"] = "critical"
            result["issues"].append(
                f"[CRITICAL] Only {len(series)} series (expected ≥ {min_s})"
            )

    # ── Generic JSON object ────────────────────────────────────────────────
    elif artifact_type == "json_object":
        if not isinstance(data, dict):
            result["status"] = "warning"
            result["issues"].append("[WARNING] Expected a JSON object at root")

    return result


def run_checks(artifacts: dict, verbose: bool = True) -> list:
    """Run all artifact checks and return results list."""
    results = []
    for name, spec in artifacts.items():
        r = check_artifact(name, spec)
        results.append(r)
        if verbose:
            icon = {"ok": "✅", "warning": "⚠️ ", "critical": "❌"}.get(
                r["status"], "❓"
            )
            info_str = "  ".join(f"{k}={v}" for k, v in r["info"].items())
            print(f"{icon} {r['path']}" + (f"  ({info_str})" if info_str else ""))
            for issue in r["issues"]:
                print(f"     {issue}")
    return results


def build_summary(results: list) -> dict:
    ok = sum(1 for r in results if r["status"] == "ok")
    warnings = sum(1 for r in results if r["status"] == "warning")
    critical = sum(1 for r in results if r["status"] == "critical")
    return {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "total": len(results),
        "ok": ok,
        "warnings": warnings,
        "critical": critical,
        "passed": critical == 0,
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="Data quality check for Housing Analytics")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    parser.add_argument(
        "--min-features",
        type=int,
        default=None,
        help="Override minimum feature count for GeoJSON artifacts",
    )
    args = parser.parse_args()

    if args.min_features is not None:
        for spec in ARTIFACTS.values():
            if spec.get("type") == "geojson":
                spec["min_features"] = args.min_features

    if not args.json:
        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        print("=" * 60)
        print("  Housing Analytics — Data Quality Check")
        print(f"  {now_str}")
        print("=" * 60)
        print()

    results = run_checks(ARTIFACTS, verbose=not args.json)
    summary = build_summary(results)

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print()
        print("-" * 60)
        print(f"  Total : {summary['total']}")
        print(f"  ✅ OK      : {summary['ok']}")
        print(f"  ⚠️  Warnings : {summary['warnings']}")
        print(f"  ❌ Critical : {summary['critical']}")
        print("-" * 60)
        if summary["passed"]:
            print("  All critical checks passed ✅")
        else:
            print("  One or more critical checks FAILED ❌")
        print()

    sys.exit(0 if summary["passed"] else 1)


if __name__ == "__main__":
    main()
