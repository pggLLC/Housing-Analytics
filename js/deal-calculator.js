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
  // F96 — Triangulation sources for the achievable-rent cap. ZORI is the
  // PRIMARY signal (broadest coverage, monthly); these two are surfaced
  // in the cap-status pane so the user can see independent confirmation:
  //
  //   Apartment List — monthly, ~21 CO cities, explicit 1BR/2BR medians
  //   DOLA Apartment Rent Survey — twice-yearly, ~14 CO regions, the
  //     source CHFA QAP underwriters actually use; vacancy + per-BR.
  //
  // Both soft-load; the cap math still runs off ZORI when either is missing.
  var _alData = null;       // cached apartment_list_co.json
  var _dolaSurvey = null;   // cached dola_rent_survey_co.json
  // F97 — ACS B25064 median gross rent. THE always-available baseline:
  // every CO county has a value here so the cap pane always shows at
  // least one defensible market-rent reference, even for the tiniest
  // rural jurisdiction that no other source covers.
  var _acsRent = null;      // cached acs_median_rent_co.json
  // F224 — Place ACS profile cache. When the active jurisdiction is a place,
  // we fetch data/hna/summary/{placeGeoid}.json once and cache the DP04
  // fields the rent table needs. Stored on window so the existing
  // _gapResolver / inline-IIFE pattern can read it without re-importing.
  if (!window.__cohoPlaceAcsCache) window.__cohoPlaceAcsCache = {};
  (function _warmPlaceAcs() {
    function _go() {
      try {
        var proj = window.WorkflowState && window.WorkflowState.getActiveProject &&
                   window.WorkflowState.getActiveProject();
        var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
        if (!jx || !jx.geoid || String(jx.geoid).length !== 7) return;
        if (window.__cohoPlaceAcsCache[jx.geoid]) return;
        fetch('data/hna/summary/' + jx.geoid + '.json').then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (j) {
          if (!j) return;
          // Schema: { geo: {...}, profile: { DP04_0134E, DP04_0089E, ... } }
          var p = (j.profile || j);
          window.__cohoPlaceAcsCache[jx.geoid] = p;
        }).catch(function () { /* non-blocking */ });
      } catch (_) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(_go, 150); });
    } else {
      setTimeout(_go, 150);
    }
  })();
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
  /* ── F148: Tax-abatement auto-detect callout ─────────────────────── */
  // Reads the current jurisdiction's tax-abatement-inventory entry and
  // surfaces a banner above the dc-tax-exempt select with:
  //  - the detected program name + summary
  //  - a one-click "Apply 100%" / "Apply 50%" button that sets the
  //    select value (does NOT silently modify NOI — user must click)
  //  - a link to the full inventory entry
  // This makes pro-forma defensibility automatic for the 20 covered
  // jurisdictions, with the C.R.S. §39-3-112.5 statewide baseline as
  // the fallback for places without a specific program.
  var __dcAbatementBanner = null;
  function _dcGetJurisdictionGeoKey() {
    // Look up the currently selected jurisdiction via WorkflowState
    // (the same source the Silt-label fix uses).
    try {
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (!jx) return null;
      if (jx.placeGeoid) return 'place:' + jx.placeGeoid;
      if (jx.geoid) return (jx.geoType === 'county' ? 'county:' : 'place:') + jx.geoid;
      if (jx.countyFips) return 'county:08' + String(jx.countyFips).slice(-3);
    } catch (_) {}
    return null;
  }
  function _dcEnsureAbatementBanner() {
    if (!window.TaxAbatement || !window.TaxAbatement.loadRoster) return;
    var taxSelect = document.getElementById('dc-tax-exempt');
    if (!taxSelect) return;
    // Find the label that wraps the select; insert banner immediately above
    var label = taxSelect.closest('label') || taxSelect.parentElement;
    if (!label || label.previousElementSibling && label.previousElementSibling.dataset && label.previousElementSibling.dataset.dcAbatement) {
      __dcAbatementBanner = label.previousElementSibling;
    }
    var geoKey = _dcGetJurisdictionGeoKey();
    window.TaxAbatement.loadRoster().then(function (data) {
      // Find matching entry
      var entry = (data.jurisdictions || []).find(function (j) {
        return Array.isArray(j.geoKeys) && j.geoKeys.indexOf(geoKey) !== -1;
      });
      // Find the property-tax-exemption program (suggested apply %)
      var exemption = null;
      if (entry && Array.isArray(entry.programs)) {
        exemption = entry.programs.find(function (p) { return /property-tax-exemption|PILOT/i.test(p.category || ''); });
      }
      // Suggested % from the program magnitude string ("100%" → 100, "50%" → 50)
      var suggestedPct = 100;  // C.R.S. §39-3-112.5 default
      if (exemption && exemption.magnitude) {
        var m = exemption.magnitude.match(/(\d+)\s*%/);
        if (m) suggestedPct = parseInt(m[1], 10);
      }
      var headline = exemption
        ? '<strong>' + (entry ? entry.name : 'Jurisdiction') + ':</strong> ' + exemption.name
        : '<strong>Statewide baseline:</strong> C.R.S. §39-3-112.5 — 501(c)(3) owner + ≤60% AMI use restriction qualifies for full property tax exemption';
      var summary = exemption && exemption.summary
        ? exemption.summary
        : 'Most LIHTC + workforce projects with a recorded LURA and 501(c)(3) ownership qualify automatically. Verify program eligibility for your specific structure before underwriting.';
      // Remove existing banner if present (re-render on jurisdiction change)
      if (__dcAbatementBanner) __dcAbatementBanner.remove();
      // Build banner
      var banner = document.createElement('div');
      banner.dataset.dcAbatement = '1';
      banner.style.cssText = 'padding:.55rem .7rem;margin:0 0 .5rem;border-radius:6px;' +
        'background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.35);border-left:4px solid #047857;font-size:.82rem;line-height:1.4';
      var btn = '<button type="button" id="dc-apply-abatement" ' +
        'style="margin-top:.35rem;padding:.25rem .65rem;font-size:.78rem;font-weight:700;' +
        'background:#047857;color:white;border:0;border-radius:5px;cursor:pointer">' +
        'Apply ' + suggestedPct + '% to Tax Exemption ↓</button>';
      banner.innerHTML = '<div>🏛️ ' + headline + '</div>' +
        '<div style="margin-top:.2rem;color:var(--muted);font-size:.78rem">' + summary + '</div>' +
        btn;
      label.parentNode.insertBefore(banner, label);
      __dcAbatementBanner = banner;
      // Wire the apply button — set select value + trigger change so NOI recomputes
      var applyBtn = banner.querySelector('#dc-apply-abatement');
      if (applyBtn) {
        applyBtn.addEventListener('click', function () {
          // Pick the closest available option (0, 50, or 100)
          var options = Array.from(taxSelect.options).map(function (o) { return +o.value; });
          var closest = options.reduce(function (a, b) {
            return Math.abs(b - suggestedPct) < Math.abs(a - suggestedPct) ? b : a;
          });
          taxSelect.value = String(closest);
          taxSelect.dispatchEvent(new Event('change', { bubbles: true }));
          applyBtn.textContent = '✓ Applied (' + closest + '%)';
          applyBtn.disabled = true;
          applyBtn.style.background = 'rgba(16,185,129,.3)';
        });
      }
    }).catch(function (e) { console.warn('[dc-abatement] load failed', e); });
  }
  // Hook into the existing render lifecycle. Try multiple times since
  // the tax select isn't in the DOM until the Deal Calc renders its
  // inputs section. Also re-run when jurisdiction changes.
  function _dcInitAbatementBanner() {
    var tries = 0;
    var iv = setInterval(function () {
      if (document.getElementById('dc-tax-exempt')) {
        clearInterval(iv);
        _dcEnsureAbatementBanner();
      } else if (++tries > 50) {
        clearInterval(iv);
      }
    }, 100);
  }
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _dcInitAbatementBanner);
    } else {
      _dcInitAbatementBanner();
    }
    // Refresh on jurisdiction change events used elsewhere in the codebase
    document.addEventListener('jurisdiction-changed', _dcEnsureAbatementBanner);
    document.addEventListener('workflow-state-updated', _dcEnsureAbatementBanner);
  }

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

  <!-- R2/R4: grid uses auto-fit (collapses empty tracks). minmax 340px so
       on a wide desktop (≥ ~1080 px content width) the layout becomes a true
       3-column "Inputs | LIHTC Pro Forma | Capital Stack" layout, matching
       how syndicators actually read deal memos: assumptions → performance →
       sources/uses, left-to-right. At 760-1080 px the grid collapses to
       2 cols (Inputs | Outputs); below 760 px it stacks to 1 col. The page
       container max-width is 1400 px (see deal-calculator.html). -->
  <div id="dc-calc-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:var(--sp3);align-items:start;">

    <!-- Inputs column -->
    <div id="dc-inputs-col" style="min-width:0;">
      <h3 style="font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        Deal Assumptions
      </h3>
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

        <!-- F197 — Soft-funding program reference panel. Surfaces what each
             of the 14 programs IS + the authority URL + typical usage.
             User-facing fix: programs were hidden behind a single dropdown
             on each tranche row. Now they're discoverable + documented. -->
        <details id="dc-soft-funding-ref" style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--bg2);">
          <summary style="cursor:pointer;font-weight:700;font-size:var(--small);color:var(--accent);">
            ▸ Soft-funding program reference (14 sources, with descriptions + links)
          </summary>
          <div id="dc-soft-funding-ref-list" style="margin-top:var(--sp2);display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:var(--sp2) var(--sp3);font-size:var(--small);"></div>
        </details>
      </fieldset>
    </div>

    <!-- LIHTC Pro Forma column (R4)
         All performance-side outputs: credit, mortgage sizing, DSCR /
         stress tests, rent achievability, peer deals, plus the
         Methodology & Formulas panel (collapsed by default).
         Sources & Uses + Year-15 Exit live in the Capital Stack column
         to the right at desktop widths. -->
    <div id="dc-pro-forma-col" style="min-width:0;">
      <h3 style="font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        LIHTC Pro Forma
      </h3>

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
              <strong>Why MTSP 3-person, not 4-person AMI:</strong> <abbr data-glossary="IRC §42">IRC §42</abbr> uses
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
          <dt style="color:var(--muted);"><abbr data-glossary="NOI">NOI</abbr> (stabilized, annual)</dt>
          <dd id="dc-r-noi-stab" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Debt Service</dt>
          <dd id="dc-r-ads" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);"><abbr data-glossary="DSCR">DSCR</abbr> (stabilized)</dt>
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

        <!-- F215 — CHFA Portfolio Comparables. Complements the HUD peer table
             above by scoring CHFA-recent (post-2018) deals on similarity to
             the proposed deal across units, project type, region, and credit
             type. Sources from data/affordable-housing/properties.json (1,920
             CO properties merged from CHFA + HUD MF + preservation). -->
        <details id="dc-chfa-comps-details" style="margin-top:var(--sp3);">
          <summary style="cursor:pointer;font-size:var(--small);font-weight:700;color:var(--accent);">
            ▸ CHFA portfolio comparables — scored by similarity (1,920-project database)
          </summary>
          <div id="dc-chfa-comps-body" style="margin-top:var(--sp2);font-size:var(--small);">
            <p style="color:var(--muted);font-size:var(--tiny);margin:0;">Select a county to load CHFA comparables.</p>
          </div>
        </details>
      </fieldset>

    </div><!-- /#dc-pro-forma-col -->

    <!-- Capital Stack column (R4)
         All sources/uses + exit-side outputs. On wide desktop sits to
         the right of LIHTC Pro Forma so the user can scan Inputs →
         Performance → Capital Stack left-to-right. On narrower screens
         it stacks below Pro Forma. -->
    <div id="dc-capital-stack-col" style="min-width:0;">
      <h3 style="font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        Capital Stack &amp; Exit
      </h3>

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
    </div><!-- /#dc-capital-stack-col -->
  </div><!-- /#dc-calc-grid -->

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
        // F194 — Tier 2: cash-flow-pay %, accrue mode, priority order. Mirrors
        // the Anthracite professional model's per-tranche controls. Default-
        // collapsed; loan-mode only (grants have no debt service).
        + '  <details style="margin-top:var(--sp2);">'
        + '    <summary style="cursor:pointer;font-size:var(--tiny);font-weight:600;color:var(--muted);padding:0.2rem 0;">▸ Cash-flow waterfall position (advanced)</summary>'
        + '    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:var(--sp2);margin-top:var(--sp2);padding:var(--sp2);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);">'
        + '      <label><span style="' + labelCss + '">% Cash-flow-pay <span title="What % of mandatory debt service is paid from operating cash flow each year. Remainder comes from surplus cash only (residual). Soft debt is often 50-100% surplus-only.">ⓘ</span></span>'
        + '        <input class="dc-tr-cfpay" type="number" min="0" max="100" step="5" value="' + (t.cashflowPayPct != null ? t.cashflowPayPct : 100) + '" style="' + inputCss + '">'
        + '      </label>'
        + '      <label><span style="' + labelCss + '">Interest <span title="Current pay = interest accrues + is paid each year. Accrue = interest accrues but is added to principal balance, paid at maturity or refi.">ⓘ</span></span>'
        + '        <select class="dc-tr-accrue" style="' + inputCss + '">'
        + '          <option value="current"' + ((t.accrueMode || 'current') === 'current' ? ' selected' : '') + '>Current pay</option>'
        + '          <option value="accrued"' + (t.accrueMode === 'accrued' ? ' selected' : '') + '>Accrue (pay at exit)</option>'
        + '        </select>'
        + '      </label>'
        + '      <label><span style="' + labelCss + '">Priority <span title="Cash flow waterfall priority. 1 = paid first; 12 = paid last. Hard mortgage is typically 1; soft debt 4-10; deferred dev fee 6-9.">ⓘ</span></span>'
        + '        <input class="dc-tr-priority" type="number" min="1" max="12" step="1" value="' + (t.priority != null ? t.priority : 5) + '" style="' + inputCss + '">'
        + '      </label>'
        + '    </div>'
        + '  </details>'
        + '</div>';
    }

    function renderSoftTranches() {
      var host = document.getElementById('dc-soft-tranches');
      if (!host) return;
      if (_softTranches.length === 0) {
        // Seed with a default empty tranche so the UI isn't empty on first load.
        // F194: also seed cashflowPayPct, accrueMode, priority defaults
        _softTranches.push({ id: ++_trancheCounter, program: 'chfa_htf', amount: 0, mode: 'loan', rate: 3.0, term: 30, cashflowPayPct: 100, accrueMode: 'current', priority: 5 });
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
        // F194 — Tier 2 per-tranche knobs (cash-flow-pay %, accrue, priority).
        // Optional chaining because the controls live in a <details> that
        // may not be in the DOM if a future renderer simplifies the row.
        var cfPayEl = rowEl.querySelector('.dc-tr-cfpay');
        if (cfPayEl) {
          cfPayEl.addEventListener('input', function () {
            t.cashflowPayPct = Math.max(0, Math.min(100, parseFloat(this.value) || 0));
            recalculate();
          });
        }
        var accrueEl = rowEl.querySelector('.dc-tr-accrue');
        if (accrueEl) {
          accrueEl.addEventListener('change', function () {
            t.accrueMode = this.value;
            recalculate();
          });
        }
        var priorityEl = rowEl.querySelector('.dc-tr-priority');
        if (priorityEl) {
          priorityEl.addEventListener('input', function () {
            t.priority = Math.max(1, Math.min(12, parseInt(this.value, 10) || 5));
            recalculate();
          });
        }
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
        // F194: new tranches default to surplus-only (0% CF-pay), accrue mode,
        // priority 8 (mid-stack) — typical for new soft debt added late in capital stack.
        _softTranches.push({ id: ++_trancheCounter, program: 'prop123', amount: 0, mode: 'loan', rate: 0, term: 30, cashflowPayPct: 0, accrueMode: 'accrued', priority: 8 });
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

    // Phase-4 follow-up — re-scan for <abbr data-glossary> tags now that the
    // output panel HTML has been injected. The inline-glossary boot fires on
    // DOMContentLoaded against an empty mount, so without this the NOI /
    // DSCR / IRC §42 tooltip wrappers never get hydrated.
    if (window.InlineGlossary && typeof window.InlineGlossary.decorate === 'function') {
      try { window.InlineGlossary.decorate(mount); } catch (_) { /* never break render */ }
    }

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

    // F96 — Apartment List monthly rent index (CO cities). Triangulation
    // source. Soft-load; AL line just hides when missing.
    fetch(_gapResolver('data/market/apartment_list_co.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.cities) {
        _alData = data;
        if (_countyFips) {
          try { _renderZoriMarketContext(_countyFips); } catch (_) {}
        }
      }
    }).catch(function () { /* skip — AL is optional */ });

    // F96 — DOLA Apartment Rent Survey snapshot (regional). Soft-load.
    // The PDF is WAF-blocked at DOLA's end; the JSON here is built from
    // a locally-downloaded PDF via scripts/parse_dola_rent_survey.py.
    // When the file doesn't exist yet, the cap-status pane just omits
    // the DOLA line — no UI breakage.
    fetch(_gapResolver('data/market/dola_rent_survey_co.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && (data.regions || data.counties)) {
        _dolaSurvey = data;
        if (_countyFips) {
          try { _renderZoriMarketContext(_countyFips); } catch (_) {}
        }
      }
    }).catch(function () { /* skip — DOLA is optional */ });

    // F97 — ACS B25064 median gross rent. The always-available baseline:
    // every CO county has a value, so even when ZORI/AL/DOLA all miss
    // (rural / unincorporated / small CDP) the cap pane still surfaces a
    // defensible market-rent reference.
    fetch(_gapResolver('data/market/acs_median_rent_co.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.counties) {
        _acsRent = data;
        if (_countyFips) {
          try { _renderZoriMarketContext(_countyFips); } catch (_) {}
        }
      }
    }).catch(function () { /* should be bundled — soft-fail anyway */ });

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
      el.textContent = 'Select a county to load market context.';
      el.style.color = 'var(--muted)';
      return;
    }

    var html = '';

    // F97 — ACS B25064 baseline. ALWAYS PRESENT for every CO county, so
    // this is the first line of the cap pane. Lagged ~2 yrs (5-yr ACS)
    // but full coverage — the floor signal we can always show.
    //
    // F224 — When the active jurisdiction is a place (not a county), prefer
    // the place-level ACS median gross rent from data/hna/summary/{placeGeoid}.json
    // (DP04_0134E). The Silt-style bug: every place in Garfield County saw
    // identical rent ($1,170) because we only looked up county. Now place ACS
    // takes precedence; fallback is the county aggregate, labelled "(county)".
    var placeRent = null;
    var placeRentName = null;
    try {
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject &&
                 window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (jx && jx.geoid && String(jx.geoid).length === 7 && window.__cohoPlaceAcsCache) {
        var pRec = window.__cohoPlaceAcsCache[jx.geoid];
        if (pRec && Number.isFinite(+pRec.DP04_0134E)) {
          placeRent = +pRec.DP04_0134E;
          placeRentName = jx.name || 'Place';
        }
      }
    } catch (_) {}
    if (placeRent) {
      html += '<strong>' + placeRentName + '</strong> ACS median gross rent: $' +
        placeRent.toLocaleString() + '/mo' +
        ' &middot; <span style="opacity:.85;">5-yr Census B25064 (DP04_0134E) — place-level.</span>';
    } else if (_acsRent && _acsRent.counties) {
      var acsRec = _acsRent.counties[String(fips).padStart(5, '0')];
      if (acsRec && Number.isFinite(acsRec.median_gross_rent)) {
        html += '<strong>' + (acsRec.name || 'County') + '</strong> ACS median gross rent: $' +
          acsRec.median_gross_rent.toLocaleString() + '/mo' +
          ' &middot; <span style="opacity:.85;">5-yr Census B25064 — county aggregate (no place-level value).</span>';
      }
    }

    // F96 — ZORI (monthly, all-BR). Adds the fresher signal where Zillow
    // has sufficient listing volume.
    var zori = getZoriCountyRent(fips);
    if (zori) {
      var yoyStr = (typeof zori.yoy === 'number')
        ? (' &middot; <strong style="color:' + (zori.yoy >= 0 ? 'var(--accent,#096e65)' : 'var(--bad,#dc2626)') + ';">' +
           (zori.yoy >= 0 ? '+' : '') + zori.yoy.toFixed(1) + '% YoY</strong>')
        : '';
      if (html) html += '<div style="margin-top:.25rem;">';
      html += '<strong>' + (zori.name || 'County') + '</strong> ZORI: $' +
        zori.rent.toLocaleString() + '/mo all-bedroom typical' +
        yoyStr +
        ' &middot; vintage ' + (zori.vintage_month || 'n/a') +
        '. <span style="opacity:.85;">Per-BR values scaled by HUD FMR ratios.</span>';
      if (html.indexOf('<div') !== -1) html += '</div>';
    } else if (!html) {
      // No ZORI AND no ACS — shouldn't happen but bail gracefully.
      el.textContent = 'Loading market data…';
      el.style.color = 'var(--muted)';
      return;
    }

    // F96 — Apartment List triangulation (city-level). Pick the largest
    // city ZORI tracks for this county as the lookup key (ZORI city
    // records carry a county FIPS that we matched to the selected fips).
    // Simpler approach: try to derive the dominant city from the county
    // name by checking ZORI city records that fall in this county.
    var alLine = _alTriangulationLine(fips);
    if (alLine) html += '<div style="margin-top:.25rem;">' + alLine + '</div>';

    // F96 — DOLA Survey triangulation (regional). Always 14 CO regions;
    // we look up the region for this county via the survey's county
    // map.
    var dolaLine = _dolaTriangulationLine(fips);
    if (dolaLine) html += '<div style="margin-top:.25rem;">' + dolaLine + '</div>';

    el.innerHTML = html;
    el.style.color = 'var(--muted)';
  }

  /**
   * F96 — Build a one-line Apartment List comparison string for the
   * selected county. AL is city-level; we surface the largest AL-tracked
   * city associated with this county (best-effort name match).
   */
  function _alTriangulationLine(fips) {
    if (!_alData || !_alData.cities) return '';
    // Naive approach: pick whichever AL city's "county" field matches.
    // The AL JSON we built doesn't carry county FIPS (it's a city-level
    // index), so we match by name against ZORI's county→city associations
    // when possible. Fallback: just pick the highest-rent AL city to
    // surface as "regional benchmark".
    var bestCity = null;
    var bestRent = -1;
    // Best-effort: look at ZORI cities for this county to find candidate
    // names, then look those names up in AL.
    if (_zoriData && _zoriData.cities) {
      Object.keys(_zoriData.cities).forEach(function (k) {
        var zc = _zoriData.cities[k];
        // ZORI city records don't always carry a FIPS either; fall back
        // to name match. Skip this attempt.
      });
    }
    // Pragmatic fallback: pick the AL city with highest rent_overall as
    // a "metro benchmark" line. Surfaces the per-BR detail AL provides
    // that ZORI's smoothed index doesn't.
    Object.keys(_alData.cities).forEach(function (k) {
      var c = _alData.cities[k];
      if (typeof c.rent_overall === 'number' && c.rent_overall > bestRent) {
        bestRent = c.rent_overall;
        bestCity = c;
      }
    });
    if (!bestCity) return '';
    var bits = [];
    if (bestCity.rent_1br)     bits.push('1BR $' + bestCity.rent_1br.toLocaleString());
    if (bestCity.rent_2br)     bits.push('2BR $' + bestCity.rent_2br.toLocaleString());
    if (bestCity.rent_overall) bits.push('all $' + bestCity.rent_overall.toLocaleString());
    var yoy = (typeof bestCity.yoy_change_pct === 'number')
      ? ' (' + (bestCity.yoy_change_pct >= 0 ? '+' : '') + bestCity.yoy_change_pct.toFixed(1) + '% YoY)'
      : '';
    return '<strong>' + (bestCity.name || 'Region') + '</strong> Apartment List: ' +
      bits.join(' / ') + yoy +
      '. <span style="opacity:.75;">City-level per-BR triangulation.</span>';
  }

  /**
   * F96 — Build a one-line DOLA Apartment Rent Survey comparison for
   * the selected county. The survey reports by region; we look up which
   * region this county falls in from the survey's countyToRegion map.
   * Shows median rent + vacancy when both are available.
   */
  function _dolaTriangulationLine(fips) {
    if (!_dolaSurvey) return '';
    var map = _dolaSurvey.countyToRegion || _dolaSurvey.county_to_region || {};
    var regionId = map[String(fips).padStart(5, '0')] || map[fips];
    if (!regionId) return '';
    var regions = _dolaSurvey.regions || _dolaSurvey.byRegion || {};
    var r = regions[regionId];
    if (!r) return '';
    var bits = [];
    if (typeof r.rent_2br === 'number') bits.push('2BR $' + r.rent_2br.toLocaleString());
    if (typeof r.rent_1br === 'number') bits.push('1BR $' + r.rent_1br.toLocaleString());
    if (typeof r.rent_studio === 'number') bits.push('Studio $' + r.rent_studio.toLocaleString());
    var vac = (typeof r.vacancy_pct === 'number')
      ? ', vacancy ' + r.vacancy_pct.toFixed(1) + '%'
      : '';
    var quarter = r.quarter || _dolaSurvey.quarter || _dolaSurvey.vintage || '';
    return '<strong>DOLA Region ' + (r.name || regionId) + '</strong>: ' +
      bits.join(' / ') + vac +
      (quarter ? ' &middot; ' + quarter : '') +
      '. <span style="opacity:.75;">CHFA QAP authority.</span>';
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
  // F193 — Tier 1 stress sliders. Live overlay panel that shows the impact
  // of 5 stress variables on top of the current deal: LIHTC equity price,
  // construction cost overrun, per-AMI-tier rent haircut at deep tiers,
  // lease-up months, lender DSCR floor. Reads input snapshots from the
  // current calc (NOT recomputed); the overlay shows deltas vs. the base.
  // Architecture: non-blocking, additive. Never throws into the main
  // recalculate flow — wraps everything in try/catch.
  function _initStressSliders() {
    var SLIDERS = [
      { id: 'dc-stress-equity-price', label: 'dc-stress-equity-price-label', fmt: function (v) { return '$' + (+v).toFixed(2); } },
      { id: 'dc-stress-tdc-overrun',  label: 'dc-stress-tdc-overrun-label',  fmt: function (v) { return '+' + (+v).toFixed(0) + '%'; } },
      { id: 'dc-stress-rent-low',     label: 'dc-stress-rent-low-label',     fmt: function (v) { return '-' + (+v).toFixed(0) + '%'; } },
      { id: 'dc-stress-leaseup',      label: 'dc-stress-leaseup-label',      fmt: function (v) { return (+v).toFixed(0) + ' months'; } },
      { id: 'dc-stress-dscr-floor',   label: 'dc-stress-dscr-floor-label',   fmt: function (v) { return (+v).toFixed(2) + 'x'; } }
    ];
    function _read(id) { var el = document.getElementById(id); return el ? +el.value : 0; }
    function _fmtMoney(n) {
      if (!isFinite(n)) return '$—';
      var s = Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' :
              Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
      return (n < 0 ? '-$' : '$') + s.replace(/^-/, '');
    }
    function _basePrice() {
      var el = document.getElementById('dc-equity-price');
      return el && +el.value > 0 ? +el.value : 0.90;
    }
    function _refresh() {
      try {
        // Refresh label readouts
        SLIDERS.forEach(function (s) {
          var slider = document.getElementById(s.id);
          var label = document.getElementById(s.label);
          if (slider && label) label.textContent = s.fmt(slider.value);
        });
        // Build impact readouts
        var basePrice = _basePrice();
        var stressPrice = _read('dc-stress-equity-price');
        var equityImpactEl = document.getElementById('dc-stress-equity-impact');
        if (equityImpactEl) {
          var basis = parseFloat((document.getElementById('dc-eligible-basis') || {}).value) || 0;
          var creditPct = (window.__DealCalc && window.__DealCalc._getEquityRate && window.__DealCalc._getEquityRate()) || 0.09;
          var annualCredit = basis * creditPct;
          var baseEquity = annualCredit * 10 * basePrice;
          var stressEquity = annualCredit * 10 * stressPrice;
          var delta = stressEquity - baseEquity;
          equityImpactEl.textContent = 'Equity proceeds: ' + _fmtMoney(stressEquity) +
            ' (Δ ' + (delta >= 0 ? '+' : '') + _fmtMoney(delta) + ' vs. base ' + _fmtMoney(baseEquity) + ')';
          equityImpactEl.style.color = delta < 0 ? 'var(--bad)' : (delta > 0 ? 'var(--good)' : 'var(--muted)');
        }
        // TDC overrun impact
        var tdcOverrunPct = _read('dc-stress-tdc-overrun') / 100;
        var tdcImpactEl = document.getElementById('dc-stress-tdc-impact');
        if (tdcImpactEl) {
          var tdcEl = document.getElementById('dc-tdc');
          var baseTdc = tdcEl ? +tdcEl.value || 0 : 0;
          var stressTdc = baseTdc * (1 + tdcOverrunPct);
          var overrunAmt = stressTdc - baseTdc;
          tdcImpactEl.textContent = 'Stressed TDC: ' + _fmtMoney(stressTdc) +
            (overrunAmt > 0 ? ' (+' + _fmtMoney(overrunAmt) + ' overrun; assume covered by GP equity / soft-debt gap)' : ' (no overrun)');
          tdcImpactEl.style.color = overrunAmt > 0 ? 'var(--bad)' : 'var(--muted)';
        }
        // Lease-up impact
        var leaseupMonths = _read('dc-stress-leaseup');
        var leaseupImpactEl = document.getElementById('dc-stress-leaseup-impact');
        if (leaseupImpactEl) {
          // Estimate Year-1 NOI shortfall: missing months of stabilized NOI
          var noiInputEl = document.getElementById('dc-noi');
          var stableNoi = noiInputEl ? +noiInputEl.value || 0 : 0;
          var missedNoi = stableNoi * Math.min(12, leaseupMonths) / 12;
          // Standard: 12 months = stabilized at month 12 with linear ramp = 50% Year-1 shortfall
          var year1Loss = stableNoi * 0.5 * Math.min(1, leaseupMonths / 12);
          leaseupImpactEl.textContent = 'Year-1 NOI loss estimate: ' + _fmtMoney(year1Loss) +
            ' (linear ramp; covered by lease-up reserve if funded)';
          leaseupImpactEl.style.color = year1Loss > 0 ? 'var(--warn)' : 'var(--muted)';
        }
        // Summary panel — combined worst-case visualization
        var summaryEl = document.getElementById('dcStressSummary');
        if (summaryEl) {
          var rentHaircutPct = _read('dc-stress-rent-low') / 100;
          var dscrFloor = _read('dc-stress-dscr-floor') || 1.15;
          summaryEl.innerHTML =
            '<strong>Combined stress vs base:</strong> ' +
            'equity price $' + stressPrice.toFixed(2) + '/credit · ' +
            'TDC +' + (tdcOverrunPct * 100).toFixed(0) + '% · ' +
            'deep-tier rents -' + (rentHaircutPct * 100).toFixed(0) + '% · ' +
            leaseupMonths + 'mo lease-up · ' +
            'DSCR ≥ ' + dscrFloor.toFixed(2) + 'x. ' +
            '<br><span style="color:var(--muted);font-size:.78rem">' +
            'Read each impact row above for line-item deltas. Per-tranche soft-debt controls (CF-pay %, accrue mode, priority) live in the "Soft Funding Stack" panel above; ' +
            'full capital event waterfall (GP/LP split, preferred return, catch-up) renders below the Tornado Chart.' +
            '</span>';
        }
      } catch (e) {
        console.warn('[DealCalc] stress slider refresh failed', e);
      }
    }
    SLIDERS.forEach(function (s) {
      var slider = document.getElementById(s.id);
      if (slider) {
        slider.addEventListener('input', _refresh);
        slider.addEventListener('change', _refresh);
      }
    });
    // First paint
    setTimeout(_refresh, 100);
    // Re-paint when the main calc updates (debounced via simple flag)
    if (window.__DealCalc && typeof window.__DealCalc.recalculate === 'function') {
      var _origRecalc = window.__DealCalc.recalculate;
      window.__DealCalc.recalculate = function () {
        var r = _origRecalc.apply(this, arguments);
        setTimeout(_refresh, 50);
        return r;
      };
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initStressSliders);
  } else {
    _initStressSliders();
  }

  // ──────────────────────────────────────────────────────────────────
  // F195 — Capital Event Waterfall (GP/LP split at exit)
  // ──────────────────────────────────────────────────────────────────
  //
  // Models the partnership's distribution of sale or refi proceeds at
  // the end of the hold period. 6-tier waterfall:
  //
  //   1. Pay off remaining 1st mortgage balance
  //   2. Pay off remaining soft debt in priority order (F194 priority 1-12)
  //      — accrued interest first, then principal
  //   3. Pay off remaining deferred dev fee
  //   4. LP: return of capital + cumulative-unpaid preferred return
  //   5. GP catch-up (optional) — GP receives 100% until GP cumulative =
  //      gpResidualPct of (LP-pref-paid + GP-catch-up)
  //   6. Residual: split per gpResidualPct / lpResidualPct
  //
  // Inputs (DOM):
  //   • dc-wf-lp-equity   — LP equity contribution (auto-fills from LIHTC equity)
  //   • dc-wf-pref        — LP preferred return % (default 8%)
  //   • dc-wf-gp-residual — GP % of residual after pref (default 30%)
  //   • dc-wf-catchup     — none | full
  //
  // The model assumes a single capital event at the end of the hold
  // period. Annual cash flow to LP/GP DURING ops is approximated as
  // pro-rata to ownership split (0.01%/99.99% if conventional LIHTC).
  // For a real deal, ops cash flow flows through Tier 1-3 first (soft
  // debt CF-pay, deferred fee paydown) — that's already handled by
  // F194's per-tranche CF-pay knobs.
  //
  // Non-blocking: try/catch wraps everything. Subscribes to main
  // recalculate via the same monkey-patch pattern as _initStressSliders.
  function _initCapitalEventWaterfall() {
    function _read(id, def) {
      var el = document.getElementById(id);
      if (!el) return def != null ? def : 0;
      var v = parseFloat(el.value);
      return isFinite(v) ? v : (def != null ? def : 0);
    }
    function _readSelect(id, def) {
      var el = document.getElementById(id);
      return el ? el.value : (def || '');
    }
    function _fmtMoney(n) {
      if (!isFinite(n) || n === 0) return '$0';
      var abs = Math.abs(n);
      var s = abs >= 1e6 ? (n / 1e6).toFixed(2) + 'M' :
              abs >= 1e3 ? (n / 1e3).toFixed(0) + 'K' :
              n.toFixed(0);
      return (n < 0 ? '-$' : '$') + s.replace(/^-/, '');
    }
    function _fmtPct(p) {
      if (!isFinite(p)) return '—';
      return (p * 100).toFixed(1) + '%';
    }
    /**
     * Estimate the LP equity contribution from the same inputs Deal Calc
     * already uses for the LIHTC equity raise. Mirrors _initStressSliders'
     * approach: read DOM inputs, don't recompute from scratch.
     */
    function _autoLpEquity() {
      try {
        var basisEl = document.getElementById('dc-eligible-basis');
        var priceEl = document.getElementById('dc-equity-price');
        var basis = basisEl ? +basisEl.value || 0 : 0;
        var price = priceEl ? +priceEl.value || 0.90 : 0.90;
        var creditPct = (window.__DealCalc && window.__DealCalc._getEquityRate &&
                         window.__DealCalc._getEquityRate()) || 0.09;
        return basis * creditPct * 10 * price;
      } catch (e) {
        return 0;
      }
    }
    /**
     * Pull the year-N exit outputs from the L6 exit panel. These are
     * already computed by computeExit() and written to the DOM. Reading
     * them back keeps the waterfall in sync with whatever the user has
     * set for hold period, exit cap, growth rates.
     */
    function _readExitOutputs() {
      function _parseMoney(text) {
        if (!text) return 0;
        var s = String(text).replace(/[$,\s]/g, '');
        var mul = 1;
        if (/M$/i.test(s)) { mul = 1e6; s = s.slice(0, -1); }
        else if (/K$/i.test(s)) { mul = 1e3; s = s.slice(0, -1); }
        var n = parseFloat(s);
        return isFinite(n) ? n * mul : 0;
      }
      var resaleEl = document.getElementById('dc-exit-resale');
      var mortBalEl = document.getElementById('dc-exit-mortbal');
      var softBalEl = document.getElementById('dc-exit-softbal');
      var holdEl = document.getElementById('dc-exit-hold');
      var defFeeEl = document.getElementById('dc-deferred-dev-fee');
      return {
        resale: _parseMoney(resaleEl ? resaleEl.textContent : ''),
        mortBal: _parseMoney(mortBalEl ? mortBalEl.textContent : ''),
        softBal: _parseMoney(softBalEl ? softBalEl.textContent : ''),
        hold: holdEl ? Math.max(5, Math.min(30, parseInt(holdEl.value, 10) || 15)) : 15,
        // Deferred dev fee balance at exit is approximated as full deferred
        // amount if not paid within hold period. The exit panel's dc-exit-defyr
        // reports the payback year — if "n/a" or "> Xy", treat remaining as full.
        defFeeRemaining: (function () {
          var dfYrEl = document.getElementById('dc-exit-defyr');
          var dfFee = defFeeEl ? +defFeeEl.value || 0 : 0;
          if (!dfYrEl || !dfFee) return 0;
          var t = String(dfYrEl.textContent);
          if (t.indexOf('>') >= 0 || t === 'n/a' || t === '—') return dfFee;
          return 0;
        })()
      };
    }
    /**
     * Build the 6-tier waterfall distribution.
     */
    function _computeWaterfall() {
      var exit = _readExitOutputs();
      var lpEquityOverride = _read('dc-wf-lp-equity', 0);
      var lpEquity = lpEquityOverride > 0 ? lpEquityOverride : _autoLpEquity();
      var prefRate = _read('dc-wf-pref', 8.0) / 100;
      var gpResidualPct = _read('dc-wf-gp-residual', 30) / 100;
      var lpResidualPct = 1 - gpResidualPct;
      var catchupMode = _readSelect('dc-wf-catchup', 'none');
      var hold = exit.hold;

      var tiers = [];
      var grossProceeds = exit.resale;
      var remaining = grossProceeds;

      // Tier 1: Hard debt payoff (1st mortgage)
      var tier1 = Math.min(remaining, exit.mortBal);
      tiers.push({ name: '1. Hard debt payoff (1st mortgage)', amount: tier1, recipient: 'Lender' });
      remaining -= tier1;

      // Tier 2: Soft debt payoff (by F194 priority order)
      var tier2 = Math.min(remaining, exit.softBal);
      tiers.push({ name: '2. Soft debt payoff (priority order)', amount: tier2, recipient: 'Soft lenders' });
      remaining -= tier2;

      // Tier 3: Deferred dev fee remaining balance
      var tier3 = Math.min(remaining, exit.defFeeRemaining);
      tiers.push({ name: '3. Deferred developer fee', amount: tier3, recipient: 'Developer (GP)' });
      remaining -= tier3;

      // Tier 4: LP return of capital + cumulative preferred return
      // Pref accrues compound annually on outstanding LP capital. If
      // ops distributions paid the pref each year, accrued = 0 at exit
      // (we model that as ops-CF-paid pref since waterfall sees gross resale).
      // Conservative: model UNPAID pref as compound on full LP capital
      // across the hold period (zero ops distributions to LP for pref).
      // This is the standard "accrued-pref" assumption in LIHTC closings.
      var lpAccruedPref = lpEquity * (Math.pow(1 + prefRate, hold) - 1);
      var tier4a = Math.min(remaining, lpEquity);         // return of capital
      remaining -= tier4a;
      var tier4b = Math.min(remaining, lpAccruedPref);    // cumulative pref
      remaining -= tier4b;
      tiers.push({ name: '4a. LP return of capital', amount: tier4a, recipient: 'LP investor' });
      tiers.push({ name: '4b. LP preferred return (' + (prefRate * 100).toFixed(1) + '% accrued × ' + hold + 'y)', amount: tier4b, recipient: 'LP investor' });

      // Tier 5: GP catch-up (if enabled)
      // Catch-up math: solve for X such that GP cumulative (catch-up + post-residual)
      // equals gpResidualPct of (LP pref paid + catch-up + post-residual).
      // Simplified: GP catch-up = gpResidualPct / lpResidualPct * (LP pref paid).
      // This makes GP whole on the agreed split for the cumulative pref tier.
      var tier5 = 0;
      if (catchupMode === 'full' && tier4b > 0 && lpResidualPct > 0) {
        var catchupTarget = (gpResidualPct / lpResidualPct) * tier4b;
        tier5 = Math.min(remaining, catchupTarget);
        remaining -= tier5;
      }
      tiers.push({ name: '5. GP catch-up' + (catchupMode === 'full' ? ' (100% until balanced)' : ' (none — LP keeps gross pref)'), amount: tier5, recipient: 'GP sponsor' });

      // Tier 6: Residual split per gpResidualPct / lpResidualPct
      var tier6gp = remaining * gpResidualPct;
      var tier6lp = remaining * lpResidualPct;
      tiers.push({ name: '6a. Residual split — GP (' + (gpResidualPct * 100).toFixed(0) + '%)', amount: tier6gp, recipient: 'GP sponsor' });
      tiers.push({ name: '6b. Residual split — LP (' + (lpResidualPct * 100).toFixed(0) + '%)', amount: tier6lp, recipient: 'LP investor' });

      // Totals by party
      var lpTotal = tier4a + tier4b + tier6lp;
      var gpTotal = tier3 + tier5 + tier6gp;  // dev fee + catch-up + residual

      // LP IRR — simplified: LP put in lpEquity at year 0, got back lpTotal at year hold
      // (ignoring tax credits — those are the LP's primary return, not modeled here)
      var lpCashIrr = lpEquity > 0 ? Math.pow(lpTotal / lpEquity, 1 / hold) - 1 : NaN;
      var lpMultiple = lpEquity > 0 ? lpTotal / lpEquity : NaN;
      var gpMultiple = exit.defFeeRemaining > 0 ? gpTotal / exit.defFeeRemaining : NaN;

      return {
        tiers: tiers, grossProceeds: grossProceeds, remaining: remaining,
        lpEquity: lpEquity, lpTotal: lpTotal, gpTotal: gpTotal,
        lpCashIrr: lpCashIrr, lpMultiple: lpMultiple, gpMultiple: gpMultiple,
        prefRate: prefRate, hold: hold, gpResidualPct: gpResidualPct,
        autoLpEquity: _autoLpEquity()
      };
    }
    function _renderTable(wf) {
      var rows = wf.tiers.map(function (t) {
        var pct = wf.grossProceeds > 0 ? (t.amount / wf.grossProceeds * 100) : 0;
        var pctStr = pct >= 0.05 ? pct.toFixed(1) + '%' : '—';
        var color = t.amount > 0 ? 'var(--text)' : 'var(--faint)';
        return '<tr>' +
          '<td style="padding:3px 6px;color:' + color + ';">' + t.name + '</td>' +
          '<td style="padding:3px 6px;text-align:right;font-weight:600;color:' + color + ';">' + _fmtMoney(t.amount) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:var(--muted);">' + pctStr + '</td>' +
          '<td style="padding:3px 6px;color:var(--muted);font-size:.78rem;">' + t.recipient + '</td>' +
        '</tr>';
      }).join('');
      return '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
        '<th style="text-align:left;padding:3px 6px;color:var(--muted);font-weight:600;">Waterfall tier</th>' +
        '<th style="text-align:right;padding:3px 6px;color:var(--muted);font-weight:600;">Amount</th>' +
        '<th style="text-align:right;padding:3px 6px;color:var(--muted);font-weight:600;">% of gross</th>' +
        '<th style="text-align:left;padding:3px 6px;color:var(--muted);font-weight:600;">Recipient</th>' +
        '</tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr style="border-top:2px solid var(--border);">' +
        '<td style="padding:6px;font-weight:700;">Gross proceeds (sale)</td>' +
        '<td style="padding:6px;text-align:right;font-weight:700;color:var(--accent);">' + _fmtMoney(wf.grossProceeds) + '</td>' +
        '<td colspan="2" style="padding:6px;color:var(--muted);font-size:.78rem;">resale - mortgage payoff (computed in exit panel above)</td>' +
        '</tr></tfoot>' +
        '</table>' +
        // Bottom-line summary
        '<div style="margin-top:.8rem;padding:.5rem .65rem;background:var(--bg2);border-radius:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px;font-size:.82rem;">' +
        '<div><strong style="color:var(--muted);">LP cash received:</strong> <span style="font-weight:700;">' + _fmtMoney(wf.lpTotal) + '</span></div>' +
        '<div><strong style="color:var(--muted);">LP cash multiple:</strong> <span style="font-weight:700;">' + (isFinite(wf.lpMultiple) ? wf.lpMultiple.toFixed(2) + 'x' : '—') + '</span></div>' +
        '<div><strong style="color:var(--muted);">LP cash IRR (excl. credits):</strong> <span style="font-weight:700;">' + (isFinite(wf.lpCashIrr) ? _fmtPct(wf.lpCashIrr) : '—') + '</span></div>' +
        '<div><strong style="color:var(--muted);">GP cash received:</strong> <span style="font-weight:700;">' + _fmtMoney(wf.gpTotal) + '</span></div>' +
        '</div>' +
        '<p style="margin:.5rem 0 0;font-size:.76rem;color:var(--faint);line-height:1.4;">' +
        '<strong>LP IRR caveat:</strong> the LP\'s primary return on a LIHTC deal is the tax credits ($' +
        (wf.lpEquity > 0 ? (wf.lpEquity / 0.9 / 10).toFixed(0).replace(/(\d)(?=(\d{3})+$)/g, '$1,') : '—') +
        '/yr × 10 yrs, undiscounted), not cash. This panel models ONLY the cash side of the deal at exit. ' +
        'A full LP IRR calculation should add the present value of annual tax credit deliveries (years 1-10 typical).' +
        '</p>';
    }
    function _renderAnnualTable(wf) {
      // 30-yr annual cash distribution. For each year, distribute the
      // annual surplus cash flow (NOI − DS) between LP and GP per the
      // ownership split convention (0.01%/99.99% during ops). Ignore
      // tier-2 soft-debt CF-pay (already captured in DS). Exit-year
      // adds the waterfall result.
      var n = Math.min(30, wf.hold);
      var rentGrowth = _read('pf-rent-growth', 2) / 100;
      var expGrowth = _read('pf-exp-growth', 3) / 100;
      var vacPct = _read('dc-vacancy', 5) / 100;

      var noiBaseEl = document.getElementById('dc-noi');
      var dsEl = document.getElementById('dc-debt-service');
      var noiBase = noiBaseEl ? +noiBaseEl.value || 0 : 0;
      var ds = dsEl ? +dsEl.value || 0 : 0;

      // Ownership split during ops: standard LIHTC is 99.99% LP / 0.01% GP
      var lpOpsPct = 0.9999;
      var gpOpsPct = 0.0001;

      var rows = '';
      var cumLp = -wf.lpEquity;  // Year 0: LP puts in equity
      var cumGp = 0;
      rows += '<tr style="border-bottom:1px solid var(--border);background:var(--bg2);">' +
        '<td style="padding:3px 6px;text-align:right;color:var(--muted);">Year 0</td>' +
        '<td style="padding:3px 6px;text-align:right;color:var(--bad);">' + _fmtMoney(-wf.lpEquity) + '</td>' +
        '<td style="padding:3px 6px;text-align:right;color:var(--text);">$0</td>' +
        '<td style="padding:3px 6px;text-align:right;color:var(--bad);">' + _fmtMoney(cumLp) + '</td>' +
        '<td style="padding:3px 6px;text-align:right;color:var(--text);">' + _fmtMoney(cumGp) + '</td>' +
        '</tr>';
      for (var y = 1; y <= n; y++) {
        var rm = Math.pow(1 + rentGrowth, y - 1);
        var em = Math.pow(1 + expGrowth, y - 1);
        // Reuse approximation: NOI grown by rent factor (simplification — expense
        // inflation cancels partially; matches Year-15 exit panel's same approximation)
        var noiY = noiBase * rm - (noiBase * 0.4 * (em - rm));  // rough: opex ~ 40% of NOI scaled by exp inflation differential
        var cfY = Math.max(0, noiY - ds);  // surplus only — no negative distributions
        var lpY = cfY * lpOpsPct;
        var gpY = cfY * gpOpsPct;
        if (y === n) {
          // Exit year — add waterfall lump sum to cumulative
          lpY += wf.lpTotal;
          gpY += wf.gpTotal;
        }
        cumLp += lpY;
        cumGp += gpY;
        var isExit = (y === n);
        rows += '<tr' + (isExit ? ' style="background:var(--accent-dim);font-weight:600;"' : '') + '>' +
          '<td style="padding:3px 6px;text-align:right;color:var(--muted);">Year ' + y + (isExit ? ' (exit)' : '') + '</td>' +
          '<td style="padding:3px 6px;text-align:right;">' + _fmtMoney(lpY) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;">' + _fmtMoney(gpY) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:' + (cumLp >= 0 ? 'var(--good)' : 'var(--bad)') + ';">' + _fmtMoney(cumLp) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:' + (cumGp >= 0 ? 'var(--good)' : 'var(--muted)') + ';">' + _fmtMoney(cumGp) + '</td>' +
          '</tr>';
      }
      return '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">' +
        '<thead><tr style="position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--border);">' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">Year</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">LP cash</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">GP cash</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">LP cumulative</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">GP cumulative</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p style="margin:.5rem .5rem 0;font-size:.72rem;color:var(--faint);line-height:1.4;">' +
        'Annual cash: surplus (NOI − DS) split 99.99% LP / 0.01% GP per standard LIHTC ops convention. ' +
        'Exit-year row adds the waterfall lump-sum from above. Excludes tax credit deliveries (which are LP\'s primary return).' +
        '</p>';
    }
    function _refresh() {
      try {
        // Update slider label readouts
        var prefSlider = document.getElementById('dc-wf-pref');
        var prefLabel = document.getElementById('dc-wf-pref-label');
        if (prefSlider && prefLabel) prefLabel.textContent = (+prefSlider.value).toFixed(1);
        var gpSlider = document.getElementById('dc-wf-gp-residual');
        var gpLabel = document.getElementById('dc-wf-gp-residual-label');
        if (gpSlider && gpLabel) gpLabel.textContent = (+gpSlider.value).toFixed(0);
        // Update auto-equity display
        var autoEl = document.getElementById('dc-wf-lp-equity-auto');
        if (autoEl) autoEl.textContent = _fmtMoney(_autoLpEquity());
        // Compute + render the waterfall
        var wf = _computeWaterfall();
        var tableEl = document.getElementById('dcWaterfallTable');
        if (tableEl) tableEl.innerHTML = _renderTable(wf);
        var annualEl = document.getElementById('dcWaterfallAnnualTable');
        if (annualEl) annualEl.innerHTML = _renderAnnualTable(wf);
        // Update caret on details toggle
        var details = document.getElementById('dcWaterfallDetails');
        var caret = document.getElementById('dcWaterfallCaret');
        if (details && caret) caret.textContent = details.open ? '▾' : '▸';
      } catch (e) {
        console.warn('[DealCalc] waterfall refresh failed', e);
      }
    }
    ['dc-wf-lp-equity', 'dc-wf-pref', 'dc-wf-gp-residual', 'dc-wf-catchup'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', _refresh);
        el.addEventListener('change', _refresh);
      }
    });
    var detailsEl = document.getElementById('dcWaterfallDetails');
    if (detailsEl) detailsEl.addEventListener('toggle', _refresh);
    // First paint
    setTimeout(_refresh, 150);
    // Re-paint when main calc updates — chain after the stress-slider patch
    if (window.__DealCalc && typeof window.__DealCalc.recalculate === 'function') {
      var _origRecalc = window.__DealCalc.recalculate;
      window.__DealCalc.recalculate = function () {
        var r = _origRecalc.apply(this, arguments);
        setTimeout(_refresh, 60);
        return r;
      };
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCapitalEventWaterfall);
  } else {
    _initCapitalEventWaterfall();
  }

  // ──────────────────────────────────────────────────────────────────
  // F197 — Soft-funding program reference panel
  // ──────────────────────────────────────────────────────────────────
  //
  // The G — Multi-tranche soft debt UI shows 14 programs in a dropdown
  // on each tranche row, but never names or describes them anywhere
  // visible. This panel surfaces all 14 programs at once with a one-
  // sentence description, the authority URL, typical use, and whether
  // the program is loan / grant / hybrid.
  //
  // Sources for descriptions + URLs:
  //   • data/policy/soft-funding-status.json — structured program metadata
  //     (NOFA dates, awarded amounts, restrictions, contact URLs)
  //   • data/core/educational-content.json — HOME / CDBG / Prop 123 explainers
  //   • Public CHFA / DOLA / HUD / IRS authority pages
  //
  // Inlined to avoid an extra fetch round-trip + keep the panel rendering
  // synchronous. Mirrors SOFT_PROGRAMS array order so the dropdown and
  // reference panel show programs in the same sequence.
  function _initSoftFundingReference() {
    var PROGRAM_REF = [
      { k: 'chfa_htf', name: 'CHFA HTF',
        desc: 'Colorado Housing & Finance Authority Housing Trust Fund. State gap financing for multifamily affordable. Competitive statewide.',
        url: 'https://www.chfainfo.com/multifamily-finance/colorado-housing-investment-fund',
        type: 'Loan', notes: 'Deferred. 40-yr affordability minimum. ~3-5% rate typical. Stacks with 9% LIHTC.' },
      { k: 'prop123', name: 'Prop 123 — CO Affordable Housing Fund',
        desc: 'Colorado Proposition 123 (2022) reserves a share of TABOR surplus for affordable housing. Administered by DOLA + DOH.',
        url: 'https://cdola.colorado.gov/prop-123',
        type: 'Loan + Grant', notes: 'Zero-int deferred loans, grants for predev/land. Targets ≤60% AMI. First full allocation cycle Q3 2026.' },
      { k: 'local_pha', name: 'Local PHA / Housing Trust',
        desc: 'County or city housing trust funds + PHA capital reserves. Denver AHTF, Boulder HTF, Aspen HTF, etc.',
        url: 'https://cdola.colorado.gov/local-government-housing-resources',
        type: 'Loan + Grant', notes: 'Caps vary: Denver $1.5M/proj, Boulder $600K/proj. Local match expected on most state programs.' },
      { k: 'chfa_cmf', name: 'CHFA Capital Magnet Fund',
        desc: 'Federal CDFI Fund competitive grant, re-deployed by CHFA as gap + predevelopment financing. 10:1 leverage required.',
        url: 'https://www.chfainfo.com/multifamily-finance/capital-magnet-fund',
        type: 'Loan + Grant', notes: 'Periodic NOFA. Most recent CHFA award ~$10M (2023). Used for predev + acquisition.' },
      { k: 'dola_htf', name: 'DOLA HTF',
        desc: 'Colorado Department of Local Affairs Housing Trust Fund. Rural priority + small-town preference.',
        url: 'https://cdola.colorado.gov/housing-trust-fund',
        type: 'Loan', notes: 'Zero-int deferred. 20-yr affordability min. Q2 2026 NOFA: ~$1.8M available.' },
      { k: 'home', name: 'HOME Investment Partnerships',
        desc: 'Federal HUD block grant. Statewide pot administered by DOLA; large entitlement cities have own pots.',
        url: 'https://www.hud.gov/program_offices/comm_planning/home',
        type: 'Loan', notes: 'Zero / low-interest, ≤80% AMI units only. Davis-Bacon if 12+ units. Per-unit cap $30-60K.' },
      { k: 'cdbg', name: 'CDBG — Community Dev Block Grant',
        desc: 'Federal HUD Community Development Block Grant. Flexible source for site, infrastructure, predev, or operating.',
        url: 'https://www.hud.gov/program_offices/comm_planning/cdbg',
        type: 'Grant', notes: 'Davis-Bacon + URA apply at 12+ units. State non-entitlement pot via DOLA. Consolidated Plan cycle.' },
      { k: 'nhtf', name: 'NHTF — National Housing Trust Fund',
        desc: 'Federal HUD source restricted to ELI (≤30% AMI) units. Administered statewide by CHFA in Colorado.',
        url: 'https://www.hud.gov/program_offices/comm_planning/affordablehousing/programs/htf',
        type: 'Loan', notes: 'Deep affordability requirement (≤30% AMI only). 30-yr affordability min. Davis-Bacon applies.' },
      { k: 'impact_fee_loan', name: 'Impact Fee Loan / Waiver',
        desc: 'Municipal impact fee deferral or waiver for affordable units. Highly jurisdiction-specific — check local code.',
        url: 'https://www.cml.org/home/resources-training/affordable-housing-toolkit',
        type: 'Loan + Waiver', notes: 'CO statute permits waivers for income-restricted units. Check city/county impact-fee code.' },
      { k: 'sponsor_loan', name: 'Sponsor / Affiliate Loan',
        desc: 'Developer or related-entity subordinate loan. Often used to bridge timing gaps between closing + LIHTC equity flow.',
        url: '',
        type: 'Loan', notes: 'Deferred. Typical 5-7yr payback from cash flow. Counts as "soft debt" for LIHTC but check related-party rules.' },
      { k: 'historic_tc', name: 'Historic Tax Credit (cash equivalent)',
        desc: '20% federal HTC for certified rehabilitation of historic structures. Often syndicated as equity, modeled here as cash equiv.',
        url: 'https://www.nps.gov/subjects/taxincentives/index.htm',
        type: 'Credit (cash-equiv)', notes: '10-yr credit flow at 20% rate. Stacks with 9% LIHTC but careful basis allocation. CO has state HTC too.' },
      { k: 'nmtc', name: 'NMTC — New Markets Tax Credit',
        desc: 'Federal 39% credit over 7 years for projects in low-income communities. Rarely stacked with LIHTC but possible.',
        url: 'https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit',
        type: 'Credit (cash-equiv)', notes: 'Dual-credit LIHTC+NMTC structures are complex; usually deployed for mixed-use / commercial component.' },
      { k: 'seller_carry', name: 'Seller-carry note',
        desc: 'Seller (often a nonprofit land partner) subordinates a note for the land value. Common where land donated below market.',
        url: '',
        type: 'Loan', notes: 'Deferred. Typical 5-10yr term. Reduces upfront cash needed; check FMV documentation for §42.' },
      { k: 'other', name: 'Other / custom',
        desc: 'Philanthropic grants, foundation PRIs, denominational housing funds, state discretionary programs not listed.',
        url: '',
        type: 'Varies', notes: 'Increasing availability from CO foundations (Daniels Fund, El Pomar, Gates Family Foundation, Anschutz).' }
    ];

    function _render() {
      try {
        var listEl = document.getElementById('dc-soft-funding-ref-list');
        if (!listEl) return;
        var html = PROGRAM_REF.map(function (p) {
          var url = p.url ?
            '<a href="' + p.url + '" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;font-size:var(--tiny);">' + p.url.replace(/^https?:\/\//, '').replace(/\/$/, '') + ' ↗</a>' :
            '<span style="font-size:var(--tiny);color:var(--faint);">(no external authority — sponsor/seller-specific)</span>';
          return '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--card);">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--sp2);margin-bottom:0.25rem;">' +
              '<strong style="font-size:var(--small);color:var(--text);">' + p.name + '</strong>' +
              '<span style="font-size:var(--tiny);padding:1px 6px;border-radius:3px;background:var(--accent-dim);color:var(--accent);font-weight:600;white-space:nowrap;">' + p.type + '</span>' +
            '</div>' +
            '<p style="margin:0 0 0.35rem;font-size:var(--small);line-height:1.45;color:var(--text);">' + p.desc + '</p>' +
            '<p style="margin:0 0 0.35rem;font-size:var(--tiny);color:var(--muted);line-height:1.4;"><strong>Typical:</strong> ' + p.notes + '</p>' +
            '<div>' + url + '</div>' +
          '</div>';
        }).join('');
        listEl.innerHTML = html;
      } catch (e) {
        console.warn('[DealCalc] soft-funding ref render failed', e);
      }
    }

    // F216 — Audit caught a race: this IIFE registers on DOMContentLoaded,
    // but init() also registers there and runs the actual render(mount) that
    // builds the soft-funding panel's DOM. Both fire on the same event, init
    // runs SECOND, so the first _render() pass found no mount → the panel
    // silently never painted. Fix: poll for the mount, up to ~3s.
    var _attempts = 0;
    function _tryRender() {
      var listEl = document.getElementById('dc-soft-funding-ref-list');
      if (listEl) { _render(); return; }
      if (++_attempts < 30) setTimeout(_tryRender, 100);
    }
    _tryRender();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initSoftFundingReference);
  } else {
    _initSoftFundingReference();
  }

  // ──────────────────────────────────────────────────────────────────
  // F204 — Sanity-check warnings on user inputs
  // ──────────────────────────────────────────────────────────────────
  //
  // The audit found Deal Calc accepted any input silently — a user could
  // type $200K TDC for a 60-unit deal (= $3.3K/unit, nonsense) or 15%
  // interest rate (way outside market) with no warning. This adds
  // inline warning pills that surface when an input is outside a
  // reasonable LIHTC-deal range.
  //
  // Each check fires on input/change and writes a small pill below the
  // input. Pills auto-clear when the value moves back into range. The
  // warnings DO NOT block calculation — the developer might be modeling
  // a stress scenario on purpose. They're informational guardrails.
  //
  // Range bands derived from CHFA QAP underwriting norms + recent CO
  // LIHTC closings, conservative on both sides:
  //   • Cost per unit: $200K-$500K (rural-urban span)
  //   • Interest rate: 4.5%-9% (10y Treasury + 200-400bp; current 7%)
  //   • Equity price: $0.75-$1.05 (post-syndication market range)
  //   • Deferred dev fee % of total fee: warn if > 70%
  //   • DSCR: warn if < 1.10 or > 1.40
  //
  // Non-blocking IIFE. Never throws into main calc.
  function _initSanityChecks() {
    // Each check: {id, validate(v) → null | {level: 'warn'|'bad', text}}
    var CHECKS = [
      {
        id: 'dc-tdc',
        deps: ['dc-units'],
        validate: function () {
          var tdc = parseFloat((document.getElementById('dc-tdc') || {}).value) || 0;
          var units = parseFloat((document.getElementById('dc-units') || {}).value) || 0;
          if (tdc <= 0 || units <= 0) return null;
          var perUnit = tdc / units;
          if (perUnit < 200000) {
            return { level: 'bad',
              text: '⚠ ' + _fmtMoney(perUnit) + '/unit is below realistic CO LIHTC range ($200K-$500K). Check TDC ÷ units.' };
          }
          if (perUnit > 500000) {
            return { level: 'warn',
              text: '⚠ ' + _fmtMoney(perUnit) + '/unit is above typical LIHTC range. Confirm rural/resort premium or rehab scope.' };
          }
          return null;
        }
      },
      {
        id: 'dc-rate',
        validate: function () {
          var r = parseFloat((document.getElementById('dc-rate') || {}).value);
          if (!isFinite(r) || r === 0) return null;
          if (r < 4.5) return { level: 'warn', text: '⚠ ' + r.toFixed(2) + '% is below current market (≈7% perm in 2026). Stress-test at market rate.' };
          if (r > 9.0) return { level: 'warn', text: '⚠ ' + r.toFixed(2) + '% is above typical perm range (4.5%-9%). Verify lender quote.' };
          return null;
        }
      },
      {
        id: 'dc-equity-price',
        validate: function () {
          var p = parseFloat((document.getElementById('dc-equity-price') || {}).value);
          if (!isFinite(p) || p === 0) return null;
          if (p < 0.75) return { level: 'warn', text: '⚠ $' + p.toFixed(2) + '/credit is below distressed-market range. Verify syndicator quote.' };
          if (p > 1.05) return { level: 'warn', text: '⚠ $' + p.toFixed(2) + '/credit is above peak market. Confirm with syndicator.' };
          return null;
        }
      },
      {
        id: 'dc-dcr',
        validate: function () {
          var d = parseFloat((document.getElementById('dc-dcr') || {}).value);
          if (!isFinite(d) || d === 0) return null;
          if (d < 1.10) return { level: 'bad', text: '⚠ DSCR ' + d.toFixed(2) + ' is below CHFA minimum (1.15). Lender will not size at this coverage.' };
          if (d > 1.40) return { level: 'warn', text: '⚠ DSCR ' + d.toFixed(2) + ' over-constrains mortgage. Most LIHTC sizes at 1.15-1.25.' };
          return null;
        }
      },
      {
        // F216 — audit caught this referencing nonexistent `dc-deferred-dev-fee`.
        // The actual input is `dc-deferred-pct` (0-100 slider for the cap on
        // % of total dev fee deferred). We can warn directly off that.
        id: 'dc-deferred-pct',
        validate: function () {
          var pct = parseFloat((document.getElementById('dc-deferred-pct') || {}).value);
          if (!isFinite(pct) || pct === 0) return null;
          if (pct > 70) {
            return { level: 'warn',
              text: '⚠ Deferring ' + pct.toFixed(0) + '% of dev fee. CHFA flags > 70% as cash-flow risk — typical cap is 60%.' };
          }
          return null;
        }
      }
    ];
    function _fmtMoney(n) {
      if (!isFinite(n)) return '$—';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return '$' + Math.round(n);
    }
    function _refresh(id) {
      try {
        var check = CHECKS.find(function (c) { return c.id === id; });
        if (!check) return;
        var input = document.getElementById(id);
        if (!input) return;
        var pillId = 'dc-sanity-' + id;
        var existing = document.getElementById(pillId);
        var result = check.validate();
        if (!result) {
          if (existing) existing.remove();
          return;
        }
        var bg = result.level === 'bad' ? 'var(--bad-dim, #fee2e2)' : 'var(--warn-dim, #fef3c7)';
        var fg = result.level === 'bad' ? 'var(--bad, #991b1b)' : 'var(--warn, #a84608)';
        if (existing) {
          existing.textContent = result.text;
          existing.style.background = bg;
          existing.style.color = fg;
        } else {
          var pill = document.createElement('div');
          pill.id = pillId;
          pill.className = 'dc-sanity-pill';
          pill.style.cssText = 'margin-top:4px;padding:4px 10px;font-size:.74rem;line-height:1.4;border-radius:var(--radius-sm);background:' + bg + ';color:' + fg + ';border:1px solid currentColor;font-weight:600;';
          pill.textContent = result.text;
          // Insert right after the input's parent label (so the pill sits
          // under the field group, not floating in the grid).
          var parent = input.closest('label') || input.parentElement;
          if (parent && parent.parentNode) {
            parent.parentNode.insertBefore(pill, parent.nextSibling);
          } else {
            input.parentNode.appendChild(pill);
          }
        }
      } catch (e) {
        console.warn('[DealCalc] sanity check failed for', id, e);
      }
    }
    function _refreshAll() { CHECKS.forEach(function (c) { _refresh(c.id); }); }
    // Wire each check + its dependencies (e.g. cost/unit needs both tdc + units)
    CHECKS.forEach(function (c) {
      var watch = [c.id].concat(c.deps || []);
      watch.forEach(function (depId) {
        var el = document.getElementById(depId);
        if (el) {
          el.addEventListener('input',  function () { _refresh(c.id); });
          el.addEventListener('change', function () { _refresh(c.id); });
        }
      });
    });
    // First paint after main calc has populated defaults
    setTimeout(_refreshAll, 250);
    // Re-check after every recalculate so derived inputs (NOI, DSCR) stay live
    if (window.__DealCalc && typeof window.__DealCalc.recalculate === 'function') {
      var _origRecalc = window.__DealCalc.recalculate;
      window.__DealCalc.recalculate = function () {
        var r = _origRecalc.apply(this, arguments);
        setTimeout(_refreshAll, 40);
        return r;
      };
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initSanityChecks);
  } else {
    _initSanityChecks();
  }

  // ──────────────────────────────────────────────────────────────────
  // F215 — CHFA portfolio comparables (similarity scored)
  // ──────────────────────────────────────────────────────────────────
  //
  // Loads data/affordable-housing/properties.json (1,920 CO records merged
  // from CHFA + HUD MF + preservation) and scores each against the user's
  // proposed deal on 5 dimensions:
  //
  //   1. **County match** (40 pts) — exact county FIPS hit
  //   2. **Unit count proximity** (25 pts) — within ±20% of proposed
  //   3. **Credit type match** (15 pts) — 9% / 4% — based on proposed equity
  //      pricing (>$0.85 → 9%, ≤ $0.85 → 4% typically)
  //   4. **Project type match** (10 pts) — new construction vs preservation
  //   5. **Recency** (10 pts) — award_year ≥ 2020 = max; earlier = scaled
  //
  // Total = 0-100. Top 5 by score, ties broken by recency.
  //
  // The user gets:
  //   • Name + city + units + credit type + award year
  //   • Similarity score with color band (green ≥70, yellow 40-70, red < 40)
  //   • Direct link to the property record (where the data lives)
  //
  // Non-blocking IIFE following the F193/F195/F197 pattern. Fetches the
  // properties file once, caches it, refreshes the comps on every
  // recalculate so deal-input edits move the rankings live.
  function _initChfaComparables() {
    var _propsCache = null;

    function _loadProps() {
      if (_propsCache) return Promise.resolve(_propsCache);
      return fetch('data/affordable-housing/properties.json')
        .then(function (r) { return r.json(); })
        .then(function (j) { _propsCache = (j && j.properties) || []; return _propsCache; })
        .catch(function (e) {
          console.warn('[DealCalc] CHFA comps fetch failed', e);
          _propsCache = []; return _propsCache;
        });
    }

    function _proposedCreditType() {
      // Heuristic: equity pricing >= $0.85/credit → 9% deal; otherwise 4%.
      // (9% deals trade above $0.85 in 2026; 4% bond deals below.)
      var priceEl = document.getElementById('dc-equity-price');
      var price = priceEl ? +priceEl.value || 0.90 : 0.90;
      return price >= 0.85 ? '9%' : '4%';
    }
    function _normCreditType(s) {
      if (!s) return null;
      var t = String(s).toLowerCase();
      if (/9.?%|9pct|9-?per/.test(t)) return '9%';
      if (/4.?%|4pct|4-?per|tax.?exempt|bond/.test(t)) return '4%';
      return null;
    }
    function _proposedProjectType() {
      // F84 deal-type radio if present; otherwise default to New Construction.
      var checked = document.querySelector('input[name="dc-deal-type"]:checked');
      if (!checked) return 'new';
      var v = checked.value;
      if (/preservation|acq/.test(v)) return 'preservation';
      if (/workforce|prop123/.test(v)) return 'new';
      return 'new';
    }
    function _propProjectType(prop) {
      var pt = String(prop.project_type || '').toLowerCase();
      var cat = String(prop.property_category || '').toLowerCase();
      if (/preserv|rehab|acq/.test(pt) || /preserv|subsidized/.test(cat)) return 'preservation';
      return 'new';
    }

    function _scoreProp(prop, ctx) {
      var s = 0;
      // 1. County (40 pts)
      var propFips = String(prop.county_fips || '').padStart(5, '0');
      if (ctx.countyFips && propFips === ctx.countyFips) s += 40;
      else if (ctx.countyFips && propFips.substring(0, 2) === ctx.countyFips.substring(0, 2)) s += 8; // same state, different county
      // 2. Unit proximity (25 pts)
      var u = +prop.total_units || +prop.assisted_units || 0;
      if (ctx.proposedUnits > 0 && u > 0) {
        var ratio = Math.min(u, ctx.proposedUnits) / Math.max(u, ctx.proposedUnits);
        s += Math.round(25 * ratio);  // 1.0 = full credit; 0.5 = half; etc.
      }
      // 3. Credit type (15 pts)
      var credit = _normCreditType(prop.type_of_credits);
      if (credit && ctx.proposedCredit && credit === ctx.proposedCredit) s += 15;
      // 4. Project type (10 pts)
      if (_propProjectType(prop) === ctx.proposedProject) s += 10;
      // 5. Recency (10 pts) — award_year ≥ 2020 → 10; 2015-2019 → 5; older → 1
      var yr = +prop.award_year || +prop.reservation_year || +prop.year_placed_in_service || 0;
      if (yr >= 2020) s += 10;
      else if (yr >= 2015) s += 5;
      else if (yr >= 2010) s += 2;
      return s;
    }

    function _refresh() {
      try {
        var bodyEl = document.getElementById('dc-chfa-comps-body');
        if (!bodyEl) return;
        var countyEl = document.getElementById('dc-county-select');
        var countyFips = countyEl && countyEl.value ? String(countyEl.value).padStart(5, '0') : null;
        // Fall back to WorkflowState if no county picked locally
        if (!countyFips && window.WorkflowState && window.WorkflowState.getActiveProject) {
          try {
            var proj = window.WorkflowState.getActiveProject();
            var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
            if (jx && jx.fips) countyFips = String(jx.fips).padStart(5, '0');
          } catch (_) {}
        }
        if (!countyFips) {
          bodyEl.innerHTML = '<p style="color:var(--muted);font-size:var(--tiny);margin:0;">Select a county above to load CHFA comparables.</p>';
          return;
        }
        var unitsEl = document.getElementById('dc-units');
        var proposedUnits = unitsEl ? +unitsEl.value || 0 : 0;
        var ctx = {
          countyFips: countyFips,
          proposedUnits: proposedUnits,
          proposedCredit: _proposedCreditType(),
          proposedProject: _proposedProjectType()
        };
        _loadProps().then(function (props) {
          if (!props || !props.length) {
            bodyEl.innerHTML = '<p style="color:var(--muted);font-size:var(--tiny);margin:0;">CHFA comparables database not available.</p>';
            return;
          }
          // Filter to LIHTC-program records (skip pure HUD MF or USDA-only)
          var lihtcProps = props.filter(function (p) {
            var pt = p.program_type;
            if (!Array.isArray(pt)) return false;
            return pt.some(function (t) { return /lihtc/i.test(t); });
          });
          var scored = lihtcProps
            .map(function (p) { return { prop: p, score: _scoreProp(p, ctx) }; })
            .filter(function (r) { return r.score > 0; })
            .sort(function (a, b) {
              if (b.score !== a.score) return b.score - a.score;
              var yA = +a.prop.award_year || 0, yB = +b.prop.award_year || 0;
              return yB - yA;
            })
            .slice(0, 5);
          if (!scored.length) {
            bodyEl.innerHTML = '<p style="color:var(--muted);font-size:var(--tiny);margin:0;">No CHFA comparables in this county. Try widening the search.</p>';
            return;
          }
          var rows = scored.map(function (r) {
            var p = r.prop;
            var name = p.property_name || 'Unknown';
            var city = p.city || '';
            var units = p.total_units || p.assisted_units || 0;
            var credit = _normCreditType(p.type_of_credits) || '—';
            var yr = p.award_year || p.year_placed_in_service || '—';
            var scoreColor = r.score >= 70 ? 'var(--good)' :
                             r.score >= 40 ? 'var(--warn)' : 'var(--bad)';
            var scoreBg = r.score >= 70 ? 'var(--good-dim)' :
                          r.score >= 40 ? 'var(--warn-dim)' : 'var(--bad-dim)';
            return '<tr style="border-bottom:1px solid var(--border);">' +
              '<td style="padding:0.35rem 0.4rem;font-weight:600;">' + name + '</td>' +
              '<td style="padding:0.35rem 0.4rem;color:var(--muted);">' + city + '</td>' +
              '<td style="padding:0.35rem 0.4rem;text-align:right;color:var(--muted);">' + yr + '</td>' +
              '<td style="padding:0.35rem 0.4rem;text-align:right;font-weight:600;">' + units + '</td>' +
              '<td style="padding:0.35rem 0.4rem;text-align:center;color:var(--muted);">' + credit + '</td>' +
              '<td style="padding:0.35rem 0.4rem;text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-sm);font-weight:700;background:' + scoreBg + ';color:' + scoreColor + ';">' + r.score + '</span></td>' +
            '</tr>';
          }).join('');
          bodyEl.innerHTML =
            '<p style="color:var(--muted);font-size:var(--tiny);margin:0 0 var(--sp1);">' +
              'Scored by: county match (40 pts) + unit proximity (25 pts) + credit type (15 pts) + project type (10 pts) + recency (10 pts) = 100 max. ' +
              'Proposed: <strong>' + proposedUnits + ' units · ' + ctx.proposedCredit + ' · ' + ctx.proposedProject + '</strong>.' +
            '</p>' +
            '<table style="width:100%;border-collapse:collapse;font-size:var(--small);">' +
              '<thead><tr>' +
                '<th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">Project</th>' +
                '<th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">City</th>' +
                '<th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">Award yr</th>' +
                '<th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">Units</th>' +
                '<th style="text-align:center;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">Credit</th>' +
                '<th style="text-align:center;color:var(--muted);font-weight:600;padding:0.3rem 0.4rem;border-bottom:1px solid var(--border);">Score</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '<p style="margin:var(--sp2) 0 0;font-size:var(--tiny);color:var(--faint);line-height:1.5;">' +
              'Source: <a href="https://www.chfainfo.com/multifamily-finance/properties" target="_blank" rel="noopener" style="color:var(--accent);">CHFA Housing Tax Credit Properties</a> + HUD Multifamily + CHFA Preservation. ' +
              'Equity pricing, soft-debt stack, and stabilized DSCR are NOT public — these scores match by visible attributes only.' +
            '</p>';
        });
      } catch (e) {
        console.warn('[DealCalc] CHFA comps refresh failed', e);
      }
    }
    // First paint + recalculate hook
    setTimeout(_refresh, 300);
    if (window.__DealCalc && typeof window.__DealCalc.recalculate === 'function') {
      var _origRecalc = window.__DealCalc.recalculate;
      window.__DealCalc.recalculate = function () {
        var r = _origRecalc.apply(this, arguments);
        setTimeout(_refresh, 80);
        return r;
      };
    }
    // Toggle hook so the details open triggers a refresh
    var detEl = document.getElementById('dc-chfa-comps-details');
    if (detEl) detEl.addEventListener('toggle', function () { if (detEl.open) _refresh(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initChfaComparables);
  } else {
    _initChfaComparables();
  }

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
