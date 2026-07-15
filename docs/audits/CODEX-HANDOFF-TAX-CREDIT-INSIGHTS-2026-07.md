# Codex Handoff — Tax Credit Equity Markets + Homebuyer Programs (Insights)

**For:** Codex
**From:** Claude QA (deep-dive verified 2026-07-15)
**Sequencing:** STACK AFTER the current #1167 Tier 1 queue (regional ownership rows,
SF permits, B25075 — all merged or in flight). Do not start until your current
task list is clear. This is one feature arc; split into 2–3 PRs as noted below.

## Goal

Two living Insights surfaces that cannot silently rot:

1. **Tax Credit Equity Markets** (developer-side): LIHTC equity pricing history +
   forecast + Novogradac benchmark, extended to NMTC / HTC / ITC-PTC transfer
   pricing, with a legislation-watch layer rendered from data.
2. **Help for Homebuyers** (consumer-side, novice register): tax credits, grants,
   and down-payment assistance for home buyers/owners, rendered from data with
   status pills and freshness alarms.

Every factual claim below was independently verified on 2026-07-15. Where a fact
has a date, re-verify it at implementation time — that is the entire point of
this feature.

## Verified facts you may rely on (with sources)

### OBBBA (Pub. L. 119-21, signed 2025-07-04)

- LIHTC: **permanent 12% increase** in 9% ceiling from 2026 (per-capita
  $3.00 → $3.36, small-state minimum → $3.87M). NOT 12.5% — that was the old
  AHCIA ask. Source: https://www.novoco.com (blocked to bots; corroborated at
  https://www.nixonpeabody.com/insights/alerts/2025/07/16/low-income-housing-and-community-development-tax-credits-in-the-big-beautiful-bill
  and CRS RS22389).
- LIHTC: bond-financing test **50% → 25%** permanently for 4% deals, 2026+.
- Homeowner energy credits **§25C and §25D terminated** for property placed in
  service / expenditures after **2025-12-31**. Source (official):
  https://www.irs.gov/newsroom/faqs-for-modification-of-sections-25c-25d-25e-30c-30d-45l-45w-and-179d-under-public-law-119-21-139-stat-72-july-4-2025-commonly-known-as-the-one-big-beautiful-bill-obbb
- Wind/solar §45Y/§48E: projects must **begin construction by 2026-07-04**
  (physical-work test per IRS Notice 2025-42; 5% safe harbor disallowed except
  low-output solar) or be **placed in service by 2027-12-31**. Source:
  https://www.irs.gov/pub/irs-drop/n-25-42.pdf

### CRA status (verified via Federal Register API 2026-07-15)

- The 2023 CRA modernization rule **never took effect** — preliminary
  injunction 2024-03-29; banks are examined under the 1995/2021 framework.
- Interagency **NPR to rescind** the 2023 rule and reinstate the 1995
  regulations published **2025-07-18** (comments closed 2025-08-18):
  https://www.federalregister.gov/documents/2025/07/18/2025-13559/community-reinvestment-act-regulations
- **No final rescission rule exists as of 2026-07-15** (checked FR API for
  "Community Reinvestment Act Regulations" rules through 2026-07). Status =
  rule-pending. If a final rule has published by the time you implement,
  update accordingly and cite it.
- `cra-expansion-analysis.html` already carries an honest counterfactual
  disclaimer (line ~45) but **predates the rescission NPR** — its status
  paragraph must gain the NPR fact, sourced to the FR link above.

### Transfer market pricing (ITC/PTC, §6418)

- ITC transfers ~**$0.88–0.95**, PTC ~**$0.90–0.96** per credit dollar (PTC
  richer: no recapture risk). 2024 averages: ITC 92.5¢, PTC 95¢. Source:
  https://www.cruxclimate.com/insights/transferable-tax-credits (fetchable).

### Homebuyer programs (all URLs fetch-verified 200 on 2026-07-15)

- CHFA down payment assistance (grant up to a % of first mortgage + second
  mortgage option): https://www.chfainfo.com/homeownership/down-payment-assistance
  — CHFA's site **blocks plain curl; use a browser User-Agent** to verify.
- CHFA homeownership programs hub: https://www.chfainfo.com/homeownership
- metroDPA (Front Range down-payment assistance): https://metrodpa.org/
- CHAC homebuyer education + DPA loans: https://chaconline.org/
- Neighborhood Homes Investment Act: **H.R.2854 / S.1686, 119th Congress,
  in committee** (not enacted):
  https://www.congress.gov/bill/119th-congress/house-bill/2854
- Colorado senior / disabled-veteran homestead exemption: cite the CO
  Division of Property Taxation page (verify current URL at implementation).
- Do NOT list FHA/VA/USDA loan programs (financing, not credits/grants).
- Benefit dollar figures you cannot verify on an official page: value `null`,
  status `VERIFY`. Never estimate dollar figures in consumer copy.

## Known repo state (verified)

- `data/market/novogradac-equity-pricing.json` — Novogradac benchmark, vintage
  2026-Q2 (0.86 / 0.84 national), watched by
  `scripts/audit/benchmark-freshness-check.mjs`.
