#!/usr/bin/env python3
"""Regression tests for the Colorado HUD AMI flattening guard."""

from __future__ import annotations

import importlib.util
import urllib.error
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
    assert any("/il/data/0800199999?year=2025" in url for url in requested_urls)
    assert all("/public/fmr/il/data/" not in url for url in requested_urls)


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

    print("fmr-flatten-guard: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
