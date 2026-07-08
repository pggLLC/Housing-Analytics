# Pass C — Hygiene, Boundary, And Testing Audit

Audit date: 2026-07-07  
Method: source inspection and allowed gates only. No mutating freshness/regeneration commands were run.

## Repo Map

Counts are approximate source-tree counts from 2026-07-07. `data/* 2.json` iCloud duplicates were counted, not deleted, because this is audit-only.

| Area | Count / examples | Notes |
|---|---:|---|
| Root HTML pages | 53 | Public tools, dashboards, articles, redirects, internal gated pages. |
| Generated place pages | 484 | Includes `places/_template.html` plus generated profiles. |
| JavaScript files | 246 | Modular HNA, PMA, calculators, components, dashboards. |
| Scripts | 244 | Build, fetch, validation, audit, generation pipelines. |
| Tests | 163 | Mix of DOM/source-grep/unit/integration tests. |
| iCloud duplicate JSON files | 228 | Work order notes these can break file counts; not removed in this audit. |

## Hygiene Findings

| ID | Severity | Finding | Evidence | Recommendation |
|---|---:|---|---|---|
| C-01 | P0 | There is no automated guard for cross-surface value equality and source/vintage agreement. The HNA median home-value contradiction survives even with `npm run test:hna` green. | A-01 evidence; `npm run test:hna` passed 730/0. | Add a small test that renders or calls both stat and narrative paths for sample geographies and asserts identical value/source/vintage, with exceptions explicitly declared. |
| C-02 | P0 | There is no automated guard distinguishing analytical labels from source-membership tags. `preservation-candidate` overclaim survives current data/test gates. | A-02 evidence; `test/smoke-f139.test.js:51` only asserts Silt includes the tag; no risk-definition test found. | Add a schema or semantic test requiring any “risk/candidate/recommendation/classification” label to document whether it is computed, source membership, or owner-curated. |
| C-03 | P1 | Opportunity Finder verifier copied production weights and drifted from the app. | `scripts/audit/verify-opportunity-finder.mjs:54-66`; `js/lihtc-opportunity-finder.js:297-311`. | Use a shared source of truth. At minimum, add a test that extracts both weight objects and fails on mismatch. |
| C-04 | P1 | Several tests are source-grep assertions over implementation text rather than behavior. This is sometimes useful for static guards, but brittle after modularization. | `test/prop123-historical.test.js:176-193`; `test/integration/compliance-dashboard.test.js:155-171`; `test/tigerweb-timeout.test.js:57-105`; `test/hna-functionality-check.js:405-408`. | Keep source-grep tests only for static contract checks; move behavior to module-level or DOM-render tests. Mark legacy-grep tests with retirement criteria. |
| C-05 | P1 | `js/housing-needs-assessment.js` remains a compatibility stub but legacy tests still point at it. Some known failures are from this old contract. | `js/housing-needs-assessment.js:2-12`; `housing-needs-assessment.html:145`; `test/integration/housing-needs-assessment.test.js:47-62`; `test/hna-functionality-check.js:4-18`. | Keep the stub until external links stabilize, but migrate tests to `js/hna/*` modules and rendered HNA page behavior. Then retire stub assertions. |
| C-06 | P1 | Soft-funding link health was fixed separately, but freshness and embedded URL guardrails remain weak for the program status file. The file still declares `lastUpdated: 2026-04-07` in current working tree inspected during this audit. | `data/policy/soft-funding-status.json:2`, `:346`; URL health workflows exist at `.github/workflows/source-url-sweep.yml` and `url-health-weekly.yml`; `test/test_soft_funding_tracker.js` checks tracker behavior but not all embedded URLs/current quarter. | Add a data-specific guard: every non-null `contactUrl` is included in source-url/url-health sweeps; `lastUpdated` must be within an owner-defined SLA or explicitly waived. Do not broaden content refresh in a link-health PR. |
| C-07 | P2 | Public/internal boundary is better than earlier audits but still mixed. Developer pages are gated, while public pages contain pipeline teasers and repo docs expose internal work-order history. | `developer.html:9`; `developer-brief.html:1233-1317`; `compare.html:36-37`; `market-analysis.html:2188-2266`; `docs/qa/*`, `docs/audits/*`. | Decide whether `docs/qa`/`docs/audits` are public artifacts. If public, scrub operational phrasing; if internal, exclude from public build/docs index. |
| C-08 | P2 | Diagnostics pages are publicly reachable and useful, but they should be categorized as trust/ops, not ordinary user journeys. | `data-review-hub.html:741-742`; `data-status.html:274-275`; `dashboard-data-quality.html:191-233`. | Centralize under Data Trust Center and remove duplicate legacy paths from primary nav. |
| C-09 | P2 | Placeholder/stub language remains in a few user-facing or docs-adjacent places. Some is intentional, but not all has retirement criteria. | `hna-comparative-analysis.html:191`; `developer-where.html:215-219`; `docs/guides/deal-predictor.md:16`, `:104`; `docs/api/js__pma-provenance.md:12-36`. | Add a placeholder inventory with owner, public visibility, and “acceptable until” criteria. |
| C-10 | P2 | iCloud duplicate JSON files can distort counts and sweeps. Work order notes `find data -name "* 2.json" -delete` before counting; audit found 228 such files. | `find data -name '* 2.json' | wc -l` -> 228. | Add a repo hygiene guard that fails on `* 2.json` outside allowed fixtures, or add `.gitignore`/cleanup guidance. |
| C-11 | P3 | Runtime visual, console, and mobile boundary tests were not run in this audit. | No browser command run. | Run `npm run audit:console`/site-audit or targeted Playwright screenshots in a separate rendered QA pass. |

## Boundary Review

| Boundary | Current status | Risk |
|---|---|---|
| Public analytical claims vs methodology | Mostly strong, except home-value and preservation labels. | High if screenshots/reports are used externally. |
| Public tools vs internal pipeline | Mixed but partly gated. | Medium: public visitors can see internal-workflow concepts without context. |
| Source data vs modeled outputs | Many source badges exist; Class A/B contradictions show guard gaps. | High for repeated metrics and classification labels. |
| Docs/QA/audits in public repo | Extensive, useful for traceability, but operationally noisy. | Medium: public readers may treat work orders as product documentation. |

## Test Inventory Notes

| Test type | Examples | Assessment |
|---|---|---|
| Static contract/source-grep | `test/acs-etl.test.js`, `test/tigerweb-timeout.test.js`, `test/prop123-historical.test.js` | Good for checking files/strings, weak for behavior and cross-surface consistency. |
| Module/unit | `test/hna-home-value-cascade.test.js`, `test/pma-competitive-set.test.js`, `test/soft-funding-tracker.test.js` | Stronger where modules expose pure functions/data. |
| Generated artifact freshness | `test:ranking-fresh`, `test:place-pages-fresh`, digest freshness | Powerful but some are mutating/read-only-looking per work order; not run here. |
| Browser/rendered | site audit scripts exist | Not run. Needed for visual/mobile/blank-state confidence. |

## Prior Audit Reconciliation

| Prior theme | Disposition |
|---|---|
| Console errors | Recently worked in PRs around #1064; not re-audited with browser here. |
| Broken source links | Separate PR #1078 addressed link-health only. This audit does not re-fix links. |
| HNA ranking/seasonal vacancy | Settled owner decision per backlog; not reflagged. |
| Affordable Ownership module | In-flight conflict fence respected; absence not audited. Current main appears to have it. |
| CAR data ingest | Settled design decision; not reflagged. |
