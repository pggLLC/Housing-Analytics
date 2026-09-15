/**
 * js/config/financial-constants.js
 * Centralized financial assumptions and constants for COHO Analytics.
 *
 * All rate-sensitive defaults should live here so they can be updated
 * once when market conditions change, rather than scattered across
 * 6+ files.
 *
 * Last reviewed: 2026-07-15
 * Sources noted inline.
 */
(function () {
  'use strict';

  var COHO_DEFAULTS = {

    // ── LIHTC Credit Rates ──────────────────────────────────────────
    // IRC §42(b) applicable percentages — these are statutory, not market.
    creditRate9Pct: 0.09,          // 9% LIHTC (competitive allocation)
    creditRate4Pct: 0.04,          // 4% LIHTC (bond-financed)

    // ── Equity Pricing ──────────────────────────────────────────────
    // Investor pricing per $1 of annual credit.
    // Offline fallback only; Deal Calculator soft-loads
    // data/market/novogradac-equity-pricing.json at init when available.
    // Source: Novogradac LIHTC equity benchmark, Q2 2026
    equityPrice9Pct: 0.86,         // 9% deals (national average)
    equityPrice4Pct: 0.84,         // 4%/bond deals (national average)

    // ── AMI Rent Limits (county-resolved) ──────────────────────────
    // AMI-indexed rent limits MUST come from HudFmr.getGrossRentLimit(fips, pct)
    // — there is intentionally NO statewide fallback. Colorado 4-person AMI
    // ranges from ~$52k (Alamosa) to ~$124k (Denver MSA); a Denver-MSA
    // default silently over-stated rents by up to 64% for ~56 non-metro
    // counties. Callers must handle "no county selected" explicitly.
    // (Removed: defaultAmiLimits {30:930, 40:1240, 50:1550, 60:1860})

    // ── Mortgage & Financing ────────────────────────────────────────
    // Source: Freddie Mac PMMS, Q1 2026 (~7.0% 30-yr fixed)
    mortgageRate:     0.07,        // residential (homeownership analysis)
    commercialRate:   0.065,       // commercial / LIHTC perm loan assumption
    mortgageTermYr:   30,          // standard residential term
    commercialTermYr: 35,          // LIHTC perm loan term
    loanAmortYr:      35,          // amortization period

    // ── Homeownership Affordability ─────────────────────────────────
    //
    // SCOPE — read before using any of these.
    //
    // These are NOT the HNA ownership model. That authority is
    // data/policy/affordability-models.json, read through
    // js/hna/ownership-finance.js, which defines seven models whose default
    // (conservative_screening) screens at a 30% FRONT-end ratio. The values
    // here serve the deal-calculator and rent-vs-buy surfaces, which answer a
    // different question, and they deliberately differ:
    //
    //   downPaymentPct  0.05 here | 0.10 in the HNA path
    //   propertyTaxRate 0.006 here | 0.0065 in the HNA path
    //   insurance       DOLLARS here | a RATE OF VALUE in the HNA path
    //
    // That last one is a UNIT difference, not a value difference.
    // insuranceAnnual is flat annual dollars; js/hna/ownership-finance.js uses
    // insuranceRate as a fraction of home value (0.0035). Substituting one for
    // the other produces a monthly payment wrong by a factor that depends on
    // price — on a $250,000 home the flat figure is ~2.7x the rate-based one,
    // and they cross near $686,000. Convert deliberately; never copy across.
    //
    // test/affordability-defaults-inventory.test.js pins every one of these and
    // fails if a new competing default appears anywhere in js/.
    //
    // Source: Standard underwriting guidelines
    downPaymentPct:   0.05,        // 5% conventional minimum
    housingCostPct:   0.30,        // 30% of gross income max
    maxDtiRatio:      0.43,        // 43% back-end DTI (QM safe harbor)

    // ── Colorado Property Costs ─────────────────────────────────────
    // Source: Colorado Dept of Local Affairs, 2024 mill levy data
    propertyTaxRate:  0.006,       // ~0.6% effective rate (CO avg)
    insuranceAnnual:  2400,        // annual homeowner insurance ($)

    // ── LIHTC Development Assumptions ───────────────────────────────
    // Source: CHFA QAP 2025 / industry benchmarks
    eligibleBasisPct: 0.80,        // share of TDC that counts as eligible basis
    dcrMinimum:       1.20,        // debt coverage ratio floor

    // ── Data Source Metadata ────────────────────────────────────────
    acsVintage:       '2024',      // ACS 5-year estimates vintage (2025 pending Census release)
    acsYear:          '2024',      // for display labels
    hudFmrYear:       'FY2025',    // HUD FMR fiscal year — FY2026 not yet published
    dolaProjectionYr: '2050',      // DOLA population projection horizon
    lastReviewDate:   '2026-07-15',
  };

  // Freeze to prevent accidental mutation
  if (Object.freeze) Object.freeze(COHO_DEFAULTS);

  window.COHO_DEFAULTS = COHO_DEFAULTS;
})();
