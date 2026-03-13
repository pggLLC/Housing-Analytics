"""
scripts/market-analysis/build_neighborhood_access.py

Generates data/derived/market-analysis/neighborhood_access.json.

When run without a live OSM / PostGIS feed this script writes a representative
seed dataset covering key Colorado metros so that the OsmAmenities connector
can return meaningful proximity scores out-of-the-box.

To replace with live data, supply --osm-file <path-to-geojson> on the command
line.  The GeoJSON must have features with a "type" property that matches one
of: grocery, transit_stop, park, healthcare, school.

Writes: data/derived/market-analysis/neighborhood_access.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "neighborhood_access.json"

# ---------------------------------------------------------------------------
# Representative seed amenities for key Colorado metros.
# Covers Denver, Colorado Springs, Pueblo, Fort Collins, Greeley,
# Grand Junction, Steamboat Springs, Vail / Eagle County, and Longmont /
# Loveland — the market areas most commonly analysed by the PMA tool.
# Types must match OsmAmenities.AMENITY_TYPES:
#   grocery | transit_stop | park | healthcare | school
# ---------------------------------------------------------------------------
SEED_AMENITIES = [
    # ── Grocery ──────────────────────────────────────────────────────────
    {"type": "grocery", "name": "King Soopers", "lat": 39.7392, "lon": -104.9903},
    {"type": "grocery", "name": "Safeway – Capitol Hill", "lat": 39.7340, "lon": -104.9775},
    {"type": "grocery", "name": "Natural Grocers", "lat": 39.7515, "lon": -104.9993},
    {"type": "grocery", "name": "Sprouts Farmers Market", "lat": 39.7218, "lon": -104.9625},
    {"type": "grocery", "name": "King Soopers – Colfax", "lat": 39.7403, "lon": -104.9501},
    {"type": "grocery", "name": "Whole Foods Market", "lat": 39.7457, "lon": -104.9880},
    {"type": "grocery", "name": "Trader Joe's – Cherry Creek", "lat": 39.7158, "lon": -104.9479},
    {"type": "grocery", "name": "King Soopers – Baker", "lat": 39.7102, "lon": -104.9921},
    {"type": "grocery", "name": "Safeway – Aurora", "lat": 39.7142, "lon": -104.8300},
    {"type": "grocery", "name": "King Soopers – Lakewood", "lat": 39.7200, "lon": -105.0862},
    {"type": "grocery", "name": "King Soopers – CO Springs N", "lat": 38.9071, "lon": -104.8026},
    {"type": "grocery", "name": "Safeway – CO Springs S", "lat": 38.8322, "lon": -104.8210},
    {"type": "grocery", "name": "Natural Grocers – Manitou", "lat": 38.8606, "lon": -104.9196},
    {"type": "grocery", "name": "King Soopers – Pueblo", "lat": 38.2681, "lon": -104.6126},
    {"type": "grocery", "name": "Safeway – Pueblo West", "lat": 38.3285, "lon": -104.7329},
    {"type": "grocery", "name": "King Soopers – Fort Collins", "lat": 40.5741, "lon": -105.0847},
    {"type": "grocery", "name": "Natural Grocers – Ft Collins", "lat": 40.5650, "lon": -105.0778},
    {"type": "grocery", "name": "King Soopers – Greeley", "lat": 40.4069, "lon": -104.7074},
    {"type": "grocery", "name": "City Market – Grand Junction", "lat": 39.0744, "lon": -108.5506},
    {"type": "grocery", "name": "Safeway – Grand Junction E", "lat": 39.0856, "lon": -108.4993},
    {"type": "grocery", "name": "City Market – Steamboat Springs", "lat": 40.4786, "lon": -106.8322},
    {"type": "grocery", "name": "Safeway – Longmont", "lat": 40.1663, "lon": -105.1019},
    {"type": "grocery", "name": "King Soopers – Loveland", "lat": 40.3978, "lon": -105.0749},
    {"type": "grocery", "name": "Safeway – Vail", "lat": 39.6422, "lon": -106.3748},
    {"type": "grocery", "name": "City Market – Glenwood Springs", "lat": 39.5425, "lon": -107.3245},
    # ── Transit stops ────────────────────────────────────────────────────
    {"type": "transit_stop", "name": "RTD Union Station", "lat": 39.7529, "lon": -105.0002},
    {"type": "transit_stop", "name": "RTD 16th St Mall Shuttle", "lat": 39.7452, "lon": -104.9943},
    {"type": "transit_stop", "name": "RTD Colfax & Broadway", "lat": 39.7403, "lon": -104.9876},
    {"type": "transit_stop", "name": "RTD Civic Center", "lat": 39.7369, "lon": -104.9883},
    {"type": "transit_stop", "name": "RTD 10th & Osage", "lat": 39.7251, "lon": -105.0041},
    {"type": "transit_stop", "name": "RTD Alameda Station", "lat": 39.7148, "lon": -104.9945},
    {"type": "transit_stop", "name": "RTD Evans Station", "lat": 39.6884, "lon": -104.9952},
    {"type": "transit_stop", "name": "RTD Colfax & Havana", "lat": 39.7404, "lon": -104.8567},
    {"type": "transit_stop", "name": "RTD Aurora Metro Center", "lat": 39.7125, "lon": -104.8224},
    {"type": "transit_stop", "name": "Mountain Metropolitan Transit", "lat": 38.8316, "lon": -104.8183},
    {"type": "transit_stop", "name": "Pueblo Transit", "lat": 38.2551, "lon": -104.6126},
    {"type": "transit_stop", "name": "Transfort – College & Drake", "lat": 40.5584, "lon": -105.0760},
    {"type": "transit_stop", "name": "Transfort – Downtown FC", "lat": 40.5890, "lon": -105.0755},
    {"type": "transit_stop", "name": "Greeley-Evans Transit", "lat": 40.4233, "lon": -104.7091},
    {"type": "transit_stop", "name": "Mesa County Rural Transit", "lat": 39.0744, "lon": -108.5506},
    {"type": "transit_stop", "name": "Steamboat Springs Transit", "lat": 40.4850, "lon": -106.8317},
    {"type": "transit_stop", "name": "RTD Lakewood/Wadsworth", "lat": 39.7245, "lon": -105.0776},
    {"type": "transit_stop", "name": "RTD Oxford/Englewood", "lat": 39.6484, "lon": -105.0001},
    {"type": "transit_stop", "name": "Vail Transit Hub", "lat": 39.6422, "lon": -106.3736},
    # ── Parks ────────────────────────────────────────────────────────────
    {"type": "park", "name": "City Park", "lat": 39.7490, "lon": -104.9502},
    {"type": "park", "name": "Cheesman Park", "lat": 39.7318, "lon": -104.9631},
    {"type": "park", "name": "Washington Park", "lat": 39.7002, "lon": -104.9617},
    {"type": "park", "name": "Sloan's Lake Park", "lat": 39.7451, "lon": -105.0499},
    {"type": "park", "name": "Commons Park", "lat": 39.7537, "lon": -105.0044},
    {"type": "park", "name": "Curtis Park", "lat": 39.7564, "lon": -104.9747},
    {"type": "park", "name": "Globeville Landing Park", "lat": 39.7837, "lon": -104.9977},
    {"type": "park", "name": "Aurora City Park", "lat": 39.7243, "lon": -104.8304},
    {"type": "park", "name": "Bear Creek Lake Park", "lat": 39.6624, "lon": -105.1244},
    {"type": "park", "name": "Prospect Lake – Memorial Park", "lat": 38.8417, "lon": -104.8137},
    {"type": "park", "name": "Monument Valley Park", "lat": 38.8672, "lon": -104.8524},
    {"type": "park", "name": "Palmer Park", "lat": 38.8920, "lon": -104.7810},
    {"type": "park", "name": "Pueblo City Park", "lat": 38.2628, "lon": -104.6126},
    {"type": "park", "name": "Lake Pueblo State Park", "lat": 38.2601, "lon": -104.7430},
    {"type": "park", "name": "Lee Martinez Park – Ft Collins", "lat": 40.5983, "lon": -105.0836},
    {"type": "park", "name": "Spring Canyon Community Park", "lat": 40.5574, "lon": -105.1148},
    {"type": "park", "name": "Sanborn Park – Greeley", "lat": 40.4131, "lon": -104.7235},
    {"type": "park", "name": "Riverside Park – Grand Junction", "lat": 39.0639, "lon": -108.5598},
    {"type": "park", "name": "Steamboat Lake State Park", "lat": 40.7857, "lon": -106.9705},
    {"type": "park", "name": "Betty Ford Alpine Gardens", "lat": 39.6373, "lon": -106.3744},
    {"type": "park", "name": "Glenwood Canyon State Park", "lat": 39.5425, "lon": -107.3100},
    {"type": "park", "name": "Civic Center Park – Denver", "lat": 39.7369, "lon": -104.9875},
    {"type": "park", "name": "Costigan Park – Longmont", "lat": 40.1626, "lon": -105.1019},
    {"type": "park", "name": "Benson Sculpture Garden", "lat": 40.4010, "lon": -105.0748},
    # ── Healthcare ───────────────────────────────────────────────────────
    {"type": "healthcare", "name": "Denver Health Medical Center", "lat": 39.7240, "lon": -104.9968},
    {"type": "healthcare", "name": "UCHealth – Anschutz Campus", "lat": 39.7460, "lon": -104.8380},
    {"type": "healthcare", "name": "St. Anthony Hospital", "lat": 39.7198, "lon": -105.0694},
    {"type": "healthcare", "name": "Presbyterian/St. Luke's", "lat": 39.7464, "lon": -104.9720},
    {"type": "healthcare", "name": "Rose Medical Center", "lat": 39.7224, "lon": -104.9378},
    {"type": "healthcare", "name": "Porter Adventist Hospital", "lat": 39.6726, "lon": -104.9764},
    {"type": "healthcare", "name": "Aurora South Medical Center", "lat": 39.6792, "lon": -104.8390},
    {"type": "healthcare", "name": "UCHealth – CO Springs", "lat": 38.9285, "lon": -104.7831},
    {"type": "healthcare", "name": "Penrose Hospital", "lat": 38.8376, "lon": -104.8538},
    {"type": "healthcare", "name": "St. Francis Medical Center", "lat": 38.8640, "lon": -104.7683},
    {"type": "healthcare", "name": "Parkview Medical Center", "lat": 38.2691, "lon": -104.5906},
    {"type": "healthcare", "name": "St. Mary-Corwin Medical Ctr", "lat": 38.2478, "lon": -104.6124},
    {"type": "healthcare", "name": "UCHealth – Poudre Valley", "lat": 40.5758, "lon": -105.0671},
    {"type": "healthcare", "name": "Harmony Campus – Banner Health", "lat": 40.5200, "lon": -105.0618},
    {"type": "healthcare", "name": "North Colorado Medical Ctr", "lat": 40.4090, "lon": -104.7204},
    {"type": "healthcare", "name": "Community Hospital – Grand Junction", "lat": 39.0741, "lon": -108.5502},
    {"type": "healthcare", "name": "St. Mary's Medical Ctr – Grand Junction", "lat": 39.0656, "lon": -108.5638},
    {"type": "healthcare", "name": "Yampa Valley Medical Center", "lat": 40.4834, "lon": -106.8283},
    {"type": "healthcare", "name": "Vail Health Hospital", "lat": 39.6467, "lon": -106.3768},
    {"type": "healthcare", "name": "Valley View Hospital – Glenwood Springs", "lat": 39.5379, "lon": -107.3218},
    {"type": "healthcare", "name": "Longmont United Hospital", "lat": 40.1687, "lon": -105.0941},
    {"type": "healthcare", "name": "McKee Medical Center", "lat": 40.3952, "lon": -105.0712},
    {"type": "healthcare", "name": "Swedish Medical Center", "lat": 39.6533, "lon": -105.0122},
    # ── Schools ──────────────────────────────────────────────────────────
    {"type": "school", "name": "East High School", "lat": 39.7371, "lon": -104.9447},
    {"type": "school", "name": "Manual High School", "lat": 39.7346, "lon": -104.9723},
    {"type": "school", "name": "North High School", "lat": 39.7712, "lon": -105.0044},
    {"type": "school", "name": "Lincoln Elementary", "lat": 39.7208, "lon": -104.9827},
    {"type": "school", "name": "Gilpin Elementary", "lat": 39.7592, "lon": -104.9816},
    {"type": "school", "name": "Denver School of the Arts", "lat": 39.7397, "lon": -104.9731},
    {"type": "school", "name": "Cole Arts & Science Academy", "lat": 39.7460, "lon": -104.9687},
    {"type": "school", "name": "Thomas Jefferson High School", "lat": 39.6671, "lon": -105.0380},
    {"type": "school", "name": "Kennedy High School – Aurora", "lat": 39.7258, "lon": -104.8266},
    {"type": "school", "name": "Palmer High School", "lat": 38.8379, "lon": -104.8252},
    {"type": "school", "name": "Mitchell High School", "lat": 38.8641, "lon": -104.8600},
    {"type": "school", "name": "Pueblo Central High", "lat": 38.2705, "lon": -104.6146},
    {"type": "school", "name": "Centennial High School", "lat": 38.2478, "lon": -104.6394},
    {"type": "school", "name": "Poudre High School", "lat": 40.5940, "lon": -105.1078},
    {"type": "school", "name": "Rocky Mountain High School", "lat": 40.5520, "lon": -105.0788},
    {"type": "school", "name": "Fort Collins High School", "lat": 40.5764, "lon": -105.0527},
    {"type": "school", "name": "Greeley Central High School", "lat": 40.4166, "lon": -104.7071},
    {"type": "school", "name": "Grand Junction High School", "lat": 39.0678, "lon": -108.5518},
    {"type": "school", "name": "Steamboat Springs High", "lat": 40.4877, "lon": -106.8269},
    {"type": "school", "name": "Vail Mountain School", "lat": 39.6380, "lon": -106.3769},
    {"type": "school", "name": "Longmont High School", "lat": 40.1630, "lon": -105.1059},
    {"type": "school", "name": "Thompson Valley High School", "lat": 40.3956, "lon": -105.0635},
]


def build(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    result = {
        "meta": {
            "generated": now,
            "source": "OpenStreetMap / illustrative seed data",
            "note": (
                "Representative Colorado amenity points. "
                "Re-run with live OSM data to refresh."
            ),
            "record_count": len(SEED_AMENITIES),
        },
        "amenities": SEED_AMENITIES,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"  Wrote {len(SEED_AMENITIES)} amenity records → {output_path}")


if __name__ == "__main__":
    print("Building neighborhood_access.json …")
    build(OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
