# CODEX AUDIT - 2026-06-10

Independent audit of `pggLLC/Housing-Analytics` at `main` (`9535049d`, 2026-06-10). Scope followed `docs/audit/CODEX-AUDIT-2026-06-10-RESPONSE.md` as a starting frame and independently checked rendered HTML voice, LIHTC scoring, AHCIA/CRA/pricing claims, PMA tract-picker plumbing, tract data hygiene, place-vs-county masking, and CHFA QAP non-metro alignment.

## Executive Summary

The most important finding is that the CRA article is now materially wrong as public guidance. `cra-expansion-analysis.html` says the 2023 CRA final rule is live for most examined institutions as of January 1, 2026, but the OCC's current CRA page states that the OCC continues to assess banks under the 1995/2021 framework. That page needs immediate correction or a regulator-specific caveat before it is treated as a current public-data reference.

The second load-bearing issue is the new PMA tract picker. The picker depends on `data/market/tract_centroids_co.json`, but that file contains 1,605 centroid records against 1,447 TIGER 2020 boundary features and has valid El Paso/Teller/Weld GEOIDs paired with Garfield/Weld-area centroids. The Opportunity Finder code already avoids this same centroid file for marker placement because it is "scrambled"; the tract picker now reintroduces it as the selection engine. Downstream, tract mode records selected GEOIDs but does not appear to replace the existing buffer-based ACS/DOLA aggregation path that populates the PMA site summary.

Voice cleanup is also incomplete. Rendered HTML still contains public-facing `COHO Analytics`, first-person `our/we`, "awards points", "target", and "your jurisdiction" framing, including on the Opportunity Finder, generated place profiles, About/Privacy pages, and pricing article. The AHCIA enactment claim is broadly verified by H.R. 1, but it should add statutory effective-date and bond-issue caveats. The Q2 2026 Novogradac pricing band could not be independently verified from accessible public sources because the citation is too vague.

## Findings

### 1. CRA final-rule applicability is stated as current law, but OCC says it is still using the 1995/2021 framework

- **Severity:** P1
- **Files:** `cra-expansion-analysis.html:43-45`
- **Current text/code:**
  - `2026 Update - Final Rule Is Now in Effect`
  - `The federal banking agencies' 2023 CRA modernization rule reached its January 1, 2026 applicability date for most provisions... now live for examined institutions.`
  - `Source: Federal Reserve, OCC, and FDIC CRA final rule... applicability date confirmed in agency 2025 implementation FAQs.`
- **What's wrong:** This is not supportable as written. The OCC's current CRA page says the OCC "continues to assess banks' CRA performance under the 1995/2021 regulatory framework." That directly contradicts the article's broad "now live for examined institutions" framing. I did not find an accessible source confirming the article's claimed 2025 implementation FAQ position.
- **Suggested fix:** Replace the callout with a regulator-specific status note. For OCC-supervised banks, state that the OCC continues under the 1995/2021 framework. If Federal Reserve or FDIC status differs, cite exact agency pages and split the analysis by regulator. Reframe the modeled scenarios as hypothetical/pending unless all three agencies' current applicability positions are cited.
- **Source checked:** OCC CRA page, line 192: https://www.occ.treas.gov/topics/consumers-and-communities/cra/index-cra.html

### 2. PMA tract picker relies on a known-scrambled centroid file, causing wrong tract selection risk

- **Severity:** P1
- **Files:** `data/market/tract_centroids_co.json:1`, `js/pma-tract-picker.js:80-98`, `js/pma-tract-picker.js:171-196`, `js/lihtc-opportunity-finder.js:1367-1375`, `scripts/market/build_public_market_data.py:255-298`, `scripts/market/build_tract_bboxes.py:158-183`
- **Current text/code:**
  - `pma-tract-picker.js` normalizes centroid rows by GEOID and only checks that lat/lon are numbers.
  - It filters/selects nearby tracts by `_haversineMi(lat, lon, c.lat, c.lon)`.
  - Opportunity Finder explicitly says it does not use `data/market/tract_centroids_co.json` because its GEOID-to-lat/lng pairings are scrambled.
  - Local data check: `tract_centroids_co.json` has 1,605 records; `tract_boundaries_co.geojson` has 1,447 features; 158 centroid records have no matching boundary.
  - Sample bad rows: `08041000103`, `08041000104`, and other `08041...` GEOIDs have `county_fips: "08041"` but `county_name: "Garfield"` and Garfield-area lat/lon, while their TIGER 2020 bboxes are in El Paso County around Colorado Springs.
