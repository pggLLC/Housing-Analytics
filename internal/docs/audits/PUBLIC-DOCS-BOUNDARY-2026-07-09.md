# Public Docs Boundary Review

Date: 2026-07-09  
Scope: Phase 4, public docs boundary from `docs/qa/site-audit-2026-07/04-plan.md`

## Decision

`docs/qa`, `docs/audits`, `docs/audit`, and `docs/codex-audits` should remain repo-visible but not public-site artifacts.

These files are useful implementation, QA, and handoff records. They are not product-facing methodology pages. Publishing them would expose stale work orders, superseded findings, internal reviewer instructions, and implementation context that can confuse public users or search engines.

## Current Build Behavior

`scripts/build-public-site.mjs` already uses a docs allowlist. It copies selected public docs plus `docs/methodology/**`, and it blocks `docs/qa` explicitly. Because non-allowlisted `docs/**` paths are skipped, `docs/audits`, `docs/audit`, and `docs/codex-audits` are also not copied to the public build today.

This PR makes the boundary explicit in `scripts/audit/public-artifact-guard.mjs` so a future build change fails if any of those audit/QA directories enter `dist`.

## Public Docs Policy

| Path | Public artifact? | Rationale |
|---|---:|---|
| `docs/methodology/**` | Yes | Product-facing methodology and source explanations. |
| Explicit `PUBLIC_DOCS` allowlist in `scripts/build-public-site.mjs` | Yes | Stable public documentation already curated for users. |
| `docs/qa/**` | No | QA notes, smoke results, work plans, and reviewer handoffs. |
| `docs/audits/**` | No | Implementation audits, work orders, and owner-decision records. |
| `docs/audit/**` | No | Prior audit/response packets; historical but not user-facing. |
| `docs/codex-audits/**` | No | Agent handoff prompts and source-verification packages. |

## Owner Disposition

Keep audit and QA records in the repository for traceability. Exclude them from the public artifact unless a specific report is promoted into a curated public methodology or transparency page.

Promotion rule: if an audit finding should become public-facing, write a clean public summary under an allowed docs path rather than exposing the raw QA/handoff file.

## Evidence

Commands:

```bash
npm run build:public
node scripts/audit/public-artifact-guard.mjs dist
```

Expected result:

```text
Public artifact guard passed
```

