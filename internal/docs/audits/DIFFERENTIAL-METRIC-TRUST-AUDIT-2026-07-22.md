# Differential Metric-Trust Audit — 2026-07-22

**Method:** grounded verification of a ChatGPT-drafted audit against current `main`, using GEOID-verified golden cases. Every claim below carries code/data evidence. Golden cases were confirmed real (ChatGPT's numbers are accurate once the correct GEOIDs are used):
- **Fruita = `0828745`**: ACS home value `$398,200` (`acs_raw_value` / summary cache) vs resolved ZHVI `$486,295` (cascade `value`, high confidence); ranking-index uses `$486,295`.
- **Ignacio = `0838535`**: ACS `$246,200` vs ZHVI `$473,487`; raw renter vacancy 3.2%, raw total 8.0%, adjusted 2.0%.

## 1. Already resolved — DO NOT TOUCH
- Visible source-link badges on charts incl. Household Income Distribution (`js/components/source-badge.js:108-147`, loaded `housing-needs-assessment.html:208`).
- Equal typography for the LEHD workplace-flow prose (`housing-needs-assessment.html:869`; `.chart-card p` uniform).
- Workflow-prerequisite messages name the missing step (`js/components/workflow-next-action.js:194-197`).
- Rental gap separated from ownership need and future total demand (SEM-1 #1282; sections at HNA :1141/:1603/:1654; guard in `test:ci`).
- Zero vs unavailable distinguished (`hna-renderers.js` stat cards use `X!==null ? fmt : '—'`).
- Place/county fallback shown beside the value (DataScope pill, `hna-renderers.js:3854`; home-value source label `:5695`).
- Legend/layer-control non-overlap (different corners across all 3 maps).
- Cumulative AND mutually-exclusive AMI tier views both present (`housing-needs-assessment.html:547-566`; `hna-renderers.js:6670`).
- Help for Homebuyers kept separate from the professional nav (`js/navigation.js` has no homebuyer entry).
- **`homeValueInfo()` canonical resolver already exists** (`hna-utils.js:355-395`) — the defect is *adoption*, not creation.

## 2. Confirmed defects (code evidence)

### Metric truth
- **D1 — HNA contradicts itself on home value.** `hna-section-takeaways.js:57` sets `medianHome = DP04_0089E` (raw $398,200) and displays "Median home value $398,200 (ACS 2020–2024)" (`:233`), while `hna-narratives.js:64` resolves via `homeValueInfo` ($486,295) and ranking/PMA show $486,295. Same page, two home values.
- **D2 — Affordability verdicts from a naive heuristic, not PITI.** `hna-section-takeaways.js:225,382` and `hna-narratives.js:415-421` compute `incomeNeeded = home × 0.20` vs MHI → "within reach"/"priced out". A proper PITI `affordabilityTest`/`maxAffordablePrice` already exists in `hna-ownership-need.js`. Result: Fruita income-needed is reported as **$79,640** (takeaways, off $398,200) vs **$97,259** (narratives, off $486,295) — contradictory verdicts.
- **D3 — Additional raw-ACS consumers.** `hna-comparison.js:787-788,873` displays $398,200 + feeds the price-to-income ratio (its AMI table `_calcPurchaseAmi` *is* proper PITI, so stale-value only); `housing-type-need.js:177` scores `missingMiddleOwnership` (0.35 weight) off the raw value; `census-geo.js:213` place path labels raw ACS "Median home value".
- **D4 — Vacancy mislabel.** `hna-comparison.js:374` labels the *adjusted* rate (2.0%) as "Rental Vacancy Rate" with no seasonal/adjustment disclosure — unlike ranking-index which discloses all three universes (`hna-ranking-index.js:316-340`). (The raw 3.2% / total 8.0% / adjusted 2.0% distinction is otherwise legitimate and disclosed — not a defect.)

### Provenance
- **D5 — FEMA Data Trust Center points to a nonexistent file.** `js/data-source-inventory.js:1148` declares `localFile: 'data/market/fema_flood_co.geojson'` — absent on disk. The displayed layer is `data/market/flood_zones_co.geojson` (`market-analysis.js:3654`). Trust Center path resolves to nothing.

### Map integrity
- **D6 — OZ legend entry missing.** OZ is a layer-control toggle (`lihtc-opportunity-finder.js:4777`) but the permanent legend (`:4892-4931`) has no OZ (teal) row — toggleable but unexplained.
- **D7 — No shared Leaflet pane order.** Only `affordable-housing-layer.js:245` assigns a pane; OF/market polygons + markers use the default `overlayPane` by insertion order, and `data-map-browser.html:1302-1319` `_toggleLayer` adds with no pane/bringToFront — so toggling Counties on last renders it over points. Z-order is toggle-order-dependent.
- **D8 — Generated metadata contradicts the build.** `scripts/build-affordable-housing-properties.js:532` writes the **deduped** array, but `meta.notes` in the same output (`:590`) says "keeps all records; consumers can dedupe." Direct contradiction.

### Homepage
- **D9 — "Colorado Housing Tax Credit Educational Guide"** eyebrow still present (`index.html:48`).
- **D10 — Unsourced hero claim.** `index.html:51-53` "short roughly a quarter-million homes" — no tenure/income-scope/period/formula/citation attached (only general site sources at `:54`).
- **D11 — No statewide household count** on the homepage snapshot (`index.html:381-420` has deficits/rates/LIHTC count but no total CO occupied-household stat with definition/year/source).

## 3. Codex implementation packages (≤4)

### Package A — Home-value truth + PITI affordability (flagship)
- **Files/functions:** `js/hna/hna-section-takeaways.js` ('Home value' :210-234, 'Homeownership affordability' :382), `js/hna/hna-narratives.js:415-421`, `js/components/housing-type-need.js:177/599`, `js/hna/hna-comparison.js:787` + `:374`, `js/census-geo.js:213`.
- **Behavior:** (a) every user-facing home-value display routes through `homeValueInfo()` (resolved value + source label), never raw `DP04_0089E`; where the raw ACS is intentionally shown (census-geo explorer), label it "ACS (may lag market)". (b) every affordability *verdict* uses the PITI `affordabilityTest`/`maxAffordablePrice` from `hna-ownership-need.js`, not `home×0.20` vs MHI. (c) `hna-comparison.js:374` labels the value it actually renders (adjusted) with the ranking-index disclosure.
- **Acceptance:** for Fruita `0828745` and Ignacio `0838535`, every displayed home value == cascade resolved value; the takeaways and narratives "income to buy" figures are identical for a given jurisdiction; affordability verdicts derive from PITI.
- **Tests (`test:metric-truth-crosssurface`, wired into test:ci):** golden-case fixtures assert (i) no user-facing surface shows the raw ACS value while others show ZHVI; (ii) takeaways income-needed === narratives income-needed for Fruita; (iii) affordability verdict path invokes `affordabilityTest` (sabotage: reverting a consumer to `DP04_0089E` or `×0.20` fails).

### Package B — Provenance repair (small)
- **Files:** `js/data-source-inventory.js:1148` → repoint FEMA `localFile` to `data/market/flood_zones_co.geojson` (verify against the layer `market-analysis.js:3654` actually loads). Optionally extend `scripts/audit/benchmark-freshness-check.mjs` to assert each registered file is referenced by ≥1 shipped page (consumer-wiring), not just parseable.
- **Acceptance:** the FEMA Trust Center path resolves to the displayed artifact; freshness check flags any registered-but-unconsumed file.
- **Tests:** assert every `localFile` in the inventory exists on disk (sabotage: a nonexistent path fails) — this alone would have caught D5.

### Package C — Map integrity
- **Files:** `js/lihtc-opportunity-finder.js:4892-4931` (add OZ legend row matching the teal `#0d9488` overlay); shared pane order helper applied in `lihtc-opportunity-finder.js`, `market-analysis.js`, `data-map-browser.html:1302` (create named panes: counties/polygons below lines/points below tooltips/popups; assign on add); `scripts/build-affordable-housing-properties.js:590` (correct the `meta.notes` to state records ARE deduped by name+city, and disclose the `__nokey__` blank-key limitation).
- **Acceptance:** OZ legend row renders when the layer is available; toggling any layer preserves the documented z-order regardless of toggle sequence; generated `meta.notes` matches the build's actual dedup behavior.
- **Tests:** legend contains an OZ entry; `properties.json` `meta.notes` asserts deduped (sabotage: the old "keeps all records" text fails). Pane-order is browser-verified in the site-audit rendered pass.

### Package D — Homepage claims (owner-gated copy)
- **Files:** `index.html:48` (remove the "Educational Guide" eyebrow), `:51-53` (source-or-remove the quarter-million claim), `:381-420` (add a statewide household-count card with definition/year/linked source), `:117-125` (add an affordable-ownership development route + developer/HA/CLT/nonprofit routing to the ownership workflow).
- **Acceptance:** no unsourced headline figures; statewide household count present with citation; Find Opportunity distinguishes LIHTC rental / preservation / ownership.
- **Tests:** homepage wording guard (sabotage: re-adding "Educational Guide" or an unsourced quarter-million string fails); statewide-household-count element present with a source link.

## 4. Decisions requiring owner judgment
- **D10 quarter-million claim:** provide the reproducible basis (tenure, income scope, period, formula, direct source) to keep it, or approve removal. Cannot be sourced from repo data alone.
- **Package D copy:** homepage is consumer-facing — owner reads all wording at merge (standing copy gate).
- **Scenario Builder overlay vs override (PARTIAL):** confirm the intended relationship — it is currently an additive DOLA-baseline overlay, not a project override. If override is intended, that's a separate change; if overlay is intended, mark it resolved.
- **Find Opportunity ownership routing (Package D):** depends on whether the (built) ownership decision-chain is meant to be a public homepage entry point yet.

## 5. Future-feature briefs (do NOT implement — separate initiatives)
- **a. Rock-Creek-style ownership project adapter** — a per-project ownership adapter consuming the OWN-1..5 decision chain for a specific development; needs a project-data schema + the chain as an embeddable module.
- **b. >3-acre land-listing watch** — a recurring watch for Colorado land listings above an acreage floor as development-opportunity signals; needs a listings source + acreage/geo filter (respect Maps ToS: no stored derived results).
- **c. Colorado legislation/appropriations watcher** — extend the tax-credit-legislation watchlist pattern to a recurring CO bill/appropriations feed surfaced as briefs (Tool Watch #1247 pattern; fetch-verify sources).
- **d. HNA RFP production mode** — a consultant-report export mode assembling the HNA into an RFP-deliverable format; large, gated on template requirements.
- **e. Local repo move out of iCloud** — operational: the ~/Documents/iCloud sync causes the " 2"/" 3" duplicate cruft; relocate the working copy off iCloud (owner machine change, not a repo PR).

## Recommendation
**Proceed** — Packages A–D, in that order. A is the flagship (real cross-surface trust defect, multi-consumer). B is a one-line bug + a guard that would have caught it. C is concrete map hygiene. D is owner-gated copy. This is a tight, verified subset of the ChatGPT audit — ~40% of its items were already resolved and its Package 2 collapsed to a single real bug.
