# Market Trends Update Protocol

**Page:** `insights.html` — Key Market Trends — 2026  
**Update cadence:** First Monday of each month (aligned with HNA data refresh)  
**Owner:** COHO Analytics team  
**Last protocol review:** 2026-03-17

---

## Purpose

This document defines how to keep the **Key Market Trends — 2026** section on
the Insights page current, verified, and actionable. It also establishes criteria
for evaluating and adding new trend items.

---

## Monthly Verification Checklist

Complete on the **first Monday of each month**. Update `data/insights-meta.json`
after verification by setting `lastVerified` to today's ISO date.

### Trend 1 — Rising Investor Demand

**Data source:** Novogradac investor surveys  
**Check URL:** <https://www.novoco.com/resource-centers/affordable-housing-tax-credits>

- [ ] Open the latest Novogradac investor survey (Q1 2026 or most recent release)
- [ ] Verify YoY LIHTC allocation figures from major banks and insurance companies
- [ ] Update the percentage range in `insights.html` if it has shifted by ≥ 3 pp
- [ ] Update the quarter reference in the `trend-source` span (e.g. "Q4 2025" → "Q1 2026")
- [ ] Flag for revision if the narrative sentiment has reversed (demand falling, not rising)

**Staleness threshold:** 90 days — if the Novogradac source date is older than
90 days, add a ⚠️ warning note and schedule a refresh article.

---

### Trend 2 — Construction Cost Pressures

**Data sources:**  
- AGC Construction Cost Index: <https://www.agc.org/learn/construction-data/construction-inflation-alert>
- BLS Producer Price Index (PPI): <https://www.bls.gov/ppi>
- COHO FRED dashboard: `data/fred-data.json` series `WPUFD49207`, `PCU236115236115`

- [ ] Check latest AGC monthly inflation alert for overall materials trend
- [ ] Check BLS PPI release for construction inputs (`WPUFD49207`) — latest monthly figure
- [ ] Verify the narrative accurately describes current conditions (stabilizing, rising, or falling)
- [ ] If material costs are no longer stabilized, update the trend copy
- [ ] Check `data/fred-data.json` for the latest PPI observations; confirm updated timestamp

**Staleness threshold:** 35 days — PPI releases monthly; gap > 35 days in FRED data
triggers the FRED workflow alert (see `docs/alerts-pipeline.md`).

---

### Trend 3 — QAP Evolution

**Data sources:**  
- NCSHA QAP tracking: <https://www.ncsha.org/advocacy-issues/lihtc/>
- State HFA announcements (CHFA): <https://www.chfainfo.com/arhtf>

- [ ] Check NCSHA for any new QAP announcements since last month
- [ ] Check CHFA for Colorado-specific QAP scoring changes
- [ ] Verify the three priority areas named (climate resilience, transit access, ELI targeting)
  are still the dominant scoring trends nationally and in Colorado
- [ ] Update if a new priority area has emerged (e.g. disaster resilience, EV charging)
- [ ] Note any state that has released a draft 2027 QAP for early-mover signals

**Staleness threshold:** 90 days — QAP updates are typically annual; verify quarterly.

---

### Trend 4 — Mixed-Income Models Gain Traction

**Data sources:**  
- HUD LIHTC Database: <https://www.huduser.gov/portal/datasets/lihtc.html>
- CHFA allocation announcements: <https://www.chfainfo.com/arhtf/Awards>
- COHO LIHTC dashboard: `LIHTC-dashboard.html`

- [ ] Check HUD LIHTC Database for the latest year's project-type breakdown
- [ ] Verify that mixed-income (4%+9% blend or market-rate inclusion) projects represent
  a growing share of new allocations
- [ ] Review CHFA's most recent award round for Colorado mixed-income examples
- [ ] Update the trend description if the framing has shifted
  (e.g. from "gaining traction" to "now mainstream")

**Staleness threshold:** 180 days — HUD database updates annually; verify biannually.

---

## After Completing the Checklist

1. Update `data/insights-meta.json`:
   ```json
   {
     "lastVerified": "YYYY-MM-DD",
     "verifiedBy": "Your Name",
     "notes": "Optional notes about this month's review"
   }
   ```

2. Commit with message:
   `chore: verify Key Market Trends YYYY-MM`

3. If any trend copy was updated, also commit `insights.html` and note
   which trend changed in the commit message.

---

## Criteria for Adding New Trend Items

A new trend item should be added to the Key Market Trends section when **three
or more** of the following signals are present:

### Interest Rate / Financing Environment
- FRED data shows 10Y Treasury yield or mortgage rate shift ≥ 50 bps over 90 days
- Federal Reserve signals policy change (rate hold, cut, or hike)
- SOFR-based construction financing cost moves significantly
- Syndication market responds with pricing shift ≥ $0.03 per credit

**Check:** `data/fred-data.json` series `DGS10`, `MORTGAGE30US`, `DFF`, `SOFR`

### Tax Credit Pricing Movements
- Novogradac quarterly pricing report shows ≥ $0.05/credit move (9% or 4%)
- Investor appetite changes documented in syndicator surveys
- New corporate tax legislation affects credit value

**Check:** <https://www.novoco.com/resource-centers/affordable-housing-tax-credits>

### State QAP Timing Changes
- NCSHA reports a state moving its allocation cycle
- Colorado CHFA announces changes to scoring thresholds or set-asides
- New state adopts a policy that is spreading to other HFAs

**Check:** <https://www.ncsha.org/resource-center/qap/>

### Legislative Changes
- AHCIA (Affordable Housing Credit Improvement Act) provisions advance in Congress
- Housing for 21st Century Act implementation creates new requirements
- HOME program changes, FHA limit adjustments, or NEPA streamlining take effect

**Check:** <https://www.congress.gov>, Novogradac congressional tracker

### Regional Colorado Developments
- CHFA annual allocation round results published
- Denver/Boulder/Colorado Springs metro market report shows significant shift
- Prop 123 compliance cycle update or new jurisdictions opt in
- Colorado legislature passes housing legislation with LIHTC implications

**Check:** `data/car-market-report-*.json`, `data/chfa-lihtc.json`, CHFA website

---

## Retiring or Updating Existing Trends

A trend item should be **updated** when the supporting data materially changes
but the underlying dynamic persists.

A trend item should be **retired** (removed or archived) when:
- The underlying condition has normalized (e.g. construction costs fully stabilized)
- The trend has become so mainstream it is no longer "emerging" news
- The data source cited is no longer published or available
- A replacement trend better captures the current market signal

When retiring a trend, document it in `docs/SUGGESTED_ARTICLES.md` as a
completed topic — it may warrant a "wrap-up" analysis article.

---

## Escalation Path

| Condition | Action |
|-----------|--------|
| Source URL returns 404 | Find replacement source; update checklist |
| Data is > 90 days stale | Open GitHub issue tagged `data-staleness` |
| Trend narrative is materially wrong | Immediate update + commit |
| New major development (e.g. legislation passes) | Ad-hoc trend item or feature article |

---

## Related Resources

- **Article recommendation queue:** `docs/SUGGESTED_ARTICLES.md`
- **Alerts pipeline:** `docs/alerts-pipeline.md`
- **Data freshness dashboard:** `data-status.html`
- **Insights page:** `insights.html`
- **Policy briefs:** `policy-briefs.html`
