# Fruita Commons — Preliminary Findings Memo (Screening-Grade)

**To:** Fruita Housing Authority / project stakeholders
**Date:** 2026-08-04 · **Status:** **screening estimate — not a market study.** Every modeled figure below requires verification through a true market study and stakeholder interviews (developer, lender, appraiser, broker, program administrator, local jurisdiction) before any pricing, funding, or legal decision.
**Computed with:** the CoHO ownership finance engine (`js/hna/ownership-finance.js`, PR #1388) and repo data — Mesa County AMI (4-person) **$97,600** (HUD), Fruita **place-level** typical home value **$486,295** (Zillow ZHVI 2026-05-31; Redfin closed-sale median $489,439 corroborates). County values were **not** substituted for Fruita.

---

## 1. The core finding

**A Fruita household needs about $134,000 (≈137% of AMI) to buy the typical Fruita home at market under conservative underwriting.** Every AMI tier the project targets is priced out of the market median without structure and subsidy. That is the problem Fruita Commons exists to solve, and the numbers below size it.

## 2. The gap depends on the mortgage model — show the range, not one number

Maximum affordable price and gap vs the $486,295 Fruita median, for a **100% AMI 4-person household ($97,600)**, across the engine's user-selectable models:

| Model | Max price | Gap vs median | Cash needed at closing | Note |
|---|---:|---:|---:|---|
| **Conservative screening (default)** | $353,780 | **−$132,515** | $35,378 | 10% down, 30% of income to housing |
| First-time buyer (5% down) | $318,934 | −$167,361 | $15,947 | PMI + financing more lowers price |
| Conventional (20% down / 43% DTI) | $554,556 | **+$68,261** | **$110,911** | ⚠️ "affordable" only with $111k cash and no other debt |
| FHA-insured (3.5% down) | $446,677 | −$39,618 | $15,634 | MIP drag; low cash |
| USDA RD (0% down) | $402,786 | −$83,509 | **$0** | rural-eligible buyers; income caps |

**How to read this:** the permissive conventional model does not eliminate the gap — it **moves it from monthly affordability to cash at closing** ($110,911, which a 100%-AMI first-time buyer rarely has). USDA is the standout lever for cash-constrained rural buyers (zero down), at the cost of strict income/site eligibility. A defensible study reports this range with the model assumptions disclosed; the tool never auto-picks the permissive answer.

## 3. Household size matters — the 4-person habit overstates townhome buyers

Conservative model, 100% AMI, by household size (HUD size factors):

| Household | Max price | Gap vs median |
|---|---:|---:|
| 1-person | $247,646 | −$238,649 |
| **2-person** | **$283,024** | **−$203,271** |
| 3-person | $318,402 | −$167,893 |
| 4-person | $353,780 | −$132,515 |

Typical 1–2BR townhome buyers are 1–3 person households — the real per-unit gap for much of the proposed unit mix is **$168k–$239k**, materially worse than the 4-person headline. Unit pricing must be set against size-adjusted incomes.

## 4. Structure levers (before any cash subsidy) — 2-person, 100% AMI

| Structure | Max price | Gain |
|---|---:|---:|
| Baseline | $283,024 | — |
| + zero property tax (authority/CLT retains land) | $307,146 | +$24,122 |
| + no PMI (assistance to 20% down or CLT-favorable lending) | $326,406 | +$43,382 total |
| … with a $200/mo HOA added back | $292,963 | HOA claws back ~$33k |

Two lessons: **land structure is worth real money** (~$24–43k of buyer power per unit), and **HOA dues take much of it back** — a $200/month HOA costs a buyer ~$33k of purchase capacity, which is why HOA design and reserves are a primary variable, not a footnote. Zero property tax holds **only while the authority retains the land** (ground-lease/CLT) or via restricted-value assessment — confirm with the Mesa County Assessor.

## 5. What this means for the project (hypothesis to test)

For a 50-unit project at the §5 unit/AMI mix, the screening arithmetic points to a strategy of **stacked levers rather than one big check**: authority land retention (Model A ground lease) + zero-tax structure + USDA/CHFA buyer financing + needs-based deferred assistance (HRWC-administered) + fee waivers/deferrals + Prop 123 (Fruita already shows **Committed**) — closing a per-unit gap on the order of **$100k–$200k** depending on AMI tier and household size. The land-disposition, resale-formula, and stewardship choices then determine whether that subsidy survives resale. This is the hypothesis the Tier-2 study must test, not a conclusion.

## 6. Must-verify register (before any decision)

1. **Market study + interviews** — demand, absorption, capture, product mix: broker/lender/developer input; no repo data can supply this.
2. **Prices** — $486–494k is the *all-homes* Fruita range; get **townhome/new-construction comps** (the script's unsourced $536–594k matched no repo source).
3. **Priced-out shares** — the 87.3%/82.2% figures remain unreproducible from repo data (income distribution tops out at 100% AMI); do not publish until traced.
4. **Lender/appraiser acceptance** of the chosen ground-lease/deed-restriction form; USDA site/income eligibility for Fruita.
5. **Assessor treatment** (restricted-value assessment), **bond counsel** on any authority issuance, **CDARA/construction-defect** posture for attached product, condo-map vs fee-simple townhome plat.
6. **Fruita Housing Authority capacity** — active-via-partnership (Fruita Mews) but unproven as a perpetual for-sale steward; plan the HRWC/CLT/regional partner role.
7. **HRWC terms** — provisional until a project-specific commitment exists (availability ≠ commitment).

*Method exposure: every figure above derives from `OwnershipFinance.maxAffordablePrice` / `compareModels` with the stated model parameters (see `data/policy/affordability-models.json` for each model's full assumptions and implications). Classification: modeled. Reproduce with the engine test suite or `compareModels(97600, 1.0)`.*
