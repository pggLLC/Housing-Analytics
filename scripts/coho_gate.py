#!/usr/bin/env python3
"""COHO 2026 handoff gate. No model calls; only claim/run reserve remote work."""

import argparse
from datetime import datetime
from functools import cached_property, lru_cache
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse
from uuid import uuid4
from zoneinfo import ZoneInfo

REPO = "pggLLC/Housing-Analytics"
BLOCKS = ("R1", *[f"R2-B{i}" for i in range(1, 9)],
          *[f"R2-B{i}-P2" for i in range(1, 9)], "R3", "R4", "R5", "R6-0", "R6-A", "R6-B")
BALLOTS = "data/policy/ballot-2026"
COUNTIES = ("08001 08003 08005 08007 08009 08011 08013 08014 "
            "08015 08017 08019 08021 08023 08025 08027 08029 "
            "08031 08033 08035 08037 08039 08041 08043 08045 "
            "08047 08049 08051 08053 08055 08057 08059 08061 "
            "08063 08065 08067 08069 08071 08073 08075 08077 "
            "08079 08081 08083 08085 08087 08089 08091 08093 "
            "08095 08097 08099 08101 08103 08105 08107 08109 "
            "08111 08113 08115 08117 08119 08121 08123 08125").split()


class Unavailable(RuntimeError):
    pass


def command(args, cwd, input=None, env=None):
    try:
        return subprocess.run(args, cwd=cwd, input=input, text=True, capture_output=True,
                              timeout=90, check=True, env=env).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        # Do not include command arguments, environment values or credential-bearing URLs.
        raise Unavailable(f"{args[0]} operation failed; check authentication/network and retry") from exc


def mountain_date(now=None):
    return (now or datetime.now(ZoneInfo("America/Denver"))).astimezone(
        ZoneInfo("America/Denver")).date().isoformat()


def branch_for(block):
    if block not in BLOCKS:
        raise ValueError(f"unknown block: {block}")
    return f"coho/2026/{block}"


def decision(block, status, reason, retire=False, **details):
    return dict(block=block, status=status, reason=reason, retire=retire,
                exit_code={"READY": 0, "GO": 0, "WAIT": 10, "STOP": 20, "SKIP": 20}[status],
                **details)


def pr_for(pr, block):
    return (pr["title"].startswith(f"[{block}]") or
            pr.get("head", {}).get("ref") == branch_for(block))


def coverage_rows(value):
    """Find current geographic coverage rows without counting historical states."""
    if isinstance(value, dict):
        if "geoid" in value and "coverage_state" in value:
            yield value
        for key, child in value.items():
            if key != "history":
                yield from coverage_rows(child)
    elif isinstance(value, list):
        for child in value:
            yield from coverage_rows(child)


class Snapshot:
    """Pin every file read and CI check to one freshly fetched main commit."""

    def __init__(self, root):
        self.root = Path(root).resolve()
        remote = self.git("remote", "get-url", "origin")
        if remote.removesuffix(".git").lower() not in (
                f"https://github.com/{REPO}".lower(), f"git@github.com:{REPO}".lower()):
            raise ValueError(f"origin must be the canonical {REPO} repository")
        self.git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main")
        self.sha = self.git("rev-parse", "refs/remotes/origin/main")

    def git(self, *args, **kwargs):
        return command(["git", *args], self.root, **kwargs)

    def api(self, endpoint, key=None):
        args = ["gh", "api", f"repos/{REPO}/{endpoint}"]
        if key is not None:
            args += ["--paginate", "--slurp"]
        result = json.loads(command(args, self.root))
        if key is None:
            return result
        return [item for page in result for item in (page if key == "" else page[key])]

    @cached_property
    def files(self):
        return set(self.git("ls-tree", "-r", "--name-only", self.sha).splitlines())

    @cached_property
    def prs(self):
        # REST list, not indexed search: all states/pages, including renamed gate branches.
        return self.api("pulls?state=all&per_page=100", "")

    @cached_property
    def claims(self):
        return dict(line.split("\t")[::-1] for line in self.git(
            "ls-remote", "--heads", "origin", "refs/heads/coho/2026/*").splitlines())

    @lru_cache(maxsize=None)
    def read_json(self, path):
        return json.loads(self.git("show", f"{self.sha}:{path}"))

    @lru_cache(maxsize=None)
    def merged(self, block):
        for pr in self.prs:
            if not pr_for(pr, block) or not pr.get("merged_at"):
                continue
            # A merged PR into another branch is not a prerequisite on main.
            if pr.get("base", {}).get("ref") != "main":
                continue
            sha = pr.get("merge_commit_sha")
            if not sha or not re.fullmatch(r"[0-9a-f]{40}", sha):
                raise Unavailable("merged PR is missing its merge commit")
            # A shallow clone may not contain the merge commit yet.
            self.git("fetch", "--quiet", "origin", sha)
            try:
                self.git("merge-base", "--is-ancestor", sha, self.sha)
                return True
            except Unavailable:
                # Deepen only when the prerequisite needs ancestry verification.
                if self.git("rev-parse", "--is-shallow-repository") == "true":
                    self.git("fetch", "--quiet", "--unshallow", "origin", "main")
                    self.git("merge-base", "--is-ancestor", sha, self.sha)
                    return True
        return False

    @cached_property
    def ci(self):
        runs = self.api(f"actions/workflows/ci-checks.yml/runs?branch=main&head_sha={self.sha}&per_page=100",
                        "workflow_runs")
        runs = [r for r in runs if r["head_sha"] == self.sha and r.get("event") != "pull_request"]
        if not runs:
            return "WAIT", "no ci-checks run for current main"
        run = max(runs, key=lambda r: r["id"])
        link = run["html_url"]
        if run["status"] != "completed":
            return "WAIT", f"current main CI is {run['status']}: {link}"
        if run["conclusion"] != "success":
            return "STOP", f"current main CI is {run['conclusion']}: {link}"
        jobs = self.api(f"actions/runs/{run['id']}/jobs?filter=latest&per_page=100", "jobs")
        checks = [j for j in jobs if j["name"] == "ci-checks"]
        if not checks or any(j["status"] != "completed" or j["conclusion"] != "success" for j in checks):
            return "WAIT", f"ci-checks job did not complete successfully: {link}"
        return "READY", link


