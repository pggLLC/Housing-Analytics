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


def fake_getter(tables, fail=(), missing=()):
    """tables[(series, table, level)] = {geoid: {var: value}} -> Census rows.

    A table not given answers with no geographies, except that the 5-year
    tables, which publish every geography, answer for each geoid any table
    mentions, with no values. A key in `fail` answers as a failed request; a
    (year, series) in `missing` answers as a dataset the API does not have."""
    known = {g for data in tables.values() for g in data}

    def get(url, key=""):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if "/acs/acs1" in url else "acs5"
        table = "subject" if "/subject?" in url else "profile"
        level = ("state" if "for=state:08" in url else
                 "county" if "for=county:" in url else "place")
        if (series, table, level) in fail:
            return None
        if (year, series) in missing:
            return mod.NOT_PUBLISHED
        data = tables.get((series, table, level, year), tables.get((series, table, level))
                          if year == 2024 else None)
        if data is None and series == "acs5":
            data = {g: {} for g in known if mod.level_of(g) == level}
        gets = url.split("get=")[1].split("&")[0].split(",")
        head = gets + (["state"] if level == "state" else ["state", level])
        rows = [head]
        for gid, rec in (data or {}).items():
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
    assert e["e"] == 61234 and e["m"] is None and e["t"] is None and "matches no published" in e["why"]
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


def test_refuses_to_write_on_a_failed_or_short_request():
    import pytest
    gid = "0800007"
    tables = {("acs5", "profile", "place"): {gid: {"DP05_0001E": 1, "DP05_0001M": 1}}}
    sums = {gid: summary(DP05_0001E=1)}
    # One failed request writes nothing, even an ACS 1-year one.
    with pytest.raises(SystemExit):
        mod.build(sums, 2024, key="", getter=fake_getter(tables, fail={("acs1", "profile", "place")}))
    # A 5-year table missing a geography the site has writes nothing.
    with pytest.raises(SystemExit):
        mod.build({**sums, "0800008": summary(DP05_0001E=2)}, 2024, key="",
                  getter=fake_getter(tables))
    assert mod.build(sums, 2024, key="", getter=fake_getter(tables))["geos"][gid]


def test_derived_keeps_the_estimate_when_only_the_margin_is_unknown():
    gid = "0800009"
    tables = {
        ("acs5", "profile", "place"): {gid: {"DP05_0001E": 70000, "DP05_0001M": 10,
                                             "DP04_0141PE": 10.0, "DP04_0141PM": 3.0,
                                             "DP04_0142PE": 31.0, "DP04_0142PM": None}},
        ("acs1", "profile", "place"): {gid: {"DP05_0001E": 71000, "DP05_0001M": 10,
                                             "DP04_0142PE": 30.0, "DP04_0142PM": 4.0}},
    }
    # 0142 stored as 31.0 matches acs5, whose margin is missing.
    doc = mod.build({gid: summary(DP05_0001E=70000, DP04_0141PE=10.0, DP04_0142PE=31.0)},
                    2024, key="", getter=fake_getter(tables))
    d = doc["geos"][gid]["rent_burden_30plus"]
    assert d["e"] == 41.0 and d["m"] is None and d["t"] is None and "margin" in d["why"]
    # 0142 stored as 30.0 matches only acs1 while 0141 matches only acs5.
    doc = mod.build({gid: summary(DP05_0001E=70000, DP04_0141PE=10.0, DP04_0142PE=30.0)},
                    2024, key="", getter=fake_getter(tables))
    d = doc["geos"][gid]["rent_burden_30plus"]
    assert d["e"] == 40.0 and d["m"] is None and "different ACS series" in d["why"]


def test_s0801_is_matched_at_its_own_stored_year():
    gid = "0800010"
    tables = {
        ("acs5", "profile", "place"): {gid: {"DP05_0001E": 500, "DP05_0001M": 80}},
        ("acs5", "subject", "place", 2022): {gid: {"S0801_C01_046E": 24.3, "S0801_C01_046M": 6.1}},
        ("acs5", "subject", "place", 2024): {gid: {"S0801_C01_046E": 24.3, "S0801_C01_046M": 9.9}},
    }
    s = summary(DP05_0001E=500)
    s["acsS0801"] = {"_acsYear": 2022, "S0801_C01_046E": 24.3}
    doc = mod.build({gid: s}, 2024, key="", getter=fake_getter(tables))
    e = doc["geos"][gid]["S0801_C01_046E"]
    assert (e["y"], e["m"]) == (2022, 6.1)
    assert doc["geos"][gid]["DP05_0001E"]["y"] == 2024


