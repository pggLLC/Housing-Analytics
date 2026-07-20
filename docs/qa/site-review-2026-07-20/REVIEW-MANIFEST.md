# Page-by-Page Review Manifest — 2026-07-20 (Build Pause)

**Prepared by:** Claude QA · **Target:** production (https://cohoanalytics.com), deploy of 2026-07-20 06:52 UTC (post-#1266)
**Battery:** rendered smoke (10 core flows × 2 viewports) · console sweep (35 pages) · runtime contrast (54 pages × light+dark = 108 scans) · axe a11y (full page set) · repo link audit · chart-population audit — all run against the live site.
**Scope:** 53 top-level pages reviewed individually + 484 generated `places/*.html` reviewed as a class (freshness CI-guarded since #1072).

## 0. Mechanical findings first (fix-lane, independent of the owner walk)

| # | Severity | Finding | Pages | Evidence / root cause |
|---|---|---|---|---|
| M1 | High | **Census live-API path fully broken: 54 variables > API's 50-var cap** → HTTP 400 on every vintage (2022/2023/2024 all tested). Page silently survives on committed summary caches, so users see cached data believing it live. | housing-needs-assessment | Proven: same query trimmed to 50 vars returns 200. Fix: split the DP03/DP04 profile query into two requests (or trim 4 vars). |
| M2 | High | **Light-mode contrast failures — 84 across 6 pages, all light mode, none dark.** Worst: census-dashboard's entire `mf-stat` stat block at ratio 1.14 (near-invisible: 13 labels + 13 values + 10 subs); economic-dashboard `STRONG`/yardi callouts 1.14; insights JCHS narrative 1.14; compliance-dashboard `cd-kpi-value` 1.40; data-map-browser leaflet controls 1.13; HNA `chart-loading-overlay` ×31 at 1.83 (transient but persists on slow loads). | census-dashboard, economic-dashboard, insights, compliance-dashboard, data-map-browser, housing-needs-assessment | Hardcoded dark-palette colors with no light-mode overrides. One PR class. |
| M3 | Medium | **Data Trust Center fetches two files the public build intentionally strips** (`DATA-MANIFEST.json` ×3, `data/audit/quarantine-candidates.json` ×2) → guaranteed 404 console errors on production, forever. | data-review-hub | `data/audit` is excluded in build-public-site.mjs (line 105) + public-artifact-guard. Fix: degrade silently when these internal artifacts are absent (or publish sanitized equivalents). |
| M4 | Medium | **Axe:** 1 critical `aria-required-children` (housing-legislation-2026) + serious `color-contrast` on hna-comparative-analysis, housing-legislation-2026, about, insights (overlaps M2). | 4 pages | From a11y-baseline run against production. |
| M5 | Low | Transient 503 observed once on `js/pma-parcel-zoning.js` during the smoke run; re-probed ×3 → 200. GitHub Pages hiccup, not reproducible. | market-analysis | Watch only. |
| M6 | Info | Census API key visible in client-side request URLs. Key is NOT in the repo (deploy-time injection into config.js); client-side exposure is inherent to a static site calling Census directly, and Census keys are free/rate-limited. | HNA + data pages | Accepted-by-design; revisit only if quota abuse appears. |
| M7 | — | Link audit + chart-population results | (appended in §3 when the lane completes) | |

## 1. The owner walk — pages grouped by review priority

### Tier A — the money pages (walk first, these changed most this cycle)

| Page | What changed recently | Review notes |
|---|---|---|
| index.html | hero copy ("roughly half of renters") accepted earlier — re-read once in place | Copy previously owner-accepted; confirm it still reads right against the current stats |
| housing-needs-assessment.html | scenario section rewritten read-only + Scenario Builder CTA (#1264); AMI-tier panel leads with demand counts | **M1 + M2 apply.** Read the new scenario copy live; click the CTA (should land pre-selected + auto-run) |
| hna-scenario-builder.html | now consumes geoType/geoid/auto URL params (#1264) | Arrive via the HNA CTA, not directly |
| deal-calculator.html | 110/120% AMI bands + middle-income labels (#1266); funding-context cards (#1250) | Read the three band labels (70/80 income-averaging caveat, 110/120 MIHTC/Prop-123). Check a Mesa County deal: WAP + context cards render |
| market-analysis.html | whole-tract PMA display + area apportionment + D-lite commute overlay + barrier flag (off) + funding context card (#1237–#1250) | Fruita site (39.1660, −108.7080) is the calibration reference; confirm tract opacities and the "does not change scores" overlay label |
| lihtc-opportunity-finder.html | OZ layer now 126 real tracts (#1252); tooltip says "expires 12/31/2028" | Toggle the OZ overlay; spot a known OZ county (Mesa: 3 tracts) |
| data-review-hub.html (Data Trust Center) | consolidated center + freshness badges (#1229–#1231) | **M3 applies** (console-only; page renders fine) |

### Tier B — analysis + insights pages

| Page | Notes |
|---|---|
| insights.html | M2 + M4 contrast; JCHS narrative block is the failing element |
| hna-comparative-analysis.html | M4 serious contrast; ranking scenarios pinned to ranking-index (regenerate rule if touched) |
| colorado-deep-dive.html, colorado-market.html, market-intelligence.html | No battery findings; verify copy freshness against 2026 data vintages |
| economic-dashboard.html, census-dashboard.html, compliance-dashboard.html | M2 contrast (census-dashboard worst on the site) |
| historical-trends.html, land-value.html, construction-commodities.html, regional.html, compare.html | Clean battery; visual walk only |
| housing-legislation-2026.html | M4 critical aria + contrast; content vintage check (2026 session) |
| lihtc-allocations.html, lihtc-enhancement-ahcia.html, lihtc-guide-for-stakeholders.html, LIHTC-dashboard.html, state-allocation-map.html, chfa-portfolio.html, preservation.html, cra-expansion-analysis.html | Clean battery; walk for copy currency (OBBBA 12%/25% figures shipped in tax-credit arc) |
| policy-briefs.html | Brief sources gated per-PR via test:briefs; links are searches-by-design where healed |
| article-co-housing-costs.html, article-pricing.html | Static articles; date-stamp check |

### Tier C — utility, navigation, legacy

| Page | Notes |
|---|---|
| select-jurisdiction.html, search.html, sitemap.html, insights nav | Nav truth: **parked decision — Help for Homebuyers in top nav yes/no is still undecided; decide during this walk** |
| help-for-homebuyers.html | Content shipped + verified in #1220s arc; only the nav-placement decision remains |
| developer.html, developer-brief.html, developer-where.html, pipeline.html, indibuild-pipeline-public.html | Walk normally |
| developer-pipeline.html | **Docs-only by design since #1217** — do not flag the missing kanban/CSV wiring |
| data-explorer.html, data-map-browser.html, dashboard-data-quality.html, dashboard-data-sources-ui.html, data-status.html, dashboard.html | M2 hits data-map-browser (3 leaflet controls); legacy diagnostic pages carry public-facing labels since #1098 |
| ic-summary.html, colorado-elections.html, og-card.html, about.html, privacy-policy.html | about.html has an M4 contrast hit; og-card is a share-card template (not user-facing nav) |
| places/*.html (484) | Reviewed as a class: regenerated from place-chas; CI freshness-guarded (test:place-pages-fresh). Spot 3–5 (incl. Silt + Erie 0824950) rather than all |

## 2. Parked decisions surfaced for this walk

1. **Help for Homebuyers top-nav placement** — the one explicitly-undecided IA question.
2. **Scenario-section copy** (#1264) and **AMI band labels** (#1266) were merged under merge-as-acceptance — this walk is the natural moment to actually read both on the live site.
3. Standing don't-re-flag list (all verified resolved or by-design): local-resources search links, ZORI triangulation display, commuter term, place-vs-county masking fixes, OZ flag (fixed), developer-pipeline docs-only, rent-gap tenure mixing.

## 3. Link + chart audit results

- **Chart population: 20/20 charts pass against production** (chart-population-audit, report `audit-report/chart-population/2026-07-20T07-35-48-043Z.json`) — every audited canvas renders with data, including the Scenario Builder and colorado-deep-dive sets.
- **Source/link health: 13/13 OK** in the 2026-07-20 weekly source-health snapshot (0 dead, 0 blocked, 0 stale, 0 parse errors) — the snapshot refresh is sitting in cron PR #1261. Historical context stands: url-health "broken" over-reporting was WAF false-positives; genuine dead links were healed in #1015/F35 and local-resources links are durable searches by design.
- **Repo link audit (completed on rerun): 57,590 local links across 32,046 files — 54,373 OK, 2,008 "missing," triaged as follows.** 1,504 are stale `.claude/worktrees` session copies (the scanner shouldn't walk `.claude/` — hygiene fix for the script) and most of the rest are `dist/` duplicates of one real finding, promoted to **M8** below. *Correction for the record:* the first run of this audit was killed on a wrong "wedged" diagnosis — the script buffers all output until completion, so 20 minutes of silence was normal; the rerun completed and surfaced M8, which the substituted signals had missed. (M7 closed.)

### M8 (High, found by the completed link audit) — methodology links 404 on production

Every one of the **483 place pages** links `../docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md`, and the **LIHTC Opportunity Finder** links `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md` — but the public build strips `docs/`, so both **404 on the live site** (probed 2026-07-20). `config/data-discovery-config.json` is the same class (folds into M3). Fix: either publish the two methodology docs in the public build (they are public-safe method documentation) or rewrite the links to an in-app methodology page; either way, add a build-time guard that no served HTML links a stripped path — that guard would have caught this class at #1072-time.

## 4. Suggested fix-lane sequencing after the walk

1. **M8** methodology-link 404s (user-visible on all 483 place pages + the Opportunity Finder; smallest fix with the widest reach) + the stripped-path build guard.
2. **M1** Census 54-var split (one PR, mechanical, provable both directions).
3. **M2+M4** light-mode contrast + the one ARIA critical (one PR: add light-mode overrides for `mf-stat__*`, `cd-kpi-value`, yardi/JCHS callouts, leaflet controls, chart-loading-overlay; fix `aria-required-children` on housing-legislation-2026; extend runtime-contrast CI assertions to pin the fixed pages at 0).
4. **M3** Data Trust Center silent degradation for stripped internal artifacts (now includes `config/data-discovery-config.json`).
5. Audit-script hygiene: repo-link-audit should skip `.claude/` and stream per-directory progress.
6. Whatever the owner walk itself surfaces (this manifest leaves room — annotate per page as you go).

