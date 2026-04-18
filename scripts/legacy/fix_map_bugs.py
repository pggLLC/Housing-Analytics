#!/usr/bin/env python3
"""
scripts/fix_map_bugs.py
-----------------------
Applies offline fixes for Stage-6 map bugs that do not require live API access.

Bugs addressed
--------------
BUG-01  js/co-lihtc-map.js         – ArcGIS LIHTC URL /ArcGIS/ → /arcgis/
BUG-02  data/hna/lihtc/*.json       – Populate per-county files from chfa-lihtc.json
BUG-03  js/housing-needs-assessment.js – ArcGIS LIHTC URL /ArcGIS/ → /arcgis/
BUG-04  js/prop123-map.js           – TIGERweb Places MapServer/2 → MapServer/4 (2025 vintage)
BUG-05  js/housing-needs-assessment.js – TIGERweb Places layer 2→4; CDPs layer 4→5 (2025 vintage)
BUG-07  data/chfa-lihtc.json        – Null YR_PIS="8888" sentinels; add _metadata
BUG-08  data/prop123_jurisdictions.json – Remove root duplicate; update JS refs
BUG-09  js/path-resolver.js         – Replace indexOf('.') with file-extension regex

BUG-06 (market tract stubs) requires live Census API access and is handled by
the .github/workflows/market_data_build.yml GitHub Actions workflow.

Usage
-----
    python scripts/fix_map_bugs.py [--dry-run]
"""

import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PASS_COUNT = 0
WARN_COUNT = 0
FAIL_COUNT = 0
ALREADY_FIXED = 0


def result(label, status, message):
    global PASS_COUNT, WARN_COUNT, FAIL_COUNT, ALREADY_FIXED
    icons = {'FIXED': '✅', 'SKIP': '⚠️', 'FAIL': '❌', 'ALREADY': 'ℹ️'}
    print(f"  {icons.get(status, status)} [{status}] {label}: {message}")
    if status == 'FIXED':
        PASS_COUNT += 1
    elif status == 'SKIP':
        WARN_COUNT += 1
    elif status == 'FAIL':
        FAIL_COUNT += 1
    elif status == 'ALREADY':
        ALREADY_FIXED += 1


