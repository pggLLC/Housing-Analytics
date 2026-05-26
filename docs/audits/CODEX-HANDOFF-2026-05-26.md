# Codex QA/QC Handoff — 2026-05-26 (post-Phase-D)

**For**: Codex (or fresh human reviewer)
**Last checkpoint**: PR #894 was reviewed + merged 2026-05-26 at commit `98fd3c3b`. This handoff covers ~25 commits of subsequent work landed directly to `main`.

---

## What you're verifying

The Colorado Housing Analytics LIHTC Opportunity Finder + the broader affordable-housing data layer have been substantially extended since your last review. This document covers what's new + what needs QA/QC.

## What changed since PR #894

### Data layer (massive expansion)

1. **Switched LIHTC source to CHFA live service** — `scripts/fetch-chfa-lihtc.js` now hits `services3.arcgis.com/.../HousingTaxCreditProperties_view`. 926 features through **2025** (was 716 through 2020 from HUD LIHTCDB). Schema-aware field mapping in the fetch script preserves HUD-compat aliases for site-wide consumer compatibility.

2. **New unified affordable-housing data architecture** under `data/affordable-housing/`:
   ```
   data/affordable-housing/
   ├── lihtc/chfa-properties.json              ← 926 (mirror of data/chfa-lihtc.json)
   ├── preservation/
   │   ├── chfa-preservation.json               ← 1,688 (CHFA Preservation layer)
   │   ├── hud-multifamily-assisted.json        ← 343 (HUD MF with subsidy detail)
   │   └── usda-rural-housing.json              ← 116 (USDA RD with expiration dates)
   ├── locally-funded/                          ← placeholder
   └── properties.json                          ← 3,073 unified w/ program_type discriminator
   ```

3. **Three new fetch scripts:**
   - `scripts/fetch-chfa-preservation.js`
   - `scripts/fetch-hud-multifamily.js`
   - `scripts/fetch-usda-rural-housing.js`
   - `scripts/build-affordable-housing-properties.js` (combines them)

### Scoring (significant change)

4. **Migrated OF composite from 4-dim to full 5-dim** per methodology §4. Civic readiness now rolled into the composite at weights 10–30% depending on target.

5. **Six target deal types** (was three):
   - 9% Competitive · 4% Bond · **Preservation** · **Workforce/Resort** · **Prop 123 / Local** · Balanced

