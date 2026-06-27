#!/usr/bin/env python3
"""
scripts/check-place-pages-fresh.py

Staleness guard for the per-place profile pages (places/<geoid>.html).
Regenerates them from the COMMITTED data and fails if the committed pages
differ from a fresh build — i.e. the data changed but build_place_pages.py was
never re-run. This is the exact break that served Silt 5.3 vs 277 households
for ~3 weeks (place-chas.json got the May-29 apportionment fix; the pages were
never regenerated, and nothing caught it).

Mechanism: run the generator into the working tree, capture `git status places/`,
then restore the tree so a local run leaves no mess (CI checkouts are ephemeral).
"""
import subprocess
import sys


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> int:
    gen = subprocess.run(
        [sys.executable, "scripts/hna/build_place_pages.py"],
        capture_output=True, text=True,
    )
    if gen.returncode != 0:
        print("build_place_pages.py failed to run:\n" + (gen.stderr or gen.stdout)[-2000:])
        return 2

    # Real drift = any content changes in tracked pages. The generator no
    # longer stamps wall-clock "Generated:" lines, so a no-op regen should be
    # a clean diff without special timestamp ignores.
    real_drift = git("diff", "--quiet", "--", "places/").returncode != 0
    untracked = [l[3:] for l in git("status", "--porcelain", "--", "places/").stdout.splitlines() if l.startswith("??")]
    # Best-effort list of the genuinely-changed pages (numstat rows beyond the
    # 1-insert/1-delete timestamp swap) — for the error message only.
    changed = []
    if real_drift:
        for row in git("diff", "--numstat", "--", "places/").stdout.splitlines():
            parts = row.split("\t")
            if len(parts) == 3 and (parts[0] != "1" or parts[1] != "1"):
                changed.append(parts[2])

    # Restore the working tree: undo regenerated changes to tracked pages, and
    # drop any newly-generated untracked pages. Scoped to places/, which is
    # entirely generated (the only tracked non-page file, _template.html, is an
    # input and is left untouched because git clean never removes tracked files).
    git("checkout", "--", "places/")
    git("clean", "-fdq", "--", "places/")

    if real_drift or untracked:
        stale = changed + untracked
        print(f"❌ Place pages are STALE: {len(stale) or 'one or more'} page(s) differ from a fresh build.")
        print("   The data changed but `scripts/hna/build_place_pages.py` was not re-run.")
        print("   Fix:  python3 scripts/hna/build_place_pages.py   then commit places/")
        if stale:
            print("   (first few:)")
            for f in stale[:8]:
                print("     " + f)
        return 1

    print("✅ Place pages are fresh (match the committed CHAS data).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
