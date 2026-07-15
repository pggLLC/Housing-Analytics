# Core Rendered Smoke — PASS

Generated: 2026-07-15T18-26-40-609Z

Scope: rerun of Phase 3 rendered QA after PR #1217 merged to `main`.

Command:

```bash
npm run audit:core-rendered-smoke
```

Result: PASS across 6 flows × 2 viewports. The prior 2026-07-08 hard findings are no longer reproduced: Erie place profile has no request failures, and PMA mobile has no document overflow.

| Flow | Desktop | Mobile | Evidence |
|---|---|---|---|
| HNA default | PASS | PASS | Required selectors/text present; no console errors, blank cards, or mobile overflow. |
| County profile: Boulder County | PASS | PASS | HNA county deep link loads with required controls; no console errors, blank cards, or mobile overflow. |
| Place profile: Erie | PASS | PASS | Required place-data and ownership-card selectors present; 0 request failures on both viewports. |
| Opportunity Finder | PASS | PASS | Required table selectors and expected copy present; 0 request failures on both viewports. |
| PMA | PASS | PASS | Required map and intro selectors present; PMA mobile overflow failure count is 0. |
| Data Trust Center | PASS | PASS | Required overview panel and stat selector present; request failures captured but not hard failures. |

Summary counters from the JSON report:

| Counter | Value |
|---|---:|
| Checks | 12 |
| Total hard failures | 0 |
| Total console errors | 0 |
| Total blank cards | 0 |
| Mobile overflow failures | 0 |

Notes:

- The audit report was generated under `audit-report/core-rendered-smoke/2026-07-15T18-26-40-609Z/`; that directory is gitignored, so this file preserves the durable evidence in `docs/qa`.
- The script writes Markdown and JSON evidence only. Existing screenshot files in this folder remain the original 2026-07-08 evidence images.
