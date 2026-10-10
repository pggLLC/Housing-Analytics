"""scripts/fetch_co_construction_labor_cost.py: YoY arithmetic, absence handling
and the failure path, plus the committed file against its JSON Schema."""
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "fetch_co_construction_labor_cost", ROOT / "scripts" / "fetch_co_construction_labor_cost.py")
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

SCHEMA = json.loads((ROOT / "schemas" / "co-construction-labor-cost.schema.json").read_text())
NOW = datetime(2026, 10, 10, tzinfo=timezone.utc)


def bls_rows(values, prelim_last=True):
    """{'YYYY-MM': value-string} -> BLS API `data` rows, newest first as BLS sends them."""
    rows = []
    periods = sorted(values)
    for p in periods:
        y, mo = p.split("-")
        rows.append({"year": y, "period": f"M{mo}", "value": values[p],
                     "footnotes": [{"code": "P", "text": "Preliminary"}] if prelim_last and p == periods[-1] else [{}]})
    return list(reversed(rows))


def monthly_raw(level=40.0, step=0.1):
    vals = {}
    for i in range(30):
        p = m.shift_period("2024-03", i)
        vals[p] = f"{level + step * i:.2f}"
    return vals


def full_raw():
    raw = {s["id"]: {"data": bls_rows(monthly_raw()), "messages": []} for s in m.MONTHLY_SERIES}
    for a in m.OEWS_AREAS:
        for o in m.OEWS_OCCUPATIONS:
            raw[m.oews_series_id(a, o["soc"], "01")] = {"data": [{"year": "2025", "period": "A01", "value": "1,230", "footnotes": []}]}
            raw[m.oews_series_id(a, o["soc"], "03")] = {"data": [{"year": "2025", "period": "A01", "value": "31.50", "footnotes": []}]}
    return raw


FRED = {"series": {"WPUIP231120": {"observations": [
    {"date": "2025-08-01", "value": "100.0"}, {"date": "2026-07-01", "value": "."},
    {"date": "2026-08-01", "value": "103.0"}]}}}


def test_shift_period_crosses_year():
    assert m.shift_period("2026-01", -1) == "2025-12"
    assert m.shift_period("2026-08", -12) == "2025-08"
    assert m.shift_period("2025-12", 1) == "2026-01"


@pytest.mark.parametrize("raw", [None, "", "-", ".", "*", "(5)", "n/a"])
def test_parse_number_never_coerces_absence_to_zero(raw):
    assert m.parse_number(raw) is None


def test_parse_number_reads_bls_strings():
    assert m.parse_number("1,230") == 1230.0
    assert m.parse_number("0") == 0.0  # a real zero is still a number; callers guard <= 0 where 0 means unknown


def test_yoy_pct_and_pts():
    vals = {"2025-08": 40.0, "2026-08": 42.0}
    assert m.yoy_change(vals, "2026-08", "pct") == 5.0
    assert m.yoy_change(vals, "2026-08", "pts") == 2.0


def test_yoy_null_when_a_side_is_missing_or_base_is_zero():
    assert m.yoy_change({"2026-08": 42.0}, "2026-08", "pct") is None
    assert m.yoy_change({"2025-08": 0.0, "2026-08": 42.0}, "2026-08", "pct") is None
    # A rate can legitimately be 0 a year earlier; a point change is still defined.
    assert m.yoy_change({"2025-08": 0.0, "2026-08": 1.5}, "2026-08", "pts") == 1.5


def test_observations_drop_annual_average_and_blank_values():
    data = [{"year": "2026", "period": "M13", "value": "40", "footnotes": []},
            {"year": "2026", "period": "M02", "value": "-", "footnotes": []},
            {"year": "2026", "period": "M01", "value": "41.5", "footnotes": [{"code": "P"}]}]
    assert m.bls_monthly_observations(data) == [{"period": "2026-01", "value": 41.5, "preliminary": True}]


def test_missing_series_is_null_with_reason_not_zero():
    spec = m.MONTHLY_SERIES[0]
    for raw in (None, {"data": [], "messages": ["No Data Available for Series X Year: 2026"]}):
        entry = m.build_monthly_series(spec, raw)
        assert entry["observations"] == [] and entry["latest"] is None and entry["yoy"] is None
        assert entry["unavailableReason"] and entry["yoyUnavailableReason"]


def test_latest_and_yoy_follow_observations():
    entry = m.build_monthly_series(m.MONTHLY_SERIES[1], {"data": bls_rows(monthly_raw())})
    assert entry["latest"] == {"period": "2026-08", "value": 42.9, "preliminary": True}
    assert entry["yoy"] == {"period": "2026-08", "value": round((42.9 / 41.7 - 1) * 100, 2), "basis": "pct"}
    assert entry["unavailableReason"] is None


def test_oews_suppressed_cell_is_null_with_reason():
    raw = full_raw()
    pueblo = m.OEWS_AREAS[-1]
    raw[m.oews_series_id(pueblo, "47-2221", "03")] = {"data": [
        {"year": "2025", "period": "A01", "value": "-", "footnotes": [{"code": "5", "text": "Estimate not released"}]}]}
    del raw[m.oews_series_id(pueblo, "47-2181", "01")]
    oews = m.build_oews(raw, None)
    assert len(oews["rows"]) == len(m.OEWS_AREAS) * len(m.OEWS_OCCUPATIONS)
    rows = {(r["area"], r["soc"]): r for r in oews["rows"]}
    iron = rows[(pueblo["code"], "47-2221")]
    assert iron["hourlyMean"] is None and "Estimate not released" in iron["unavailableReason"]
    roofers = rows[(pueblo["code"], "47-2181")]
    assert roofers["employment"] is None and roofers["unavailableReason"]
    assert roofers["hourlyMean"] == 31.5