def read_text(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def write_text(path, content, dry_run):
    full = os.path.join(ROOT, path)
    if dry_run:
        print(f"    [dry-run] would write {path}")
    else:
        with open(full, 'w', encoding='utf-8') as f:
            f.write(content)


def fix_bug_01(dry_run):
    """BUG-01: co-lihtc-map.js — /ArcGIS/ → /arcgis/ in LIHTC_BASE."""
    path = 'js/co-lihtc-map.js'
    old = "/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer"
    new = "/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer"
    try:
        content = read_text(path)
        if old in content:
            write_text(path, content.replace(old, new), dry_run)
            result("BUG-01", "FIXED", f"Replaced /ArcGIS/ with /arcgis/ in {path}")
        else:
            result("BUG-01", "ALREADY", f"{path} already uses lowercase /arcgis/")
    except Exception as exc:
        result("BUG-01", "FAIL", str(exc))


def fix_bug_02(dry_run):
    """BUG-02: Distribute chfa-lihtc.json features into per-county files."""
    script = os.path.join(ROOT, 'scripts', 'split-lihtc-by-county.js')
    source = os.path.join(ROOT, 'data', 'chfa-lihtc.json')
    out_dir = os.path.join(ROOT, 'data', 'hna', 'lihtc')
    if not os.path.isfile(source):
        result("BUG-02", "FAIL", f"Source not found: {source}")
        return
    # Check if already populated
    stubs = [
        f for f in os.listdir(out_dir) if f.endswith('.json') and
        os.path.getsize(os.path.join(out_dir, f)) < 100
    ]
    if not stubs and not dry_run:
        result("BUG-02", "ALREADY", "per-county files already populated")
        return
    if dry_run:
        result("BUG-02", "SKIP", "[dry-run] would run split-lihtc-by-county.js")
        return
    try:
        subprocess.run(['node', script], check=True, capture_output=True, text=True)
        result("BUG-02", "FIXED", "split-lihtc-by-county.js executed successfully")
    except subprocess.CalledProcessError as exc:
        result("BUG-02", "FAIL", exc.stderr.strip())


def fix_bug_03(dry_run):
    """BUG-03: housing-needs-assessment.js — /ArcGIS/ → /arcgis/ in chfaLihtcQuery."""
    path = 'js/housing-needs-assessment.js'
    old = "/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer"
    new = "/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer"
    try:
        content = read_text(path)
        if old in content:
            write_text(path, content.replace(old, new), dry_run)
            result("BUG-03", "FIXED", f"Replaced /ArcGIS/ with /arcgis/ in {path}")
        else:
            result("BUG-03", "ALREADY", f"{path} already uses lowercase /arcgis/")
    except Exception as exc:
        result("BUG-03", "FAIL", str(exc))


def fix_bug_04(dry_run):
    """BUG-04: prop123-map.js — TIGERweb MapServer/2 → MapServer/4 (2025 vintage).

    The 2025 TIGERweb vintage renumbered Incorporated Places from layer 2 to layer 4.
    """
    path = 'js/prop123-map.js'
    old = 'Places_CouSub_ConCity_SubMCD/MapServer/2'
    new = 'Places_CouSub_ConCity_SubMCD/MapServer/4'
    try:
        content = read_text(path)
        if old in content:
            write_text(path, content.replace(old, new), dry_run)
            result("BUG-04", "FIXED", f"MapServer/2 → MapServer/4 (2025 vintage) in {path}")
        else:
            result("BUG-04", "ALREADY", f"{path} already uses MapServer/4 (2025 vintage)")
    except Exception as exc:
        result("BUG-04", "FAIL", str(exc))


def fix_bug_05(dry_run):
    """BUG-05: housing-needs-assessment.js — TIGERweb Places layer 2→4, CDPs 4→5 (2025 vintage).

    The 2025 TIGERweb vintage renumbered layers:
      Incorporated Places: 2 → 4
      Census Designated Places: 4 → 5
    """
    path = 'js/housing-needs-assessment.js'
    old = "geoType === 'place' ? 2 : geoType === 'cdp' ? 4 : 2"
    new = "geoType === 'place' ? 4 : geoType === 'cdp' ? 5 : 4"
    try:
        content = read_text(path)
        if old in content:
            write_text(path, content.replace(old, new), dry_run)
            result("BUG-05", "FIXED", f"TIGERweb Places layer 2→4, CDPs 4→5 (2025 vintage) in {path}")
        else:
            result("BUG-05", "ALREADY", f"{path} already uses 2025-vintage TIGERweb layer numbers")
    except Exception as exc:
        result("BUG-05", "FAIL", str(exc))


def fix_bug_07(dry_run):
    """BUG-07: chfa-lihtc.json — null YR_PIS=8888 sentinel values; add _metadata."""
    path = 'data/chfa-lihtc.json'
    try:
        with open(os.path.join(ROOT, path), encoding='utf-8') as f:
            data = json.load(f)
        features = data.get('features', [])
        fixed = 0
        for feat in features:
            props = feat.get('properties') or {}
            if str(props.get('YR_PIS', '')) == '8888':
                props['YR_PIS'] = None
                fixed += 1
        if '_metadata' not in data:
            data['_metadata'] = {
                'source': 'CHFA / HUD LIHTC FeatureServer',
                'sourceUrl': 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer',
                'vintage': '2024',
                'license': 'Public domain — HUD/CHFA',
                'notes': 'YR_PIS=8888 is the HUD null sentinel; these have been set to null.',
                'featureCount': len(features),
            }
            meta_added = True
        else:
            meta_added = False
        if fixed > 0 or meta_added:
            if not dry_run:
                with open(os.path.join(ROOT, path), 'w', encoding='utf-8') as f:
                    json.dump(data, f, separators=(',', ':'))
            action = []
            if fixed:
                action.append(f"nulled {fixed} YR_PIS=8888 sentinel(s)")
            if meta_added:
                action.append("added _metadata block")
            result("BUG-07", "FIXED", "; ".join(action))
        else:
            result("BUG-07", "ALREADY", "chfa-lihtc.json already patched")
    except Exception as exc:
        result("BUG-07", "FAIL", str(exc))


def fix_bug_08(dry_run):
    """BUG-08: Remove root data/prop123_jurisdictions.json; update JS refs."""
    root_dup = os.path.join(ROOT, 'data', 'prop123_jurisdictions.json')
    canonical = os.path.join(ROOT, 'data', 'policy', 'prop123_jurisdictions.json')

    # Check canonical exists
    if not os.path.isfile(canonical):
        result("BUG-08", "FAIL", "Canonical data/policy/prop123_jurisdictions.json missing")
        return

    # Remove root duplicate
    if os.path.isfile(root_dup):
        if not dry_run:
            os.remove(root_dup)
        result("BUG-08", "FIXED", "Removed root data/prop123_jurisdictions.json")
    else:
        result("BUG-08", "ALREADY", "Root duplicate already absent")

    # Update JS refs
    js_fixes = [
        ('js/market-intelligence.js', "resolveData('prop123_jurisdictions.json')",
         "resolveData('policy/prop123_jurisdictions.json')"),
        ('js/market-analysis.js', "DS.baseData('prop123_jurisdictions.json')",
         "DS.baseData('policy/prop123_jurisdictions.json')"),
    ]
    for js_path, old, new in js_fixes:
        try:
            content = read_text(js_path)
            if old in content:
                write_text(js_path, content.replace(old, new), dry_run)
                result("BUG-08", "FIXED", f"Updated prop123 path in {js_path}")
            else:
                result("BUG-08", "ALREADY", f"{js_path} already uses policy/ path")
        except Exception as exc:
            result("BUG-08", "FAIL", f"{js_path}: {exc}")


def fix_bug_09(dry_run):
    """BUG-09: path-resolver.js — replace indexOf('.') with file-extension regex."""
    path = 'js/path-resolver.js'
    old = "parts[0].indexOf('.') !== -1"
    new = r"/\.\w+$/.test(parts[0])"
    try:
        content = read_text(path)
        if old in content:
            write_text(path, content.replace(old, new), dry_run)
            result("BUG-09", "FIXED", f"Replaced indexOf('.') with /\\.\\w+$/.test() in {path}")
        else:
            result("BUG-09", "ALREADY", f"{path} already uses regex extension check")
    except Exception as exc:
        result("BUG-09", "FAIL", str(exc))


def main():
    parser = argparse.ArgumentParser(description="Apply Stage-6 map bug fixes offline.")
    parser.add_argument('--dry-run', action='store_true', help="Show what would change without modifying files.")
    args = parser.parse_args()

    if args.dry_run:
        print("DRY-RUN mode — no files will be modified.\n")

    print("=== Stage-6 Map Bug Fixer ===\n")

    fix_bug_01(args.dry_run)
    fix_bug_02(args.dry_run)
    fix_bug_03(args.dry_run)
    fix_bug_04(args.dry_run)
    fix_bug_05(args.dry_run)
    # BUG-06 requires live Census API — handled by market_data_build.yml workflow
    fix_bug_07(args.dry_run)
    fix_bug_08(args.dry_run)
    fix_bug_09(args.dry_run)

    print()
    print("─" * 60)
    total = PASS_COUNT + WARN_COUNT + FAIL_COUNT + ALREADY_FIXED
    print(f"Results: {PASS_COUNT} fixed  {ALREADY_FIXED} already-ok  {WARN_COUNT} skipped  {FAIL_COUNT} failed  (of {total} checks)")
    if FAIL_COUNT > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
