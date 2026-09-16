#!/usr/bin/env python3
"""
scripts/check-ranking-index-fresh.py

Staleness guard for data/hna/ranking-index.json. Regenerates it from the
COMMITTED inputs and fails if the committed file differs from a fresh build
(ignoring only the volatile `generatedAt` timestamp). Mirrors
check-place-pages-fresh.py.

This is the guard that was MISSING when ranking-index.json silently went stale
against its inputs: the committed index showed Silt's (0870195) 30%-AMI gap as
153 while co_ami_gap_by_place.json — the source, unchanged since 2026-05-09 —
said 157. Every HNA need score / rank was therefore computed off stale numbers,
and a routine regen shifted 495 of 547 ranks at once. With this guard, editing
an HNA input without re-running build_ranking_index.py fails CI.

Mechanism: build into the working tree, capture `git diff` (timestamp-ignored),
then restore so a local run leaves no mess (CI checkouts are ephemeral).
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from freshness_guard import refuse_if_dirty  # noqa: E402

TARGET = "data/hna/ranking-index.json"
# Only `generatedAt` is volatile. medianHousingGap, totals, and every ranking
# are DATA-derived — drift there is exactly what we want to catch, so it is NOT
# ignored. Only --quiet/--exit-code honour -I (not --name-only). The augmenters'
# stamps are literals rather than wall-clock, so they stay un-ignored too.
IGNORE = r'"generatedAt"'

# ranking-index.json has THREE producers, in this order. Regenerating with only
# the first is what deleted the F179 recency fields and the F191 boundary counts
# in June 2026 — 32 metrics per jurisdiction, across all 546, gone from the
# index and from every digest built off it, with nothing red. See #1698.
#
# Because this check compares a fresh build against the committed file, running
# a shorter chain here does not merely miss that: it ENFORCES it. A checker that
# rebuilt with the builder alone would fail the moment anyone restored the
# augmentation, which is exactly what it did between June and September.
CHAIN = [
    ("python", "scripts/hna/build_ranking_index.py"),
    ("node", "scripts/augment_ranking_index_recency.mjs"),
    ("node", "scripts/augment_lihtc_by_geometry.mjs"),
]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> int:
    refuse_if_dirty([TARGET], checker="check-ranking-index-fresh.py",
                    npm_script="test:ranking-fresh")

    for runtime, script in CHAIN:
        argv = [sys.executable, script] if runtime == "python" else ["node", script]
        gen = subprocess.run(argv, capture_output=True, text=True)
        if gen.returncode != 0:
            print(f"{script} failed to run:\n" + (gen.stderr or gen.stdout)[-2000:])
            return 2

    drift = git("diff", "-I", IGNORE, "--quiet", "--", TARGET).returncode != 0

    if drift:
        print(f"❌ {TARGET} is STALE: it differs from a fresh build (timestamp ignored).")
        print("   An HNA input changed but the index chain was not re-run.")
        print("   Fix — run all three, in order, then commit the result:")
        for runtime, script in CHAIN:
            print(f"     {'python3' if runtime == 'python' else 'node'} {script}")
        stat = git("diff", "-I", IGNORE, "--stat", "--", TARGET)
        if stat.stdout:
            print("\nDiff stat:\n" + stat.stdout)
        diff = git("diff", "-I", IGNORE, "--", TARGET)
        if diff.stdout:
            lines = diff.stdout.splitlines()
            excerpt = "\n".join(lines[:160])
            print("\nDiff excerpt (first 160 lines):\n" + excerpt)
        git("checkout", "--", TARGET)  # restore the working tree
        return 1

    git("checkout", "--", TARGET)  # restore the working tree
    print(f"✅ {TARGET} is fresh (matches a build from the committed inputs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