def test_oews_prior_year_carried_from_previous_file():
    raw = full_raw()
    first = m.build_oews(raw, None)
    assert all(r["changePct"] is None and r["changeUnavailableReason"] for r in first["rows"])
    previous = {"oews": dict(first, year=2024, rows=[dict(r, hourlyMean=30.0) for r in first["rows"]])}
    second = m.build_oews(raw, previous)
    assert second["priorYearSource"] == "previous file"
    assert all(r["hourlyMeanPrior"] == 30.0 and r["changePct"] == 5.0 for r in second["rows"])
    # The same-year rerun keeps the prior it already had.
    third = m.build_oews(raw, {"oews": second})
    assert all(r["hourlyMeanPrior"] == 30.0 for r in third["rows"])


def test_materials_skip_dot_values_and_report_missing_series():
    mats = {r["id"]: r for r in m.build_materials(FRED)["series"]}
    head = mats["WPUIP231120"]
    assert head["latestPeriod"] == "2026-08" and head["latest"] == 103.0 and head["yoyPct"] == 3.0
    other = mats["WPU0811"]
    assert other["latest"] is None and other["yoyPct"] is None and other["unavailableReason"]


def test_payload_validates_and_history_is_rebuilt_on_first_run():
    payload = m.build_payload(full_raw(), FRED, None, NOW)
    Draft202012Validator(SCHEMA).validate(payload)
    assert len(payload["history"]) == 18  # 30 months of observations, the first 12 have no year-earlier value
    assert payload["summary"]["period"] == "2026-08"
    assert payload["summary"]["materialsYoyPct"] == 3.0
    assert "3.0%" in payload["summary"]["text"]


def test_history_keeps_rows_older_than_the_window():
    old = {"period": "2015-01", "laborWageYoyPct": 2.0, "employmentYoyPct": 1.0, "materialsYoyPct": None}
    payload = m.build_payload(full_raw(), FRED, {"history": [old]}, NOW)
    assert payload["history"][0] == old


def test_failed_request_leaves_previous_file_and_exits_nonzero(tmp_path, monkeypatch):
    out = tmp_path / "out.json"
    out.write_text('{"keep": true}')

    def refuse(_payload):
        raise m.FetchError("BLS answered REQUEST_NOT_PROCESSED: daily threshold")

    monkeypatch.setattr(m, "_post", refuse)
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    assert m.main(["--out", str(out)]) == 1
    assert out.read_text() == '{"keep": true}'


def test_quota_refusal_is_a_fetch_error(monkeypatch):
    monkeypatch.setattr(m, "_post", lambda _p: {"status": "REQUEST_NOT_PROCESSED", "message": ["daily threshold"]})
    with pytest.raises(m.FetchError):
        m.fetch_bls(["SMU08000002000000003"], None, 2026)


def test_requests_are_chunked_to_the_unauthenticated_limit(monkeypatch):
    sizes = []

    def fake(payload):
        sizes.append(len(payload["seriesid"]))
        assert int(payload["endyear"]) - int(payload["startyear"]) + 1 <= 10
        return {"status": "REQUEST_SUCCEEDED", "message": [], "Results": {"series": []}}

    monkeypatch.setattr(m, "_post", fake)
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    m.fetch_bls(m.all_series_ids(), None, 2026)
    assert max(sizes) <= 25 and sum(sizes) == len(m.all_series_ids())
    sizes.clear()
    m.fetch_bls(m.all_series_ids(), "key", 2026)
    assert max(sizes) <= 50


def test_committed_file_matches_schema():
    data = json.loads((ROOT / "data" / "market" / "co-construction-labor-cost.json").read_text())
    Draft202012Validator.check_schema(SCHEMA)
    Draft202012Validator(SCHEMA).validate(data)


def test_request_failed_is_isolated_to_the_rejected_series(monkeypatch):
    """BLS answers REQUEST_FAILED for a whole batch when it dislikes one input.
    The fetch retries without the catalog, then splits, so only the rejected
    series ends up empty (with a reason) and the rest still arrive."""
    bad = "OEUM009999900000047203103"
    calls = []

    def fake_post(body):
        calls.append(body)
        ids = body["seriesid"]
        if bad in ids:
            return {"status": "REQUEST_FAILED", "message": ["Your request has failed."]}
        return {"status": "REQUEST_SUCCEEDED", "message": [],
                "Results": {"series": [{"seriesID": i, "data": [{"year": "2026", "period": "M01",
                                                                  "value": "1.0", "footnotes": []}]} for i in ids]}}

    monkeypatch.setattr(m, "_post", fake_post)
    monkeypatch.setattr(m.time, "sleep", lambda *_: None)
    ids = ["SMU08000002000000001", bad, "SMU08000002000000003", "LASST080000000000003"]
    out = m.fetch_bls(ids, "key", 2026)
    assert set(out) == set(ids)
    assert out[bad]["data"] == [] and "rejected" in out[bad]["messages"][0]
    for good in ids:
        if good != bad:
            assert out[good]["data"], good
    assert calls[0].get("catalog") is True and "catalog" not in calls[1]


def test_quota_refusal_still_fails_the_run(monkeypatch):
    monkeypatch.setattr(m, "_post", lambda body: {"status": "REQUEST_NOT_PROCESSED",
                                                    "message": ["daily threshold reached"]})
    with pytest.raises(m.FetchError):
        m.fetch_bls(["SMU08000002000000001"], None, 2026)