- **What's wrong:** TIGER 2020 confirms the GEOID stem is valid for El Paso County (`08041`); the centroid/county-name metadata is wrong for the GEOID. The PMA picker uses the bad centroid as the proximity selector, then renders the boundary for the matching GEOID. In Western Slope workflows this can preselect El Paso polygons because their corrupted centroids appear near Garfield County.
- **Suggested fix:** Regenerate `tract_centroids_co.json` from the exact same TIGER 2020 boundary features used by `tract_boundaries_co.geojson`. Add a validation gate: centroid must fall inside or near its own bbox, `county_fips` must equal `GEOID.slice(0,5)`, and centroid/boundary counts must match for picker-eligible tracts. Do not allow ACS GEOID expansion or county-centroid fallback rows into the tract-picker file.

### 3. PMA tract mode records selected tracts but does not drive the downstream ACS/DOLA aggregation

- **Severity:** P1
- **Files:** `js/pma-ui-controller.js:663-674`, `js/pma-analysis-runner.js:138-151`, `js/pma-analysis-runner.js:466-471`, `js/market-analysis.js:2108-2155`, `js/market-analysis.js:2195-2235`, `js/market-analysis.js:3218-3242`, `market-analysis.html:591-604`
- **Current text/code:**
  - UI passes `runOptions.tractGeoids` and `runOptions.tractBoundary`.
  - Runner stores `results.commuting.tractGeoids` and later `pmaSupportSummary.tractGeoids`.
  - The legacy PMA path still calls `computePma(..., bufTracts, ...)`, aggregates DOLA counties from `bufTracts`, and renders housing units/renter households from `result.acs`.
  - UI controller comment says non-buffer modes run "in parallel with the existing ACS scoring (which the original click handler still fires)."
- **What's wrong:** I do not see selected tract GEOIDs being used to replace `bufTracts` for ACS population/housing aggregation. The selected tract set appears to be justification metadata and a boundary overlay, not the source of the PMA Total Population/Housing Units path. This means tract mode can look tract-specific while still displaying buffer-derived ACS/DOLA aggregates.
- **Suggested fix:** In tract mode, build the PMA tract list from `tractGeoids`, aggregate ACS/LODES/DOLA from that list, and label the site summary as selected-tract aggregation. Suppress the original buffer handler or explicitly reconcile its output with the tract-mode run.
- **Local verification note:** This was traced in code. A browser run should confirm whether clicking "Run Analysis" in tract mode still updates the visible summary with buffer-derived numbers.

### 4. PMA tract mode allows fewer than three selected tracts to run with a null boundary

- **Severity:** P2
- **Files:** `js/pma-tract-picker.js:244-259`, `js/pma-ui-controller.js:663-674`, `js/pma-analysis-runner.js:138-151`
- **Current text/code:**
  - `getBoundary()` returns `null` when `_selected.size < 3`.
  - UI only blocks `picked.length === 0`.
  - Runner accepts `tractBoundary || null` and continues.
- **What's wrong:** With one or two selected tracts, analysis proceeds without a tract boundary. That undermines the claimed whole-tract PMA mode and can silently fall back to null/overlay-less behavior.
- **Suggested fix:** Block tract-mode runs until at least three tracts are selected, or support one/two-tract boundaries by using the tract polygons themselves instead of a centroid convex hull.

### 5. PMA tract boundary is a centroid convex hull, not a union of selected tract polygons

- **Severity:** P2
- **Files:** `js/pma-tract-picker.js:244-287`
- **Current text/code:** Comment says "union of selected tracts" but immediately clarifies it is a "convex hull of their centroids."
- **What's wrong:** A centroid hull is not a tract union and can include large areas outside the selected tracts, especially in rural areas. If this is used for any scoring, map overlay, or export, it misrepresents the PMA.
- **Suggested fix:** Use selected tract polygon geometries as a `FeatureCollection` or dissolve them with a geometry library. If hull remains a temporary visualization, rename the UI/methodology text to "centroid hull preview" and keep it out of calculations.