def test_profile_vintage_is_found_by_matching_not_by_the_stamp():
    # The profile fetch falls back to older years without stamping the one it
    # used, so a 2024 stamp can sit on 2023 values.
    gid = "0800011"
    tables = {
        ("acs5", "profile", "place", 2024): {gid: {"DP05_0001E": 800, "DP05_0001M": 90,
                                                   "DP04_0134E": 1300, "DP04_0134M": 500}},
        ("acs5", "profile", "place", 2023): {gid: {"DP05_0001E": 780, "DP05_0001M": 85,
                                                   "DP04_0134E": 1250, "DP04_0134M": 310}},
    }
    doc = mod.build({gid: summary(DP05_0001E=780, DP04_0134E=1250)}, 2024, key="",
                    getter=fake_getter(tables))
    e = doc["geos"][gid]["DP04_0134E"]
    assert (e["y"], e["s"], e["m"]) == (2023, "acs5", 310.0)
    # The same value in two vintages resolves to population's source.
    tables[("acs5", "profile", "place", 2024)][gid]["DP04_0134E"] = 1250
    doc = mod.build({gid: summary(DP05_0001E=780, DP04_0134E=1250)}, 2024, key="",
                    getter=fake_getter(tables))
    assert doc["geos"][gid]["DP04_0134E"]["y"] == 2023


def test_shown_raw_home_value_is_matched_at_its_own_vintage():
    # The cascade's raw ACS floor is a copy of DP04_0089E from when the cascade
    # was last built, so it can be another vintage than the stored DP04_0089E.
    gid = "0800013"
    tables = {
        ("acs5", "profile", "place", 2024): {gid: {"DP05_0001E": 800, "DP05_0001M": 90,
                                                   "DP04_0089E": 846600, "DP04_0089M": 170462}},
        ("acs5", "profile", "place", 2023): {gid: {"DP05_0001E": 780, "DP05_0001M": 85,
                                                   "DP04_0089E": 924500, "DP04_0089M": 150000}},
    }
    s = summary(DP05_0001E=800, DP04_0089E=846600,
                median_home_value={"value": 924500, "source": "acs_raw",
                                   "as_of": "ACS 2020-2024 5-year"})
    doc = mod.build({gid: s}, 2024, key="", getter=fake_getter(tables))
    g = doc["geos"][gid]
    assert (g["DP04_0089E"]["y"], g["DP04_0089E"]["m"]) == (2024, 170462.0)
    shown = g["median_home_value"]
    assert (shown["e"], shown["y"], shown["s"], shown["m"]) == (924500, 2023, "acs5", 150000.0)
    assert "median_home_value" in doc["meta"]["variables"]
    # A Zillow value is not an ACS estimate, so it gets no entry.
    s["acsProfile"]["median_home_value"] = {"value": 924500, "source": "zhvi"}
    doc = mod.build({gid: s}, 2024, key="", getter=fake_getter(tables))
    assert "median_home_value" not in doc["geos"][gid]
    # A shown value no release published gets no margin, and says why.
    s["acsProfile"]["median_home_value"] = {"value": 700000, "source": "acs_raw"}
    doc = mod.build({gid: s}, 2024, key="", getter=fake_getter(tables))
    e = doc["geos"][gid]["median_home_value"]
    assert e["m"] is None and e.get("y") is None and "matches no published" in e["why"]


def test_an_unpublished_dataset_is_skipped_but_never_at_the_stamped_year():
    # The 2020 ACS 1-year was never released, and the API answers 404 for it.
    # An S0801 stored at 2022 makes the build try 2020 as a fallback year.
    gid = "0800012"
    tables = {
        ("acs5", "profile", "place"): {gid: {"DP05_0001E": 500, "DP05_0001M": 80}},
        ("acs5", "subject", "place", 2022): {gid: {"S0801_C01_046E": 24.3, "S0801_C01_046M": 6.1}},
    }
    s = summary(DP05_0001E=500)
    s["acsS0801"] = {"_acsYear": 2022, "S0801_C01_046E": 24.3}
    doc = mod.build({gid: s}, 2024, key="",
                    getter=fake_getter(tables, missing={(2020, "acs1")}))
    assert doc["geos"][gid]["S0801_C01_046E"]["m"] == 6.1
    assert doc["meta"]["not_published"] == ["2020 acs1 subject"]
    # The 5-year at the stamped year must exist; its absence still stops the build.
    import pytest
    with pytest.raises(SystemExit):
        mod.build({gid: s}, 2024, key="", getter=fake_getter(tables, missing={(2024, "acs5")}))


