"""
tests/test_ranking_index_transit_zone.py

The ranking index carries a DISPLAY-ONLY copy of the transit zone share from
data/hna/transit-zone-by-geography.json (#1971; owner decision on #1937 and
#1943). Display-only means two things, and this file holds both:

1. It changes no score. The index is rebuilt three ways — from the real
   source, from a source with every value perturbed, and with the source
   missing — and every field of every row other than `transitZone` must be
   identical across the three: every score, rank, percentile, weight and
   composite, and every existing metric. Wire a transit field into any of them
   and the perturbed build moves it, and this fails.

2. The copy agrees with its source. The index's `metadata.transitZone` must
   name the same build of the source (`generated`, `stops_generated`) and
   every row must equal what the builder derives from the committed source
   record. When fetch-parcel-zoning-data.yml refreshes the source without
   rebuilding the chain, this fails — so that workflow must run the chain,
   which the last test checks.

Absence: a geography with no share carries null and an unavailableReason,
never 0 (#1480).
"""

import copy
import importlib.util
import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILDER = REPO_ROOT / "scripts" / "hna" / "build_ranking_index.py"
INDEX = REPO_ROOT / "data" / "hna" / "ranking-index.json"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def _load_builder():
    spec = importlib.util.spec_from_file_location("build_ranking_index_tz_guard", BUILDER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def builder():
    return _load_builder()


@pytest.fixture(scope="module")
def source(builder):
    return json.loads(Path(builder.TRANSIT_ZONE_PATH).read_text(encoding="utf-8"))


def _perturb(src: dict) -> dict:
    """Every number and flag in every record moved, so any wiring shows."""
    out = copy.deepcopy(src)
    for i, rec in enumerate(out["geographies"].values()):
        for key, val in list(rec.items()):
            if isinstance(val, bool):
                rec[key] = not val
            elif isinstance(val, (int, float)):
                # Deterministic, geography-dependent, never equal to the input.
                rec[key] = round((val + 0.37 + (i % 7) * 0.11) % 1 + 0.001, 4) if key.startswith("share") else val * 3 + 17
            elif val is None and key.startswith("share"):
                rec[key] = 0.5
    return out


def _build(builder, tmp_path, name, source_path):
    saved = builder.TRANSIT_ZONE_PATH
    builder.TRANSIT_ZONE_PATH = str(source_path)
    try:
        out = tmp_path / f"{name}.json"
        builder.build(out_path=str(out))
        return json.loads(out.read_text(encoding="utf-8"))
    finally:
        builder.TRANSIT_ZONE_PATH = saved


def _without_transit(doc: dict) -> dict:
    doc = copy.deepcopy(doc)
    doc["metadata"].pop("generatedAt", None)
    doc["metadata"].pop("transitZone", None)
    for row in doc["rankings"]:
        row.pop("transitZone", None)
    return doc


def _row_diffs(a: dict, b: dict, limit: int = 12) -> list[str]:
    """Name the fields that moved, so a failure says which score was wired."""
    diffs = []
    rows_b = {r["geoid"]: r for r in b["rankings"]}
    for ra in a["rankings"]:
        rb = rows_b.get(ra["geoid"])
        if rb is None:
            diffs.append(f"{ra['geoid']}: missing from the other build")
            continue
        for key in sorted(set(ra) | set(rb)):
            if key == "metrics":
                for m in sorted(set(ra["metrics"]) | set(rb["metrics"])):
                    if ra["metrics"].get(m) != rb["metrics"].get(m):
                        diffs.append(f"{ra['geoid']} metrics.{m}: {ra['metrics'].get(m)!r} -> {rb['metrics'].get(m)!r}")
            elif ra.get(key) != rb.get(key):
                diffs.append(f"{ra['geoid']} {key}: {ra.get(key)!r} -> {rb.get(key)!r}")
        if len(diffs) >= limit:
            break
    if [r["geoid"] for r in a["rankings"]] != [r["geoid"] for r in b["rankings"]]:
        diffs.append("row ORDER (i.e. rank order) differs")
    return diffs


@pytest.fixture(scope="module")
def builds(builder, source, tmp_path_factory):
    tmp = tmp_path_factory.mktemp("transit_zone_guard")
    perturbed_path = tmp / "perturbed-source.json"
    perturbed_path.write_text(json.dumps(_perturb(source)), encoding="utf-8")
    return {
        "real": _build(builder, tmp, "real", builder.TRANSIT_ZONE_PATH),
        "perturbed": _build(builder, tmp, "perturbed", perturbed_path),
        "missing": _build(builder, tmp, "missing", tmp / "does-not-exist.json"),
    }


def test_the_three_builds_really_differ_in_their_transit_input(builds):
    """Non-vacuity: prove the perturbation and the removal reached the copy."""
    real, pert, missing = builds["real"], builds["perturbed"], builds["missing"]
    shares = [r["transitZone"]["share_within_radius_confirmed"] for r in real["rankings"]]
    assert sum(s is not None for s in shares) >= 500, "the real build copied almost no transit shares"
    moved = sum(
        1 for a, b in zip(real["rankings"], pert["rankings"])
        if a["transitZone"]["share_within_radius_confirmed"] != b["transitZone"]["share_within_radius_confirmed"]
    )
    assert moved >= 500, f"the perturbation moved only {moved} shares — the guard would prove nothing"
    assert all(r["transitZone"]["share_within_radius_confirmed"] is None for r in missing["rankings"])


@pytest.mark.parametrize("variant", ["perturbed", "missing"])
def test_transit_zone_changes_no_score_rank_or_existing_field(builds, variant):
    real = _without_transit(builds["real"])
    other = _without_transit(builds[variant])
    diffs = _row_diffs(real, other)
    assert not diffs and real == other, (
        f"the {variant} transit source changed fields outside `transitZone` — the display-only "
        "share has been wired into a score, rank or metric:\n  " + "\n  ".join(diffs or ["(metadata or catalog differs)"])
    )


def test_transit_zone_is_not_a_metric(builds):
    """It lives beside `metrics`, which the digests and pages iterate."""
    real = builds["real"]
    tz_fields = set(real["rankings"][0]["transitZone"])
    catalog = {m.get("id") for m in real.get("metrics", [])}
    for row in real["rankings"]:
        leaked = tz_fields & set(row["metrics"])
        assert not leaked, f"{row['geoid']}: transit fields inside metrics: {sorted(leaked)}"
    assert not (tz_fields & catalog), "a transit field is registered in the metric catalog"


def test_absent_is_null_with_a_reason_never_zero(builds):
    for variant in ("real", "missing"):
        for row in builds[variant]["rankings"]:
            tz = row["transitZone"]
            if tz["share_within_radius_confirmed"] is None:
                assert tz["unavailableReason"], f"{variant} {row['geoid']}: null share without a reason"
    missing = builds["missing"]
    assert missing["metadata"]["transitZone"]["unavailableReason"]
    for row in missing["rankings"]:
        numbers = [v for k, v in row["transitZone"].items() if k != "unavailableReason"]
        assert all(v is None for v in numbers), f"{row['geoid']}: a value survived a missing source: {row['transitZone']}"


def test_committed_index_copy_agrees_with_the_committed_source(builder, source):
    """The freshness pin: fails when the source is refreshed and the chain is not rerun."""
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    meta = index["metadata"].get("transitZone")
    assert meta, "metadata.transitZone is missing — the ranking index chain has not been rerun"
    for key in ("generated", "stops_generated"):
        assert meta.get(key) == source["meta"].get(key), (
            f"ranking-index.json holds the transit zone copy from {key}={meta.get(key)}, but "
            f"{builder.TRANSIT_ZONE_REL_PATH} is {key}={source['meta'].get(key)}. Run `npm run rebuild:derived`."
        )
    tz_meta, records = builder.load_transit_zone()
    stale = []
    for row in index["rankings"]:
        want = builder.transit_zone_record(row["geoid"], records, tz_meta)
        if row.get("transitZone") != want:
            stale.append(row["geoid"])
    assert not stale, f"{len(stale)} rows disagree with the source, e.g. {stale[:5]}. Run `npm run rebuild:derived`."


def test_the_workflow_that_refreshes_the_source_rebuilds_the_chain(builder):
    """Relational: whichever workflow commits the builder's source must run the chain after writing it."""
    rel = builder.TRANSIT_ZONE_REL_PATH
    committers = []
    for wf in sorted(WORKFLOWS.glob("*.yml")):
        src = wf.read_text(encoding="utf-8")
        commit_at = src.find("git commit")
        if commit_at < 0 or rel not in src[:commit_at]:
            continue
        committers.append(wf.name)
        chain_at = src.find("npm run rebuild:derived")
        assert 0 <= chain_at < commit_at, (
            f"{wf.name} commits {rel} but does not run `npm run rebuild:derived` before committing it"
        )
        # If the chain is gated on a diff, the gate must be the file the index copies.
        gates = re.findall(r"git diff --quiet -- ([^\s;]+)", src[:chain_at])
        assert gates and gates[-1] == rel, (
            f"{wf.name} gates the chain on {gates[-1] if gates else 'nothing'}, not on {rel}"
        )
        staged = src[chain_at:commit_at]
        for path in ("data/hna/ranking-index.json", "data/hna/ranking-scenarios"):
            assert path in staged, f"{wf.name} runs the chain but never stages {path}"
    assert committers, f"no workflow commits {rel} — the scan found nothing to check"
