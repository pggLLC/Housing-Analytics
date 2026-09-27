"""
tests/test_transit_stop_gate.py

fetch-parcel-zoning-data.yml refreshes data/amenities/transit_stops_statewide_co.geojson
every week. Two outputs are built from it and must follow a CONTENT change:

  data/derived/market-analysis/neighborhood_access.json  (build_neighborhood_access.py)
  data/hna/ranking-index.json and everything derived     (npm run rebuild:derived)

but a stamp-only refresh (meta.generated) must rebuild nothing, or every week
commits ~570 timestamp-only files. scripts/hna/check_transit_stop_copies.py
is that gate, beside #1988's check_transit_zone_copy.py.

This file holds three things:
  1. the gate's comparison: stamp-only is current, a changed stop is stale;
  2. the committed tree is current;
  3. the workflow's real step script, run in a scratch tree with the two
     rebuild commands stubbed: a stamp-only stop refresh runs nothing, a
     content change runs neighborhood access and then the chain, a zone
     change runs only the chain, and a gate that cannot run fails the step.
"""

import copy
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "hna" / "check_transit_stop_copies.py"
HELPER = REPO_ROOT / "scripts" / "lib" / "transit_stops.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "fetch-parcel-zoning-data.yml"
STOPS_REL = "data/amenities/transit_stops_statewide_co.geojson"
NEIGHBORHOOD_REL = "data/derived/market-analysis/neighborhood_access.json"
INDEX_REL = "data/hna/ranking-index.json"
NEIGHBORHOOD_BUILDER_REL = "scripts/market-analysis/build_neighborhood_access.py"
ZONE_GATE_REL = "scripts/hna/check_transit_zone_copy.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def gate():
    return _load(GATE, "check_transit_stop_copies_test")


def _scratch(tmp_path, mutate_stops=None):
    """A minimal tree the stop gate can run in: gate, helper, stop file, both outputs."""
    root = tmp_path / "tree"
    for rel in (str(GATE.relative_to(REPO_ROOT)), str(HELPER.relative_to(REPO_ROOT)),
                NEIGHBORHOOD_REL, INDEX_REL):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO_ROOT / rel, root / rel)
    doc = json.loads((REPO_ROOT / STOPS_REL).read_text(encoding="utf-8"))
    before = json.dumps(doc, sort_keys=True)
    if mutate_stops:
        mutate_stops(doc)
        assert json.dumps(doc, sort_keys=True) != before, "the mutation did not apply"
    (root / STOPS_REL).parent.mkdir(parents=True, exist_ok=True)
    (root / STOPS_REL).write_text(json.dumps(doc), encoding="utf-8")
    return root


def _restamp(doc):
    doc["meta"]["generated"] = "2099-01-01T00:00:00Z"


def _move_one_stop(doc):
    doc["features"][0]["geometry"]["coordinates"][0] += 0.01


def _flip_one_service(doc):
    p = next(f["properties"] for f in doc["features"] if f["properties"]["reliability"] == "confirmed")
    p["service"] = "demand_response"


# ── 1. The comparison ───────────────────────────────────────────────────────

def test_committed_outputs_are_current(gate):
    assert gate.disagreements() == []
    res = subprocess.run([sys.executable, str(GATE)], capture_output=True, text=True, cwd=REPO_ROOT)
    assert res.returncode == 0 and "agree" in res.stdout, res.stdout + res.stderr


def test_a_stamp_only_refresh_is_current(gate, tmp_path):
    root = _scratch(tmp_path, _restamp)
    assert gate.disagreements(str(root)) == []


@pytest.mark.parametrize("mutate", [_move_one_stop, _flip_one_service], ids=["moved-stop", "service-change"])
def test_a_content_change_marks_both_outputs_stale(gate, tmp_path, mutate):
    root = _scratch(tmp_path, mutate)
    assert sorted(gate.disagreements(str(root))) == sorted([NEIGHBORHOOD_REL, INDEX_REL])


def test_an_unreadable_stop_file_is_an_error_not_current(gate, tmp_path):
    root = _scratch(tmp_path)
    (root / STOPS_REL).write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError):
        gate.disagreements(str(root))


# ── 2/3. The workflow ───────────────────────────────────────────────────────

def _step_script():
    src = WORKFLOW.read_text(encoding="utf-8")
    m = re.search(r"\n(\s*)- name: [^\n]*\n\s+id: derived-chain\n\s+run: \|\n", src)
    assert m, "the derived-chain step (id: derived-chain) is missing from the workflow"
    body_indent = None
    lines = []
    for line in src[m.end():].split("\n"):
        if line.strip() == "":
            lines.append("")
            continue
        indent = len(line) - len(line.lstrip())
        if body_indent is None:
            body_indent = indent
        if indent < body_indent:
            break
        lines.append(line[body_indent:])
    return "\n".join(lines).strip() + "\n"


