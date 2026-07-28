#!/usr/bin/env python3
"""Regression tests for the Colorado HUD AMI flattening guard."""

from __future__ import annotations

import importlib.util
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


def main() -> int:
    module = load_module()
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

    print("fmr-flatten-guard: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
