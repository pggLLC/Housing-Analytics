# Phase 3.2 Rendered Evidence Pack

Current status: **PASS** as of the 2026-07-15 rerun.

Original audit date: 2026-07-08  
Latest rerun: 2026-07-15

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

Historical result: the 2026-07-08 smoke ran against `main` after PR #1095 merged. It failed with 3 hard findings: Erie place-profile glossary 404 on desktop/mobile and PMA mobile document overflow.

Fresh rerun:

```bash
npm run audit:core-rendered-smoke
```

Fresh report:

```text
audit-report/core-rendered-smoke/2026-07-15T18-26-40-609Z/core-rendered-smoke.md
```

The report directory is gitignored; durable summary evidence is preserved in [`core-rendered-smoke-2026-07-15.md`](core-rendered-smoke-2026-07-15.md).

Latest result: PASS across all 6 flows x 2 viewports. The prior Erie glossary 404 and PMA mobile overflow findings are no longer reproduced.

## Disposition Table

| Flow | Desktop | Mobile | Disposition |
|---|---|---|---|
| HNA default | PASS | PASS | Required controls/text present; no console errors, blank cards, or mobile overflow in the 2026-07-15 rerun. |
| Boulder County route | PASS | PASS | Uses HNA county deep link because there is no generated county-profile page. No rendered smoke findings in the 2026-07-15 rerun. |
| Erie place profile | PASS | PASS | The prior `/places/data/glossary.json` 404 is no longer reproduced; 0 request failures on both viewports in the 2026-07-15 rerun. |
| Opportunity Finder | PASS | PASS | Required table selectors and expected copy present; no rendered smoke findings in the 2026-07-15 rerun. |
| PMA | PASS | PASS | The prior PMA mobile overflow is no longer reproduced; mobile overflow failure count is 0 in the 2026-07-15 rerun. |
| Data Trust Center | PASS | PASS | Required overview panel/stat selectors present. Request failures were captured but not hard failures in the 2026-07-15 rerun. |

## Screenshots

The screenshots below are the original 2026-07-08 evidence images. The 2026-07-15 rerun used `scripts/audit/core-rendered-smoke.mjs`, which currently emits Markdown and JSON evidence rather than screenshots.

| Flow | Desktop | Mobile |
|---|---|---|
| HNA default | [desktop](screenshots/hna-default-desktop.png) | [mobile](screenshots/hna-default-mobile.png) |
| Boulder County route | [desktop](screenshots/county-boulder-desktop.png) | [mobile](screenshots/county-boulder-mobile.png) |
| Erie place profile | [desktop](screenshots/place-erie-desktop.png) | [mobile](screenshots/place-erie-mobile.png) |
| Opportunity Finder | [desktop](screenshots/opportunity-finder-desktop.png) | [mobile](screenshots/opportunity-finder-mobile.png) |
| PMA | [desktop](screenshots/pma-desktop.png) | [mobile](screenshots/pma-mobile.png) |
| Data Trust Center | [desktop](screenshots/data-trust-center-desktop.png) | [mobile](screenshots/data-trust-center-mobile.png) |

## Follow-Up Candidates

Historical 2026-07-08 follow-up candidates are retained below for traceability. The 2026-07-15 rerun did not reproduce either hard finding.

| Finding | Evidence | Suggested owner action |
|---|---|---|
| Generated place pages load `places/data/glossary.json` and receive 404. | Erie place profile desktop/mobile smoke failures on 2026-07-08. | Resolved or no longer reproducible as of the 2026-07-15 rendered smoke rerun. |
| PMA mobile document overflows by 31px. | PMA mobile smoke failure and screenshot on 2026-07-08. | Resolved or no longer reproducible as of the 2026-07-15 rendered smoke rerun. |
