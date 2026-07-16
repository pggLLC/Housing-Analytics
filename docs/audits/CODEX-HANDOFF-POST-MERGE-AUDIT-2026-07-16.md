# Codex Handoff — Post-Merge Audit After #1220–#1222 (Tax Credit Insights arc)

**For:** Codex
**From:** Claude QA (audit run 2026-07-16, against main `4d255dbaf` and production)
**Scope audited:** tax-credit equity markets, Help for Homebuyers, Insights
navigation, deployed rendering, data/source freshness, automated post-merge
commits. Audit only — this doc specifies fixes; it implements none.

## Verified healthy (no action)

- All three merges intact on main; the post-merge quarantine/audit commits
  touched only inventory docs and flagged nothing from the arc (0 quarantine
  candidates).
- **Production is current**: all four pages (article-pricing,
  help-for-homebuyers, cra-expansion-analysis, housing-legislation-2026) and
  all three data artifacts serve 200 on cohoanalytics.com with full entry
  counts (8/5/11). The one cancelled deploy run was #1207's
  cancel-in-progress superseding an older run — working as designed.
- `benchmark-freshness-check`: 5/5 files within cadence. All five arc test
  suites + validate pass on main.

## Findings, prioritized

### A1 (P0 — factual error on a public page): H.R. 6644 became law 2026-07-11

The **21st Century ROAD to Housing Act was enacted on July 11, 2026** (became
law without the President's signature after the 10-day period; Senate passed
89-10 on 2026-03-12, House concurrence 2026-05-20). Sources to verify from:
https://www.govtrack.us/congress/bills/119/hr6644 and the House Financial
Services announcement; cite the enacted/PLAW text once assigned.

`housing-legislation-2026.html` currently states the opposite, five days
after enactment:

- `<title>`/H1: "H.R. 6644 — Status Update"; meta description ends "now back
  in Senate"; page-meta says "awaiting further Senate action".
- Body prose (~line 92): "sending comprehensive housing reform to conference
  committee… high likelihood of passage by mid-2026"; (~line 131): "The bill
  now enters conference committee… making a Q2 2026 passage realistic."
- Line ~145 cites **118th**-congress H.R.6644 (wrong congress; line 69 has
  the correct 119th link).
- `data/policy/tax-credit-legislation.json` has **no ROAD Act entry**, so the
  new watchlist renders next to stale prose it contradicts.

**Fix (PR 1):**
1. Verify the enacted bill's housing/LIHTC-relevant provisions from the
   enrolled/PLAW text (do NOT carry over the page's old claims about AHCIA
   provisions — the enacted compromise must be read, not assumed; anything
   unverified is omitted, not guessed).
2. Rewrite the page to enacted status: title/meta/H1/page-meta/prose/timeline;
   fix the 118th→119th link.
3. Add an `hr6644-road-act` entry to `tax-credit-legislation.json`
   (status `enacted`, effective 2026-07-11, scope per verified content,
   official source_url, last_verified/review_by).
4. Tests: extend `test/test_legislative_tracker.js` page-render guard to
   assert the ROAD entry renders and that the strings "awaiting further
   Senate action" and "conference committee" no longer appear on the page;
   extend `test/tax-credit-insights-data.test.js` required-IDs list.
   Non-vacuous both directions (remove entry → fail; reintroduce stale
   string → fail).

### A2 (P1 — discoverability + deploy gate): help-for-homebuyers.html not in sitemap or nav

The new public page is absent from `sitemap.xml` (every sibling insights page
is present) and from `sitemap.html`; its only inbound link is one insights
card. This suppresses indexing of the arc's most consumer-relevant page.

**Fix (PR 2 — follow the deploy-gate protocol exactly):**
1. `test/pages-availability-check.js` is a **pinned-assertion deploy gate**
   (it also runs in deploy.yml). Update the sitemap URL-count assertions and
   any page lists FIRST, run `node test/pages-availability-check.js` locally
   against the edited sitemap, and only then commit — this gate has silently
   broken deploys before when sitemap edits skipped it.
