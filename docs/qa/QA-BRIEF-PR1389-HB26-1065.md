# QA Brief — PR #1389 (Track Colorado HB26-1065 in tax-credit watchlist)

**For:** Codex (independent QA reviewer)
**Author of the PR under review:** Claude Code — **role-inverted**: Claude authored the entry, so Codex QAs. **Do not trust the PR description, the commit message, or the entry's own `source_note`.** Verify every claim against primary sources by fetching them yourself.
**Branch:** `policy/hb26-1065-tiz-watchlist` · PR: https://github.com/pggLLC/Housing-Analytics/pull/1389
**Surface under review:** one added entry (`id: hb26-1065-transit-housing-investment-zones`) + a bumped `meta.last_updated` in `data/policy/tax-credit-legislation.json`. Nothing else.
**Verdict required:** end with exactly one of **PASS**, **PASS WITH FIXES REQUIRED** (list them), or **FAIL** (with evidence).

---

## 0. Ground rules

- This is a **factual-accuracy** review first, a conformance review second. The primary risk is that Claude mis-stated an enacted statute on a public-facing page. Assume nothing is right until a primary source confirms it.
- Read the whole diff: `git diff origin/main...policy/hb26-1065-tiz-watchlist`. The **only** permitted changes are (a) `meta.last_updated: 2026-07-18 → 2026-08-03` and (b) the single new entry object. **Any other change — another entry, a reordering, a `meta.last_verified`/`review_by`/`as_of` change, a whitespace reflow — is a finding.**
- Do not run `test:ci` broadly; this file has no generator that rewrites it. Targeted tests only (§2).

## 1. Primary-source verification (the core of this QA)

Fetch these yourself and confirm each field. Sources: Colorado General Assembly bill page `https://leg.colorado.gov/bills/HB26-1065`; the LLS **26-0227** fiscal note; at least one independent secondary (e.g. the Kaplan Kirsch law alert). If a source is unfetchable, say so — do **not** pass a field on faith.

- [ ] **Title / identity.** Bill is "Transit and Housing Investment Zones" (a.k.a. Transit Investment Area Act). Confirm the entry `title` is not misleading.
- [ ] **Status = enacted.** Confirm signed **2026-05-27**. (If it were still a bill, `status: enacted` would be wrong.)
- [ ] **`effective_date: 2026-08-12`** — confirm "most provisions effective" matches; flag if the credit specifically has a different effective date.
- [ ] **`sunset_date: 2063-12-31`** — confirm the act is repealed Dec 31, 2063 (not the credit-allocation end).
- [ ] **Credit dollars:** "up to **$8.33M/yr**, **2027–2033**, **$350M** over 12 yrs." Reconcile against the fiscal note's Table 2 (allocation vs claim years) — the $350M is spread across claim years **through 2038**, while *allocation* years are 2027–2033. Confirm the entry's phrasing isn't conflating the two. **This is the most likely place for an error.**
- [ ] **TIF guardrails:** EDC approves **max 3 projects/yr, 6 total**, **≤$75M diverted/yr**. Confirm all three numbers.
- [ ] **Administrator:** credit allocated by **CHFA**; owners are governmental/quasi-governmental and may sell credits; recapture applies. Confirm.
- [ ] **THE RURAL CLAIM (user-flagged, load-bearing).** The entry asserts there is **NO distinct or enhanced rural credit** in the enacted text or the 26-0227 fiscal note. **Independently attempt to falsify this.** Search the enacted text and fiscal note for "rural", "non-metro", "geographic", any rural set-aside/bonus/enhanced-credit language. If you find a distinct rural credit provision, that is a **FAIL** (the entry is wrong and the user specifically asked about it). If you confirm only geographic-diversity + rural-project-eligibility, the entry is correct.
- [ ] **The QAP-draft claim.** The entry says credit administration (CHFA QAP mechanics) is "not yet determined — QAP in draft." Confirm this is defensible (i.e., don't assert the QAP has finalized allocation mechanics for this credit). If the current QAP already specifies HB26-1065 administration, the caveat is stale — finding.

## 2. Schema & test conformance

```bash
node test/tax-credit-insights-data.test.js
node test/test_legislative_tracker.js
```
- [ ] Both green by exit code.
- [ ] `scope` ∈ {lihtc,nmtc,htc,itc-ptc,cra,homebuyer,oz} — entry uses `lihtc`. Is that the best fit, or should it be its own scope? (Judgment: `lihtc` renders under the LIHTC impact lane in `legislative-tracker.js`; a state transit-zone credit is defensible as `lihtc` but note if you disagree.)
- [ ] `status` ∈ allowed enum; `pricing_impact` length **≤ 280** (`node -e "console.log(require('./data/policy/tax-credit-legislation.json').entries.find(e=>e.id==='hb26-1065-transit-housing-investment-zones').pricing_impact.length)"` → must be ≤280).
- [ ] `source_url` matches the official-source regex in `tax-credit-insights-data.test.js` (leg.colorado.gov is allowlisted).
- [ ] `review_by` is ISO. Confirm `benchmark-freshness-check.mjs` still covers the file (it checks `reviewByPaths`).

## 3. Rendering / integration

- [ ] `housing-legislation-2026.html` calls `LegislativeTracker.loadLegislationData('data/policy/tax-credit-legislation.json')` and auto-renders all entries. Confirm the new entry normalizes cleanly (`_normalizeEntry`) and its `enacted` status renders as a signed/enacted pill, **not** "Failed" and **not** with a passage percentage (the tracker test already asserts this class of bug — confirm it still holds with the new entry present).
- [ ] JSON parses (`node -e "require('./data/policy/tax-credit-legislation.json')"`), no trailing-comma / encoding issues (note the em-dash `—` and `$` in the source_note — confirm valid UTF-8, no mojibake).

## 4. Out-of-scope confirmation

- [ ] No scoring/geometry code was added — this PR **tracks** the bill, it does not evaluate sites against it. Confirm no changes to `market-analysis.js`, the opportunity finder, or any scoring surface. (Site-level scoring is deliberately deferred to the 2026-10-30 OEDIT zone map.)
- [ ] No other watchlist entry was touched; no `scripts/`, workflow, robots/sitemap/CNAME change.

## 5. Report format

Findings ranked by severity, each with the field/line + the primary source that contradicts it (URL + quoted snippet). Then the single verdict line. If **PASS WITH FIXES REQUIRED**, list exact corrections (e.g. revised dollar phrasing); Claude applies them and you re-verify only the affected fields.
