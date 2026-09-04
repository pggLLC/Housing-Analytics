"""Regression coverage for Census API-key redaction in market builder logs."""

import logging
from pathlib import Path
import sys
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))

import acs_etl  # noqa: E402
import market_data_builder as builder  # noqa: E402


def test_market_fetches_log_census_key_as_redacted(monkeypatch, caplog):
    key = "census-secret-key"
    monkeypatch.setenv("CENSUS_API_KEY", key)

    with mock.patch.object(builder, "_get", return_value=[]):
        with caplog.at_level(logging.DEBUG, logger=builder.__name__):
            builder.fetch_tracts_for_county("031", key)
            builder.fetch_county_aggregates(["031"], key)

    rendered = caplog.text
    assert rendered.count("key=***") == 2
    assert "GET (county fallback)" in rendered
    assert key not in rendered


def test_county_fetch_logs_url_without_key_unchanged(monkeypatch, caplog):
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)

    with mock.patch.object(builder, "_get", return_value=[]):
        with caplog.at_level(logging.DEBUG, logger=builder.__name__):
            builder.fetch_county_aggregates(["031"], None)

    expected = builder.build_url(
        builder.ACS_DATASET,
        ["NAME"] + list(builder.TRACT_VARIABLES.keys()),
        {"for": "county:031", "in": f"state:{builder.STATE_FIPS}"},
        None,
    )
    assert f"GET (county fallback) {expected}" in caplog.text


def test_redact_without_long_environment_key_does_not_corrupt_url(monkeypatch):
    url = "https://api.census.gov/data?get=NAME&key=short"

    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    assert acs_etl._redact(url) == url

    monkeypatch.setenv("CENSUS_API_KEY", "short")
    assert acs_etl._redact(url) == url
