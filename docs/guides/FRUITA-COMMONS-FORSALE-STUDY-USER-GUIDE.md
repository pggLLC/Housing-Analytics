# User Guide — CoHO Affordable-Homeownership Analysis & the Fruita Commons For-Sale Study

**Audience:** housing authorities, affordable-ownership developers, program administrators, and planners (Fruita Housing Authority is the first user).
**Companion to:** `docs/audits/SCOPING-FRUITA-COMMONS-FOR-SALE-MARKET-STUDY-2026-08.md` (audit) and `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` (revised plan).
**Status:** guide to the tool **as designed**. Some features described are planned (Phases 1–11); each section marks what exists today vs what is planned. All numbers are **screening estimates** — verify locally before any funding, pricing, or legal decision.

---

## 1. What this tool is (and is not)

It answers, for a Colorado jurisdiction or a specific project, **how far local incomes fall short of local home prices, and what it takes to close that gap** — through subsidy, land, program design, and shared-equity ownership.

There are **two levels:**

- **Tier 1 — Jurisdictional Assessment** (every CoHO jurisdiction): a screening picture of the ownership affordability gap, who is priced out, what inventory and programs exist, and a preliminary strategy. *It is not a market study.*
- **Tier 2 — Project Market Study** (a specific site, e.g. Fruita Commons): detailed underwriting — unit mix, costs, subsidy, buyer assistance, demand, capture, shared-equity lifecycle, and an exportable report.

**It is not** a promise of funding, a lender pre-approval, an appraisal, a legal opinion, or a sales forecast. Every result is labeled by how trustworthy it is (see §9), and the tool tells you exactly what still needs a professional (lender, appraiser, attorney, administrator) to confirm.

---

## 2. The core idea: buying power vs price

A household's **maximum affordable price** is what its income can support under a chosen set of mortgage assumptions. The **gap** is the local home price minus that maximum. Worked example, Fruita (Mesa County AMI $97,600; Fruita typical home value $486,295), under the conservative default model:

| Household income | As % of AMI | Max affordable price | Gap vs $486,295 |
|---:|---:|---:|---:|
| $78,080 | 80% | $283,024 | **−$203,271** |
| $97,600 | 100% | $353,780 | **−$132,515** |
| $117,120 | 120% | $424,536 | **−$61,759** |

**Reading it:** even a 120%-AMI household is ~$62,000 short of Fruita's typical home. Income needed to buy at market is about **$134,000 (137% of AMI)**. That shortfall is the "gap to fill" — the number your land, subsidy, and program design have to close.

---

## 3. Choosing an affordability model — and why it is the most important choice you make

**This is the setting you control that most changes the answer.** The tool ships several models and *explains the implications of each* so you can pick the one(s) that match your actual buyers, product, and lender — not the one that makes the project look best.

| Model | Down payment | Qualifying rule | Best matched to | What it does to the gap |
|---|---|---|---|---|
| **Conservative screening** (default) | 10% | 30% of income to housing | Early planning, below-market for-sale | Most cautious — **largest** gap |
| First-time buyer | 5% | 30% to housing | FTBs using down-payment assistance | Less cash up front, higher monthly cost |
| Conventional lender DTI | 20% | 43% of income to all debt | Move-up buyers with no other debt | Most generous — **smallest** gap ⚠️ |
| FHA-insured | 3.5% | 43–50% to all debt | Credit-constrained FTBs | Low cash; mortgage insurance raises cost |
| USDA Rural Development | 0% | 29/41 ratios, income caps | Income-eligible rural buyers (Fruita qualifies) | 0% down, but strict income + site rules |

**The swing is large.** For the same Fruita home, a 100%-AMI household shows a **$132,515 gap** under the conservative model but a **$68,000 surplus** under the 20%-down/43%-DTI model. Break-even flips from **137% AMI to 88% AMI**. Same house, opposite conclusion.

> **Guardrail — read this.** A more permissive model (higher debt ratio, lower down payment) shows more buying power, but it does that by **putting more risk on the buyer** — a heavier monthly payment, thinner equity, and higher chance of default — and it may not pass a real lender or appraiser. "Best outcome" means *best matched to your real buyers*, not the model that shrinks the gap on paper. The tool will always show the buyer-risk note next to a permissive result and will never auto-pick the most generous model for you.

**Recommended use:** run the **conservative model as your planning baseline**, then compare the model your actual first-mortgage product uses (USDA/FHA/CHFA), and present the range. That is how a defensible study reports it.

---

## 4. The land decision — and the truth about "zero property tax"

For a housing-authority project, how you handle the **land** is one of the biggest non-cash levers on affordability. The tool compares four models:

- **A — Public land retention** (authority keeps the land; 99-year renewable ground lease; buyer owns the home; CLT-style stewardship).
- **B — Discounted lot conveyance** (lot sold below market with a permanent affordability covenant + recapture lien).
- **C — Full land sale** (affordability held only by deed restriction / subordinate loan; no ongoing public ownership).
- **D — Master ground lease** to a nonprofit/CLT/development entity.