2. Add `https://cohoanalytics.com/help-for-homebuyers.html` to `sitemap.xml`;
   add the page to `sitemap.html`'s human index; consider a "Data" or
   "Insights" nav dropdown entry in `js/navigation.js` (owner's call — flag
   in PR description rather than deciding silently).
3. Do not touch robots.txt or CNAME.

### A3 (P1 — pricing consistency): third pricing authority feeds the Deal Predictor

PR A unified the Deal Calculator + `financial-constants.js` on the Novogradac
benchmark (0.86/0.84), but `js/lihtc-deal-predictor.js` loads
`data/policy/lihtc-assumptions.json`, which carries **0.87/0.85, sourced
"CHFA syndication market, March 2026"**, no meta, no freshness wiring; the
predictor's inline fallbacks (0.87/0.85) also differ from the constants
(0.86/0.84). Result: Calculator and Predictor quote different equity pricing
for the same deal today, drifting further at the next benchmark update.

**Fix (PR 3):**
1. Have the predictor consume the same
   `data/market/novogradac-equity-pricing.json` national averages at init
   (reuse the calculator's pattern), demote `lihtc-assumptions.json`
   equityPricing to offline fallback and sync its values (or remove the
   field and fall back to `financial-constants.js`; pick one authority and
   say so in the file).
2. Align the inline fallback literals with `financial-constants.js`.
3. Add meta (as_of, source, review_by) to `lihtc-assumptions.json` and wire
   it into `benchmark-freshness-check.mjs` — it holds hard costs and dev-fee
   assumptions that also age.
4. Test: parity assertion — with the benchmark file present, Calculator and
   Predictor resolve identical 9%/4% defaults; with fetch failing, both fall
   back to the same constants. Non-vacuous: skewing the assumptions file's
   pricing must fail.

### A4 (P3 — label drift): CRA scenario chart cites a Q1 2026 baseline

`cra-expansion-analysis.html` (~line 80) labels the scenario chart
"Novogradac pricing (Q1 2026 baseline) → Q4 2027 projection" while the
benchmark powering the rest of the arc is Q2 2026 (0.86/0.84), and the chart
labels (~line 282) start at quarters now in the past. Refresh the modeled
series' baseline to the Q2 benchmark, update data-source/data-vintage attrs,
and shift the label axis to start at the current quarter. Keep the QUAL
badge/author-estimate framing. Small, isolated; can ride with PR 1.

## Recommended sequencing

1. **PR 1 (A1 + A4)** — public factual correction; highest urgency, no
   dependencies. Requires fresh verification of the enacted ROAD Act text.
2. **PR 2 (A2)** — sitemap/nav; independent of PR 1; deploy-gate protocol.
3. **PR 3 (A3)** — pricing unification; independent; touches deal-predictor
   only (no collision with the deal-calculator surface at rest).

Nothing here blocks the other; PRs may land in any order, but the numbering
reflects user-facing severity. Each PR: `Refs #1218` + this doc; external QA
(Claude) will re-verify the enacted-bill claims against primary sources, the
sitemap gate, and calculator/predictor parity at review.

## QA gates per PR (what external QA will run)

- PR 1: fetch-verify ROAD Act status + every new source URL; jsdom render of
  the page (no stale strings, watchlist includes the entry); sabotage both
  directions; full arc suites.
- PR 2: `node test/pages-availability-check.js` at the PR head; sitemap URL
  count matches the assertion; production URL spot-check post-merge.
- PR 3: parity test sabotage (skew assumptions file → fail); freshness audit
  reads the new meta; browser check that predictor and calculator quote the
  same defaults.

## Hard rules (unchanged from the arc handoff)

- No fabricated figures; anything unverifiable is null + VERIFY.
- Test fixture URLs are loopback only (CI sweep probes literals).
- robots.txt/CNAME untouched; sitemap only via the pinned-test protocol above.
- congress.gov WAF-blocks bots — verify bill text via govinfo/GovTrack
  mirrors and cite what you actually read.
