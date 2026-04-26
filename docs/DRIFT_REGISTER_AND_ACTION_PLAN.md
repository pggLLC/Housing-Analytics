# Drift Register and Action Plan (from scratch notes)

_Last updated: 2026-04-26 (UTC)_

This document converts the latest scratch feedback into a single, explicit status board.
It separates:

1. **Already addressed / likely addressed** (based on referenced PRs/issues),
2. **Confirmed drift** (behavior appears inconsistent with intended logic), and
3. **Open work** with concrete next actions.

---

## 1) What appears already addressed

Based on the referenced phase summary and PR notes:

- `test/` vs `tests/` consolidation and endpoint coverage expansion were completed in **PR #625**.
- QCEW → LAUS migration for county-level job-growth coverage was completed in **PR #626**.
- Persona nav button behavior, transit isochrones, and deal-calculator soft-funds/impact-fee improvements were reported complete in prior phases.

> Verification still required in production for Issue #578 checklist items (workflows, deployed UI checks, summary file counts).

---

## 2) Confirmed/likely drift (explicit)

The table below states where drift appears and how to address it.

| Area                                  | Observed drift                                                                                                   | Why it matters                                                         | How it is being addressed                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data Freshness panel                  | Shows only "last checked" style timestamp; limited evidence of per-dataset freshness/content health              | Users cannot tell whether data is recent, complete, or partially stale | Expand panel to include per-source `data_as_of`, record counts, stale thresholds, and last successful ingest metadata; add links to source + run logs               |
| Census Explorer                       | Explorer allows out-of-Colorado selection and throws pattern errors in some flows                                | Breaks trust and usability for Colorado-focused workflows              | Enforce Colorado jurisdiction boundary in selectors and API query builders; add pre-submit validation and user-friendly error fallback                              |
| HNA Comparative jurisdiction matching | Mismatched city labels and suspect values (e.g., Fruita/Boulder anomalies) indicate join/key normalization drift | Wrong jurisdiction mapping produces misleading metrics                 | Normalize jurisdiction IDs to a canonical key (GEOID-first), then map display labels separately; add unit tests for known edge cases (city vs county vs CDP labels) |
| HNA comparison scope                  | Comparison appears county-level while UI implies sub-county comparability; labor stats absent                    | Decision-makers may compare unlike geographies                         | Add explicit scope badges (county/city/CDP), disable incompatible comparisons, and add labor-stat availability indicators                                           |
| Source links/404s                     | Some citations/paths reported missing or broken                                                                  | Traceability is lost                                                   | Add automated source-link checker in CI and require source URL presence for every surfaced metric                                                                   |
| Pipeline Log readability              | Low contrast/legibility                                                                                          | Accessibility issue (WCAG risk)                                        | Apply contrast updates and test with accessibility checks in CI                                                                                                     |

---

## 3) Open priority backlog (implementation-ready)

### P0 — Reliability and trust (immediate)

1. **Run Issue #578 verification checklist**
   - Re-run `build-market-data.yml` and `build-hna-data.yml`.
   - Verify local tests and deployed site runtime (fonts/maps/console).
   - Confirm expected HNA summary artifact count.

2. **Resolve Issue #516 market-data build failure**
   - Inspect failed run and root cause (key validity vs upstream API failure).
   - Re-trigger pipeline once dependencies are healthy.

3. **Complete Issue #550 QA validation**
   - Validate CHAS chart integrity, source badges, NHPD comp-set inclusion,
     pro-forma live updates, QAP slider behavior, and scenario toggles.

### P1 — Data drift closure (this week)

4. **Data Freshness v2**
   - Add a "data health card" per critical dataset with:
     - `data_as_of`,
     - `rows/coverage`,
     - `ingest_status`,
     - stale-state thresholds,
     - source links.

5. **Census Explorer hardening**
   - Colorado-only jurisdiction constraints.
   - Defensive parsing and structured error handling for pattern mismatch cases.
   - "Full census-stat inventory" page listing every Census variable used sitewide.

6. **HNA comparative integrity pass**
   - Canonical jurisdiction dictionary (GEOID + type + canonical name).
   - Data consistency tests for key examples: Fruita (city), Clifton (CDP), Boulder city.
   - Add "data not available for this geography" messaging where applicable.

### P2 — Product clarity and education (next)

7. **Index stats refinement**
   - Replace weak headline stats with statewide, policy-relevant metrics:
     rent-burden prevalence + affordable-housing deficit by AMI tier.

8. **Deal calculator explainability**
   - Expand LIHTC basics, document soft-funds restrictions, add lease-option site-control notes, and source links.

9. **Market analysis transparency**
   - Add plain-language definitions for peer benchmarking, LIHTC supply-in-buffer, and enhanced pipeline sources.

---

## 4) Data updates that require new source releases

These are intentionally separate from logic/UI fixes:

- Refresh ACS `B25070` / `B25064` to 2021–2025 once published.
- Pull HUD FY2026 Income Limits once published and validated.
- Re-check Q1-2026 pricing indicators against current syndicator LOIs.

---

## 5) Suggested issue structure to reduce confusion

- Keep **#578** as the single "post-merge verification" tracker.
- Close/merge **#577** into #578 to avoid duplicate checklists.
- Split #446 and #447 into small, owner-assigned deliverables:
  - docs automation,
  - integration/smoke tests,
  - data-health alerts,
  - accessibility/contrast fixes,
  - source-link integrity automation.

---

## 6) Definition of done for drift closure

A drift item is "closed" only when all are true:

1. Repro case added to issue,
2. Fix merged,
3. Automated test added (or CI guardrail),
4. User-facing copy updated if semantics changed,
5. Source/citation link verified,
6. Deployed verification captured in issue comment.
