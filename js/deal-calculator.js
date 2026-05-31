(function () {
  'use strict';

  // Financial defaults from centralized config (js/config/financial-constants.js).
  // Populated when HudFmr loads and a county is selected. AMI rent limits
  // are INTENTIONALLY null until the user picks a county — CO AMI ranges
  // from ~$52k (rural) to ~$124k (Denver MSA), so a one-size-fits-all
  // default (e.g. Denver MSA at 60% = $1,860) mis-states feasibility for
  // the majority of CO counties. Rent inputs render as placeholders until
  // county resolution populates real values.
  var _cfg = window.COHO_DEFAULTS || {};
  var _amiLimits = null;       // legacy flat: { 30: $$, 40: $$, ... } (= 2BR ceiling per tier)
  var _amiLimitsByBr = null;   // P7: { 30: { studio, 1br, 2br, 3br, 4br }, ... }
  var _countyFips = null;   // 5-digit FIPS of the currently selected county
  var _creditRate = _cfg.creditRate9Pct || 0.09;
  var EQUITY_PRICE_DEFAULT = _cfg.equityPrice9Pct || 0.90;
  var _amiGapData = null;       // cached co_ami_gap_by_county.json
  var _amiGapPlaceData = null;  // F45: cached co_ami_gap_by_place.json
  var _pabByGeoid = null;   // F25: PAB direct allocations (county FIPS / place geoid)
  var _pabMeta = null;      // F25: PAB allocations metadata
  // Q5: Zillow ZORI market-rent index (smoothed, seasonally-adjusted, monthly).
  // Used for the "achievable-rent cap" toggle that under-writes 70/80/100% AMI
  // units at min(LIHTC ceiling, market rent) in weak markets where the LIHTC
  // ceiling on workforce tiers exceeds what the local market will actually
  // pay. See docs/MARKET-RENT-AND-KALSHI.md for the rationale.
  var _zoriData = null;     // cached zori_rents_co.json
  const CREDIT_YEARS = 10;

  // -------------------------------------------------------------------
  // Tunable constants — shown in the Methodology & Formulas panel and
  // editable by users (bankers/syndicators with non-standard underwriting
  // boxes). Defaults mirror standard LIHTC industry practice; deviating
  // is appropriate when, e.g., a particular bank or program uses a 28%
  // rent burden, a -8% rent stress, or different combined-stress
  // assumptions. All values are stored in their natural units:
  //   rentBurdenPct, *StressPct       — fractional (0.30 = 30 %)
  //   *StressPp                        — percentage points (0.05 = 5 pp)
  // -------------------------------------------------------------------
  var DEFAULT_CONSTANTS = {
    rentBurdenPct:   0.30,   // HUD-standard share of income spent on rent
    rentStressPct:   0.10,   // single-variable: -10% to gross rent
    vacStressPp:     0.05,   // single-variable: +5 pp to vacancy
    opexStressPct:   0.10,   // single-variable: +10% to operating expenses
    combinedRentPct: 0.05,   // combined-scenario: -5% to gross rent
    combinedVacPp:   0.03,   // combined-scenario: +3 pp to vacancy
    combinedOpexPct: 0.05    // combined-scenario: +5% to operating expenses
  };
  var _constants = Object.assign({}, DEFAULT_CONSTANTS);

  // -------------------------------------------------------------------
  // Mortgage constant helper
  // Annual mortgage constant for a fully-amortising loan.
  // -------------------------------------------------------------------
  function mortgageConstant(annualRate, termYears) {
    var monthlyRate = annualRate / 12;
    var totalMonths = termYears * 12;
    if (monthlyRate <= 0 || totalMonths <= 0) return 0;
    var factor = Math.pow(1 + monthlyRate, totalMonths);
    return (monthlyRate * factor / (factor - 1)) * 12;
  }

  // -------------------------------------------------------------------
  // Peer-deals filter (pure function, testable)
  //
  // Filters HUD LIHTC database features (716 CO projects) to the most
  // useful peer set for a banker/syndicator sanity-checking a proforma:
  //   1. Same county (CNTY_FIPS match)
  //   2. Same credit type ('9%' or '4%')
  //   3. Sort by recency (most recent placed-in-service first), then
  //      by size proximity to the proposed unit count
  //   4. Take top N (default 5)
  //
  // Returns an empty array when no county is selected or no matches.
  // Never returns synthesized records.
  //
  // Notes:
  //   - HUD LIHTC DB does NOT publish per-project TDC, so peer comps
  //     here are units / year / QCT-DDA / non-profit flags only. AMI
  //     targeting comes from the optional NHPD lookup when available.
  //   - The filter normalises CREDIT field variants ("9%", "9 %", "9").
  // -------------------------------------------------------------------
  function findPeerDeals(opts) {
    opts = opts || {};
    var features      = Array.isArray(opts.features) ? opts.features : [];
    var countyFips    = opts.countyFips ? String(opts.countyFips).padStart(5, '0') : null;
    var creditTypeRaw = opts.creditType || null;
    var proposedUnits = +opts.proposedUnits || 0;
    var limit         = +opts.limit || 5;

    if (!countyFips || features.length === 0) return [];

    function _normCredit(s) {
      if (!s) return null;
      var t = String(s).replace(/\s+/g, '').replace('%', '').trim();
      // "9" or "9pct" → "9%"
      if (/^9/.test(t)) return '9%';
      if (/^4/.test(t)) return '4%';
      return null;
    }
    var creditNorm = _normCredit(creditTypeRaw);

    var filtered = features.filter(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      if (!p) return false;
      var fips = String(p.CNTY_FIPS || p.cnty_fips || '').padStart(5, '0');
      if (fips !== countyFips) return false;
      if (creditNorm) {
        var fCredit = _normCredit(p.CREDIT || p.CREDIT_PCT || p.creditType);
        if (fCredit && fCredit !== creditNorm) return false;
      }
      return true;
    });

    // Reject HUD sentinel years (8888 = "unknown YR_PIS", 9999 = unknown
    // award) and clamp to the plausible LIHTC range (1986-2030). Without
    // this guard, sentinel rows sort to the top as "most recent" and
    // contaminate the comparable-projects panel.
    function _safeYear(p) {
      var raw = parseInt(p.YR_PIS || p.YEAR_PIS || p.YR_ALLOC || p.YEAR_ALLOC || 0, 10);
      if (!Number.isFinite(raw) || raw < 1986 || raw > 2030) return 0;
      return raw;
    }
    filtered.sort(function (a, b) {
      var pa = (a && a.properties) ? a.properties : a;
      var pb = (b && b.properties) ? b.properties : b;
      var yA = _safeYear(pa);
      var yB = _safeYear(pb);
      if (yA !== yB) return yB - yA; // most recent first
      if (proposedUnits > 0) {
        var uA = parseInt(pa.N_UNITS || pa.LI_UNITS || pa.TOTAL_UNITS || 0, 10) || 0;
        var uB = parseInt(pb.N_UNITS || pb.LI_UNITS || pb.TOTAL_UNITS || 0, 10) || 0;
        return Math.abs(uA - proposedUnits) - Math.abs(uB - proposedUnits);
      }
      return 0;
    });

    return filtered.slice(0, limit).map(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      return {
        name:       p.PROJECT_NAME || p.PROJECT || p.projectName || 'Unknown',
        city:       p.CITY || p.PROJ_CTY || p.city || '',
        county:     p.CNTY_NAME || p.cnty_name || '',
        countyFips: String(p.CNTY_FIPS || '').padStart(5, '0'),
        units:      parseInt(p.N_UNITS || p.TOTAL_UNITS || 0, 10) || 0,
        liUnits:    parseInt(p.LI_UNITS || 0, 10) || 0,
        creditType: _normCredit(p.CREDIT || p.CREDIT_PCT) || '—',
        yearPis:    (function () { var y = parseInt(p.YR_PIS || p.YEAR_PIS || 0, 10); return Number.isFinite(y) && y >= 1986 && y <= 2030 ? y : null; })(),
        yearAlloc:  (function () { var y = parseInt(p.YR_ALLOC || p.YEAR_ALLOC || 0, 10); return Number.isFinite(y) && y >= 1986 && y <= 2030 ? y : null; })(),
        isQct:      p.QCT === '1' || p.QCT === 1 || p.isQct === true,
        isDda:      p.DDA === '1' || p.DDA === 1 || p.isDda === true,
        isNonProf:  p.NON_PROF === '1' || p.NON_PROF === 1 || p.NON_PROF === '2' || p.NON_PROF === 2
      };
    });
  }

  // -------------------------------------------------------------------
  // Rent-achievability check (pure function, testable)
  //
  // Compares the LIHTC rent ceiling at each AMI tier to HUD FMR 2BR
  // for the selected county. Answers the banker/syndicator question:
  // "will the LIHTC ceiling rents actually clear the market, or is
  //  the proforma over-stated because the ceiling is above market?"
  //
  // Status thresholds (rule-of-thumb for banker review):
  //   gap ≤ 0     clear       — LIHTC ceiling at/below market, achievable
  //   gap ≤ $50   tight       — close to market, thin buffer
  //   gap ≤ $200  concerning  — ceiling meaningfully above market
  //   gap > $200  misaligned  — proforma at ceiling likely overstates revenue
  //
  // Positive gap = LIHTC ceiling > market rent (concerning).
  // Negative gap = LIHTC ceiling < market rent (good — ceiling is binding).
  //
  // Uses HUD FMR 2BR as the market benchmark because most LIHTC projects
  // are 2BR-dominated. A future refinement could weight by the project's
  // actual bedroom mix.
  //
  // Inputs:
  //   amiLimits — { 30: 931, 40: 1241, 50: 1551, 60: 1862 } monthly $USD
  //   fmr       — { efficiency, one_br, two_br, three_br, four_br } monthly $USD
  //
  // Returns null when data isn't available (county not selected, FMR 2BR
  // missing, or no AMI tier rent limits).
  // -------------------------------------------------------------------
  function computeRentAchievability(inputs) {
    if (!inputs || !inputs.amiLimits || !inputs.fmr) return null;
    var fmr = inputs.fmr;
    if (typeof fmr.two_br !== 'number' || fmr.two_br <= 0) return null;
    var fmr2br = fmr.two_br;

    function _status(gap) {
      if (gap <= 0)   return 'clear';
      if (gap <= 50)  return 'tight';
      if (gap <= 200) return 'concerning';
      return 'misaligned';
    }

    var tiers = [30, 40, 50, 60]
      .filter(function (p) { return typeof inputs.amiLimits[p] === 'number' && inputs.amiLimits[p] > 0; })
      .map(function (pct) {
        var ceiling = inputs.amiLimits[pct];
        var gap = ceiling - fmr2br;
        return {
          pct:     pct,
          ceiling: ceiling,
          fmr2br:  fmr2br,
          gap:     gap,
          status:  _status(gap)
        };
      });

    if (tiers.length === 0) return null;
    return { tiers: tiers, fmr: fmr };
  }

  // -------------------------------------------------------------------
  // Q5: Zillow ZORI market-rent lookup (pure helper, testable).
  //
  // ZORI is a smoothed, seasonally-adjusted index of typical asking rents
  // across Zillow's listing platform (35th-65th percentile, "typical
  // market rent"). It updates monthly and is closer to median market rent
  // than HUD FMR (a 40th-pctile floor lagged 2-3 years).
  //
  // The OF "Capture" column uses HUD FMR, which often understates rents
  // in rural / off-metro markets and over-states them in tight markets
  // that have cooled fast. ZORI is the correction.
  //
  // For the Deal Calc's achievable-rent cap, we look up the county-level
  // ZORI value and scale it per-BR using HUD FMR ratios (because ZORI
  // does NOT publish a per-BR breakdown — it's a single all-bedroom
  // index). The 2BR FMR is the anchor; other BRs are scaled by
  // (fmr_br / fmr_2br).
  //
  // Returns:
  //   { rent, vintage_month, name }       — county ZORI base
  //   null                                  — county not in ZORI dataset
  // -------------------------------------------------------------------
  function getZoriCountyRent(fips) {
    if (!_zoriData || !_zoriData.counties || !fips) return null;
    var rec = _zoriData.counties[String(fips).padStart(5, '0')];
    if (!rec || !rec.rent) return null;
    return {
      rent:          rec.rent,
      vintage_month: rec.vintage_month || (_zoriData.meta && _zoriData.meta.vintage_month) || null,
      name:          rec.name,
      yoy:           rec.yoy_change_pct
    };
  }

  /**
   * Q5: Per-BR ZORI market rent estimate.
   *
   * ZORI publishes a single all-bedroom index per county. We scale to
   * per-BR by applying the HUD FMR per-BR ratio (fmr_br / fmr_2br) to
   * the ZORI value. This preserves the ZORI level while reflecting the
   * county's actual BR-to-BR rent spread.
   *
   * Returns { studio, '1br', '2br', '3br', '4br' } or null when either
   * ZORI county data or HUD FMR for the county is missing.
   */
  function getZoriPerBrRent(fips) {
    var zori = getZoriCountyRent(fips);
    if (!zori) return null;
    var hudFmr = window.HudFmr;
    if (!hudFmr || typeof hudFmr.getFmrByFips !== 'function') return null;
    var fmr = hudFmr.getFmrByFips(fips);
    if (!fmr || !fmr.two_br || fmr.two_br <= 0) return null;
    var base = zori.rent;
    return {
      'studio': Math.round(base * (fmr.efficiency || fmr.two_br * 0.78) / fmr.two_br),
      '1br':    Math.round(base * (fmr.one_br     || fmr.two_br * 0.87) / fmr.two_br),
      '2br':    Math.round(base),
      '3br':    Math.round(base * (fmr.three_br   || fmr.two_br * 1.27) / fmr.two_br),
      '4br':    Math.round(base * (fmr.four_br    || fmr.two_br * 1.45) / fmr.two_br),
      _meta: {
        vintage_month: zori.vintage_month,
        name:          zori.name,
        yoy:           zori.yoy
      }
    };
  }

  // -------------------------------------------------------------------
  // DSCR stress-scenario math (pure function, testable)
  //
  // Given the same inputs auto-NOI uses (rents, vacancy, opex, reserves,
  // property tax) plus the sized annual debt service, recompute NOI under
  // {rent -10%, vacancy +5pts, opex +10%, combined rent-5/vac+3/opex+5}
  // and divide by the CURRENT annual debt service.
  //
  // Returns null when inputs can't support a coverage calculation
  // (e.g. zero debt service, zero rents). This is the function the
  // banker/syndicator table reads.
  // -------------------------------------------------------------------
  function computeDscrStressScenarios(inputs, constants) {
    if (!inputs) return null;
    constants = constants || DEFAULT_CONSTANTS;
    var annualRents      = +inputs.annualRents || 0;
    var vacancyPct       = +inputs.vacancyPct  || 0;
    var annualOpex       = +inputs.annualOpex       || 0;
    var annualRepReserve = +inputs.annualRepReserve || 0;
    var netPropTax       = +inputs.netPropTax       || 0;
    var annualDebtService = +inputs.annualDebtService || 0;
    if (annualDebtService <= 0 || annualRents <= 0) return null;

    var rentS = +constants.rentStressPct;
    var vacS  = +constants.vacStressPp;
    var opexS = +constants.opexStressPct;
    var cR    = +constants.combinedRentPct;
    var cV    = +constants.combinedVacPp;
    var cO    = +constants.combinedOpexPct;

    function _noiFor(rentMult, vacDelta, opexMult) {
      var effVac = Math.min(1, Math.max(0, vacancyPct + vacDelta));
      var eff    = annualRents * rentMult * (1 - effVac);
      return eff - annualOpex * opexMult - annualRepReserve - netPropTax;
    }
    var baseNoi = _noiFor(1.00, 0, 1.00);
    return {
      base:     { noi: baseNoi,                       dscr: baseNoi / annualDebtService },
      rent10:   { noi: _noiFor(1 - rentS, 0,    1.00), dscr: _noiFor(1 - rentS, 0,    1.00) / annualDebtService },
      vac5:     { noi: _noiFor(1.00,  vacS, 1.00),     dscr: _noiFor(1.00,  vacS, 1.00) / annualDebtService },
      opex10:   { noi: _noiFor(1.00,  0,    1 + opexS),dscr: _noiFor(1.00,  0,    1 + opexS) / annualDebtService },
      combined: { noi: _noiFor(1 - cR, cV,   1 + cO),  dscr: _noiFor(1 - cR, cV,   1 + cO) / annualDebtService }
    };
  }

  /**
   * Update _amiLimits from HudFmr for the given county FIPS.
   *
   * LIHTC rent ceiling formula:
   *   monthly_rent_limit = (AMI_4person × tier_pct × rent_burden_pct) / 12
   *
   * The rent_burden_pct is a tunable constant (`_constants.rentBurdenPct`,
   * default 0.30). When the user changes it via the Methodology &
   * Formulas panel, the ceilings recompute and propagate to the deal.
   *
   * Computed locally rather than calling HudFmr.getGrossRentLimit so the
   * burden % is honored — that helper has 0.30 hardcoded.
   *
   * @param {string} fips  5-digit county FIPS, or null/'' for default.
   */
  function updateAmiLimitsFromFmr(fips) {
    var hudFmr = window.HudFmr;
    if (!fips || !hudFmr || !hudFmr.isLoaded()) return;
    var il = hudFmr.getIncomeLimitsByFips(fips);
    if (!il || !il.ami_4person) return;
    var burden = +_constants.rentBurdenPct;
    if (!isFinite(burden) || burden <= 0) burden = DEFAULT_CONSTANTS.rentBurdenPct;

    // P6/P7 — CHFA §42 LIHTC rent methodology, per-BR
    // ------------------------------------------------------------------
    // The IRC §42 statute computes the LIHTC rent ceiling using IMPUTED
    // household size = 1.5 × bedroom count:
    //   Studio = 1 person   1BR = 1.5 person   2BR = 3 person
    //   3BR = 4.5 person    4BR = 6 person
    //
    // We build per-BR per-tier rent ceilings. Backwards-compat: the
    // `computed[pct]` flat number is the 2BR ceiling (used by any code
    // path that doesn't know about BR mix yet). The per-BR breakdown
    // lives on `_amiLimitsByBr` keyed as `_amiLimitsByBr[pct][br]`.
    //
    // For 1BR / 3BR we linear-interp between adjacent person sizes;
    // for 4BR (6 person) we don't have il50_5/il50_6 in the cached IL
    // file, so we approximate using il50_4 × 1.04 (3BR) and × 1.10 (4BR)
    // following HUD's published 8%/4% adjustment factors. Best-effort
    // until the IL refresh includes 5-8 person.
    var il50_1p = +il.il50_1person;
    var il50_2p = +il.il50_2person;
    var il50_3p = +il.il50_3person;
    var il50_4p = +il.il50_4person;

    var computed = {};
    var computedByBr = {};
    var hasIL = Number.isFinite(il50_3p) && il50_3p > 0;

    if (hasIL) {
      // 50% AMI income limits by imputed household size
      var il50ByBr = {
        'studio': il50_1p,                        // 1 person
        '1br':    (il50_1p + il50_2p) / 2,        // 1.5 person interp
        '2br':    il50_3p,                        // 3 person
        '3br':    (il50_4p) * 1.04,               // 4.5 person ≈ il50_4 × 1.04 (HUD adjustment factor proxy)
        '4br':    il50_4p * 1.10                  // 6 person ≈ il50_4 × 1.10 (HUD adjustment factor proxy)
      };
      [30, 40, 50, 60, 70, 80, 100].forEach(function (pct) {
        var tier_factor = pct / 50;
        computedByBr[pct] = {};
        Object.keys(il50ByBr).forEach(function (br) {
          var tier_ami = il50ByBr[br] * tier_factor;
          computedByBr[pct][br] = Math.round((tier_ami * burden) / 12);
        });
        // Backwards-compat flat number = 2BR ceiling
        computed[pct] = computedByBr[pct]['2br'];
      });
    } else {
      // Fallback: if IL data is missing (rare), use the prior 4-person
      // AMI approach so we don't silently zero out rents.
      var ami4 = +il.ami_4person;
      [30, 40, 50, 60, 70, 80, 100].forEach(function (pct) {
        var v = Math.round((ami4 * (pct / 100) * burden) / 12);
        computed[pct] = v;
        computedByBr[pct] = { studio: v, '1br': v, '2br': v, '3br': v, '4br': v };
      });
    }
    _amiLimits = computed;
    _amiLimitsByBr = computedByBr;
    _countyFips = fips;
    // F25: refresh the 4% bond PAB note for the newly selected county.
    _renderPabNote(fips);
    // M1: recompute downstream now that AMI limits are available. Previously
    // recalculate() ran on initial load with _amiLimits=null and never re-fired
    // after FMR loaded async, so the rent roll stayed $0 until the user
    // touched an unrelated input. Trigger a fresh recalc here so rents +
    // mortgage + pro forma + exit analysis pick up the new limits immediately.
    try { recalculate(); } catch (_) { /* recalculate not yet defined during initial wiring */ }
  }

  /**
   * Populate the county selector dropdown from HudFmr data.
   * @param {HTMLSelectElement} sel
   */
  function populateCountySelector(sel) {
    var hudFmr = window.HudFmr;
    if (!hudFmr || !hudFmr.isLoaded()) return;
    var counties = hudFmr.getAllCounties();
    // No "Default (Denver MSA)" option — the Denver defaults are wrong for
    // ~56 of 64 CO counties. Force the user to pick one.
    sel.innerHTML = '<option value="">Select a county…</option>';
    counties
      .slice()
      .sort(function (a, b) { return (a.county_name || '').localeCompare(b.county_name || ''); })
      .forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.fips;
        opt.textContent = c.county_name + ' — ' + (c.fmr_area_name || '');
        sel.appendChild(opt);
      });
  }

  // -------------------------------------------------------------------
  // Render the calculator UI into #dealCalcMount
  // -------------------------------------------------------------------
  function render(mount) {
    mount.innerHTML = `
<section class="chart-card" style="margin-top:2rem;" aria-labelledby="dealCalcTitle">
  <h2 id="dealCalcTitle" style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;">
    LIHTC Feasibility Calculator
  </h2>
  <!-- Screening-level model disclosure -->
  <div role="note" style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:var(--sp3);padding:0.5rem 0.75rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);font-size:var(--tiny);">
    <span style="font-size:1rem;flex-shrink:0;" aria-hidden="true">🔎</span>
    <div>
      <strong style="color:var(--text);">Model class: screening-level</strong> —
      outputs are planning estimates only. Credit pricing, interest rates, equity, and lender terms
      vary significantly by market, investor, and deal structure. This tool does not model qualified
      basis, applicable fraction, or carryover allocation. Not a substitute for lender underwriting,
      CHFA review, or legal/tax counsel.
      <a href="docs/LIHTC_FEASIBILITY_CALCULATOR.md" style="color:var(--accent);">Methodology →</a>
    </div>
  </div>
  <p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);">
    Early-stage feasibility sizing tool. Not a final underwriting or award prediction model.
    Outputs depend on assumptions and local soft-funding availability.
    See <a href="docs/LIHTC_FEASIBILITY_CALCULATOR.md" style="color:var(--accent);">methodology notes</a> for scope and limitations.
  </p>

  <!-- Credit Rate Scenario Toggle -->
  <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);margin-bottom:var(--sp3);">
    <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Credit Rate Scenario</legend>
    <div style="display:flex;flex-wrap:wrap;gap:var(--sp3);align-items:center;">
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-rate-9" type="radio" name="dc-credit-rate" value="0.09" checked
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>9% — Competitive / New Construction</strong></span>
      </label>
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-rate-4" type="radio" name="dc-credit-rate" value="0.04"
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>4% — Bond-Financed</strong></span>
      </label>
    </div>
    <p id="dc-rate-pab-note" style="display:none;font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0;">
      4% deals require a Private Activity Bond (PAB) volume cap allocation in addition to
      the 4% credit allocation.
    </p>
  </fieldset>

  <!-- R2: grid uses auto-fit (collapses empty tracks) + min 380px so on
       desktop both columns stretch the full container width instead of
       leaving ~600px of empty space on the right. The page container max
       was also bumped to 1400px below for the same reason. -->
  <div id="dc-calc-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:var(--sp3);align-items:start;">

    <!-- Inputs column -->
    <div style="min-width:0;">
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Project Inputs</legend>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Development Cost ($)</span>
          <input id="dc-tdc" type="number" min="0" step="100000" value="20000000"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Units</span>
          <input id="dc-units" type="number" min="1" step="1" value="60"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <div style="margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);display:block;margin-bottom:0.4rem;">AMI Mix &amp; Units per Tier</span>
          <div style="font-size:var(--tiny);color:var(--muted);margin-bottom:.4rem;line-height:1.45;">
            Tiers ≤60% AMI generate LIHTC equity; tiers above 60% are workforce or
            market-rate units that don't qualify for tax credits. Mixed-income deals
            (some tiers above 60%) use IRC §42(c)(1)(B) applicable fraction —
            eligible basis is prorated by LIHTC unit share. See live calculation below.
          </div>
          <!-- P7: per-tier BR-type selector. Each AMI tier now has a BR
               type (Studio/1BR/2BR/3BR/4BR). Rent ceiling per row is
               computed using §42 imputed household size (1.5 × BR count).
               Default 2BR for every tier (matches the old single-rent
               behavior). For mixed deals (typical: 30% at 1BR, 60% at
               2BR, 80% at 3BR), change the dropdown per tier. -->
          <div style="display:grid;grid-template-columns:1fr 70px 100px;gap:0.25rem 0.5rem;font-size:var(--tiny);color:var(--muted);margin-bottom:.2rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">
            <span>AMI tier</span><span style="text-align:center;">Units</span><span>Bedrooms</span>
          </div>
          <div id="dc-ami-rows" style="display:grid;grid-template-columns:1fr 70px 100px;gap:0.4rem 0.5rem;align-items:center;">
            ${[30, 40, 50, 60, 70, 80, 100].map(pct => {
              var lihtcEligible = pct <= 60;
              var defaultUnits = lihtcEligible ? 15 : 0;
              var tierLabel = lihtcEligible
                ? pct + '% AMI'
                : pct + '% AMI <span style="font-size:.66rem;color:var(--muted);font-weight:400;">(market/workforce)</span>';
              var brOptions = [
                ['studio', 'Studio'], ['1br', '1BR'],
                ['2br', '2BR (default)'], ['3br', '3BR'], ['4br', '4BR']
              ].map(function (b) {
                var sel = b[0] === '2br' ? ' selected' : '';
                return '<option value="' + b[0] + '"' + sel + '>' + b[1] + '</option>';
              }).join('');
              return `
              <label style="display:flex;align-items:center;gap:0.4rem;min-height:44px;font-size:var(--small);white-space:nowrap;">
                <input id="dc-chk-${pct}" type="checkbox" ${lihtcEligible ? 'checked' : ''} style="width:16px;height:16px;">
                ${tierLabel}
              </label>
              <input id="dc-units-${pct}" type="number" min="0" step="1" value="${defaultUnits}"
                aria-label="Units at ${pct}% AMI"
                style="padding:0.35rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);text-align:right;">
              <select id="dc-br-${pct}"
                aria-label="Bedroom type for ${pct}% AMI units"
                style="padding:0.35rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
                ${brOptions}
              </select>
            `;}).join('')}
          </div>

          <!-- Q5: Achievable-rent cap toggle (CHFA QAP "min(LIHTC, market)" rule)
               In weak markets, the LIHTC ceiling for 70/80/100% AMI tiers
               often exceeds what the local market will actually pay. CHFA's
               QAP requires underwriting at min(ceiling, market). When ON,
               this caps the 70/80/100% AMI per-unit rents at the per-BR
               ZORI estimate so the proforma doesn't overstate revenue. -->
          <div id="dc-achievable-cap-wrap"
            style="margin-top:.65rem;padding:.55rem .65rem;border:1px solid var(--border);
                   border-radius:var(--radius);background:var(--bg2);">
            <label style="display:flex;align-items:flex-start;gap:.55rem;font-size:var(--small);cursor:pointer;">
              <input id="dc-achievable-cap" type="checkbox"
                style="width:1rem;height:1rem;margin-top:.18rem;flex:0 0 auto;cursor:pointer;"
                aria-describedby="dc-achievable-cap-help">
              <span style="flex:1 1 auto;min-width:0;">
                <strong>Cap 70/80/100% AMI rents at market (ZORI)</strong>
                <span id="dc-achievable-cap-help"
                  style="display:block;font-size:var(--tiny);color:var(--muted);line-height:1.45;margin-top:.15rem;">
                  In soft markets the LIHTC ceiling on workforce tiers often exceeds achievable
                  rent. When checked, 70/80/100% AMI rents underwrite at
                  <strong>min(ceiling, ZORI market rent)</strong> per CHFA QAP. ≤60% AMI tiers
                  are unaffected — those ceilings rarely exceed market.
                </span>
              </span>
            </label>
            <div id="dc-achievable-cap-meta"
              style="margin-top:.4rem;font-size:var(--tiny);color:var(--muted);line-height:1.4;">
              Select a county to load ZORI market context.
            </div>
          </div>
        </div>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Eligible Basis %: <strong id="dc-basis-pct-label">80</strong>%
          </span>
          <input id="dc-basis-pct" type="range" min="50" max="130" step="1" value="80"
            aria-label="Eligible basis percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
        </label>

        <div style="margin-top:var(--sp2);margin-bottom:var(--sp2);padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;">
            <input id="dc-qct-dda" type="checkbox"
              style="width:16px;height:16px;flex-shrink:0;">
            <span style="font-size:var(--small);font-weight:600;">QCT/DDA site (may increase eligible basis)</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0 1.6rem;">
            QCT and DDA sites may qualify for up to <strong>130% eligible basis</strong>
            under IRC&nbsp;§42(d)(5)(B). Adjust the Eligible Basis&nbsp;% slider above
            to reflect the boost — this checkbox is for reference only.
          </p>
          <p id="dc-qct-dda-note" style="display:none;font-size:var(--tiny);color:var(--accent);margin:0.3rem 0 0 1.6rem;font-weight:600;">
            ✓ Site marked as QCT/DDA — consider setting Eligible Basis to 100%+ to model the boost.
          </p>
        </div>

        <!-- Applicable-fraction note: shown when both LIHTC and market units present -->
        <div id="dc-applicable-fraction-note" hidden
          style="margin:0.5rem 0 var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);
                 background:var(--accent-dim,#d1fae5);border:1px solid var(--accent,#096e65);
                 color:var(--text);font-size:var(--tiny);line-height:1.45;"></div>

        <!-- Unit-sync warning: shown when Total Units ≠ sum of AMI-tier units -->
        <div id="dc-units-sync-warn" hidden
          style="margin:0.5rem 0 var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);
                 background:#fef3c7;border:1px solid #fcd34d;color:#92400e;
                 font-size:var(--tiny);line-height:1.5;">
        </div>

        <label style="display:block;margin-bottom:var(--sp2);margin-top:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">County (sets HUD FMR gross rent limits)</span>
          <select id="dc-county-select"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="">Default (Denver MSA)</option>
          </select>
        </label>
        <!-- Site coords → county auto-detect (PR #794+1). Useful when the
             site is in a cross-county place (Erie, Aurora, Longmont) and
             the user doesn't know which county's HUD AMI applies. Fed by
             js/county-from-coords.js (point-in-polygon vs TIGER). -->
        <details style="margin-top:-0.25rem;margin-bottom:var(--sp2);">
          <summary style="font-size:var(--tiny);color:var(--accent,#096e65);cursor:pointer;
                          padding:0.25rem 0;font-weight:600;">
            Auto-detect county from site coordinates &rarr;
          </summary>
          <div style="margin-top:0.4rem;padding:0.5rem 0.75rem;border:1px solid var(--border);
                      border-radius:var(--radius);background:var(--bg2);">
            <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 0.4rem;">
              Useful when the site is in a town that spans multiple counties (Erie, Aurora,
              Longmont, etc.). Paste lat/lon below — the county will auto-fill above.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.4rem;align-items:end;">
              <label style="display:block;font-size:var(--tiny);">
                <span style="color:var(--muted);">Latitude</span>
                <input id="dc-coords-lat" type="number" step="0.000001" placeholder="39.7392"
                  style="display:block;width:100%;margin-top:0.2rem;padding:0.3rem 0.4rem;
                         border:1px solid var(--border);border-radius:4px;background:var(--bg);
                         color:var(--text);font-size:var(--small);">
              </label>
              <label style="display:block;font-size:var(--tiny);">
                <span style="color:var(--muted);">Longitude</span>
                <input id="dc-coords-lon" type="number" step="0.000001" placeholder="-104.9847"
                  style="display:block;width:100%;margin-top:0.2rem;padding:0.3rem 0.4rem;
                         border:1px solid var(--border);border-radius:4px;background:var(--bg);
                         color:var(--text);font-size:var(--small);">
              </label>
              <button type="button" id="dc-coords-detect"
                style="padding:0.4rem 0.6rem;border:1px solid var(--accent,#096e65);
                       background:var(--accent,#096e65);color:#fff;border-radius:4px;
                       font-size:var(--tiny);font-weight:600;cursor:pointer;height:fit-content;">
                Detect
              </button>
            </div>
            <div style="margin-top:0.4rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
              <button type="button" id="dc-coords-geo"
                style="padding:0.3rem 0.5rem;border:1px solid var(--border);background:transparent;
                       color:var(--text);border-radius:4px;font-size:var(--tiny);cursor:pointer;">
                Use my location
              </button>
              <span id="dc-coords-result" style="font-size:var(--tiny);color:var(--muted);
                                                 line-height:1.4;flex:1;min-width:200px;"></span>
            </div>
          </div>
        </details>
        <div id="dc-fmr-note" style="font-size:var(--tiny);color:var(--warn, #e6a23c);margin-top:-0.25rem;margin-bottom:var(--sp2);">
          Select a county above to load HUD-published AMI rent limits for that county.
        </div>
        <!-- Cross-county jurisdiction disclosure: surfaces when the chosen
             county contains towns/CDPs that span multiple counties. HUD
             AMI is per-county; a site on the wrong side of the line uses
             a different AMI tier. Populated by js/cross-county-disclosure.js. -->
        <div id="dc-cross-county-note" hidden role="status" aria-live="polite"
          style="margin:0 0 var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);
                 background:#eff6ff;border:1px solid #93c5fd;color:#1e3a8a;
                 font-size:var(--tiny);line-height:1.5;">
        </div>
        <!-- HMDA mortgage credit access context for the chosen county.
             Per-county denial rate, mean loan size, and multifamily
             originations from CFPB HMDA Data Browser data shipped in
             PR #786. Populated by js/hmda-lookup.js when the user
             selects a county. -->
        <div id="dc-hmda-context" hidden role="status" aria-live="polite"
          style="margin:0 0 var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);
                 background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.4);color:var(--text);
                 font-size:var(--tiny);line-height:1.5;">
        </div>
      </fieldset>

      <!-- Debt / Mortgage Inputs -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Operating Income &amp; NOI</legend>

        <!-- Auto-compute NOI toggle -->
        <div style="margin-bottom:var(--sp2);padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;">
            <input id="dc-auto-noi" type="checkbox" style="width:16px;height:16px;flex-shrink:0;">
            <span style="font-size:var(--small);font-weight:600;">Auto-compute NOI from rent &amp; expense inputs</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0 1.6rem;">
            When checked, NOI = Gross Rents × (1 − Vacancy) − Operating Expenses − Replacement Reserve − Net Property Tax
          </p>
        </div>

        <!-- Manual NOI override (hidden when auto-compute is on) -->
        <div id="dc-noi-manual-wrap" style="margin-bottom:var(--sp2);">
          <label style="display:block;">
            <span style="font-size:var(--small);color:var(--muted);">Net Operating Income (NOI) ($/year)</span>
            <input id="dc-noi" type="number" min="0" step="1000" value="0"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
        </div>

        <!-- Auto-NOI inputs (hidden until auto-compute is checked) -->
        <div id="dc-noi-auto-wrap" style="display:none;">
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Vacancy Rate (%)</span>
            <input id="dc-vacancy" type="number" min="0" max="50" step="0.5" value="7"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Operating Expenses ($/unit/month)</span>
            <input id="dc-opex" type="number" min="0" step="10" value="450"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">Initial default $450 reflects Denver-MSA LIHTC operating costs. <strong>Rural CO counties often run $250–$350</strong> — verify with your property manager or peer comparables.</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Replacement Reserve ($/unit/year)</span>
            <input id="dc-rep-reserve" type="number" min="0" step="25" value="350"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">CHFA minimum: $250–$400/unit/year</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Property Tax ($/unit/year)</span>
            <input id="dc-prop-tax" type="number" min="0" step="50" value="900"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">Initial default $900 is a Front-Range ballpark. <strong>Mill levies vary 3–5× across CO</strong> — check your county assessor before committing to a pro forma.</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Tax Exemption</span>
            <select id="dc-tax-exempt"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
              <option value="0">None (0%)</option>
              <option value="50">Partial (50%) — nonprofit</option>
              <option value="100">Full (100%) — housing authority</option>
            </select>
            <span style="font-size:var(--tiny);color:var(--muted);">Housing authority ownership or nonprofit partnerships may qualify for property tax exemption</span>
          </label>
          <div id="dc-noi-computed-display" style="padding:0.5rem 0.75rem;border-radius:var(--radius);background:color-mix(in oklab, var(--card,#fff) 80%, var(--accent,#096e65) 20%);font-size:var(--small);font-weight:600;">
            Computed NOI: <span id="dc-noi-computed">—</span>
          </div>
        </div>
      </fieldset>

      <!-- Developer Fee -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Developer Fee</legend>
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Developer Fee Rate: <strong id="dc-devfee-pct-label">15</strong>% of TDC
          </span>
          <input id="dc-devfee-pct" type="range" min="0" max="25" step="0.5" value="15"
            aria-label="Developer fee rate percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
          <span style="font-size:var(--tiny);color:var(--muted);">
            Typical CHFA range: 12–18% of TDC. Only a portion is includable in eligible basis.
          </span>
        </label>
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Deferred Developer Fee cap: <strong id="dc-deferred-pct-label">40</strong>% of dev fee
          </span>
          <input id="dc-deferred-pct" type="range" min="0" max="100" step="5" value="40"
            aria-label="Deferred developer fee cap percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
          <span style="font-size:var(--tiny);color:var(--muted);">
            Shown as a "soft source" in S&amp;U — paid from operating cash flow over time,
            <em>not</em> cash at closing. CHFA + lenders require a repayment pro forma to verify supportability.
          </span>
        </label>
        <!-- H — Auto-balance: defer enough fee (capped above) to fill the
             remaining gap after equity + mortgage + grants + soft loans.
             Mirrors the Anthracite $185k pattern: deferred fee is the
             last-resort balancing source. -->
        <label style="display:flex;align-items:flex-start;gap:0.55rem;margin-bottom:var(--sp2);font-size:var(--small);cursor:pointer;">
          <input id="dc-deferred-auto-balance" type="checkbox" checked
            style="width:1rem;height:1rem;margin-top:0.18rem;flex:0 0 auto;cursor:pointer;"
            aria-label="Auto-balance remaining gap with deferred developer fee">
          <span style="flex:1 1 auto;min-width:0;">
            <strong>Auto-balance gap with deferred fee</strong>
            <span style="display:block;font-size:var(--tiny);color:var(--muted);line-height:1.45;margin-top:.15rem;">
              When checked, defers additional fee (up to the cap above) to close any remaining gap.
              Uncheck to defer exactly the slider percentage regardless of gap size.
            </span>
          </span>
        </label>
        <p id="dc-deferred-auto-note" hidden
          style="font-size:var(--tiny);color:var(--accent);margin:0 0 var(--sp2);padding:0.35rem 0.5rem;background:color-mix(in oklab, var(--accent) 6%, transparent 94%);border-radius:var(--radius);"></p>
        <div id="dc-devfee-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 0.75rem;font-size:var(--small);margin-top:var(--sp2);">
          <span style="color:var(--muted);">Total Developer Fee</span>
          <span id="dc-r-devfee" style="font-weight:700;text-align:right;">—</span>
          <span style="color:var(--muted);">Deferred (gap fill)</span>
          <span id="dc-r-deferred" style="font-weight:700;text-align:right;color:var(--accent);">—</span>
          <span style="color:var(--muted);">Paid at closing</span>
          <span id="dc-r-devfee-closing" style="font-weight:700;text-align:right;">—</span>
        </div>
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Sizing</legend>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Debt Coverage Ratio (DCR)</span>
          <input id="dc-dcr" type="number" min="1.05" max="2.0" step="0.05" value="1.20"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Interest Rate (%)</span>
          <input id="dc-rate" type="number" min="3" max="12" step="0.1" value="6.5"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Loan Term (years)</span>
          <input id="dc-term" type="number" min="1" max="50" step="1" value="35"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <p style="font-size:var(--tiny);color:var(--muted);margin:0;">
          This is a planning-level estimate. Actual terms depend on lender underwriting.
        </p>
      </fieldset>

      <!-- G — Multi-tranche soft debt. Replaces the single-source picker.
           Each tranche is { program, amount, mode (loan|grant), rate, term }
           and aggregates into the sources/uses + pro forma debt service. -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Soft Funding Stack</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Stack up to 5 subordinate sources (CHFA HTF, Prop 123, local PHA, sponsor loan, impact fees, etc.).
          Loans amortize from cash flow; grants reduce eligible basis under §42(d)(5)(A) and fill the gap at closing.
        </p>
        <div id="dc-soft-tranches" style="display:flex;flex-direction:column;gap:var(--sp2);"></div>
        <button id="dc-add-tranche" type="button"
          style="margin-top:var(--sp2);padding:0.4rem 0.75rem;border:1px dashed var(--border);border-radius:var(--radius);background:transparent;color:var(--accent);font-size:var(--small);font-weight:600;cursor:pointer;width:100%;">
          + Add soft-funding tranche
        </button>
      </fieldset>
    </div>

    <!-- Outputs column -->
    <div style="min-width:0;">

      <!-- Methodology & Formulas — collapsed by default. Shows every formula
           the calculator uses with the current numbers substituted in, plus
           inline-editable tunable constants for non-standard underwriting
           boxes (e.g. a bank using 28 % rent burden, or a lender using
           tighter stress percentages). -->
      <details id="dc-formulas-panel" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);background:var(--bg2);">
        <summary style="font-size:var(--small);font-weight:700;cursor:pointer;list-style:none;display:flex;align-items:center;gap:0.5rem;">
          <span aria-hidden="true">▶</span>
          Methodology &amp; Formulas
          <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">— see every formula, override industry-standard constants</span>
        </summary>
        <div style="margin-top:var(--sp3);font-size:var(--small);line-height:1.6;">
          <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
            All numbers in the calculator are computed from the inputs above plus the constants below.
            Constants in <strong>highlighted boxes</strong> are editable — change them when your bank or
            program uses different underwriting standards. Click "Reset to defaults" to restore industry-standard values.
          </p>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">1. LIHTC monthly gross rent ceiling — §42 / CHFA methodology (default 2BR)</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              ceiling = MTSP_AMI<sub>3-person</sub> × (tier_pct ÷ 50) × <span style="background:var(--warn-dim,#fef3c7);padding:0 0.15rem;">rent_burden</span> ÷ 12
            </code>
            <div style="margin-top:0.4rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <label style="font-size:var(--tiny);color:var(--muted);">rent_burden:</label>
              <input id="dc-const-rent-burden" type="number" min="20" max="50" step="1" value="30"
                style="width:5rem;padding:0.25rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);"> <span style="font-size:var(--tiny);color:var(--muted);">%</span>
              <span id="dc-formula-ceiling-eg" style="font-size:var(--tiny);color:var(--muted);margin-left:auto;">—</span>
            </div>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;line-height:1.5;">
              <strong>Why MTSP 3-person, not 4-person AMI:</strong> IRC §42 uses
              imputed household size = 1.5 × bedroom count (Studio = 1p, 1BR = 1.5p,
              2BR = 3p, 3BR = 4.5p, 4BR = 6p). CHFA underwrites to this rule. We
              default to 2BR (the most common LIHTC unit type) using HUD MTSP's
              published 50% AMI 3-person income limit and scale linearly to each
              tier. The widely-circulated <code>ami_4person × pct</code> shortcut
              over-estimates Studio/1BR ceilings and under-estimates 3BR+.
              <br>
              <strong>30% rent burden</strong> is HUD-standard. Some affordable
              programs (FHA 221(d)(4), select state HFAs) underwrite at 28%.
              <br>
              <strong>Gross vs net rent:</strong> these are GROSS rent ceilings
              (the §42 maximum). Tenant-paid NET rent = gross − utility
              allowance, published per-jurisdiction by HUD or the local PHA.
              The pro forma below uses gross rent as a conservative ceiling;
              real underwriting subtracts UA.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">2. Annual gross rents</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              gross_rents = Σ<sub>tier ∈ {30,40,50,60}</sub> ( units_at_tier × ceiling<sub>tier</sub> × 12 )
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              Sums the rent rolls for each AMI-tier checkbox you've enabled. Driven by the unit-mix inputs above.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">3. Stabilized NOI (auto-compute mode)</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              NOI = gross_rents × (1 − vacancy) − opex − rep_reserve − net_property_tax
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              Standard pro forma. Vacancy, per-unit opex, replacement reserve, and property tax are all inputs above. In manual-NOI mode, you type a total and the breakdown is opaque.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">4. Supportable first mortgage</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              mortgage = (NOI ÷ DCR_target) ÷ mortgage_constant
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              DCR target is an input above (default 1.20×; conservative lenders use 1.25×, aggressive 1.15×). Mortgage constant is derived from the rate and term inputs (annualised debt-service-per-dollar).
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">5. DSCR + stress scenarios</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;margin-bottom:0.35rem;">
              DSCR = NOI ÷ annual_debt_service
            </code>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;background:var(--card);padding:0.4rem 0.5rem;border-radius:3px;line-height:1.7;">
              stress_NOI = (rents × rent_mult) × (1 − (vacancy + vac_delta)) − (opex × opex_mult) − reserve − tax
            </div>
            <div style="margin-top:0.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.5rem;">
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                Rent stress &minus;
                <input id="dc-const-rent-stress" type="number" min="0" max="50" step="1" value="10"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">%
              </label>
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                Vacancy stress +
                <input id="dc-const-vac-stress" type="number" min="0" max="50" step="1" value="5"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">pp
              </label>
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                OpEx stress +
                <input id="dc-const-opex-stress" type="number" min="0" max="50" step="1" value="10"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">%
              </label>
            </div>
            <div style="margin-top:0.4rem;font-size:var(--tiny);color:var(--muted);">Combined-stress (multi-variable) deltas:</div>
            <div style="margin-top:0.25rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.5rem;">
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                Rent &minus;
                <input id="dc-const-comb-rent" type="number" min="0" max="50" step="1" value="5"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">%
              </label>
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                Vacancy +
                <input id="dc-const-comb-vac" type="number" min="0" max="50" step="1" value="3"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">pp
              </label>
              <label style="font-size:var(--tiny);color:var(--muted);display:flex;align-items:center;gap:0.4rem;">
                OpEx +
                <input id="dc-const-comb-opex" type="number" min="0" max="50" step="1" value="5"
                  style="width:4rem;padding:0.2rem 0.35rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);">%
              </label>
            </div>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">6. LIHTC equity (10-year credit value)</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              equity = eligible_basis × credit_rate × 10 × equity_price
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              Credit rate: 9 % (competitive) or ≈ 4 % (4-percent / PAB-backed). Equity price ($/credit) is an input — confirm with your syndicator. Standard amortization over 10 years.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">7. Sources &amp; Uses gap</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              gap = TDC − equity − supportable_mortgage − deferred_dev_fee − impact_fee_grant
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              Whatever's left after equity, perm debt, deferred fee, and grants. Bridged by soft-funding, subordinate loans, or developer contribution.
            </p>
          </div>

          <div style="display:flex;gap:0.5rem;margin-top:var(--sp3);">
            <button type="button" id="dc-const-reset"
              style="padding:0.4rem 1rem;font-size:var(--tiny);font-weight:600;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;">
              Reset all to industry defaults
            </button>
            <span id="dc-const-modified-flag" style="font-size:var(--tiny);color:var(--warn,#d97706);font-weight:600;align-self:center;display:none;">
              ⚠ Custom underwriting constants in use — your numbers reflect non-standard assumptions.
            </span>
          </div>
        </div>
      </details>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">LIHTC Credit Estimates <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(screening-level)</span></legend>

        <!-- Adjacent-to-headline disclaimer (per methodology-gaps deep-dive):
             the "Screening tool only" note in the page intro is easy to miss
             once a user is staring at a 7-figure equity number. Repeat the
             framing right next to the headline outputs so it stays in view. -->
        <p role="note" style="margin:0 0 var(--sp2);padding:0.4rem 0.6rem;font-size:var(--tiny);background:rgba(217,119,6,.08);border-left:3px solid var(--warn,#d97706);border-radius:0 4px 4px 0;color:var(--text);line-height:1.45;">
          <strong style="color:var(--warn,#d97706);">⚠ Screening estimate, not underwriting.</strong>
          The equity figure below uses public assumptions for hard costs, equity pricing, and applicable fraction. Real syndicator pricing varies ±3-8¢/credit by deal characteristics — confirm with your investor before relying on this number for site control or capital-stack decisions.
        </p>

        <dl id="dc-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Eligible Basis</dt>
          <dd id="dc-r-basis" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Tax Credits</dt>
          <dd id="dc-r-credits" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">10-Year Credit Equity</dt>
          <dd id="dc-r-equity" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Est. Annual Gross Rents</dt>
          <dd id="dc-r-rents" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-gap-note" style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);display:none;"></p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Verify: Annual credits and equity are illustrative — confirm equity pricing with your syndicator
          (CO market typically $0.85–$0.95/credit). Gross rents use
          <a href="https://www.huduser.gov/portal/datasets/fmr.html" target="_blank" rel="noopener">HUD FMR FY 2025</a>
          published limits (lags ~18 mo); spot-check against current market rents before underwriting.
        </p>
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Supportable First Mortgage <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(estimate · screening-level)</span></legend>
        <dl id="dc-mortgage-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Mortgage Constant (annual)</dt>
          <dd id="dc-r-mc" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Supportable First Mortgage</dt>
          <dd id="dc-r-mortgage" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">Cap Rate (NOI / TDC)</dt>
          <dd id="dc-r-cap-rate" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Break-Even Occupancy</dt>
          <dd id="dc-r-beo" style="font-weight:700;text-align:right;">—</dd>

          <dt id="dc-r-proptax-label" style="color:var(--muted);display:none;">Net Property Tax</dt>
          <dd id="dc-r-proptax" style="font-weight:700;text-align:right;display:none;">—</dd>

          <dt id="dc-r-taxsave-label" style="color:var(--accent);display:none;">Tax Savings (exemption)</dt>
          <dd id="dc-r-taxsave" style="font-weight:700;text-align:right;color:var(--accent);display:none;">—</dd>
        </dl>
        <p style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);">Cap rate and break-even occupancy require auto-compute NOI to be enabled.</p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Verify: Supportable mortgage is a planning-level estimate based on your DCR, rate, and term inputs —
          actual lender underwriting differs.
          <a href="https://www.chfainfo.com/rental-housing/housing-credit" target="_blank" rel="noopener">CHFA</a>
          and conventional lenders apply independent DCR, LTV, and debt-service reserve requirements.
        </p>
      </fieldset>

      <!-- Debt Service Coverage & Stress -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Service Coverage &amp; Stress Tests</legend>
        <dl id="dc-dscr-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">NOI (stabilized, annual)</dt>
          <dd id="dc-r-noi-stab" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Debt Service</dt>
          <dd id="dc-r-ads" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">DSCR (stabilized)</dt>
          <dd id="dc-r-dscr-base" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-dscr-target-note" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);margin-bottom:var(--sp2);">—</p>
        <table id="dc-dscr-stress-table" style="width:100%;border-collapse:collapse;font-size:var(--small);margin-top:var(--sp2);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Stress Scenario</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Stressed NOI</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">DSCR</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">vs target</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Rent &minus;10%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Soft market / concessions scenario
                </span>
              </td>
              <td id="dc-r-stress-rent10-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-rent10-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-rent10-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Vacancy +5 pts
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Slow lease-up / turnover spike scenario
                </span>
              </td>
              <td id="dc-r-stress-vac5-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-vac5-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-vac5-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                OpEx +10%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Insurance / utility / repair-cost inflation scenario
                </span>
              </td>
              <td id="dc-r-stress-opex10-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-opex10-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-opex10-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr style="border-top:1px dashed var(--border);">
              <td style="padding:0.3rem 0.25rem;">
                <strong>Combined:</strong> Rent &minus;5% + Vacancy +3 pts + OpEx +5%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Realistic multi-variable downside — what lenders actually underwrite against
                </span>
              </td>
              <td id="dc-r-stress-combined-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-combined-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-combined-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
          </tbody>
        </table>
        <p id="dc-dscr-manual-note" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);margin-bottom:0;display:none;">
          Stress scenarios require auto-compute NOI to be enabled — they need the underlying rent / vacancy / opex breakdown, not just a total NOI.
        </p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Banker / syndicator rule of thumb: conservative lenders want DSCR ≥ 1.15 under a moderate stress scenario
          and DSCR ≥ 1.10 under combined stress. A deal that falls below 1.00 under the combined case may need
          additional credit enhancement, a lower DCR sizing target, or a smaller loan.
        </p>
      </fieldset>

      <!-- Rent Achievability Check -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Rent Achievability Check</legend>
        <p id="dc-rent-ach-intro" style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Compares LIHTC rent ceilings (at each AMI tier) against the county's HUD FMR 2BR market rent.
          When the ceiling exceeds market rent, proforma revenue at the ceiling is over-stated and the
          deal's actual DSCR will come in below underwriting.
        </p>
        <table id="dc-rent-ach-table" style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">AMI Tier</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">LIHTC Ceiling</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">HUD FMR 2BR</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Gap</th>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Status</th>
            </tr>
          </thead>
          <tbody id="dc-rent-ach-body">
            <tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Select a county to see rent-achievability check.</td></tr>
          </tbody>
        </table>
        <div id="dc-rent-ach-fmr-grid" style="margin-top:var(--sp3);display:none;">
          <div style="font-size:var(--tiny);color:var(--muted);font-weight:600;margin-bottom:0.35rem;">HUD FMR by bedroom size (FY2025, gross rent $USD/mo)</div>
          <table style="width:100%;border-collapse:collapse;font-size:var(--tiny);">
            <thead>
              <tr>
                <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.25rem 0.25rem;">Studio</th>
                <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.25rem 0.25rem;">1BR</th>
                <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.25rem 0.25rem;">2BR</th>
                <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.25rem 0.25rem;">3BR</th>
                <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.25rem 0.25rem;">4BR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="dc-fmr-studio"  style="text-align:right;padding:0.25rem 0.25rem;">—</td>
                <td id="dc-fmr-1br"     style="text-align:right;padding:0.25rem 0.25rem;">—</td>
                <td id="dc-fmr-2br"     style="text-align:right;padding:0.25rem 0.25rem;font-weight:700;">—</td>
                <td id="dc-fmr-3br"     style="text-align:right;padding:0.25rem 0.25rem;">—</td>
                <td id="dc-fmr-4br"     style="text-align:right;padding:0.25rem 0.25rem;">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ LIHTC rent ceilings assume 4-person AMI (HUD standard); actual per-bedroom limits vary ±10%. HUD FMR is the 40th-percentile
          market rent for the area and lags ~18 mo. For a binding market-rent test, commission a rent comparability study
          before closing. Source:
          <a href="https://www.huduser.gov/portal/datasets/fmr.html" target="_blank" rel="noopener">HUD FMR FY2025</a>.
        </p>
      </fieldset>

      <!-- Peer Deals — comparable LIHTC projects in same county + credit type -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Peer Deals <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(real comparable CO LIHTC projects)</span></legend>
        <p id="dc-peers-intro" style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Top 5 LIHTC projects in the selected county with the same credit type, sorted by recency then by size proximity to your proposed unit count.
          Source: HUD LIHTC Database (716 CO projects).
        </p>
        <table id="dc-peers-table" style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Project</th>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">City</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Year PIS</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Units</th>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Flags</th>
            </tr>
          </thead>
          <tbody id="dc-peers-body">
            <tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Select a county to see peer deals.</td></tr>
          </tbody>
        </table>
        <p id="dc-peers-empty" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);margin-bottom:0;display:none;"></p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ HUD LIHTC DB does not publish per-project TDC, equity pricing, or stabilized DSCR — those come from syndicator filings (private). What you see here: project name, year placed in service, total units, QCT/DDA/non-profit flags. Use as a sanity-check for unit-count and credit-type fit, not as a financial benchmark.
          Source:
          <a href="https://lihtc.huduser.gov/" target="_blank" rel="noopener">HUD LIHTC Database</a>.
        </p>
      </fieldset>

      <!-- Sources & Uses Panel -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Sources &amp; Uses Summary</legend>
        <table id="dc-su-table" style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Item</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Amount</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">% of TDC</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:var(--bg2);">
              <td colspan="3" style="padding:0.3rem 0.25rem;font-weight:700;color:var(--muted);font-size:var(--tiny);text-transform:uppercase;letter-spacing:0.04em;">SOURCES</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">LIHTC Equity</td>
              <td id="dc-su-equity" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-equity-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">Supportable First Mortgage</td>
              <td id="dc-su-mortgage" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-mortgage-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Deferred Developer Fee
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Soft source — developer obligation paid from future cash flow, not cash at closing
                </span>
              </td>
              <td id="dc-su-deferred" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-deferred-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                <span id="dc-su-impact-label">Soft-funding stack</span>
                <span id="dc-su-impact-note" style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Add tranches under "Soft Funding Stack" — CHFA, Prop 123, local PHA, sponsor loan, impact fees.
                </span>
              </td>
              <td id="dc-su-impact-ds" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-impact-ds-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tbody id="dc-su-tranches-detail" style="display:contents;"></tbody>
            <tr>
              <td style="padding:0.3rem 0.25rem;color:var(--muted);">Gap / Subordinate Debt / Grants Needed</td>
              <td id="dc-su-gap" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-gap-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr style="background:var(--bg2);">
              <td colspan="3" style="padding:0.3rem 0.25rem;font-weight:700;color:var(--muted);font-size:var(--tiny);text-transform:uppercase;letter-spacing:0.04em;">USES</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">Total Development Cost (TDC)</td>
              <td id="dc-su-tdc" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">100%</td>
            </tr>
          </tbody>
        </table>
      </fieldset>

      <!-- L6 — Year-15 exit analysis. Closes the IC packet: resale value
           at hold-period end, remaining debt balances, net sale proceeds,
           deferred-fee payback timing, sponsor IRR. -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Year-15 Exit Analysis</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Projects sale or refinance at hold-period end. NOI growth and expense inflation use the same
          rates as the 30-yr pro forma. Resale value capitalizes stabilized NOI at the exit cap rate.
        </p>
        <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:var(--sp2);margin-bottom:var(--sp2);">
          <label style="font-size:var(--small);color:var(--muted);">
            Hold period (years)
            <input id="dc-exit-hold" type="number" min="10" max="30" step="1" value="15"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <label style="font-size:var(--small);color:var(--muted);">
            Exit cap rate (%)
            <input id="dc-exit-cap" type="number" min="3.0" max="12.0" step="0.05" value="6.5"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
        </div>
        <dl id="dc-exit-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 0.75rem;font-size:var(--small);margin:0;">
          <dt style="color:var(--muted);">Year-N stabilized NOI</dt>
          <dd id="dc-exit-noi" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Resale value (NOI ÷ exit cap)</dt>
          <dd id="dc-exit-resale" style="margin:0;text-align:right;font-weight:700;color:var(--accent);">—</dd>
          <dt style="color:var(--muted);">Remaining 1st mortgage balance</dt>
          <dd id="dc-exit-mortbal" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Remaining soft-loan balance</dt>
          <dd id="dc-exit-softbal" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);font-weight:700;border-top:1px solid var(--border);padding-top:6px;">Net sale proceeds</dt>
          <dd id="dc-exit-net" style="margin:0;text-align:right;font-weight:700;color:var(--good,#047857);border-top:1px solid var(--border);padding-top:6px;">—</dd>
          <dt style="color:var(--muted);">Deferred fee payback year</dt>
          <dd id="dc-exit-defyr" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Sponsor IRR (incl. exit)</dt>
          <dd id="dc-exit-irr" style="margin:0;text-align:right;font-weight:700;color:var(--accent);">—</dd>
        </dl>
        <p id="dc-exit-notes" style="font-size:var(--tiny);color:var(--muted);margin:var(--sp2) 0 0;line-height:1.5;"></p>
      </fieldset>
    </div>
  </div>

  <!-- Collapsible Assumptions Panel -->
  <details style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);">
    <summary style="font-size:var(--small);font-weight:700;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:0.4rem;">
      <span>&#9660;</span> Assumptions
    </summary>
    <div style="margin-top:var(--sp2);font-size:var(--small);">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp2) var(--sp3);">
        <label style="display:block;">
          <span style="color:var(--muted);">Credit Pricing ($/credit)</span>
          <input id="dc-equity-price" type="number" min="0.50" max="1.20" step="0.01" value="0.90"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Debt Coverage Ratio (DCR)</span>
          <span id="dc-assump-dcr" style="font-weight:700;">1.20</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Interest Rate</span>
          <span id="dc-assump-rate" style="font-weight:700;">6.5%</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Loan Term</span>
          <span id="dc-assump-term" style="font-weight:700;">35 years</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
      </div>
      <div id="dc-assump-qct" style="margin-top:var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);background:var(--bg2);font-size:var(--tiny);color:var(--muted);">
        QCT/DDA basis boost: <strong id="dc-assump-qct-status">not indicated</strong>
      </div>
      <p style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);">
        All values are planning-level and not a substitute for lender or investor underwriting.
        Credit pricing, DCR, interest rate, and term vary by market, lender, and project type.
      </p>
    </div>
  </details>

  <!-- Planning-Level Disclaimer -->
  <div style="margin-top:var(--sp3);padding:var(--sp2) var(--sp3);border-left:3px solid var(--border);background:var(--bg2);border-radius:0 var(--radius) var(--radius) 0;">
    <p style="font-size:var(--tiny);color:var(--muted);margin:0;">
      <em>This calculator produces planning-level estimates only. It is not a substitute for
      lender underwriting, investor pricing, or legal/tax advice. Assumptions vary significantly
      by market, lender, and project type.</em>
    </p>
  </div>

</section>`;

    // Attach event listeners
    const ids = ['dc-tdc', 'dc-units', 'dc-basis-pct',
      'dc-chk-30', 'dc-chk-40', 'dc-chk-50', 'dc-chk-60',
      'dc-chk-70', 'dc-chk-80', 'dc-chk-100',
      'dc-units-30', 'dc-units-40', 'dc-units-50', 'dc-units-60',
      'dc-units-70', 'dc-units-80', 'dc-units-100',
      // P7: per-AMI-tier BR-type selectors
      'dc-br-30', 'dc-br-40', 'dc-br-50', 'dc-br-60',
      'dc-br-70', 'dc-br-80', 'dc-br-100',
      'dc-noi', 'dc-dcr', 'dc-rate', 'dc-term', 'dc-equity-price',
      'dc-vacancy', 'dc-opex', 'dc-rep-reserve', 'dc-prop-tax', 'dc-tax-exempt',
      // (Per-tranche fields wired below via renderSoftTranches.)
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
    });
    // Select elements also need 'change' listener for reliable cross-browser support
    var taxExemptSel = document.getElementById('dc-tax-exempt');
    if (taxExemptSel) taxExemptSel.addEventListener('change', recalculate);
    // P7: BR-type selectors fire 'change' not 'input'
    ['dc-br-30', 'dc-br-40', 'dc-br-50', 'dc-br-60', 'dc-br-70', 'dc-br-80', 'dc-br-100'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', recalculate);
    });
    // H — Wire the auto-balance checkbox so toggling it recomputes the gap.
    var autoBalanceChk2 = document.getElementById('dc-deferred-auto-balance');
    if (autoBalanceChk2) autoBalanceChk2.addEventListener('change', recalculate);
    // L6 — Year-15 exit inputs.
    ['dc-exit-hold', 'dc-exit-cap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
    });

    // G — Multi-tranche soft debt. Each tranche: {program, amount, mode, rate, term}.
    // We persist to an array and re-render on add/remove; per-row inputs fire
    // recalculate() on change so the pro forma + sources/uses stay live.
    var SOFT_PROGRAMS = [
      { v: 'chfa_htf',         l: 'CHFA HTF' },
      { v: 'prop123',          l: 'Prop 123' },
      { v: 'local_pha',        l: 'Local PHA / Housing Trust' },
      { v: 'chfa_cmf',         l: 'CHFA Capital Magnet Fund' },
      { v: 'dola_htf',         l: 'DOLA HTF' },
      { v: 'home',             l: 'HOME' },
      { v: 'cdbg',             l: 'CDBG' },
      { v: 'nhtf',             l: 'NHTF' },
      { v: 'impact_fee_loan',  l: 'Impact Fee Loan / Waiver' },
      { v: 'sponsor_loan',     l: 'Sponsor / Affiliate Loan' },
      { v: 'historic_tc',      l: 'Historic Tax Credit (cash equiv.)' },
      { v: 'nmtc',             l: 'NMTC (cash equiv.)' },
      { v: 'seller_carry',     l: 'Seller-carry note' },
      { v: 'other',            l: 'Other / custom' }
    ];
    var _softTranches = [];
    var _trancheCounter = 0;

    function _trancheRowHtml(t) {
      var idSuffix = t.id;
      var opts = SOFT_PROGRAMS.map(function (p) {
        return '<option value="' + p.v + '"' + (p.v === t.program ? ' selected' : '') + '>' + p.l + '</option>';
      }).join('');
      var inputCss = 'padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);width:100%;';
      var labelCss = 'font-size:var(--tiny);color:var(--muted);display:block;margin-bottom:0.15rem;';
      return ''
        + '<div data-tranche-id="' + idSuffix + '" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--bg2);">'
        + '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp2);gap:var(--sp2);">'
        + '    <select class="dc-tr-prog" aria-label="Soft-funding program (tranche ' + idSuffix + ')" style="' + inputCss + 'flex:1;">' + opts + '</select>'
        + '    <button type="button" class="dc-tr-remove" aria-label="Remove this tranche" '
        + '      style="background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:var(--radius);padding:0.2rem 0.5rem;cursor:pointer;font-size:var(--small);">✕</button>'
        + '  </div>'
        + '  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:var(--sp2);align-items:end;">'
        + '    <label><span style="' + labelCss + '">Amount ($)</span>'
        + '      <input class="dc-tr-amount" type="number" min="0" step="10000" value="' + (t.amount || 0) + '" style="' + inputCss + '">'
        + '    </label>'
        + '    <label><span style="' + labelCss + '">Rate (%)</span>'
        + '      <input class="dc-tr-rate" type="number" min="0" max="20" step="0.1" value="' + (t.rate != null ? t.rate : 3.0) + '" style="' + inputCss + '">'
        + '    </label>'
        + '    <label><span style="' + labelCss + '">Term (yrs)</span>'
        + '      <input class="dc-tr-term" type="number" min="1" max="50" step="1" value="' + (t.term || 30) + '" style="' + inputCss + '">'
        + '    </label>'
        + '  </div>'
        + '  <fieldset style="border:none;padding:0;margin:var(--sp2) 0 0;">'
        + '    <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:var(--tiny);color:var(--muted);margin-right:var(--sp3);">'
        + '      <input type="radio" class="dc-tr-mode" name="dc-tr-mode-' + idSuffix + '" value="loan"' + (t.mode === 'loan' ? ' checked' : '') + '> Loan — amortized'
        + '    </label>'
        + '    <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:var(--tiny);color:var(--muted);">'
        + '      <input type="radio" class="dc-tr-mode" name="dc-tr-mode-' + idSuffix + '" value="grant"' + (t.mode === 'grant' ? ' checked' : '') + '> Grant — reduces basis (§42(d)(5)(A))'
        + '    </label>'
        + '  </fieldset>'
        + '</div>';
    }

    function renderSoftTranches() {
      var host = document.getElementById('dc-soft-tranches');
      if (!host) return;
      if (_softTranches.length === 0) {
        // Seed with a default empty tranche so the UI isn't empty on first load.
        _softTranches.push({ id: ++_trancheCounter, program: 'chfa_htf', amount: 0, mode: 'loan', rate: 3.0, term: 30 });
      }
      host.innerHTML = _softTranches.map(_trancheRowHtml).join('');

      host.querySelectorAll('[data-tranche-id]').forEach(function (rowEl) {
        var trId = parseInt(rowEl.getAttribute('data-tranche-id'), 10);
        var t = _softTranches.find(function (x) { return x.id === trId; });
        if (!t) return;

        rowEl.querySelector('.dc-tr-prog').addEventListener('change', function () {
          t.program = this.value;
          recalculate();
        });
        rowEl.querySelector('.dc-tr-amount').addEventListener('input', function () {
          t.amount = parseFloat(this.value) || 0;
          recalculate();
        });
        rowEl.querySelector('.dc-tr-rate').addEventListener('input', function () {
          t.rate = parseFloat(this.value) || 0;
          recalculate();
        });
        rowEl.querySelector('.dc-tr-term').addEventListener('input', function () {
          t.term = Math.max(1, parseInt(this.value, 10) || 30);
          recalculate();
        });
        rowEl.querySelectorAll('.dc-tr-mode').forEach(function (modeRadio) {
          modeRadio.addEventListener('change', function () {
            if (this.checked) {
              t.mode = this.value;
              recalculate();
            }
          });
        });
        rowEl.querySelector('.dc-tr-remove').addEventListener('click', function () {
          _softTranches = _softTranches.filter(function (x) { return x.id !== trId; });
          renderSoftTranches();
          recalculate();
        });
      });
    }

    var addTrancheBtn = document.getElementById('dc-add-tranche');
    if (addTrancheBtn) {
      addTrancheBtn.addEventListener('click', function () {
        if (_softTranches.length >= 5) return;  // hard cap — keep UI scannable
        _softTranches.push({ id: ++_trancheCounter, program: 'prop123', amount: 0, mode: 'loan', rate: 0, term: 30 });
        renderSoftTranches();
        recalculate();
      });
    }
    // Expose getter so the recompute step (which lives in a different closure
    // scope) can read the current tranche list.
    window.DealCalcSoftTranches = function () { return _softTranches; };
    renderSoftTranches();

    // Auto-NOI toggle
    var autoNoiChk = document.getElementById('dc-auto-noi');
    var noiManualWrap = document.getElementById('dc-noi-manual-wrap');
    var noiAutoWrap = document.getElementById('dc-noi-auto-wrap');
    if (autoNoiChk) {
      autoNoiChk.addEventListener('change', function () {
        var on = autoNoiChk.checked;
        if (noiManualWrap) noiManualWrap.style.display = on ? 'none' : 'block';
        if (noiAutoWrap) noiAutoWrap.style.display = on ? 'block' : 'none';
        recalculate();
      });
    }

    // Developer fee slider label sync
    var devfeePctSlider = document.getElementById('dc-devfee-pct');
    var devfeePctLabel  = document.getElementById('dc-devfee-pct-label');
    if (devfeePctSlider && devfeePctLabel) {
      devfeePctSlider.addEventListener('input', function () {
        devfeePctLabel.textContent = parseFloat(devfeePctSlider.value).toFixed(1);
        recalculate();
      });
    }
    // Deferred % slider label sync
    var deferredPctSlider = document.getElementById('dc-deferred-pct');
    var deferredPctLabel  = document.getElementById('dc-deferred-pct-label');
    if (deferredPctSlider && deferredPctLabel) {
      deferredPctSlider.addEventListener('input', function () {
        deferredPctLabel.textContent = parseInt(deferredPctSlider.value, 10);
        recalculate();
      });
    }

    // Credit rate scenario toggle — also switches equity price default
    ['dc-rate-9', 'dc-rate-4'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          _creditRate = parseFloat(this.value);
          var is4Pct = (this.value === '0.04');
          var pabNote = document.getElementById('dc-rate-pab-note');
          if (pabNote) pabNote.style.display = is4Pct ? 'block' : 'none';
          // F25: refresh the note with the current county's bond cap when shown.
          if (is4Pct) _renderPabNote(_countyFips);

          // Update equity price default to match credit rate scenario
          var newDefault = is4Pct
            ? (_cfg.equityPrice4Pct || 0.85)
            : (_cfg.equityPrice9Pct || 0.90);
          EQUITY_PRICE_DEFAULT = newDefault;
          var eqInput = document.getElementById('dc-equity-price');
          if (eqInput) eqInput.value = newDefault.toFixed(2);

          recalculate();
        });
      }
    });

    // Toggle the QCT/DDA note when the checkbox changes
    var qctDdaChk = document.getElementById('dc-qct-dda');
    var qctDdaNote = document.getElementById('dc-qct-dda-note');
    if (qctDdaChk && qctDdaNote) {
      qctDdaChk.addEventListener('change', function () {
        qctDdaNote.style.display = qctDdaChk.checked ? 'block' : 'none';
        var qctStatus = document.getElementById('dc-assump-qct-status');
        if (qctStatus) qctStatus.textContent = qctDdaChk.checked ? 'indicated ✓' : 'not indicated';
        recalculate();
      });
    }

    // Sync slider label
    var basisSlider = document.getElementById('dc-basis-pct');
    var basisLabel = document.getElementById('dc-basis-pct-label');
    if (basisSlider && basisLabel) {
      basisSlider.addEventListener('input', function () {
        basisLabel.textContent = basisSlider.value;
      });
    }

    // Sync assumptions display when debt inputs change
    ['dc-dcr', 'dc-rate', 'dc-term'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var dcrEl = document.getElementById('dc-dcr');
        var rateEl = document.getElementById('dc-rate');
        var termEl = document.getElementById('dc-term');
        var assumDcr = document.getElementById('dc-assump-dcr');
        var assumRate = document.getElementById('dc-assump-rate');
        var assumTerm = document.getElementById('dc-assump-term');
        if (assumDcr && dcrEl) assumDcr.textContent = parseFloat(dcrEl.value).toFixed(2);
        if (assumRate && rateEl) assumRate.textContent = parseFloat(rateEl.value).toFixed(1) + '%';
        if (assumTerm && termEl) assumTerm.textContent = parseInt(termEl.value, 10) + ' years';
      });
    });

    // Methodology & Formulas panel — wire constants inputs to _constants
    // and recalculate. Each input edits one entry in _constants and
    // forces a full recalc so every panel (LIHTC equity, NOI, DSCR,
    // stress, rent achievability, gap) reflects the new assumption.
    var _constMap = {
      'dc-const-rent-burden': { key: 'rentBurdenPct',   factor: 0.01 },
      'dc-const-rent-stress': { key: 'rentStressPct',   factor: 0.01 },
      'dc-const-vac-stress':  { key: 'vacStressPp',     factor: 0.01 },
      'dc-const-opex-stress': { key: 'opexStressPct',   factor: 0.01 },
      'dc-const-comb-rent':   { key: 'combinedRentPct', factor: 0.01 },
      'dc-const-comb-vac':    { key: 'combinedVacPp',   factor: 0.01 },
      'dc-const-comb-opex':   { key: 'combinedOpexPct', factor: 0.01 }
    };
    Object.keys(_constMap).forEach(function (inputId) {
      var el = document.getElementById(inputId);
      if (!el) return;
      el.addEventListener('input', function () {
        var spec = _constMap[inputId];
        var v = parseFloat(el.value);
        if (isFinite(v) && v >= 0) {
          _constants[spec.key] = v * spec.factor;
        }
        // If rent burden changes, recompute AMI ceilings before recalc
        if (spec.key === 'rentBurdenPct' && _countyFips) {
          updateAmiLimitsFromFmr(_countyFips);
        }
        _renderConstantModifiedFlag();
        recalculate();
      });
    });
    var resetBtn = document.getElementById('dc-const-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        _constants = Object.assign({}, DEFAULT_CONSTANTS);
        // Restore default values to the input fields
        var def = {
          'dc-const-rent-burden': 30,
          'dc-const-rent-stress': 10,
          'dc-const-vac-stress':  5,
          'dc-const-opex-stress': 10,
          'dc-const-comb-rent':   5,
          'dc-const-comb-vac':    3,
          'dc-const-comb-opex':   5
        };
        Object.keys(def).forEach(function (id) {
          var fEl = document.getElementById(id);
          if (fEl) fEl.value = def[id];
        });
        if (_countyFips) updateAmiLimitsFromFmr(_countyFips);
        _renderConstantModifiedFlag();
        recalculate();
      });
    }

    recalculate();
  }

  // Show a "custom constants in use" warning when the user has overridden
  // any default. Helps bankers avoid forgetting they're not on industry
  // standard assumptions.
  function _renderConstantModifiedFlag() {
    var flag = document.getElementById('dc-const-modified-flag');
    if (!flag) return;
    var modified = Object.keys(DEFAULT_CONSTANTS).some(function (k) {
      return Math.abs(_constants[k] - DEFAULT_CONSTANTS[k]) > 1e-9;
    });
    flag.style.display = modified ? '' : 'none';
  }

  // -------------------------------------------------------------------
  // Core calculation
  // -------------------------------------------------------------------
  function recalculate() {
    function fmt(n) {
      if (!isFinite(n)) return '—';
      return '$' + Math.round(n).toLocaleString('en-US');
    }
    function fmtPct(n) {
      if (!isFinite(n) || n === 0) return '—';
      return (n * 100).toFixed(1) + '%';
    }
    function safeVal(id) {
      var el = document.getElementById(id);
      if (!el) return NaN;
      return parseFloat(el.value);
    }

    var tdc = safeVal('dc-tdc') || 0;
    var units = safeVal('dc-units') || 0;
    var basisPct = (safeVal('dc-basis-pct') || 80) / 100;
    var equityPrice = safeVal('dc-equity-price');
    if (!isFinite(equityPrice) || equityPrice <= 0) equityPrice = EQUITY_PRICE_DEFAULT;

    // G — Multi-tranche soft debt. Aggregate across the tranche list:
    //   grants  → subtract from basis (§42(d)(5)(A)) AND fill gap at closing
    //   loans   → contribute to gap close at closing AND amortize as annual debt service
    // Tranches read from the renderSoftTranches() state (window-exposed getter).
    var tranches = (typeof window.DealCalcSoftTranches === 'function') ? (window.DealCalcSoftTranches() || []) : [];
    var totalGrant = 0;
    var totalLoanPrincipal = 0;
    var totalSoftDebtService = 0;
    var trancheBreakdown = [];   // for sources/uses rendering
    tranches.forEach(function (t) {
      var amt = Math.max(0, t.amount || 0);
      if (amt <= 0) return;
      if (t.mode === 'grant') {
        totalGrant += amt;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'grant', amount: amt, debtService: 0 });
      } else {
        totalLoanPrincipal += amt;
        var rPct = Math.max(0, t.rate || 0);
        var trm = Math.max(1, t.term || 30);
        var mcT = mortgageConstant(rPct / 100, trm);
        // Zero-interest public loans amortize straight-line principal.
        var ds = rPct > 0 ? (amt * mcT) : (amt / trm);
        totalSoftDebtService += ds;
        trancheBreakdown.push({ id: t.id, program: t.program, mode: 'loan', amount: amt, debtService: ds, rate: rPct, term: trm });
      }
    });
    // Backward-compat aliases for the rest of the calc path.
    var impactGrant = totalGrant;
    var impactDebtService = totalSoftDebtService;
    var impactMode = totalGrant > 0 ? 'grant' : 'loan';

    // Rent income — sum checked AMI-tier units. Track LIHTC-eligible
    // (≤60% AMI) vs market/workforce (70/80/100% AMI) unit counts
    // separately so we can apply the IRC §42(c)(1)(B) "applicable
    // fraction" to eligible basis for mixed-income deals.
    var annualRents = 0;
    var amiUnitSum = 0;
    var lihtcUnits = 0;     // units at ≤60% AMI (count toward LIHTC qualified basis)
    var marketUnits = 0;    // units at >60% AMI (excluded from LIHTC qualified basis)
    // _amiLimits is null until the user selects a county. Skip the rent roll
    // entirely rather than fabricating Denver MSA rents — NaN propagation
    // through the pro-forma would mislead more than a visible zero.
    // P7: per-tier BR-type selector. Each tier's rent = units × per-BR rent
    // ceiling × 12. Falls back to the legacy flat _amiLimits[pct] (= 2BR
    // default) if the BR breakdown isn't available yet.
    //
    // Q5: When the "achievable-rent cap" toggle is ON, the 70/80/100% AMI
    // workforce tiers underwrite at min(LIHTC ceiling, ZORI market). The
    // 30-60% AMI LIHTC ceilings rarely exceed market and are not capped.
    var capChk = document.getElementById('dc-achievable-cap');
    var capOn = !!(capChk && capChk.checked);
    var perBrMarket = (capOn && _countyFips) ? getZoriPerBrRent(_countyFips) : null;
    var capBindings = [];   // tiers where the cap actually reduced revenue
    [30, 40, 50, 60, 70, 80, 100].forEach(function (pct) {
      var chk = document.getElementById('dc-chk-' + pct);
      var uInput = document.getElementById('dc-units-' + pct);
      var brSel = document.getElementById('dc-br-' + pct);
      if (chk && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        var br = (brSel && brSel.value) || '2br';
        if (chk.checked) {
          var perUnitRent = 0;
          if (_amiLimitsByBr && _amiLimitsByBr[pct] && _amiLimitsByBr[pct][br]) {
            perUnitRent = _amiLimitsByBr[pct][br];
          } else if (_amiLimits && _amiLimits[pct]) {
            perUnitRent = _amiLimits[pct];  // legacy 2BR fallback
          }
          // Q5: apply market-rent cap only to workforce tiers (pct ≥ 70)
          if (capOn && perBrMarket && pct >= 70) {
            var mkt = perBrMarket[br];
            if (typeof mkt === 'number' && mkt > 0 && mkt < perUnitRent) {
              capBindings.push({ pct: pct, br: br, ceiling: perUnitRent, market: mkt, units: u });
              perUnitRent = mkt;
            }
          }
          annualRents += u * perUnitRent * 12;
        }
        amiUnitSum += u; // count all tier units regardless of checkbox
        if (chk.checked) {
          if (pct <= 60) lihtcUnits  += u;
          else           marketUnits += u;
        }
      }
    });

    // Q5: surface the achievable-rent cap status on the UI.
    _renderAchievableCapStatus(capOn, perBrMarket, capBindings);

    // Applicable fraction (IRC §42(c)(1)(B)): for mixed-income deals
    // qualified basis = eligible basis × min(unit fraction, floor-area fraction).
    // We don't track floor area separately, so use the unit fraction.
    // For pure-LIHTC deals (no market units), this is 1.0.
    var totalLihtcEligibleAndMarket = lihtcUnits + marketUnits;
    var applicableFraction = totalLihtcEligibleAndMarket > 0
      ? lihtcUnits / totalLihtcEligibleAndMarket
      : 1.0;

    // LIHTC credit calculations — grants reduce eligible basis per
    // §42(d)(5)(A); applicable fraction prorates basis when market-rate
    // units are present.
    var eligibleBasisRaw = Math.max(0, (tdc * basisPct) - impactGrant);
    var eligibleBasis    = eligibleBasisRaw * applicableFraction;
    var annualCredits    = eligibleBasis * _creditRate;
    var equity           = annualCredits * CREDIT_YEARS * equityPrice;

    // Surface the applicable-fraction math when market units present
    var afNoteEl = document.getElementById('dc-applicable-fraction-note');
    if (afNoteEl) {
      if (marketUnits > 0 && lihtcUnits > 0) {
        afNoteEl.innerHTML =
          '<strong style="color:var(--accent,#096e65);">Mixed-income deal:</strong> ' +
          lihtcUnits + ' LIHTC units / ' + totalLihtcEligibleAndMarket +
          ' total = applicable fraction <strong>' + (applicableFraction * 100).toFixed(1) + '%</strong>. ' +
          'Eligible basis prorated to ' + fmt(eligibleBasis) +
          ' (vs ' + fmt(eligibleBasisRaw) + ' if 100% LIHTC). ' +
          'Market-rate units generate rent but no tax credits per IRC §42(c)(1)(B).';
        afNoteEl.hidden = false;
      } else {
        afNoteEl.hidden = true;
      }
    }

    // Unit-mix integrity check (replaces the pre-2026-05-09 soft warning).
    //
    // Three states based on the relationship between Total Units and the
    // sum of AMI-tier units:
    //
    //   sum > total   → HARD ERROR. Physically impossible — AMI tiers
    //                   can't exceed total units. Show error styling +
    //                   block downstream calc by zeroing rents.
    //   sum < total   → Informational. The diff IS the unrestricted
    //                   market-rate unit count (units with no AMI
    //                   restriction). Surface explicitly so users
    //                   understand what they're modeling.
    //   sum === total → All clear; hide the indicator.
    //
    // Pre-fix: a soft warning told users "align both inputs" without
    // explaining what alignment meant. Result: users entered AMI sums
    // that exceeded total without realizing it was logically impossible.
    var syncWarn = document.getElementById('dc-units-sync-warn');
    var unitMixError = false;
    if (syncWarn) {
      if (units > 0 && amiUnitSum > units) {
        // HARD ERROR — AMI tiers exceed total
        syncWarn.style.background = '#fee2e2';
        syncWarn.style.borderColor = '#fca5a5';
        syncWarn.style.color = '#991b1b';
        syncWarn.innerHTML =
          '❌ <strong>AMI-tier units (' + amiUnitSum + ') exceed Total Units (' + units +
          ').</strong> Each AMI tier is a subset of the total — they cannot sum to more ' +
          'than the total. Reduce one or more tier inputs, or increase Total Units.';
        syncWarn.hidden = false;
        unitMixError = true;
      } else if (units > 0 && amiUnitSum > 0 && amiUnitSum < units) {
        // INFORMATIONAL — diff is unrestricted market-rate units
        var unrestrictedUnits = units - amiUnitSum;
        syncWarn.style.background = '#eff6ff';   // light blue
        syncWarn.style.borderColor = '#93c5fd';
        syncWarn.style.color = '#1e3a8a';
        syncWarn.innerHTML =
          'ℹ <strong>' + unrestrictedUnits + ' unrestricted market-rate unit' +
          (unrestrictedUnits === 1 ? '' : 's') + '</strong> ' +
          '(Total ' + units + ' − AMI-tier sum ' + amiUnitSum + '). ' +
          'These have no AMI restriction and generate no LIHTC equity. ' +
          'If you meant all units to be tier-restricted, increase a tier or reduce Total.';
        syncWarn.hidden = false;
      } else {
        syncWarn.hidden = true;
      }
    }
    // When unit-mix is logically broken, suppress rent-driven outputs to
    // avoid showing spurious NOI / equity numbers downstream.
    if (unitMixError) {
      annualRents = 0;
    }

    // Developer fee
    var devfeePctEl = document.getElementById('dc-devfee-pct');
    var devfeePct = devfeePctEl ? (parseFloat(devfeePctEl.value) || 15) / 100 : 0.15;
    var devFeeTotal = tdc * devfeePct;
    var deferredPctEl = document.getElementById('dc-deferred-pct');
    var deferredPctSlider = deferredPctEl ? (parseFloat(deferredPctEl.value) || 40) / 100 : 0.40;

    // H — Auto-balance deferred developer fee. When the user toggles
    // "Auto-balance gap with deferred dev fee," any remaining gap after
    // equity + mortgage + grants + soft-loan principal gets backfilled by
    // deferring up to the slider cap of the developer fee. Mirrors the
    // Anthracite $185k pattern where deferred fee is the last-resort
    // balancing source.
    var autoBalanceChk = document.getElementById('dc-deferred-auto-balance');
    var autoBalance = !!(autoBalanceChk && autoBalanceChk.checked);
    var deferredDevFeeManual = devFeeTotal * deferredPctSlider;
    var deferredDevFee = deferredDevFeeManual;

    // Developer fee display — deferred and closing values are finalized
    // AFTER the gap + auto-balance logic below; refresh both here for now
    // (devFeeTotal is fixed) and again after auto-balance in the same pass.
    var devfeeEl = document.getElementById('dc-r-devfee');
    if (devfeeEl) devfeeEl.textContent = tdc > 0 ? fmt(devFeeTotal) : '—';

    // Auto-NOI or manual NOI
    var autoNoi = document.getElementById('dc-auto-noi');
    var noi;
    var annualOpex = null;
    var annualRepReserve = null;
    var netPropTax = null;
    var taxSavings = 0;
    if (autoNoi && autoNoi.checked) {
      var vacancyPct = (safeVal('dc-vacancy') || 5) / 100;
      // Do NOT silently substitute Denver-MSA defaults (450/350/900) when
      // any of these fields are blank — they vary materially across CO
      // counties (rural opex often $250-350/mo vs. $450 Denver). A blank
      // field should visibly zero the line, not fabricate a plausible
      // Front-Range number. UI fields keep their initial defaults via the
      // input `value` attribute so users see suggestions, but clearing a
      // field now surfaces as "0" rather than silent substitution.
      var opexPerUnitMonth = safeVal('dc-opex');
      var repReservePerUnit = safeVal('dc-rep-reserve');
      var propTaxPerUnit = safeVal('dc-prop-tax');
      if (!isFinite(opexPerUnitMonth) || opexPerUnitMonth < 0) opexPerUnitMonth = 0;
      if (!isFinite(repReservePerUnit) || repReservePerUnit < 0) repReservePerUnit = 0;
      if (!isFinite(propTaxPerUnit) || propTaxPerUnit < 0) propTaxPerUnit = 0;
      var effectiveGrossIncome = annualRents * (1 - vacancyPct);
      annualOpex = opexPerUnitMonth * 12 * (units || 60);
      annualRepReserve = repReservePerUnit * (units || 60);
      var taxExemptPct = (safeVal('dc-tax-exempt') || 0) / 100;
      var annualPropTax = propTaxPerUnit * (units || 60);
      taxSavings = annualPropTax * taxExemptPct;
      netPropTax = annualPropTax - taxSavings;
      noi = effectiveGrossIncome - annualOpex - annualRepReserve - netPropTax;
      var noiComputedEl = document.getElementById('dc-noi-computed');
      if (noiComputedEl) noiComputedEl.textContent = isFinite(noi) ? fmt(noi) : '—';
    } else {
      noi = safeVal('dc-noi') || 0;
    }

    // Supportable first mortgage
    var dcr = safeVal('dc-dcr');
    if (!isFinite(dcr) || dcr < 1.05) dcr = 1.20;
    if (dcr > 2.0) dcr = 2.0;
    var interestRate = safeVal('dc-rate');
    if (!isFinite(interestRate) || interestRate < 3.0) interestRate = 6.5;
    if (interestRate > 12.0) interestRate = 12.0;
    var term = safeVal('dc-term');
    if (!isFinite(term) || term <= 0) term = 35;

    var mc = mortgageConstant(interestRate / 100, term);
    var mortgage = (mc > 0 && noi > 0) ? (noi / dcr) / mc : 0;

    // Cap rate and break-even occupancy
    var capRate = (noi > 0 && tdc > 0) ? (noi / tdc) : null;
    var annualDebtService = mc > 0 ? mortgage * mc : 0;
    var breakEvenOcc = annualRents > 0
      ? (annualOpex != null && annualRepReserve != null
          ? Math.min((annualOpex + annualRepReserve + (netPropTax || 0) + annualDebtService) / annualRents, 1)
          : null)
      : null;

    // ── DSCR + stress scenarios ──────────────────────────────────────
    //
    // By construction, baseDSCR === target DCR (mortgage was sized at
    // noi/dcr). The real value is in the stress table: recompute NOI
    // under {rent -10%, vacancy +5pts, opex +10%, combined -5/+3/+5}
    // and divide by the CURRENT debt service (loan is already sized
    // at stabilization). A banker/syndicator reads this to answer:
    // "does the deal still cover debt if the market goes sideways?"
    //
    // Only computable when auto-NOI is on — manual NOI mode doesn't
    // give us rent/vac/opex components to perturb.
    var dscrAutoMode = !!(autoNoi && autoNoi.checked);
    var baseDSCR = annualDebtService > 0 ? noi / annualDebtService : null;
    var stress = null;
    if (dscrAutoMode) {
      stress = computeDscrStressScenarios({
        annualRents:      annualRents,
        vacancyPct:       (safeVal('dc-vacancy') || 5) / 100,
        annualOpex:       annualOpex       || 0,
        annualRepReserve: annualRepReserve || 0,
        netPropTax:       netPropTax       || 0,
        annualDebtService: annualDebtService
      }, _constants);
    }

    // Sources & uses — equity + mortgage + grants + soft-loan principal
    // close the gap at closing. (Soft loans contribute principal to the
    // sources stack AND show up as annual debt service in the pro forma.)
    //
    // H — Deferred dev fee behavior controlled by the auto-balance checkbox:
    //   • ON  → defer JUST ENOUGH to fill remaining gap, capped at slider %
    //           (mirrors Anthracite $185k pattern: last-resort balancing)
    //   • OFF → defer EXACTLY the slider % of total dev fee, regardless of gap
    //           (legacy behavior — manual deferral)
    var deferredCap = devFeeTotal * deferredPctSlider;
    var gapBeforeDeferred = tdc - equity - mortgage - impactGrant - totalLoanPrincipal;
    if (autoBalance) {
      // Defer the smaller of (gap, cap) — never more than needed, never above cap.
      deferredDevFee = Math.max(0, Math.min(deferredCap, gapBeforeDeferred));
    } else {
      deferredDevFee = deferredCap;
    }
    var devFeeAtClosing = devFeeTotal - deferredDevFee;
    var gap = gapBeforeDeferred - deferredDevFee;

    // H — Refresh deferred + closing display now that auto-balance has
    // finalized the deferredDevFee value. (devFeeTotal is invariant.)
    var deferredEl = document.getElementById('dc-r-deferred');
    var devfeeClosingEl = document.getElementById('dc-r-devfee-closing');
    if (deferredEl) deferredEl.textContent = tdc > 0 ? fmt(deferredDevFee) : '—';
    if (devfeeClosingEl) devfeeClosingEl.textContent = tdc > 0 ? fmt(devFeeAtClosing) : '—';
    // Mark the deferred row so the user sees the auto-balance decision.
    var autoNote = document.getElementById('dc-deferred-auto-note');
    if (autoNote) {
      if (autoBalance) {
        if (deferredDevFee >= deferredCap - 1 && gapBeforeDeferred > deferredCap) {
          autoNote.textContent = 'Hit cap: deferring max ' + fmt(deferredCap) +
            ' (' + (deferredPctSlider * 100).toFixed(0) + '% of dev fee). Remaining ' + fmt(gap) +
            ' still needs subordinate debt or additional grants.';
          autoNote.hidden = false;
        } else if (deferredDevFee > 1) {
          autoNote.textContent = 'Auto-balanced to ' + fmt(deferredDevFee) +
            ' — exactly fills the gap (cap was ' + fmt(deferredCap) + ').';
          autoNote.hidden = false;
        } else {
          autoNote.textContent = 'Deal is balanced without deferring fee — no auto-deferral needed.';
          autoNote.hidden = false;
        }
      } else {
        autoNote.hidden = true;
      }
    }

    // Update LIHTC results
    document.getElementById('dc-r-basis').textContent = tdc > 0 ? fmt(eligibleBasis) : '—';
    document.getElementById('dc-r-credits').textContent = tdc > 0 ? fmt(annualCredits) : '—';
    document.getElementById('dc-r-equity').textContent = tdc > 0 ? fmt(equity) : '—';
    document.getElementById('dc-r-rents').textContent = fmt(annualRents);

    // Update mortgage results
    document.getElementById('dc-r-mc').textContent = mc > 0 ? (mc * 100).toFixed(4) + '%' : '—';
    document.getElementById('dc-r-mortgage').textContent = noi > 0 ? fmt(mortgage) : '—';

    // Update cap rate and break-even occupancy
    var capRateEl = document.getElementById('dc-r-cap-rate');
    if (capRateEl) capRateEl.textContent = capRate != null ? (capRate * 100).toFixed(2) + '%' : '—';
    var beoEl = document.getElementById('dc-r-beo');
    if (beoEl) beoEl.textContent = breakEvenOcc != null ? (breakEvenOcc * 100).toFixed(1) + '%' : '—';

    // ── Render DSCR + stress table ─────────────────────────────────
    // Color thresholds — banker/syndicator convention:
    //   ≥ 1.20  strong   (green)
    //   1.10-1.19 adequate (neutral / text color)
    //   1.00-1.09 marginal (amber)
    //   < 1.00   fails     (red)
    function _dscrColor(v) {
      if (v == null || !isFinite(v)) return 'var(--muted)';
      if (v >= 1.20) return 'var(--good, #047857)';
      if (v >= 1.10) return 'var(--text)';
      if (v >= 1.00) return 'var(--warn, #d97706)';
      return 'var(--bad, #dc2626)';
    }
    function _setDscr(id, v) {
      var el = document.getElementById(id);
      if (!el) return;
      if (v == null || !isFinite(v)) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
      el.textContent = v.toFixed(2) + 'x';
      el.style.color = _dscrColor(v);
    }
    function _setMargin(id, v, target) {
      var el = document.getElementById(id);
      if (!el) return;
      if (v == null || !isFinite(v) || target == null) { el.textContent = '—'; return; }
      var delta = v - target;
      var sign = delta >= 0 ? '+' : '';
      el.textContent = sign + delta.toFixed(2);
      el.style.color = delta >= 0 ? 'var(--good, #047857)' : 'var(--warn, #d97706)';
    }

    var noiStabEl = document.getElementById('dc-r-noi-stab');
    if (noiStabEl) noiStabEl.textContent = (dscrAutoMode && isFinite(noi)) ? fmt(noi)
                                         : (!dscrAutoMode && noi > 0)      ? fmt(noi) + ' (manual)'
                                         : '—';

    var adsEl = document.getElementById('dc-r-ads');
    if (adsEl) adsEl.textContent = annualDebtService > 0 ? fmt(annualDebtService) : '—';

    _setDscr('dc-r-dscr-base', baseDSCR);

    var targetNote = document.getElementById('dc-dscr-target-note');
    if (targetNote) {
      if (baseDSCR != null && isFinite(baseDSCR)) {
        targetNote.textContent = 'Sized to target DCR ' + dcr.toFixed(2) + 'x · the stress table below shows how DSCR moves if rents, vacancy, or operating costs shift.';
      } else {
        targetNote.textContent = 'Enter NOI (or enable auto-compute) and mortgage terms to see DSCR.';
      }
    }

    var manualNote = document.getElementById('dc-dscr-manual-note');
    var stressTableEl = document.getElementById('dc-dscr-stress-table');
    if (manualNote && stressTableEl) {
      if (stress) {
        manualNote.style.display = 'none';
        stressTableEl.style.display = '';
      } else {
        manualNote.style.display = '';
        stressTableEl.style.display = 'none';
      }
    }

    if (stress) {
      ['rent10', 'vac5', 'opex10', 'combined'].forEach(function (k) {
        var row = stress[k];
        var noiEl = document.getElementById('dc-r-stress-' + k + '-noi');
        if (noiEl) noiEl.textContent = isFinite(row.noi) ? fmt(row.noi) : '—';
        _setDscr('dc-r-stress-' + k + '-dscr', row.dscr);
        _setMargin('dc-r-stress-' + k + '-margin', row.dscr, dcr);
      });
    }

    // ── Render the live formula example (60% AMI ceiling) ──────────
    // Surfaces "AMI 124,100 × 60% × 30% / 12 = $1,862" so the user
    // can see what their rent-burden % choice produces at the most
    // common LIHTC tier.
    var ceilingEgEl = document.getElementById('dc-formula-ceiling-eg');
    if (ceilingEgEl) {
      var hudFmr2 = window.HudFmr;
      var il = (hudFmr2 && _countyFips) ? hudFmr2.getIncomeLimitsByFips(_countyFips) : null;
      if (il && il.ami_4person) {
        var burdenPct = (_constants.rentBurdenPct * 100).toFixed(0);
        var ceilingAt60 = Math.round((il.ami_4person * 0.60 * _constants.rentBurdenPct) / 12);
        ceilingEgEl.textContent = '@ 60% AMI: $' + il.ami_4person.toLocaleString() +
          ' × 60% × ' + burdenPct + '% ÷ 12 = ' + fmt(ceilingAt60) + '/mo';
      } else {
        ceilingEgEl.textContent = 'Select a county to see the live example';
      }
    }

    // ── Render rent-achievability table ────────────────────────────
    // Pulls the AMI-tier rent ceilings from _amiLimits (already populated
    // by HudFmr for the selected county) and the HUD FMR 2BR benchmark
    // via HudFmr.getFmrByFips. Null-safe: shows the "select a county"
    // message when data isn't available yet.
    var achBody = document.getElementById('dc-rent-ach-body');
    var fmrGrid = document.getElementById('dc-rent-ach-fmr-grid');
    var fmrData = (window.HudFmr && _countyFips) ? window.HudFmr.getFmrByFips(_countyFips) : null;
    var achResult = (_amiLimits && fmrData) ? computeRentAchievability({
      amiLimits: _amiLimits,
      fmr:       fmrData
    }) : null;

    if (achBody && achResult) {
      var statusLabel = {
        clear:       '✓ Rents clear market',
        tight:       '~ Tight — thin buffer',
        concerning:  '⚠ Above market',
        misaligned:  '⚠⚠ Ceiling > market'
      };
      var statusColor = {
        clear:       'var(--good, #047857)',
        tight:       'var(--text)',
        concerning:  'var(--warn, #d97706)',
        misaligned:  'var(--bad, #dc2626)'
      };
      achBody.innerHTML = achResult.tiers.map(function (t) {
        var gapSign = t.gap > 0 ? '+' : (t.gap < 0 ? '' : '');
        var gapColor = t.gap <= 0 ? 'var(--good, #047857)'
                     : t.gap <= 50 ? 'var(--text)'
                     : t.gap <= 200 ? 'var(--warn, #d97706)'
                     : 'var(--bad, #dc2626)';
        return '<tr>' +
          '<td style="padding:0.3rem 0.25rem;">' + t.pct + '% AMI</td>' +
          '<td style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">' + fmt(t.ceiling) + '/mo</td>' +
          '<td style="text-align:right;padding:0.3rem 0.25rem;">' + fmt(t.fmr2br) + '/mo</td>' +
          '<td style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;color:' + gapColor + ';">' + gapSign + fmt(t.gap) + '</td>' +
          '<td style="padding:0.3rem 0.25rem;color:' + statusColor[t.status] + ';font-weight:600;">' + statusLabel[t.status] + '</td>' +
        '</tr>';
      }).join('');

      // Populate the per-bedroom FMR row
      if (fmrGrid) {
        fmrGrid.style.display = '';
        var bedroomCells = [
          ['dc-fmr-studio', fmrData.efficiency],
          ['dc-fmr-1br',    fmrData.one_br],
          ['dc-fmr-2br',    fmrData.two_br],
          ['dc-fmr-3br',    fmrData.three_br],
          ['dc-fmr-4br',    fmrData.four_br]
        ];
        bedroomCells.forEach(function (c) {
          var el = document.getElementById(c[0]);
          if (el) el.textContent = (typeof c[1] === 'number' && c[1] > 0) ? fmt(c[1]) : '—';
        });
      }
    } else if (achBody) {
      achBody.innerHTML = '<tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Select a county to see rent-achievability check.</td></tr>';
      if (fmrGrid) fmrGrid.style.display = 'none';
    }

    // ── Render Peer Deals table ────────────────────────────────────
    // Pulls comparable LIHTC projects from window.HudLihtc (loaded
    // lazily on first county selection) and renders the top 5 by
    // recency + size proximity. No fabricated data — empty state if
    // nothing matches.
    var peersBody  = document.getElementById('dc-peers-body');
    var peersEmpty = document.getElementById('dc-peers-empty');
    var creditFor4 = document.getElementById('dc-rate-4');
    var creditTypeForPeers = (creditFor4 && creditFor4.checked) ? '4%' : '9%';
    var hudLihtc = window.HudLihtc;
    var lihtcFeats = (hudLihtc && hudLihtc.isLoaded && hudLihtc.isLoaded() && hudLihtc.getFeatures)
      ? hudLihtc.getFeatures() : [];

    if (peersBody) {
      if (!_countyFips) {
        peersBody.innerHTML = '<tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Select a county to see peer deals.</td></tr>';
        if (peersEmpty) peersEmpty.style.display = 'none';
      } else if (lihtcFeats.length === 0) {
        peersBody.innerHTML = '<tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Loading LIHTC project database…</td></tr>';
        if (peersEmpty) peersEmpty.style.display = 'none';
        // Trigger a load once if we haven't tried yet
        if (hudLihtc && hudLihtc.load && !window.__dcPeerLoadTried) {
          window.__dcPeerLoadTried = true;
          hudLihtc.load().then(function () { recalculate(); }).catch(function () {});
        }
      } else {
        var peers = findPeerDeals({
          features:      lihtcFeats,
          countyFips:    _countyFips,
          creditType:    creditTypeForPeers,
          proposedUnits: units,
          limit:         5
        });
        if (peers.length === 0) {
          peersBody.innerHTML = '';
          if (peersEmpty) {
            peersEmpty.style.display = '';
            peersEmpty.textContent = 'No comparable LIHTC projects found in this county for ' + creditTypeForPeers + ' credits. Try the other credit type, or look at county-adjacent comps in the Historical Trends page.';
          }
        } else {
          if (peersEmpty) peersEmpty.style.display = 'none';
          peersBody.innerHTML = peers.map(function (p) {
            var flags = [];
            if (p.isQct)     flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--good-dim,#d1fae5);color:var(--good,#047857);margin-right:3px;" title="Qualified Census Tract">QCT</span>');
            if (p.isDda)     flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--info-dim,#dbeafe);color:var(--info,#2563eb);margin-right:3px;" title="Difficult Development Area">DDA</span>');
            if (p.isNonProf) flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--accent-dim,#d1fae5);color:var(--accent,#096e65);margin-right:3px;" title="Non-profit sponsor">NP</span>');
            // Highlight size match
            var sizeProximity = units > 0 ? Math.abs(p.units - units) : null;
            var unitColor = (sizeProximity !== null && sizeProximity <= Math.max(10, units * 0.2)) ? 'var(--good,#047857)' : 'var(--text)';
            return '<tr style="border-bottom:1px solid var(--border);">' +
              '<td style="padding:0.3rem 0.25rem;font-weight:600;">' + p.name +
                (p.creditType !== '—' ? ' <span style="font-size:var(--tiny);color:var(--muted);font-weight:400;">' + p.creditType + '</span>' : '') +
              '</td>' +
              '<td style="padding:0.3rem 0.25rem;color:var(--muted);font-size:var(--tiny);">' + (p.city || '—') + '</td>' +
              '<td style="text-align:right;padding:0.3rem 0.25rem;">' + (p.yearPis || p.yearAlloc || '—') + '</td>' +
              '<td style="text-align:right;padding:0.3rem 0.25rem;font-weight:600;color:' + unitColor + ';">' + (p.units || '—') + '</td>' +
              '<td style="padding:0.3rem 0.25rem;">' + (flags.join('') || '<span style="color:var(--muted);font-size:var(--tiny);">—</span>') + '</td>' +
            '</tr>';
          }).join('');
        }
      }
    }

    // Update property tax display (only visible in auto-NOI mode)
    var showPropTax = (netPropTax != null);
    var showTaxSavings = (showPropTax && taxSavings > 0);
    ['dc-r-proptax-label', 'dc-r-proptax'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = showPropTax ? '' : 'none';
    });
    ['dc-r-taxsave-label', 'dc-r-taxsave'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = showTaxSavings ? '' : 'none';
    });
    var propTaxEl = document.getElementById('dc-r-proptax');
    if (propTaxEl && showPropTax) propTaxEl.textContent = fmt(netPropTax);
    var taxSaveEl = document.getElementById('dc-r-taxsave');
    if (taxSaveEl && showTaxSavings) taxSaveEl.textContent = fmt(taxSavings);

    // Update gap note (legacy)
    var note = document.getElementById('dc-gap-note');
    if (note) {
      if (tdc > 0 && equity > 0) {
        var simpleGap = tdc - equity;
        if (simpleGap > 0) {
          note.textContent = 'Equity covers ' + fmtPct(equity / tdc) + ' of TDC.';
        } else {
          note.textContent = 'Equity exceeds TDC — verify basis and credit rate inputs.';
        }
        note.style.display = 'block';
      } else {
        note.style.display = 'none';
      }
    }

    // G — Update Sources & Uses to render the full multi-tranche stack.
    // The legacy "dc-su-impact-ds" row now displays the AGGREGATE of all
    // soft tranches (grants + loan principal contributing to sources).
    // Per-tranche detail is rendered into #dc-su-tranches-detail below.
    var totalSoftSourceAmt = totalGrant + totalLoanPrincipal;
    var impactLabelEl = document.getElementById('dc-su-impact-label');
    var impactNoteEl  = document.getElementById('dc-su-impact-note');
    if (impactLabelEl) {
      impactLabelEl.textContent = 'Soft-funding stack (' + tranches.filter(function (t) { return (t.amount||0) > 0; }).length + ' tranches)';
    }
    if (impactNoteEl) {
      var parts = [];
      if (totalGrant > 0) parts.push(fmt(totalGrant) + ' grants reduce basis');
      if (totalLoanPrincipal > 0) parts.push(fmt(totalLoanPrincipal) + ' loans @ ' + fmt(totalSoftDebtService) + '/yr debt service');
      impactNoteEl.textContent = parts.length ? parts.join(' · ') : 'Add tranches to model CHFA / Prop 123 / local PHA stack.';
    }

    // Update Sources & Uses table
    var su = {
      equity:   { amt: equity,             id: 'dc-su-equity' },
      mortgage: { amt: mortgage,           id: 'dc-su-mortgage' },
      deferred: { amt: deferredDevFee,     id: 'dc-su-deferred' },
      impactds: { amt: totalSoftSourceAmt, id: 'dc-su-impact-ds' },
      gap:      { amt: gap,                id: 'dc-su-gap' },
      tdc:      { amt: tdc,                id: 'dc-su-tdc' }
    };
    ['equity', 'mortgage', 'deferred', 'impactds', 'gap', 'tdc'].forEach(function (key) {
      var row = su[key];
      var amtEl = document.getElementById(row.id);
      var pctEl = document.getElementById(row.id + '-pct');
      if (amtEl) amtEl.textContent = tdc > 0 ? fmt(row.amt) : '—';
      if (pctEl) pctEl.textContent = tdc > 0 ? fmtPct(row.amt / tdc) : '—';
    });

    // Render per-tranche detail (between the aggregate row and the gap row).
    var trDetailEl = document.getElementById('dc-su-tranches-detail');
    if (trDetailEl) {
      var progLabels = {};
      // Mirror the SOFT_PROGRAMS lookup table from the wiring closure.
      [
        ['chfa_htf','CHFA HTF'],['prop123','Prop 123'],['local_pha','Local PHA / Housing Trust'],
        ['chfa_cmf','CHFA CMF'],['dola_htf','DOLA HTF'],['home','HOME'],['cdbg','CDBG'],
        ['nhtf','NHTF'],['impact_fee_loan','Impact Fee'],['sponsor_loan','Sponsor Loan'],
        ['historic_tc','Historic TC'],['nmtc','NMTC'],['seller_carry','Seller-carry'],['other','Other']
      ].forEach(function (kv) { progLabels[kv[0]] = kv[1]; });
      if (trancheBreakdown.length === 0) {
        trDetailEl.innerHTML = '';
      } else {
        trDetailEl.innerHTML = trancheBreakdown.map(function (t) {
          var label = (progLabels[t.program] || t.program) +
            ' — ' + (t.mode === 'grant'
              ? '<span style="color:var(--accent)">grant</span>'
              : (t.rate > 0 ? t.rate + '% · ' + t.term + 'y' : '0% · ' + t.term + 'y straight-line'));
          var amtText = fmt(t.amount) + (t.mode === 'loan' && t.debtService > 0
            ? ' <span style="font-size:var(--tiny);color:var(--muted)">(' + fmt(t.debtService) + '/yr)</span>'
            : '');
          return '<tr style="background:transparent;">' +
                 '  <td style="padding:0.2rem 0.25rem 0.2rem 1.5rem;font-size:var(--tiny);color:var(--muted);">↳ ' + label + '</td>' +
                 '  <td style="text-align:right;font-size:var(--tiny);padding:0.2rem 0.25rem;">' + amtText + '</td>' +
                 '  <td style="text-align:right;font-size:var(--tiny);color:var(--muted);padding:0.2rem 0.25rem;">' + (tdc > 0 ? fmtPct(t.amount / tdc) : '—') + '</td>' +
                 '</tr>';
        }).join('');
      }
    }

    // Color the gap cell: red if positive (funding needed), green if zero
    var gapAmtEl = document.getElementById('dc-su-gap');
    if (gapAmtEl && tdc > 0) {
      gapAmtEl.style.color = gap > 0 ? 'var(--chart-7)' : 'var(--accent)';
    }

    // ── L6 — Year-15 (or user-chosen N) exit analysis ────────────────
    // Projects the deal's disposition at the end of the hold period.
    // Methodology:
    //   • Year-N stabilized NOI: year-1 NOI grown by rentGrowth/expGrowth
    //     using the same constant-growth model as the 30-yr pro forma.
    //   • Resale value:  NOI_N / exit_cap.
    //   • Remaining 1st mortgage balance: standard amortization formula
    //     for an annuity (level monthly payment, declining principal).
    //   • Soft-loan remaining balance: each loan tranche amortized to year N.
    //   • Net sale proceeds: resale − (1st + soft) balances.
    //   • Deferred-fee payback: first year cumulative NOI−DS covers it.
    //   • Sponsor IRR: cash distributions yrs 1..N + net sale proceeds
    //     as positive flows, initial sponsor equity as the negative flow.
    //
    // Sponsor equity proxy = deferredDevFee (cash put in at closing).
    // The "real" sponsor equity also includes gp upfront/predevelopment,
    // which the model doesn't track separately — surface as a disclosed
    // simplification rather than fabricate a number.
    (function computeExit() {
      var holdEl = document.getElementById('dc-exit-hold');
      var capEl  = document.getElementById('dc-exit-cap');
      if (!holdEl || !capEl) return;
      var holdYears = Math.max(5, Math.min(30, parseInt(holdEl.value, 10) || 15));
      var exitCap   = (parseFloat(capEl.value) || 6.5) / 100;

      // Read growth rates from the pro forma inputs if present (defaults: 2% / 3%).
      var rentGrowth = (parseFloat((document.getElementById('pf-rent-growth') || {}).value) || 2) / 100;
      var expGrowth  = (parseFloat((document.getElementById('pf-exp-growth')  || {}).value) || 3) / 100;

      // Year-N NOI projection. annualRents and annualOpex/repReserve/netPropTax
      // are local closures from earlier in recalculate(). Defensive guards.
      var nNoi = NaN;
      if (annualRents > 0 && tdc > 0) {
        var rentMult = Math.pow(1 + rentGrowth, holdYears - 1);
        var expMult  = Math.pow(1 + expGrowth,  holdYears - 1);
        var vacPct   = (safeVal('dc-vacancy') || 5) / 100;
        var grossN   = annualRents * rentMult;
        var egiN     = grossN * (1 - vacPct);
        var opexN    = (annualOpex || 0) * expMult;
        var rrN      = (annualRepReserve || 0) * expMult;
        var ptN      = (netPropTax || 0) * expMult;
        nNoi = egiN - opexN - rrN - ptN;
      }
      var resale = (isFinite(nNoi) && nNoi > 0 && exitCap > 0) ? nNoi / exitCap : NaN;

      // Remaining 1st mortgage balance at year N (level-pay annuity).
      // bal = P * [(1+r)^n − (1+r)^k] / [(1+r)^n − 1]
      // where r = monthly rate, n = total months, k = months elapsed.
      function remainingBalance(principal, ratePct, termYears, elapsedYears) {
        if (principal <= 0 || termYears <= 0) return 0;
        if (ratePct <= 0) {
          // Straight-line amortization
          var paid = principal * (elapsedYears / termYears);
          return Math.max(0, principal - paid);
        }
        var r = ratePct / 100 / 12;
        var n = termYears * 12;
        var k = Math.min(n, elapsedYears * 12);
        var num = Math.pow(1 + r, n) - Math.pow(1 + r, k);
        var den = Math.pow(1 + r, n) - 1;
        return den > 0 ? principal * (num / den) : 0;
      }
      var firstMortBal = remainingBalance(mortgage, interestRate || 6.5, term || 35, holdYears);
      var softBal = 0;
      trancheBreakdown.forEach(function (t) {
        if (t.mode !== 'loan') return;
        softBal += remainingBalance(t.amount, t.rate || 0, t.term || 30, holdYears);
      });

      var netProceeds = (isFinite(resale)) ? resale - firstMortBal - softBal : NaN;

      // Deferred fee payback timing. Walk the pro forma yearly, accumulating
      // cash flow (NOI − total debt service). Find the first year where
      // cumCF ≥ deferredDevFee. (We use the constant year-1 debt service +
      // growing NOI; consistent with the 30-yr projection's "fixed DS".)
      var dfYr = null;
      if (deferredDevFee > 0 && annualDebtService > 0 && annualRents > 0) {
        var totalDS = annualDebtService + totalSoftDebtService;
        var cumCF = 0;
        for (var y = 1; y <= holdYears; y++) {
          var rm = Math.pow(1 + rentGrowth, y - 1);
          var em = Math.pow(1 + expGrowth,  y - 1);
          var vp = (safeVal('dc-vacancy') || 5) / 100;
          var noiY = annualRents * rm * (1 - vp) -
                     (annualOpex || 0) * em -
                     (annualRepReserve || 0) * em -
                     (netPropTax || 0) * em;
          cumCF += (noiY - totalDS);
          if (cumCF >= deferredDevFee) { dfYr = y; break; }
        }
      }

      // Sponsor IRR — Newton's method on the NPV polynomial.
      // Flows: yr 0 = −sponsorEquity; yrs 1..N = cashFlow; yr N also = +netProceeds.
      function computeIRR(flows) {
        var r = 0.10;
        for (var iter = 0; iter < 60; iter++) {
          var npv = 0, dnpv = 0;
          for (var t = 0; t < flows.length; t++) {
            var df = Math.pow(1 + r, t);
            npv  += flows[t] / df;
            if (t > 0) dnpv -= t * flows[t] / Math.pow(1 + r, t + 1);
          }
          if (Math.abs(dnpv) < 1e-10) break;
          var step = npv / dnpv;
          r -= step;
          if (r < -0.99) r = -0.99;
          if (r > 5)    r = 5;
          if (Math.abs(step) < 1e-7) break;
        }
        return r;
      }
      var irr = NaN;
      if (deferredDevFee > 0 && isFinite(netProceeds) && netProceeds > 0) {
        var totalDS2 = annualDebtService + totalSoftDebtService;
        var flows = [-deferredDevFee];
        for (var yr = 1; yr <= holdYears; yr++) {
          var rmY = Math.pow(1 + rentGrowth, yr - 1);
          var emY = Math.pow(1 + expGrowth,  yr - 1);
          var vpY = (safeVal('dc-vacancy') || 5) / 100;
          var noiY2 = annualRents * rmY * (1 - vpY) -
                      (annualOpex || 0) * emY -
                      (annualRepReserve || 0) * emY -
                      (netPropTax || 0) * emY;
          var cf = noiY2 - totalDS2;
          if (yr === holdYears) cf += netProceeds;
          flows.push(cf);
        }
        irr = computeIRR(flows);
      }

      // Write to DOM
      function _setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
      _setText('dc-exit-noi',    isFinite(nNoi)    ? fmt(nNoi)    : '—');
      _setText('dc-exit-resale', isFinite(resale)  ? fmt(resale)  : '—');
      _setText('dc-exit-mortbal', tdc > 0 ? fmt(firstMortBal) : '—');
      _setText('dc-exit-softbal', tdc > 0 ? fmt(softBal)      : '—');
      _setText('dc-exit-net',    isFinite(netProceeds) ? fmt(netProceeds) : '—');
      _setText('dc-exit-defyr',  dfYr ? 'Year ' + dfYr : (deferredDevFee > 0 ? '> ' + holdYears + 'y' : 'n/a'));
      var irrEl = document.getElementById('dc-exit-irr');
      if (irrEl) {
        if (isFinite(irr)) {
          irrEl.textContent = (irr * 100).toFixed(1) + '%';
          irrEl.style.color = irr >= 0.15 ? 'var(--good, #047857)'
                            : irr >= 0.08 ? 'var(--accent)'
                            : irr >= 0     ? 'var(--warn, #d97706)'
                            : 'var(--bad, #dc2626)';
        } else {
          irrEl.textContent = '—';
          irrEl.style.color = '';
        }
      }
      var notesEl = document.getElementById('dc-exit-notes');
      if (notesEl) {
        var notes = [];
        notes.push('Year-' + holdYears + ' NOI grown at ' + (rentGrowth * 100).toFixed(1) +
                   '%/yr rent and ' + (expGrowth * 100).toFixed(1) + '%/yr expense inflation.');
        if (isFinite(resale)) {
          notes.push('Resale capitalizes NOI at ' + (exitCap * 100).toFixed(2) + '% exit cap.');
        }
        if (isFinite(irr)) {
          notes.push('IRR proxies sponsor equity = deferred dev fee (' + fmt(deferredDevFee) +
                     '). Excludes GP predev/upfront equity not modeled here.');
        }
        notesEl.textContent = notes.join(' ');
      }
    })();

    // Dispatch soft-funding refresh so the breakdown panel updates
    try {
      var is4Pct = _creditRate < 0.05;
      document.dispatchEvent(new CustomEvent('soft-funding:refresh', {
        detail: {
          countyFips: _countyFips,
          executionType: is4Pct ? '4%' : '9%',
          gapAmount: Math.max(0, gap)
        }
      }));
    } catch (_) {}

    // ── Tornado sensitivity chart ───────────────────────────────────
    // Renders 4 sensitivity bars showing how key variables affect the deal.
    if (window.TornadoSensitivity && tdc > 0 && document.getElementById('tornadoChartMount')) {
      try {
        var eqP = equityPrice || 0.90;
        var ir  = interestRate || 6.5;
        var vu  = safeVal('dc-vacancy') || 7;
        var ou  = safeVal('dc-opex') || 450;
        var u   = units || 60;
        var acr = annualCredits || 0;

        // Equity pricing: ±$0.03
        var eqLo  = acr * CREDIT_YEARS * Math.max(0.70, eqP - 0.03);
        var eqHi  = acr * CREDIT_YEARS * Math.min(1.05, eqP + 0.03);

        // Interest rate: ±1% (lower rate = higher mortgage, higher rate = lower)
        var mcLo  = mortgageConstant(Math.min(0.12, (ir + 1)) / 100, term || 35);
        var mcHi  = mortgageConstant(Math.max(0.03, (ir - 1)) / 100, term || 35);
        var mortLo = (mcLo > 0 && noi > 0) ? (noi / dcr) / mcLo : 0;
        var mortHi = (mcHi > 0 && noi > 0) ? (noi / dcr) / mcHi : 0;

        // Compute EGI from available scope variables
        var _egi = (annualRents || 0) * (1 - (vu / 100));
        var _repRes = (safeVal('dc-rep-reserve') || 350) * u;

        // OpEx: ±$50/unit/month
        var noiLo = _egi - ((ou + 50) * 12 * u) - _repRes - (netPropTax || 0);
        var noiHi = _egi - (Math.max(200, ou - 50) * 12 * u) - _repRes - (netPropTax || 0);

        // Vacancy: ±2%
        var vacLoEgi = (annualRents || 0) * (1 - Math.min(0.15, (vu + 2) / 100));
        var vacHiEgi = (annualRents || 0) * (1 - Math.max(0.01, (vu - 2) / 100));

        window.TornadoSensitivity.render({
          factors: [
            { label: 'Equity Price', low: eqLo, high: eqHi, base: equity,
              lowLabel: fmt(eqLo), highLabel: fmt(eqHi),
              note: '$' + Math.max(0.70, eqP - 0.03).toFixed(2) + ' to $' + Math.min(1.05, eqP + 0.03).toFixed(2) + '/credit',
              color: 'var(--accent)' },
            { label: 'First Mortgage', low: mortLo, high: mortHi, base: mortgage,
              lowLabel: fmt(mortLo), highLabel: fmt(mortHi),
              note: 'Rate ' + Math.max(3, ir - 1).toFixed(1) + '% to ' + Math.min(12, ir + 1).toFixed(1) + '%',
              color: '#2563eb' },
            { label: 'NOI (OpEx)', low: noiLo, high: noiHi, base: noi,
              lowLabel: fmt(noiLo), highLabel: fmt(noiHi),
              note: 'OpEx $' + Math.max(200, ou - 50) + ' to $' + (ou + 50) + '/unit/mo',
              color: 'var(--warn)' },
            { label: 'NOI (Vacancy)', low: vacLoEgi, high: vacHiEgi, base: noi,
              lowLabel: fmt(vacLoEgi), highLabel: fmt(vacHiEgi),
              note: 'Vacancy ' + Math.max(1, vu - 2) + '% to ' + Math.min(15, vu + 2) + '%',
              color: '#059669' }
          ]
        }, 'tornadoChartMount');
      } catch (e) {
        console.warn('[deal-calculator] Tornado sensitivity error:', e.message);
      }
    }

    try { document.dispatchEvent(new CustomEvent('deal-calc:updated')); } catch(_) {}
  }

  // -------------------------------------------------------------------
  // AMI gap display + deal predictor integration
  // -------------------------------------------------------------------

  /**
   * Find the county record in the AMI gap data by FIPS.
   */
  function _findAmiGapCounty(fips) {
    if (!_amiGapData || !_amiGapData.counties || !fips) return null;
    var target = String(fips).padStart(5, '0');
    for (var i = 0; i < _amiGapData.counties.length; i++) {
      if (String(_amiGapData.counties[i].fips).padStart(5, '0') === target) {
        return _amiGapData.counties[i];
      }
    }
    return null;
  }

  /**
   * Render AMI gap info panel when a county is selected.
   */
  // F45: resolve the active place geoid from cross-page state so AMI-gap
  // figures can reflect a small town instead of its containing county when the
  // user came from a place selection.
  function _getActivePlaceGeoid() {
    try {
      if (window.JurisdictionUrlContext && typeof window.JurisdictionUrlContext.resolveSync === 'function') {
        var c = window.JurisdictionUrlContext.resolveSync();
        if (c && c.placeGeoid && /^\d{7}$/.test(c.placeGeoid)) return c.placeGeoid;
      }
      var p = window.WorkflowState && window.WorkflowState.getActiveProject && window.WorkflowState.getActiveProject();
      var jx = p && (p.jurisdiction || (p.steps && p.steps.jurisdiction));
      if (jx && jx.placeGeoid && /^\d{7}$/.test(jx.placeGeoid)) return jx.placeGeoid;
    } catch (_) { /* soft-fail */ }
    return null;
  }
  function _findAmiGapPlace(placeGeoid) {
    if (!_amiGapPlaceData || !_amiGapPlaceData.places || !placeGeoid) return null;
    return _amiGapPlaceData.places[placeGeoid] || null;
  }
  // Derive the "units needed" trio (30/50/60% AMI) from either schema.
  //   county file: gap_units_minus_households_le_ami_pct (units − households,
  //                negative when there's a shortfall) — abs gives units needed
  //   place file:  households_le_ami_pct − units_priced_affordable_le_ami_pct
  //                (positive shortfall directly)
  function _gapTrioFromRecord(rec, kind) {
    var bands = ['30', '50', '60'];
    var out = {};
    if (kind === 'place') {
      var hh = rec.households_le_ami_pct || {};
      var un = rec.units_priced_affordable_le_ami_pct || {};
      bands.forEach(function (b) {
        out[b] = Math.max(0, (Number(hh[b]) || 0) - (Number(un[b]) || 0));
      });
    } else {
      var g = rec.gap_units_minus_households_le_ami_pct || {};
      bands.forEach(function (b) { out[b] = Math.abs(Number(g[b]) || 0); });
    }
    return out;
  }

  function _renderAmiGapInfo(fips, placeGeoid) {
    var container = document.getElementById('dc-ami-gap-info');
    if (!container) {
      // Create the container after the FMR note
      var fmrNote = document.getElementById('dc-fmr-note');
      if (!fmrNote) return;
      container = document.createElement('div');
      container.id = 'dc-ami-gap-info';
      container.style.cssText = 'font-size:var(--tiny);color:var(--muted);margin-bottom:var(--sp2);' +
        'padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);';
      fmrNote.parentNode.insertBefore(container, fmrNote.nextSibling);
    }
    // F45: prefer the place record when the user has a place selection — a
    // 5k-pop town's gap is dramatically smaller than its county's (e.g. New
    // Castle ≈ 190 households at ≤30% AMI vs Garfield County ≈ 7,800).
    var place = placeGeoid ? _findAmiGapPlace(placeGeoid) : null;
    var rec   = place || _findAmiGapCounty(fips);
    if (!rec) { container.hidden = true; return; }
    var kind  = place ? 'place' : 'county';
    var gaps  = _gapTrioFromRecord(rec, kind);
    var label = place ? (rec.place_name || 'this jurisdiction')
                      : (rec.county_name || '');
    container.innerHTML =
      '<strong style="color:var(--accent);">Affordability Gap — ' + label +
      (kind === 'place' ? '<span style="color:var(--muted);font-weight:400"> · place-level</span>' : '') +
      '</strong><br>' +
      '30% AMI: ' + Math.round(gaps['30']).toLocaleString() + ' units needed' +
      ' &bull; 50% AMI: ' + Math.round(gaps['50']).toLocaleString() + ' units needed' +
      ' &bull; 60% AMI: ' + Math.round(gaps['60']).toLocaleString() + ' units needed';
    container.hidden = false;
  }

  /**
   * Call the deal predictor (enhanced or base) when county changes,
   * passing AMI gap data from the calculator inputs.
   */
  /**
   * Render the cross-county jurisdiction disclosure for the chosen county.
   * Surfaces an info banner when the chosen county contains CO places that
   * span multiple counties — a parcel on the wrong side of the line uses a
   * different county's HUD AMI tier.
   *
   * Idempotent: calling with no fips hides the banner.
   */
  function _renderCrossCountyDisclosure(fips) {
    var noteEl = document.getElementById('dc-cross-county-note');
    if (!noteEl) return;
    if (!fips || !window.CrossCountyDisclosure) {
      noteEl.hidden = true;
      noteEl.innerHTML = '';
      return;
    }
    // Lazy-init the data file (idempotent — no-op after first call)
    window.CrossCountyDisclosure.init().then(function () {
      var html = window.CrossCountyDisclosure.formatCountyBanner(fips);
      if (html) {
        noteEl.innerHTML = html;
        noteEl.hidden = false;
      } else {
        noteEl.hidden = true;
        noteEl.innerHTML = '';
      }
    });
  }

  /**
   * Render the HMDA mortgage-credit-access context for the chosen county.
   * Surfaces 1-line callout: origination count, denial rate, mean loan size,
   * multifamily originations, with state benchmarks. Sourced from CFPB HMDA
   * Data Browser data (PR #786, refreshed monthly).
   *
   * Why this matters: tightening credit (rising denial rate, falling
   * originations) precedes slowdown in multifamily starts and reduced LIHTC
   * bond demand. Per-county denial-rate variance also exposes underserved
   * markets that LIHTC deals can target.
   *
   * Idempotent: calling with no fips hides the banner.
   */
  function _renderHmdaContext(fips) {
    var noteEl = document.getElementById('dc-hmda-context');
    if (!noteEl) return;
    if (!fips || !window.HmdaLookup) {
      noteEl.hidden = true;
      noteEl.innerHTML = '';
      return;
    }
    window.HmdaLookup.init().then(function () {
      var comparison = window.HmdaLookup.getCountyVsState(fips);
      if (!comparison) {
        noteEl.hidden = true;
        noteEl.innerHTML = '';
        return;
      }
      // Try to use the county selector's display name for a nicer label
      var countySel = document.getElementById('dc-county-select');
      var countyName = null;
      if (countySel && countySel.selectedOptions && countySel.selectedOptions[0]) {
        var label = countySel.selectedOptions[0].textContent || '';
        // Strip "(08001)" suffix if present
        countyName = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
      }
      noteEl.innerHTML = window.HmdaLookup.formatCountyCallout(comparison, countyName);
      noteEl.hidden = false;
    });
  }

  function _runDealPredictor(fips) {
    var predictor = window.LIHTCDealPredictor;
    if (!predictor) return;

    var units = parseInt((document.getElementById('dc-units') || {}).value, 10) || 60;
    var dealInputs = {
      geoid: fips || undefined,
      countyFips: fips || null,    // drives hard-cost geographic multiplier in predictor
      proposedUnits: units,
      isQct: !!(document.getElementById('dc-qct-dda') || {}).checked
    };

    // AMI gap data
    var county = _findAmiGapCounty(fips);
    if (county) {
      var gaps = county.gap_units_minus_households_le_ami_pct || {};
      dealInputs.ami30UnitsNeeded = Math.abs(gaps['30'] || 0);
      dealInputs.ami50UnitsNeeded = Math.abs(gaps['50'] || 0);
      dealInputs.ami60UnitsNeeded = Math.abs(gaps['60'] || 0);
    }

    // Use enhanced predictor when available
    var result;
    if (window.LIHTCDealPredictorEnhanced) {
      result = window.LIHTCDealPredictorEnhanced.predictEnhanced(dealInputs);
    } else {
      result = { base: predictor.predictConcept(dealInputs) };
    }

    // Render a compact concept recommendation below the calculator
    var recCard = document.getElementById('dc-concept-rec');
    if (!recCard) {
      var mount = document.getElementById('dealCalcMount');
      if (!mount) return;
      recCard = document.createElement('div');
      recCard.id = 'dc-concept-rec';
      recCard.style.cssText = 'margin-top:var(--sp3);padding:var(--sp2) var(--sp3);' +
        'border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);';
      mount.appendChild(recCard);
    }
    var rec = result.base;
    recCard.innerHTML =
      '<h3 style="margin:0 0 0.5rem;font-size:0.95rem;">' +
      (rec.confidenceBadge || '') + ' Concept Recommendation: <strong>' +
      rec.recommendedExecution + ' ' + (rec.conceptType || '').charAt(0).toUpperCase() +
      (rec.conceptType || '').slice(1) + ' Housing</strong>' +
      ' <span style="font-size:0.75em;color:var(--muted);">' + rec.confidence + ' confidence</span></h3>' +
      '<ul style="margin:0;padding-left:1.25rem;font-size:var(--small);">' +
      (rec.keyRationale || []).map(function (r) { return '<li>' + r + '</li>'; }).join('') +
      '</ul>';
    recCard.hidden = false;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------
  function init() {
    var mount = document.getElementById('dealCalcMount');
    if (!mount) return;
    render(mount);

    // Eagerly trigger the HUD LIHTC dataset load so the Peer Deals panel
    // has data ready when the user picks a county. Non-blocking; fails
    // silently — the panel handles the absent-data state gracefully.
    if (window.HudLihtc && typeof window.HudLihtc.load === 'function' && !window.HudLihtc.isLoaded()) {
      window.HudLihtc.load().then(function () {
        if (typeof recalculate === 'function') recalculate();
      }).catch(function () { /* peer deals panel handles empty case */ });
    }

    // Wire up county selector
    var countySel = document.getElementById('dc-county-select');
    if (countySel) {
      // Fix #8: retry until HudFmr deferred script initialises (up to ~7.5 s).
      // After populating, pre-select the county from WorkflowState / SiteState.
      var _populateRetries = 0;
      var _afterPopulate = function () {
        var _selectCounty = function (fips) {
          if (!fips) return false;
          for (var _i = 0; _i < countySel.options.length; _i++) {
            if (countySel.options[_i].value === fips) {
              countySel.value = fips;
              countySel.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          return false;
        };
        var _fallbackCounty = function () {
          // Pre-select jurisdiction county so user doesn't re-enter it.
          // WorkflowState / select-jurisdiction.js / HNA all write the
          // county FIPS to `jx.fips` — the legacy `jx.countyFips` field
          // doesn't exist anywhere in the schema, so this lookup silently
          // returned undefined and the county dropdown never auto-selected
          // the user's project jurisdiction.
          var fips = null;
          try {
            var _proj = window.WorkflowState && window.WorkflowState.getActiveProject();
            var _jx   = _proj && (_proj.jurisdiction || (_proj.steps && _proj.steps.jurisdiction));
            if (_jx && _jx.fips) fips = _jx.fips;
          } catch (_) {}
          if (!fips) {
            try {
              var _sc = window.SiteState && window.SiteState.getCounty();
              if (_sc && _sc.fips) fips = _sc.fips;
            } catch (_) {}
          }
          _selectCounty(fips);
        };
        if (window.JurisdictionUrlContext && typeof window.JurisdictionUrlContext.resolve === 'function') {
          window.JurisdictionUrlContext.resolve().then(function (ctx) {
            if (!_selectCounty(ctx && (ctx.countyFips || (/^\d{5}$/.test(ctx.fips || '') ? ctx.fips : null)))) {
              _fallbackCounty();
            }
          }).catch(_fallbackCounty);
          return;
        }
        _fallbackCounty();
      };
      var _populated = false;
      var _doPopulate = function () {
        if (_populated) return;          // already done
        if (window.HudFmr) {
          if (window.HudFmr.isLoaded()) {
            _populated = true;
            populateCountySelector(countySel);
            _afterPopulate();
          } else {
            window.HudFmr.load().then(function () {
              if (_populated) return;
              _populated = true;
              populateCountySelector(countySel);
              _afterPopulate();
            });
          }
        } else if (++_populateRetries < 15) {
          // HudFmr script hasn't initialised yet — retry
          setTimeout(_doPopulate, 500);
        }
      };
      // Listen for the custom event (faster path) AND keep polling as fallback
      document.addEventListener('HudFmr:loaded', _doPopulate);
      setTimeout(_doPopulate, 200);

      countySel.addEventListener('change', function () {
        var fips = this.value;
        if (fips) {
          updateAmiLimitsFromFmr(fips);
        } else {
          // No county selected — clear rent limits rather than defaulting to
          // Denver MSA, which systematically over-estimates rent capacity
          // for the ~56 non-metro CO counties.
          _amiLimits = null;
          _countyFips = null;
        }
        // Update the FMR note
        var noteEl = document.getElementById('dc-fmr-note');
        if (noteEl) {
          if (_amiLimits) {
            // P6: surface the \u00a742 / CHFA methodology basis so reviewers see
            // we're not using ami_4person \u00d7 pct (a common but wrong shortcut).
            noteEl.innerHTML = '<strong>2BR LIHTC gross rent ceiling (\u00a742 / CHFA):</strong> ' +
              [30, 40, 50, 60].map(function (p) {
                return p + '% AMI = $' + _amiLimits[p].toLocaleString();
              }).join(' \u2022 ') +
              '<br><span style="opacity:.85;">Formula: 50% AMI 3-person \u00d7 (tier \u00f7 50) \u00d7 ' +
              Math.round((+_constants.rentBurdenPct) * 100) + '% \u00f7 12.&nbsp;' +
              'Imputed household = 1.5 \u00d7 bedrooms; 2BR = 3-person. Subtract utility allowance for net rent.</span>';
            noteEl.style.color = '';
          } else {
            noteEl.textContent = 'Select a county above to load HUD-published AMI rent limits for that county.';
            noteEl.style.color = 'var(--warn, #e6a23c)';
          }
        }
        _renderAmiGapInfo(fips, _getActivePlaceGeoid());
        _runDealPredictor(fips);
        _renderCrossCountyDisclosure(fips);
        _renderHmdaContext(fips);
        // Q5: refresh ZORI market context for the new county.
        _renderZoriMarketContext(fips);
        recalculate();
      });

      // Q5: wire the achievable-rent cap checkbox to trigger recalc on change.
      var _capChk = document.getElementById('dc-achievable-cap');
      if (_capChk) _capChk.addEventListener('change', recalculate);

    // Load AMI gap data (county + F45 place-level companion)
    var _gapResolver = (typeof window.resolveAssetUrl === 'function') ? window.resolveAssetUrl : function (p) { return p; };
    fetch(_gapResolver('data/co_ami_gap_by_county.json')).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      _amiGapData = data;
    }).catch(function () {
      console.warn('[deal-calculator] AMI gap data unavailable');
      if (window.CohoToast) window.CohoToast.show('AMI gap data unavailable — some affordability context may be missing.', 'warn');
    });
    // F45: place-level AMI gap — soft-fail (county fallback handles missing).
    fetch(_gapResolver('data/co_ami_gap_by_place.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.places) _amiGapPlaceData = data;
    }).catch(function () { /* place file absent — county fallback applies */ });

    // F25: Load PAB direct allocations so the 4% bond path can show the
    // county's local volume-cap capacity. Soft-fail — the note falls back to
    // generic PAB text if the file is missing.
    fetch(_gapResolver('data/policy/pab-allocations.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.allocations) {
        _pabByGeoid = data.allocations;
        _pabMeta = data.metadata || null;
        if (_countyFips) _renderPabNote(_countyFips);
      }
    }).catch(function () { /* generic PAB note remains */ });

    // Q5: Load Zillow ZORI market-rent index. Soft-fail — when missing,
    // the achievable-rent cap toggle hides and the LIHTC ceiling is used.
    fetch(_gapResolver('data/market/zori_rents_co.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && (data.counties || data.cities)) {
        _zoriData = data;
        // Re-run rent display if user has already selected a county.
        if (_countyFips) {
          try {
            _renderZoriMarketContext(_countyFips);
            recalculate();
          } catch (_) {}
        }
      }
    }).catch(function () { /* cap toggle stays disabled, no LIHTC change */ });

    // ── Parcel→county auto-detect (PR #795) ───────────────────────────
    // Wire the lat/lon detect button + browser geolocation. On a hit,
    // set the county selector to the detected county and dispatch the
    // change event so all downstream renders fire.
    _wireCountyDetect(countySel);
    }
  }

  /**
   * F25: Render the PAB (private-activity-bond) volume-cap note for the 4%
   * bond path. Shows the selected county's local direct allocation when it's
   * a designated issuer; otherwise notes it draws from CHFA's statewide pool.
   * Always keeps the "capacity, not a ceiling" framing.
   */
  function _renderPabNote(fips) {
    var note = document.getElementById('dc-rate-pab-note');
    if (!note) return;
    var yr = (_pabMeta && _pabMeta.year) ? (' (DOLA ' + _pabMeta.year + ')') : '';
    var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };

    // HEADLINE: where 4% cap actually comes from — CHFA's statewide pool.
    var sw = (_pabMeta && _pabMeta.statewide) || {};
    var head = '4% deals need Private Activity Bond (PAB) volume cap in addition to the 4% credit. ';
    if (sw.chfaPool) {
      head += 'In Colorado that cap comes primarily from <strong>CHFA’s statewide pool</strong> of ' +
              fmt(sw.chfaPool) + yr + ' — not from a local allocation. CO has generally not been ' +
              'cap-constrained for 4% multifamily, and the federal 50% bond-test drops to 25% for ' +
              'placements after 2025-12-31, stretching cap further. ';
    }

    // SECONDARY: this county's local issuing-authority slice (rarely the source).
    var tail;
    if (_pabByGeoid && fips && _pabByGeoid[fips] && _pabByGeoid[fips].directAllocation) {
      var nm = _pabByGeoid[fips].name || 'This county';
      tail = '<span style="opacity:.85">' + nm + ' also holds a ' + fmt(_pabByGeoid[fips].directAllocation) +
             ' local direct allocation, but that slice mostly funds single-family bonds / MCCs — it’s a ' +
             'local-issuer capacity signal, not this deal’s cap.</span>';
    } else if (_pabByGeoid && fips) {
      tail = '<span style="opacity:.85">This county isn’t a designated local issuer (below the ~$1M minimum) — ' +
             'normal, and irrelevant to sourcing 4% cap, which comes from the statewide pool.</span>';
    } else {
      // Dataset not loaded — keep it generic, don't imply anything.
      note.textContent = head.trim();
      return;
    }
    note.innerHTML = head + tail;
  }

  /**
   * Q5: Render the ZORI market context line beneath the achievable-rent-cap
   * toggle. Shows the county's current ZORI median, YoY change, and vintage
   * month so the user can see *why* the cap might or might not bind.
   */
  function _renderZoriMarketContext(fips) {
    var el = document.getElementById('dc-achievable-cap-meta');
    if (!el) return;
    if (!fips) {
      el.textContent = 'Select a county to load ZORI market context.';
      el.style.color = 'var(--muted)';
      return;
    }
    if (!_zoriData) {
      el.textContent = 'Loading ZORI market data…';
      el.style.color = 'var(--muted)';
      return;
    }
    var zori = getZoriCountyRent(fips);
    if (!zori) {
      el.innerHTML = '<em>No ZORI coverage for this county</em> — the cap toggle stays inactive ' +
        '(Zillow reports only counties with sufficient listing volume). ' +
        'Underwrite at LIHTC ceilings or use the manual rent override.';
      el.style.color = 'var(--warn,#d97706)';
      return;
    }
    var yoyStr = (typeof zori.yoy === 'number')
      ? (' &middot; <strong style="color:' + (zori.yoy >= 0 ? 'var(--accent,#096e65)' : 'var(--bad,#dc2626)') + ';">' +
         (zori.yoy >= 0 ? '+' : '') + zori.yoy.toFixed(1) + '% YoY</strong>')
      : '';
    el.innerHTML =
      '<strong>' + (zori.name || 'County') + '</strong> ZORI: $' +
      zori.rent.toLocaleString() + '/mo all-bedroom typical' +
      yoyStr +
      ' &middot; vintage ' + (zori.vintage_month || 'n/a') +
      '. <span style="opacity:.85;">Per-BR values are scaled by HUD FMR per-BR ratios.</span>';
    el.style.color = 'var(--muted)';
  }

  /**
   * Q5: After recalculate() runs, surface which 70/80/100% AMI rows actually
   * had their rents reduced by the market cap. Empty array → cap not binding.
   */
  function _renderAchievableCapStatus(capOn, perBrMarket, bindings) {
    var el = document.getElementById('dc-achievable-cap-meta');
    if (!el) return;
    if (!capOn) {
      // Restore the static "context" line.
      _renderZoriMarketContext(_countyFips);
      return;
    }
    if (!perBrMarket) {
      // Cap toggled on but no ZORI for this county; keep context warning.
      _renderZoriMarketContext(_countyFips);
      return;
    }
    var meta = perBrMarket._meta || {};
    var headBits = [
      '<strong>Cap ON</strong> &middot;',
      (meta.name || 'County') + ' ZORI vintage ' + (meta.vintage_month || 'n/a')
    ];
    if (typeof meta.yoy === 'number') {
      headBits.push('&middot; ' + (meta.yoy >= 0 ? '+' : '') + meta.yoy.toFixed(1) + '% YoY');
    }
    if (!bindings || bindings.length === 0) {
      el.innerHTML = headBits.join(' ') +
        '. <span style="color:var(--accent,#096e65);">Cap not binding</span> — LIHTC ceilings on 70/80/100% AMI ' +
        'are already at or below ZORI market for the selected BR types. Rent roll unchanged.';
      el.style.color = 'var(--muted)';
      return;
    }
    var rows = bindings.map(function (b) {
      var save = (b.ceiling - b.market) * b.units * 12;
      return '<li style="margin:.1rem 0;">' +
        b.pct + '% AMI (' + b.br.toUpperCase() + '): ceiling $' + b.ceiling.toLocaleString() +
        ' → capped at $' + b.market.toLocaleString() +
        '/mo (−$' + Math.round(save / 12).toLocaleString() + '/mo per unit, ' +
        '−$' + Math.round(save).toLocaleString() + '/yr at ' + b.units + ' units)' +
        '</li>';
    });
    el.innerHTML = headBits.join(' ') +
      '. <strong style="color:var(--warn,#d97706);">Cap binding on ' + bindings.length +
      ' tier(s)</strong> — workforce rents under-written at market:' +
      '<ul style="margin:.3rem 0 0 1rem;padding:0;list-style:disc;">' + rows.join('') + '</ul>';
    el.style.color = 'var(--text)';
  }

  /**
   * Hook up the lat/lon → county auto-detection UI controls.
   * @param {HTMLSelectElement} countySel - the dc-county-select element
   */
  function _wireCountyDetect(countySel) {
    var detectBtn = document.getElementById('dc-coords-detect');
    var geoBtn    = document.getElementById('dc-coords-geo');
    var latEl     = document.getElementById('dc-coords-lat');
    var lonEl     = document.getElementById('dc-coords-lon');
    var resultEl  = document.getElementById('dc-coords-result');
    if (!detectBtn || !latEl || !lonEl || !resultEl || !countySel) return;

    function setResult(html, color) {
      resultEl.innerHTML = html;
      resultEl.style.color = color || 'var(--muted)';
    }

    function runLookup(lat, lon) {
      if (!isFinite(lat) || !isFinite(lon)) {
        setResult('Enter valid lat/lon coordinates.', 'var(--bad,#dc2626)');
        return;
      }
      // Clamp sanity-check: CO is roughly 37-41N, -109 to -102W
      if (lat < 36 || lat > 42 || lon < -110 || lon > -101) {
        setResult('Coordinates appear to be outside Colorado (CO is ~37-41°N, -109 to -102°W).',
          'var(--warn,#d97706)');
      }
      if (!window.CountyFromCoords) {
        setResult('County lookup module not loaded.', 'var(--bad,#dc2626)');
        return;
      }
      setResult('Looking up county…', 'var(--muted)');
      window.CountyFromCoords.lookup(lat, lon).then(function (county) {
        if (!county) {
          setResult('No CO county found for those coordinates. Try the County dropdown above directly.',
            'var(--warn,#d97706)');
          return;
        }
        // Find + select the matching option
        var matched = false;
        for (var i = 0; i < countySel.options.length; i++) {
          if (countySel.options[i].value === county.fips) {
            countySel.value = county.fips;
            countySel.dispatchEvent(new Event('change', { bubbles: true }));
            matched = true;
            break;
          }
        }
        if (matched) {
          setResult(
            '✓ Detected: <strong>' + county.name + ' County</strong> (' + county.fips +
            '). HUD AMI rent limits + cross-county disclosure updated above.',
            'var(--good,#16a34a)'
          );
        } else {
          setResult(
            'Detected ' + county.name + ' County (' + county.fips +
            ') but it is not in the dropdown — pick manually.',
            'var(--warn,#d97706)'
          );
        }
      }).catch(function (err) {
        setResult('Lookup failed: ' + (err && err.message ? err.message : err),
          'var(--bad,#dc2626)');
      });
    }

    detectBtn.addEventListener('click', function () {
      var lat = parseFloat(latEl.value);
      var lon = parseFloat(lonEl.value);
      runLookup(lat, lon);
    });

    if (geoBtn) {
      geoBtn.addEventListener('click', function () {
        if (!navigator.geolocation) {
          setResult('Browser geolocation not available.', 'var(--bad,#dc2626)');
          return;
        }
        setResult('Requesting your location…', 'var(--muted)');
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            latEl.value = pos.coords.latitude.toFixed(6);
            lonEl.value = pos.coords.longitude.toFixed(6);
            runLookup(pos.coords.latitude, pos.coords.longitude);
          },
          function (err) {
            setResult('Geolocation denied or unavailable: ' + err.message,
              'var(--warn,#d97706)');
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      });
    }
  }

  // -------------------------------------------------------------------
  // Designation context — called by the market-analysis pipeline after
  // a site has been checked against QCT/DDA overlay polygons.
  // -------------------------------------------------------------------

  /**
   * Update the QCT/DDA indicator in the deal calculator UI.
   * Called by the market-analysis controller once checkDesignation() resolves.
   *
   * When basis_boost_eligible is true the checkbox is pre-checked and the
   * note is shown so the user is aware of the designation.  The basis %
   * slider is intentionally NOT auto-adjusted — the user retains full
   * manual control per the principle that the designation does not
   * automatically apply the 130% boost (IRC §42(d)(5)(B) requires election).
   *
   * @param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
   */
  function setDesignationContext(basisBoostEligible) {
    var chk  = document.getElementById('dc-qct-dda');
    var note = document.getElementById('dc-qct-dda-note');
    if (!chk || !note) return; // calculator not yet mounted — intentional no-op
    chk.checked        = !!basisBoostEligible;
    note.style.display = basisBoostEligible ? 'block' : 'none';
  }

  // SCOPE BOUNDARY — do not expand this file into a deal predictor or scoring engine.
  // This calculator is intentionally limited to early-stage feasibility sizing:
  // eligible basis, annual credits, rough equity, and gap-to-subsidy estimates.
  //
  // A full 4%/9% deal-predictor (CHFA QAP scoring, soft-debt layering, investor
  // pricing) is out of scope here and requires an explicit product decision before
  // implementation. Adding automated award-probability scoring or parcel-level
  // conclusions would cross the platform's "screening, not certainty" boundary.
  window.__DealCalc = {
    init: init,
    recalculate: recalculate,
    setDesignationContext: setDesignationContext,
    /* Exposed for testing — pure functions, no DOM access */
    computeDscrStressScenarios: computeDscrStressScenarios,
    findPeerDeals:              findPeerDeals,
    computeRentAchievability:   computeRentAchievability,
    /* Q5 — exposed so the test harness can inject ZORI fixtures without DOM */
    getZoriCountyRent:          getZoriCountyRent,
    getZoriPerBrRent:           getZoriPerBrRent,
    _setZoriDataForTest:        function (d) { _zoriData = d; },
    DEFAULT_CONSTANTS:          DEFAULT_CONSTANTS,
    /* Test helpers — mutate the live constants and read back */
    _getConstants:              function () { return Object.assign({}, _constants); },
    _setConstantsForTest:       function (overrides) {
      Object.keys(overrides || {}).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_CONSTANTS, k)) _constants[k] = overrides[k];
      });
    },
    _resetConstantsForTest:     function () { _constants = Object.assign({}, DEFAULT_CONSTANTS); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