6. **Smart filter wiring**: selecting Preservation or Prop123 auto-relaxes the basis filter to 'none' (those deals don't need federal basis-boost).

### UI / UX

7. **Compact filter sidebar** with native checkboxes (was bulky button pills with broken layout — fixed CSS specificity bug where `.lof-filter label` was overriding `.lof-check`).

8. **Methodology section** always-visible on the page with weight table + plain-English deal-type explanations + "How to read this table" callout + tooltips on every column/row header.

9. **Cross-page funnel** — `js/components/next-action-cta.js` auto-mounted on HNA, OF, PMA, Deal Calculator. Sticky bottom strip with 3 buttons (the pages NOT being viewed). Carries jurisdiction context via `?fips=&geoType=` URL params.

10. **Compare page** — `compare.html` + `js/compare.js`. Side-by-side comparison of 2–6 jurisdictions across 20 dimension rows. URL-driven `?jurisdictions=…&target=…`.

11. **Map fixes**: tract centroids replaced with county centroids (the tract_centroids file had scrambled GEOID→coord pairings — verified Aurora's tract was pointing to Alamosa). maxBounds set to CO + 50mi.

12. **Preservation filter** in OF sidebar: min preservation count slider + "only urgent (≤5y expiration)" toggle.

13. **Region filter** in OF sidebar: 6 CO regions (Front Range, Mountains, Western Slope, Southwest, San Luis Valley, Eastern Plains).

14. **Data-source banner** at top of OF (green confirmation banner explaining CHFA live source).

15. **Civic capacity** wired from `housing-policy-scorecard.json` + `local-resources.json` + `prop123_jurisdictions.json` (3-way join with prop123 county-fallback). 7-dim civic stack surfaced in detail panel.

16. **Per-jurisdiction housing news search** — 6 linkouts in detail panel (Google News, CO Sun, CPR, BizWest, county news, "find housing staff").

17. **HNA deep-links** — every OF row has "→ HNA" pill. HNA page extended to accept `?fips=7-digit&geoType=place&auto=1` for place-level auto-select (was county-only before).

### Verification harness (updated)

18. `scripts/audit/verify-opportunity-finder.mjs` updated for 5-dim composite, new score variants, 6 deal types. **Now 36 checks** (was 28). All passing.

---

## Files to read, in order

1. **`docs/audits/REPO-AUDIT-2026-05-25.md`** — original strategic-direction lock + P0/P1/P2 roadmap (jurisdiction-level)
2. **`docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`** — canonical methodology (5-dim composite + 6 deal types now documented as current state, not "future")
3. **`lihtc-opportunity-finder.html`** + **`js/lihtc-opportunity-finder.js`** — primary UI surface (~1300 lines)
4. **`compare.html`** + **`js/compare.js`** — NEW comparison surface
5. **`js/components/next-action-cta.js`** — NEW cross-page funnel
6. **`scripts/build-affordable-housing-properties.js`** — unified-data build script (read to understand source dedup behavior)
7. **`scripts/audit/verify-opportunity-finder.mjs`** — 36-check verification harness

---

## Specific QA/QC asks

### 1. Scoring consistency (most important)

The OF page (`js/lihtc-opportunity-finder.js`) and the Compare page (`js/compare.js`) both implement the 5-dim composite. **They MUST produce identical scores** for the same jurisdiction at the same target.

Verify by spot-checking:
- Load <https://pggllc.github.io/Housing-Analytics/lihtc-opportunity-finder.html>, find Montezuma → score 69 (9%)
- Load <https://pggllc.github.io/Housing-Analytics/compare.html?jurisdictions=0851690&target=9pct> → Montezuma row should show score 69

If they diverge, that's a bug. The audit's P0-1 (`js/scoring/shape.js` extraction) is the proper fix for this duplication risk.

### 2. CHFA data freshness

Run `node scripts/fetch-chfa-lihtc.js` — should produce 926 features with latest YR_PIS = 2025. Verify Rifle has 4 projects:
- 2023 Rifle Apartments (60u, 9% Competitive)
- 2019 Maxfield Heights (50u, 9% Competitive)
- 2002 White River Village (29u)
- 1998 Eagles Nest Rifle (30u)

### 3. Verification harness invariants

```bash
npm run audit:opportunity-finder
# expect: 36/36 PASSING
```

Categories:
1. Data integrity (7 checks)
2. Rollup invariants (6 checks — 482 places, 158 basis-eligible, 6 both, 92/60/105)
3. Score weight invariants (6 checks — each target sums to 1.0 in 5-dim)
4. Score range invariants (6 checks — all 6 target scores in [0,100])
5. Civic-score range (1 check)
6. Place→county containment (1 check)
7. Default-filter results (1 check — 5 specific named jurisdictions)
8. Known-case spot checks (6 checks — Sugar City, Crowley, Olney Springs, Ordway, Montezuma, Cortez)
9. Civic-capacity joins (2 checks — 100% coverage)

### 4. Compare-page peer-pre-population

From the OF, clicking "⚖️ Compare with peers" on Montezuma should open `compare.html?jurisdictions=0851690,X,Y,Z` where X,Y,Z are the top 3 OTHER jurisdictions in the Mountains region. Verify the URL produces a sensible comparison (not the same jurisdiction 4 times).

### 5. Cross-page funnel deep-links

Click "📋 View HNA" from an OF row → HNA page auto-selects that place. Then on HNA page, click "→ Market Analysis" in the bottom strip → URL carries `?fips=…&geoType=…&auto=1`. The PMA page doesn't auto-select yet (P1 follow-up), but the link should still navigate cleanly.

### 6. Preservation data correctness

Spot-check that the unified preservation count for Rifle = (CHFA Preservation count for Rifle) + (HUD MF count for Rifle) + (USDA RD count for Rifle).

Use the browser console:
```js
window.__lofState.preservationByCity['RIFLE']
// should show { total: 6, sec8: 0, hud202_811: ?, fha: ?, usdaRd: ?, other: ?, urgent5y: ?, expiringSoon10y: ? }
```

### 7. Map markers

Should render at:
- Tract centroids (preferred — from `place-tract-membership.json` tract→county join)
- County centroids (fallback — from `co-county-boundaries.json` polygon centroids)
- LIHTC project lat/lng (third fallback)

NOT from `data/market/tract_centroids_co.json` — that file has scrambled GEOID→coord pairings (verified during this session; documented in `docs/audits/REPO-AUDIT-2026-05-25.md` Appendix A.2).

---

## Known intentional gaps (NOT bugs)

1. **PMA and Deal Calculator don't yet honor `?fips=` auto-select** — only HNA does. P1 follow-up to extend their query-string handling.

2. **`compare.js` duplicates scoring math** from `lihtc-opportunity-finder.js` because the OF is an IIFE without a clean export surface. P0-1 (extract `js/scoring/`) fixes this; until then, both files must stay in sync. The 36-check harness catches OF drift; Compare drift requires manual spot-checking.

3. **Pure-state Prop 123 awards** (no LIHTC pairing) not ingested — DOLA's awards page returns HTTP 403 to bots. Workaround: `chfa-lihtc.json` already includes Prop 123-paired deals via `TypeOfCredits='X% and State'` (166 records, 27 in 2025).

4. **NHPD refresh** — full ~700-property CO subset of NHPD requires API auth. We currently have a 20-property sample. The 1,688-property CHFA Preservation + 343 HUD MF + 116 USDA RD substantially overlap with NHPD coverage; refresh remains backlog.

5. **No site-level data** (parcel/utility/zoning) — explicit out-of-scope per audit Appendix A. Site-level work would be a separate product surface.

6. **`tract_centroids_co.json` corruption** — known data quality issue documented in repo audit Appendix A.2. OF now bypasses it; other pages (e.g., `colorado-deep-dive.html`) may still use it. Fix is to re-run `scripts/market/build_public_market_data.py`.

---

## Quick-start verification commands

```bash
# Sync to current main
git pull origin main

# Run the harness (36 checks, ~3 seconds, no network)
npm run audit:opportunity-finder
npm run audit:opportunity-finder:json   # machine-readable variant

# Refresh data from live sources (~30 seconds each, network required)
node scripts/fetch-chfa-lihtc.js
node scripts/fetch-chfa-preservation.js
node scripts/fetch-hud-multifamily.js
node scripts/fetch-usda-rural-housing.js
node scripts/build-affordable-housing-properties.js

# Broader regression test
npm run test:qa-recent

# Smoke-check the live site
open https://pggllc.github.io/Housing-Analytics/lihtc-opportunity-finder.html
open https://pggllc.github.io/Housing-Analytics/compare.html?jurisdictions=0851690,0874815,0818750&target=preservation
```

---

## Highest-leverage next changes (audit P0s still open)

1. **Extract `js/scoring/shape.js` + `js/scoring/` module** (P0-1) — fixes the OF↔Compare duplication AND prevents future drift across the 8 scoring surfaces. 1-day patch. Best Codex-friendly task.

2. **Extend PMA + Deal Calculator to honor `?fips=` URL params** (completes cross-page funnel — P0-4 remainder). 1-day patch.

3. **Confidence pills** on every score (P0-5). `js/utils/source-confidence-badges.js`. 1-day patch.

These three would close the audit's P0 list. Sprint-2 work then becomes preservation-deal-type expansion, export-memo module, and the NHPD/DOLA backlog.

---

## Expected output from your QA/QC

A structured report (~500-800 words) with:

1. **Scoring consistency check** — pass/fail for OF↔Compare for 3 jurisdictions
2. **Harness pass count** — `36/36` expected
3. **Data freshness verification** — CHFA latest YR_PIS, Rifle's 4 projects
4. **Map marker spot-check** — Aurora at ~(39.8, -104.8), Montezuma at ~(39.6, -106.1)
5. **Cross-page funnel** — click-through verification across all 4 pages
6. **Compare-page** — URL deep-link works, peer-pre-population correct
7. **Drift findings** — anywhere code disagrees with `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`
8. **Recommendations** — pick from the "highest-leverage next changes" above or propose alternatives

If you find regressions, file as GitHub issues with reproduction steps + `Codex QA/QC 2026-05-26` label.

---

Good luck. The product is substantially more mature than at the PR #894 review. Most of what remains is consolidation (scoring shape) and finishing the cross-page funnel.
