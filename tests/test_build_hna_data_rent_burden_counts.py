"""B25070 rent-burden counts ride with the profile release they describe."""
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))
import build_hna_data as hna  # noqa: E402

# Fruita (city), ACS 2020-2024 5-year, table B25070.
FRUITA = {"B25070_001E": "1061", "B25070_007E": "52", "B25070_008E": "72",
          "B25070_009E": "77", "B25070_010E": "165", "B25070_011E": "221"}


def test_counts_come_from_the_requested_release():
    seen = []

    def census(url, *a, **k):
        seen.append(url)
        names = url.split("get=")[1].split("&")[0].split(",")
        return [names + ["state", "place"], [FRUITA[n] for n in names] + ["08", "28745"]]

    with mock.patch.object(hna, "http_get_json", side_effect=census):
        out = hna._fetch_rent_burden_counts("place", "0828745", 2024, "acs5")
    assert seen[0].startswith("https://api.census.gov/data/2024/acs/acs5?get=")
    assert "for=place:28745&in=state:08" in seen[0]
    assert out["B25070_010E"] == "165" and out["B25070_011E"] == "221"
    assert (out["_b25070Year"], out["_b25070Series"]) == ("2024", "acs5")


def test_no_answer_means_no_counts():
    with mock.patch.object(hna, "http_get_json", return_value=None), \
         mock.patch.object(hna, "TRANSIENT_RETRY_PAUSES", ()):
        assert hna._fetch_rent_burden_counts("county", "08077", 2025, "acs1") is None


def test_counts_and_stamp_are_preserved_or_refreshed_together(tmp_path):
    old = {"acsProfile": {**FRUITA, "_b25070Year": "2023", "_b25070Series": "acs5"}}
    path = tmp_path / "s.json"
    path.write_text(__import__("json").dumps(old))
    new = {"acsProfile": {"B25070_001E": "1100", "_b25070Year": "2024", "_b25070Series": "acs5"}}
    merged, _, _ = hna._merge_preserve_summary(str(path), new)
    prof = merged["acsProfile"]
    assert prof["_b25070Year"] == "2023" and prof["B25070_001E"] == "1061"