def evaluate(snapshot, block, today, certification=None, ignore_claim=False):
    branch = branch_for(block)
    result = lambda status, reason, retire=False, **kw: decision(
        block, status, reason, retire, base_sha=snapshot.sha, branch=branch, checked=today, **kw)
    prs = [p for p in snapshot.prs if pr_for(p, block)]
    # Terminal lifecycle decisions precede prerequisites and date waits.
    merged = [p for p in prs if p.get("merged_at") and p.get("base", {}).get("ref") == "main"]
    if merged:
        return result("SKIP", f"already merged: {merged[0]['html_url']}", True)
    opened = [p for p in prs if p["state"] == "open"]
    if opened:
        return result("SKIP", f"PR already open: {opened[0]['html_url']}")
    if prs:
        return result("STOP", f"closed or merged outside main; owner review required: {prs[0]['html_url']}", True)
    closes = ("2026-11-02" if block in ("R1", "R3", "R4") or block.startswith("R2-")
              else "2026-12-18" if block in ("R5", "R6-0")
              else "2026-11-20" if block == "R6-A" else None)
    if closes and today > closes:
        return result("STOP", f"work window ended {closes}", True)
    opens = ("2026-10-06" if block.endswith("-P2") else
             "2026-11-04" if block == "R6-A" else "2026-11-24" if block == "R6-B" else None)
    if opens and today < opens:
        return result("WAIT", f"work window opens {opens}", next_check=opens)
    if not ignore_claim and f"refs/heads/{branch}" in snapshot.claims:
        return result("WAIT", f"reserved by another session: {branch}; owner must resume or release it")

    if block in ("R1", "R3", "R4", "R5") or block.startswith("R2-"):
        needed = [f"{BALLOTS}/statewide.json", "data/policy/candidate-platforms-2026.json",
                  "data/policy/policy-watch.json", *[f"{BALLOTS}/counties/{c}.json" for c in COUNTIES]]
        missing = [p for p in needed if p not in snapshot.files]
        if missing:
            return result("WAIT", f"H2 foundation missing on main: {missing[0]} ({len(missing)} missing)")
        for path in needed:
            try:
                value = snapshot.read_json(path)
            except json.JSONDecodeError:
                return result("STOP", f"schema mismatch: invalid JSON in {path}")
            if not isinstance(value, dict):
                return result("STOP", f"schema mismatch: {path} must contain a JSON object")
    if block == "R5" and "research-brief.html" not in snapshot.files:
        return result("WAIT", "H1 research-brief.html is not on main")
    prerequisite = {"R6-0": "R5", "R6-A": "R6-0", "R6-B": "R6-0"}.get(block)
    if prerequisite and not snapshot.merged(prerequisite):
        return result("WAIT", f"[{prerequisite}] PR must be merged into main")
    if block.endswith("-P2"):
        start = (int(block[4]) - 1) * 8
        rows = []
        for county in COUNTIES[start:start + 8]:
            found = list(coverage_rows(snapshot.read_json(f"{BALLOTS}/counties/{county}.json")))
            if not found:
                return result("STOP", f"schema mismatch: no geographic coverage rows for {county}")
            rows.extend(found)
        if not any(r["coverage_state"] == "official_notice_unavailable" for r in rows):
            return result("STOP", "this batch has no official_notice_unavailable rows", True)
    if block == "R6-B":
        url, checked = certification or ("", "")
        parsed = urlparse(url)
        if (parsed.scheme != "https" or parsed.hostname not in ("sos.state.co.us", "www.sos.state.co.us")
                or parsed.username or parsed.password or checked != today):
            return result("WAIT", "read official statewide certification; supply its SoS URL and today's Denver date")
    status, evidence = snapshot.ci
    if status != "READY":
        return result(status, evidence)
    return result("READY", "prerequisites and current main CI passed; claim before starting", ci_url=evidence)


