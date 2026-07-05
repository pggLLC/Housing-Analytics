#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fmr_county_list_endpoint_uses_live_hud_route() -> None:
    mod = _load_script("fetch_fmr_api", ROOT / "scripts" / "fetch_fmr_api.py")

    assert mod.HUD_IL_URL == "https://www.huduser.gov/hudapi/public/fmr/listCounties/08"


def test_chas_http_get_rejects_empty_response() -> None:
    mod = _load_script("fetch_chas", ROOT / "scripts" / "fetch_chas.py")

    class EmptyResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return b""

    original_urlopen = mod.urllib.request.urlopen
    mod.urllib.request.urlopen = lambda req, timeout: EmptyResponse()
    try:
        try:
            mod.http_get("https://example.test/empty.zip")
        except RuntimeError as exc:
            assert "empty response body" in str(exc)
        else:
            raise AssertionError("http_get should reject an empty response body")
    finally:
        mod.urllib.request.urlopen = original_urlopen


if __name__ == "__main__":
    test_fmr_county_list_endpoint_uses_live_hud_route()
    test_chas_http_get_rejects_empty_response()
