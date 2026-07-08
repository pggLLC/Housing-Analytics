# Phase 3.2 Rendered Evidence Pack

Audit date: 2026-07-08

Scope: Phase 3.2 from `docs/qa/site-audit-2026-07/04-plan.md`. Docs/QA evidence only; no application code changed.

## Commands

Static server:

```bash
python3 -m http.server 8092
```

Rendered smoke:

```bash
REPORT_DIR=/tmp/coho-core-rendered-smoke-phase32 AUDIT_BASE_URL=http://127.0.0.1:8092 npm run audit:core-rendered-smoke
```

Fresh smoke report:

```text
/tmp/coho-core-rendered-smoke-phase32/2026-07-08T23-42-13-649Z/core-rendered-smoke.md
```

Result: the smoke ran against current `main` after PR #1095 merged. It failed with 3 hard findings: Erie place-profile glossary 404 on desktop/mobile and PMA mobile document overflow.

## Disposition Table

| Flow | Desktop | Mobile | Disposition |
|---|---|---|---|
| HNA default | PASS | PASS | No console errors, blank cards, missing selectors/text, or mobile overflow in the fresh smoke. |
| Boulder County route | PASS | PASS | Uses HNA county deep link because there is no generated county-profile page. No rendered smoke findings. |
| Erie place profile | FAIL | FAIL | Console 404 for `/places/data/glossary.json` on both viewports. Screenshot confirms page renders, but console health fails. |
| Opportunity Finder | PASS | PASS | No rendered smoke findings. |
| PMA | PASS | FAIL | Desktop passed. Mobile overflows document by 31px; first offenders include `#mobileNavToggle` and workflow step elements, with Leaflet internals also reported. |
| Data Trust Center | PASS | PASS | No rendered smoke findings. Request failures were captured but not hard failures in the smoke report. |

## Screenshots

| Flow | Desktop | Mobile |
|---|---|---|
| HNA default | [desktop](screenshots/hna-default-desktop.png) | [mobile](screenshots/hna-default-mobile.png) |
| Boulder County route | [desktop](screenshots/county-boulder-desktop.png) | [mobile](screenshots/county-boulder-mobile.png) |
| Erie place profile | [desktop](screenshots/place-erie-desktop.png) | [mobile](screenshots/place-erie-mobile.png) |
| Opportunity Finder | [desktop](screenshots/opportunity-finder-desktop.png) | [mobile](screenshots/opportunity-finder-mobile.png) |
| PMA | [desktop](screenshots/pma-desktop.png) | [mobile](screenshots/pma-mobile.png) |
| Data Trust Center | [desktop](screenshots/data-trust-center-desktop.png) | [mobile](screenshots/data-trust-center-mobile.png) |

## Follow-Up Candidates

These are evidence-backed findings only. Fixes are intentionally out of scope for Phase 3.2.

| Finding | Evidence | Suggested owner action |
|---|---|---|
| Generated place pages load `places/data/glossary.json` and receive 404. | Erie place profile desktop/mobile smoke failures. | Fix nested-page glossary path handling or generated page path prefix in a follow-up implementation PR. |
| PMA mobile document overflows by 31px. | PMA mobile smoke failure and screenshot. | Triage mobile header/workflow step width and map-internal overflow in a follow-up implementation PR. |
