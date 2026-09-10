#!/usr/bin/env python3
"""
scripts/check-place-chas-fresh.py

Staleness guard for data/hna/place-chas.json. Regenerates it from the COMMITTED
inputs and fails if the committed file differs from a fresh build (ignoring only
the volatile `generated_at` timestamp). Mirrors check-ranking-index-fresh.py and
check-place-pages-fresh.py.

This is the guard that was MISSING while nothing regenerated the file at all.
It was last built by hand on 2026-07-14, so it drifted from data/hna/summary/
on every ACS refresh and only occasionally crossed the 0.01 tolerance in
place-chas-tenure-anchor.test.js. The 2026-09-10 refresh finally pushed it over,
and the drift surfaced as an unrelated PR failing CI on files it never touched --
the worst way to find out. build-hna-data.yml Phase 6.4 now rebuilds it; this
check makes the drift fail loudly if that phase is removed, reordered before the
ACS phases, or silently warns and continues.

Mechanism: build into the working tree, capture `git diff` (timestamp-ignored),
then restore so a local run leaves no mess (CI checkouts are ephemeral).

GOTCHA: because this restores the file, do NOT run it between regenerating
place-chas.json and committing -- it will silently revert the regeneration and
leave downstream files (ranking index, digests) pointing at data that is no
longer there. Commit first, then verify.
"""
import subprocess
import sys

TARGET = "data/hna/place-chas.json"
# Only `generated_at` is volatile. Household counts, tenure splits and every
# cost-burden rate are DATA-derived — drift there is exactly what we want to
# catch, so it is NOT ignored.
IGNORE = r'"generated_at"'


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> int:
    gen = subprocess.run(
        [sys.executable, "scripts/hna/build_place_chas.py"],
        capture_output=True, text=True,
    )
    if gen.returncode != 0:
        print("build_place_chas.py failed to run:\n" + (gen.stderr or gen.stdout)[-2000:])
        return 2

    drift = git("diff", "-I", IGNORE, "--quiet", "--", TARGET).returncode != 0

    if drift:
        print(f"❌ {TARGET} is STALE: it differs from a fresh build (timestamp ignored).")
        print("   An input changed but build_place_chas.py was not re-run.")
        print("   Inputs: data/hna/summary/*.json (ACS anchor), data/hna/place-lehd.json,")
        print("           data/hna/place-tract-membership.json, data/market/chas_tract_co.json,")
        print("           data/market/acs_tract_metrics_co.json")
        print("   Fix:  python3 scripts/hna/build_place_chas.py")
        print("   Then rebuild what reads it, in order: build_ranking_index.py,")
        print("   build_ranking_scenarios.py, build_jurisdiction_metrics_digest.mjs,")
        print("   build_place_pages.py -- then commit.")
        stat = git("diff", "-I", IGNORE, "--stat", "--", TARGET)
        if stat.stdout:
            print("\nDiff stat:\n" + stat.stdout)
        diff = git("diff", "-I", IGNORE, "--", TARGET)
        if diff.stdout:
            print("\nDiff excerpt (first 160 lines):\n" + "\n".join(diff.stdout.splitlines()[:160]))
        git("checkout", "--", TARGET)
        return 1

    git("checkout", "--", TARGET)
    print(f"✅ {TARGET} is fresh (matches a build from the committed inputs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
