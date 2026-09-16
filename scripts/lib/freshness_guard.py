"""
scripts/lib/freshness_guard.py

Refuse to run a freshness check when its target paths hold uncommitted work.

Every freshness checker in this repo works the same way: regenerate the target
into the working tree, diff it against HEAD, then `git checkout --` the target
so a local run leaves no mess. That last step is destructive, and it is aimed
at exactly the file a maintainer has just spent time regenerating.

The failure is silent. On 2026-09-15 it happened twice in one session: a
corrected `method` string was regenerated into data/hna/place-chas.json,
verified with `npm run test:place-chas-fresh`, and committed — and the commit
captured the file the checker had restored, not the one that had been built.
The fix appeared to land and had not. About ninety minutes later the same
mistake was repeated on the ranking index, this time after a commit message
had been written saying "Regenerate, commit, THEN check".

check-place-chas-fresh.py already carried a `GOTCHA:` comment describing this.
It was accurate, and it was in the Python — which is not where the person
typing `npm run test:place-chas-fresh` is looking. A rule that has to be
remembered under time pressure is not a control.

So: if the targets are dirty, say so and stop, before anything is overwritten.

CI is exempt, and the exemption is the point rather than a loophole: these
checks run on an ephemeral checkout with no uncommitted work in it, so there is
nothing there to protect, and a refusal there would be a gate nobody could
leave on. The guard exists for the working copy on someone's disk.
"""
import os
import subprocess
import sys

# Distinct from 0 (fresh), 1 (stale) and 2 (the generator itself failed), so a
# caller can tell "I refused to look" from "I looked and it was stale".
REFUSED = 3


def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def dirty_paths(targets):
    """Tracked-but-modified, staged, and untracked paths under `targets`."""
    out = _git("status", "--porcelain", "--", *targets).stdout or ""
    paths = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        # Porcelain v1: XY <path>, and for renames "XY <old> -> <new>".
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path:
            paths.append(path)
    return paths


def exempt():
    """True when nothing in the working tree is worth protecting."""
    return bool(os.environ.get("CI")) or bool(os.environ.get("FRESHNESS_ALLOW_DIRTY"))


def refuse_if_dirty(targets, *, checker, npm_script=None):
    """Exit with REFUSED if any target holds uncommitted work.

    Returns None when it is safe to proceed, so the caller reads as a guard
    clause rather than as a branch.
    """
    if exempt():
        return None
    dirty = dirty_paths(targets)
    if not dirty:
        return None

    joined = ", ".join(targets)
    print(f"⛔ refusing to run {checker}: uncommitted changes under {joined}.")
    print()
    print("   This check regenerates those paths and then restores them with")
    print("   `git checkout --`, which would silently discard your work.")
    print()
    print("   Uncommitted:")
    for path in dirty[:12]:
        print(f"     {path}")
    if len(dirty) > 12:
        print(f"     … and {len(dirty) - 12} more")
    print()
    print("   If you have just regenerated these files, you already know the answer")
    print("   this check would give: the committed copy is stale. Commit, then re-run.")
    if npm_script:
        print(f"   Commit first, then:  npm run {npm_script}")
    print("   To run anyway and lose the changes:  FRESHNESS_ALLOW_DIRTY=1 …")
    sys.exit(REFUSED)
