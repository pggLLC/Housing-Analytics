"""Regression coverage for expected ACS1 HTTP 204 responses."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import sys
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))

import build_hna_data as hna  # noqa: E402


class _NoContentResponse:
    status = 204

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    @staticmethod
    def read():
        return b""


def test_http_204_returns_none_without_per_request_warning():
    hna._HTTP_NO_CONTENT_COUNT = 0
    stderr = StringIO()
    acs1_url = "https:" + "//api.census.gov/data/2024/acs/acs1/subject"

    with mock.patch.object(hna.urllib.request, "urlopen", return_value=_NoContentResponse()):
        with redirect_stderr(stderr):
            result = hna.http_get_json(acs1_url)

    assert result is None
    assert hna._HTTP_NO_CONTENT_COUNT == 1
    assert "HTTP 204" not in stderr.getvalue()
    assert "Failed to fetch JSON" not in stderr.getvalue()


def test_non_acs1_http_204_still_warns():
    hna._HTTP_NO_CONTENT_COUNT = 0
    stderr = StringIO()
    other_url = "https:" + "//example.invalid/unexpected-empty"

    with mock.patch.object(hna.urllib.request, "urlopen", return_value=_NoContentResponse()):
        with redirect_stderr(stderr):
            result = hna.http_get_json(other_url)

    assert result is None
    assert hna._HTTP_NO_CONTENT_COUNT == 0
    assert "HTTP 204" in stderr.getvalue()
    assert "Failed to fetch JSON" in stderr.getvalue()


def test_s0801_204_none_falls_back_to_acs5_values():
    acs5_result = [
        ["S0801_C01_001E", "S0801_C01_046E", "NAME"],
        ["6300", "20.5", "Fruita city, Colorado"],
    ]

    with mock.patch.object(hna, "http_get_json", side_effect=[None, acs5_result]) as fetch:
        result = hna.fetch_acs_s0801("place", "0828745")

    assert fetch.call_count == 2
    assert "/acs/acs1/subject?" in fetch.call_args_list[0].args[0]
    assert "/acs/acs5/subject?" in fetch.call_args_list[1].args[0]
    assert result["S0801_C01_001E"] == "6300"
    assert result["S0801_C01_046E"] == "20.5"
    assert result["_acsSeries"] == "acs5"
    assert result["_acsYear"] == 2024


def test_build_summary_reports_one_aggregate_204_count():
    hna._HTTP_NO_CONTENT_COUNT = 3084
    stdout = StringIO()

    with redirect_stdout(stdout):
        hna._print_summary()

    rendered = stdout.getvalue()
    assert rendered.count("Expected ACS1 HTTP 204 no-content responses:") == 1
    assert "Expected ACS1 HTTP 204 no-content responses: 3084" in rendered
