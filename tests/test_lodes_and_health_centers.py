"""LODES tract fields and HRSA health center sites used by "What's near this site".

data/market/lodes_co.json: LODES WAC CE01-CE03 are earnings tiers and
CNS01-CNS20 are NAICS sectors; CS01/CS02 are worker sex. Before 2026-10-18
fetch_lodes.py stored CS01/CS02 as low/mid wage (high_wage was 0 in every
tract) and the CE earnings tiers as goods/trade/service sectors.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts" / "market"))

import fetch_health_centers  # noqa: E402
import fetch_lodes  # noqa: E402


def _tracts():
    return json.loads((REPO / "data/market/lodes_co.json").read_text())["tracts"]


def test_wage_tiers_and_sectors_each_add_up_to_all_jobs():
    for t in _tracts():
        assert t["low_wage"] + t["mid_wage"] + t["high_wage"] == t["totalJobs"], t["geoid"]
        assert t["goodsJobs"] + t["tradeJobs"] + t["serviceJobs"] == t["totalJobs"], t["geoid"]


def test_high_wage_jobs_are_not_missing():
    tracts = _tracts()
    assert sum(t["high_wage"] for t in tracts) > 0.4 * sum(t["totalJobs"] for t in tracts)


def test_wage_tiers_are_not_the_sector_split():
    # The old bug stored the same three numbers under both names.
    same = sum(1 for t in _tracts()
               if (t["low_wage"], t["mid_wage"], t["high_wage"]) ==
                  (t["goodsJobs"], t["tradeJobs"], t["serviceJobs"]) and t["totalJobs"])
    assert same < 20


def test_sector_groups_cover_all_twenty_sectors_once():
    cols = [c for group in fetch_lodes.SECTOR_GROUPS.values() for c in group]
    assert sorted(cols) == [f"CNS{i:02d}" for i in range(1, 21)]


def test_wac_reads_earnings_and_sector_columns():
    row = {"w_geocode": "080010078011000", "C000": "10", "CE01": "2", "CE02": "3", "CE03": "5",
           "CS01": "6", "CS02": "4", "CA01": "1", "CA02": "8", "CA03": "1",
           **{f"CNS{i:02d}": "0" for i in range(1, 21)}, "CNS07": "4", "CNS16": "6"}
    tract = fetch_lodes.process_wac([row])["08001007801"]
    assert (tract["CE01"], tract["CE02"], tract["CE03"]) == (2, 3, 5)
    assert "CS01" not in tract
    assert tract["CNS07"] == 4 and tract["CNS16"] == 6


def test_health_center_filter():
    base = {"Site State Abbreviation": "CO", "Site Status Description": "Active",
            "Health Center Type Description": "Service Delivery Site",
            "Health Center Location Type Description": "Permanent",
            "Health Center Service Delivery Site Location Setting Description": "All Other Clinic Types"}
    assert fetch_health_centers.keep(base)
    assert not fetch_health_centers.keep({**base, "Health Center Type Description": "Administrative"})
    assert not fetch_health_centers.keep({**base, "Health Center Location Type Description": "Mobile Van"})
    assert not fetch_health_centers.keep({**base, "Health Center Service Delivery Site Location Setting Description": "School"})
    assert not fetch_health_centers.keep({**base, "Site State Abbreviation": "UT"})


def test_committed_health_centers_are_colorado_points():
    doc = json.loads((REPO / "data/market/health_centers_co.geojson").read_text())
    assert doc["meta"]["feature_count"] == len(doc["features"]) > 100
    for f in doc["features"]:
        lon, lat = f["geometry"]["coordinates"]
        assert 36.9 <= lat <= 41.1 and -109.1 <= lon <= -102.0
        assert f["properties"]["name"]
