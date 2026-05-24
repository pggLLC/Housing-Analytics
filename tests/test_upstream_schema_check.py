from __future__ import annotations

import importlib.util
import io
import urllib.error
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest import mock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "upstream_schema_check",
    _ROOT / "scripts" / "audit" / "upstream-schema-check.py",
)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)  # type: ignore[union-attr]


class _DummyResponse:
    def __init__(self, payload: bytes, status: int = 200) -> None:
        self._payload = payload
        self.status = status

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> "_DummyResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def test_with_optional_census_key_only_touches_census_urls():
    with mock.patch.object(_MOD, "CENSUS_API_KEY", "test-key"):
        census_url = _MOD.build_https_url(
            _MOD._CENSUS_HOST,
            _MOD._CENSUS_ACS5_PATH,
            {"get": "NAME", "for": "state:08"},
        )
        fred_url = _MOD.build_https_url(
            _MOD._FRED_HOST,
            _MOD._FRED_OBSERVATIONS_PATH,
            {"series_id": "UNRATE"},
        )
        assert _MOD.with_optional_census_key(census_url).endswith("&key=test-key")
        assert _MOD.with_optional_census_key(fred_url) == fred_url


def test_http_json_strips_bom_and_jsonp_prefix_and_adds_key():
    url = _MOD.build_https_url(
        _MOD._CENSUS_HOST,
        _MOD._CENSUS_ACS5_PATH,
        {"get": "NAME", "for": "state:08"},
    )
    payload = "\ufeff/**/ \n[[\"NAME\"],[\"Colorado\"]]".encode("utf-8")

    def fake_urlopen(req, timeout):
        assert timeout == _MOD.TIMEOUT
        assert req.full_url.endswith("&key=test-key")
        return _DummyResponse(payload)

    with (
        mock.patch.object(_MOD, "CENSUS_API_KEY", "test-key"),
        mock.patch.object(_MOD.urllib.request, "urlopen", side_effect=fake_urlopen),
    ):
        assert _MOD.http_json(url) == [["NAME"], ["Colorado"]]


def test_http_json_reports_non_json_prefix():
    url = _MOD.build_https_url(
        _MOD._CENSUS_HOST,
        _MOD._CENSUS_ACS5_PATH,
        {"get": "NAME", "for": "state:08"},
    )

    with mock.patch.object(
        _MOD.urllib.request,
        "urlopen",
        return_value=_DummyResponse(b"<html>temporarily unavailable</html>"),
    ):
        with pytest.raises(RuntimeError, match="non-JSON response prefix"):
            _MOD.http_json(url)


def test_http_status_returns_http_error_code_and_adds_census_key():
    url = _MOD.build_https_url(
        _MOD._CENSUS_HOST,
        _MOD._CENSUS_ACS5_PATH,
        {"get": "NAME", "for": "state:08"},
    )
    seen = {}

    def fake_urlopen(req, timeout):
        seen["url"] = req.full_url
        raise urllib.error.HTTPError(
            req.full_url,
            429,
            "Too Many Requests",
            hdrs=None,
            fp=io.BytesIO(b""),
        )

    with (
        mock.patch.object(_MOD, "CENSUS_API_KEY", "test-key"),
        mock.patch.object(_MOD.urllib.request, "urlopen", side_effect=fake_urlopen),
    ):
        assert _MOD.http_status(url) == 429
    assert seen["url"].endswith("&key=test-key")


def test_census_urls_are_built_from_components():
    standard_url = _MOD.build_census_acs5_url({
        "get": "NAME,B19001_001E",
        "for": "state:08",
    })
    profile_url = _MOD.build_census_acs5_url({
        "get": "NAME,DP04_0001E",
        "for": "state:08",
    }, profile=True)

    parsed_standard = urlsplit(standard_url)
    parsed_profile = urlsplit(profile_url)

    assert parsed_standard.netloc == _MOD._CENSUS_HOST
    assert parsed_standard.path == _MOD._CENSUS_ACS5_PATH
    assert parse_qs(parsed_standard.query) == {
        "get": ["NAME,B19001_001E"],
        "for": ["state:08"],
    }

    assert parsed_profile.netloc == _MOD._CENSUS_HOST
    assert parsed_profile.path == _MOD._CENSUS_ACS5_PROFILE_PATH
    assert parse_qs(parsed_profile.query) == {
        "get": ["NAME,DP04_0001E"],
        "for": ["state:08"],
    }


def test_fred_url_is_built_from_components():
    url = _MOD.build_fred_observations_url({
        "series_id": "UNRATE",
        "limit": "1",
        "file_type": "json",
        "api_key": "demo-key",
    })
    parsed = urlsplit(url)

    assert parsed.netloc == _MOD._FRED_HOST
    assert parsed.path == _MOD._FRED_OBSERVATIONS_PATH
    assert parse_qs(parsed.query) == {
        "series_id": ["UNRATE"],
        "limit": ["1"],
        "file_type": ["json"],
        "api_key": ["demo-key"],
    }


def test_problematic_literal_api_urls_are_absent_from_source():
    source = (_ROOT / "scripts" / "audit" / "upstream-schema-check.py").read_text(encoding="utf-8")
    scheme = "".join(["htt", "ps"])

    census_base = f"{scheme}://{_MOD._CENSUS_HOST}{_MOD._CENSUS_ACS5_PATH}"
    fred_base = f"{scheme}://{_MOD._FRED_HOST}{_MOD._FRED_OBSERVATIONS_PATH}"

    assert census_base not in source
    assert f"{fred_base}?" not in source
