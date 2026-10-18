"""The HNA summary says which ACS series its profile came from.

build_hna_data.py asks the ACS 1-year first and the 5-year second. The 1-year
answers for the state and for every county or place of 65,000 or more, so those
summaries hold 1-year figures. Until 2026-10-18 nothing in the fetch stamped
that, and the extended backfill's "acs5" stood on 33 of them (the White papers
check of the 11 large counties, then the margins file, found it). A 1-year
profile also carries its 5-year twin, so a builder that must compare like with
like has the 5-year figure.

Run: python3 -m pytest tests/test_build_hna_data_series_stamp.py -q
"""

import json
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))

import build_hna_data as hna  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import fetch_census_state_hna as state  # noqa: E402

FIXED_TIME = "2026-10-18T12:00:00Z"


def census(answers, refuse=()):
    """http_get_json that answers a profile request from answers[(year, series)]
    with every requested variable set to that source's value, and returns None
    (the ACS 1-year's "no content") for anything else, or for a request naming
    a variable in refuse[(year, series)]."""
    def get(url, *args, **kwargs):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if "/acs/acs1/" in url else "acs5"
        value = answers.get((year, series))
        if value is None or "/profile?" not in url:
            return None
        names = url.split("get=")[1].split("&")[0].split(",")
        if set(names) & set(dict(refuse).get((year, series), ())):
            return None
        return [names, [value if n != "NAME" else "Somewhere" for n in names]]
    return get


def fetch(answers, geo_type="county", geoid="08031", refuse=()):
    with (
        mock.patch.object(hna, "http_get_json", side_effect=census(answers, refuse)),
        mock.patch.object(hna, "_acs5_detail_tenure_for_geo", return_value=None),
    ):
        return hna.fetch_acs_profile(geo_type, geoid)


def test_a_one_year_profile_is_stamped_1_year_and_carries_its_5_year_twin():
    profile = fetch({(2024, "acs1"): "1940", (2024, "acs5"): "1781"})
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs1")
    assert profile["DP04_0134E"] == "1940"
    twin = profile["_acs5Profile"]
    assert (twin["_acsYear"], twin["_acsSeries"]) == ("2024", "acs5")
    assert twin["DP04_0134E"] == "1781" and twin["DP04_0047E"] == "1781"


def test_a_five_year_profile_is_stamped_5_year_with_no_twin():
    profile = fetch({(2024, "acs5"): "900"}, "place", "0803455")
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs5")
    assert "_acs5Profile" not in profile
    # A fallback year is stamped as the year that answered.
    profile = fetch({(2023, "acs5"): "880"}, "place", "0803455")
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2023", "acs5")


def test_later_batches_come_from_the_stamped_source_first():
    # Batch A's 1-year request fails, so it settles on the 5-year. The other
    # batches would answer from the 1-year if asked in the usual order; they
    # ask batch A's source first, so the profile is all one series.
    profile = fetch({(2024, "acs1"): "10", (2024, "acs5"): "20"},
                    refuse={(2024, "acs1"): ("DP05_0001E",)})
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs5")
    mixed = sorted(k for k, v in profile.items() if v == "10")
    assert mixed == [], f"fields from the 1-year under a 5-year stamp: {mixed[:5]}"
    assert len([v for v in profile.values() if v == "20"]) > 60


def test_the_series_stamp_survives_normalization():
    # As a number "acs1" reads as missing; that is how every S0801 stamp was lost.
    out = hna.normalize_acs_dict({"_acsSeries": "acs1", "_acsYear": "2024", "DP04_0134E": "-666666666"})
    assert out == {"_acsSeries": "acs1", "_acsYear": 2024, "DP04_0134E": None}


