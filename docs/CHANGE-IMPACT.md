# Change-impact map — what else to touch

Look up what you changed. Each row lists the files that must change with it and
the gate that fails if they do not. Everything here is derived from the repo as
it stands, not from memory; the "verify" column is a command you can run.

Most of this exists because a change looked complete, passed CI, and shipped a
defect anyway. Where that happened, the row says so.

---

## 1. Generated artifacts — never edit the output

Four families of files are generated. Editing the output directly is always
wrong: the next generator run silently reverts it, and the freshness gate
fails in the meantime.

| Source of truth | Generator | Output | Freshness gate |
|---|---|---|---|
| `housing-needs-assessment.html` + `data/hna/hna-views.json` | `scripts/hna/build_hna_views.py` | the 5 `hna-*.html` views | `npm run test:hna-views-fresh` |
| `places/_template.html` + `data/hna/place-chas.json` | `scripts/hna/build_place_pages.py` | `places/<geoid>.html` (482) | `npm run test:place-pages-fresh` |
| ranking inputs | `scripts/hna/build_ranking_index.py` | `data/hna/ranking-index.json` | `npm run test:ranking-fresh` |
| ranking index | `scripts/hna/build_ranking_scenarios.py` | ranking scenarios | `npm run test:ranking-scenarios` |

**Ranking has an ordering rule:** rebuild scenarios *after* every index regen,
or `ci-checks` fails on a pinned `generatedAt`.

**Jurisdiction briefs and digests regenerate in place during `test:ci`.** A
hand-authored brief section gets orphaned mid-suite, so `test:briefs` passes in
isolation and fails only under the full suite.

---

## 2. Editing the canonical HNA page

`housing-needs-assessment.html` is the source for five generated views. Any
edit to it means:

```bash
python3 scripts/hna/build_hna_views.py     # regenerate
npm run test:hna-views-fresh               # prove no drift
```

**Structural edits need more care than content edits.** The generator decides
what a "section" is by walking out to the innermost enclosing **content unit** —
a `<section>` or a `.chart-card`. If you wrap a heading in a new presentational
div, or move a panel out of its card, you change what the generator removes.
Two shipped leaks came from exactly this:

- A heading inside a plain `<div>` inside its own `<section>` → removal took the
  div and left the section shell, the intro prose and every element id behind.
  Renderers key on ids, so views computed and displayed figures inside a
  container the reader could not see.
- A heading inside a flex wrapper inside `.chart-card` → removal took the
  heading and left 7,702 chars of chart panel as a headless card.

`--check` now catches both, plus the symptom directly:

| Guard | What it catches |
|---|---|
| orphan guard | a view keeping a section whose parent it drops |
| `assert_no_leftovers` | a dropped section's element ids surviving on the page |
| `headless_cards` | a card with content or a `<canvas>` and no heading |
| dead-anchor check | `href="#x"` where nothing on that page defines `x` |
| renderer/exporter hooks | `hna-renderers.js` still reads `HNA_VIEW_ANCHORS`; `hna-export.js` still reads `HNA_VIEW` |
| `test:hna-view-content-parity` | a kept section's markup diverging from the canonical page's |

### View coverage

`npm run test:hna-view-content-parity` (in `test:ci`) asserts that for every
section a view keeps, the card that owns it is byte-identical to the canonical
page's, once the generator's declared rewrites are normalised away. 65 sections
across the five views.

That is what makes the canonical page's 49 test files cover the views too: if a
kept section is identical to its canonical original, every disclosure,
provenance, vintage-label and absence assertion made against the canonical page
holds on the view by construction.

```bash
grep -l "housing-needs-assessment.html" test/*.js test/*.mjs | wc -l   # 49 pin the canonical page
```

The parity suite also pins, per view: the "Screening tool only" disclaimer, the
executive decision strip, and a `<title>` that names the view. All five
assertions are sabotage-tested.

**What it does NOT cover:** anything a view renders that the canonical page does
not — the switcher, the step label, the pruned asset list — and runtime
behaviour of any kind. A content rule that holds in markup but breaks when the
view's reduced script set runs is still unasserted.

---

## 3. Renderers that feed cross-cutting UI

A section-scoped renderer usually opens with `if (!el) return;`. That guard is
correct for the section and wrong for anything global it also feeds — the
executive decision strip, banners, narratives. The tile keeps its placeholder
forever and reads as broken rather than absent.

