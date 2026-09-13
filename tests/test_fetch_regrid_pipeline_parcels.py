"""Executable contract tests for the optional Regrid pipeline cache."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "market" / "fetch_regrid_pipeline_parcels.py"
CENTROIDS = ROOT / "data" / "co-place-centroids.json"
REPO_OUTPUT = ROOT / "data" / "affordable-housing" / "regrid-parcels-by-place.json"


class Response:
    """Small requests.Response stand-in used by the fetcher."""

    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
        self.text = "ok"

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _feature(parcel_id: str):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-105.9, 38.5]},
        "properties": {
            "address": "1 Test Way",
            "owner": "Test Owner",
            "parcelnumb": parcel_id,
            "ll_gisacre": 1.25,
            "usedesc": "Vacant residential",
            "zoning": "R-3",
            "owner_type": "private",
            "vacant": True,
            "yearbuilt": None,
            "county": "Chaffee",
            "state": "CO",
        },
    }


def _configure(monkeypatch, tmp_path: Path, *, token=None, missing_csv=False):
    csv_path = tmp_path / "pipeline.csv"
    if not missing_csv:
        csv_path.write_text(
            "geoid,jurisdiction\n0867280,Salida\n0812045,Carbondale\n",
            encoding="utf-8",
        )
    output_path = tmp_path / "regrid-output.json"
    monkeypatch.setenv("REGRID_PIPELINE_CSV", str(csv_path))
    monkeypatch.setenv("REGRID_CENTROIDS_PATH", str(CENTROIDS))
    monkeypatch.setenv("REGRID_OUTPUT_PATH", str(output_path))
    monkeypatch.setenv("REGRID_DELAY_SEC", "0")
    if token is None:
        monkeypatch.delenv("REGRID_API_KEY", raising=False)
    else:
        monkeypatch.setenv("REGRID_API_KEY", token)

    spec = importlib.util.spec_from_file_location(
        f"fetch_regrid_pipeline_parcels_{id(output_path)}", SCRIPT
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module, output_path


@pytest.fixture(autouse=True)
def repo_output_is_never_touched():
    before = REPO_OUTPUT.stat().st_mtime_ns
    yield
    assert REPO_OUTPUT.stat().st_mtime_ns == before


def test_deferred_without_token_makes_no_request_and_writes_null_counts(monkeypatch, tmp_path):
    mod, output = _configure(monkeypatch, tmp_path)

    def forbidden_request(*_args, **_kwargs):
        raise AssertionError("no request may be made while deferred")

    monkeypatch.setattr(mod.requests, "get", forbidden_request)
    assert mod.main() == 0

    data = json.loads(output.read_text(encoding="utf-8"))
    meta = data["meta"]
    assert meta["availability"] == "deferred"
    assert meta["is_current_coverage"] is False
    assert meta["total_parcels"] is None
    assert meta["api_calls"] == 0
    assert "not funded" in meta["unavailableReason"]
    assert "#1612" in meta["unavailableReason"]
    assert "not a technical failure" in meta["unavailableReason"]
    assert "Sunday" not in meta["next_refresh"]
    assert "scheduled run" not in meta["next_refresh"]
    assert all(record["parcel_count"] is None for record in data["byGeoid"].values())
    assert all(record["parcels"] == [] for record in data["byGeoid"].values())
    assert all(record.get("error") for record in data["byGeoid"].values())


def test_active_valid_responses_write_current_normalized_parcels(monkeypatch, tmp_path):
    mod, output = _configure(monkeypatch, tmp_path, token="test-token")
    urls = []

    def successful_request(url, **_kwargs):
        urls.append(url)
        return Response({
            "parcels": {
                "type": "FeatureCollection",
                "features": [_feature("parcel-a"), _feature("parcel-b")],
            }
        })

    monkeypatch.setattr(mod.requests, "get", successful_request)
    assert mod.main() == 0

    data = json.loads(output.read_text(encoding="utf-8"))
    meta = data["meta"]
    assert meta["availability"] == "active"
    assert meta["is_current_coverage"] is True
    assert meta["total_parcels"] == 4
    assert meta["api_calls"] == 2
    assert "unavailableReason" not in meta
    assert len(urls) == 2
    assert all("/parcels/point" in url and "token=test-token" in url for url in urls)
    for record in data["byGeoid"].values():
        assert record["parcel_count"] == 2
        props = record["parcels"][0]["properties"]
        assert {"parcelId", "acres", "landUseCode", "ownerType", "year_built"} <= set(props)


def test_all_unauthorized_requests_record_failed_unknown_coverage(monkeypatch, tmp_path):
    mod, output = _configure(monkeypatch, tmp_path, token="test-token")

    def unauthorized(*_args, **_kwargs):
        response = mod.requests.Response()
        response.status_code = 401
        response._content = b"unauthorized"
        raise mod.requests.HTTPError("unauthorized", response=response)

    monkeypatch.setattr(mod.requests, "get", unauthorized)
    assert mod.main() == 0

    data = json.loads(output.read_text(encoding="utf-8"))
    meta = data["meta"]
    assert meta["availability"] == "failed"
    assert meta["is_current_coverage"] is False
    assert meta["total_parcels"] is None
    assert meta["api_calls"] == 0
    assert "401" in meta["unavailableReason"]
    assert all(record["parcel_count"] is None for record in data["byGeoid"].values())
    assert all(record["error"].startswith("HTTP 401") for record in data["byGeoid"].values())


def test_partial_success_is_active_and_counts_only_measured_parcels(monkeypatch, tmp_path):
    mod, output = _configure(monkeypatch, tmp_path, token="test-token")
    calls = 0

    def partial_request(_url, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return Response({"parcels": {"features": [_feature("a"), _feature("b")]}})
        response = mod.requests.Response()
        response.status_code = 401
        response._content = b"unauthorized"
        raise mod.requests.HTTPError("unauthorized", response=response)

    monkeypatch.setattr(mod.requests, "get", partial_request)
    assert mod.main() == 0

    data = json.loads(output.read_text(encoding="utf-8"))
    assert data["meta"]["availability"] == "active"
    assert data["meta"]["is_current_coverage"] is True
    assert data["meta"]["total_parcels"] == 2
    assert data["meta"]["api_calls"] == 1
    assert data["byGeoid"]["0867280"]["parcel_count"] == 2
    assert data["byGeoid"]["0812045"]["parcel_count"] is None


def test_missing_pipeline_csv_raises_and_writes_nothing(monkeypatch, tmp_path):
    mod, output = _configure(monkeypatch, tmp_path, missing_csv=True)
    with pytest.raises(FileNotFoundError):
        mod.main()
    assert not output.exists()


def test_output_override_never_touches_the_committed_cache(monkeypatch, tmp_path):
    before = REPO_OUTPUT.stat().st_mtime_ns
    mod, output = _configure(monkeypatch, tmp_path)
    monkeypatch.setattr(
        mod.requests,
        "get",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("deferred mode must not make a request")
        ),
    )
    assert mod.main() == 0
    assert output.exists()
    assert REPO_OUTPUT.stat().st_mtime_ns == before