**About zero property tax — the important nuance:** property owned by a housing authority is tax-exempt, but **that exemption ends the moment a home is sold outright (fee-simple) to a buyer** — the homeowner then pays normal property tax. You **cannot** have permanent zero property tax *and* fee-simple ownership. To carry a tax benefit into ownership you need a **retained-land structure** (Model A or D: authority/CLT keeps the land; the buyer owns the improvements and is taxed on a smaller base) or a **restricted-value assessment** (Colorado may assess deed-restricted homes at their restricted value — confirm with the Mesa County Assessor).

**What the tax break is worth (screening):** removing property tax raises a 100%-AMI buyer's maximum price by about **$30,000** and shrinks that per-unit gap from ~$132k to ~$102k. Add buyer assistance that removes mortgage insurance and the gap falls to about **$78k** — a ~40% reduction from *structure alone*, before any cash subsidy.

**Two cautions the tool surfaces:** a **metro-district mill levy** (Title 32) is itself a property tax and works against a zero-tax goal; and **tax-increment financing (TIF)** relies on rising taxable value, which tax-exempt public ownership suppresses. The tool shows these tensions rather than hiding them.

The **current Fruita hypothesis is Model A (authority retains land, 99-year ground lease)** — but the tool is built to *test* that against B/C/D, not assume it.

---

## 5. Funding — two stacks, and what "available" really means

The tool keeps **project-side** funding (reduces development cost) separate from **buyer-side** assistance (helps an individual household close), because they are governed differently and must never be double-counted.

- **Project-side:** public land contribution, ground-lease discount, fee/tap waivers, infrastructure, predevelopment support, HOA-reserve/stewardship startup, DOLA **Proposition 123** new-construction homeownership funds, FHLBank Topeka AHP, CHFA construction financing.
- **Buyer-side:** **HRWC** (Housing Resources of Western Colorado) deferred second mortgage, CHFA down-payment assistance, DOLA DPA, FHLBank Homeownership Set-Aside, employer assistance, USDA 502 direct/guaranteed first mortgages.

