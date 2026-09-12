#!/usr/bin/env python3
"""Regression tests for the Colorado HUD AMI flattening guard."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import urllib.error
from contextlib import redirect_stderr
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "fetch_fmr_api.py"


def load_module():
    spec = importlib.util.spec_from_file_location("fetch_fmr_api", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def county(ami: int) -> dict:
    return {"income_limits": {"ami_4person": ami}}


def county_rows(module) -> list[dict]:
    return [
        {
            "state_code": "CO",
            "fips_code": fips + "99999",
            "county_name": name,
            "category": "County",
        }
        for fips, name in sorted(module._CO_COUNTY_NAMES_FULL.items())
    ]


def test_http_400_fails_county_income_limit_fetch(module) -> None:
    original_urlopen = module.urllib.request.urlopen
    attempts = 0

    def raise_400(request, timeout):
        nonlocal attempts
        attempts += 1
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", None, None)

    module.urllib.request.urlopen = raise_400
    try:
        try:
            module.fetch_county_income_limits("token-for-test", module.FY)
        except RuntimeError as exc:
            assert "county list request failed" in str(exc)
        else:
            raise AssertionError("HTTP 400 must fail the Income Limits fetch")
    finally:
        module.urllib.request.urlopen = original_urlopen
    assert attempts == 1, "deterministic HTTP 400 must not be retried"


def test_malformed_county_list_fails(module) -> None:
    original_get = module.http_get_json
    module.http_get_json = lambda url, token=None, transient_retries=0: {"data": {"counties": []}}
    try:
        try:
            module.fetch_county_income_limits("token-for-test", module.FY)
        except RuntimeError as exc:
            assert "expected a data array" in str(exc)
        else:
            raise AssertionError("malformed county-list response must fail")
    finally:
        module.http_get_json = original_get


def test_flattened_income_limit_results_fail(module) -> None:
    rows = county_rows(module)
    original_get = module.http_get_json
    original_sleep = module.time.sleep

    def fake_get(url, token=None, transient_retries=0):
        if url == module.HUD_IL_URL:
            return {"data": rows}
        return {"data": {"median_income": 107200}}

    module.http_get_json = fake_get
    module.time.sleep = lambda seconds: None
    try:
        try:
            module.fetch_county_income_limits("token-for-test", module.FY)
        except ValueError as exc:
            assert "look flattened" in str(exc)
        else:
            raise AssertionError("64 identical county Income Limits must fail")
    finally:
        module.http_get_json = original_get
        module.time.sleep = original_sleep


def test_documented_wrapped_results_produce_varied_counties(module) -> None:
    rows = county_rows(module)
    by_entity = {row["fips_code"]: idx for idx, row in enumerate(rows)}
    original_get = module.http_get_json
    original_sleep = module.time.sleep
    requested_urls: list[str] = []

    def fake_get(url, token=None, transient_retries=0):
        requested_urls.append(url)
        if url == module.HUD_IL_URL:
            return {"data": rows}
        entity_id = url.split("/il/data/", 1)[1].split("?", 1)[0]
        idx = by_entity[entity_id]
        return {
            "data": {
                "county_name": rows[idx]["county_name"],
                "year": str(module.IL_FY),
                "median_income": 80000 + (idx * 1000),
            }
        }

    module.http_get_json = fake_get
    module.time.sleep = lambda seconds: None
    try:
        result = module.fetch_county_income_limits("token-for-test", module.IL_FY)
    finally:
        module.http_get_json = original_get
        module.time.sleep = original_sleep

    assert len(result) == 64
    assert len({row["median_income"] for row in result.values()}) == 64
    assert requested_urls[0] == module.HUD_IL_URL
    assert any(
        f"/il/data/0800199999?year={module.IL_FY}" in url
        for url in requested_urls
    )
    assert all("/public/fmr/il/data/" not in url for url in requested_urls)


def test_transient_county_failure_fails_fast_without_writes(module) -> None:
    rows = county_rows(module)
    original_urlopen = module.urllib.request.urlopen
    original_sleep = module.time.sleep
    original_token = os.environ.get("HUD_API_TOKEN")
    original_outputs = (module.OUT_FMR_RAW, module.OUT_COMBINED, module.OUT_TRACT_MAP)
    requested_il_urls: list[str] = []

    class Response:
        def __init__(self, payload):
            self.payload = json.dumps(payload).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return self.payload

    def fake_urlopen(request, timeout):
        url = request.full_url
        if "/fmr/statedata/CO" in url:
            return Response({"data": {"counties": [{
                "fips_code": "08001",
                "Efficiency": 1000,
                "One-Bedroom": 1100,
                "Two-Bedroom": 1200,
                "Three-Bedroom": 1300,
                "Four-Bedroom": 1400,
            }]}})
        if url == module.HUD_IL_URL:
            return Response({"data": rows})
        if "/il/data/" in url:
            requested_il_urls.append(url)
            raise urllib.error.HTTPError(url, 503, "Service Unavailable", None, None)
        raise AssertionError(f"unexpected request: {url}")

    with tempfile.TemporaryDirectory() as tmp:
        module.OUT_FMR_RAW = str(Path(tmp) / "fmr.json")
        module.OUT_COMBINED = str(Path(tmp) / "combined.json")
        module.OUT_TRACT_MAP = str(Path(tmp) / "tract-map.json")
        module.urllib.request.urlopen = fake_urlopen
        module.time.sleep = lambda seconds: None
        os.environ["HUD_API_TOKEN"] = "token-for-test"
        stderr = io.StringIO()
        try:
            with redirect_stderr(stderr):
                result = module.main()
        finally:
            module.urllib.request.urlopen = original_urlopen
            module.time.sleep = original_sleep
            module.OUT_FMR_RAW, module.OUT_COMBINED, module.OUT_TRACT_MAP = original_outputs
            if original_token is None:
                os.environ.pop("HUD_API_TOKEN", None)
            else:
                os.environ["HUD_API_TOKEN"] = original_token

        message = stderr.getvalue()
        assert result == 1
        assert "request failed for county 08001" in message
        assert len(requested_il_urls) == module.IL_TRANSIENT_RETRIES + 1
        assert all("/il/data/0800199999?" in url for url in requested_il_urls), (
            "retry exhaustion must stop before requesting the remaining counties"
        )
        assert not any(Path(path).exists() for path in (
            str(Path(tmp) / "fmr.json"),
            str(Path(tmp) / "combined.json"),
            str(Path(tmp) / "tract-map.json"),
        )), "a failed county Income Limits fetch must write no output file"


def test_missing_county_ami_fails_with_specific_reason(module) -> None:
    row = county_rows(module)[0]
    original_get = module.http_get_json
    original_sleep = module.time.sleep
    calls = 0

    def fake_get(url, token=None, transient_retries=0):
        nonlocal calls
        calls += 1
        return {"data": {"county_name": row["county_name"], "median_income": None}}

    module.http_get_json = fake_get
    module.time.sleep = lambda seconds: None
    try:
        try:
            module.fetch_income_limit_index([row], "token-for-test", module.IL_FY)
        except RuntimeError as exc:
            assert "county 08001" in str(exc)
            assert "missing a county AMI" in str(exc)
        else:
            raise AssertionError("a county response without AMI must fail immediately")
    finally:
        module.http_get_json = original_get
        module.time.sleep = original_sleep

    assert calls == 1, "a missing county AMI must stop before any later county request"


def test_committed_county_names_match_canonical_map(module) -> None:
    payload = json.loads((ROOT / "data" / "hud-fmr-income-limits.json").read_text())
    records = payload["counties"]
    actual = {row["fips"]: row["county_name"] for row in records}
    assert len(records) == 64
    assert set(actual) == set(module._CO_COUNTY_NAMES_FULL)
    assert all(", CO" not in name for name in actual.values())
    assert actual == module._CO_COUNTY_NAMES_FULL


def main() -> int:
    module = load_module()
    assert module.HUD_IL_URL == (
        "https://www.huduser.gov/hudapi/public/fmr/listCounties/CO?updated=2025"
    )
    flattened = [county(module._CO_STATEWIDE_DEFAULT_AMI) for _ in range(46)]
    flattened.extend(county(90000 + (idx * 1000)) for idx in range(18))

    try:
        module.assert_distinct_county_amis(flattened)
    except ValueError as exc:
        assert "look flattened" in str(exc)
    else:
        raise AssertionError("flattened statewide-default AMIs should raise ValueError")

    healthy = [county(85000 + (idx * 1250)) for idx in range(64)]
    module.assert_distinct_county_amis(healthy)

    test_http_400_fails_county_income_limit_fetch(module)
    test_malformed_county_list_fails(module)
    test_flattened_income_limit_results_fail(module)
    test_documented_wrapped_results_produce_varied_counties(module)
    test_transient_county_failure_fails_fast_without_writes(module)
    print("  PASS: transient 5xx exhausts retries, fails fast, and writes no output")
    test_missing_county_ami_fails_with_specific_reason(module)
    print("  PASS: missing county AMI fails fast with its FIPS and reason")
    test_committed_county_names_match_canonical_map(module)
    print("  PASS: all 64 committed county names match the canonical map")

    print("fmr-flatten-guard: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
