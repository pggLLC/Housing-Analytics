"""scripts/hna/build_acs_reliability.py: margins come from the series whose
published estimate equals the stored one, and an unknown margin stays null."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "build_acs_reliability", ROOT / "scripts" / "hna" / "build_acs_reliability.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def fake_getter(tables):
    """tables[(series, table, level)] = {geoid: {var: value}} -> Census rows."""
    def get(url, key=""):
        series = "acs1" if "/acs/acs1" in url else "acs5"
        table = "subject" if "/subject?" in url else "profile"
        level = ("state" if "for=state:08" in url else
                 "county" if "for=county:" in url else "place")
        data = tables.get((series, table, level))
        if not data:
            return None
        gets = url.split("get=")[1].split("&")[0].split(",")
        head = gets + (["state"] if level == "state" else ["state", level])
        rows = [head]
        for gid, rec in data.items():
            row = [rec.get(v) for v in gets] + ["08"]
            if level != "state":
                row.append(gid[2:])
            rows.append(row)
        return rows
    return get


def summary(**profile):
    return {"acsProfile": {"_acsYear": "2024", **profile}, "acsS0801": {}}


def test_cv_tiers_follow_the_rule():
    assert mod.tier_for(1000, 164.5)[1] == "good"           # CV 10%
    assert mod.tier_for(1000, 1.645 * 200)[1] == "fair"     # CV 20%
    assert mod.tier_for(1000, 1.645 * 400)[1] == "use_with_caution"
    assert mod.tier_for(0, 14)[1] == "zero_in_sample"
    cv, tier, why = mod.tier_for(500, None)
    assert cv is None and tier is None and why


def test_margin_comes_from_the_series_that_matches():
    small = "0800001"   # only in acs5
    big = "0800002"     # both, stored value is the 1-year one
    tables = {
        ("acs5", "profile", "place"): {
            small: {"DP05_0001E": 900, "DP05_0001M": 150, "DP04_0134E": 1100, "DP04_0134M": 800},
            big: {"DP05_0001E": 90000, "DP05_0001M": 50, "DP04_0134E": 1500, "DP04_0134M": 30},
        },
        ("acs1", "profile", "place"): {
            big: {"DP05_0001E": 91000, "DP05_0001M": 900, "DP04_0134E": 1550, "DP04_0134M": 60},
        },
    }
    sums = {small: summary(DP05_0001E=900, DP04_0134E=1100),
            big: summary(DP05_0001E=91000, DP04_0134E=1550)}
    doc = mod.build(sums, 2024, key="", getter=fake_getter(tables))
    s = doc["geos"][small]["DP04_0134E"]
    assert (s["s"], s["m"], s["t"]) == ("acs5", 800.0, "use_with_caution")
    b = doc["geos"][big]["DP04_0134E"]
    assert (b["s"], b["m"]) == ("acs1", 60.0)
    assert doc["geos"][big]["DP05_0001E"]["s"] == "acs1"


def test_no_match_means_no_margin_not_a_guess():
    gid = "0800003"
    tables = {("acs5", "profile", "place"): {
        gid: {"DP05_0001E": 900, "DP05_0001M": 150, "DP03_0062E": 60000, "DP03_0062M": 9000}}}
    doc = mod.build({gid: summary(DP05_0001E=900, DP03_0062E=61234)}, 2024, key="",
                    getter=fake_getter(tables))
    e = doc["geos"][gid]["DP03_0062E"]
    assert e["e"] == 61234 and e["m"] is None and e["t"] is None and "neither" in e["why"]
    missing = doc["geos"][gid]["DP04_0089E"]
    assert missing["e"] is None and missing["m"] is None and missing["why"]


def test_census_sentinels_are_never_a_margin():
    gid = "0800004"
    tables = {("acs5", "profile", "place"): {gid: {
        "DP05_0001E": 900, "DP05_0001M": -555555555,
        "DP04_0134E": 1100, "DP04_0134M": -222222222}}}
    doc = mod.build({gid: summary(DP05_0001E=900, DP04_0134E=1100)}, 2024, key="",
                    getter=fake_getter(tables))
    pop = doc["geos"][gid]["DP05_0001E"]
    assert pop["m"] == 0 and pop["t"] == "good" and "controlled" in pop["why"]
    rent = doc["geos"][gid]["DP04_0134E"]
    assert rent["m"] is None and rent["t"] is None


def test_derived_rent_burden_uses_root_sum_of_squares():
    gid = "0800005"
    tables = {("acs5", "profile", "place"): {gid: {
        "DP05_0001E": 900, "DP05_0001M": 100,
        "DP04_0141PE": 10.0, "DP04_0141PM": 3.0, "DP04_0142PE": 30.0, "DP04_0142PM": 4.0}}}
    doc = mod.build({gid: summary(DP05_0001E=900, DP04_0141PE=10.0, DP04_0142PE=30.0)}, 2024,
                    key="", getter=fake_getter(tables))
    d = doc["geos"][gid]["rent_burden_30plus"]
    assert d["e"] == 40.0 and d["m"] == 5.0
    assert d["cv"] == round((5.0 / 1.645) / 40.0, 4)


def test_tie_takes_the_wider_margin_unless_population_decides():
    gid = "0800006"
    tables = {
        ("acs5", "profile", "place"): {gid: {"DP05_0001E": 70000, "DP05_0001M": 10,
                                             "DP04_0047PE": 40.0, "DP04_0047PM": 2.0}},
        ("acs1", "profile", "place"): {gid: {"DP05_0001E": 70000, "DP05_0001M": 10,
                                             "DP04_0047PE": 40.0, "DP04_0047PM": 5.0}},
    }
    doc = mod.build({gid: summary(DP05_0001E=70000, DP04_0047PE=40.0)}, 2024, key="",
                    getter=fake_getter(tables))
    assert doc["geos"][gid]["DP04_0047PE"]["m"] == 5.0


def test_refuses_to_write_when_the_five_year_profile_is_empty():
    import pytest
    with pytest.raises(SystemExit):
        mod.build({"0800007": summary(DP05_0001E=1)}, 2024, key="", getter=lambda url, key="": None)


def test_committed_file_covers_every_summary_when_present():
    out = ROOT / "data" / "hna" / "acs-reliability.json"
    if not out.exists():
        return  # built by .github/workflows/build-acs-reliability.yml after merge
    doc = json.loads(out.read_text())
    gids = {p.stem for p in (ROOT / "data" / "hna" / "summary").glob("*.json")
            if p.stem.isdigit()}
    assert set(doc["geos"]) == gids
    counties = [g for g in doc["geos"] if len(g) == 5]
    assert len(counties) == 64
    checked = 0
    for gid, rec in doc["geos"].items():
        for var, e in rec.items():
            checked += 1
            if e["m"] is None:
                assert e.get("why"), f"{gid} {var}: no margin and no reason"
            if e["t"] is not None:
                assert e["t"] in doc["meta"]["tiers"]
    assert checked > 0