def test_workflow_requires_both_triggers_and_commits_their_outputs():
    src = WORKFLOW.read_text(encoding="utf-8")
    script = _step_script()
    for gate_rel in (ZONE_GATE_REL, str(GATE.relative_to(REPO_ROOT))):
        assert re.search(r"^python3 " + re.escape(gate_rel) + r"\s*$", script, re.M), \
            f"the derived-chain step does not run {gate_rel}"
    i_na = script.find("python3 " + NEIGHBORHOOD_BUILDER_REL)
    i_chain = script.find("npm run rebuild:derived")
    assert 0 <= i_na < i_chain, "neighborhood access must be rebuilt, before the chain, on a stop change"
    assert "git diff --quiet" not in script, "a plain file-diff gate would rebuild on every stamp-only refresh"
    commit = src[src.index("- name: Commit updated data files"):]
    own = re.search(r'own_paths="([^"]+)"', commit)
    assert own and NEIGHBORHOOD_REL in own.group(1).split(), \
        "neighborhood access is not in the out-of-list guard's committed paths"
    staged = commit[commit.index("git add data/market/parcel_aggregates_co.json"):commit.index("git diff --cached --quiet")]
    assert NEIGHBORHOOD_REL in staged, "the job never stages neighborhood access"
    assert "rebuild:derived wrote files outside the committed path list" in commit, "the out-of-list guard is gone"


def _run_step(tmp_path, stops_mutation=None, zone_exit=0, stops_gate_ok=True):
    root = _scratch(tmp_path, stops_mutation)
    log = tmp_path / "calls.log"
    # The zone gate is #1988's and has its own tests; here it is a stub with a
    # chosen exit code so each trigger can be exercised on its own.
    zone = root / ZONE_GATE_REL
    zone.write_text(f"import sys\nsys.exit({zone_exit})\n", encoding="utf-8")
    builder = root / NEIGHBORHOOD_BUILDER_REL
    builder.parent.mkdir(parents=True, exist_ok=True)
    builder.write_text(f"open({str(log)!r}, 'a').write('neighborhood\\n')\n", encoding="utf-8")
    if not stops_gate_ok:
        (root / STOPS_REL).unlink()
    bindir = tmp_path / "bin"
    bindir.mkdir()
    npm = bindir / "npm"
    npm.write_text(f"#!/bin/sh\necho \"npm $*\" >> {log}\n", encoding="utf-8")
    npm.chmod(npm.stat().st_mode | stat.S_IEXEC)
    py = bindir / "python3"
    py.write_text(f"#!/bin/sh\nexec {sys.executable} \"$@\"\n", encoding="utf-8")
    py.chmod(py.stat().st_mode | stat.S_IEXEC)
    out = tmp_path / "github_output"
    out.write_text("", encoding="utf-8")
    env = dict(os.environ, PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}", GITHUB_OUTPUT=str(out))
    res = subprocess.run(["bash", "-e", "-c", _step_script()], cwd=root, env=env, capture_output=True, text=True)
    calls = log.read_text(encoding="utf-8").split() if log.exists() else []
    outputs = dict(l.split("=", 1) for l in out.read_text(encoding="utf-8").splitlines() if "=" in l)
    return res, calls, outputs


def test_step_stamp_only_stop_refresh_runs_nothing(tmp_path):
    res, calls, outputs = _run_step(tmp_path, _restamp)
    assert res.returncode == 0, res.stderr
    assert calls == []
    assert outputs == {"neighborhood": "false", "rebuilt": "false"}


@pytest.mark.parametrize("mutate", [_move_one_stop, _flip_one_service], ids=["moved-stop", "service-change"])
def test_step_stop_content_change_rebuilds_neighborhood_then_chain(tmp_path, mutate):
    res, calls, outputs = _run_step(tmp_path, mutate)
    assert res.returncode == 0, res.stderr
    assert calls == ["neighborhood", "npm", "run", "rebuild:derived"], calls
    assert outputs == {"neighborhood": "true", "rebuilt": "true"}


def test_step_zone_change_alone_rebuilds_only_the_chain(tmp_path):
    res, calls, outputs = _run_step(tmp_path, _restamp, zone_exit=1)
    assert res.returncode == 0, res.stderr
    assert calls == ["npm", "run", "rebuild:derived"], calls
    assert outputs == {"neighborhood": "false", "rebuilt": "true"}


@pytest.mark.parametrize("kw", [{"zone_exit": 2}, {"stops_gate_ok": False}], ids=["zone-gate-broke", "stop-gate-broke"])
def test_step_fails_when_a_gate_cannot_run(tmp_path, kw):
    res, calls, _ = _run_step(tmp_path, **kw)
    assert res.returncode != 0, "a gate that could not run was read as current"
    assert calls == []
