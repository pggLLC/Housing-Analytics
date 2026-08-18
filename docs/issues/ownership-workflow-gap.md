# Issue: Add ownership/for-sale workflow track to the 6-step LIHTC pipeline

**Discovered:** 2026-08-18 (Copilot Task Agent sessions `5339d007`, `e20dac9f`, `f68912e6`)  
**Status:** Deferred — requires owner sign-off before implementation  
**Labels:** `enhancement`, `codex`

---

## Problem

The repo has a well-structured 6-step linear workflow for LIHTC/rental development:

```
1. Opportunity Finder       (lihtc-opportunity-finder.html)
2. Select Jurisdiction      (select-jurisdiction.html)
3. Housing Needs Assessment (housing-needs-assessment.html)
4. Market Analysis          (market-analysis.html)
5. Scenario Builder         (hna-scenario-builder.html)
6. Deal Calculator          (deal-calculator.html)
```

This workflow is **implicitly rental/LIHTC-first**. All 6 steps default to rental
assumptions; the `wf-progress-steps` UI carries a user straight through LIHTC
logic with no fork for ownership product.

Meanwhile, the repo already contains all the underlying logic for affordable
**for-sale / ownership** product — it's just not connected to the workflow:

| File | Purpose |
|---|---|
| `js/hna/hna-ownership-need.js` | CHAS cost-burden, buyer-pool screening, AMI band sizing |
| `js/hna/hna-ownership-strategy.js` | Tier pricing, program eligibility, stewardship providers |
| `js/hna/ownership-decision-chain.js` | Decision logic for ownership product type |
| `js/hna/ownership-finance.js` | Mortgage, down-payment, PITI calculations |
| `js/hna/ownership-resale.js` | Resale restriction and equity modeling |
| `js/rent-vs-buy-breakeven.js` | Rent-vs-buy breakeven calculator (Deal Calculator) |
| `for-sale-market-study.html` | For-sale market study screening page |
| `help-for-homebuyers.html` | Consumer-facing DPA / homebuyer program guide |
| `js/components/homeownership-programs.js` | Homeownership program cards |
| `js/deal-calculator.js` | Already has `currentDealMode()` + `updateDealModeUi()` toggle |
| `deal-calculator.html` | Already has `data-dc-mode="ownership"` / `data-dc-mode="rental"` attributes |
| `housing-needs-assessment.html` | Already has ownership sections (line 1658+) |

A developer pursuing **affordable for-sale product** (CLT, land trust, deed-restricted
ownership, Prop 123 DPA-eligible units) has no guided path through the tool.

---

## Proposed Solution

Add an **ownership workflow track** by forking after Step 2 (Jurisdiction):

```
1. Opportunity Finder → 2. Select Jurisdiction → [product-type fork]
   Rental track:    3. HNA (rental)    → 4. Market Analysis      → 5. Scenario Builder     → 6. Deal Calculator (rental mode)
   Ownership track: 3. HNA (ownership) → 4. For-Sale Mkt Study   → 5. Ownership Strategy   → 6. Deal Calculator (ownership mode)
```

After the user selects a jurisdiction, present a **product-type choice**: "Rental / LIHTC"
vs. "Ownership / For-Sale". The choice is persisted in `workflow-state-core.js` (via
`_wfSet` / `_wfGet`, localStorage key prefix `coho_wf_`) and the `wf-progress-steps`
bar renders different step labels per track.

### Key implementation detail — deal mode
`js/deal-calculator.js` already implements `currentDealMode()` by reading a radio button
(`input[name="dc-deal-mode"]`). The workflow product-type choice should pre-select this
radio on page load so the Deal Calculator opens in the correct mode automatically.

---

## Files to Modify

| File | Change |
|---|---|
| `select-jurisdiction.html` | Add product-type toggle UI after jurisdiction picker |
| `js/workflow-state-core.js` | Add `product_type` key (`'rental'` \| `'ownership'`) to stored state |
| `js/workflow-state-api.js` | Expose `WorkflowState.setProductType()` / `getProductType()` |
| `js/components/workflow-progress.js` | Render step 3–6 labels conditionally per product type |
| `housing-needs-assessment.html` | Read product type on load; scroll to / expand ownership section if `ownership` |
| `for-sale-market-study.html` | Add `wf-progress-steps` bar (ownership track, step 4) |
| `deal-calculator.html` | Read product type on load; pre-select ownership radio if `ownership` |

---

## Constraints

- No bundler — all JS is hand-ordered `<script>` tags; new modules must attach to `window.*`
- Never push to `main` — branch + PR only
- Ownership HNA calculations are screening estimates: the label
  `"potential buyer pool — not committed demand"` must be preserved in all UI copy
- After any data file change: run `node scripts/validate-schemas.js` and
  `python scripts/rebuild_manifest.py`
- `wf-progress-steps` is rendered by each page individually (not a shared component);
  all 6 HTML pages in each track need their step bar updated

---

## For Claude / Codex

See `docs/issues/ownership-workflow-gap-claude-handoff.md` for the full integration
design brief and implementation script.

**Do not start without owner sign-off per AGENTS.md.**
