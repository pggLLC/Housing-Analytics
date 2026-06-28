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
import subprocess
import sys

TARGET = "data/hna/ranking-index.json"
# Only `generatedAt` is volatile. medianHousingGap, totals, and every ranking
# are DATA-derived — drift there is exactly what we want to catch, so it is NOT
# ignored. Only --quiet/--exit-code honour -I (not --name-only).
IGNORE = r'"generatedAt"'


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> int:
    gen = subprocess.run(
        [sys.executable, "scripts/hna/build_ranking_index.py"],
        capture_output=True, text=True,
    )
    if gen.returncode != 0:
        print("build_ranking_index.py failed to run:\n" + (gen.stderr or gen.stdout)[-2000:])
        return 2

    drift = git("diff", "-I", IGNORE, "--quiet", "--", TARGET).returncode != 0
    git("checkout", "--", TARGET)  # restore the working tree

    if drift:
        print(f"❌ {TARGET} is STALE: it differs from a fresh build (timestamp ignored).")
        print("   An HNA input changed but build_ranking_index.py was not re-run.")
        print("   Fix:  python3 scripts/hna/build_ranking_index.py   then commit the result.")
        stat = git("diff", "-I", IGNORE, "--stat", "--", TARGET)
        if stat.stdout:
            print("\nDiff stat:\n" + stat.stdout)
        diff = git("diff", "-I", IGNORE, "--", TARGET)
        if diff.stdout:
            lines = diff.stdout.splitlines()
            excerpt = "\n".join(lines[:160])
            print("\nDiff excerpt (first 160 lines):\n" + excerpt)
        return 1

    print(f"✅ {TARGET} is fresh (matches a build from the committed inputs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
