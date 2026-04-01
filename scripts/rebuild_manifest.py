#!/usr/bin/env python3
"""
FIX 7: data/manifest.json - Rebuild from actual file inventory
Root cause: Manifest only lists 2 files but 250+ data files exist
Solution: Scan all .json and .geojson files under data/ and rebuild manifest.json
Run AFTER fixes 1-6 to ensure all repaired files are included.
"""

import json
import os
import glob
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
MANIFEST_FILE = os.path.join(DATA_DIR, 'manifest.json')


def get_feature_count(filepath):
    """Return feature count for GeoJSON/FeatureCollection files, else 0."""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        if isinstance(data, dict):
            if data.get('type') == 'FeatureCollection':
                return len(data.get('features', []))
            if 'features' in data:
                return len(data['features'])
            if 'counties' in data:
                return len(data['counties'])
        if isinstance(data, list):
            return len(data)
    except Exception:
        pass
    return 0


def is_placeholder(filepath):
    """Heuristic: file contains a 'placeholder' key or note."""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        if isinstance(data, dict):
            if data.get('placeholder') is True:
                return True
            meta = data.get('meta', {})
            if isinstance(meta, dict) and 'placeholder' in str(meta.get('note', '')).lower():
                return True
    except Exception:
        pass
    return False


def scan_data_files():
    """Scan all .json and .geojson files under data/, excluding manifest.json itself."""
    pattern_json = os.path.join(DATA_DIR, '**', '*.json')
    pattern_geojson = os.path.join(DATA_DIR, '**', '*.geojson')

    all_files = (
        glob.glob(pattern_json, recursive=True) +
        glob.glob(pattern_geojson, recursive=True)
    )

    entries = {}
    for fpath in sorted(all_files):
        # Use paths relative to the data/ directory (no "data/" prefix)
        rel = os.path.relpath(fpath, start=DATA_DIR)
        if rel == 'manifest.json':
            continue  # exclude manifest itself
        try:
            size = os.path.getsize(fpath)
        except OSError:
            size = 0

        entries[rel] = {
            "featureCount": get_feature_count(fpath),
            "placeholder": is_placeholder(fpath),
            "bytes": size
        }

    return entries


def main():
    files = scan_data_files()
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        "files": files
    }

    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f'FIX 7 applied: manifest.json rebuilt with {len(files)} file entries.')
    print(f'  Generated: {manifest["generated"]}')


if __name__ == '__main__':
    main()
