# Pass B — IA, UX, And Copy Audit

Audit date: 2026-07-07  
Method: source inspection only. Browser rendering, mobile layout, keyboard behavior, chart rendering, and blank-state visuals are `UNRENDERED`.

## IA Snapshot

| Area | Observed source | Assessment |
|---|---|---|
| Homepage | `index.html` | Strong public positioning around housing analytics, but it mixes product onboarding, proof/audit posture, and many next steps. First-time user path could be simpler. |
| Core analytical tools | `housing-needs-assessment.html`, `lihtc-opportunity-finder.html`, `market-analysis.html`, `deal-calculator.html`, `compare.html` | Tool surfaces are substantial and generally disclose methodology, but the hierarchy asks users to understand several overlapping “where/what/feasibility” tools. |
| Data/diagnostics | `data-review-hub.html`, `data-status.html`, `dashboard-data-quality.html`, `dashboard-data-sources-ui.html` | Good for maintainers; too prominent for ordinary public users unless framed as “trust center.” |
| Internal/developer workflow | `developer.html`, `developer-pipeline.html`, `developer-brief.html`, gated mounts in public pages | Mostly gated by `developer-gate.js` or session checks. Public pages still contain visible “Developer Pipeline” teaser strips. |
| Generated place pages | `places/_template.html`, `places/*.html` | Place profiles are now a key public entry point. Ownership module absence is not audited; current main appears to include it. Runtime is `UNRENDERED`. |

## User-Impact Framing For Pass A Findings

| Finding | User-facing impact | Copy/UX implication |
|---|---|---|
| HNA home-value contradiction | A planner/developer can see one median home value in the top stats and another in the executive narrative, with different implied vintage/currentness. | Treat “median home value” as one reusable source-aware component. Do not let prose recompute it. |
| Preservation candidate overclaim | A user may infer that nearly all listed subsidized properties are objectively “at risk” when most are simply in source inventories. | Rename the visible category or split “tracked inventory” from “at-risk/expiring.” |
| Opportunity Finder verifier drift | Users may not notice directly, but maintainers can get false confidence from a stale audit harness. | In methodology pages, avoid saying a harness asserts something unless the harness consumes the same source of truth. |
| Deal predictor placeholder boundary | Users can treat a concept recommendation as finance feasibility if the surrounding workflow feels calculator-like. | Keep concept recs visually and verbally separate from DSCR/mortgage/pro forma outputs. |

## Navigation And Information Architecture Findings

| ID | Severity | Finding | Evidence | Recommendation |
|---|---:|---|---|---|
| B-01 | P1 | The site has too many peer-level “start here” paths for new users: HNA, Opportunity Finder, PMA, Compare, Deal Calculator, data dashboards, and Pipeline. | `index.html:431` links to all data sources; core tools appear across nav/components; `js/navigation.js:30-65` demotes diagnostics but keeps them reachable. | Recast the top IA around four jobs: Understand need, Find opportunities, Test a site/deal, Verify data. Put diagnostics inside “Verify data.” |
| B-02 | P1 | Diagnostic pages are useful but read as product surfaces instead of a trust center. | `data-review-hub.html:741-742`, `data-status.html:274-275`, `dashboard-data-quality.html:191-233`. | Rename/cluster as “Data Trust Center” with three tabs: Freshness, Sources, QA Coverage. Keep legacy dashboards linked from there. |
| B-03 | P1 | Public pages contain visible developer-pipeline teasers and gated mounts. They are not inherently wrong, but they blend public methodology with internal business workflow. | `housing-needs-assessment.html:258-264`; `lihtc-opportunity-finder.html:1513-1518`; `market-analysis.html:74-75`, `:2188-2266`. | Decide whether “Affordable Housing Pipeline” is a public methodology or internal CRM. If public, rename internal mounts separately; if internal, hide teasers unless authenticated. |
| B-04 | P2 | Homepage proof language says every stat is sourced and links to a demo-mode audit. That is useful, but it can overpromise while Pass A found source-path contradictions. | `index.html:356-360`. | Keep the trust claim but make it narrower: “Sourced and monitored” rather than implying every repeated metric is cross-surface reconciled. |
| B-05 | P2 | HNA page is rich but dense. Many cards, callouts, charts, and methodology notes compete for attention. | `housing-needs-assessment.html` has many sections and source/meta blocks; source inspection only. | Add an executive “decision strip” near top: Need severity, affordability pressure, production gap, ownership feasibility, data confidence. Let details remain below. |
| B-06 | P2 | Place pages should be treated as a primary SEO/user landing experience, not just generated factsheets. | 484 place HTML files counted in `places/`; `sitemap.xml` prior work lists place pages. | Make place pages the public first step: search/select jurisdiction -> profile -> choose HNA/OF/PMA/deal follow-up. |
| B-07 | P2 | Data quality dashboards use operational language (“Pipeline log,” “QA layer,” “coverage QA”) that may be obscure to non-maintainers. | `dashboard-data-quality.html:191-233`, `:279-307`. | Add public-facing labels: “What data is fresh?”, “What data is missing?”, “What is estimated?” Keep technical detail expandable. |
| B-08 | P2 | Preservation copy says “candidate” and “at risk” where the data only proves inventory/source membership. | `js/components/affordable-housing-layer.js:124-125`; `js/compare.js:720-722`. | Copy should say “tracked subsidized inventory” until a true risk model exists. |
| B-09 | P3 | `UNRENDERED`: mobile and chart blank states were not validated. | No browser run. | Add a rendered QA pass for the revised IA, especially HNA and place pages. |

## Revised Top Navigation Proposal

| Proposed nav item | Contains | Why |
|---|---|---|
| Jurisdiction Profiles | Search + generated place/county profile pages | Best first step for most public users. |
| Housing Need | HNA and compare | Answers “what is the need here?” |
| Opportunity Finder | LIHTC locator + preservation inventory | Answers “where should we look?” |
| Site And Deal Feasibility | PMA, deal calculator, land value | Answers “can a site/deal work?” |
| Data Trust Center | Sources, freshness, QA, methodology | Keeps transparency visible without making diagnostics a primary product path. |
| Methodology | Pipeline article, guides, glossary | Explains assumptions and limitations. |

## Homepage Wireframe Outline Only

1. Jurisdiction search as the first interactive element.
2. Three job cards: Understand need, Find opportunity, Test feasibility.
3. Compact statewide snapshot with explicit source/vintage labels.
4. “Data Trust” strip: last refresh, source count, known limitations link.
5. Recent methodology/brief links, not a long tool catalog.
6. Footer with diagnostics, docs, and repository links.

No marketing copy was drafted per work order.
