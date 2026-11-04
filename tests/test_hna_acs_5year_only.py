"""Every HNA geography uses the ACS 5-year (owner decision 2026-11-04).

build_hna_data.py and fetch_census_state_hna.py used to ask the ACS 1-year
first, so the state, 12 counties and 20 cities of 65,000 or more ran on the
2025 1-year while every other place ran on the 2020-2024 5-year. That put two
periods side by side in town-vs-county comparisons and divided 5-year town
households by 1-year county households in the place projection. By default
both builders now ask the 5-year only, and a summary that moves from the
1-year to the 5-year keeps none of its old 1-year figures.

Run: python3 -m pytest tests/test_hna_acs_5year_only.py -q
"""

import json
import sys
from pathlib import Path
from unittest import mock

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))
sys.path.insert(0, str(ROOT / "scripts"))

import build_hna_data as hna  # noqa: E402
import fetch_census_state_hna as state  # noqa: E402


@pytest.fixture(autouse=True)
def _default_env(monkeypatch):
    for k in ("HNA_ACS_INCLUDE_1YEAR", "ACS_START_YEAR", "ACS1_START_YEAR", "ACS_FALLBACK_YEARS"):
        monkeypatch.delenv(k, raising=False)


def census(answers):
    """http_get_json answering a profile request from answers[(year, series)]."""
    def get(url, *args, **kwargs):
        year = int(url.split("/data/")[1].split("/")[0])
        series = "acs1" if ("/acs/acs1/" in url or "/acs/acs1?" in url) else "acs5"
        value = answers.get((year, series))
        if value is None:
            return None
        names = url.split("get=")[1].split("&")[0].split(",")
        return [names, [value if n != "NAME" else "Somewhere" for n in names]]
    return get


def test_the_default_attempts_are_the_5_year_only():
    assert hna.acs_attempts() == [(2024, "acs5"), (2023, "acs5"), (2022, "acs5")]
    assert state.acs_series() == ("acs5",)
    assert state.acs_start_year() == 2024


def test_the_1_year_comes_back_only_when_asked(monkeypatch):
    monkeypatch.setenv("HNA_ACS_INCLUDE_1YEAR", "1")
    assert hna.acs_attempts()[0] == (2025, "acs1")
    assert state.acs_series() == ("acs1", "acs5")


def test_a_large_county_gets_its_5_year_profile_even_when_the_1_year_answers():
    answers = {(2025, "acs1"): "1", (2024, "acs1"): "1", (2024, "acs5"): "5"}
    with (
        mock.patch.object(hna, "http_get_json", side_effect=census(answers)),
        mock.patch.object(hna, "_acs5_detail_tenure_for_geo", return_value=None),
    ):
        profile = hna.fetch_acs_profile("county", "08031")
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs5")
    assert "_acs5Profile" not in profile
    assert profile["DP04_0134E"] == "5"


def test_the_state_gets_its_5_year_profile():
    answers = {(2025, "acs1"): "1", (2024, "acs1"): "1", (2024, "acs5"): "5"}
    with mock.patch.object(state, "http_get_json", side_effect=census(answers)):
        profile = state.fetch_acs_profile(state.acs_start_year(), 3)
    assert (profile["_acsYear"], profile["_acsSeries"]) == ("2024", "acs5")


def test_moving_from_the_1_year_keeps_no_1_year_figures(tmp_path):
    path = tmp_path / "08031.json"
    path.write_text(json.dumps({"acsProfile": {
        "_acsYear": "2025", "_acsSeries": "acs1",
        "DP02_0001E": 330000, "DP04_0134E": 1985,
        # Written by the 5-year extended backfill, never asked for by this build.
        "DP04_0076E": 300000, "_acs5BackfillYear": "2024",
    }}))
    fresh = {"_acsYear": "2024", "_acsSeries": "acs5", "DP02_0001E": 320000, "DP04_0134E": None}
    payload, _, _ = hna._merge_preserve_summary(str(path), {"acsProfile": dict(fresh)})
    prof = payload["acsProfile"]
    assert prof["DP02_0001E"] == 320000
    # The 5-year rent came back empty; the 1-year rent must not fill it.
    assert prof["DP04_0134E"] is None
    # The backfill's own 5-year field and its stamp carry over.
    assert prof["DP04_0076E"] == 300000 and prof["_acs5BackfillYear"] == "2024"
    assert prof["_acsSeries"] == "acs5"


def test_commuting_modes_moving_from_the_1_year_keep_no_1_year_counts(tmp_path):
    # B08301 has no stamp of its own; its series is read from the source endpoint.
    path = tmp_path / "08031.json"
    path.write_text(json.dumps({
        "acsB08301": {"total": 400000, "transit": 5},
        "source": {"acs_b08301_endpoint": "https://api.census.gov/data/2025/acs/acs1"},
    }))
    payload = {
        "acsB08301": {"total": 390000, "transit": None},
        "source": {"acs_b08301_endpoint": "https://api.census.gov/data/2024/acs/acs5"},
    }
    merged, _, _ = hna._merge_preserve_summary(str(path), payload)
    assert merged["acsB08301"]["total"] == 390000
    assert merged["acsB08301"]["transit"] is None


def test_browser_fallback_asks_the_5_year_unless_opted_in():
    js = (ROOT / "js" / "hna" / "hna-controller.js").read_text(encoding="utf-8")
    assert "const include1y = window.HNAUtils.ACS_INCLUDE_1YEAR === true;" in js
    assert "include1y ? await fetchMergedProfile(window.HNAUtils.ACS_YEAR_PRIMARY, 'acs/acs1/profile'" in js
    assert "geoType !== 'cdp' && window.HNAUtils.ACS_INCLUDE_1YEAR === true" in js


def test_a_failed_batch_does_not_let_1_year_fields_through(tmp_path, monkeypatch):
    # Batch B failed, so DP03_0052E is absent from the response, not null.
    monkeypatch.setattr(hna, "PROFILE_REQUESTED_VARS", {"DP02_0001E", "DP03_0052E"})
    path = tmp_path / "08031.json"
    path.write_text(json.dumps({"acsProfile": {
        "_acsYear": "2025", "_acsSeries": "acs1", "DP02_0001E": 330000, "DP03_0052E": 22036,
        "DP04_0076E": 300000, "_acs5BackfillYear": "2024",
    }}))
    fresh = {"_acsYear": "2024", "_acsSeries": "acs5", "DP02_0001E": 320000}
    prof = hna._merge_preserve_summary(str(path), {"acsProfile": dict(fresh)})[0]["acsProfile"]
    assert "DP03_0052E" not in prof
    assert prof["DP04_0076E"] == 300000


def test_the_rent_burden_series_stamp_survives_normalization():
    out = hna.normalize_acs_dict({"_b25070Series": "acs5", "_acsSeries": "acs5", "_b25070Year": "2024", "B25070_001E": "-666666666"})
    assert out["_b25070Series"] == "acs5" and out["_acsSeries"] == "acs5"
    assert out["B25070_001E"] is None
