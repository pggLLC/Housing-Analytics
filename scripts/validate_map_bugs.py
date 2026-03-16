#!/usr/bin/env python3
"""
scripts/validate_map_bugs.py
----------------------------
Validates the Stage-6 map bug fixes and reports PASS / WARN / FAIL for each.

Checks
------
BUG-01  js/co-lihtc-map.js         – LIHTC_BASE URL uses lowercase /arcgis/
BUG-02  data/hna/lihtc/*.json       – Per-county files are non-empty stubs (≥1 feature in ≥1 file)
BUG-03  js/housing-needs-assessment.js – chfaLihtcQuery URL uses lowercase /arcgis/
BUG-04  js/prop123-map.js           – TIGER_PLACES uses MapServer/2
BUG-05  js/housing-needs-assessment.js – TIGERweb Places uses layer 2
BUG-06  data/market/               – ACS + centroid files have ≥ 100 tract records (WARN if sparse)
BUG-07  data/chfa-lihtc.json        – No YR_PIS=8888 sentinels; _metadata present
BUG-08a data/prop123_jurisdictions.json – Root duplicate absent
BUG-08b js/market-intelligence.js  – Uses policy/ path for prop123 data
BUG-08c js/market-analysis.js      – Uses policy/ path for prop123 data
BUG-09  js/path-resolver.js        – Uses /\\.\\w+$/.test() instead of indexOf('.')

Usage
-----
    python scripts/validate_map_bugs.py
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PASS_COUNT = 0
WARN_COUNT = 0
FAIL_COUNT = 0


def check(label, passed, message, warn_only=False):
    global PASS_COUNT, WARN_COUNT, FAIL_COUNT
    if passed:
        print(f"  ✅ PASS  {label}: {message}")
        PASS_COUNT += 1
    elif warn_only:
        print(f"  ⚠️  WARN  {label}: {message}")
        WARN_COUNT += 1
    else:
        print(f"  ❌ FAIL  {label}: {message}")
        FAIL_COUNT += 1


def read_text(rel_path):
    with open(os.path.join(ROOT, rel_path), encoding='utf-8') as f:
        return f.read()


def read_json(rel_path):
    with open(os.path.join(ROOT, rel_path), encoding='utf-8') as f:
        return json.load(f)


# ─── BUG-01 ──────────────────────────────────────────────────────────────────

def validate_bug_01():
    path = 'js/co-lihtc-map.js'
    try:
        content = read_text(path)
        bad = "/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer" in content
        good = "/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer" in content
        check("BUG-01", good and not bad, f"{path} LIHTC_BASE uses lowercase /arcgis/")
    except FileNotFoundError:
        check("BUG-01", False, f"{path} not found")


# ─── BUG-02 ──────────────────────────────────────────────────────────────────

def validate_bug_02():
    lihtc_dir = os.path.join(ROOT, 'data', 'hna', 'lihtc')
    try:
        files = [f for f in os.listdir(lihtc_dir) if f.endswith('.json')]
        check("BUG-02a", len(files) == 64, f"data/hna/lihtc/ has {len(files)} county files (expected 64)")
        non_empty = 0
        total_feats = 0
        for fname in files:
            try:
                d = read_json(f'data/hna/lihtc/{fname}')
                n = len(d.get('features', []))
                total_feats += n
                if n > 0:
                    non_empty += 1
            except Exception:
                pass
        check("BUG-02b", non_empty >= 44, f"{non_empty}/64 county files non-empty; {total_feats} total features")
    except FileNotFoundError:
        check("BUG-02a", False, "data/hna/lihtc/ directory not found")
        check("BUG-02b", False, "data/hna/lihtc/ directory not found")


# ─── BUG-03 ──────────────────────────────────────────────────────────────────

def validate_bug_03():
    path = 'js/housing-needs-assessment.js'
    try:
        content = read_text(path)
        bad = "/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer" in content
        good = "/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer" in content
        check("BUG-03", good and not bad, f"{path} chfaLihtcQuery uses lowercase /arcgis/")
    except FileNotFoundError:
        check("BUG-03", False, f"{path} not found")


# ─── BUG-04 ──────────────────────────────────────────────────────────────────

def validate_bug_04():
    path = 'js/prop123-map.js'
    try:
        content = read_text(path)
        bad = 'Places_CouSub_ConCity_SubMCD/MapServer/4' in content
        good = 'Places_CouSub_ConCity_SubMCD/MapServer/2' in content
        check("BUG-04", good and not bad, f"{path} TIGER_PLACES uses MapServer/2")
    except FileNotFoundError:
        check("BUG-04", False, f"{path} not found")


# ─── BUG-05 ──────────────────────────────────────────────────────────────────

def validate_bug_05():
    path = 'js/housing-needs-assessment.js'
    try:
        content = read_text(path)
        bad = "geoType === 'place' ? 4 : 5" in content
        good = "geoType === 'place' ? 2 : 5" in content
        check("BUG-05", good and not bad, f"{path} TIGERweb Places uses layer 2")
    except FileNotFoundError:
        check("BUG-05", False, f"{path} not found")


# ─── BUG-06 ──────────────────────────────────────────────────────────────────

def validate_bug_06():
    THRESHOLD = 100
    for fname, label in [
        ('data/market/acs_tract_metrics_co.json', 'ACS tract metrics'),
        ('data/market/tract_centroids_co.json',   'tract centroids'),
    ]:
        full = os.path.join(ROOT, fname)
        if not os.path.isfile(full):
            check("BUG-06", False, f"{fname} missing", warn_only=True)
            continue
        try:
            d = read_json(fname)
            tracts = d if isinstance(d, list) else d.get('features', d.get('tracts', []))
            n = len(tracts)
            check("BUG-06", n >= THRESHOLD,
                  f"{label}: {n} records (need ≥{THRESHOLD}; trigger build-market-data workflow if sparse)",
                  warn_only=(n < THRESHOLD))
        except Exception as exc:
            check("BUG-06", False, f"{fname}: {exc}", warn_only=True)


# ─── BUG-07 ──────────────────────────────────────────────────────────────────

def validate_bug_07():
    path = 'data/chfa-lihtc.json'
    try:
        d = read_json(path)
        bad_count = sum(
            1 for feat in d.get('features', [])
            if str((feat.get('properties') or {}).get('YR_PIS', '')) == '8888'
        )
        check("BUG-07a", bad_count == 0, f"chfa-lihtc.json has {bad_count} YR_PIS=8888 sentinels (expected 0)")
        has_meta = '_metadata' in d
        check("BUG-07b", has_meta, "chfa-lihtc.json has _metadata block")
    except FileNotFoundError:
        check("BUG-07a", False, f"{path} not found")
        check("BUG-07b", False, f"{path} not found")


# ─── BUG-08 ──────────────────────────────────────────────────────────────────

def validate_bug_08():
    # 08a — root duplicate gone
    root_dup = os.path.join(ROOT, 'data', 'prop123_jurisdictions.json')
    check("BUG-08a", not os.path.isfile(root_dup), "Root data/prop123_jurisdictions.json absent")

    # 08b — canonical file present
    canonical = os.path.join(ROOT, 'data', 'policy', 'prop123_jurisdictions.json')
    check("BUG-08b", os.path.isfile(canonical), "data/policy/prop123_jurisdictions.json present")

    # 08c — JS refs updated
    js_checks = [
        ('js/market-intelligence.js', "resolveData('policy/prop123_jurisdictions.json')",
         "resolveData('prop123_jurisdictions.json')"),
        ('js/market-analysis.js', "DS.baseData('policy/prop123_jurisdictions.json')",
         "DS.baseData('prop123_jurisdictions.json')"),
    ]
    for js_path, good_str, bad_str in js_checks:
        try:
            content = read_text(js_path)
            ok = good_str in content and bad_str not in content
            check("BUG-08c", ok, f"{js_path} uses policy/ path for prop123 data")
        except FileNotFoundError:
            check("BUG-08c", False, f"{js_path} not found")


# ─── BUG-09 ──────────────────────────────────────────────────────────────────

def validate_bug_09():
    path = 'js/path-resolver.js'
    # The fixed code replaces indexOf('.') with the JS regex /\.\w+$/.test(parts[0])
    GOOD_PATTERN = r'/\.\w+$/.test(parts[0])'
    BAD_PATTERN  = "parts[0].indexOf('.') !== -1"
    try:
        content = read_text(path)
        bad  = BAD_PATTERN in content
        good = GOOD_PATTERN in content
        check("BUG-09", good and not bad, f"{path} uses regex file-extension test instead of indexOf('.')")
    except FileNotFoundError:
        check("BUG-09", False, f"{path} not found")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=== Stage-6 Map Bug Validator ===\n")

    validate_bug_01()
    validate_bug_02()
    validate_bug_03()
    validate_bug_04()
    validate_bug_05()
    validate_bug_06()
    validate_bug_07()
    validate_bug_08()
    validate_bug_09()

    print()
    print("─" * 60)
    total = PASS_COUNT + WARN_COUNT + FAIL_COUNT
    print(f"Results: PASS={PASS_COUNT}  WARN={WARN_COUNT}  FAIL={FAIL_COUNT}  (of {total} checks)")

    if FAIL_COUNT > 0:
        print("\n❌ One or more checks failed. Run scripts/fix_map_bugs.py to repair.")
        sys.exit(1)
    elif WARN_COUNT > 0:
        print("\n⚠️  All critical checks passed. Warnings indicate optional/workflow-dependent data.")
    else:
        print("\n✅ All checks passed.")


if __name__ == '__main__':
    main()
