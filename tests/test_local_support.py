"""data/policy/local-support.json: every item is dated, sourced and quoted.

The quotes were checked against saved source text when each row was merged
(scripts/policy/build_local_support.py --sources). These tests hold what can be
checked from the committed file alone: the shape, the dates, the vocabulary,
that each figure an item states appears in its own quotes, and that the ledger
never says none_found for a scope that has records.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "policy" / "local-support.json"

PLAN_TYPES = {"housing_needs_assessment", "housing_plan", "comp_plan_housing"}
ACTION_TYPES = {
    "project_approval", "rezoning_approval", "land_contribution", "funding_award",
    "fee_waiver_approval", "housing_policy_adoption", "commission_recommendation", "denial",
}
OUTCOMES = {"adopted", "approved", "denied", "recommended_approval", "recommended_denial"}
SCOPE_STATES = {"records", "none_found", "unreadable"}
DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@pytest.fixture(scope="module")
def doc():
    return json.loads(DATA.read_text())


def items(doc):
    for row in doc["jurisdictions"]:
        for it in row.get("items") or []:
            yield row, it


def test_rows_are_checked_dated_and_unique(doc):
    assert doc["schema"] == "local-support/v1"
    assert DAY.match(doc["meta"]["as_of"])
    geoids = [r["geoid"] for r in doc["jurisdictions"]]
    assert len(geoids) == len(set(geoids)), "one row per jurisdiction"
    assert geoids, "the scan must find rows to check"
    for r in doc["jurisdictions"]:
        assert re.match(r"^08\d{3}(\d{2})?$", r["geoid"]), r["geoid"]
        assert DAY.match(r["checked"]) and DAY.match(r["review_by"]), r["geoid"]
        assert r["review_by"] > r["checked"]
        assert r["checked"] <= doc["meta"]["as_of"]
        assert set(r["result_by_scope"]) == {"plans", "council"}, r["geoid"]
        assert set(r["result_by_scope"].values()) <= SCOPE_STATES, r["geoid"]
        assert r.get("sources_checked"), f"{r['geoid']}: say what was read"


def test_ledger_agrees_with_records(doc):
    for r in doc["jurisdictions"]:
        its = r.get("items") or []
        has = {"plans": any(i["kind"] == "plan" for i in its),
               "council": any(i["kind"] == "action" for i in its)}
        for scope, present in has.items():
            state = r["result_by_scope"][scope]
            if present:
                assert state == "records", f"{r['geoid']}: {scope} has items but says {state}"
            else:
                assert state != "records", f"{r['geoid']}: {scope} says records but has none"


def test_every_item_is_typed_dated_sourced_and_quoted(doc):
    ids = set()
    n = 0
    for row, it in items(doc):
        n += 1
        assert it["id"] not in ids, f"duplicate id {it['id']}"
        ids.add(it["id"])
        assert it["kind"] in ("plan", "action"), it["id"]
        assert it["type"] in (PLAN_TYPES if it["kind"] == "plan" else ACTION_TYPES), it["id"]
        assert it["outcome"] in OUTCOMES, it["id"]
        assert DATE.match(it.get("date") or ""), f"{it['id']}: date must be YYYY[-MM[-DD]], never guessed"
        assert it["date"] <= row["checked"], f"{it['id']}: dated after it was checked"
        if it["kind"] == "action":
            assert it.get("body"), f"{it['id']}: which body voted"
        if it["type"] == "denial":
            assert it["outcome"] in ("denied", "recommended_denial"), it["id"]
        assert it.get("title"), it["id"]
        assert it["source"]["url"].startswith("https://") or it["source"]["url"].startswith("http://"), it["id"]
        assert it["verification"]["level"] in ("primary", "reported"), it["id"]
        assert it.get("evidence"), f"{it['id']}: an item needs the source wording it rests on"
        assert all((ev.get("quote") or "").strip() for ev in it["evidence"]), f"{it['id']}: empty quote"
        assert max(len(ev["quote"].strip()) for ev in it["evidence"]) >= 40, \
            f"{it['id']}: needs at least one quote long enough to identify the passage"
    assert n > 0, "the scan must find items to check"


def _numbers(text):
    """Figures with thousands separators and trailing zero cents removed ($166,400.00 == 166400)."""
    out = set()
    for m in re.findall(r"\d[\d,]*(?:\.\d+)?", text or ""):
        n = m.replace(",", "")
        if "." in n:
            n = n.rstrip("0").rstrip(".")
        out.add(n)
    return out


def test_every_figure_an_item_states_is_in_its_quotes(doc):
    for _, it in items(doc):
        quoted = " ".join(e["quote"] for e in it["evidence"])
        quoted_nums = _numbers(quoted)
        stated = _numbers(it.get("title")) | _numbers(it.get("affordable_detail"))
        missing = sorted(stated - quoted_nums)
        assert not missing, f"{it['id']}: {missing} stated but not in the evidence"
        if it.get("vote"):
            assert re.match(r"^\d+-\d+(-\d+)?$", it["vote"]), f"{it['id']}: vote like 6-1"
