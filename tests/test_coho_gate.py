"""Gate behavior and real Git compare-and-create races; no network/model calls."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

spec = importlib.util.spec_from_file_location("coho_gate", Path(__file__).parents[1] / "scripts/coho_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Fake:
    def __init__(self, root="."):
        self.root = Path(root)
        self.sha = "a" * 40
        self.prs = []
        self.claims = {}
        self.files = {f"{gate.BALLOTS}/statewide.json", "data/policy/candidate-platforms-2026.json",
                      "data/policy/policy-watch.json", "research-brief.html",
                      *[f"{gate.BALLOTS}/counties/{c}.json" for c in gate.COUNTIES]}
        self.data = {p: {"coverage": [{"geoid": p.split('/')[-1][:-5], "coverage_state": "not_researched"}]}
                     for p in self.files if p.endswith(".json")}
        self.ci = ("READY", "https://github.com/example/run/1")
        self.dependencies = {"R5", "R6-0"}

    def read_json(self, path):
        return self.data[path]

    def merged(self, block):
        return block in self.dependencies


def pr(block="R1", state="open", merged=False, **updates):
    return dict(title=f"[{block}] work", state=state,
                merged_at="2026-09-26" if merged else None, html_url="https://github.com/example/pr/1",
                base={"ref": "main"}, head={"ref": "other"}, **updates)


@pytest.mark.parametrize("block", gate.BLOCKS)
def test_ready_for_each_block_in_its_window(block):
    snap = Fake()
    today = "2026-10-06"
    if block.endswith("-P2"):
        county = gate.COUNTIES[(int(block[4]) - 1) * 8]
        snap.data[f"{gate.BALLOTS}/counties/{county}.json"]["coverage"][0]["coverage_state"] = "official_notice_unavailable"
    if block == "R6-A":
        today = "2026-11-04"
    if block == "R6-B":
        today = "2026-12-30"  # certified/archive fix never expires
    result = gate.evaluate(snap, block, today, ("https://www.sos.state.co.us/certification.pdf", today))
    assert result["status"] == "READY"
    assert not result["retire"]


@pytest.mark.parametrize("block,last", [("R1", "2026-11-02"), ("R2-B8-P2", "2026-11-02"),
                                       ("R5", "2026-12-18"), ("R6-A", "2026-11-20")])
def test_expired_blocks_retire_even_with_missing_prerequisites(block, last):
    snap = Fake()
    snap.files.clear()
    snap.dependencies.clear()
    today = (datetime.fromisoformat(last).date() + timedelta(days=1)).isoformat()
    result = gate.evaluate(snap, block, today)
    assert result["status"] == "STOP"
    assert result["retire"]


@pytest.mark.parametrize("block,day", [("R2-B1-P2", "2026-10-05"), ("R6-A", "2026-11-03"),
                                      ("R6-B", "2026-11-23")])
def test_not_yet_open(block, day):
    result = gate.evaluate(Fake(), block, day)
    assert result["status"] == "WAIT"
    assert result["next_check"] > day


def test_denver_date_at_utc_midnight_and_dst():
    assert gate.mountain_date(datetime(2026, 10, 6, 1, tzinfo=timezone.utc)) == "2026-10-05"
    assert gate.mountain_date(datetime(2026, 11, 4, 6, 59, tzinfo=timezone.utc)) == "2026-11-03"
    assert gate.mountain_date(datetime(2026, 11, 4, 7, tzinfo=timezone.utc)) == "2026-11-04"


def test_merged_cleanup_precedes_date_and_missing_schema():
    snap = Fake()
    snap.files.clear()
    snap.prs = [pr(state="closed", merged=True)]
    result = gate.evaluate(snap, "R1", "2027-01-01")
    assert result["status"] == "SKIP" and result["retire"]


def test_open_pr_closed_pr_and_exact_prefix():
    snap = Fake()
    snap.prs = [pr("R2-B1-P2")]
    assert gate.evaluate(snap, "R2-B1", "2026-10-06")["status"] == "READY"
    snap.prs = [pr("R2-B1")]
    result = gate.evaluate(snap, "R2-B1", "2026-10-06")
    assert result["status"] == "SKIP" and not result["retire"]
    snap.prs[0]["state"] = "closed"
    assert gate.evaluate(snap, "R2-B1", "2026-10-06")["retire"]


def test_branch_matches_even_when_title_changed_and_other_base_is_not_done():
    snap = Fake()
    row = pr()
    row.update(title="Retitled", head={"ref": "coho/2026/R1"})
    snap.prs = [row]
    assert gate.evaluate(snap, "R1", "2026-10-06")["status"] == "SKIP"
    row.update(state="closed", merged_at="2026-10-06", base={"ref": "staging"})
    assert gate.evaluate(snap, "R1", "2026-10-06")["status"] == "STOP"


def test_h2_requires_every_county_file():
    snap = Fake()
    snap.files.remove(f"{gate.BALLOTS}/counties/08125.json")
    result = gate.evaluate(snap, "R1", "2026-10-06")
    assert result["status"] == "WAIT" and "08125" in result["reason"]


def test_second_pass_is_batch_specific():
    snap = Fake()
    snap.data[f"{gate.BALLOTS}/counties/08077.json"]["coverage"][0]["coverage_state"] = "official_notice_unavailable"
    assert gate.evaluate(snap, "R2-B1-P2", "2026-10-06")["retire"]
    assert gate.evaluate(snap, "R2-B5-P2", "2026-10-06")["status"] == "READY"


def test_second_pass_unknown_schema_is_not_retired_as_empty():
    snap = Fake()
    snap.data[f"{gate.BALLOTS}/counties/08001.json"] = {"new_schema": []}
    result = gate.evaluate(snap, "R2-B1-P2", "2026-10-06")
    assert result["status"] == "STOP" and not result["retire"]


def test_historical_gap_does_not_reopen_completed_batch():
    snap = Fake()
    snap.data[f"{gate.BALLOTS}/counties/08001.json"]["history"] = [
        {"geoid": "08001", "coverage_state": "official_notice_unavailable"}]
    assert gate.evaluate(snap, "R2-B1-P2", "2026-10-06")["retire"]


@pytest.mark.parametrize("block,last", [("R1", "2026-11-02"), ("R5", "2026-12-18"), ("R6-A", "2026-11-20")])
def test_closing_day_is_inclusive(block, last):
    assert gate.evaluate(Fake(), block, last)["status"] == "READY"


def test_batches_match_repository_county_registry():
    registry = json.loads((Path(__file__).parents[1] / "data/hna/geo-config.json").read_text())
    assert gate.COUNTIES == sorted(row["geoid"] for row in registry["counties"])
    assert len(gate.COUNTIES) == len(set(gate.COUNTIES)) == 64


def test_rendering_marker_does_not_replace_merged_dependency():
    snap = Fake()
    snap.dependencies.clear()
    assert gate.evaluate(snap, "R6-0", "2026-10-06")["status"] == "WAIT"


def test_claimed_block_waits_and_never_expires_its_reservation():
    snap = Fake()
    snap.claims["refs/heads/coho/2026/R6-B"] = "b" * 40
    result = gate.evaluate(snap, "R6-B", "2027-01-01")
    assert result["status"] == "WAIT" and not result["retire"]


@pytest.mark.parametrize("url,checked", [("https://evil.test/certified", "2026-11-24"),
                                        ("https://sos.state.co.us.evil.test/", "2026-11-24"),
                                        ("https://www.sos.state.co.us/", "2026-11-23"),
                                        ("http://www.sos.state.co.us/", "2026-11-24")])
def test_certification_requires_current_official_source(url, checked):
    assert gate.evaluate(Fake(), "R6-B", "2026-11-24", (url, checked))["status"] == "WAIT"


def ci_snapshot(runs, jobs):
    snap = object.__new__(gate.Snapshot)
    snap.sha = "a" * 40
    snap.api = lambda endpoint, key=None: jobs if "/jobs?" in endpoint else runs
    return snap


def run_row(**updates):
    return dict(dict(id=1, head_sha="a" * 40, event="push", status="completed",
                     conclusion="success", html_url="https://github.com/example/run/1"), **updates)


def test_current_commit_and_latest_run_are_required():
    good_job = [{"name": "ci-checks", "status": "completed", "conclusion": "success"}]
    assert ci_snapshot([run_row(head_sha="b" * 40)], good_job).ci[0] == "WAIT"
    assert ci_snapshot([run_row(event="pull_request")], good_job).ci[0] == "WAIT"
    assert ci_snapshot([run_row(), run_row(id=2, status="in_progress", conclusion=None)], good_job).ci[0] == "WAIT"
    assert ci_snapshot([run_row(), run_row(id=2, conclusion="cancelled")], good_job).ci[0] == "STOP"
    assert ci_snapshot([run_row()], good_job).ci[0] == "READY"


@pytest.mark.parametrize("jobs", [[], [{"name": "ci-checks", "status": "completed", "conclusion": "skipped"}],
                                [{"name": "other", "status": "completed", "conclusion": "success"}]])
def test_green_workflow_without_executed_ci_job_is_not_ready(jobs):
    assert ci_snapshot([run_row()], jobs).ci[0] == "WAIT"


def test_red_ci_does_not_retire_block():
    snap = Fake()
    snap.ci = ("STOP", "CI failed")
    result = gate.evaluate(snap, "R1", "2026-10-06")
    assert result["status"] == "STOP" and not result["retire"]


def local_git(tmp_path):
    remote = tmp_path / "remote.git"
    root = tmp_path / "repo"
    root.mkdir()
    def git(*args, **kwargs):
        return gate.command(["git", *args], root, **kwargs)
    git("init", "--bare", str(remote))
    git("init")
    git("config", "user.name", "Gate test")
    git("config", "user.email", "gate@example.invalid")
    git("commit", "--allow-empty", "-m", "base")
    git("remote", "add", "origin", str(remote))
    snap = Fake(root)
    snap.git = git
    snap.sha = git("rev-parse", "HEAD")
    git("push", "origin", "HEAD:refs/heads/main")
    return snap


def test_real_competing_claims_only_one_wins(tmp_path):
    snap = local_git(tmp_path)
    def attempt():
        try:
            return gate.reserve(snap, "R1")
        except gate.Unavailable:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: attempt(), range(2)))
    winners = [x for x in outcomes if x]
    assert len(winners) == 1
    assert snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1").startswith(winners[0])
    gate.release(snap, "R1", winners[0])
    assert not snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1")


def test_release_preserves_work_pushed_after_reservation(tmp_path):
    snap = local_git(tmp_path)
    claim_sha = gate.reserve(snap, "R1")
    tree = snap.git("rev-parse", "HEAD^{tree}")
    work_sha = snap.git("commit-tree", tree, "-p", claim_sha, input="work started\n")
    snap.git("push", "origin", f"{work_sha}:refs/heads/coho/2026/R1")
    with pytest.raises(gate.Unavailable):
        gate.release(snap, "R1", claim_sha)
    assert snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1").startswith(work_sha)


def test_changed_main_during_claim_releases_own_empty_reservation(tmp_path, monkeypatch):
    snap = local_git(tmp_path)
    fresh = Fake()
    fresh.sha = "b" * 40
    monkeypatch.setattr(gate, "mountain_date", lambda: "2026-10-06")
    result = gate.claim(snap, "R1", factory=lambda _: fresh)
    assert result["status"] == "WAIT"
    assert not snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1")


def test_run_never_launches_worker_on_wait(monkeypatch):
    snap = Fake()
    snap.files.clear()
    monkeypatch.setattr(gate, "Snapshot", lambda _: snap)
    monkeypatch.setattr(gate, "mountain_date", lambda: "2026-10-06")
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: pytest.fail("worker launched on WAIT"))
    assert gate.main(["run", "R1", "--", "never-launch-me"]) == 10


def test_claim_then_run_provides_ownership_to_worker(tmp_path, monkeypatch):
    snap = local_git(tmp_path)
    fresh = Fake()
    fresh.sha = snap.sha
    monkeypatch.setattr(gate, "mountain_date", lambda: "2026-10-06")
    claimed = gate.claim(snap, "R1", factory=lambda _: fresh)
    assert claimed["status"] == "GO"
    assert snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1").startswith(claimed["claim_sha"])
    monkeypatch.setattr(gate, "Snapshot", lambda _: snap)
    monkeypatch.setattr(gate, "claim", lambda *args: claimed)
    calls = []
    def worker(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 7)
    monkeypatch.setattr(subprocess, "run", worker)
    assert gate.main(["run", "R1", "--", "my-worker", "an argument"]) == 7
    assert len(calls) == 1 and calls[0][0] == ["my-worker", "an argument"]
    assert calls[0][1]["env"]["COHO_CLAIM_SHA"] == claimed["claim_sha"]
    assert calls[0][1]["env"]["COHO_BASE_SHA"] == snap.sha


def test_api_failure_is_wait_and_cannot_launch(monkeypatch):
    def unavailable(_):
        raise gate.Unavailable("network unavailable")
    monkeypatch.setattr(gate, "Snapshot", unavailable)
    assert gate.main(["check", "R1", "--json"]) == 10


def test_ambiguous_failure_after_claim_retains_reservation(tmp_path, monkeypatch):
    snap = local_git(tmp_path)
    monkeypatch.setattr(gate, "mountain_date", lambda: "2026-10-06")
    def unavailable(_):
        raise gate.Unavailable("network unavailable")
    result = gate.claim(snap, "R1", factory=unavailable)
    assert result["status"] == "WAIT" and result["claim_sha"]
    assert snap.git("ls-remote", "origin", "refs/heads/coho/2026/R1").startswith(result["claim_sha"])


def test_pr_pagination_includes_later_closed_pages(monkeypatch):
    snap = object.__new__(gate.Snapshot)
    snap.root = Path(".")
    pages = [[pr("R3")], [pr("R1", state="closed", merged=True)]]
    def api_output(args, root):
        assert "--paginate" in args and "--slurp" in args
        return json.dumps(pages)
    monkeypatch.setattr(gate, "command", api_output)
    assert len(snap.prs) == 2 and snap.prs[1]["merged_at"]