**Raise the absence signal at the OUTERMOST guard.** `#1643` added `if (!el)
return` at several layers of the ownership chain; a patch at the inner layer
never ran, because the outer one returned first.

If you add a guard to a renderer in `js/hna/hna-renderers.js`, ask what else
that function writes to, and whether a page without the section still needs
that write.

---

## 4. Data files

| You changed | Also update | Gate |
|---|---|---|
| added a file under `data/` | one entry in `data/_manifest.json` | `npm run test:file-manifest` |
| changed a `data/` file's size | that file's `bytes` in `data/manifest.json` | `npm run test:file-manifest` |
| either of the above | `data/_manifest.json`'s own `bytes` in `data/manifest.json` | same |

**Never run `scripts/rebuild_manifest.py` locally.** The repo sits inside iCloud
Desktop & Documents sync, and a rebuild ingests the numbered `" 2"` duplicates
it creates — 2,355 phantom entries in one observed run. Patch the single field
instead, and assert exactly one regex match before writing.

To add one entry without a full rebuild, take it from the builder's own probe:

```bash
node --input-type=module -e '
import { buildManifest } from "./scripts/audit/build-data-manifest.mjs";
const fresh = await buildManifest({ write: false });
console.log(JSON.stringify(fresh.files.find(f => f.path === "your/file.json")));'
```

Purge duplicates before any manifest work:

```bash
find . \( -path ./node_modules -o -path ./.git \) -prune -o \( -name "* [0-9].*" -o -name "* [0-9]" \) -prune -print -exec rm -rf {} +
```

They reach `.git/refs` too, where they break plain git commands mid-operation.

### Transit data (#1937)

| You changed | Also update | Gate |
|---|---|---|
| `scripts/market/build_transit_stops_co.py` or its sources | regenerate `data/amenities/transit_stops_statewide_co.geojson` **and** `data/market/transit_stops_coverage_co.json` together (one run writes both) | `pytest tests/test_transit_stops_statewide.py` (report must agree with the stop file) |
| the statewide stop file's shape (property names) | `js/market-analysis.js` TOD check (`reliability`), `data-map-browser.html` popup, `js/data-source-inventory.js` entry | `npm run test:qap-tod-points`, `npm run test:data-source-inventory-paths` |
| `data/amenities/transit_stops_co.geojson` (OpenStreetMap) | nothing directly: it is an input to the statewide file, where its stops are marked `unconfirmed`. It still feeds `build_ranking_index.py` and `build_neighborhood_access.py` until #1937 Phase 3 | `pytest tests/test_transit_stops_statewide.py` |
| `data/market/transit_routes_co.geojson` | nothing; the fetcher drops routes with no vertex in Colorado | `pytest tests/test_data_plausibility.py -k touch_colorado` |
| `js/transit-zone.js` (the one zone answer) | nothing else computes zone status; pages call `TransitZone.create(...).status(lat, lon)` | `npm run test:transit-zone` |
| `data/policy/thiz-map-status.json` (radius, OEDIT due date, publication status) | the HB26-1065 entry in `data/policy/tax-credit-legislation.json` must give the same due date and radius; when OEDIT publishes, set `status`, commit the zones and name them in `zones_file` | `npm run test:transit-zone` |
| CDOT or agency-feed failures | nothing: a failed CDOT request exits non-zero and leaves the file untouched | `npm run test:required-fetch-preserves-data` |

`npm run finish-line` items **T1** and **T2**: T1 reads both transit files and reopens if CDOT drops out, a stop loses its source or county, the report loses a county, or the file passes its 16-day SLA. T2 reopens a week after the OEDIT map's due date unless `thiz-map-status.json` records a check after it.

---

## 5. Adding or removing a file

| You changed | Also update | Gate |
|---|---|---|
| added any file under `js/` or `scripts/` | the inventory line in `AGENTS.md` **and** `README.md` | `ci-checks` runs `node scripts/compute-inventory.mjs` |
| added a top-level HTML page | `js/navigation.js`, `sitemap.xml`, the inventory line | `test:navigation-paths`, `test:orphan-nav-cleanup`, `test/pages-availability-check.js` |

`compute-inventory.mjs` counts **tracked** files, so `git add` first, then:

```bash
node scripts/compute-inventory.mjs --write
```

It is not part of `test:ci` — it runs as its own step in `ci-checks.yml`, so a
green local `npm run test:ci` does not prove the inventory line is current.

---

