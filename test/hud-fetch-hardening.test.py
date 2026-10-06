#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def _load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fmr_county_list_endpoint_uses_live_hud_route() -> None:
    mod = _load_script("fetch_fmr_api", ROOT / "scripts" / "fetch_fmr_api.py")

    assert mod.HUD_IL_URL == (
        "https://www.huduser.gov/hudapi/public/fmr/listCounties/CO?updated=2025"
    )


def test_chas_http_get_rejects_bot_challenges() -> None:
    mod = _load_script("fetch_chas", ROOT / "scripts" / "fetch_chas.py")

    class Response:
        def __init__(self, status, content_type, body):
            self.status = status
            self.headers = {'Content-Type': content_type}
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return self.body

    cases = [
        (202, 'application/zip', b'PK'),
        (200, 'text/HTML; charset=utf-8', b'PK'),
        (200, 'application/zip', b''),
        (200, 'application/octet-stream', b'<html>challenge</html>'),
    ]
    checked = 0
    for status, content_type, body in cases:
        with patch.object(mod.urllib.request, 'urlopen', return_value=Response(status, content_type, body)):
            try:
                mod.http_get(mod.CHAS_STATE_URL)
            except mod.HudBotChallengeError as exc:
                assert 'HUD bot challenge' in str(exc)
                checked += 1
            else:
                raise AssertionError(f'accepted non-ZIP response: {status}, {content_type}, {body!r}')
    assert checked == 4
    with patch.object(mod.urllib.request, 'urlopen', return_value=Response(200, 'application/zip', b'PK\x03\x04')):
        assert mod.http_get(mod.CHAS_STATE_URL) == b'PK\x03\x04'


def test_chas_manual_cache_precedes_network() -> None:
    mod = _load_script("fetch_chas", ROOT / "scripts" / "fetch_chas.py")
    assert mod.CACHE_PATH == str(ROOT / '.cache' / 'chas_140_csv.zip')
    with TemporaryDirectory() as directory:
        cached = Path(directory) / 'chas_140_csv.zip'
        cached.write_bytes(b'PK\x03\x04manual-archive')
        with patch.object(mod, 'CACHE_PATH', str(cached)), patch.object(mod, 'http_get') as network:
            assert mod._download_or_cache() == cached.read_bytes()
            network.assert_not_called()


if __name__ == "__main__":
    test_fmr_county_list_endpoint_uses_live_hud_route()
    test_chas_http_get_rejects_bot_challenges()
    test_chas_manual_cache_precedes_network()
