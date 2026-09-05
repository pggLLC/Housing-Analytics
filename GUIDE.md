# Working in this repo

A short orientation for a human opening `Housing-Analytics` for the first time —
what it is, how to run it, and the handful of things that will surprise you.

It does not restate the reference docs. `README.md` catalogues the features,
`AGENTS.md` carries the conventions and the trap list, and `docs/` holds 446
methodology and integration documents. This is the map that tells you which of
those you actually need.

---

## What this is

COHO Analytics is a **public-interest static site** for Colorado affordable-housing
data, live at [cohoanalytics.com](https://cohoanalytics.com). Its readers are
housing practitioners: town planners writing a housing needs assessment, developers
screening a LIHTC deal, advocates preparing testimony.

Two consequences shape everything else in the repo:

**It is genuinely static.** No bundler, no framework, no server. Client JavaScript
attaches to `window.*` through hand-ordered `<script>` tags, and GitHub Pages serves
the files as they sit in the repository. What you see in the working tree is what
ships.

**The data is committed, not fetched at runtime.** Roughly 56 scheduled workflows
pull from federal and state APIs — Census ACS, HUD, LEHD, DOLA, FRED, CHFA — and
commit the results back to `main` as JSON. The browser reads those files. This is
why `data/` holds ~1,650 files and why `main` receives automated commits every
couple of hours.

That second point is the source of most of this repo's peculiarities. Keep it in mind.

---

## Quick start

```bash
npm install
npx http-server . -p 8765 --silent
```

Open <http://127.0.0.1:8765>. That is the whole build step — there isn't one.

CI runs Node 22; `package.json` declares `>=16`. The Python pipeline scripts need
`jsonschema` and are exercised by `pytest tests/ -v` (26 files).

Useful entry points once it's serving:

| Page | What it does |
|---|---|
| `housing-needs-assessment.html` | The flagship — per-jurisdiction housing need for all 546 Colorado geographies |
| `deal-calculator.html` | LIHTC deal feasibility and pro forma |
| `market-analysis.html` | Primary market area analysis for a site |
| `lihtc-opportunity-finder.html` | Screens tracts against QCT/DDA/opportunity criteria |
| `economic-dashboard.html` | Statewide economic indicators |

---

## How a number reaches the screen

Worth tracing once, because nearly every defect in this repo lives somewhere on
this path:

```
federal/state API
      │  a scheduled workflow (.github/workflows/*.yml) fetches on a cron
      ▼
scripts/**.mjs | scripts/**.py       transform, apportion, validate
      ▼
data/**.json                          committed back to main
      │  python scripts/rebuild_manifest.py  →  data/manifest.json
      │  node scripts/validate-schemas.js    →  schema gate
      ▼
GitHub Pages deploy (deploy.yml)
      ▼
js/**.js  fetch('data/…json')  →  render
```

Two things follow from the shape of it.

**A data change is a code change.** Touching anything under `data/` means
regenerating `data/manifest.json` and re-running schema validation before you
commit, or CI fails. This is `AGENTS.md` hard constraint #3, and it is not optional.

**Derived files are coupled to their sources.** Place pages
(`places/*.html`) are generated from `scripts/hna/build_place_pages.py` and do not
regenerate themselves. `ranking-scenarios` pins the `generatedAt` of
`ranking-index`. Brief ownership sections are rewritten mid-test-run. Regenerate the
producer, never hand-edit the product.

---

## Making a change

Branch, change, test, PR. Nothing is pushed to `main` directly, and nobody merges
their own PR — the repository owner is the only merge gate.

```bash
git checkout -b fix/short-description origin/main
# … edit …
npm run test:ci          # the full JS gate — slow, see below
git commit && git push -u origin HEAD
gh pr create
```

### The test suite

`npm run test:ci` chains **151** individual test scripts. It is thorough and it is
slow — plan on it running for a long while rather than watching it. In practice:

- Run the **targeted** scripts for what you touched while iterating
  (`npm run test:hna`, `npm run test:deal-calc-correctness`, and so on; over 200 are defined in `package.json`).
- Run the **full** `test:ci` once before opening the PR.

Two caveats that have each shipped a broken `main`:

- **A targeted script passing is not evidence.** `npm run test:briefs` is only the
  Python validator and misses the JS brief tests entirely. Some tests only fail
  under the full run, because earlier steps rewrite the files they assert on. That
  is real, not a flake.
- **`npm test` rewrites tracked files while it runs.** It regenerates every file
  under `data/hna/jurisdiction-metrics-digest/` and rewrites several
  `data/jurisdiction-briefs/*.json` in place. A mid-run `git status` looks like
  catastrophic data loss. It self-restores; afterwards, `git checkout -- data/`.

### Writing a test that is worth having

The house method is **sabotage**: disable the guard you just wrote, confirm the test
fails, and check that your edit landed on executable code rather than on a comment
or a string the test happens to match. A test that passes with its subject removed
is documentation, not a guard.

---

## Things that will surprise you

The complete list lives in `AGENTS.md` under *Traps that will hand you a red CI* and
*Green is not the same as verified*. Read it before your first PR. The five that
cost the most time:

**A PR can fail on files it never touched.** Data crons commit to `main` with CI
suppressed, so `main` can be broken for hours with no red run to show for it. Check
`main` before debugging your own diff.

**`MERGEABLE` does not mean CI passed.** A PR with merge conflicts gets *zero*
`pull_request` workflow runs — no merge ref means no runs — which presents as *no
checks*, not as failing checks. Read the individual check list and confirm
`ci-checks` actually appears.

**`data/manifest.json` churns constantly.** Crons touch it every couple of hours, so
a PR that carries a manifest change goes conflict-dead quickly. Rebase and merge
promptly, or keep the manifest out of the branch if you can.

**The repository lives on an iCloud-synced volume.** It accumulates gitignored
duplicates (`08001 2.json`, `08001 3.json`) that corrupt any script walking the
filesystem — `rebuild_manifest.py` among them. A clean `git status` does not rule
this out, because the duplicates are gitignored. Delete them immediately before any
rebuild, and verify the resulting entry count against `main`.

**Test fixtures are probed for real.** The source-URL sweep scans URLs on the added
lines of a diff, including ones inside test files and comments. A real citation in a
fixture will be dialled. Use loopback URLs (`http://127.0.0.1/…`) in tests.

---

## An unmeasurable quantity is `null`, never `0`

The single most productive idea for understanding this codebase, and the one defect
class that recurs ([#1480](https://github.com/pggLLC/Housing-Analytics/issues/1480)).

`Number(null) === 0`, and `0` is finite. So a missing value silently becomes a real
quantity, passes every `Number.isFinite()` check downstream, and reaches a housing
planner as a figure they will act on. It has produced a `$0` median home value for
53 of 482 places, `-$320,000` of owner equity, an overcrowding rate of
`-1,333,333,332%` clamped to a confident zero, and a flat chart line for a dead data
series.

A neutral default is the same defect wearing a different number: `scoreMap[x] || 50`
scores an unrecognised category as average.

Guard the absence where the value is *resolved*, not in the renderer — fixing only
the renderer has already failed here, because the coercion happened two layers
upstream. Carry the reason alongside the data; the repo already has the pattern
(`priceUnavailableReason`, `demandUnavailableReason`, and siblings).

Neither tests nor linters nor CodeQL catch this class. Every instance so far was
found by reading the code or running the tool against a real jurisdiction.

---

## Where things live

```
*.html                  54 top-level pages — the site's surfaces
places/*.html           generated per-place pages (never hand-edit)
js/
  hna/                  housing needs assessment: loader, controller, renderers
  components/           shared UI (glossary, provenance badges, cards)
  market-analysis/      primary market area analysis
  data-connectors/      fetch + normalise helpers
  utils/                shared guards and formatters
  vendor/               third-party, unmodified
css/                    hand-authored; tokens in site-theme.css
data/
  hna/                  the bulk — per-geography ACS/CHAS/LEHD caches
  market/, policy/ …    topic datasets
  manifest.json         generated inventory; never hand-edited
scripts/
  hna/                  the HNA build pipeline (Python + .mjs)
  audit/                URL sweeps, contrast audits, link health
  *.mjs / *.py          244 build and fetch scripts
test/                   200 JS test files
tests/                  26 Python test files
.github/workflows/      67 workflows — 56 crons, 6 PR-triggered, 5 other
docs/                   446 methodology and integration documents
```

Counts come from the CI-enforced inventory line in `README.md` and `AGENTS.md`.
Regenerate it with `node scripts/compute-inventory.mjs --write`; never hand-patch
the numbers.

---

## Where to go next

| You want to | Read |
|---|---|
| Understand the conventions before writing code | `AGENTS.md` |
| Use the housing needs assessment as a practitioner | `HOUSING-NEEDS-ASSESSMENT-USER-GUIDE.md` |
| Know how affordability is calculated | `docs/AFFORDABILITY-METHODOLOGY.md` |
| Know where a dataset comes from | `docs/DATA-SOURCES.md`, `docs/DATA_SOURCES_TABLE.md` |
| Add or refresh a data source | `SETUP-DATA-SOURCES.md`, `docs/DATA_INTEGRATION_GUIDE.md` |
| Understand the LIHTC modelling | `docs/LIHTC-METHODOLOGY.md` |
| Understand HNA projections | `docs/HNA_PROJECTION_ASSUMPTIONS.md` |
| Match the visual language | `docs/DESIGN-SYSTEM.md` |
| Deploy or debug Pages | `docs/DEPLOYMENT_GUIDE.md` |
| Contribute | `docs/CONTRIBUTING.md` |
| Know what changed | `CHANGELOG.md` |

---

## A note on review

A passing check list answers *"did the jobs report success"*, not *"did the work
happen"*. Those are different questions, and the second one is the one that matters
here — a workflow that never triggered reports nothing, an audit that rendered
nothing still exits 0, and a `cancelled` job renders grey rather than red.

Approving a diff catches code defects. It does not catch a check that never ran or a
`main` that is already broken. Both jobs need doing.
