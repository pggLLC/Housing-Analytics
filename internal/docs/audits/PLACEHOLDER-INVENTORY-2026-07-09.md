# Placeholder Inventory And Disposition, 2026-07-09

Scope: Phase 4, placeholder inventory from `docs/qa/site-audit-2026-07/04-plan.md`

Audit source: C-09 in `docs/qa/site-audit-2026-07/03-hygiene-boundary-testing.md`

## Decision

Placeholder language is acceptable only when it is explicit about current limitations, is gated/internal, or is docs-only future-work tracking. Public surfaces should not use placeholder language as an unfinished product promise. If a public page needs placeholder copy, it should read as a limitation disclosure with a clear owner and retirement condition.

## Inventory

| ID | Surface | Public visibility | Placeholder class | Current disposition | Owner | Acceptable until / retirement criteria |
|---|---|---|---|---|---|---|
| PH-01 | `hna-comparative-analysis.html:191` | Public page | Scenario controls: "Custom sliders are coming soon." | Acceptable as a compact limitation disclosure because the page currently uses deterministic, owner-reviewed generated preset indexes. The phrase "coming soon" should not be treated as a dated product commitment. | HNA methodology / ranking owner | Retire when owner approves custom scenario sliders, weighting constraints, audit labels, and regression tests. If no near-term slider work is planned, revise the phrase to "not enabled" language in a future copy PR. |
| PH-02 | `developer-where.html:215-219` | Internal/gated developer workflow | IOI methodology placeholders for CHAS-derived need, capture advantage, and rent trend | Acceptable only as internal draft methodology while the developer workflow remains gated and excluded from public artifact promotion. | Internal pipeline / deal-tracker owner | Retire before exposing IOI methodology publicly or using IOI as an externally scored metric. Replacement requires an owner-approved methodology doc plus real source or modeled inputs for the placeholder signals. |
| PH-03 | `docs/guides/deal-predictor.md:16`, `docs/guides/deal-predictor.md:104` | Docs-adjacent; not a public artifact in the current public build boundary | Capital stack placeholder for concept screening | Acceptable limitation disclosure. The guide states that the lightweight predictor is not a real pro forma and points readers to the Pro Forma guide. | Deal calculator / LIHTC predictor owner | Retire if the predictor capital stack is surfaced as a finance or underwriting output, or when the predictor shares the full deal calculator's debt-sizing and pro forma primitives. |
| PH-04 | `docs/api/js__pma-provenance.md:12-36` | Docs-adjacent API reference; not a public artifact in the current public build boundary | PMA confidence badge future work and placeholder provenance modes | Acceptable as API contract/future-work tracking, not as user-facing product copy. Placeholder provenance should remain marked low/preliminary wherever it affects displayed PMA scores. | PMA / provenance owner | Retire when provenance records are wired into the PMA confidence badge. If placeholder factors remain after badge wiring, the UI must display low/preliminary source confidence for affected factors. |

## Owner Guidance

- Keep PH-01 public only as limitation copy; do not describe custom sliders as delivered until a methodology owner approves the slider contract.
- Keep PH-02 behind the internal developer gate; do not expose IOI placeholder methodology as a public score.
- Keep PH-03 separated from pro forma/underwriting outputs unless it is backed by the full calculator primitives.
- Keep PH-04 as an implementation/API contract until the PMA confidence badge consumes provenance records.

## Non-Inventory Notes

- Compatibility stubs and legacy source-grep tests are tracked by Phase 1.2/C-05 and are not repeated here.
- Audit and QA work-order docs are excluded from public artifact promotion by the Phase 4 public docs boundary guard.

## Evidence

- Source sweep: `rg -n "placeholder|coming soon|indicativeCapitalStack|PMA confidence badge" hna-comparative-analysis.html developer-where.html docs/guides/deal-predictor.md docs/api/js__pma-provenance.md`
- Validation: `npm run validate` passed on 2026-07-09.