### 6. Tract picker can be invoked before a site is placed, and "Clear all" does not actually clear all

- **Severity:** P2
- **Files:** `js/pma-ui-controller.js:755-766`, `js/pma-ui-controller.js:780-799`, `js/pma-ui-controller.js:840-859`
- **Current text/code:**
  - Entering tract tab initializes only if `_getLastCoords()` returns coordinates.
  - Run button returns silently if no lat/lon.
  - Clear-all calls `picker.init(...)`, which preselects tracts again, then updates the summary with `picker.getSelectedGeoids()`.
- **What's wrong:** If a user opens tract mode before placing a site, the picker appears not to initialize and the run can return with no tract-specific message. Clear-all reseeds the auto-selection instead of clearing it.
- **Suggested fix:** Disable tract mode/run until a site is placed, show a visible "place a site first" message, and add a real `PMATractPicker.clearSelection()` path that empties `_selected` without reinitializing.
- **Local verification note:** The exact user-visible behavior should be checked in the browser; the code path indicates silent/no-op behavior.

### 7. Glenwood Springs is mapped to Pitkin County in core geography data

- **Severity:** P1
- **Files:** `data/hna/geo-config.json:140-145`, `data/hna/geo-config.json:973-978`, `data/hna/ranking-index.json:10960-10965`, `places/0830780.html:8-11`
- **Current text/code:**
  - `Glenwood Springs (city)` appears twice in `geo-config.json`, including `0830780`, both with `containingCounty: "08097"`.
  - `ranking-index.json` carries `0830780` as `containingCounty: "08097"`.
  - Generated place profile says "Glenwood Springs, Pitkin County, Colorado."
- **What's wrong:** Glenwood Springs is in Garfield County for this use case. The wrong containing county affects county labels, county fallback paths, CHFA regional/recency context, generated profile metadata, and any county-level data inherited by the place.
- **Suggested fix:** Correct Glenwood Springs to Garfield County (`08045`), remove the duplicate/stale GEOID if `0830475` is not current, and regenerate dependent ranking/profile artifacts. Add a validation check that place-to-county assignments match Census place/county membership or the dominant intersecting county.

### 8. 4% LIHTC weight rebalance is applied, but the UI explanation is stale

- **Severity:** P2
- **Files:** `js/lihtc-opportunity-finder.js:297-307`, `js/lihtc-opportunity-finder.js:1821-1831`
- **Current text/code:**
  - Runtime weights are correct: `4pct: { need: 0.30, recency: 0.17, basis: 0.15, pop: 0.20, civic: 0.18 }`.
  - UI explanation still says: `Population dominates because you need 100-200 units leased fast for the bond to pencil.`
- **What's wrong:** Population no longer dominates; need is the largest 4% weight and civic readiness nearly equals population. The help text contradicts the implemented scoring model.
- **Ranking sanity check:** Using the current formula for the requested Western Slope jurisdictions produced: Glenwood Springs 75; Rifle 71; Carbondale 71; New Castle 71; Silt 67; Eagle 66; Gypsum 62. That ranking is broadly sane under the new weights. Silt is lower because of scale; Eagle/Gypsum are lower due to recent regional competitive activity. The surprising part is Glenwood's wrong Pitkin county assignment, not the weight blend.
- **Suggested fix:** Update the 4% explanation to say need, population/absorption, civic readiness, basis boost, and regional recency are balanced for 4% + state-credit feasibility.

### 9. Opportunity Finder still contains first-person, private-outreach, and "awards points" framing

- **Severity:** P1
- **Files:** `lihtc-opportunity-finder.html:1520`, `lihtc-opportunity-finder.html:1905-1910`, `lihtc-opportunity-finder.html:1929`, `lihtc-opportunity-finder.html:2102-2108`, `lihtc-opportunity-finder.html:2324-2333`, `lihtc-opportunity-finder.html:2407-2414`, `js/lihtc-opportunity-finder.js:1753`
- **Current text/code:**
  - `our 8-step public methodology`
  - `a planning aid for our own outreach calendar`
  - `CHFA QAP awards points`
  - `our internal read`
  - `our own partnership-readiness lens`
  - `What this means for our next step`
  - `9% target`, `4% target`