## 6. Files with pinned assertions in the deploy gate

`sitemap.xml`, `robots.txt` and `CNAME` are asserted by
`test/pages-availability-check.js`, which runs inside `deploy.yml` — **not** in
`test:ci`. A bad edit passes PR CI and breaks the deploy.

```bash
node test/pages-availability-check.js
```

The sitemap host is derived from `CNAME`, so a domain change must move both.

---

## 7. Navigation and CSS

| You changed | Gate |
|---|---|
| `js/navigation.js` | `test:navigation-paths`, `test:orphan-nav-cleanup`, `node test/xss-navigation.test.js` |
| any CSS custom property | `npm run test:phantom-css-vars` (references must resolve to a defined token) |

Watch specificity when adding rules to `css/pages/housing-needs-assessment.css`.
The measure rule is `#main-content p:not([style*="font-size"])` — the `:not()`
counts as an attribute selector, so a bare class scoped to `#main-content`
still loses (0,1,1,0 vs 0,1,1,1). Match the element type to tie it.

---

## 8. Gates that run nowhere

Eleven `test:*` scripts are absent from `test:ci`, but most are still covered —
some are called by another script that IS in `test:ci`, others are invoked by a
workflow through their underlying file rather than the npm name. Chasing that
indirection matters: the naive "not in `test:ci`" list overstates the problem
three times over.

Covered indirectly, despite not appearing in `test:ci`:

| Script | Reached by |
|---|---|
| `test:url-health-policy` | `test:file-manifest`, which is in `test:ci` |
| `test:hna-build-concurrency`, `test:hna-prop123-relationship` | `test:hna`, which is in `test:ci` |
| `test:smoke` | `ci-checks.yml`, as its own step |
| `test:pages` | `deploy.yml`, via `test/pages-availability-check.js` |
| `test:contrast`, `test:runtime-contrast` | `contrast-audit.yml`, via their scripts |

**Genuinely unreachable — these run only if a person runs them:**

```
test:rendered-mobile-overflow    test:hna-chas-vintage-disclosure    test:qa-recent
```

(`test:hna-benchmarks` runs its script `check_benchmarks.py` from
`rebuild-bps-permits.yml`, so it fires on that cron but on no PR.)

Do not trust the list above after it ages. Regenerate it, then check each
result for indirection before concluding anything:

```bash
node -e '
const p=require("./package.json").scripts, ci=p["test:ci"];
const inCi=new Set(ci.split("&&").map(s=>s.trim()).filter(s=>s.startsWith("npm run ")).map(s=>s.slice(8).trim()));
const out=Object.keys(p).filter(k=>/^test:/.test(k) && !["test:ci","test:all"].includes(k) && !inCi.has(k));
out.forEach(t=>{
  // substring matching lies here: "npm run test:pages" also matches
  // "npm run test:pages-deploy-watchdog". Split on && and compare whole tokens.
  const callers=Object.entries(p).filter(([k,v])=>k!==t &&
    v.split("&&").map(x=>x.trim()).some(x=>x==="npm run "+t)).map(([k])=>k);
  console.log(t.padEnd(36)+(callers.length?"called by "+callers.join(", "):"CHECK WORKFLOWS for "+p[t]));
});'
```

## 9. Before believing a green CI

- **`gh pr checks <n> | grep -c '^ci-checks'` must be ≥ 1.** Zero means no
  `ci-checks` run existed. Conflicting PRs get no merge ref and therefore no
  `pull_request` workflows at all, while CodeQL still reports green.
- **Cron and bot commits to `main` get no CI.** A PR failing on files it never
  touched usually means `main` broke after you branched.
- **A guard must not derive its input from the logic it checks.** A leftover
  guard built on the generator's own spans reported CLEAN against the bug it
  was written for; so did a hand audit written the same way. The check that
  caught it asked the reader's question instead — "is there content here with
  no heading?" — and found 28 instances the structural checks missed.
- **Sabotage-test with a count.** Break the fix, confirm the gate fires *and*
  how many things it reports. "The guard still passes" after a sabotage is a
  failure signal.
- **A guard that pins user-facing copy must name what the copy has to agree
  with** (#1746). Pin the claim — the figure equals the data file, the link
  names what it opens, the second card does not contradict the first — not
  the sentence. Sabotage both ways: a rewording stays green, a broken claim
  fails, and each mutation is shown to have applied. See "Guards: pin the
  agreement, not the copy" in `AGENTS.md`.