def reserve(snapshot, block):
    """Unique empty commit + compare-and-create: exactly one competing push wins."""
    branch = branch_for(block)
    ref = f"refs/heads/{branch}"
    tree = snapshot.git("rev-parse", f"{snapshot.sha}^{{tree}}")
    message = f"COHO gate reservation {block}\n\nOwner token: {uuid4()}\nBase: {snapshot.sha}\n"
    sha = snapshot.git("-c", "user.name=COHO gate", "-c", "user.email=coho-gate@users.noreply.github.com",
                       "commit-tree", tree, "-p", snapshot.sha, input=message)
    snapshot.git("push", "--porcelain", f"--force-with-lease={ref}:", "origin", f"{sha}:{ref}")
    return sha


def release(snapshot, block, sha):
    """Only delete the caller's unchanged reservation; preserve any later work."""
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("claim SHA must be a full 40-character commit SHA")
    snapshot.git("fetch", "--quiet", "origin", sha)
    message = snapshot.git("show", "-s", "--format=%B", sha)
    if not message.startswith(f"COHO gate reservation {block}\n"):
        raise ValueError("refusing to release a commit that is not this block's reservation")
    if snapshot.git("diff-tree", "--no-commit-id", "--name-only", "-r", sha):
        raise ValueError("refusing to release a reservation with file changes")
    ref = f"refs/heads/{branch_for(block)}"
    snapshot.git("push", "--porcelain", f"--force-with-lease={ref}:{sha}", "origin", f":{ref}")


def claim(snapshot, block, certification=None, factory=Snapshot):
    result = evaluate(snapshot, block, mountain_date(), certification)
    if result["status"] != "READY":
        return result
    sha = reserve(snapshot, block)
    try:
        fresh = factory(snapshot.root)
        checked = evaluate(fresh, block, mountain_date(), certification, ignore_claim=True)
        if fresh.sha != snapshot.sha or checked["status"] != "READY":
            release(snapshot, block, sha)
            return decision(block, "WAIT", "main or gate state changed during reservation; recheck")
    except (Unavailable, ValueError):
        # Ambiguous network failures retain the claim, preventing a duplicate worker.
        return decision(block, "WAIT", "reservation retained after failed recheck; owner must inspect/resume",
                        claim_sha=sha, branch=branch_for(block))
    return dict(result, status="GO", reason="exclusive reservation acquired; read merged schema before work",
                claim_sha=sha)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "scan", "claim", "release", "run"))
    parser.add_argument("block", nargs="?", choices=BLOCKS)
    parser.add_argument("--repo-dir", default=".")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--claim-sha")
    parser.add_argument("--certification-url", default="")
    parser.add_argument("--certification-checked", default="")
    argv = list(sys.argv[1:] if argv is None else argv)
    child = []
    if "--" in argv:
        split = argv.index("--")
        argv, child = argv[:split], argv[split + 1:]
    args = parser.parse_args(argv)
    if (args.action != "scan" and not args.block) or (args.action == "scan" and args.block):
        parser.error("provide one block except with scan")
    if (args.action == "run") != bool(child):
        parser.error("run requires a command after --; other actions do not accept one")
    if args.action == "release" and not args.claim_sha:
        parser.error("release requires --claim-sha")
    try:
        snapshot = Snapshot(args.repo_dir)
        cert = (args.certification_url, args.certification_checked)
        if args.action == "scan":
            results = [evaluate(snapshot, b, mountain_date(), cert) for b in BLOCKS]
        elif args.action in ("claim", "run"):
            results = [claim(snapshot, args.block, cert)]
        elif args.action == "release":
            release(snapshot, args.block, args.claim_sha)
            results = [decision(args.block, "STOP", "unchanged reservation released; next session may recheck")]
        else:
            results = [evaluate(snapshot, args.block, mountain_date(), cert)]
    except (Unavailable, ValueError, KeyError, TypeError) as exc:
        results = [decision(args.block or "all", "WAIT", str(exc))]
    for result in results:
        print(json.dumps(result) if args.json else
              f"{result['status']}: {result['block']}: {result['reason']}" +
              (f"\nbranch={result['branch']} claim_sha={result['claim_sha']}" if "claim_sha" in result else ""),
              flush=True)
    if args.action == "run" and results[0]["status"] == "GO":
        result = results[0]
        env = dict(os.environ, COHO_BLOCK=args.block, COHO_BASE_SHA=result["base_sha"],
                   COHO_BRANCH=result["branch"], COHO_CLAIM_SHA=result["claim_sha"])
        try:
            return subprocess.run(child, cwd=snapshot.root, env=env, check=False).returncode
        except OSError:
            print("STOP: worker could not start; reservation retained for owner recovery", file=sys.stderr)
            return 20
    # A scan is a report: never treat its zero exit as permission to launch work.
    return 0 if args.action == "scan" and len(results) == len(BLOCKS) else results[0]["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
