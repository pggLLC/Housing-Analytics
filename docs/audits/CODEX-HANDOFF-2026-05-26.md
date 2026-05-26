# Codex — Full Repo Deep Dive

**For**: Codex (or fresh senior reviewer)
**Date**: 2026-05-26 (originally written ~noon; refreshed end-of-day with F1–F7 additions)
**Last formal review**: PR #894 (Opportunity Finder shipping). ~30 commits direct-to-main since then.
**Scope of this handoff**: NOT just OF QA — **the whole repository**.

> 📌 **Read the "Post-handoff additions (F1–F7)" section below before starting the deep dive.** Seven user-driven enhancements landed direct-to-main after this doc was first drafted; they fix bugs you'd otherwise rediscover and shift baseline numbers (LIHTC 716 → 926, year range 1987–2020 → 1987–2025).

---

## What we want from you

A genuine senior-engineer code audit of the entire repo. Not just spot-checking the LIHTC Opportunity Finder (which we've been iterating on heavily). We want fresh eyes on:

1. **Architecture** — module boundaries, data flow, scoring duplication, dead code
2. **Code quality** — bugs, fragile patterns, error handling, type discipline (or lack thereof)
3. **Data pipeline** — fetch script reliability, schema-validation gaps, vintage-tracking
4. **CI / deploy hygiene** — workflow health, test coverage gaps, deploy-time errors
5. **Performance** — first-paint, asset sizes, render-blocking scripts, oversized data files
6. **Accessibility / mobile** — keyboard nav, screen-reader support, mobile layouts
7. **Security** — XSS in dynamic HTML, dependency vulnerabilities, secrets handling
8. **Documentation** — methodology accuracy, stale docs, internal consistency
9. **The product** — does the deal-targeting workflow actually deliver the user's stated goal ("where in CO should a developer spend scarce time looking for the next LIHTC deal")?

We have an exhaustive in-house tooling pass (36-check verification harness + 42-page asset validator + critical-data sentinels). Those tell us the lights are on. **What we need from you is whether the engine is well-built.**

---

## Pre-flight check (verify before deep dive)

These should all pass before you begin:

```bash
git pull origin main
node --version          # expect 20+; current dev box on v24
npm install             # for any first-time dev deps

# Lights-on check
npm run validate                          # 42 HTML pages, asset refs
npm run validate:data                     # critical data thresholds
npm run audit:opportunity-finder          # 36 checks of the LIHTC OF
npm run test:qa-recent                    # broader QA harness
```

Expected: green on all four. As of 2026-05-26 (last F7 commit `75bb864c`):
- harness: **36/36** OF + **714/714** HNA functional checks
- validate: 42 HTML files OK
- critical data: 1,447 tracts + 224 QCT + 10 DDA + **926** LIHTC (CHFA live, was 716 HUD-lagged at original handoff)
- 9/9 critical URLs live and 200
- Scoring consistency OF↔Compare verified on 6 jurisdictions × 4 targets (24/24 match)

If any of these fail at HEAD, **stop and report** — main shouldn't be broken.

---

## Recent context (what's new since you last reviewed)

### Data layer (substantial expansion)

| Source | Before | After |
|---|---|---|
| LIHTC | HUD LIHTCDB cache, 716 features, capped YR_PIS=2020 | **CHFA live**, 926 features through **2025** |
| Affordable-housing properties | NHPD 20-record sample only | **Unified `data/affordable-housing/properties.json`** with 3,073 records from 4 sources (CHFA LIHTC + CHFA Preservation + HUD MF Assisted + USDA Rural Housing), `program_type` discriminator, `subsidy_type` detail where available, USDA `years_to_expiration` for preservation urgency |
| Tract centroids | `tract_centroids_co.json` (scrambled GEOID→coord pairings — verified, see Appendix A.2 of audit) | OF abandoned the file; uses county centroids derived from `co-county-boundaries.json` polygons |

### Scoring (significant change)

- Migrated OF from **4-dim** composite to full **5-dim** per methodology §4 (civic readiness now in composite at 10–30% depending on target)
- **6 target deal types** (was 3): 9% Competitive / 4% Bond / Preservation / Workforce-Resort / Prop 123 Local / Balanced
- Smart filter auto-application (preservation target → relaxes basis filter; prop123 target → same)

### UI / UX

- `compare.html` NEW — side-by-side jurisdiction comparison
- Cross-page funnel: `js/components/next-action-cta.js` auto-mounted on HNA + OF + PMA + Deal Calculator
- Methodology section always-visible on OF (was collapsed `<details>`)
- Plain-English weight-table explanation + tooltips on every column/row
- Compact filter UI (was bulky button pills; CSS specificity bug fixed)
- Map: county centroid markers, maxBounds CO + 50mi, layer control with 4 base maps + county/QCT overlays
- 6-region filter (Front Range, Mountains, Western Slope, Southwest, San Luis Valley, Eastern Plains)
- Preservation filter (min count slider + urgent ≤5y toggle)
- Civic capacity panel (3-way join: scorecard + local-resources + prop123 with county fallback)
- Housing news linkouts (Google News + CO Sun + CPR + BizWest + county + housing-staff search)

### Verification

- `scripts/audit/verify-opportunity-finder.mjs` updated to 36 checks
- `scripts/fetch-chfa-lihtc.js`, `scripts/fetch-chfa-preservation.js`, `scripts/fetch-hud-multifamily.js`, `scripts/fetch-usda-rural-housing.js`, `scripts/build-affordable-housing-properties.js` — all new
- 4 fetch scripts can refresh data from live ArcGIS services on demand

---

## Post-handoff additions (F1–F7, 2026-05-26)

This handoff was originally written before 7 follow-up enhancements landed direct-to-main. **Don't re-do these. Do verify them.** All shipped, all CI green, all browser-verified.

### F1 — Local-resources for 15 major CO cities

- Problem: User reported "Local resources are missing for a City like Boulder???"
- Fix: `scripts/augment-local-resources.js` (new) populates place-level `data/hna/local-resources.json` entries for Denver, Boulder, Aurora, Fort Collins, Colorado Springs, Pueblo, Greeley, Longmont, Loveland, Lakewood, Grand Junction, Durango, Steamboat, Aspen, Vail.
- Schema gotcha fixed in F7: `housingPlans[].name` (not `.title`) — matches county-level convention. Validator was rejecting F1 entries; OF renderer was reading the wrong field too. Both reconciled in `c9c3a1f9`.

### F2 — 3 nearest LIHTC properties per jurisdiction

- New `haversineMiles()` helper + `nearestLihtc[3]` field on each OF row. Each detail panel now shows the 3 closest LIHTC projects with distance (miles).
- Implementation in `js/lihtc-opportunity-finder.js` `_computeOpportunities()`.

### F3 — Resort + public-lands adjacency flag

- New `RESORT_COUNTIES` table (20 entries: Pitkin/Aspen, Summit/Breck, Eagle/Vail, Routt/Steamboat, San Miguel/Telluride, etc.)
- New `PUBLIC_LANDS_HEAVY_COUNTIES` table (25 entries: BLM/USFS/NPS counties >25% federal land)
- Surfaces as pills in the OF detail panel + factors into the `workforce_resort` deal-type composite

### F4 — Compare row click = dimension definition popover

- 18 dimension rows in `compare.html` are now click-to-toggle for an inline definition. Reduces user need to context-switch to methodology doc.
- Implementation in `js/compare.js` — purely client-side, no API change.

### F5 — Map overlays: 926 LIHTC + 224 QCT + 10 DDA + legend

- Problem: User reported "LIHTC, QCT & DDA - doesn't seem to have the update dataset in the map"
- Fix in `js/lihtc-opportunity-finder.js` `_initMapOverlays()` and `lihtc-opportunity-finder.html` (legend CSS):
  - All 926 CHFA LIHTC properties rendered as color-coded markers (green 9% / blue 4% / purple state+MIHTC) with tooltips
  - All 10 DDA county polygons (blue, translucent) — was filter-driven, now global always-on
  - All 224 QCT tract polygons (orange, translucent) — was off-by-default, now on-by-default
  - Permanent bottom-right legend explains every color/shape
  - Layer control top-right toggles each overlay independently
- `_renderMap()` no longer touches DDA/QCT layers — overlays are static after `_initMapOverlays()`

### F6 — colorado-deep-dive map: CHFA-first source cascade

- Problem: User reported "doesn't seem to have all recent projects" on the deep-dive map.
- Root cause: `js/co-lihtc-map.js` tried HUD's lagged national LIHTC ArcGIS service first (716 projects, ~14 since 2023). Fresh CHFA cache (926 projects through 2025) was tier-3 fallback — almost never reached.
- Fix: Inverted cascade. Tier 1 = local `data/chfa-lihtc.json`; Tier 2 = HUD multi-layer; Tier 3 = HUD single-layer; Tier 4 = embedded.
- Renamed misleading `useCHFA()` → `useHudMultiLayer()` (it always queried HUD, not CHFA).
- HTML attribution updated: legend, subtitle, data-sources row.

### F7 — CHFA portfolio sentinel defense + site-wide CHFA-first source

- Problem: User reported "chfa portfolio says year range between 1987-8888" — HUD sentinel 8888 ("unknown YR_PIS") passing through `years.filter(y => y > 0)`.
- Defensive fix in `chfa-portfolio.html`:
  - New `safeYear()` helper rejects sentinels (8888, 9999) and clamps to plausible LIHTC range (1986-2030).
  - Falls back through YR_PIS → AwardYear → YR_ALLOC → ReservationYear.
  - Year-range KPI now reads "1987-2025" (was "1987-8888").
- Credit filter dropdown was also broken: it used HUD numeric values ("1"/"2"/"3") but CHFA returns full strings ("9% Competitive", "4% Tax Exempt", "4% and State", "MIHTC"). Replaced with category options (9pct/4pct/state/mihtc) + new `matchesCreditCategory()` helper. Verified: 9pct=459, 4pct=464, state=166, mihtc=3.
- **Site-wide audit while sweeping for 8888 found 5 more pages still reading the lagged HUD geojson as primary**. All inverted to CHFA-first in `d1a4220a`:
  - `js/index.js` landing snapshot: 716 → 926
  - `js/historical-trends.js` stock trajectory: 716 → 926, year range 1987-2020 → 1987-2025
  - `about.html` data-sources page: fixed misleading "CHFA ArcGIS" URL that actually pointed at HUD
  - `js/data-source-inventory.js`: stale "716 features" / "Weekly" → "926 features" / "Daily"
  - `historical-trends.html` + `market-analysis.html`: visible attribution corrected
- `js/deal-calculator.js`: added `_safeYear()` guard in comparable-projects panel (`eac91aeb`). Without it, a sentinel-year HUD record sorts to the top as "most recent" and displays "8888".

### Things I considered conservative cleanup but did NOT do (for your judgment)

| # | Item | Why deferred |
|---|---|---|
| C1 | Delete `data/market/hud_lihtc_co.geojson` entirely | Now tier-2 fallback only. Keep for resilience? Or remove for single-source-of-truth? **Your call.** |
| C2 | Extract `js/scoring/shape.js` (was P0-1 in original audit) | Touches `lihtc-opportunity-finder.js` IIFE structure + `compare.js` duplication. Not a small change. |
| C3 | PMA + Deal Calculator `?fips=` auto-select | Cross-page funnel CTAs already pass the param; both pages just ignore it. Backlog item from F-Phase B. |
| C4 | Data Freshness CI workflow policy | Background workflow failing on stale-data SLAs. Open tracking issue. Not blocking CI gates. |
| C5 | NHPD full preservation refresh | Auth-required. CHFA Preservation + HUD MF + USDA RD substantially cover the same space (3,073 records combined). |
| C6 | Update `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md` | v1.1 doesn't mention F5 map overlays or F6/F7 CHFA-first cascade. **You may want to edit this in your review.** |
| C7 | Remove 28+ `.DS_Store` files + add `.gitignore` entry | Pure hygiene. Touches no logic. |

### Commits in this batch (read in order to understand the changes)

```
75bb864c  fix(deal-calc): defend comparable-projects panel against HUD year sentinels (F7-B)
de5f32fb  fix(lihtc): site-wide CHFA-first data source + chfa-portfolio sentinel defense (F7-A)
c9c3a1f9  fix(hna): housingPlans schema uses `name`, not `title` (CI gate fix)
59c4b509  feat(deep-dive): switch map LIHTC source to fresh CHFA cache (F6)
8056a2e0  feat(of): visualize 926 LIHTC properties + QCT + DDA on map with legend (F5)
0235aa4c  feat(lihtc): 4 enhancements before Codex handoff (F1-F4)
```

### Updated scoring-consistency baseline (F7 didn't touch scoring)

The 24/24 OF↔Compare match table further down in this doc was verified again after F5–F7 — still 24/24. F5 was map-only, F6 was source-only, F7 was display-only. None touched `compositeScore()`.

---

## Deep-dive checklist

Pick whichever order makes sense. We expect a senior-engineer survey, not exhaustive line-by-line review. **Spend most time on the architecture + product evaluation; least on lint-style nits.**

### 1. Architecture quality

- Read `js/lihtc-opportunity-finder.js` (1,300+ lines). Is this size justified or should it be split? What would a sensible module split look like?
- `js/compare.js` (440 lines) **duplicates scoring math** from OF because OF is an IIFE without exports. Audit P0-1 (`js/scoring/` extraction) addresses this. Confirm or challenge that this is the right next architectural move.
- 8+ scoring modules across the repo (`market-health-composite.js`, `housing-outcome-score.js`, `lihtc-deal-predictor.js`, `chfa-award-predictor.js`, `lihtc-deal-predictor-enhanced.js`, `pma-opportunities.js`, `lihtc-opportunity-finder.js`, `compare.js`). No shared `ScoreResult` contract. Real or imagined risk?
- `data/affordable-housing/properties.json` is the new unified data store. Should existing pages (colorado-deep-dive.html, market-analysis.html, CHFA-portfolio.html, LIHTC-dashboard.html) migrate to read it, or leave them on the per-source files?
- `data/chfa-lihtc.json` is duplicated at `data/affordable-housing/lihtc/chfa-properties.json`. Should one of them be deleted?

### 2. Code quality / fragility

- Look for places where data shape changes (e.g., the CHFA schema migration in `scripts/fetch-chfa-lihtc.js`) could silently break downstream consumers
- Search for `// TODO`, `// FIXME`, `// HACK` — anything actionable?
- `js/lihtc-opportunity-finder.js` builds large HTML strings via concatenation (no template engine, no React). Worth a security review pass for XSS — every dynamic string should go through `escHtml()`. Find any that don't.
- IIFE pattern means all of OF's internals are inaccessible to tests. Is this a problem?
- `parts[7]` / `parts[8]` indexing in `loadAll()` — index-by-position fetch results. Fragile when adding/removing sources.

### 3. Data pipeline

- 5 fetch scripts hit live ArcGIS services without backoff, retry, or rate-limit handling. Should they?
- `scripts/audit/source-url-sweep.mjs` has an allow-list of bot-blocked URLs. Is that list reasonable or growing unboundedly?
- Multiple sources will have overlapping properties (a LIHTC property in CHFA also appears in CHFA Preservation also appears in HUD MF). Current `build-affordable-housing-properties.js` does NOT dedup — it just unions. Is that the right call? What's the impact on downstream consumers?
- `data/market/tract_centroids_co.json` has known-corrupted GEOID→coord mapping (documented). OF now ignores it. But what other site pages still depend on it? Worth a grep.

### 4. CI / deploy

- `.github/workflows/deploy.yml` had a 2026-05-26 outage we worked around by pinning `actions/configure-pages` from `@v6` to `@v5`. Worth a long-form note in the workflow comment so future ops knows.
- 50+ GitHub Actions workflows — any obviously broken / orphaned ones?
- `scripts/fetch-chfa-lihtc.js` runs in `deploy.yml` with `continue-on-error: true` — a fetch failure silently leaves the cache stale. Is that the right error policy?
- `data/affordable-housing/properties.json` is committed to the repo (1.5 MB). Should the build script be wired into CI so a stale source doesn't drift?

### 5. Performance

- `data/affordable-housing/properties.json` is 1.5 MB. Loaded synchronously on OF + Compare. Worth splitting?
- 4 ArcGIS tile services in OF + multiple GeoJSON overlay polygons. First-paint cost?
- `js/lihtc-opportunity-finder.js` is loaded with `defer` — but Leaflet, OF JS, and 10 data files all need to resolve before the page renders meaningfully
- Mobile viewport (688px wide tested) — the methodology section's weight table overflows; the layer control on the map can clip

### 6. Accessibility

- `lihtc-opportunity-finder.html` has 1,000+ lines of inline HTML. ARIA labels present on most controls but spot-check the table headers (we removed `aria-sort` initial state in a previous patch — does that need to come back?)
- `js/components/next-action-cta.js` uses `<aside role="navigation">` — correct or should be `<nav>`?
- Dynamically-rendered detail panel — does keyboard focus follow the click? Screen reader support?
- High contrast / dark mode toggle works site-wide; verify our new pages (compare.html, OF additions) respect it

### 7. Security

- `js/lihtc-opportunity-finder.js` `_renderTable()` constructs `tbody.innerHTML` from data fields. `escHtml()` is called on user-facing names but check every interpolation. Could a malicious city name in a data file inject script?
- Same audit for `js/compare.js`
- Same for `js/lihtc-opportunity-finder.js`'s civic + news + HNA-CTA renderers
- `_buildHref` in `next-action-cta.js` uses `encodeURIComponent` — good. But is the rendered `<a href="...">` safe if the FIPS is something crafted?
- No secrets in repo (we checked via gitleaks pre-deploy)? `js/config.js` is generated from CI secrets at deploy time — verify that pattern is sound

### 8. Documentation

- `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md` — does the v1.1 doc match what the code actually does? Specifically: §4 weight table should match `SCORE_WEIGHTS` in both `lihtc-opportunity-finder.js` AND `compare.js` AND `verify-opportunity-finder.mjs`. (We believe yes — please confirm.)
- `docs/audits/REPO-AUDIT-2026-05-25.md` — the strategic direction lock + P0 list. Anything stale now that we've shipped Phase A–D?
- `HANDOVER.md` — is the recent-PR summary still accurate?
- `docs/audits/CODEX-HANDOFF-OPPORTUNITY-FINDER.md` — the previous PR #894 handoff. Now superseded by this doc; should it be marked archived?

### 9. The product (most important)

Pretend you're a Colorado affordable-housing developer. Open the site at <https://pggllc.github.io/Housing-Analytics> in a private browser window. Does the workflow actually deliver?

**The promise**: "Where in CO should I spend scarce time looking for the next LIHTC deal?"

Try the journey:
1. Land on `index.html` → does the workflow direct you to the Opportunity Finder?
2. Land on Opportunity Finder → pick a target deal type → does the result list make sense?
3. Click a jurisdiction → does the detail panel give you actionable next steps?
4. Click "→ HNA" or "⚖️ Compare with peers" — does the chain work?
5. Open Compare with 4 jurisdictions — can you read the table on mobile?
6. Try Preservation target — does the urgent-≤5y pill actually surface real urgent properties?

**Where does the product fall short?** Be honest. Things like:
- "The methodology section is too long; nobody will read it"
- "The map shows markers but doesn't help me decide between them"
- "The recency dimension penalizes places with recent awards even when those are good signals"
- "I'd want to see X data point that isn't here"

Anything you'd surface to the user as "this is what you should do next."

---

## Specific scoring-consistency check (must verify)

OF and Compare both implement the 5-dim composite. We verified 24/24 scores match on 2026-05-26. Replicate:

```bash
# Browser open OF
open https://pggllc.github.io/Housing-Analytics/lihtc-opportunity-finder.html

# In DevTools console, run:
window.__lofState.opportunities.filter(o => ['Montezuma','Boulder','Aurora','Pueblo','Sugar City','Cortez'].includes(o.name))
  .map(o => ({ name: o.name, s9: o.score9, s4: o.score4, sPres: o.scorePreservation }))

# Then open Compare with same 6:
open "https://pggllc.github.io/Housing-Analytics/compare.html?jurisdictions=0851690,0874815,0817375,0807850,0804000,0862000&target=9pct"

# Each row's "9% Competitive" cell should match the OF's s9.
```

Expected (live as of 2026-05-26):

| | OF s9 | Compare s9 | OF s4 | Compare s4 | OF sPres | Compare sPres |
|---|---|---|---|---|---|---|
| Montezuma | 69 | **69** ✓ | 53 | **53** ✓ | 72 | **72** ✓ |
| Sugar City | 60 | **60** ✓ | 44 | **44** ✓ | 64 | **64** ✓ |
| Cortez | 35 | **35** ✓ | 47 | **47** ✓ | 44 | **44** ✓ |
| Boulder | 62 | **62** ✓ | 75 | **75** ✓ | 65 | **65** ✓ |
| Aurora | 57 | **57** ✓ | 69 | **69** ✓ | 58 | **58** ✓ |
| Pueblo | 53 | **53** ✓ | 65 | **65** ✓ | 56 | **56** ✓ |

If your numbers differ, the duplication has drifted — that's a bug.

---

## Known intentional gaps (NOT bugs)

1. PMA + Deal Calculator don't honor `?fips=` URL params yet — only HNA does. P1 follow-up.
2. `compare.js` duplicates OF scoring math (no shared module yet). P0-1 fixes.
3. Pure-state Prop 123 awards (no LIHTC pairing) not ingested — DOLA HTTP 403 blocks scrape. 166 state-paired deals captured via CHFA `TypeOfCredits`.
4. NHPD full refresh not done — auth-required. CHFA Preservation + HUD MF + USDA RD substantially cover the same space.
5. No site-level data (parcel/utility/zoning) — explicitly out of scope per audit Appendix A.
6. `tract_centroids_co.json` corruption — documented; OF bypasses via county centroids. Other pages may still depend on it. Worth a grep + decision.
7. Civic-readiness coverage is sparse — many CDPs return null. Falls back to county-level inheritance.
8. `data/market/hud_lihtc_co.geojson` (the legacy HUD snapshot) is now a tier-2 fallback site-wide after F6/F7. Still committed to the repo for offline-resilience. Open question whether to delete it entirely or keep as fallback — C1 in the post-handoff list above.

---

## What we want back

A structured report covering each of the 9 deep-dive areas above. Length: whatever's appropriate (we'd expect 1,500–3,000 words). For each finding:

