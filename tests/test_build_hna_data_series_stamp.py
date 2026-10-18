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


def answer(value, name):
    """A source's answer for one variable: value itself, or value[name] (else
    value["*"]) when a test needs variables to differ."""
    return value.get(name, value.get("*")) if isinstance(value, dict) else value


def census(answers, refuse=()):
    """http_get_json that answers a profile request from answers[(year, series)]
    (see answer()), and returns None (the ACS 1-year's "no content") for
    anything else, or for a request naming a variable in refuse[(year, series)]."""
    def get(url, *args, **kwargs):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if "/acs/acs1/" in url else "acs5"
        value = answers.get((year, series))
        if value is None or "/profile?" not in url:
            return None
        names = url.split("get=")[1].split("&")[0].split(",")
        if set(names) & set(dict(refuse).get((year, series), ())):
            return None
        return [names, [answer(value, n) if n != "NAME" else "Somewhere" for n in names]]
    return get


def fetch(answers, geo_type="county", geoid="08031", refuse=()):
    with (
        mock.patch.object(hna, "http_get_json", side_effect=census(answers, refuse)),
        mock.patch.object(hna, "_acs5_detail_tenure_for_geo", return_value=None),
    ):
        return hna.fetch_acs_profile(geo_type, geoid)


def test_a_one_year_profile_is_stamped_1_year_and_carries_its_5_year_twin():
    profile = fetch({(2024, "acs1"): {"DP04_0134E": "1940", "DP04_0047E": "171900", "*": "1"},
                     (2024, "acs5"): {"DP04_0134E": "1781", "DP04_0047E": "165432", "*": "5"}})
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs1")
    assert profile["DP04_0134E"] == "1940" and profile["DP04_0047E"] == "171900"
    twin = profile["_acs5Profile"]
    assert (twin["_acsYear"], twin["_acsSeries"]) == ("2024", "acs5")
    # Each field from its own variable, not one value for the whole source.
    assert twin["DP04_0134E"] == "1781" and twin["DP04_0047E"] == "165432"


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


def state_census(answers, refuse=(), asked=None):
    """census() for the state: answers[(year, series)] (see answer()). Records
    each requested variable in asked, when given."""
    def get(url, *args, **kwargs):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if "/acs/acs1/" in url else "acs5"
        value = answers.get((year, series))
        names = url.split("get=")[1].split("&")[0].split(",")
        if asked is not None:
            asked.extend((year, n) for n in names)
        if value is None or set(names) & set(refuse):
            return None
        return [names, [answer(value, n) for n in names]]
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
    # And every profile field the county and place build fetches, so the state
    # has the same panels with the same 2024 codes (Codex, 2026-10-18: the
    # race panel reads DP05_0090E and DP05_0096E, which the state never asked).
    hsrc = (ROOT / "scripts" / "hna" / "build_hna_data.py").read_text()
    county = set(re.findall(r"'(DP0\d_\d{4}P?E)'", hsrc[hsrc.index("    vars_a = ["):hsrc.index("    vars_ = vars_a +")]))
    assert len(county) > 100, "the scan found the county build's variables"
    assert sorted(county - fetched) == []


def test_the_state_asks_each_year_for_its_own_variable_number():
    # DP05_0096E (not Hispanic, White alone) is DP05_0082E in 2023. A state
    # that fell back a year asks for that number and stores it as DP05_0096E,
    # the name the race panel reads.
    asked = []
    answers = {(2023, "acs1"): {"DP05_0082E": "3800000", "*": "7"}}
    with mock.patch.object(state, "http_get_json", side_effect=state_census(answers, asked=asked)):
        profile = state.fetch_acs_profile(2024, 3)
    assert profile["_acsYear"] == "2023"
    assert profile["DP05_0096E"] == "3800000"
    assert (2023, "DP05_0082E") in asked and (2023, "DP05_0096E") not in asked
    asked.clear()
    with mock.patch.object(state, "http_get_json", side_effect=state_census({(2024, "acs1"): "1"}, asked=asked)):
        state.fetch_acs_profile(2024, 3)
    assert (2024, "DP05_0096E") in asked


def test_the_detail_tables_carry_their_own_year():
    # Copilot, 2026-10-18: the profile can fall back to 2023 while B25003 and
    # B25075 answer for 2024, so their label needs their own year.
    def get(url, *args, **kwargs):
        if "/2023/acs/acs5?" not in url:
            return None
        names = url.split("get=")[1].split("&")[0].split(",")
        scope = "county" if "for=county" in url else "place"
        return [names + [scope], ["1" for _ in names] + ["031" if scope == "county" else "20000"]]
    with (
        mock.patch.object(hna, "_ACS5_DETAIL_TENURE_CACHE", None),
        mock.patch.object(hna, "_ACS5_DETAIL_TENURE_CACHE_KEY", None),
        mock.patch.object(hna, "http_get_json", side_effect=get),
    ):
        lookup = hna._fetch_acs5_detail_tenure_lookup_locked([2024, 2023, 2022])
    assert lookup["08031"]["_acs5DetailYear"] == "2023"
    assert lookup["0820000"]["_acs5DetailYear"] == "2023"


def test_the_5_year_twin_keeps_fields_only_from_its_own_year(tmp_path):
    # Copilot, 2026-10-18: a 2023 twin's rent restored into a 2024 twin whose
    # rent came back empty would be published as a 2020-2024 figure.
    path = tmp_path / "08031.json"

    def merged(old_twin, new_twin):
        path.write_text(json.dumps({"acs5Profile": old_twin}))
        payload, _, _ = hna._merge_preserve_summary(str(path), {"acs5Profile": dict(new_twin)})
        return payload["acs5Profile"]

    old = {"_acsYear": 2023, "_acsSeries": "acs5", "DP04_0134E": 1700, "DP04_0047E": 90000}
    new = {"_acsYear": 2024, "_acsSeries": "acs5", "DP04_0134E": None, "DP04_0047E": 91000}
    assert merged(old, new)["DP04_0134E"] is None
    # The same year keeps a field the fresh fetch lost, as for any section.
    assert merged({**old, "_acsYear": 2024}, new)["DP04_0134E"] == 1700
    # A twin lost whole is kept whole, with its own stamp; the rent file then
    # reads its year and leaves the row unavailable.
    lost = merged(old, {"_acsYear": 2024, "_acsSeries": "acs5"})
    assert lost == old
