#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check-source-liveness.py"

spec = importlib.util.spec_from_file_location("check_source_liveness", SCRIPT)
assert spec and spec.loader
check_source_liveness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_source_liveness)


def test_repo_relative_file_is_ok() -> None:
    result = check_source_liveness.check_url(
        "data/hna/jurisdiction-metrics-digest/0804000.json",
        "2026-07-05T00:00:00Z",
    )

    assert result["status_code"] == 200
    assert result["error_type"] == "ok"
    assert result["final_url"] == "data/hna/jurisdiction-metrics-digest/0804000.json"


def test_missing_repo_relative_file_is_client_error() -> None:
    result = check_source_liveness.check_url(
        "data/hna/jurisdiction-metrics-digest/does-not-exist.json",
        "2026-07-05T00:00:00Z",
    )

    assert result["status_code"] == 404
    assert result["error_type"] == "client_error"


def test_parent_traversal_is_rejected() -> None:
    result = check_source_liveness.check_url("../outside.json", "2026-07-05T00:00:00Z")

    assert result["status_code"] == 404
    assert result["error_type"] == "client_error"
    assert result["final_url"] == "../outside.json"


if __name__ == "__main__":
    test_repo_relative_file_is_ok()
    test_missing_repo_relative_file_is_client_error()
    test_parent_traversal_is_rejected()