- **Severity** (P0 blocking / P1 should-fix / P2 nice-to-have / P3 won't-fix-tracked)
- **What** — specific file + line + observation
- **Why** — what could break or what's the developer impact
- **Suggested fix** — concrete, actionable
- **Confidence** — how sure are you this is real

End with:

1. **The one thing we should change next** (your independent recommendation, not constrained by the open audit P0 list)
2. **What you would NOT change** (things you considered but decided are fine as-is)
3. **What concerns you most about the codebase** as a whole

File real bugs as GitHub issues with label `Codex full-repo 2026-05-26`. Pithy summary back here.

---

## Out of scope for this review

- Re-architecting the entire HNA page (separate domain, separate audit)
- Designing new ML/AI features
- Comparing this site to commercial competitors
- Editing data files manually (use the fetch scripts)
- Bumping major dependency versions (we're on Node 24, Leaflet, Chart.js — those are stable)

---

## Recommended reading order

1. **This doc** (you're here)
2. `docs/audits/REPO-AUDIT-2026-05-25.md` — strategic direction + P0 list
3. `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md` — methodology contract
4. `HANDOVER.md` — broader context from the May 2026 session
5. `lihtc-opportunity-finder.html` + `js/lihtc-opportunity-finder.js`
6. `compare.html` + `js/compare.js`
7. `js/components/next-action-cta.js`
8. `scripts/build-affordable-housing-properties.js`
9. `scripts/audit/verify-opportunity-finder.mjs`
10. `.github/workflows/deploy.yml`

Then start grepping.

---

## Tone

Be honest, opinionated, and specific. We've been heads-down shipping for a month and have lost objectivity. **Tell us what's actually wrong, even if it's uncomfortable.** Don't soften.

If you find something genuinely concerning (data integrity, security, scoring bug), don't bury it — lead with it.

Good luck.
