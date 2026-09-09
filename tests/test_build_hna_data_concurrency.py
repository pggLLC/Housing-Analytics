"""Regression tests for deterministic concurrent ACS summary fetching."""

from contextlib import contextmanager
import os
from pathlib import Path
import sys
import threading
import time
from unittest import mock

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))

import build_hna_data as hna  # noqa: E402


FIXED_TIME = "2026-09-08T12:00:00Z"
PRODUCTION_GEOGRAPHY_COUNT = 546


class Activity:
    """Track how many fake network calls overlap."""

    def __init__(self):
        self.active = 0
        self.maximum = 0
        self.lock = threading.Lock()

    @contextmanager
    def call(self):
        with self.lock:
            self.active += 1
            self.maximum = max(self.maximum, self.active)
        try:
            time.sleep(0.001)
            yield
        finally:
            with self.lock:
                self.active -= 1


def _run_summary_build(root: Path, workers: int) -> tuple[dict[str, bytes], int]:
    summary_dir = root / "summary"
    summary_dir.mkdir(parents=True)
    out = dict(hna.OUT)
    out["geo_config"] = str(ROOT / "data" / "hna" / "geo-config.json")
    out["summary_dir"] = str(summary_dir)
    activity = Activity()

    def profile(_geo_type, geoid):
        with activity.call():
            return {
                "NAME": geoid,
                "DP02_0001E": "100",
                "DP03_0062E": "75000",
                "DP04_0001E": "120",
            }

    def commuting(_geo_type, geoid):
        with activity.call():
            return {
                "NAME": geoid,
                "S0801_C01_001E": "50",
                "_acsYear": 2024,
                "_acsSeries": "acs5",
            }

    def transportation(_geo_type, geoid):
        with activity.call():
            return {"total": 50, "drive": int(geoid[-1])}

    with (
        mock.patch.object(hna, "OUT", out),
        mock.patch.object(hna, "utc_now_z", return_value=FIXED_TIME),
        mock.patch.object(hna, "fetch_acs_profile", side_effect=profile),
        mock.patch.object(hna, "fetch_acs_s0801", side_effect=commuting),
        mock.patch.object(hna, "fetch_acs_b08301", side_effect=transportation),
    ):
        hna.build_summary_cache(max_workers=workers)

    files = {path.name: path.read_bytes() for path in sorted(summary_dir.glob("*.json"))}
    return files, activity.maximum


def test_all_production_geographies_are_byte_identical_serial_vs_concurrent(tmp_path):
    serial, serial_overlap = _run_summary_build(tmp_path / "serial", workers=1)
    concurrent, concurrent_overlap = _run_summary_build(tmp_path / "concurrent", workers=4)

    assert serial == concurrent
    assert len(serial) == PRODUCTION_GEOGRAPHY_COUNT
    assert serial_overlap == 1
    assert concurrent_overlap > 1


def test_acs_json_fetch_uses_eight_second_ceiling_and_preserves_single_attempt():
    with (
        mock.patch.dict(os.environ, {"HNA_ACS_HTTP_TIMEOUT_SECONDS": "8"}),
        mock.patch.object(hna, "http_get_text", return_value=(200, '{"ok": true}')) as fetch,
    ):
        assert hna.http_get_json("http://127.0.0.1/acs-fixture") == {"ok": True}

    fetch.assert_called_once_with(
        "http://127.0.0.1/acs-fixture", timeout=8, retries=1
    )


def test_shared_detail_tenure_lookup_is_fetched_once_under_concurrency():
    county = [["NAME", "county"], ["Adams County", "001"]]
    place = [["NAME", "place"], ["Aurora city", "04000"]]

    def response(_url):
        time.sleep(0.01)
        return county if response.calls == 0 else place

    response.calls = 0

    def counted_response(url):
        value = response(url)
        response.calls += 1
        return value

    with (
        mock.patch.object(hna, "_ACS5_DETAIL_TENURE_CACHE", None),
        mock.patch.object(hna, "_ACS5_DETAIL_TENURE_CACHE_KEY", None),
        mock.patch.object(hna, "http_get_json", side_effect=counted_response) as fetch,
    ):
        threads = [
            threading.Thread(
                target=hna._fetch_acs5_detail_tenure_lookup,
                args=([2024],),
            )
            for _ in range(6)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert fetch.call_count == 2


def test_phase_selection_runs_only_the_requested_phase():
    with (
        mock.patch.dict(os.environ, {"HNA_BUILD_PHASES": "acs"}, clear=False),
        mock.patch.object(hna, "ensure_dirs"),
        mock.patch.object(hna, "write_geo_config") as geo_config,
        mock.patch.object(hna, "build_summary_cache") as summary,
        mock.patch.object(hna, "build_geo_derived_inputs") as derived,
        mock.patch.object(hna, "build_lehd_by_county") as lehd,
        mock.patch.object(hna, "build_lehd_wac_snapshots") as lehd_wac,
        mock.patch.object(hna, "build_dola_sya_by_county") as dola,
        mock.patch.object(hna, "build_dola_projections_by_county") as projections,
        mock.patch.object(hna, "stamp_home_value_cascade") as stamp,
        mock.patch.object(hna, "_print_summary"),
    ):
        hna.main()

    summary.assert_called_once_with()
    derived.assert_called_once_with()
    geo_config.assert_not_called()
    lehd.assert_not_called()
    lehd_wac.assert_not_called()
    dola.assert_not_called()
    projections.assert_not_called()
    stamp.assert_not_called()


def test_phase_selection_rejects_unknown_phase():
    with mock.patch.dict(os.environ, {"HNA_BUILD_PHASES": "acs,unknown"}, clear=False):
        with pytest.raises(ValueError, match="unknown"):
            hna.selected_build_phases()


def test_workflow_checkpoints_each_completed_network_phase():
    workflow = (ROOT / ".github" / "workflows" / "build-hna-data.yml").read_text(
        encoding="utf-8"
    )

    for phase in ("acs", "lehd", "dola"):
        key = f"hna-build-${{{{ github.run_id }}}}-{phase}-v1"
        assert f"HNA_BUILD_PHASES: '{phase}'" in workflow
        assert workflow.count(key) == 2
    assert workflow.count("uses: actions/cache/restore@v5") == 3
    assert workflow.count("uses: actions/cache/save@v5") == 3