> **Availability ≠ money in the deal.** Every source carries a status: *available · anticipated · application pending · awarded · committed · expired · unverified.* **Only *awarded* or *committed* sources are counted** toward closing the gap. A program that merely *exists* is context, not funding. (Fruita's Prop 123, for example, already shows "Committed" in the data; HRWC availability does **not** by itself mean HRWC is committed to Fruita Commons — a project-specific award is required.)

Every source also shows its **source link and last-verified date**. Dollar terms that aren't confirmed on an official page render **"VERIFY"** rather than a made-up number.

---

## 6. The capital stack — four boxes that must reconcile

The project's money is organized into four non-overlapping categories, and the tool checks the arithmetic:

- **A — Land** (market value, contributed value, ground-lease discount, per-unit land subsidy)
- **B — Project development gap** (total cost − sales revenue − project grants − infrastructure = remaining project gap)
- **C — Buyer affordability gap** (contract price − first mortgage − buyer cash − subordinate assistance = remaining buyer gap)
- **D — Cash to close** (down payment + closing costs + prepaids + reserves − grants − buyer cash = remaining cash need)

**Reconciliation the tool enforces:** total development sources = total development uses; and for each buyer, contract price = first mortgage + subordinate assistance + grants + buyer cash. No source may appear in two boxes.

**Needs-based assistance:** the tool does **not** assume every one of the 50 homes gets the same help. Assistance is sized per household by AMI, price, income, first-mortgage capacity, and existing debt. Initial Fruita planning ranges (scenario ranges, **not** commitments): 70–80% AMI ≈ $75k–$110k; 80–90% ≈ $50k–$85k; 90–100% ≈ $25k–$60k; 100–120% ≈ $0–$35k. The tool then checks whether those levels are actually **stackable** within loan-to-value and program limits.

---

## 7. Shared equity, resale, and the homeowner's outcome

For a permanently affordable home, the **resale formula** decides how much wealth the owner keeps and how affordable the home stays for the next buyer. The tool compares models — fixed simple, fixed compound, AMI-indexed, CPI-indexed, lesser-of, shared-appreciation, CLT/ground-lease, and hybrids — at **5, 10, 20, and 30 years** under **low / base / high / flat / declining** markets.

For each it shows: buyer monthly cost and cash; public subsidy; owner equity and effective return; the next buyer's required income and subsidy; resale administration burden; and how durable the affordability is through a resale or foreclosure.

> **Honesty rule the tool follows:** it will **not** combine full public subsidy repayment with a large public appreciation share unless the owner's net proceeds stay clearly positive and transparent — because a formula can technically "preserve affordability" while leaving the homeowner with almost nothing. Preserving affordability longer is **not** automatically better; the tool shows the owner's outcome alongside the public's.

---

## 8. HOA and the costs people forget

HOA dues, ground rent, insurance, mortgage insurance, and possible special assessments **directly reduce** how much home a buyer can afford — they are treated as primary variables, not footnotes. Fruita is tested at an HOA of about **$175–$225/month**, plus higher-cost scenarios. The tool requires a **reserve study, reserve contribution, insurance assumptions, and a special-assessment risk view** — so a project can't look affordable only because future HOA costs were left out.

---

## 9. Effective demand and capture — and where the tool stops

The tool separates, and never blurs, four things: **ownership *need*** → **broadly *eligible* households** → **modeled *effective* demand** → **project *capture*.** It starts from observed census data (households, incomes, tenure) and applies **explicit, editable** reductions for household size, first-time-buyer status, down-payment and credit readiness, unit-type and location preference, shared-equity acceptance, purchase timing, and contract fallout. Every reduction is visible and labeled *modeled* — never mixed into the observed counts.

> **Where it stops (be clear-eyed).** Census data tells you the *pool*; it does **not** tell you who is mortgage-ready, has savings, or wants a townhome in Fruita. Credible demand, capture, and absorption for a real project require **primary research** — broker and lender input, comparable-project sales histories, migration data — and a for-sale competitive/pipeline inventory the tool does not yet have. So Tier-2 demand and capture are **screening-grade**, clearly labeled, and the tool tells you when to commission a professional market study. It will **not** invent an "acceptable capture rate" threshold.

---

## 10. How to read the labels

Every figure is tagged so you know how much to trust it:

- **Observed** — measured data used as published (census counts, HUD AMI).
- **Derived** — calculated from observed data by a documented method.
- **Modeled** — output of a formula/assumption (e.g. max affordable price).
- **User-entered** — you typed it (unit mix, TDC, HOA).
- **Not available** — no data; shown as unavailable, never as zero.

Funding and programs additionally carry a **commitment status** (§5). **Only *awarded* / *committed* counts as real money.**

---

## 11. A note on Fruita names

In Fruita materials, **"FHA" can mean two different things** — the **Fruita Housing Authority** (the public landowner/master developer) and the **Federal Housing Administration** (an insured mortgage product). The tool keeps these separate; when you see a land or stewardship reference it's the *Fruita Housing Authority*, and when you see a mortgage-product reference it's the *federal FHA loan*.

---

## 11b. Three things the tool will tell you about your jurisdiction

- **How strong your housing authority actually is.** Many Colorado housing authorities exist on paper only — no staff, no completed projects, no stewardship history. The tool labels each as *active developer/steward*, *administrative (delivers via partnership)*, or *nominal/paper*, with the evidence. If yours is thin, it says so and points to a path — a regional/multijurisdictional partner, a public-developer authority as co-developer, or a contracted steward (HRWC or a CLT). *Fruita Housing Authority delivered Fruita Mews through a partnership, so it is active-via-partnership — but its capacity to steward 50 for-sale homes in perpetuity alone is unproven and should be planned for, not assumed.*
- **Your rural vs urban designation and how to compete.** CHFA, DOLA, CDBG, and USDA classify jurisdictions as rural or urban, and that changes which funding pools, set-asides, cost limits, and buyer programs you can use. Rural is a *different lane, not a lower one* — it opens a rural set-aside and USDA financing but carries thinner local capacity and no direct CDBG/HOME. The tool shows your designation and a **competitiveness checklist**: adopt a current HNA (Prop 123 fast-track), file the Prop 123 commitment, build or partner for capacity, assemble local match, align the project to QAP scoring, and layer USDA/rural set-aside.
- **Every modeled number is flagged for verification.** The tool exposes its method for each figure (the formula, inputs, source, and model) — no black boxes — and marks every modeled/screening result with a **"verify via a true market study and stakeholder interviews"** note that names who must weigh in: **the developer, lender, appraiser, broker, program administrator, and local jurisdiction**. Treat a modeled number as a starting point for those conversations, not an answer.

## 12. What still needs a professional (do not skip)

The tool sizes and structures the deal; it does not replace these confirmations:

- **Lender** — debt ratios, mortgage-insurance rules, ground-lease/resale-restriction acceptance, product eligibility.
- **Appraiser** — how the restriction and ground lease affect appraised value and buyer financing.
- **Attorney** — enforceability of the deed restriction / ground lease / CLT, foreclosure survival, subordination, inheritance.
- **Program administrator (e.g. HRWC)** — capacity to counsel buyers, service loans, monitor occupancy, and administer resales permanently.
- **County assessor** — whether restricted-value assessment applies (the property-tax question).
- **Bond counsel / financial advisor** — any authority bond issuance and public-ownership tax treatment.

---

## 13. Quick start (once built)

1. Pick your jurisdiction (Tier 1) or open the project scenario (Tier 2, e.g. Fruita Commons).
2. Choose your affordability model(s) — start conservative, then compare your real loan product; read the implications panel.
3. Read the gap by AMI (§2). That's your target.
4. In Tier 2: set unit mix, costs, HOA, and land model; layer project-side then buyer-side funding (awarded/committed only counts).
5. Compare land-disposition and shared-equity models on the owner's *and* the public's outcome.
6. Review the screening-grade demand/capture — and note where a professional study is required.
7. Export the report with all source and confidence labels intact.

*Every output is a screening estimate. Verify local prices, financing, program terms, HOA/reserves, and deed-restriction policy before any decision.*