- `data/market/lihtc-equity-pricing-history.json` — 33 quarterly points
  2018-Q1 → 2026-Q1 (last: 0.87 / 0.85).
- `js/config/financial-constants.js` — **stale**: equityPrice9Pct 0.90 /
  equityPrice4Pct 0.85 labeled "Novogradac Q1 2026". Three files disagree.
- `js/components/equity-forecast-panel.js` — ARIMA(2,1,1) 8-quarter forecast,
  mounted only on deal-calculator.html; reusable.
- `js/legislative-tracker.js` — hardcoded bill data, lastUpdated 2026-01/02
  (~5 months stale), consumed by housing-legislation-2026.html. This is the
  anti-pattern this feature replaces: data embedded in JS with no alarm.
- `article-pricing.html` ("Tax Credit Pricing Reaches Historic Lows") and
  `cra-expansion-analysis.html` are already public and in sitemap.xml — no
  robots/sitemap/CNAME edits needed (those are deploy-gated; do not touch).
- `insights.html` links both pages.

## Work items

### PR A — data layer + drift fix

1. `data/policy/tax-credit-legislation.json`: entries with id, title, scope
   (`lihtc|nmtc|htc|itc-ptc|cra|homebuyer`), status
   (`enacted|proposed|rule-pending|phased-out|expired`), effective/sunset
   dates, pricing_impact (1–2 sentences), source_url (official only:
   congress.gov / federalregister.gov / irs.gov), last_verified, review_by.
   Seed with the verified facts above (OBBBA §42 ×2, OBBBA 25C/25D, OBBBA
   45Y/48E, CRA rescission NPR, §6418 transferability, NHIA).
2. `data/market/tax-credit-transfer-pricing.json`: curated cents-per-dollar
   snapshots for NMTC, federal HTC, ITC/PTC transfers — same shape/meta
   pattern as the Novogradac file (vintage, as_of, source, methodology).
   Novogradac blocks bots: curate manually from fetchable sources (Crux link
   above for ITC/PTC) and cite what you actually read.
3. Wire both files into `benchmark-freshness-check.mjs` review_by alarms.
4. **Pricing drift fix**: Deal Calculator loads current 9%/4% pricing from
   `novogradac-equity-pricing.json` at init; `financial-constants.js` values
   become offline fallback only, updated to 0.86/0.84; append a 2026-Q2 point
   to the history file consistent with the benchmark. NOTE FOR OWNER: this
   visibly changes deal outputs (~4¢/credit-dollar leaner) — it is the honest
   number.
5. Migrate `js/legislative-tracker.js` to read from
   `tax-credit-legislation.json` (keep its exported API so
   housing-legislation-2026.html keeps working; delete the embedded data).

### PR B — Tax Credit Equity Markets page

