"""Validate the CHFA LIHTC output file produced by fetch-chfa-lihtc.js."""
import json
import sys

OUT = "data/chfa-lihtc.json"

with open(OUT) as f:
    d = json.load(f)

features = d.get("features", [])
with_geom = [ft for ft in features if ft.get("geometry") and ft["geometry"].get("coordinates")]

print(f"  Total features     : {len(features)}")
print(f"  With valid geometry: {len(with_geom)}")
print(f"  fetchedAt          : {d.get('fetchedAt', '(missing)')}")

if len(features) == 0:
    print("::warning::CHFA LIHTC output has 0 features — map will fall back to HUD data or cached file.")
    sys.exit(0)  # not a hard failure; cached file may have been preserved
elif len(with_geom) == 0:
    print("::warning::CHFA LIHTC features all lack valid geometry — map markers will not render.")
else:
    print("  Validation passed ✅")
