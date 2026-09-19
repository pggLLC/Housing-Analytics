# `scripts/paper/build-paper-figures.mjs`

Measure the repository, and emit every figure the working paper cites.

The paper argues that a data system earns trust by refusing to publish what
it cannot support. A paper about that system whose own numbers were typed in
by hand would contradict itself the first time the data moved — and it did:
an earlier draft reported 498 test files because the counting glob matched
every *.test.js twice. The true number was 267. That is the whole reason this
file exists.

So: no figure in working-paper.html is authored. Each one is written by
scripts/paper/inject-paper-figures.mjs from what this emits, and
test/paper-figures-fresh.test.js fails CI if the published page and the
repository ever disagree.

ABSENCE DISCIPLINE (AGENTS.md): a figure that cannot be read is emitted as
null with a stated reason, recorded in `unavailable`. Never 0. `Number(null)`
is 0 and 0 is finite, so a coerced zero passes every downstream check and
renders as a real measurement — which in a paper is a false claim about
Colorado, not merely a wrong pixel.

  node scripts/paper/build-paper-figures.mjs            # write data/paper/figures.json
  node scripts/paper/build-paper-figures.mjs --stdout   # print, write nothing

## Symbols

### `CASE_GEOID`

The worked example. Palisade is the paper's case study throughout §03.

### `absent(key, reason)`

Record a figure that could not be read. Returns null so callers can assign.

### `countFiles(dir, test, { skip = [] } = {})`

Count files under `dir` matching `test`, recursively.

Deliberately NOT a shell glob. The 498-vs-267 error came from a glob whose
two patterns both matched *.test.js, double-counting every one of them. A set
of resolved paths cannot double-count.

### `trackedMatching(re)`

Tracked files only — untracked scratch must never inflate a published count.

### `canonicalInventory()`

Read the repository's own inventory declaration out of AGENTS.md.

scripts/compute-inventory.mjs already counts HTML pages, workflows, scripts,
docs, data files, geographies and LIHTC features, and ci-checks fails when
that line goes stale. Recomputing them here would make this file a SECOND
producer of the same numbers with its own counting rules — and it did: an
earlier version reported 239 build scripts and 1,622 data files against the
canonical 256 and 1,651, because it filtered by extension and the canonical
script does not. Two producers of one number is how this repository once
published Denver's overcrowding as both 51.2% and 2.9% on the same day.

So the paper defers. A figure it cannot parse from the canonical line is
null with a reason, never a recount.

### `hh`

CHAS counts are apportioned and land on fractions; the paper shows households.

### `SCREEN`

DECLARED: analyst-constructed, not repository methodology.

These cut points were chosen for the paper and have no validation beyond face
plausibility. They encode a judgment that one municipal programme can address
several hundred households but not several thousand. §06.6 says so in the
text, and they live here as named constants so a reader can change them and
re-run rather than having to trust them.

### `BUILD_ESTIMATE_WEEKS`

ANALYST-CONSTRUCTED, like the tractability screen in §04 — not a measurement.

The SCOPE below is measured. The per-workstream person-weeks are a judgment,
they carry no validation beyond face plausibility, and they live here as named
constants so a reader can change them and re-run rather than having to trust
them.

What the estimate IS: what a commissioned team would plausibly bill to build
this from a specification. What it is NOT: a claim that this much human effort
was expended here. Those are different quantities — a commissioned build
carries requirements negotiation, review cycles, sign-off and status reporting
that a single maintainer does not — and conflating them would be exactly the
unsupported claim this paper argues against.

### `VOLATILE`

Figures that legitimately change on every commit.

This repository takes roughly thirty commits a day, so a freshness gate that
compared the commit count would fail every pull request and be switched off
within a week — and a gate nobody can leave on protects nothing. These paths
are refreshed on a weekly cadence and excluded from the per-PR drift check;
everything else — every figure about Colorado — is gated strictly.

Adding a path here is a decision to stop checking it. Keep the list short,
and keep it to figures about the repository rather than about housing.