def test_the_summary_records_the_source_and_keeps_the_twin_only_for_1_year(tmp_path):
    summary_dir = tmp_path / "summary"
    summary_dir.mkdir()
    # A geography that used to be 1-year keeps no stale twin.
    (summary_dir / "08003.json").write_text(json.dumps({
        "acsProfile": {"_acsYear": "2024", "_acsSeries": "acs5", "DP03_0062E": 60000},
        "acs5Profile": {"_acsYear": "2023", "_acsSeries": "acs5", "DP04_0134E": 700},
    }))
    out = dict(hna.OUT)
    out["geo_config"] = str(ROOT / "data" / "hna" / "geo-config.json")
    out["summary_dir"] = str(summary_dir)

    def profile(_geo_type, geoid):
        base = {"NAME": geoid, "DP02_0001E": "100", "DP03_0062E": "75000", "DP04_0001E": "120",
                "DP04_0134E": "1940"}
        if geoid == "08031":
            return {**base, "_acsYear": "2024", "_acsSeries": "acs1",
                    "_acs5Profile": {"DP04_0134E": "1781", "_acsYear": "2024", "_acsSeries": "acs5"}}
        return {**base, "_acsYear": "2024", "_acsSeries": "acs5"}

    with (
        mock.patch.object(hna, "OUT", out),
        mock.patch.object(hna, "utc_now_z", return_value=FIXED_TIME),
        mock.patch.object(hna, "fetch_acs_profile", side_effect=profile),
        mock.patch.object(hna, "fetch_acs_s0801", return_value=None),
        mock.patch.object(hna, "fetch_acs_b08301", return_value=None),
    ):
        hna.build_summary_cache(max_workers=4)

    denver = json.loads((summary_dir / "08031.json").read_text())
    assert denver["acsProfile"]["_acsSeries"] == "acs1"
    assert "_acs5Profile" not in denver["acsProfile"]
    assert denver["acs5Profile"] == {"DP04_0134E": 1781, "_acsYear": 2024, "_acsSeries": "acs5"}
    assert denver["source"]["acs_profile_endpoint"] == "https://api.census.gov/data/2024/acs/acs1/profile"
    small = json.loads((summary_dir / "08003.json").read_text())
    assert small["acsProfile"]["_acsSeries"] == "acs5"
    assert "acs5Profile" not in small
    assert small["source"]["acs_profile_endpoint"] == "https://api.census.gov/data/2024/acs/acs5/profile"


def state_census(answers, refuse=()):
    """census() for the state: answers[(year, series)] for every variable."""
    def get(url, *args, **kwargs):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if "/acs/acs1/" in url else "acs5"
        value = answers.get((year, series))
        names = url.split("get=")[1].split("&")[0].split(",")
        if value is None or set(names) & set(refuse):
            return None
        return [names, [value for _ in names]]
    return get


def test_the_state_profile_is_stamped_with_the_series_that_answered():
    with mock.patch.object(state, "http_get_json", side_effect=state_census({(2024, "acs1"): "5957493"})):
        profile = state.fetch_acs_profile(2024, 3)
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs1")
    assert state.normalize_acs_dict(profile)["_acsSeries"] == "acs1"


def test_every_state_field_comes_from_the_stamped_source():
    # Codex, 2026-10-18: the state refresh replaced 29 fields from the 1-year
    # and kept the rest of 08.json, which the extended backfill had filled
    # from the 5-year, under the new 1-year stamp.
    answers = {(2024, "acs1"): "1", (2024, "acs5"): "5"}
    with mock.patch.object(state, "http_get_json", side_effect=state_census(answers)):
        profile = state.fetch_acs_profile(2024, 3)
    fields = {k: v for k, v in profile.items() if not k.startswith("_")}
    assert set(state.EXTENDED_PROFILE_VARS) <= set(fields)
    assert {v for v in fields.values()} == {"1"}, "a field came from another source"
    # A chunk the stamped source refuses is left out, never taken from another
    # source; main() keeps the previous value and names it.
    late = state.EXTENDED_PROFILE_VARS[-1]
    with mock.patch.object(state, "http_get_json", side_effect=state_census(answers, refuse=(late,))):
        profile = state.fetch_acs_profile(2024, 3)
    assert late not in profile and profile["_acsSeries"] == "acs1"
    assert {v for k, v in profile.items() if not k.startswith("_")} == {"1"}


def test_the_state_fetch_covers_every_field_the_state_summary_carries():
    # The agreement, not a list: each field in the committed 08.json, and each
    # one the extended backfill would fill, is fetched by the state refresh
    # or dropped there as legacy, so none sits under a stamp it did not share.
    import re
    fetched = set(state.ACS_PROFILE_VARS) | set(state.EXTENDED_PROFILE_VARS)
    dropped = set(state.LEGACY_PROFILE_KEYS)
    stored = json.loads((ROOT / "data" / "hna" / "summary" / "08.json").read_text())["acsProfile"]
    outside = sorted(k for k in stored if not k.startswith("_") and k != "state"
                     and k not in fetched | dropped)
    assert outside == [], f"state fields no fetch refreshes: {outside}"
    src = (ROOT / "scripts" / "backfill_hna_extended_acs_cache.mjs").read_text()
    batches = src[src.index("const BATCHES"):src.index("const REQUIRED")]
    backfill = set(re.findall(r"'(DP0\d_\d{4}P?E)'", batches))
    assert len(backfill) > 50, "the scan found the backfill's variables"
    assert sorted(backfill - fetched) == []