def test_census_get_reads_404_as_not_published(monkeypatch):
    import io
    import urllib.error

    def raise_code(code):
        def opener(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(b""))
        return opener
    monkeypatch.setattr(mod.urllib.request, "urlopen", raise_code(404))
    assert mod.census_get("https://api.census.gov/data/2020/acs/acs1/subject?get=X") == mod.NOT_PUBLISHED
    monkeypatch.setattr(mod.urllib.request, "urlopen", raise_code(500))
    assert mod.census_get("https://api.census.gov/data/2024/acs/acs5/profile?get=X") is None


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
            # A twin is the 5-year estimate ending the same year as a 1-year one.
            five = e.get("five")
            if five is not None:
                assert e["s"] == "acs1", f"{gid} {var}: a twin on a {e['s']} figure"
                assert (five["s"], five["y"]) == ("acs5", e["y"]), f"{gid} {var}: twin {five}"
    assert checked > 0


def test_a_one_year_figure_carries_its_five_year_twin():
    # Denver-sized geographies store the ACS 1-year. Each such entry also gives
    # the 5-year estimate ending the same year, with its own margin and tier,
    # so the page can show the difference; a 5-year figure carries none.
    big, small = "08031", "08003"
    tables = {
        ("acs1", "profile", "county"): {big: {
            "DP05_0001E": 729000, "DP05_0001M": -555555555,
            "DP04_0134E": 1870, "DP04_0134M": 30,
            "DP04_0141PE": 10.0, "DP04_0141PM": 1.2, "DP04_0142PE": 40.0, "DP04_0142PM": 1.6}},
        ("acs5", "profile", "county"): {
            big: {"DP05_0001E": 713000, "DP05_0001M": -555555555,
                  "DP04_0134E": 1781, "DP04_0134M": 22,
                  "DP04_0141PE": 9.0, "DP04_0141PM": 0.6, "DP04_0142PE": 41.0, "DP04_0142PM": 0.8},
            small: {"DP05_0001E": 16000, "DP05_0001M": -555555555,
                    "DP04_0134E": 900, "DP04_0134M": 80}},
    }
    sums = {big: summary(DP05_0001E=729000, DP04_0134E=1870, DP04_0141PE=10.0, DP04_0142PE=40.0),
            small: summary(DP05_0001E=16000, DP04_0134E=900)}
    doc = mod.build(sums, 2024, key="", getter=fake_getter(tables))
    rent = doc["geos"][big]["DP04_0134E"]
    assert (rent["s"], rent["e"], rent["m"]) == ("acs1", 1870, 30.0)
    assert rent["five"] == {"e": 1781, "m": 22.0, "s": "acs5", "y": 2024,
                            "cv": round((22.0 / 1.645) / 1781, 4), "t": "good"}
    burden = doc["geos"][big]["rent_burden_30plus"]
    assert burden["five"]["e"] == 50.0 and burden["five"]["m"] == 1.0
    assert doc["geos"][big]["DP05_0001E"]["five"]["m"] == 0.0
    assert "five" not in doc["geos"][small]["DP04_0134E"]
    assert "five" in doc["meta"]["fields"]


def test_a_geography_that_fell_back_a_year_does_not_stop_the_build():
    # build_hna_data.py stamps the year each profile came from; one that fell
    # back to 2023 sits among 2024 ones, and its year is fetched from here.
    import pytest
    sums = {"0800010": summary(), "0800011": {"acsProfile": {"_acsYear": "2023"}}}
    assert mod.vintage_of(sums) == 2024
    assert 2023 in mod.fallback_years(mod.vintage_of(sums))
    # Years further apart than the fallback window are not a fallback.
    with pytest.raises(SystemExit):
        mod.vintage_of({**sums, "0800012": {"acsProfile": {"_acsYear": "2019"}}})
    with pytest.raises(SystemExit):
        mod.vintage_of({"0800013": {"acsProfile": {}}})