6. Upgrade `article-pricing.html` in place (same URL; retitle "Tax Credit
   Equity Markets"): LIHTC history chart + reuse equity-forecast-panel,
   Novogradac national/regional table, NMTC/HTC/ITC-PTC transfer snapshot,
   and a "Legislation watch" section rendered dynamically from
   tax-credit-legislation.json (status pills + last-verified dates).
7. Add the same legislation-watch component to `cra-expansion-analysis.html`
   and update its status paragraph with the rescission-NPR fact (FR link).
8. Feature both from `insights.html`.

### PR B (continued) — "How credit pricing works" explainer section

8a. The Equity Markets page must include an explainer that makes the pricing
    table interpretable — why a dollar of credit trades below (or above) a
    dollar, and why the four markets price differently. Render as a
    comparison matrix (one row per credit: LIHTC 9%/4%, HTC, NMTC, ITC, PTC)
    plus short prose. Dimensions, with the verified anchor facts:

    **Term / timing of the credit stream** (statutory — cite IRC sections):
    - LIHTC (§42): credits flow over **10 years**; compliance/recapture tail
      runs **15 years**. Long stream → pricing is rate-sensitive (discounted
      cash flow), which is why LIHTC pricing fell as rates rose 2022-2024.
    - HTC (§47): 20% of qualified rehab, claimed **ratably over 5 years**
      (post-TCJA rule).
    - NMTC (§45D): **39% over 7 years** (5% × 3 yrs, then 6% × 4 yrs).
    - ITC (§48/48E): **one-time** in the placed-in-service year, 5-year
      recapture exposure.
    - PTC (§45/45Y): per-kWh over **10 years**, follows actual production.
    Rule of thumb for the explainer: shorter, safer stream → closer to $1.00
    (PTC ~$0.90-0.96 > ITC ~$0.88-0.95 > 10-yr LIHTC ~$0.85-0.90).

    **Transferability** (this is the structural divide):
    - Energy credits (ITC/PTC) are **transferable for cash under §6418**
      (IRA, 2023+): a simple sale, broad buyer pool, low transaction cost.
    - LIHTC, HTC, NMTC are **NOT transferable** — the investor must own an
      equity interest (partnership syndication), which means higher
      transaction/legal cost, longer holds, and a narrower buyer pool. This
      is a demand-side headwind worth stating: corporate tax capacity that
      once had to buy LIHTC funds can now buy simpler transferable energy
      credits instead (though OBBBA's 45Y/48E phase-outs will shrink that
      competing supply after 2027).
    - §6417 **direct pay** lets tax-exempts/governments claim energy credits
      as cash — irrelevant to LIHTC, worth one line so novices don't confuse
      the two.

    **Tax treatment of the trade** (the "taxable vs not taxable" layer —
    verify against IRS §6418 guidance before publishing):
    - §6418 transfer proceeds are **excluded from the seller's income**, and
      the buyer's discount (paying $0.92 for $1.00 of credit) is **not taxed
      as income** — the spread is the buyer's return.
    - All of these are **nonrefundable** credits against federal tax
      liability — a buyer needs tax appetite; none of the developer-side
      credits are refundable checks.
    - Syndicated credits (LIHTC/HTC) come **bundled with depreciation
      losses** through the partnership — part of what the investor pays for
      beyond the credit itself, and why LIHTC pricing can exceed the pure
      credit DCF (and historically topped $1.00 in hot CRA markets).

    **Supply and demand factors** (each one should cross-link to the
    legislation-watch entry that moves it):
    - Supply side: 9% LIHTC ceiling (+12% from 2026 per OBBBA), 4% volume
      driven by the private-activity-bond cap and the new 25% bond test
      (both expand credit supply → pricing pressure down), NMTC allocation
      rounds (CDFI Fund), HTC pipeline, and energy-credit volume (post-IRA
      surge, then OBBBA 45Y/48E phase-outs shrinking it).
    - Demand side: **CRA-motivated banks are the dominant LIHTC buyer** —
      which is why regional pricing tracks CRA assessment-area demand
      (Novogradac's regional spreads: NYC/Boston price 3-5¢ above national)
      and why the CRA rescission NPR is a pricing story, not just a
      compliance story. Also: corporate profitability/tax capacity, the
      corporate tax rate (a lower rate cuts the value of tax shelter),
      insurance-company appetite, and Fannie/Freddie's LIHTC equity caps
      ($2B each/yr per FHFA, half reserved for difficult-to-serve markets).
    Keep this section novice-legible: every driver gets one plain-English
    sentence on *which direction* it pushes cents-per-dollar and *why*.

    Test guard: the matrix renders one row per credit type from a data
    object (not hardcoded HTML per cell), and the explainer section's
    statutory anchors (10-yr/15-yr LIHTC, 5-yr HTC, 39%/7-yr NMTC) appear —
    non-vacuous: removing a matrix row or the §6418 exclusion sentence must
    fail.

### PR C — Help for Homebuyers (novice register)

9. `data/policy/homeownership-programs.json`: id, name, level
   (`federal|colorado|metro`), kind
   (`tax-credit|grant|dpa-loan|property-tax-relief`), plain_summary (2–3
   sentences a first-time buyer understands, **under ~60 words**),
   how_to_start (one sentence + official link), status
   (`active|expired|proposed`), dates, source_url, last_verified, review_by.
   Seed: CHFA DPA grant + second mortgage, CHFA FirstStep/SmartStep (loans —
   included because DPA attaches), CHFA MCC, metroDPA, CHAC, CO homestead
   exemption, 25C/25D as worked EXPIRED examples, NHIA as PROPOSED.
10. New Insights section/page rendered from that JSON: one card per program —
    What it is / Who it's for / What it's worth / How to start / status pill +
    last-verified date; grouped Federal / Colorado / Metro; define AMI, DPA,
    credit-vs-deduction inline on first use (reuse data/glossary.json).
    Prominent disclaimer: informational only, not financial or tax advice;
    program terms change; confirm with the program administrator or a
    HUD-approved housing counselor (link CHFA's counselor page).
11. Wire into the same freshness alarm; link from insights.html.

### Tests (each PR)

- jsdom render guards, non-vacuous: emptying each JSON must fail its page test.
- Every legislation/program entry: official https source_url + unexpired
  review_by (or the freshness checker flags it).
- Deal Calculator prefers benchmark pricing over fallback constant when the
  file loads (and falls back cleanly when fetch fails).
- plain_summary length guard (~60 words) to enforce the novice register.
- **Fixture URLs must be loopback (`http://127.0.0.1/...`)** — the CI URL
  sweep probes literal URLs in changed files and hard-fails synthetic hosts
  (bit PRs #1202, #1207, #1209).

## Hard rules

- No fabricated numbers or program terms, anywhere. Every figure traces to a
  cited source you actually fetched. Unverifiable → null + VERIFY.
- Novogradac and CHFA block bots (CHFA yields to a browser User-Agent;
  Novogradac does not — cite it as the named source of a curated snapshot,
  and corroborate values from fetchable sources).
- Do not touch robots.txt / sitemap.xml / CNAME.
- Consumer-facing plain_summary copy ships only after the owner reads the
  rendered cards — flag this in the PR description ("owner copy review
  requested").
- External QA (Claude) will fetch-verify every seeded source URL and figure
  at PR review; write for that audit.