- **What's wrong:** This page is still written as a private developer/outreach workflow in several high-visibility sections. It conflicts with the requested third-person public-data-reference voice and the instruction to avoid target/deal/outreach framing.
- **Suggested fix:** Replace first-person and outreach language with neutral public-reference language. Example: "The watchlist is a public-records planning signal; it does not predict CHFA scoring or application intent." Replace "awards points" with "is referenced in QAP scoring criteria" only where verified, and replace "target" with "credit type" or "program lens."

### 10. COHO branding remains in rendered public HTML and generated place profiles

- **Severity:** P2
- **Files:** `about.html:8-11`, `about.html:41`, `privacy-policy.html:8-11`, `places/0830780.html:8-11`, plus other rendered pages found by grep (`data-status.html`, `market-analysis.html`, `housing-needs-assessment.html`, `dashboard.html`, `compare.html`, and generated `places/*.html`)
- **Current text/code:**
  - `About | COHO Analytics`
  - `About COHO Analytics`
  - `Privacy Policy | COHO Analytics`
  - `Glenwood Springs - COHO Place Profile`
  - `Glenwood Springs Housing Profile - COHO Analytics`
- **What's wrong:** The response document says COHO branding was removed from public-facing copy, but rendered HTML still exposes it in titles, metadata, body copy, and generated place pages.
- **Suggested fix:** Fix shared templates and the place-profile generator, then regenerate the static `places/*.html` pages. Run the grep sweep after generation, not only source-template edits.

### 11. Other public voice issues remain in the home page and pricing article

- **Severity:** P2
- **Files:** `index.html:213-218`, `article-pricing.html:154-158`
- **Current text/code:**
  - `recommended AMI distribution for your jurisdiction`
  - `We will continue monitoring pricing trends... visit our dashboard`
- **What's wrong:** "your jurisdiction" reads like a consultant workflow rather than a neutral reference. The pricing conclusion uses first-person "we/our."
- **Suggested fix:** Use third-person neutral copy, e.g. "a recommended AMI distribution for the selected jurisdiction" and "The dashboard is refreshed on quarterly data releases."

### 12. AHCIA enactment claim is broadly verified, but the article omits effective-date and bond-issue caveats

- **Severity:** P2
- **Files:** `lihtc-enhancement-ahcia.html:32-38`, `lihtc-enhancement-ahcia.html:70-75`, `lihtc-enhancement-ahcia.html:154-157`
- **Current text/code:**
  - `permanent 12% increase... enacted into law`
  - `permanent reduction in the 4% bond financing threshold from 50% to 25%`
  - `effective beginning 2026`
- **What's wrong:** H.R. 1 confirms the two major provisions were enacted, but the article's shorthand is too broad. The 12% ceiling increase applies to calendar years beginning after December 31, 2025. The 25% bond threshold applies to buildings placed in service in taxable years beginning after December 31, 2025, and the 25% path requires post-2025 bond issue timing plus at least 5% aggregate basis financed by those qualifying obligations.
- **Suggested fix:** Keep the enacted status, but add those caveats in the summary bullets and threshold section.
- **Source checked:** H.R. 1/P.L. 119-21 section 70422 on Congress.gov, lines 2145-2150: https://www.congress.gov/bill/119th-congress/house-bill/1/text

### 13. Q2 2026 LIHTC pricing band is not independently verifiable from the current citation

- **Severity:** P2
- **Files:** `article-pricing.html:55-67`, `article-pricing.html:70-72`
- **Current text/code:**
  - `Q2 2026 Update - Pricing Range Widens`
  - `$0.70-$0.95`
  - `mid-tier transactions clustering near $0.84-$0.87`
  - `Source: Novogradac quarterly pricing notes; mid-2026 syndicator roundtables`
- **What's wrong:** I could not independently verify this band against an accessible Novogradac quarterly pricing source. The linked Novogradac URL is generic, and searches for the exact Q2 2026 figures did not return a public source. The article also says the figures are Q1 2026 snapshots while immediately presenting a Q2 2026 update.
- **Suggested fix:** Cite the exact Novogradac note/report title and publication date, or mark the range as an unattributed market-survey estimate. If the support is a paid/private Novogradac source, say so and avoid implying public verification.
- **Verification note:** This finding is a citation-quality failure, not proof that the band is false.

### 14. HNA place/county fallback is now labeled for reviewed panels

- **Severity:** P3
- **Files:** `js/hna/hna-renderers.js:6650-6750`, `js/hna/hna-renderers.js:6944-7110`
- **Current text/code:**
  - Scorecard resolves places/CDPs to `state.contextCounty`, then renders `County proxy`.
  - CHAS affordability gap attempts `window.PlaceChas.lookup(selectedGeo.geoid)` first, then labels fallback as `Scaled from county data` and sets provenance `county-approx`.
- **What's wrong:** No defect found in these two reviewed HNA panels. The fallback is still county-level, but it is labeled to the user.
- **Suggested fix:** Keep this pattern and add automated browser assertions for a known place with place-level CHAS and one with county fallback.

### 15. Opportunity Finder compare CTA preserves place GEOIDs, but compare-page fallback still needs browser verification

- **Severity:** P3
- **Files:** `js/lihtc-opportunity-finder.js:3230-3279`
- **Current text/code:** Compare links are built from `[op.placeGeoid].concat(...)`, so the OF detail panel sends place GEOIDs rather than county FIPS.
- **What's wrong:** No OF-side defect found in the link construction. I did not run the compare page locally in this audit cycle, so I did not verify whether `compare.html` itself labels any county fallback inside its rendered compare panel.
- **Suggested fix:** Browser-test `compare.html?jurisdictions=0864255,0812045,0853395&target=4pct` and assert that each panel either uses place-level values or visibly labels county proxy values.

### 16. PMA site summary is buffer/tract-aggregate, not place-level; tract mode makes that labeling riskier

- **Severity:** P2
- **Files:** `market-analysis.html:591-604`, `js/market-analysis.js:3218-3242`
- **Current text/code:** The PMA site summary labels "Housing units in buffer" and "Rental households"; code renders from `result.acs.total_hh` and `result.acs.renter_hh`.
- **What's wrong:** This is not a place-vs-county fallback bug in the ordinary buffer mode; it is a PMA-boundary aggregate. But in tract mode, because selected tracts do not appear to replace the buffer aggregation path, the user can reasonably read the summary as selected-tract totals when the values are still buffer-derived.
- **Suggested fix:** In tract mode, label the summary "Selected tract households/renter households" only after selected-tract aggregation is implemented. Until then, add a visible note that the site summary remains circular-buffer ACS aggregation.

### 17. CHFA non-metro county priority list matches the current OMB metro set

- **Severity:** P3
- **Files:** `js/lihtc-opportunity-finder.js:314-345`
- **Current text/code:** `METRO_COUNTY_FIPS` includes Adams, Arapahoe, Boulder, Broomfield, Clear Creek, Denver, Douglas, Elbert, El Paso, Gilpin, Jefferson, Larimer, Mesa, Park, Pueblo, Teller, and Weld.
- **What's wrong:** No defect found. The five F254 additions are correct against OMB Bulletin 23-01: Clear Creek, Elbert, Gilpin, and Park are in the Denver-Aurora-Centennial MSA; Teller is in the Colorado Springs MSA. The full 17-county set also includes the single-county Boulder, Fort Collins-Loveland/Larimer, Grand Junction/Mesa, Greeley/Weld, and Pueblo MSAs.
- **Suggested fix:** No code change for the list. Consider adding a unit test that locks the 17 FIPS values and links to the QAP/OMB source in test comments.
- **Sources checked:** OMB Bulletin 23-01 lines 1488-1492 and 1619-1633: https://www.whitehouse.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf

## Grep Scope Notes

Voice grep command used:

```bash
rg -n "COHO|\\b(we|our|ours|us)\\b|deal cockpit|awards points|your jurisdiction" -g "*.html"
```

I ignored code comments when assessing severity, but user-facing HTML still has extensive hits. The report lists representative high-impact lines rather than every generated `places/*.html` hit because the generator/template fix is the correct remediation.

## External Sources

- OCC CRA status page: https://www.occ.treas.gov/topics/consumers-and-communities/cra/index-cra.html
- H.R. 1 text, section 70422, Congress.gov: https://www.congress.gov/bill/119th-congress/house-bill/1/text
- OMB Bulletin 23-01: https://www.whitehouse.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf
