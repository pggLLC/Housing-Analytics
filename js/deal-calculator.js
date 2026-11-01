(function () {
  'use strict';
  function loanTypeOptions(selected) {
    return Object.keys(dealEngine().LOAN_TYPES).map(function (key) {
      return '<option value="' + key + '"' + (key === selected ? ' selected' : '') + '>' + dealEngine().LOAN_TYPES[key] + '</option>';
    }).join('');
  }

  var provenanceLabel = window.ProvenanceLabel || (typeof require === 'function' ? require('./provenance-label.js') : null);
  var MoneyFormatter = window.MoneyFormatter || (typeof require === 'function' ? require('./utils/format-money.js') : null);

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
  var _chfaRentTable = null;
  var _homeRentTable = null;    // data/hud-home-rent-limits-co-2026.json
  var _prop123Rules = null;     // data/policy/prop123-rental-rules.json
  var _costRules = null;        // data/policy/lihtc-underwriting-rules.json (#2160)
  var _chfaTables = null;       // data/policy/chfa-common-app-tables.json (CHFA's 2027 workbook limits)
  var _countyFips = null;   // 5-digit FIPS of the currently selected county
  var _creditRate = _cfg.creditRate9Pct || 0.09;
  var _equityPricingDefaults = {
    credit_9pct: _cfg.equityPrice9Pct || 0.82,
    credit_4pct: _cfg.equityPrice4Pct || 0.83
  };
  var EQUITY_PRICE_DEFAULT = _equityPricingDefaults.credit_9pct;
  var _amiGapData = null;       // cached co_ami_gap_by_county.json
  var _amiGapPlaceData = null;  // F45: cached co_ami_gap_by_place.json
  var _chasAaData = null;       // cached hna/chas_affordable_available.json
  var _softFundingStatus = null; // #1236: non-scored jurisdiction funding context
  var _developerOwnershipFunding = null; // #1167 OWN-3: developer-facing ownership funding stack
  var _resaleConventions = null; // #1167 OWN-4: pluggable resale convention screen
  var _permits = null; // #1842: BPS permit-declared structure cost, context under the TDC input; never an input
  var _unitSizeStandards = null; // #1814: reference unit sizes for the gross-area estimate (never auto-applied)
  var UnitSize = window.DealCalcUnitSize || (typeof require === 'function' ? require('./deal-calculator-unit-size.js') : null);
  var _resaleSelection = { subsidyType: 'none', selectedConventionId: null };
  var _pabByGeoid = null;   // F25: PAB direct allocations (county FIPS / place geoid)
  var _pabMeta = null;      // F25: PAB allocations metadata
  var DEAL_AMI_BANDS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
  var MIDDLE_INCOME_AMI_BANDS = { 110: true, 120: true };
  var DEFAULT_MINIMUM_SET_ASIDE_ELECTION = '40-60';
  var MINIMUM_SET_ASIDE_ELECTIONS = {
    '20-50': { minimumShare: 0.20, setAsideCeiling: 50, creditCeiling: 60 },
    '40-60': { minimumShare: 0.40, setAsideCeiling: 60, creditCeiling: 60 },
    'average-income': { minimumShare: 0.40, setAsideCeiling: 80, creditCeiling: 80 }
  };
  // Bedroom types offered in the per-tier unit split. Studio was historically
  // absent here while being present in the tier <select>, in _amiLimitsByBr,
  // and in getZoriPerBrRent -- so a studio rent limit was displayed but studio
  // units could not be entered. Kept as one constant because the previous
  // duplicate literal appeared at six call sites and drifted.
  var SPLIT_BR_TYPES = ['studio', '1br', '2br', '3br', '4br'];
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var NO_LIHTC_CREDITS = 'No LIHTC credits — CHFA allocates all Colorado housing tax credits; this rent setting is not a CHFA LIHTC deal';
  var _utilityAllowance = { applied: false, reason: 'subject_project_unavailable' };
  var _sharedUtilityAllowance = null;
  var _allowanceSourceChanged = false;
  var _subjectProjectSubscription = null;
  var _unsubscribeSubjectProject = null;
  // Q5: Zillow ZORI market-rent index (smoothed, seasonally-adjusted, monthly).
  // Used for the "achievable-rent cap" toggle that under-writes 70%-120% AMI
  // units at min(planning ceiling, market rent) in weak markets where higher-AMI
  // ceilings exceed what the local market will actually
  // pay. See docs/MARKET-RENT-AND-KALSHI.md for the rationale.
  var _zoriData = null;            // cached zori_rents_co.json
  var _renterBedroomMix = null;   // cached acs_renter_bedrooms_co.json
  // F96 — Triangulation sources for the achievable-rent cap. ZORI is the
  // PRIMARY signal (broadest coverage, monthly); these two are surfaced
  // in the cap-status pane so the user can see independent confirmation:
  //
  //   Apartment List — monthly, ~21 CO cities, explicit 1BR/2BR medians
  //   DOLA Apartment Rent Survey — twice-yearly, ~14 CO regions, the
  //     source CHFA QAP underwriters actually use; vacancy + per-BR.
  //
  // Both soft-load; the cap math still runs off ZORI when either is missing.
  var _dolaSurvey = null;   // cached dola_rent_survey_co.json
  // Published jurisdiction B25064; absence is retained when Census suppresses it.
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

  function _numOrNull(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : null;
  }

  function _escHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // #2160: itemized development costs. The lines come from js/deal-cost-basis.js;
  // the example budget it prefills is INVENTED and the page says so.
  function costBasisModule() {
    return window.DealCostBasis || (typeof require === 'function' ? require('./deal-cost-basis.js') : null);
  }
  var COST_BASIS_CHOICES = [['eligible', 'In basis'], ['partial', 'Partly in basis'], ['ineligible', 'Not in basis']];
  function costTableHtml() {
    var cb = costBasisModule();
    if (!cb) return '<p>Cost lines are unavailable: js/deal-cost-basis.js did not load.</p>';
    var lines = cb.exampleLines();
    var field = 'width:100%;min-height:44px;padding:0.3rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);';
    return cb.GROUPS.map(function (g) {
      var rows = lines.filter(function (l) { return l.group === g.id; }).map(function (l) {
        var id = 'dc-cost-' + l.id;
        var fixed = cb.NEVER_IN_BASIS && cb.NEVER_IN_BASIS[l.id];
        var opts = fixed ? '<option value="ineligible" selected>Not in basis</option>' : COST_BASIS_CHOICES.map(function (c) {
          return '<option value="' + c[0] + '"' + (c[0] === l.basis ? ' selected' : '') + '>' + c[1] + '</option>';
        }).join('');
        var extra = '<label data-cost-partial="' + l.id + '"' + (l.basis === 'partial' ? '' : ' hidden') + ' style="grid-column:1/-1;font-size:var(--tiny);color:var(--muted);' + (l.basis === 'partial' ? '' : 'display:none;') + '">Part in basis ($)'
          + '<input id="' + id + '-eligible" type="number" min="0" step="10000" value="' + (l.eligibleAmount == null ? '' : l.eligibleAmount) + '" placeholder="not entered" style="' + field + '"></label>';
        if (cb.CONTINGENCY_KINDS[l.id]) {
          extra += '<label style="grid-column:1/-1;font-size:var(--tiny);color:var(--muted);">Proposed use so far ($)'
            + '<input id="' + id + '-used" type="number" min="0" step="10000" value="' + (l.used == null ? '' : l.used) + '" placeholder="not entered" style="' + field + '">'
            + '<span data-cost-remaining="' + l.id + '" style="display:block;margin-top:.15rem;"></span></label>';
        }
        // Label on its own row so it never shrinks to a sliver at phone width;
        // each control gets its own cell for the provenance badge beside it.
        return '<div class="dc-cost-line" data-cost-line="' + l.id + '" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.25rem .5rem;align-items:start;padding:.4rem 0;border-top:1px solid var(--border);">'
          + '<label for="' + id + '" style="grid-column:1/-1;display:block;justify-self:start;font-size:var(--small);font-weight:600;text-align:left;">' + _escHtml(l.label) + '</label>'
          + '<div style="min-width:0;"><input id="' + id + '" type="number" min="0" step="10000" value="' + (l.amount == null ? '' : l.amount) + '" placeholder="none" aria-label="' + _escHtml(l.label) + ' ($)" style="' + field + '"></div>'
          + '<div style="min-width:0;"><select id="' + id + '-basis" aria-label="' + _escHtml(l.label) + ': in eligible basis?"' + (fixed ? ' disabled title="' + _escHtml(fixed) + '"' : '') + ' style="' + field + '">' + opts + '</select></div>'
          + '<span data-cost-per="' + l.id + '" style="grid-column:1/-1;font-size:var(--tiny);color:var(--muted);"></span>'
          + extra + '</div>';
      }).join('');
      // DOH's categories, each closed to its subtotal until opened.
      return '<details class="dc-cost-group" data-cost-group="' + g.id + '" style="margin-top:var(--sp2);border-top:1px solid var(--border);padding-top:.3rem;">'
        + '<summary style="display:flex;justify-content:space-between;gap:.5rem;min-height:44px;align-items:center;cursor:pointer;font-size:var(--small);font-weight:700;">'
        + '<span>' + _escHtml(g.label) + '</span><span data-cost-subtotal="' + g.id + '" style="font-variant-numeric:tabular-nums;"></span></summary>' + rows + '</details>';
    }).join('');
  }
  function readCostLines() {
    var cb = costBasisModule();
    if (!cb) return [];
    return cb.LINE_TEMPLATE.map(function (t) {
      function v(suffix) { var el = document.getElementById('dc-cost-' + t.id + suffix); return el ? String(el.value).trim() : ''; }
      var basisEl = document.getElementById('dc-cost-' + t.id + '-basis');
      return { id: t.id, label: t.label, group: t.group, basis: basisEl ? basisEl.value : t.basis,
        amount: v('') === '' ? null : v(''), eligibleAmount: v('-eligible') === '' ? null : v('-eligible'),
        used: cb.CONTINGENCY_KINDS[t.id] ? (v('-used') === '' ? null : v('-used')) : undefined };
    });
  }

  // DOH PR 2: the operating budget in DOH's four expense groups and its other
  // income lines (js/deal-operating-budget.js). The example amounts are INVENTED.
  function operatingBudgetModule() {
    return window.DealOperatingBudget || (typeof require === 'function' ? require('./deal-operating-budget.js') : null);
  }
  function permanentFinancingModule() {
    return window.DealPermanentFinancing || (typeof require === 'function' ? require('./deal-permanent-financing.js') : null);
  }
  // DOH PR 4: sources and uses by activity and the 15-year pro forma rows.
  function dohSchedulesModule() {
    return window.DealDohSchedules || (typeof require === 'function' ? require('./deal-doh-schedules.js') : null);
  }
  // DOH's C / T / F loan types as select options.
  function lenderTypeOptions(selected) {
    var pf = permanentFinancingModule();
    var types = pf ? pf.LENDER_TYPES : [{ id: 'C', label: 'Conventional' }, { id: 'T', label: 'Tax-exempt' }, { id: 'F', label: 'Federal financing' }];
    return types.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === selected ? ' selected' : '') + '>' + t.label + ' (' + t.id + ')</option>';
    }).join('');
  }
  // separateHtml holds the markup of the lines kept on their own inputs, keyed
  // by SEPARATE_LINES id; each renders before the line DOH's sheet puts it ahead of.
  function operatingBudgetHtml(separateHtml) {
    var ob = operatingBudgetModule();
    if (!ob) return '<p>The operating budget is unavailable: js/deal-operating-budget.js did not load.</p>';
    var field = 'width:100%;min-height:44px;padding:0.3rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);';
    function lineHtml(id, label, amount, perAttr) {
      return '<div class="dc-op-line" style="padding:.4rem 0;border-top:1px solid var(--border);">'
        + '<label for="' + id + '" style="display:block;font-size:var(--small);font-weight:600;">' + _escHtml(label) + ' ($ per unit per year)</label>'
        + '<input id="' + id + '" type="number" min="0" step="25" value="' + (amount == null ? '' : amount) + '" placeholder="none" style="' + field + '">'
        + '<span ' + perAttr + ' style="display:block;font-size:var(--tiny);color:var(--muted);"></span></div>';
    }
    var lines = ob.exampleLines();
    var groups = ob.GROUPS.map(function (g) {
      var rows = lines.filter(function (l) { return l.group === g.id; }).map(function (l) {
        var ahead = ob.SEPARATE_LINES.filter(function (sl) { return sl.before === l.id; }).map(function (sl) {
          return (separateHtml && separateHtml[sl.id]) || '';
        }).join('');
        return ahead + lineHtml('dc-op-' + l.id, l.label, l.amount, 'data-op-per="' + l.id + '"');
      }).join('');
      return '<details class="dc-op-group" data-op-group="' + g.id + '" style="margin-top:var(--sp2);border-top:1px solid var(--border);padding-top:.3rem;">'
        + '<summary style="display:flex;justify-content:space-between;gap:.5rem;min-height:44px;align-items:center;cursor:pointer;font-size:var(--small);font-weight:700;">'
        + '<span>' + _escHtml(g.label) + '</span><span data-op-subtotal="' + g.id + '" style="font-variant-numeric:tabular-nums;"></span></summary>' + rows + '</details>';
    }).join('');
    var income = ob.exampleIncome().map(function (l) {
      return lineHtml('dc-op-income-' + l.id, l.label, l.amount, 'data-op-income-per="' + l.id + '"');
    }).join('');
    return groups + '<details class="dc-op-group" data-op-group="income" style="margin-top:var(--sp2);border-top:1px solid var(--border);padding-top:.3rem;">'
      + '<summary style="display:flex;justify-content:space-between;gap:.5rem;min-height:44px;align-items:center;cursor:pointer;font-size:var(--small);font-weight:700;">'
      + '<span>Other income</span><span data-op-subtotal="income" style="font-variant-numeric:tabular-nums;"></span></summary>'
      + '<p style="font-size:var(--tiny);color:var(--muted);margin:.3rem 0;">Added to rent before vacancy, as in DOH\'s sheet, and grown at the rent growth rate.</p>' + income + '</details>';
  }
  function readOperatingLines() {
    var ob = operatingBudgetModule();
    if (!ob) return null;
    function v(id) { var el = document.getElementById(id); return el ? String(el.value).trim() : ''; }
    return {
      lines: ob.LINE_TEMPLATE.map(function (t) { var raw = v('dc-op-' + t.id); return { id: t.id, label: t.label, group: t.group, amount: raw === '' ? null : raw }; }),
      income: ob.INCOME_TEMPLATE.map(function (t) { var raw = v('dc-op-income-' + t.id); return { id: t.id, label: t.label, amount: raw === '' ? null : raw }; })
    };
  }

  function _getCreditPricingDefault(is4Pct) {
    return is4Pct ? _equityPricingDefaults.credit_4pct : _equityPricingDefaults.credit_9pct;
  }

  function _activeCreditIs4Pct() {
    var rate4 = document.getElementById('dc-rate-4');
    if (rate4) return !!rate4.checked;
    return Math.abs(Number(_creditRate) - 0.04) < 0.0001;
  }

  function _setEquityPriceInputToDefault(options) {
    var opts = options || {};
    var input = document.getElementById('dc-equity-price');
    var defaultPrice = _getCreditPricingDefault(_activeCreditIs4Pct());
    EQUITY_PRICE_DEFAULT = defaultPrice;
    if (!input) return defaultPrice;
    var current = _numOrNull(input.value);
    var shouldUpdate = opts.force || current == null ||
      Math.abs(current - (_cfg.equityPrice9Pct || 0.82)) < 0.0001 ||
      Math.abs(current - (_cfg.equityPrice4Pct || 0.83)) < 0.0001;
    if (shouldUpdate) {
      input.value = defaultPrice.toFixed(2);
      if (window.InputProvenance) window.InputProvenance.mark(input, { status: 'assumption',
        why: 'Credit-pricing benchmark used as a screening default; obtain project-specific pricing.' });
      if (opts.dispatch !== false) {
        prefillEvents(input);
      }
    }
    return defaultPrice;
  }

  function _applyNovogradacPricingDefaults(doc, options) {
    var nat = doc && doc.pricing && doc.pricing.national_avg;
    var nine = _numOrNull(nat && nat.credit_9pct);
    var four = _numOrNull(nat && nat.credit_4pct);
    if (!nine || !four) return false;
    _equityPricingDefaults = {
      credit_9pct: nine,
      credit_4pct: four
    };
    _setEquityPriceInputToDefault(Object.assign({ force: true }, options || {}));
    return true;
  }

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
    return window.DealCalculatorMath.mortgageConstant(annualRate, termYears);
  }

  function getCurrentAmi4Person() {
    var hudFmr = window.HudFmr;
    if (!_countyFips || !hudFmr || typeof hudFmr.getIncomeLimitsByFips !== 'function') return NaN;
    var il = hudFmr.getIncomeLimitsByFips(_countyFips);
    return il && il.ami_4person ? +il.ami_4person : NaN;
  }

  /**
   * Cost per gross square foot, or null.
   *
   * null, never 0 — and never omitted. $/SF is the figure a developer, lender
   * or appraiser checks FIRST, because it is the one they can compare against
   * everything else they have seen. A 0 would read as "this project costs
   * nothing per foot"; an absent key reads as "this tool does not do that".
   * Neither is true when the answer is "nobody entered a floor area".
   *
   * Gross area is deliberately not derived from unit count. Unit sizes sum to
   * NET rentable area; dividing TDC by that overstates $/SF by however much
   * circulation, mechanical and common space the building has — commonly
   * 15-25%. Guessing it would produce a plausible number that is wrong in a
   * consistent direction, which is worse than no number at all.
   */
  function costPerGrossSf(tdc, grossSf) {
    return dealEngine().costPerGrossSf(tdc, grossSf);
  }

  // Preserve the existing source fallback for an absent or malformed override.
  function readDeveloperFundingPrograms(programs) {
    if (Array.isArray(programs)) return programs;
    if (programs && Array.isArray(programs.programs)) return programs.programs;
    return _developerOwnershipFunding && Array.isArray(_developerOwnershipFunding.programs)
      ? _developerOwnershipFunding.programs : [];
  }

  function readOwnershipSources(input) {
    var maxAffordablePrice = input.maxAffordablePrice ||
      (window.OwnershipFinance && window.OwnershipFinance.maxAffordablePrice) ||
      (window.HNAOwnershipNeed && window.HNAOwnershipNeed.maxAffordablePrice);
    var target = +input.targetAmiPct;
    if (!isFinite(target) || target <= 0) target = 0.80;
    var price = typeof maxAffordablePrice === 'function' && isFinite(+input.ami4Person) && +input.ami4Person > 0
      ? maxAffordablePrice(+input.ami4Person, target, input.assumptions) : null;
    var resolved = Object.assign({}, input, {
      hasAffordablePriceHelper: typeof maxAffordablePrice === 'function',
      maxAffordableSalePrice: price,
      developerFundingPrograms: readDeveloperFundingPrograms(input.developerFundingPrograms),
      ownershipResale: computeOwnershipResale({ maxAffordableSalePrice: price,
        ami4Person: +input.ami4Person, targetAmiPct: target }, input)
    });
    delete resolved.maxAffordablePrice;
    return resolved;
  }

  function computeForSaleFeasibility(input) {
    return dealEngine().computeForSaleFeasibility(readOwnershipSources(input || {}));
  }

  function computeOwnershipResale(feasibility, input) {
    var resale = window.OwnershipResale;
    if (!resale || typeof resale.evaluateAll !== 'function') return null;
    var conventions = input && input.resaleConventions ? input.resaleConventions : _resaleConventions;
    function positivePrice(value) {
      if (value == null || value === '') return null;
      var parsed = Number(value);
      return isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    var purchasePrice = positivePrice(input && input.resalePurchasePrice);
    if (purchasePrice == null) purchasePrice = positivePrice(feasibility && feasibility.maxAffordableSalePrice);
    var unavailableReason = purchasePrice == null
      ? (input && input.resalePurchasePriceUnavailableReason) || 'A positive purchase price is unavailable; resale price and owner equity cannot be calculated.'
      : null;
    var baseInput = {
      purchasePrice: purchasePrice,
      unavailableReason: unavailableReason,
      holdingPeriodYears: input && input.resaleHoldingYears,
      remainingPrincipal: input && input.resaleRemainingPrincipal,
      sellingCosts: input && input.resaleSellingCosts,
      marketAppreciation: input && input.resaleMarketAppreciation,
      ami4Person: feasibility && feasibility.ami4Person,
      targetAmiPct: feasibility && feasibility.targetAmiPct,
      assumptions: input && input.assumptions,
      maxAffordablePrice: input && input.maxAffordablePrice
    };
    return {
      label: 'Resale convention screen - screening only',
      ownerDecision: 'D-4 resolved: compare all mechanisms and let the user select; no ranking',
      rows: resale.evaluateAll(conventions, baseInput),
      comparison: resale.compareConventions(conventions, Object.assign({}, baseInput, {
        holdingPeriodYears: input && input.resaleHoldingYears || 10,
        cpiRateAnnual: 0.02,
        recaptureAmount: 90000,
        subsidyType: input && input.resaleSubsidyType || 'none',
        selectedConventionId: input && input.resaleConventionId
      }))
    };
  }

  function computeDeveloperOwnershipFundingStack(feasibility, options) {
    var opts = options || {};
    return dealEngine().computeDeveloperOwnershipFundingStack(feasibility, Object.assign({}, opts, {
      programs: readDeveloperFundingPrograms(opts.programs)
    }));
  }

  function renderDeveloperOwnershipFundingStack(stack) {
    var mount = document.getElementById('dc-own-funding-stack');
    if (!mount) return;
    function fmt(n) {
      return isFinite(n) ? ('$' + Math.round(n).toLocaleString('en-US')) : 'Value unavailable';
    }
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    var title = document.createElement('p');
    title.style.cssText = 'margin:.55rem 0 .2rem;font-weight:700;font-size:var(--tiny);color:var(--text);';
    title.textContent = 'Developer ownership funding stack - screening only';
    mount.appendChild(title);

    if (!stack || !stack.sourceCount) {
      var empty = document.createElement('p');
      empty.style.cssText = 'margin:0;font-size:var(--tiny);color:var(--muted);line-height:1.45;';
      empty.textContent = 'Developer stack sources unavailable; verify local tools before treating the residual as final.';
      mount.appendChild(empty);
      return;
    }

    var list = document.createElement('ul');
    list.style.cssText = 'margin:.2rem 0 .35rem;padding-left:1rem;font-size:var(--tiny);color:var(--muted);line-height:1.45;';
    function addProvenance(li, source) {
      var holder = document.createElement('span');
      holder.innerHTML = provenanceLabel.html(source);
      while (holder.firstChild) li.appendChild(holder.firstChild);
    }
    (stack.appliedSources || []).forEach(function (source) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(source.name + (source.screeningOnly ? ' (potential — not committed)' : '') +
        ': ' + fmt(source.appliedAmountPerUnit) + ' / unit applied · '));
      addProvenance(li, source);
      list.appendChild(li);
    });
    (stack.verifySources || []).forEach(function (source) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(source.name + ': '));
      addProvenance(li, source);
      list.appendChild(li);
    });
    mount.appendChild(list);

    var residual = document.createElement('p');
    residual.style.cssText = 'margin:0;font-size:var(--tiny);color:var(--muted);line-height:1.45;';
    residual.textContent = 'Residual after mapped stack: ' + fmt(stack.residualGapPerUnit) + ' / unit. C3 owner confirmation requested; no unconfirmed amount is counted.';
    mount.appendChild(residual);
  }

  function renderOwnershipResaleScreen(screen) {
    var mount = document.getElementById('dc-own-resale-screen');
    if (!mount) return;
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    var title = document.createElement('p');
    title.style.cssText = 'margin:.55rem 0 .2rem;font-weight:700;font-size:var(--tiny);color:var(--text);';
    title.textContent = 'Resident and public interest at resale: convention screen - screening only';
    mount.appendChild(title);

    if (!screen || !Array.isArray(screen.rows) || !screen.rows.length) {
      var empty = document.createElement('p');
      empty.style.cssText = 'margin:0;font-size:var(--tiny);color:var(--muted);line-height:1.45;';
      empty.textContent = 'Resale conventions unavailable; confirm deed restriction terms before relying on this ownership mode.';
      mount.appendChild(empty);
      return;
    }

    if (window.OwnershipResale && screen.comparison && typeof window.OwnershipResale.renderComparisonHtml === 'function') {
      mount.innerHTML = window.OwnershipResale.renderComparisonHtml(screen.comparison);
      mount.insertBefore(title, mount.firstChild);
      window.OwnershipResale.bindComparisonControls(mount, function (change) {
        if (change.subsidyType) _resaleSelection.subsidyType = change.subsidyType;
        if (change.selectedConventionId) _resaleSelection.selectedConventionId = change.selectedConventionId;
        recalculate();
      });
    }
  }

  /**
   * The public / steward is the third actor on the ownership panel (#1815).
   * Its claim used to live only inside the resale comparison table. This row
   * lifts the selected mechanism's moderate-scenario outcome onto the panel:
   * the capped next-buyer price (how the public interest is expressed under
   * fixed, lesser-of and shared-appreciation conventions) and any subsidy the
   * public recovers in cash (recapture conventions). Screening only.
   */
  function selectedPublicInterestOutcome(screen) {
    var comparison = screen && screen.comparison;
    if (!comparison || !Array.isArray(comparison.rows) || !comparison.rows.length) return null;
    var row = null;
    for (var i = 0; i < comparison.rows.length; i++) {
      if (comparison.rows[i].conventionId === comparison.selectedConventionId) { row = comparison.rows[i]; break; }
    }
    if (!row) {
      for (var k = 0; k < comparison.rows.length; k++) {
        if (!comparison.rows[k].disabled) { row = comparison.rows[k]; break; }
      }
    }
    if (!row || !Array.isArray(row.outcomes)) return null;
    var idx = 0;
    (comparison.scenarios || []).forEach(function (scenario, n) { if (scenario.id === 'moderate') idx = n; });
    var outcome = row.outcomes[idx] || row.outcomes[0];
    if (!outcome) return null;
    return { label: row.label, outcome: outcome };
  }

  function renderPublicInterestRow(screen) {
    var value = document.getElementById('dc-own-public-recovery');
    var label = document.getElementById('dc-own-public-convention');
    if (!value) return;
    function fmt(n) { return isFinite(n) && n != null ? ('$' + Math.round(n).toLocaleString('en-US')) : '—'; }
    var picked = selectedPublicInterestOutcome(screen);
    if (!picked) {
      value.textContent = '—';
      value.removeAttribute('title');
      if (label) label.textContent = 'selected mechanism';
      return;
    }
    if (label) label.textContent = picked.label;
    var outcome = picked.outcome;
    if (outcome.maxResalePrice == null) {
      value.textContent = '—';
      value.setAttribute('title', outcome.unavailableReason || 'Resale inputs unavailable.');
      return;
    }
    var recovered = Number(outcome.publicSubsidyRecaptured) || 0;
    value.textContent = 'Next buyer price capped at ' + fmt(outcome.maxResalePrice) +
      (recovered > 0 ? ' · ' + fmt(recovered) + ' subsidy recovered' : ' · no cash recovery');
    value.setAttribute('title', outcome.preservationLabel || '');
  }

  function explainFigure(id, key, context) {
    var figure = document.getElementById(id);
    if (!figure) return;
    figure.setAttribute('data-methodology-key', key);
    figure.setAttribute('data-methodology-placement', 'after');
    figure.methodologyContext = context;
  }
  function explanationSourceContext(mode) {
    var source = getRentLimitsMetadata(), county = countySource({});
    if (mode === 'ownership') {
      var hud = window.HudFmr && window.HudFmr.getMeta && window.HudFmr.getMeta() || {};
      return 'Scenario development cost and unit entries (no independent source date supplied) · ' + (county.geography || 'county not selected') +
        ' · HUD income limits FY' + (hud.income_limits_fiscal_year || 'unavailable') + ' · ' + (hud.url_il || 'income-limit source unavailable');
    }
    return 'Scenario entries (no independent source date supplied) · ' + (county.geography || 'county not selected') +
      ' · ' + (source.source || 'rent-limit source unavailable') + ' ' + (source.tableYear == null ? 'date unavailable' : source.tableYear) +
      (source.effectiveDate ? ' · effective ' + source.effectiveDate : '');
  }
  function renderForSaleFeasibility(result) {
    result = result || {};
    function fmt(n) {
      return isFinite(n) ? ('$' + Math.round(n).toLocaleString('en-US')) : '—';
    }
    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }
    explainFigure('dc-own-gap-per-unit', 'ownership-subsidy-gap', { cost: result.tdcPerUnit, price: result.maxAffordableSalePrice,
      unavailableReason: result.status === 'ok' ? null : result.status === 'missing-ami' ? 'the county HUD income limit is unavailable; select a county' : 'development cost, units or the ownership pricing helper is unavailable',
      sources: explanationSourceContext('ownership') });
    var targetLabel = Math.round(((+result.targetAmiPct || 0.80) * 100)) + '% AMI';
    setText('dc-own-target-label', targetLabel);
    if (result.status !== 'ok') {
      setText('dc-own-cost-per-unit', !MoneyFormatter.isAbsent(result.tdcPerUnit) ? fmt(result.tdcPerUnit) : '—');
      setCostPerSf(result);
      setText('dc-own-max-price', '—');
      setText('dc-own-gap-per-unit', '—');
      setText('dc-own-total-gap', '—');
      renderPublicInterestRow(null);
      var message = result.status === 'missing-ami'
        ? 'Select a county to load HUD AMI and price the ownership affordability limit.'
        : (result.status === 'missing-helper'
          ? 'Ownership affordability helper unavailable; reload the page before relying on this mode.'
          : 'Enter total development cost and units to size the ownership gap.');
      setText('dc-own-note', message);
      renderDeveloperOwnershipFundingStack(null);
      renderOwnershipResaleScreen(null);
      return;
    }
    setText('dc-own-cost-per-unit', fmt(result.tdcPerUnit));
    setCostPerSf(result);
    setText('dc-own-max-price', fmt(result.maxAffordableSalePrice));
    setText('dc-own-gap-per-unit', fmt(result.subsidyGapPerUnit));
    setText('dc-own-total-gap', fmt(result.totalSubsidyGap));
    var note = result.rawGapPerUnit <= 0
      ? 'Screening result: no per-unit subsidy gap at this AMI under the shared HNA PITI assumptions.'
      : 'Formula (bridge): developer cost per unit minus the resident\'s max affordable sale price from the HNA ownership module. Public subsidy fills this gap.';
    setText('dc-own-note', note);
    renderDeveloperOwnershipFundingStack(result.developerFundingStack);
    renderOwnershipResaleScreen(result.ownershipResale);
    renderPublicInterestRow(result.ownershipResale);
  }

  /**
   * Cost per gross SF, or a dash that says why.
   *
   * A bare "—" is the display equivalent of a coerced zero: it looks like an
   * answer and means nothing. The reader cannot tell "this tool does not
   * compute that" from "you have not told me the floor area" — and only one of
   * those is fixable by them, in five seconds, with a field that is right
   * there. So the absent state carries its reason in the title attribute and
   * the note beneath.
   */
  function setCostPerSf(result) {
    var el = document.getElementById('dc-own-cost-per-sf');
    if (!el) return;
    var v = result && result.tdcPerSf;
    if (MoneyFormatter.isAbsent(v)) {
      el.textContent = '—';
      el.setAttribute('title', 'Enter gross building area above to see cost per square foot.');
      el.style.fontWeight = '400';
      el.style.color = 'var(--muted)';
      return;
    }
    // Whole dollars: $/SF is compared by eye against rules of thumb, and cents
    // imply a precision the inputs do not have.
    el.textContent = '$' + Math.round(v).toLocaleString('en-US') + '/SF';
    el.removeAttribute('title');
    el.style.fontWeight = '700';
    el.style.color = 'var(--text)';
  }

  function currentDealMode() {
    var checked = document.querySelector('input[name="dc-deal-mode"]:checked');
    return checked && checked.value === 'ownership' ? 'ownership' : 'rental';
  }

  function updateDealModeUi() {
    var mode = currentDealMode();
    var isOwnership = mode === 'ownership';
    document.querySelectorAll('[data-dc-mode="rental"]').forEach(function (el) {
      el.hidden = isOwnership;
    });
    document.querySelectorAll('[data-dc-mode="ownership"]').forEach(function (el) {
      el.hidden = !isOwnership;
    });
    // Tell the guided path which page this is: the ownership-mode calculator
    // is a different step page from the rental one, however the mode was set
    // (the toggle, ?mode=ownership, or a restored share link).
    var page = isOwnership ? 'deal-calculator.html?mode=ownership' : 'deal-calculator.html';
    if (document.documentElement.getAttribute('data-wf-page') !== page) {
      document.documentElement.setAttribute('data-wf-page', page);
      // The document's own window builds the event: test harnesses pair a
      // jsdom document with Node's globals, and dispatchEvent refuses an
      // event from another realm.
      var view = document.defaultView || window;
      try {
        document.dispatchEvent(new view.CustomEvent('workflow:page-changed', { detail: { page: page } }));
      } catch (_) { /* the guided path is optional on this page */ }
    }
  }

  function _fundingUseCaseForDealMode() {
    return currentDealMode() === 'ownership' ? 'owner-occupied' : 'multifamily-new-construction';
  }

  function _renderFundingContextCard() {
    var mount = document.getElementById('dc-funding-context-card');
    var renderer = window.FundingContextCard;
    if (!mount || !renderer || typeof renderer.render !== 'function') return;
    renderer.render(mount, _softFundingStatus, {
      surface: 'deal-calculator',
      countyFips: _countyFips,
      executionType: currentDealMode() === 'ownership'
        ? 'non-LIHTC'
        : (_activeCreditIs4Pct() ? '4%' : '9%'),
      useCase: _fundingUseCaseForDealMode()
    });
  }

  // -------------------------------------------------------------------
  // Peer-deals filter (pure function, testable)
  //
  // Filters HUD LIHTC database features (716 CO projects) to the most
  // useful peer set for a banker/syndicator sanity-checking a proforma:
  //   1. Same county (CNTY_FIPS match)
  //   2. Same credit type ('9%' or '4%')
  //   3. Sort by recency (most recent CHFA award year first), then
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
      var t = String(s).replace(/\s+/g, '').replace(/%/g, '').trim();
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

    // Reject HUD sentinel years (8888 / 9999 = unknown) and clamp to the plausible LIHTC range (1986-2030). Without
    // this guard, sentinel rows sort to the top as "most recent" and
    // contaminate the comparable-projects panel.
    // Returns true / false / null. null means the source did not publish the
    // field, which must never collapse into false — see the mapping below.
    function _triState(raw, explicit, truthyValues) {
      if (explicit === true) return true;
      if (raw === null || raw === undefined || raw === '') return null;
      var truthy = truthyValues || ['1', 1, 'Y', 'y', true];
      return truthy.indexOf(raw) !== -1;
    }

    // Award year, never a placed-in-service year: CHFA publishes none, and
    // the feed's YR_PIS is AwardYear copied by scripts/fetch-chfa-lihtc.js.
    // HUD-schema records carry YR_ALLOC / YEAR_ALLOC, the same concept.
    function _awardYearOf(p) {
      return p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC || null;
    }
    function _safeYear(p) {
      var raw = parseInt(_awardYearOf(p) || 0, 10);
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
        yearAward:  _safeYear(p) || null,
        yearAlloc:  (function () { var y = parseInt(p.YR_ALLOC || p.YEAR_ALLOC || 0, 10); return Number.isFinite(y) && y >= 1986 && y <= 2030 ? y : null; })(),
        // Three states, not two. These comparables are fed from the CHFA
        // feed, which carries QCT, DDA and NON_PROF as columns and populates
        // none of them — all 926 records are null. Coercing that to `false`
        // meant no comparable ever earned a badge, and a reader scanning the
        // table infers that none of these deals sit in a QCT or DDA. That is
        // not a finding; the source simply never said. QCT/DDA decide 30%
        // basis boost eligibility, so it is exactly the wrong thing to guess.
        // `null` = unknown, and renderPeerFlags below discloses it once for
        // the table rather than asserting a negative on every row.
        isQct:      _triState(p.QCT, p.isQct),
        isDda:      _triState(p.DDA, p.isDda),
        isNonProf:  _triState(p.NON_PROF, null, ['1', 1, '2', 2])
      };
    });
  }

  // -------------------------------------------------------------------
  // Rent-achievability check (pure function, testable)
  //
  // Compares the gross rent/planning ceiling at each AMI tier to HUD FMR 2BR
  // for the selected county. Answers the banker/syndicator question:
  // "will the LIHTC ceiling rents actually clear the market, or is
  //  the proforma over-stated because the ceiling is above market?"
  //
  // Status thresholds (rule-of-thumb for banker review):
  //   gap ≤ 0     clear       — ceiling at/below market, achievable
  //   gap ≤ $50   tight       — close to market, thin buffer
  //   gap ≤ $200  concerning  — ceiling meaningfully above market
  //   gap > $200  misaligned  — proforma at ceiling likely overstates revenue
  //
  // Positive gap = ceiling > market rent (concerning).
  // Negative gap = ceiling < market rent (good — ceiling is binding).
  //
  // Uses HUD FMR 2BR as the market benchmark because most LIHTC projects
  // are 2BR-dominated. A future refinement could weight by the project's
  // actual bedroom mix.
  //
  // Inputs:
  //   amiLimits — { 30: 931, 40: 1241, ..., 120: 3723 } monthly $USD
  //   fmr       — { efficiency, one_br, two_br, three_br, four_br } monthly $USD
  //
  // Returns null when data isn't available (county not selected, FMR 2BR
  // missing, or no AMI tier rent limits).
  // -------------------------------------------------------------------
  function computeRentAchievability(inputs) {
    return dealEngine().computeRentAchievability(inputs);
  }

  function normalizeMinimumSetAsideElection(election) {
    return Object.prototype.hasOwnProperty.call(MINIMUM_SET_ASIDE_ELECTIONS, election)
      ? election
      : DEFAULT_MINIMUM_SET_ASIDE_ELECTION;
  }

  function currentMinimumSetAsideElection() {
    var el = document.getElementById('dc-minimum-set-aside');
    return normalizeMinimumSetAsideElection(el && el.value);
  }

  function isLihtcCreditEligiblePct(pct, election) {
    return dealEngine().isLihtcCreditEligiblePct(pct, election);
  }

  function evaluateMinimumSetAside(election, totalUnits, designatedUnitsByPct) {
    return dealEngine().evaluateMinimumSetAside(election, totalUnits, designatedUnitsByPct);
  }

  function amiBandLabelHtml(pct, election) {
    var normalized = normalizeMinimumSetAsideElection(election);
    if (isLihtcCreditEligiblePct(pct, normalized)) {
      if (normalized === 'average-income' && Number(pct) > 60) {
        return pct + '% AMI <span style="font-size:.8125rem;color:var(--muted);font-weight:400;overflow-wrap:anywhere;">(AIT designation; counted only when the designated average is ≤60% AMI)</span>';
      }
      return pct + '% AMI';
    }
    if (MIDDLE_INCOME_AMI_BANDS[pct]) {
      return pct + '% AMI <span style="font-size:.8125rem;color:var(--muted);font-weight:400;overflow-wrap:anywhere;">(middle-income: Colorado Middle Income Housing Tax Credit (MIHTC) + Prop 123; not LIHTC-credit-eligible)</span>';
    }
    return pct + '% AMI <span style="font-size:.8125rem;color:var(--muted);font-weight:400;overflow-wrap:anywhere;">(market/workforce; not counted under this election — select Average Income Test to designate 70/80% units)</span>';
  }

  function renderMinimumSetAsideStatus(result) {
    var help = document.getElementById('dc-minimum-set-aside-help');
    var status = document.getElementById('dc-minimum-set-aside-status');
    DEAL_AMI_BANDS.forEach(function (pct) {
      var label = document.getElementById('dc-ami-label-' + pct);
      if (label) label.innerHTML = amiBandLabelHtml(pct, result.election);
    });
    var applicable = rentLimitRegime() === 'chfa_lihtc';
    var election = document.getElementById('dc-minimum-set-aside');
    if (election) election.disabled = !applicable;
    if (!applicable) {
      if (help) help.textContent = NO_LIHTC_CREDITS;
      if (status) { status.textContent = 'Not applicable'; status.style.borderColor = 'var(--border)'; }
      return;
    }
    if (help) {
      if (result.election === '20-50') {
        help.textContent = 'The 20-50 election requires at least 20% of residential units at 50% AMI or below. Units up to 60% AMI can still contribute to qualified basis.';
      } else if (result.election === 'average-income') {
        help.textContent = 'The Average Income Test permits 20%-80% designations when at least 40% of units are in the group and their designated average is no more than 60% AMI. CHFA currently requires every residential unit in a Colorado AIT project to be designated low-income.';
      } else {
        help.textContent = 'The default 40-60 election requires at least 40% of residential units at 60% AMI or below.';
      }
    }
    if (!status) return;
    var shareText = result.minimumSharePct === null ? 'not available' : result.minimumSharePct.toFixed(1) + '%';
    var detail = result.setAsideUnits + ' of ' + result.totalUnits + ' units in the minimum set-aside (' + shareText + ').';
    if (result.election === 'average-income') {
      var averageText = result.averageAmiPct === null ? 'not available' : result.averageAmiPct.toFixed(1) + '% AMI';
      detail += ' Designated AIT average: ' + averageText + '.';
    }
    if (result.qualifies) {
      status.innerHTML = '<strong>Qualifies under this screening test.</strong> ' + detail + ' ' + result.countedLihtcUnits + ' units count toward the applicable-fraction screen.';
      status.style.borderColor = 'var(--accent,#096e65)';
    } else {
      status.innerHTML = '<strong>Does not qualify under this screening test.</strong> ' + detail + ' Reason: ' + result.reason + '. No units are counted toward qualified basis.';
      status.style.borderColor = 'var(--warn,#d97706)';
    }
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
  // City ZORI precedes county ZORI when it is bound to the active jurisdiction.
  // Per-bedroom estimates preserve its all-homes level using local ACS B25042.
  function marketContextHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function zoriContext(fips) {
    // A shared/deep link names the place being analyzed without writing it
    // into the recipient's project. The helper verifies its county binding
    // against the recipient's own ACS geography record before using city ZORI.
    var linkedGeoid = new URLSearchParams(window.location.search).get('geoid');
    if (/^08\d{5}$/.test(linkedGeoid || '')) return { bedroomMix: _renterBedroomMix, geoid: linkedGeoid };
    var jurisdiction = window.WorkflowState && window.WorkflowState.getJurisdiction
      ? window.WorkflowState.getJurisdiction() : null;
    return { bedroomMix: _renterBedroomMix,
      geoid: jurisdiction && String(jurisdiction.countyFips) === String(fips) ? jurisdiction.geoid : null };
  }

  function getZoriCountyRent(fips) {
    return window.ZoriRentUtils ? window.ZoriRentUtils.getCountyRent(_zoriData, fips) : null;
  }

  function getZoriPerBrRent(fips) {
    return window.ZoriRentUtils ? window.ZoriRentUtils.getPerBedroomRent(_zoriData, fips,
      window.HudFmr, zoriContext(fips)) : null;
  }

  // Manual remainder units use the grid's bedroom proportions. Largest remainders
  // keep whole units and the exact total; ties follow the grid's column order.
  // The displayed ZORI fields are not storage for a user's overrides. This
  // separate value record also travels through the existing save/share inputs.
  function captureMarketOverrides() {
    if (document.getElementById('dc-market-rent-mode').value !== 'override') return;
    var values = { rents: {}, note: document.getElementById('dc-market-rent-source').value };
    SPLIT_BR_TYPES.forEach(function (br) {
      values.rents[br] = document.getElementById('dc-market-rent-' + br).value;
    });
    document.getElementById('dc-market-rent-overrides').value = JSON.stringify(values);
  }

  function restoreMarketOverrideDisplay() {
    // Called after saved/shared inputs are hydrated, before any source display
    // can replace them. Older override links have only the visible inputs.
    captureMarketOverrides();
    delete document.getElementById('dc-manual-market-rents').dataset.marketMode;
  }

  function readManualMarketInputs() {
    var panel = document.getElementById('dc-manual-market-rents');
    var mode = document.getElementById('dc-market-rent-mode').value;
    var override = mode === 'override';
    if (override && panel.dataset.marketMode === 'override') captureMarketOverrides();
    var overrides = {};
    try { overrides = JSON.parse(document.getElementById('dc-market-rent-overrides').value) || {}; } catch (_) {}
    var noteInput = document.getElementById('dc-market-rent-source');
    noteInput.value = override && typeof overrides.note === 'string' ? overrides.note : '';
    var note = noteInput.value.trim();
    var zori = _countyFips ? getZoriPerBrRent(_countyFips) : null;
    var zoriMeta = zori && zori._meta || {};
    var source = countySource({ source: zoriMeta.source, sourceUrl: zoriMeta.sourceUrl,
      vintage: zoriMeta.vintage_month, geography: zoriMeta.name, geoid: zoriMeta.geoid,
      binding: 'zori-fmr-bedroom-ratios',
      why: (zoriMeta.method || 'Local ZORI, HUD FMR or ACS renter bedroom mix unavailable.') +
        ' ACS mix: ' + (zoriMeta.bedroomMixVintage || 'unavailable') + ' (' + (zoriMeta.bedroomMixSourceUrl || '') +
        '); HUD FMR FY' + (zoriMeta.fmrVintage || 'unavailable') + ' (' + (zoriMeta.fmrSourceUrl || '') + '). Screening market-rent estimate.' });
    var provenance = window.InputProvenance;
    // Cache the independently loaded origin; never certify a typed/shared value.
    SPLIT_BR_TYPES.forEach(function (br) {
      var input = document.getElementById('dc-market-rent-' + br);
      input.readOnly = !override;
      var rent = zori && zori[br];
      var available = typeof rent === 'number' && isFinite(rent) && rent > 0 && source.vintage != null;
      var key = JSON.stringify([_countyFips, rent, source.vintage, source.geoid, zoriMeta.bedroomMixVintage, mode]);
      // A restored link can fill a readonly input. In ZORI mode the displayed
      // amount must still be the local record used below, never stale link text.
      if (input.dataset.marketSourceKey !== key || (!override && input.value !== (available ? String(rent) : ''))) {
        var entered = overrides.rents && typeof overrides.rents[br] === 'string' ? overrides.rents[br] : '';
        input.value = available ? String(rent) : '';
        markSource(input, source, available);
        if (override) {
          input.value = entered;
          if (provenance) {
            var origin = provenance.get(input);
            origin.status = entered.trim() ? 'yours' : 'needs-source';
            provenance.restoreLocal(origin, input);
          }
        }
        input.dataset.marketSourceKey = key;
      }
    });
    panel.dataset.marketMode = mode;
    document.getElementById('dc-market-source-wrap').hidden = !override;
    var vintage = document.getElementById('dc-market-rent-vintage');
    vintage.textContent = zori ? source.source + '. ACS ' + zoriMeta.bedroomMixVintage +
      (zoriMeta.review_flag ? '. ' + zoriMeta.review_flag.note : '') :
      'ZORI bedroom estimate unavailable; enter market rents with a source note.';
    vintage.dataset.reviewFlag = zoriMeta.review_flag ? zoriMeta.review_flag.reason : '';
    var rents = {};
    SPLIT_BR_TYPES.forEach(function (br) { rents[br] = document.getElementById('dc-market-rent-' + br).value; });
    return { mode: mode, note: note, rents: rents, zori: zori, source: source,
      fallbackBedroom: document.getElementById('dc-market-bedroom').value };
  }

  function renderManualMarket(result) {
    if (result.scheduleMode) return;
    var units = Math.max(0, result.units - result.amiUnitSum);
    document.getElementById('dc-manual-market-rents').hidden = !(units > 0);
    var hasGridMix = Object.keys(result.gridBedrooms).some(function (key) { return result.gridBedrooms[key] > 0; });
    document.getElementById('dc-market-bedroom-wrap').hidden = hasGridMix;
    document.getElementById('dc-market-split').textContent = hasGridMix
      ? 'Bedroom mix follows the AMI grid proportions, rounded to whole homes: '
      : 'No bedroom mix is entered in the grid. Choose one size for these homes (default: 2BR): ';
    var market = result.manualMarket;
    var status = document.getElementById('dc-market-rent-status');
    status.dataset.unavailableReason = market.unavailableReason || '';
    status.dataset.units = String(units);
    status.textContent = market.message ? 'Unavailable — ' + market.message : market.rows.map(function (row) {
      return row.units + ' ' + row.bedrooms + ' homes × $' + row.rent.toLocaleString('en-US') + '/month';
    }).join('; ');
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
  // jurisdictions, with the statewide exemptions (C.R.S. §39-3-112, §29-4-227) as
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
      // No default: the statewide exemptions cover only the project's
      // low-income share (C.R.S. §39-3-112(4), §29-4-227(1)(b)), which the
      // banner cannot know. Suggest a % only when a program states one.
      var suggestedPct = null;
      if (exemption && exemption.magnitude) {
        var m = exemption.magnitude.match(/(\d+)\s*%/);
        if (m) suggestedPct = parseInt(m[1], 10);
      }
      var headline = exemption
        ? '<strong>' + (entry ? entry.name : 'Jurisdiction') + ':</strong> ' + exemption.name
        : '<strong>Statewide exemptions:</strong> C.R.S. §39-3-112 (nonprofit charitable owner) and C.R.S. §29-4-227 (housing authority ownership interest)';
      var summary = exemption && exemption.summary
        ? exemption.summary
        : 'Neither is automatic: each exempts only the low-income share, §39-3-112 on application to the state property tax administrator, and §29-4-227 on the housing authority\'s certification of that share. Confirm your structure qualifies before underwriting.';
      // Remove existing banner if present (re-render on jurisdiction change)
      if (__dcAbatementBanner) __dcAbatementBanner.remove();
      // Build banner
      var banner = document.createElement('div');
      banner.dataset.dcAbatement = '1';
      banner.style.cssText = 'padding:.55rem .7rem;margin:0 0 .5rem;border-radius:6px;' +
        'background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.35);border-left:4px solid #047857;font-size:.82rem;line-height:1.4';
      var btn = suggestedPct == null
        ? '<div style="margin-top:.35rem;font-size:.8125rem;font-weight:700">Set Tax Exemption below to your project\'s low-income share.</div>'
        : '<button type="button" id="dc-apply-abatement" ' +
          'style="margin-top:.35rem;padding:.25rem .65rem;font-size:.8125rem;font-weight:700;' +
          'background:#047857;color:white;border:0;border-radius:5px;cursor:pointer">' +
          'Apply ' + suggestedPct + '% to Tax Exemption ↓</button>';
      banner.innerHTML = '<div>🏛️ ' + headline + '</div>' +
        '<div style="margin-top:.2rem;color:var(--muted);font-size:.8125rem">' + summary + '</div>' +
        btn;
      label.parentNode.insertBefore(banner, label);
      __dcAbatementBanner = banner;
      _dcAppendFeeContext(banner, geoKey);
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
          if (window.InputProvenance) window.InputProvenance.mark(taxSelect, { status: 'assumption',
            why: 'Scenario exemption suggested by the policy context; project eligibility still needs evidence.' });
          prefillEvents(taxSelect);
          applyBtn.textContent = '✓ Applied (' + closest + '%)';
          applyBtn.disabled = true;
          applyBtn.style.background = 'rgba(16,185,129,.3)';
        });
      }
    }).catch(function (e) { console.warn('[dc-abatement] load failed', e); });
  }
  // Verified local fee measures (data/policy/fee-reductions.json) shown as
  // CONTEXT beside the abatement banner. Never applied to any number: a
  // waiver only lowers cost once the jurisdiction commits it to this
  // project, and a deferral is still owed (enter it as a loan tranche).
  function _dcAppendFeeContext(banner, geoKey) {
    if (!banner || !window.TaxAbatement || !window.TaxAbatement.loadFeeReductions) return;
    var geoid = geoKey ? String(geoKey).split(':').pop() : null;
    if (!geoid) return;
    window.TaxAbatement.loadFeeReductions().then(function (fees) {
      if (!banner.isConnected || !fees || fees.unavailable) return;
      var hit = window.TaxAbatement.costReductionsFor(fees, geoid, null);
      hit.fees = hit.fees.filter(function (e) { return (e.kind || 'program') === 'program'; });
      var box = document.createElement('div');
      box.dataset.dcFeeContext = '1';
      box.style.cssText = 'margin-top:.4rem;padding-top:.35rem;border-top:1px dashed rgba(4,120,87,.35);font-size:.8125rem;color:var(--muted)';
      if (!hit.fees.length) {
        box.textContent = 'Local fee waivers: none verified yet for this jurisdiction (not the same as none). Nothing is applied to your numbers.';
      } else {
        var MEASURE = { waived: 'waived', reduced: 'reduced', reimbursed: 'paid by another source or refunded', deferred: 'deferred (still owed)', rate_discount: 'monthly rate discount' };
        var items = hit.fees.slice(0, 4).map(function (e) {
          var li = document.createElement('li');
          li.textContent = e.summary + ' (' + (MEASURE[e.measure] || e.measure) + '; ' + e.provider + ')';
          return li;
        });
        var lead = document.createElement('div');
        lead.textContent = 'Verified local fee measures — context only, not applied to any number. A waiver counts only once committed to this project; enter a deferral as an Impact Fee Loan tranche.';
        var ul = document.createElement('ul');
        ul.style.cssText = 'margin:.2rem 0 0 1rem;padding:0';
        items.forEach(function (li) { ul.appendChild(li); });
        box.appendChild(lead);
        box.appendChild(ul);
        if (hit.fees.length > 4) {
          var more = document.createElement('div');
          more.textContent = '+' + (hit.fees.length - 4) + ' more in the Housing Needs Assessment’s local resources.';
          box.appendChild(more);
        }
      }
      banner.appendChild(box);
    }).catch(function () {});
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
    return dealEngine().computeDscrStressScenarios(inputs, constants || DEFAULT_CONSTANTS);
  }

  function rentLimitRegime() {
    var select = document.getElementById('dc-rent-limit-regime');
    return select && select.value || 'chfa_lihtc';
  }

  // Resolve at calculation time: market-analysis loads this file before the module.
  function rentCeilingFor(tier, br) {
    var limits = window.ChfaRentLimits;
    var hud = window.HudFmr;
    if (!limits) return { grossRent: null, regime: rentLimitRegime(), unavailableReason: 'rent_module_unavailable' };
    return limits.rentCeiling({ regime: rentLimitRegime(), chfaTable: _chfaRentTable,
      hudTable: hud && hud.isLoaded() ? { meta: hud.getMeta(), counties: hud.getAllCounties() } : null,
      homeTable: _homeRentTable, prop123Rules: _prop123Rules,
      program: selectValue('dc-prop123-program'), petitionJurisdiction: selectValue('dc-prop123-petition'),
      fips: _countyFips, tier: tier,
      bedrooms: RENT_BEDROOMS[br],
      rentBurden: _constants.rentBurdenPct, useHera: false });
  }

  function selectValue(id) {
    var el = document.getElementById(id);
    return el && el.value ? el.value : null;
  }

  // Prop 123 programs whose units this calculator can price on their own.
  // Tax-credit-paired programs follow the CHFA LIHTC setting; modular
  // financing restricts no units; supportive housing has no confirmed limit.
  function prop123PricedPrograms(rules) {
    return (rules && Array.isArray(rules.programs) ? rules.programs : []).filter(function (p) {
      var income = p.income_rule || {};
      return income.type !== 'none' && income.max_ami_pct != null && p.id.indexOf('lihtc') === -1;
    });
  }

  function populateProp123Choices() {
    var program = document.getElementById('dc-prop123-program');
    var petition = document.getElementById('dc-prop123-petition');
    if (!program || !petition) return;
    var keepProgram = program.value;
    var keepPetition = petition.value;
    var programs = prop123PricedPrograms(_prop123Rules);
    program.innerHTML = '<option value="">Choose a program</option>';
    programs.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      program.appendChild(opt);
    });
    var list = _prop123Rules && _prop123Rules.rural_resort_petitions && _prop123Rules.rural_resort_petitions.petitions || [];
    petition.innerHTML = '<option value="">None</option>';
    // A petition applies only inside its own jurisdiction: offer those filed
    // from the selected county, and none until a county is chosen.
    list.filter(function (x) {
      return x.status === 'approved' && Array.isArray(x.county_fips) && x.county_fips.indexOf(_countyFips) !== -1;
    }).forEach(function (x) {
      var opt = document.createElement('option');
      opt.value = x.jurisdiction;
      opt.textContent = x.jurisdiction + ' (' + x.ami_pct_rental + '% AMI rental)';
      petition.appendChild(opt);
    });
    if (programs.some(function (p) { return p.id === keepProgram; })) program.value = keepProgram;
    if (Array.prototype.some.call(petition.options, function (o) { return o.value === keepPetition; })) petition.value = keepPetition;
  }

  function setProgramRentTables(home, prop123) {
    if (home !== undefined) _homeRentTable = home;
    if (prop123 !== undefined) { _prop123Rules = prop123; populateProp123Choices(); }
    updateAmiLimitsFromFmr(_countyFips);
  }

  function observeSubjectProject() {
    var subjectProject = window.SubjectProject;
    if (subjectProject === _subjectProjectSubscription) return;
    if (_unsubscribeSubjectProject) _unsubscribeSubjectProject();
    _subjectProjectSubscription = subjectProject;
    _unsubscribeSubjectProject = subjectProject && typeof subjectProject.subscribe === 'function'
      ? subjectProject.subscribe(recalculate) : null;
  }

  var _resolvedDealMix = null;
  var _manualBaseValues = null;
  var _rentScheduleSnapshot = null;
  var _sharedRentSchedule = null;
  var _scheduleSourceChanged = false;
  var _sharedScheduleHydrated = false;
  var _hydratingSharedScenario = false;
  var MANUAL_MIX_KEY = 'coho.dealCalc.manualMix.v1';

  function mixPreference() {
    var input = document.getElementById('dc-unit-mix-source');
    return input && input.value === 'manual' ? 'manual' : 'auto';
  }

  function pendingSharedSchedule() {
    return !_sharedScheduleHydrated && new URLSearchParams(window.location.search).has('rentSchedule');
  }

  function clearSharedRentSchedule() {
    _sharedRentSchedule = null;
    _scheduleSourceChanged = true;
    var input = document.getElementById('dc-unit-mix-source');
    if (input) input.value = 'auto';
  }

  function resolveDealMix() {
    if (currentDealMode() !== 'rental') return { available: false, reason: 'ownership_mode' };
    if (_sharedRentSchedule && _sharedRentSchedule.regime !== rentLimitRegime()) clearSharedRentSchedule();
    if (pendingSharedSchedule()) return { available: false, reason: 'shared_schedule_loading' };
    if (_sharedRentSchedule) return _sharedRentSchedule.mix;
    if (mixPreference() === 'manual') return { available: false, reason: 'manual_selection' };
    var limits = window.ChfaRentLimits, SP = window.SubjectProject;
    if (!limits || !SP || typeof SP.get !== 'function') return { available: false, reason: 'schedule_unavailable:subject_project_unavailable' };
    var subject = SP.get();
    var mix = limits.dealMixFromSchedule(limits.rentSchedule(subject, { chfaTable: _chfaRentTable }),
      { countyFips: _countyFips, regime: rentLimitRegime() });
    // Before any Market Analysis run the subject project has no rent rows.
    if (!mix.available && !((subject && subject.unit_mix) || []).length) mix.notStarted = true;
    return mix;
  }

  function getRentScheduleMetadata() {
    return _rentScheduleSnapshot ? JSON.parse(JSON.stringify(_rentScheduleSnapshot)) : null;
  }

  // Shared prices are resolved calculation state, never a write to SubjectProject.
  function setSharedRentSchedule(record, context) {
    _sharedScheduleHydrated = true;
    _sharedRentSchedule = null;
    _scheduleSourceChanged = false;
    context = context || {};
    if (record != null) {
      var county = context.countyFips || null;
      var regime = context.regime || rentLimitRegime();
      var mix = { available: false, reason: 'shared_schedule_invalid' };
      if (record.mode === 'manual') {
        mix.reason = typeof record.reason === 'string' ? record.reason : 'manual_selection';
      } else if (record.mode === 'schedule' && record.countyFips === county && regime === 'chfa_lihtc' &&
          record.regime === regime && record.sourceMeta && record.sourceMeta.countyFips === county &&
          Array.isArray(record.rows) && record.rows.length &&
          typeof record.vacancyRate === 'number' && record.vacancyRate >= 0 && record.vacancyRate <= 1) {
        var valid = record.rows.every(function (r) {
          return r && Object.keys(RENT_BEDROOMS).some(function (br) { return RENT_BEDROOMS[br] === r.bedrooms; }) &&
            Number.isInteger(r.units) && r.units > 0 &&
            (r.tier === 'market' ? typeof r.rent === 'number' && Number.isFinite(r.rent) && r.rent > 0 && typeof r.source === 'string' && r.source.trim()
              : typeof r.tier === 'number' && Number.isFinite(r.tier) && r.tier > 0 && typeof r.contractRent === 'number' && Number.isFinite(r.contractRent) && r.contractRent >= 0);
        });
        var total = record.rows.reduce(function (sum, r) { return sum + (r && r.units); }, 0);
        if (valid && total === record.totalUnits) mix = { available: true, totalUnits: total, vacancyRate: record.vacancyRate,
          restrictedRows: record.rows.filter(function (r) { return r.tier !== 'market'; }),
          marketRows: record.rows.filter(function (r) { return r.tier === 'market'; }), sourceMeta: record.sourceMeta };
      }
      _sharedRentSchedule = { mix: JSON.parse(JSON.stringify(mix)), countyFips: county, regime: regime };
    }
    recalculate();
  }

  function manualMixInputs() {
    var inputs = Array.prototype.slice.call(document.querySelectorAll('#dc-manual-unit-mix input, #dc-manual-unit-mix select'));
    ['dc-units', 'dc-vacancy', 'dc-unrepresented-schedule-rows', 'dc-unit-mix-source'].forEach(function (id) {
      var el = document.getElementById(id); if (el) inputs.push(el);
    });
    return inputs;
  }

  function saveManualMix() {
    if (mixPreference() !== 'manual' || _hydratingSharedScenario || _sharedRentSchedule) return;
    var values = {};
    manualMixInputs().forEach(function (el) { values[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
    try { localStorage.setItem(MANUAL_MIX_KEY, JSON.stringify(values)); } catch (_) {}
  }

  function restoreManualMix() {
    // A URL carries its own inputs and must win over this browser's saved choice.
    if (window.location.search) return;
    try {
      var values = JSON.parse(localStorage.getItem(MANUAL_MIX_KEY));
      if (!values || values['dc-unit-mix-source'] !== 'manual') return;
      manualMixInputs().forEach(function (el) {
        if (!Object.prototype.hasOwnProperty.call(values, el.id)) return;
        if (el.type === 'checkbox') el.checked = values[el.id] === true;
        else el.value = values[el.id];
      });
    } catch (_) {}
  }

  function editMixHere() {
    var mix = _resolvedDealMix;
    var input = document.getElementById('dc-unit-mix-source');
    if (!mix || !mix.available) {
      input.value = 'auto';
      try { localStorage.removeItem(MANUAL_MIX_KEY); } catch (_) {}
      _sharedRentSchedule = null;
      recalculate();
      return;
    }
    DEAL_AMI_BANDS.forEach(function (tier) {
      document.getElementById('dc-chk-' + tier).checked = false;
      document.getElementById('dc-units-' + tier).value = '0';
      SPLIT_BR_TYPES.forEach(function (br) { document.getElementById('dc-units-' + tier + '-' + br).value = '0'; });
    });
    var omitted = [];
    mix.restrictedRows.forEach(function (r) {
      var br = SPLIT_BR_TYPES.find(function (key) { return RENT_BEDROOMS[key] === r.bedrooms; });
      var cell = br && document.getElementById('dc-units-' + r.tier + '-' + br);
      if (!cell) { omitted.push(r); return; }
      cell.value = String(Number(cell.value) + r.units);
      var count = document.getElementById('dc-units-' + r.tier);
      count.value = String(Number(count.value) + r.units);
      document.getElementById('dc-chk-' + r.tier).checked = true;
    });
    mix.marketRows.forEach(function (r) { omitted.push(Object.assign({ tier: 'market' }, r)); });
    if (window.InputProvenance) manualMixInputs().forEach(function (el) {
      if (el.type !== 'checkbox' && el.type !== 'hidden') markSource(el, scheduleSource(mix), true);
    });
    document.getElementById('dc-unrepresented-schedule-rows').value = JSON.stringify(omitted);
    input.value = 'manual';
    _manualBaseValues = null;
    _sharedRentSchedule = null;
    // Manual editing resumes the D2 local allowance lookup. Shared schedule
    // metadata says deductions are already included; it is not a new allowance.
    _sharedUtilityAllowance = null;
    recalculate();
  }

  // Plain words for why the Market Analysis schedule is not in use; the code
  // itself stays on data-unavailable-reason.
  function dealMixReasonText(reason) {
    var limits = window.ChfaRentLimits;
    var inner = /^schedule_unavailable:(.+)$/.exec(reason || '');
    var text = inner ? (limits ? limits.unavailableMessage(inner[1]) : 'The schedule is unavailable') : ({
      schedule_other_county: 'It was built for a different county',
      schedule_requires_chfa_setting: 'It needs the CHFA LIHTC rent-limit setting',
      shared_schedule_loading: 'The shared schedule is still loading',
      shared_schedule_invalid: 'The shared schedule could not be read',
      ownership_mode: 'For-sale deals do not use it'
    })[reason] || 'It is not available';
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  function renderDealMixContext(mix) {
    var active = mix.available;
    var status = document.getElementById('dc-unit-mix-status');
    if (!status) return;
    status.dataset.mode = active ? 'schedule' : 'manual';
    status.dataset.unavailableReason = active ? '' : mix.reason;
    status.textContent = active ? 'Unit mix source: From Market Analysis rent schedule — edit it there' +
      (_sharedRentSchedule ? ' (from shared scenario)' : '')
      : mixPreference() === 'manual' || mix.reason === 'manual_selection' ? "Unit mix source: Using this page's unit mix — manual editing selected"
      : mix.notStarted ? "Unit mix source: Using this page's unit mix. No Market Analysis rent schedule yet; build one there to use it here."
      : "Unit mix source: Using this page's unit mix. Market Analysis rent schedule not in use: " + dealMixReasonText(mix.reason) + '.';
    var notice = document.getElementById('dc-schedule-local-notice');
    notice.hidden = !_scheduleSourceChanged;
    notice.textContent = _scheduleSourceChanged ? 'County or rent setting changed — unit mix now uses your local Market Analysis schedule when available.' : '';
    var edit = document.getElementById('dc-edit-unit-mix');
    edit.hidden = !active && mixPreference() !== 'manual';
    edit.textContent = active ? 'Edit here instead' : 'Use Market Analysis schedule';
    document.getElementById('dc-manual-unit-mix').hidden = active;
    var cap = document.getElementById('dc-achievable-cap-wrap');
    if (cap) cap.hidden = active;
    if (active && !_manualBaseValues) _manualBaseValues = {
      'dc-units': document.getElementById('dc-units').value,
      'dc-vacancy': document.getElementById('dc-vacancy').value };
    ['dc-units', 'dc-vacancy'].forEach(function (id) {
      var el = document.getElementById(id);
      el.readOnly = active;
      if (!active && _manualBaseValues) {
        el.value = _manualBaseValues[id];
        if (window.InputProvenance) window.InputProvenance.mark(el, { status: 'assumption', why: 'Restored your previous manual scenario value.' });
      }
      if (active) {
        el.value = String(id === 'dc-units' ? mix.totalUnits : mix.vacancyRate * 100);
        markSource(el, scheduleSource(mix), true);
      }
    });
    if (!active) _manualBaseValues = null;
    var omitted = [];
    try {
      var savedOmissions = JSON.parse(document.getElementById('dc-unrepresented-schedule-rows').value || '[]');
      if (Array.isArray(savedOmissions)) omitted = savedOmissions.filter(function (r) { return r && Number.isInteger(r.units) && r.units > 0; });
    } catch (_) {}
    var omittedNote = document.getElementById('dc-unrepresented-schedule-notice');
    omittedNote.hidden = active || !omitted.length;
    omittedNote.textContent = omitted.map(function (r) {
      return (r.tier === 'market' ? 'Market rate' : r.tier + '% AMI') + ' · ' + r.bedrooms + ' · ' + r.units + ' units: not representable in this grid';
    }).join('; ') + (omitted.length ? '. Manual rents use the grid ceilings and allowance rules, not the schedule prices.' : '');
    var host = document.getElementById('dc-schedule-table');
    host.hidden = !active;
    host.replaceChildren();
    if (!active) return;
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;font-size:var(--small);border-collapse:collapse;';
    var caption = document.createElement('caption');
    var meta = mix.sourceMeta;
    caption.textContent = 'Scheduled contract rents · CHFA ' + (meta.tableYear || '—') + ' · effective ' + (meta.effectiveDate || '—');
    table.appendChild(caption);
    var header = table.createTHead().insertRow();
    ['Tier', 'Bedrooms', 'Units', 'Monthly rent', 'Source'].forEach(function (label) {
      var th = document.createElement('th'); th.textContent = label; header.appendChild(th);
    });
    var body = table.createTBody();
    mix.restrictedRows.concat(mix.marketRows.map(function (r) { return Object.assign({ tier: 'market' }, r); })).forEach(function (r) {
      var tr = body.insertRow();
      tr.dataset.tier = String(r.tier); tr.dataset.units = String(r.units);
      var rent = r.tier === 'market' ? r.rent : r.contractRent;
      tr.dataset.rent = String(rent);
      [r.tier === 'market' ? 'Market rate' : r.tier + '% AMI', r.bedrooms, r.units,
        '$' + rent.toLocaleString('en-US'), r.tier === 'market' ? r.source : 'Subject project · net of allowance and fees'].forEach(function (value) {
        var cell = tr.insertCell(); cell.textContent = String(value);
      });
    });
    host.appendChild(table);
  }

  // A shared record is calculation state only; never save it to SubjectProject.
  function setSharedUtilityAllowance(record, context) {
    _sharedUtilityAllowance = null;
    _allowanceSourceChanged = false;
    if (record != null) {
      context = context || {};
      var county = context.countyFips || null;
      var allowance = { applied: false, reason: 'shared_allowance_invalid', source: 'shared' };
      if (record.applied === false && typeof record.reason === 'string') {
        allowance.reason = record.reason;
      } else if (record.applied === true && typeof record.method === 'string' && record.countyFips === county) {
        var perBedroom = {}, feesPerBedroom = {};
        var valid = Object.keys(RENT_BEDROOMS).every(function (br) {
          var key = RENT_BEDROOMS[br];
          var amount = record.perBedroom && record.perBedroom[key];
          var fee = record.feesPerBedroom && record.feesPerBedroom[key];
          perBedroom[key] = amount;
          feesPerBedroom[key] = fee;
          return (amount === null || (typeof amount === 'number' && isFinite(amount) && amount >= 0)) &&
            typeof fee === 'number' && isFinite(fee) && fee >= 0;
        });
        if (valid) allowance = { applied: true, reason: null, source: 'shared', countyFips: county,
          basis: { method: record.method, reference: typeof record.reference === 'string' ? record.reference : null,
            effectiveDate: typeof record.effectiveDate === 'string' ? record.effectiveDate : null },
          perBedroom: perBedroom, feesPerBedroom: feesPerBedroom };
      }
      _sharedUtilityAllowance = { allowance: allowance, countyFips: county, regime: context.regime || rentLimitRegime() };
    }
    recalculate();
  }

  function clearSharedUtilityAllowance() {
    _sharedUtilityAllowance = null;
    _allowanceSourceChanged = true;
  }

  function resolveUtilityAllowance() {
    var limits = window.ChfaRentLimits;
    var subjectProject = window.SubjectProject;
    if (_sharedUtilityAllowance && _sharedUtilityAllowance.regime !== rentLimitRegime()) clearSharedUtilityAllowance();
    if (_resolvedDealMix && _resolvedDealMix.available) return { applied: false, reason: 'included_in_schedule_rents' };
    if (pendingSharedSchedule()) return { applied: false, reason: 'shared_schedule_loading' };
    if (rentLimitRegime() === 'market') return { applied: false, reason: 'unrestricted_market' };
    if (!limits) return { applied: false, reason: 'rent_module_unavailable' };
    var allowance = _sharedUtilityAllowance ? _sharedUtilityAllowance.allowance
      : limits.allowanceByBedroom(subjectProject && typeof subjectProject.get === 'function' ? subjectProject.get() : null, _countyFips);
    if (allowance.applied) {
      var mix = collectBedroomMix();
      var missing = SPLIT_BR_TYPES.find(function (br) { return mix[br] > 0 && allowance.perBedroom[RENT_BEDROOMS[br]] == null; });
      if (missing) return { applied: false, reason: 'allowance_bedroom_missing:' + RENT_BEDROOMS[missing] };
    }
    return allowance;
  }

  // Export the same allowance record used for the currently displayed revenue.
  function getUtilityAllowanceMetadata() {
    if (!_utilityAllowance.applied) return { applied: false, reason: _utilityAllowance.reason };
    return { applied: true, reason: null, countyFips: _utilityAllowance.countyFips || _countyFips,
      method: _utilityAllowance.basis.method, reference: _utilityAllowance.basis.reference,
      effectiveDate: _utilityAllowance.basis.effectiveDate,
      perBedroom: Object.assign({}, _utilityAllowance.perBedroom), feesPerBedroom: Object.assign({}, _utilityAllowance.feesPerBedroom) };
  }

  // Provenance reads the same loaded records as the prefill; it never prices a deal.
  function countySource(meta) {
    var hud = window.HudFmr;
    var county = hud && hud.getAllCounties && hud.getAllCounties().find(function (row) { return row.fips === _countyFips; });
    return Object.assign({ countyFips: _countyFips, geography: county && county.county_name || _countyFips }, meta);
  }
  function markSource(el, meta, available) {
    var provenance = window.InputProvenance;
    if (!provenance || !el) return;
    if (available && meta.fromShared) provenance.markShared(el, meta);
    else if (available && meta.source && meta.sourceUrl && meta.vintage != null && meta.geography) provenance.markData(el, meta);
    else {
      if ('value' in el) el.value = '';
      provenance.missing(el, 'Source unavailable for the selected geography.');
    }
  }
  function scheduleSource(mix) {
    var meta = mix.sourceMeta;
    return countySource({ source: 'Market Analysis Subject project', sourceUrl: 'market-analysis.html#subjectProjectMount',
      vintage: 'CHFA ' + meta.tableYear + ' · effective ' + meta.effectiveDate,
      why: 'Copied from the saved project schedule. Units and vacancy are project entries; rents use the cited CHFA table and allowance basis.',
      binding: 'schedule', fromShared: !!_sharedRentSchedule });
  }
  function prefillEvents(el) {
    function dispatch() {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (window.InputProvenance) window.InputProvenance.withProgrammaticChange(dispatch);
    else dispatch();
  }

  function renderUtilityAllowanceContext(blockedReason) {
    var allowance = _utilityAllowance;
    var limits = window.ChfaRentLimits;
    var reason = blockedReason || allowance.reason;
    var message = reason === 'shared_allowance_invalid' ? 'Shared utility allowance record is invalid'
      : reason && limits ? limits.unavailableMessage(reason) : 'Subject project unavailable';
    var text = blockedReason ? 'Rent revenue unavailable: ' + message
      : allowance.applied ? 'Utility allowance applied from ' + (allowance.basis.reference || 'Owner pays all utilities') +
        (allowance.basis.effectiveDate ? ' · effective ' + allowance.basis.effectiveDate : '')
      : 'Upper bound — utility allowance not applied: ' + message + '.';
    // Where the allowance is set, as a link rather than directions to follow.
    var setLink = !blockedReason && !allowance.applied && !(_resolvedDealMix && _resolvedDealMix.available)
      && !(allowance.source === 'shared' && allowance.applied);
    if (_resolvedDealMix && _resolvedDealMix.available) text = 'Schedule contract rents already include utility allowances and fees — no second deduction.';
    if (allowance.source === 'shared' && allowance.applied) {
      text = 'Utility allowance from shared scenario: ' + (allowance.basis.reference || 'Owner pays all utilities') +
        ' · effective ' + (allowance.basis.effectiveDate || 'not required') +
        (blockedReason ? '. Rent revenue unavailable: ' + message : '');
    }
    var notice = document.getElementById('dc-allowance-local-notice');
    if (notice) {
      notice.hidden = !_allowanceSourceChanged;
      notice.textContent = _allowanceSourceChanged
        ? 'County or rent setting changed — utility allowance now uses your local Subject project.' : '';
    }
    ['dc-rent-allowance-status', 'dc-noi-allowance-status'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = rentLimitRegime() === 'market';
      el.dataset.allowanceApplied = String(allowance.applied);
      el.dataset.allowanceSource = allowance.source || 'local';
      el.dataset.unavailableReason = reason || '';
      el.textContent = el.hidden ? '' : text;
      if (!el.hidden && setLink) {
        var a = document.createElement('a');
        var j = window.WorkflowState && window.WorkflowState.getJurisdiction ? window.WorkflowState.getJurisdiction() : null;
        var place = new URLSearchParams(window.location.search).get('geoid') || (j && j.geoid) || '';
        a.href = 'market-analysis.html' + (/^08\d{3}(\d{2})?$/.test(place) ? '?geoid=' + place : '')
          + '#subjectProjectMount';
        a.textContent = 'Set the utility allowance in Market Analysis \u2192';
        el.appendChild(document.createTextNode(' '));
        el.appendChild(a);
      }
      var basis = _resolvedDealMix && _resolvedDealMix.available
        ? _resolvedDealMix.sourceMeta.allowanceBasis : allowance.basis;
      markSource(el, countySource({ source: basis && (basis.reference || basis.method),
        sourceUrl: 'market-analysis.html#subjectProjectMount',
        fromShared: !!_sharedRentSchedule || allowance.source === 'shared',
        sourceValue: basis,
        vintage: basis && (basis.effectiveDate || (basis.method === 'owner_pays_all' ? 'Not required: owner pays all' : null)),
        why: 'Allowance basis supplied with the Subject project or shared scenario; the reference is user supplied, not independently verified.' }),
        !el.hidden && !!basis && !blockedReason);
      var badge = document.getElementById(id + '-prov');
      if (badge) badge.hidden = el.hidden;
    });
  }

  function getRentLimitsMetadata() {
    var result = rentCeilingFor(60, '2br');
    return { regime: result.regime, method: result.method || null, source: result.source || null,
      tableYear: result.tableYear == null ? null : result.tableYear, effectiveDate: result.effectiveDate || null };
  }

  function setChfaRentTable(table) {
    _chfaRentTable = table;
    updateAmiLimitsFromFmr(_countyFips);
  }

  function rentLimitText(result) {
    return result.grossRent != null ? '$' + Math.round(result.grossRent).toLocaleString('en-US') + '/mo' :
      (window.ChfaRentLimits ? window.ChfaRentLimits.unavailableMessage(result.unavailableReason) : 'Rent limits unavailable');
  }

  function renderRentLimitContext() {
    var result = rentCeilingFor(60, '2br');
    var regime = result.regime;
    var labels = { chfa_lihtc: 'CHFA LIHTC', ami_formula: 'Other AMI-restricted rental', market: 'Market-rate',
      home_high: 'HOME (High HOME rents)', home_low: 'HOME (Low HOME rents)',
      prop123: 'Prop 123' + (result.program && result.program.name ? ' · ' + result.program.name : '') };
    var caption = document.getElementById('dc-rent-limit-caption');
    if (caption) caption.textContent = (labels[regime] || regime) + ' · ' + (result.source || 'Source unavailable') +
      (result.tableYear == null ? '' : ' · ' + result.tableYear);
    var burden = document.getElementById('dc-const-rent-burden');
    if (burden) burden.disabled = regime !== 'ami_formula';
    var explanation = document.getElementById('dc-rent-burden-help');
    if (explanation) explanation.textContent = regime === 'ami_formula'
      ? 'Applies only to the non-CHFA income-based formula.'
      : regime === 'market' ? 'Market-rate rents have no income-based ceiling.'
      : regime === 'home_high' || regime === 'home_low' ? 'Published HUD HOME rents are fixed; rent burden does not change them.'
      : regime === 'prop123' ? 'Prop 123 sets rent at 30% of the unit\u2019s income limit; rent burden does not change it.'
      : 'Published CHFA rents are fixed; rent burden does not change them.';
    var prop123Box = document.getElementById('dc-prop123-choices');
    if (prop123Box) prop123Box.hidden = regime !== 'prop123';
    var caveats = document.getElementById('dc-rent-limit-caveats');
    if (caveats) {
      var notes = regime === 'prop123' && result.caveats ? result.caveats.slice() : [];
      if (regime === 'home_high' || regime === 'home_low') {
        notes.push(regime === 'home_high' ? 'High HOME units serve households at or below 80% AMI.' : 'Low HOME units serve households at or below 50% AMI.');
        notes.push('For a LIHTC project with HOME units, the lower of the two limits applies; this setting prices the whole project as HOME.');
      }
      caveats.textContent = notes.join(' ');
      caveats.hidden = !notes.length;
    }
    var hera = document.getElementById('dc-rent-limit-hera-note');
    if (hera) hera.hidden = regime !== 'chfa_lihtc';
    var formula = document.getElementById('dc-rent-limit-formula');
    if (formula) formula.textContent = regime === 'ami_formula'
      ? 'Non-CHFA formula: household income limit × (AMI tier ÷ 50) × rent burden ÷ 12.'
      : regime === 'market' ? 'No restricted limit (market-rate)'
      : regime === 'home_high' ? 'HUD High HOME rent by county and bedroom size: the lesser of the FMR and 30% of income at 65% AMI.'
      : regime === 'home_low' ? 'HUD Low HOME rent by county and bedroom size: 30% of income at 50% AMI, capped by the High HOME rent.'
      : regime === 'prop123' ? 'Prop 123: gross rent at 30% of the unit\u2019s income limit, the lower of CHFA\u2019s published cell and that rule.'
      : 'Published CHFA maximum gross rent by county, tier and bedroom size.';
    var example = '@ 60% AMI (2BR): ' + rentLimitText(result);
    ['dc-formula-ceiling-eg', 'dc-rent-limit-example'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = example; el.dataset.grossRent = result.grossRent == null ? '' : String(result.grossRent);
        markSource(el, countySource({ source: result.source, sourceUrl: result.sourceUrl,
          sourceValue: result.grossRent, effectiveDate: result.effectiveDate, binding: result.method, vintage: result.tableYear, why: result.method + (result.effectiveDate ? ' · effective ' + result.effectiveDate : '') }), result.grossRent != null);
      }
    });
    var note = document.getElementById('dc-fmr-note');
    if (note) {
      note.textContent = DEAL_AMI_BANDS.map(function (tier) {
        return tier + '% AMI (2BR): ' + rentLimitText(rentCeilingFor(tier, '2br'));
      }).join(' · ');
      note.style.color = '';
      markSource(note, countySource({ source: result.source, sourceUrl: result.sourceUrl,
        sourceValue: DEAL_AMI_BANDS.map(function (tier) { return rentCeilingFor(tier, '2br').grossRent; }),
        effectiveDate: result.effectiveDate, binding: result.method, vintage: result.tableYear, why: result.method }), result.grossRent != null);
    }
  }

  /** Populate every tier/bedroom from the selected shared rent-limit regime. */
  function updateAmiLimitsFromFmr(fips) {
    // Repeated async table loads may recalculate before the shared county's
    // options arrive. Only an actual county change can discard the record.
    if (_sharedUtilityAllowance && (fips || null) !== _countyFips &&
        (fips || null) !== _sharedUtilityAllowance.countyFips) clearSharedUtilityAllowance();
    if (_sharedRentSchedule && (fips || null) !== _countyFips &&
        (fips || null) !== _sharedRentSchedule.countyFips) clearSharedRentSchedule();
    if (_countyFips !== (fips || null) && window.InputProvenance) {
      window.InputProvenance.invalidateGeography(document.getElementById('dealCalcMount') || document, fips || null);
    }
    _countyFips = fips || null;
    populateProp123Choices();
    _amiLimits = null;
    _amiLimitsByBr = null;
    if (_countyFips || rentLimitRegime() === 'market') {
      _amiLimits = {};
      _amiLimitsByBr = {};
      DEAL_AMI_BANDS.forEach(function (tier) {
        _amiLimitsByBr[tier] = {};
        SPLIT_BR_TYPES.forEach(function (br) { _amiLimitsByBr[tier][br] = rentCeilingFor(tier, br).grossRent; });
        _amiLimits[tier] = _amiLimitsByBr[tier]['2br'];
      });
    }
    _renderPabNote(_countyFips);
    recalculate();
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
  <!-- The heading and the screening disclosure follow the Deal Mode toggle
       below (updateDealModeUi): LIHTC is a rental program, so the for-sale
       ownership mode must not sit under a LIHTC title or a disclosure about
       credit pricing, qualified basis and CHFA review — none of which apply
       to a deed-restricted sale-price gap. -->
  <h2 id="dealCalcTitle" style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;">
    <span data-dc-mode="rental">LIHTC Feasibility Calculator</span>
    <span data-dc-mode="ownership" hidden>For-Sale Ownership Feasibility Calculator</span>
  </h2>
  <!-- Screening-level model disclosure — rental LIHTC mode -->
  <div role="note" data-dc-mode="rental" style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:var(--sp3);padding:0.5rem 0.75rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);font-size:var(--tiny);">
    <span style="font-size:1rem;flex-shrink:0;" aria-hidden="true">🔎</span>
    <div>
      <strong style="color:var(--text);">Model class: screening-level</strong> —
      outputs are planning estimates only. Credit pricing, interest rates, equity, and lender terms
      vary significantly by market, investor, and deal structure. It calculates qualified basis, the applicable fraction
      and CHFA's credit limits from your cost lines and a sourced rules file; carryover allocation
      and CHFA's cost basis limits are not modeled. Not a substitute for lender underwriting,
      CHFA review, or legal/tax counsel.
      <a href="docs/LIHTC_FEASIBILITY_CALCULATOR.md" style="color:var(--accent);">Methodology →</a>
    </div>
  </div>
  <!-- Screening-level model disclosure — for-sale ownership mode -->
  <div role="note" data-dc-mode="ownership" hidden style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:var(--sp3);padding:0.5rem 0.75rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);font-size:var(--tiny);">
    <span style="font-size:1rem;flex-shrink:0;" aria-hidden="true">🔎</span>
    <div>
      <strong style="color:var(--text);">Model class: screening-level</strong> —
      outputs are planning estimates only. The max affordable sale price comes from HUD AMI and the
      HNA ownership finance assumptions (mortgage rate and term, down payment, taxes, insurance, HOA)
      at the target AMI band; the subsidy gap is development cost per unit minus that price. This tool
      does not underwrite buyer qualification, appraisal, construction lending, or the legal terms of
      the recorded restriction. Not a substitute for lender underwriting, program-administrator review,
      or legal counsel.
      <a href="housing-needs-assessment.html#affordable-ownership-need-section" style="color:var(--accent);">Ownership need methodology →</a>
    </div>
  </div>
  <p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);">
    Early-stage feasibility sizing tool. Not a final underwriting or award prediction model.
    Outputs depend on assumptions and local soft-funding availability.
    See the methodology note above for scope and limitations.
  </p>

  <!-- Deal Mode Toggle -->
  <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);margin-bottom:var(--sp3);">
    <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Deal Mode</legend>
    <div style="display:flex;flex-wrap:wrap;gap:var(--sp3);align-items:center;">
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-mode-rental" type="radio" name="dc-deal-mode" value="rental" checked
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>Rental LIHTC pro forma</strong></span>
      </label>
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-mode-ownership" type="radio" name="dc-deal-mode" value="ownership"
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>For-sale ownership feasibility</strong></span>
      </label>
    </div>
    <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0;">
      Ownership mode sizes a per-unit subsidy gap for deed-restricted or shared-equity homes
      using the same max affordable sale-price math as the HNA Affordable Ownership Need module.
    </p>
  </fieldset>

  <!-- Credit Rate Scenario Toggle -->
  <fieldset id="dc-credit-rate-scenario" data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);margin-bottom:var(--sp3);">
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
  <div id="dc-calc-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px, 100%),1fr));gap:var(--sp3);align-items:start;">

    <!-- Inputs column -->
    <div id="dc-inputs-col" style="min-width:0;">
      <h3 style="font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        Deal Assumptions
      </h3>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Project Inputs</legend>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Development Cost ($)</span>
          <input id="dc-tdc" type="number" min="0" step="100000" value="20000000"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          <span id="dc-tdc-permit-context" role="note" hidden style="display:block;margin-top:.3rem;font-size:var(--tiny);color:var(--muted);line-height:1.45;"></span>
        </label>

        <!-- Gross building area. NO default value, deliberately.
             Every other field here ships a placeholder figure, which is fine
             for a screening tool — but a made-up floor area would produce a
             made-up $/SF, and $/SF is the number a developer or lender checks
             FIRST against what they know. An invented one is worse than none.
             Left blank, the cost-per-SF row reads "not entered" rather than
             showing a figure nobody supplied. -->
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Gross building area (SF)
            <span style="color:var(--muted)">&mdash; optional</span></span>
          <input id="dc-gross-sf" type="number" min="0" step="1000" placeholder="not entered" aria-describedby="dc-gross-sf-help"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);">
          <span id="dc-gross-sf-help" style="display:block;margin-top:.2rem;font-size:var(--small);color:var(--muted);">
            Total constructed area including circulation and common space &mdash; not the sum of unit sizes. Enter it to see cost per square foot.</span>
        </label>
        <label data-dc-mode="rental" style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Residential floor area (SF)
            <span style="color:var(--muted)">&mdash; optional</span></span>
          <input id="dc-res-sf" type="number" min="0" step="1000" placeholder="not entered" aria-describedby="dc-res-sf-help"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);">
          <span id="dc-res-sf-help" style="display:block;margin-top:.2rem;font-size:var(--small);color:var(--muted);">
            Floor space of all rental units, without corridors and common space. Used for cost per residential square foot and the floor-space fraction.</span>
        </label>
        <!-- #1814: estimate gross area from the unit mix. Colorado's CHFA QAP
             sets no minimum unit size by bedroom count, so the references are
             other jurisdictions' standards and say so. Nothing fills in until
             the user picks a reference and clicks Use; typing in the field
             above always wins. -->
        <details id="dc-gsf-estimate" style="margin:-.35rem 0 var(--sp2);font-size:var(--small);">
          <summary style="cursor:pointer;color:var(--muted);">Estimate gross area from the unit mix</summary>
          <p id="dc-gsf-colorado-note" style="margin:.35rem 0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">
            Colorado's CHFA Qualified Allocation Plan sets no minimum unit size by bedroom count, so there is no Colorado standard to derive from.
            The references below are other jurisdictions' figures, labelled as such. Multiplying your mix by one of them is a screening estimate, not a design.
          </p>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;">
            <label style="display:block;">Reference standard
              <select id="dc-gsf-standard" style="display:block;width:100%;margin-top:.15rem;min-height:44px;">
                <option value="">&mdash; choose a reference &mdash;</option>
              </select>
            </label>
            <label style="display:block;">Efficiency (net &divide; gross)
              <input id="dc-gsf-efficiency" type="number" min="0.5" max="1" step="0.01" value="0.80" style="display:block;width:100%;margin-top:.15rem;">
            </label>
          </div>
          <p id="dc-gsf-efficiency-note" style="margin:.35rem 0 0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">Efficiency default loads with the reference data.</p>
          <p id="dc-gsf-working" style="margin:.35rem 0 0;font-size:var(--tiny);color:var(--text);line-height:1.45;" aria-live="polite">Choose a reference standard to see an estimate.</p>
          <button type="button" id="dc-gsf-apply" disabled style="margin-top:.45rem;min-height:44px;">Use this estimate as gross area</button>
        </details>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Units</span>
          <input id="dc-units" type="number" min="1" step="1" value="60"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label id="dc-sale-target-wrap" data-dc-mode="ownership" hidden style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Ownership Sale Target</span>
          <select id="dc-sale-target-ami"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <option value="80" selected>80% AMI</option>
            <option value="100">100% AMI</option>
            <option value="110">110% AMI</option>
            <option value="120">120% AMI</option>
          </select>
        </label>

        <div id="dc-rental-ami-mix" data-dc-mode="rental" style="margin-bottom:var(--sp2);">
          <label for="dc-rent-limit-regime" style="display:block;margin-bottom:var(--sp2);">Rent limits
            <select id="dc-rent-limit-regime" style="display:block;width:100%;min-height:44px;background:var(--bg2);color:var(--text);">
              <option value="chfa_lihtc" selected>CHFA LIHTC</option>
              <option value="home_high">HOME, High HOME rents (HUD)</option>
              <option value="home_low">HOME, Low HOME rents (HUD)</option>
              <option value="prop123">Prop 123 (Colorado affordable housing fund)</option>
              <option value="ami_formula">Other AMI-restricted rental (non-CHFA formula)</option>
              <option value="market">Market-rate (unrestricted)</option>
            </select>
          </label>
          <div id="dc-prop123-choices" hidden>
            <label for="dc-prop123-program" style="display:block;margin-bottom:var(--sp2);">Prop 123 program
              <select id="dc-prop123-program" style="display:block;width:100%;min-height:44px;background:var(--bg2);color:var(--text);">
                <option value="">Choose a program</option>
              </select>
            </label>
            <label for="dc-prop123-petition" style="display:block;margin-bottom:var(--sp2);">Approved rural resort petition
              <select id="dc-prop123-petition" style="display:block;width:100%;min-height:44px;background:var(--bg2);color:var(--text);">
                <option value="">None</option>
              </select>
            </label>
            <p style="font-size:var(--tiny);color:var(--muted);">Only petitions filed from the selected county are listed; pick one only if the project is inside that jurisdiction. Prop 123 LIHTC gap and predevelopment loans follow the CHFA LIHTC setting, because those projects carry tax credits.</p>
          </div>
          <p id="dc-rent-limit-caveats" hidden style="font-size:var(--tiny);color:var(--muted);" aria-live="polite"></p>
          <p id="dc-rent-limit-hera-note" style="font-size:var(--tiny);color:var(--muted);">Regular CHFA limits — HERA applies only to projects placed in service by 12/31/2008.</p>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Federal minimum set-aside election</span>
            <select id="dc-minimum-set-aside"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
              <option value="20-50">20-50 election</option>
              <option value="40-60" selected>40-60 election (default)</option>
              <option value="average-income">Average Income Test (20-80% designations)</option>
            </select>
          </label>
          <div id="dc-minimum-set-aside-help" role="note"
            style="font-size:var(--tiny);color:var(--muted);margin:-.25rem 0 .55rem;line-height:1.45;">
            The default 40-60 election requires at least 40% of residential units at 60% AMI or below.
            Changing this control changes federal credit eligibility; it does not change the units you entered.
          </div>
          <input id="dc-unit-mix-source" type="hidden" value="auto">
          <input id="dc-unrepresented-schedule-rows" type="hidden" value="[]">
          <p id="dc-unit-mix-status" role="status" aria-live="polite"></p>
          <button id="dc-edit-unit-mix" type="button" style="min-height:44px;">Edit here instead</button>
          <p id="dc-schedule-local-notice" hidden role="status"></p>
          <p id="dc-unrepresented-schedule-notice" hidden></p>
          <div id="dc-schedule-table" hidden style="overflow-x:auto;"></div>
          <div id="dc-manual-unit-mix">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:0.4rem;flex-wrap:wrap;">
            <span style="font-size:var(--small);color:var(--muted);">AMI Mix &amp; Units per Tier</span>
            <!-- F257 — "Pre-fill from local need" wires the AMI tier defaults
                 to the selected jurisdiction's documented affordability gap
                 (place-level when available, otherwise county-level).
                 Allocates totalUnits proportionally to the gap counts at the
                 LIHTC-eligible tiers (≤60% AMI). -->
            <button id="dc-ami-prefill" type="button"
              style="padding:.3rem .65rem;font-size:.8125rem;font-weight:600;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:6px;cursor:pointer;"
              title="Allocate the LIHTC-eligible tiers proportional to the documented gap at 30/50/60% AMI for the selected jurisdiction"
            >Pre-fill from local need</button>
          </div>
          <div id="dc-ami-prefill-meta" hidden
            style="font-size:.8125rem;color:var(--muted);margin-bottom:.4rem;padding:.4rem .55rem;border:1px solid var(--border);border-radius:6px;background:var(--bg2);line-height:1.45;"></div>
          <!-- P7: per-tier BR-type selector. Each AMI tier now has a BR
               type (Studio/1BR/2BR/3BR/4BR). Rent ceiling per row is
               computed using §42 imputed household size (1.5 × BR count).
               Default 2BR for every tier (matches the old single-rent
               behavior). For mixed deals (typical: 30% at 1BR, 60% at
               2BR, 80% at 3BR), change the dropdown per tier. -->
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 70px 100px;gap:0.25rem 0.5rem;font-size:var(--tiny);color:var(--muted);margin-bottom:.2rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">
            <span>AMI tier</span><span style="text-align:center;">Units</span><span>Bedrooms</span>
          </div>
          <div id="dc-ami-rows" style="display:grid;grid-template-columns:minmax(0,1fr) 70px 100px;gap:0.4rem 0.5rem;align-items:center;">
            ${DEAL_AMI_BANDS.map(pct => {
              var lihtcEligible = isLihtcCreditEligiblePct(pct, DEFAULT_MINIMUM_SET_ASIDE_ELECTION);
              var defaultUnits = pct === 20 ? 0 : (lihtcEligible ? 15 : 0);
              var tierLabel = amiBandLabelHtml(pct, DEFAULT_MINIMUM_SET_ASIDE_ELECTION);
              var brOptions = [
                ['studio', 'Studio'], ['1br', '1BR'],
                ['2br', '2BR (default)'], ['3br', '3BR'], ['4br', '4BR']
              ].map(function (b) {
                var sel = b[0] === '2br' ? ' selected' : '';
                return '<option value="' + b[0] + '"' + sel + '>' + b[1] + '</option>';
              }).join('');
              return `
              <label style="display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;min-height:44px;font-size:var(--small);white-space:normal;min-width:0;">
                <input id="dc-chk-${pct}" type="checkbox" ${lihtcEligible ? 'checked' : ''} style="width:16px;height:16px;">
                <span id="dc-ami-label-${pct}">${tierLabel}</span>
              </label>
              <input id="dc-units-${pct}" type="number" min="0" step="1" value="${defaultUnits}"
                aria-label="Units at ${pct}% AMI"
                style="padding:0.35rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);text-align:right;">
              <select id="dc-br-${pct}"
                aria-label="Bedroom type for ${pct}% AMI units"
                style="padding:0.35rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
                ${brOptions}
              </select>
              <div style="grid-column:1 / -1;display:grid;grid-template-columns:repeat(auto-fit,minmax(60px,1fr));gap:0.35rem;padding:0.2rem 0 0.35rem;">
                ${SPLIT_BR_TYPES.map(function (br) {
                  return '<label style="display:block;">' +
                    '<span style="display:block;font-size:var(--tiny);color:var(--muted);margin-bottom:0.12rem;text-transform:uppercase;letter-spacing:.04em;">' + br + ' units</span>' +
                    '<input id="dc-units-' + pct + '-' + br + '" type="number" min="0" step="1" value="0" aria-label="' + br + ' units at ' + pct + '% AMI" ' +
                    'style="width:100%;padding:0.35rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);text-align:right;">' +
                  '</label>';
                }).join('')}
              </div>
            `;}).join('')}
          </div>
          <div style="font-size:var(--tiny);color:var(--muted);margin:.4rem 0;line-height:1.45;">
            Credit-eligible tiers depend on the elected minimum set-aside; 100%, 110%, and 120%
            AMI never generate federal LIHTC equity in this screening model.
            110% and 120% AMI are middle-income planning bands for Colorado's
            Middle Income Housing Tax Credit (MIHTC) and Prop 123 context only;
            this calculator does not size MIHTC credits. Mixed-income deals use IRC §42(c)(1)(B)
            applicable fraction — eligible basis is prorated by LIHTC unit share.
            See live calculation below.
          </div>

          <fieldset id="dc-manual-market-rents" hidden style="margin-top:.75rem;border:1px solid var(--border);padding:.65rem;min-width:0;">
            <legend>Unrestricted market rents</legend>
            <input id="dc-market-rent-overrides" type="hidden" value="">
            <p id="dc-market-split" style="font-size:var(--small);"></p>
            <div id="dc-market-bedroom-wrap"><label>Bedroom size when the grid has no mix
              <select id="dc-market-bedroom" style="min-height:44px;">
                ${SPLIT_BR_TYPES.map(function (br) { return '<option value="' + br + '"' + (br === '2br' ? ' selected' : '') + '>' + br.toUpperCase() + '</option>'; }).join('')}
              </select>
            </label></div>
            <label style="display:block;">Rent source
              <select id="dc-market-rent-mode" style="min-height:44px;width:100%;">
                <option value="zori">Local ZORI bedroom estimates</option>
                <option value="override">Enter market rents and a source note</option>
              </select>
            </label>
            <p id="dc-market-rent-vintage" style="font-size:var(--tiny);"></p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.5rem;">
              ${SPLIT_BR_TYPES.map(function (br) { return '<label>' + br.toUpperCase() + ' monthly rent' +
                '<input id="dc-market-rent-' + br + '" type="number" min="1" step="1" readonly style="width:100%;min-height:44px;" aria-label="Unrestricted ' + br + ' monthly market rent"></label>'; }).join('')}
            </div>
            <div id="dc-market-source-wrap" hidden><label>Source for your entered market rents (required)
              <input id="dc-market-rent-source" type="text" style="width:100%;min-height:44px;" placeholder="Survey or comparable properties, date, and county">
            </label></div>
            <p id="dc-market-rent-status" role="status" aria-live="polite" style="font-size:var(--small);"></p>
          </fieldset>
          </div><!-- manual unit mix -->
          <div id="dc-minimum-set-aside-status" role="status" aria-live="polite"
            style="font-size:var(--tiny);line-height:1.45;margin:.55rem 0;padding:.5rem .65rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);"></div>

          <!-- Q5: Achievable-rent cap toggle (CHFA QAP "min(ceiling, market)" rule)
               In weak markets, the planning ceiling for 70%-120% AMI tiers
               often exceeds what the local market will actually pay. CHFA's
               QAP requires underwriting at min(ceiling, market). When ON,
               this caps the 70%-120% AMI per-unit rents at the per-BR
               ZORI estimate so the proforma doesn't overstate revenue. -->
          <div id="dc-achievable-cap-wrap"
            style="margin-top:.65rem;padding:.55rem .65rem;border:1px solid var(--border);
                   border-radius:var(--radius);background:var(--bg2);">
            <label style="display:flex;align-items:flex-start;gap:.55rem;font-size:var(--small);cursor:pointer;">
              <input id="dc-achievable-cap" type="checkbox"
                style="width:1rem;height:1rem;margin-top:.18rem;flex:0 0 auto;cursor:pointer;"
                aria-describedby="dc-achievable-cap-help">
              <span style="flex:1 1 auto;min-width:0;">
                <strong>Cap 70%-120% AMI rents at market (ZORI)</strong>
                <span id="dc-achievable-cap-help"
                  style="display:block;font-size:var(--tiny);color:var(--muted);line-height:1.45;margin-top:.15rem;">
                  In soft markets the ceiling on workforce and middle-income tiers often exceeds achievable
                  rent. When checked, 70%-120% AMI rents underwrite at
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

        <!-- #2160: eligible basis comes from the itemized costs. The 30% boost
             needs a designation AND its evidence, applies once, and never to
             acquisition basis. -->
        <div id="dc-boost-wrap" data-dc-mode="rental" style="margin-top:var(--sp2);margin-bottom:var(--sp2);padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);font-weight:600;">30% basis boost</span>
            <select id="dc-boost-designation" aria-describedby="dc-boost-help"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
              <option value="none" selected>No boost</option>
              <option value="qct">Qualified Census Tract (QCT)</option>
              <option value="dda">Difficult Development Area (DDA)</option>
              <option value="sadda">Small Area DDA (SADDA)</option>
              <option value="chfa">CHFA basis boost (9% only)</option>
            </select>
          </label>
          <label style="display:block;">
            <span style="font-size:var(--small);color:var(--muted);">Evidence for the boost</span>
            <input id="dc-boost-evidence" type="text" maxlength="200" placeholder="HUD map or list for the tract, or CHFA letter and date"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
          </label>
          <label style="display:block;margin-top:0.35rem;">
            <span style="font-size:var(--small);color:var(--muted);">CHFA basis boost only: percentage in CHFA's letter (up to 30)</span>
            <input id="dc-boost-pct" type="number" min="0" max="30" step="1" placeholder="not entered"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
          </label>
          <p id="dc-boost-help" style="font-size:var(--tiny);color:var(--muted);margin:0.35rem 0 0;line-height:1.45;">
            A QCT, DDA or SADDA boost raises eligible basis by 30% once; a CHFA boost raises it once by the percentage in CHFA's letter, up to 30%. It needs a designation and the evidence for it, never applies to buying an existing building, and the CHFA boost cannot be combined with a QCT, DDA or SADDA.
          </p>
          <p id="dc-dda-2027" style="font-size:var(--tiny);color:var(--muted);margin:0.35rem 0 0;line-height:1.45;">
            HUD's 2027 lists apply to 9% credits allocated after December 31, 2026, which is every 2027 round. A 4% bond deal uses them only if, after that date, its bonds are issued and its buildings placed in service. They add Archuleta and Chaffee counties and ZIP 80433 as DDAs, and drop San Miguel County and ZIPs 80129, 80249, 80465 and 80913. This site's maps show the 2026 lists until January.
            <a href="https://www.huduser.gov/portal/Datasets/qct/DDA2027NM.PDF" target="_blank" rel="noopener">HUD 2027 county list</a> ·
            <a href="https://www.huduser.gov/portal/Datasets/qct/DDA2027M.PDF" target="_blank" rel="noopener">HUD 2027 ZIP list</a> ·
            <a href="https://www.federalregister.gov/documents/2026/10/06/2026-20390/statutorily-mandated-designation-of-difficult-development-areas-and-qualified-census-tracts-for-2027" target="_blank" rel="noopener">Federal Register, October 6, 2026</a>
          </p>
          <p id="dc-qct-dda-note" role="status" style="display:none;font-size:var(--tiny);color:var(--accent);margin:0.3rem 0 0;font-weight:600;"></p>
        </div>
        <label data-dc-mode="rental" style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Building type, for CHFA's cost basis limits</span>
          <select id="dc-building-type"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
            <option value="" selected>Not chosen</option>
            <option value="elevator">Elevator</option>
            <option value="walk_up">Walk-up</option>
          </select>
        </label>
        <label data-dc-mode="rental" style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Floor area of the units counted as LIHTC units (SF)
            <span style="color:var(--muted)">&mdash; needed only when some units are unrestricted</span></span>
          <input id="dc-restricted-sf" type="number" min="0" step="100" placeholder="not entered"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);">
        </label>

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
          <!-- F140 — clarify the authority. HUD publishes the FMR/AMI tables
               annually; CHFA applies them (+1.5x rent ceiling for LIHTC) for
               Colorado deals. Both links so the user can sanity-check the
               numbers the calculator uses. -->
          <span style="font-size:var(--small);color:var(--muted);">
            County (sets HUD FMR / AMI<span data-dc-mode="rental"> &mdash; CHFA applies LIHTC rent &amp; income limits</span>.
            <a href="https://www.huduser.gov/portal/datasets/il.html" target="_blank" rel="noopener" style="color:var(--link);">HUD Income Limits ↗</a><span data-dc-mode="rental"> ·
            <a href="https://www.chfainfo.com/rental-housing/asset-management/rent-income-limits" target="_blank" rel="noopener" style="color:var(--link);">CHFA Rent &amp; Income Limits ↗</a></span>)
          </span>
          <select id="dc-county-select"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="">Default (Denver MSA)</option>
          </select>
          <span id="dc-jurisdiction-context" hidden
            style="display:block;margin-top:0.35rem;font-size:var(--tiny);color:var(--muted);"></span>
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
                       background:var(--accent,#096e65);color:var(--on-accent,#fff);border-radius:4px;
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
        <div id="dc-fmr-note" data-dc-mode="rental" style="font-size:var(--tiny);color:var(--warn, #e6a23c);margin-top:-0.25rem;margin-bottom:var(--sp2);">
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

      <!-- #2160: itemized development costs set eligible basis, the developer
           fee and the contractor contract. -->
      <fieldset id="dc-costs" data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Development Costs</legend>
        <p id="dc-cost-example-note" role="note" style="margin:0 0 var(--sp2);padding:0.4rem 0.6rem;font-size:var(--tiny);background:rgba(217,119,6,.08);border-left:3px solid var(--warn,#d97706);border-radius:0 4px 4px 0;line-height:1.45;">
          An <strong>invented example budget</strong> is loaded so the figures work. Replace each line with your project's budget.
        </p>
        <dl id="dc-cost-totals" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.3rem .75rem;font-size:var(--small);margin:0 0 var(--sp2);">
          <dt style="color:var(--muted);">Itemized costs</dt><dd id="dc-cb-itemized" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Not itemized (counted as not in basis)</dt><dd id="dc-cb-not-itemized" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Cost in eligible basis</dt><dd id="dc-cb-eligible-cost" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Contractor contract (part of the costs above)</dt><dd id="dc-cb-contract" style="margin:0;text-align:right;font-weight:700;">—</dd>
        </dl>
        <p id="dc-cb-cost-reason" role="status" hidden style="margin:0 0 var(--sp2);font-size:var(--small);color:var(--bad,#b91c1c);"></p>
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:var(--sp2);">
          <button type="button" id="dc-cost-use-total" class="btn btn-secondary" style="min-height:44px;white-space:normal;max-width:100%;">Make Total Development Cost match the cost lines</button>
          <button type="button" id="dc-cost-clear" class="btn btn-secondary" style="min-height:44px;white-space:normal;max-width:100%;">Clear the example budget</button>
        </div>
        <details id="dc-cost-lines-wrap">
          <summary style="cursor:pointer;min-height:44px;font-weight:600;font-size:var(--small);">Edit the cost lines</summary>
          <p style="font-size:var(--tiny);color:var(--muted);margin:.35rem 0;line-height:1.45;">Each line is in eligible basis, partly in it, or not in it. A blank line has no cost. Contingencies keep their original amount, the use proposed so far, and what remains.</p>
          <div id="dc-cost-lines">${costTableHtml()}</div>
        </details>
      </fieldset>

      <fieldset id="dc-credit-figures" data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Tax Credits Requested and Awarded</legend>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:var(--sp2);">
          <label style="display:block;font-size:var(--small);color:var(--muted);">Annual federal credit requested ($)
            <input id="dc-credit-requested" type="number" min="0" step="1000" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
          <label style="display:block;font-size:var(--small);color:var(--muted);">Annual federal credit awarded ($)
            <input id="dc-credit-awarded" type="number" min="0" step="1000" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
        </div>
        <p style="font-size:var(--tiny);color:var(--muted);margin:.35rem 0 0;line-height:1.45;">Equity uses the award when you enter one, otherwise the request (up to capacity), otherwise the capacity.</p>
        <details id="dc-state-credit-wrap" style="margin-top:var(--sp2);">
          <summary style="cursor:pointer;min-height:44px;font-weight:600;font-size:var(--small);">State credits and equity pay-in</summary>
          <label style="display:block;font-size:var(--small);color:var(--muted);margin-top:.35rem;">CHFA state credit application (each has its own limit)
            <select id="dc-state-path" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
              <option value="">Not answered (a 9% deal uses the 9% pairing)</option>
              <option value="with_9pct">Paired with a 9% application: a fixed $500,000 a year</option>
              <option value="round_two">Round Two with 4%: accelerated up to $1,300,000 plus paired standard up to $600,000 a year</option>
              <option value="bond_fall">4% bond deal applying Sept to Nov: $10,000 per unit, up to $700,000 a year</option>
            </select></label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:var(--sp2);margin-top:.35rem;">
            <label style="display:block;font-size:var(--small);color:var(--muted);">Annual state credit ($)
              <input id="dc-state-annual" type="number" min="0" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            <label style="display:block;font-size:var(--small);color:var(--muted);">Round Two only: paired standard state credit, annual ($)
              <input id="dc-state-standard-annual" type="number" min="0" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            <label style="display:block;font-size:var(--small);color:var(--muted);">Price per $1 of state credit
              <input id="dc-state-price" type="number" min="0" max="1.5" step="0.01" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            <label style="display:block;font-size:var(--small);color:var(--muted);">State credit investor fees, total ($)
              <input id="dc-state-fees" type="number" min="0" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
          </div>
          <label style="display:flex;align-items:flex-start;gap:0.55rem;margin-top:.35rem;font-size:var(--small);cursor:pointer;min-height:44px;">
            <input id="dc-state-awarded" type="checkbox" style="width:1rem;height:1rem;margin-top:0.18rem;flex:0 0 auto;">
            <span>CHFA has awarded this state credit (a proposed amount does not count: CHFA sizes it with a three-test calculation this calculator does not model)</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:.35rem 0;line-height:1.45;">State credit equity is a separate source from federal equity: each annual amount, within CHFA's limit for the application, over the six-year allocation. CHFA's limits apply per project and per applicant, with its affiliates, so other active applications leave less; these figures assume there are none.</p>
          <div role="group" aria-labelledby="dc-bond-h" style="margin-top:var(--sp2);">
            <p id="dc-bond-h" style="margin:0;font-size:var(--small);font-weight:600;">Tax-exempt bonds and construction loan (4% deals)</p>
            <p style="font-size:var(--tiny);color:var(--muted);margin:.2rem 0 .35rem;line-height:1.45;">A 4% deal gets its credits only if tax-exempt bonds pay for enough of the building and land. Enter the bonds and the construction loan to check that test and the construction interest budget.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:.4rem;">
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Tax-exempt bonds ($)</span><input id="dc-bond-amount" type="number" min="0" step="1000" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Bonds from an issue dated after 2025?</span><select id="dc-bond-post2025" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Construction loan ($)</span><input id="dc-constr-loan" type="number" min="0" step="1000" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Construction loan rate (%)</span><input id="dc-constr-rate" type="number" min="0" max="20" step="0.05" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Loan months, closing to payoff</span><input id="dc-constr-months" type="number" min="1" max="60" step="1" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--tiny);color:var(--muted);"><span style="display:block;">Average share drawn (%)</span><input id="dc-constr-draw" type="number" min="1" max="100" step="1" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            </div>
          </div>
          <div role="group" aria-labelledby="dc-fed-payin-h" style="margin-top:var(--sp2);">
            <p id="dc-fed-payin-h" style="margin:0;font-size:var(--small);font-weight:600;">Federal equity pay-in (% of federal equity)</p>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;">
              <label style="font-size:var(--tiny);color:var(--muted);">At closing<input id="dc-fed-payin-closing" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="font-size:var(--tiny);color:var(--muted);">At completion<input id="dc-fed-payin-completion" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="font-size:var(--tiny);color:var(--muted);">At stabilization<input id="dc-fed-payin-stabilization" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            </div>
          </div>
          <div role="group" aria-labelledby="dc-state-payin-h" style="margin-top:var(--sp2);">
            <p id="dc-state-payin-h" style="margin:0;font-size:var(--small);font-weight:600;">State equity pay-in (% of state equity)</p>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;">
              <label style="font-size:var(--tiny);color:var(--muted);">At closing<input id="dc-state-payin-closing" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="font-size:var(--tiny);color:var(--muted);">At completion<input id="dc-state-payin-completion" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="font-size:var(--tiny);color:var(--muted);">At stabilization<input id="dc-state-payin-stabilization" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            </div>
          </div>
          <div id="dc-add-credit" role="group" aria-labelledby="dc-add-h" style="margin-top:var(--sp3);border-top:1px solid var(--border);padding-top:var(--sp2);">
            <p id="dc-add-h" style="margin:0;font-size:var(--small);font-weight:600;">Added credit: Transit Zone or another credit</p>
            <p style="font-size:var(--tiny);color:var(--muted);margin:.25rem 0 0;line-height:1.45;">A credit can add to the others or replace part of one. Replacing a credit brings no new cash, and an allocator may cut another award when a source is added, so the table shows the net new equity, not just the gross. Once its figures are entered and its eligibility is shown, it is counted in the sources and uses.</p>
            <label style="display:block;font-size:var(--small);color:var(--muted);margin-top:.35rem;">Added credit
              <select id="dc-add-kind" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
                <option value="">None</option>
                <option value="tz">Colorado Transit Zone credit (HB26-1065)</option>
                <option value="designation">Another location- or designation-based credit</option>
                <option value="other">Another credit, not tied to location</option>
              </select></label>
            <label style="display:block;font-size:var(--small);color:var(--muted);margin-top:.35rem;">Eligibility evidence (the designation, map or letter showing the site qualifies)
              <input id="dc-add-evidence" type="text" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            <p id="dc-add-tz-note" hidden style="font-size:var(--tiny);color:var(--muted);margin:.35rem 0 0;line-height:1.45;">The Transit Zone credit counts only when Market Analysis places the site inside a zone on OEDIT's map and you enter the evidence, so use this calculator on the Market Analysis page for it. CHFA's draft 2027-28 QAP takes it in place of standard state credit, as one allowance: if that applies, choose that it replaces the Colorado state credit.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:var(--sp2);margin-top:.35rem;">
              <label style="display:block;font-size:var(--small);color:var(--muted);">Annual credit ($)
                <input id="dc-add-annual" type="number" min="1" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Years claimed
                <input id="dc-add-years" type="number" min="1" step="1" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Investor price per $1 of credit
                <input id="dc-add-price" type="number" min="0.01" max="1.5" step="0.01" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">New investor fees, total ($)
                <input id="dc-add-fees" type="number" min="0" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Program year
                <input id="dc-add-program-year" type="number" min="2000" max="2100" step="1" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:var(--sp2);margin-top:.35rem;">
              <label style="display:block;font-size:var(--small);color:var(--muted);">Adds or replaces
                <select id="dc-add-mode" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
                  <option value="">Not answered</option>
                  <option value="supplement">Adds to the other credits</option>
                  <option value="substitute">Replaces part of another credit</option>
                </select></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Credit it replaces
                <select id="dc-add-displaces" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
                  <option value="">Not answered</option>
                  <option value="state">Colorado state credit</option>
                  <option value="federal">Federal credit</option>
                </select></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Annual amount it replaces ($)
                <input id="dc-add-displaced-annual" type="number" min="1" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              <label style="display:block;font-size:var(--small);color:var(--muted);">Cut to the annual federal credit, if the allocator makes one ($)
                <input id="dc-add-fed-cut" type="number" min="0" step="1000" placeholder="none" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
            </div>
            <div role="group" aria-labelledby="dc-add-payin-h" style="margin-top:var(--sp2);">
              <p id="dc-add-payin-h" style="margin:0;font-size:var(--small);font-weight:600;">Added credit equity pay-in (% of its gross equity)</p>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;">
                <label style="font-size:var(--tiny);color:var(--muted);">At closing<input id="dc-add-payin-closing" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
                <label style="font-size:var(--tiny);color:var(--muted);">At completion<input id="dc-add-payin-completion" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
                <label style="font-size:var(--tiny);color:var(--muted);">At stabilization<input id="dc-add-payin-stabilization" type="number" min="0" max="100" step="1" placeholder="—" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;"></label>
              </div>
            </div>
            <div id="dc-add-result" hidden style="margin-top:var(--sp2);">
              <p id="dc-add-reason" role="status" hidden style="margin:0 0 var(--sp2);font-size:var(--small);color:var(--warn,#b45309);"></p>
              <div style="overflow-x:auto;"><table id="dc-add-table" data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);">
                <caption style="text-align:left;font-weight:600;padding:0 0 .25rem;">Net new equity</caption>
                <thead><tr><th scope="col" style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Item</th><th scope="col" style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Amount</th></tr></thead>
                <tbody id="dc-add-rows"></tbody>
              </table></div>
            </div>
          </div>
        </details>
      </fieldset>

      <!-- Debt / Mortgage Inputs -->
      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Operating Income &amp; NOI</legend>

        <!-- Auto-compute NOI toggle -->
        <div style="margin-bottom:var(--sp2);padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;">
            <input id="dc-auto-noi" type="checkbox" checked style="width:16px;height:16px;flex-shrink:0;">
            <span style="font-size:var(--small);font-weight:600;">Auto-compute NOI from rent &amp; expense inputs</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0 1.6rem;">
            When checked, NOI = (Gross Rents + Other Income) × (1 − Vacancy) − Operating Expenses − Replacement Reserve − Net Property Tax
          </p>
        </div>

        <!-- Manual NOI override (hidden when auto-compute is on — default) -->
        <div id="dc-noi-manual-wrap" style="margin-bottom:var(--sp2);display:none;">
          <label style="display:block;">
            <span style="font-size:var(--small);color:var(--muted);">Net Operating Income (NOI) ($/year)</span>
            <input id="dc-noi" type="number" min="0" step="1000" value="0"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
        </div>

        <!-- Auto-NOI inputs (shown by default — auto-compute is on) -->
        <div id="dc-noi-auto-wrap">
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Vacancy Rate (%)</span>
            <input id="dc-vacancy" type="number" min="0" max="50" step="0.5" value="7"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <p id="dc-op-example-note" role="note" style="margin:0 0 var(--sp2);padding:0.4rem 0.6rem;font-size:var(--tiny);background:rgba(217,119,6,.08);border-left:3px solid var(--warn,#d97706);border-radius:0 4px 4px 0;line-height:1.45;">
            The operating budget below is an <strong>invented example</strong> ($5,400 per unit per year before taxes and the reserve). Open each group to replace it with your project's figures. The groups and lines follow the Colorado Division of Housing (DOH) Housing Development Analysis spreadsheet.
          </p>
          <dl id="dc-op-totals" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.3rem .75rem;font-size:var(--small);margin:0 0 var(--sp1);">
            <dt>Operating expenses, per unit per year</dt><dd id="dc-op-total" style="margin:0;font-weight:700;font-variant-numeric:tabular-nums;">—</dd>
            <dt>With taxes and replacement reserve (DOH's per unit per year expenses)</dt><dd id="dc-op-pupa" style="margin:0;font-weight:700;font-variant-numeric:tabular-nums;">—</dd>
            <dt>Other income, per unit per year</dt><dd id="dc-op-income-total" style="margin:0;font-weight:700;font-variant-numeric:tabular-nums;">—</dd>
          </dl>
          <p id="dc-op-reason" role="status" hidden style="margin:0 0 var(--sp1);font-size:var(--small);color:var(--warn,#b45309);"></p>
          <label style="display:block;margin:0 0 var(--sp1);">
            <span style="font-size:var(--small);color:var(--muted);">Expense target someone gave you ($ per unit per year, optional; checked against the line items, never used in place of them)</span>
            <input id="dc-opex-target" type="number" min="0" step="50" placeholder="not entered" style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
          </label>
          <p id="dc-op-target-check" role="status" style="margin:0 0 var(--sp1);font-size:var(--small);line-height:1.45;"></p>
          <p id="dc-op-utilities-note" style="margin:0 0 var(--sp1);font-size:var(--tiny);color:var(--muted);line-height:1.45;"></p>
          <div id="dc-op-lines">${operatingBudgetHtml({ real_estate_taxes: `
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Real estate taxes ($ per unit per year)</span>
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
          `, replacement_reserve: `
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Replacement reserve ($ per unit per year)</span>
            <input id="dc-rep-reserve" type="number" min="0" step="25" value="350"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">CHFA minimum: $250–$400/unit/year</span>
          </label>
          ` })}</div>
          <div id="dc-noi-computed-display" style="padding:0.5rem 0.75rem;border-radius:var(--radius);background:color-mix(in oklab, var(--card,#fff) 80%, var(--accent,#096e65) 20%);font-size:var(--small);font-weight:600;">
            Computed Annual NOI: <span id="dc-noi-computed">—</span>
          </div>
        </div>
      </fieldset>

      <!-- Developer Fee -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Developer Fee</legend>
        <p style="font-size:var(--small);color:var(--muted);margin:0 0 var(--sp2);line-height:1.45;">
          The developer fee is the Developer fee line in Development Costs. CHFA tests the developer fee plus any consultant fee, before deferral, against its limit.
        </p>
        <div id="dc-cb-fee-tests" data-dc-mode="rental" role="status" style="font-size:var(--small);line-height:1.45;margin-bottom:var(--sp2);"></div>
        <label data-dc-mode="rental" style="display:flex;align-items:flex-start;gap:0.55rem;margin-bottom:var(--sp2);font-size:var(--small);cursor:pointer;min-height:44px;">
          <input id="dc-ioi" type="checkbox" style="width:1rem;height:1rem;margin-top:0.18rem;flex:0 0 auto;">
          <span>The builder has an identity of interest with the developer or owner (lowers CHFA's contractor fee limit)</span>
        </label>
        <label data-dc-mode="rental" style="display:flex;align-items:flex-start;gap:0.55rem;margin-bottom:var(--sp2);font-size:var(--small);cursor:pointer;min-height:44px;">
          <input id="dc-special-pop" type="checkbox" style="width:1rem;height:1rem;margin-top:0.18rem;flex:0 0 auto;">
          <span>The project serves people experiencing homelessness or special populations (CHFA then keeps all of an acquisition in the developer fee base)</span>
        </label>
        <label data-dc-mode="rental" style="display:flex;align-items:flex-start;gap:0.55rem;margin-bottom:var(--sp2);font-size:var(--small);cursor:pointer;min-height:44px;">
          <input id="dc-acq-42d2" type="checkbox" style="width:1rem;height:1rem;margin-top:0.18rem;flex:0 0 auto;">
          <span>Any existing building purchase meets 26 U.S.C. 42(d)(2): bought from an unrelated party, not placed in service during the ten years before you bought it, and rehabilitated enough to earn its own credit under 42(e) (needed before a purchase counts in basis)</span>
        </label>
        <label data-dc-mode="rental" style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Federal grant money that paid for the building purchase ($; needed when a grant covers both a purchase and other basis on a 9% deal, where the purchase earns 4% and the rest 9%, or under a basis boost, which skips the purchase)</span>
          <input id="dc-grant-acq" type="number" min="0" step="1000" placeholder="not entered"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
        </label>
        <label data-dc-mode="rental" style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Federal grant money that paid for costs outside eligible basis, such as land, reserves or fees above CHFA's limits ($; enter 0 if none; a federal grant reduces basis only by what it paid for in basis)</span>
          <input id="dc-grant-outside" type="number" min="0" step="1000" placeholder="not entered"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-height:44px;">
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

      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Sizing</legend>
        <label style="display:block;">Senior loan amount mode
          <select id="dc-senior-mode" style="width:100%;min-height:44px;"><option value="sized">Size from NOI and target DCR</option><option value="entered">Enter loan amount</option></select>
        </label>
        <label style="display:block;">First mortgage loan type (DOH)
          <select id="dc-senior-lender-type" style="width:100%;min-height:44px;">${lenderTypeOptions('C')}</select>
        </label>
        <label style="display:block;">Entered senior amount ($)
          <input id="dc-senior-amount" type="number" min="0" step="1000" value="" style="width:100%;min-height:44px;">
        </label>
        <label style="display:block;">Senior repayment type
          <select id="dc-senior-type" style="width:100%;min-height:44px;">${loanTypeOptions('amortizing')}</select>
        </label>
        <label style="display:block;">Maturity (years)
          <input id="dc-senior-maturity" type="number" min="1" max="50" step="1" value="35" style="width:100%;min-height:44px;">
        </label>
        <label style="display:block;">Interest-only years (before amortization)
          <input id="dc-senior-io-years" type="number" min="0" max="49" step="1" value="2" style="width:100%;min-height:44px;">
        </label>
        <label style="display:block;">Priority (1 paid first)
          <input id="dc-senior-priority" type="number" min="1" max="12" step="1" value="1" style="width:100%;min-height:44px;">
        </label>
        <label style="display:block;">Residual cash-flow share (%) — contingent loans only
          <input id="dc-senior-cfpay" type="number" min="0" max="100" step="1" value="100" style="width:100%;min-height:44px;">
        </label>


        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Debt Coverage Ratio (DCR)</span>
          <input id="dc-dcr" type="number" min="1.05" max="2.0" step="0.05" value="1.20"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Interest Rate (%)</span>
          <input id="dc-rate" type="number" min="3" max="12" step="0.01" value="6.5"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>
        <!-- Perm-rate hint: FRED 10-year Treasury + a stated spread, wired by
             _initFreddieBenchmark() at module init. Outside the label above so
             its own spread input is not a second control of that label. -->
        <div id="dc-freddie-benchmark" style="margin:-0.3rem 0 var(--sp2);font-size:.8125rem;color:var(--muted);line-height:1.4;"></div>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Amortization (years)</span>
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
      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Soft Funding Stack</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Stack up to 5 subordinate sources (CHFA HTF, Prop 123, local PHA, sponsor loan, impact fees, etc.).
          Choose the repayment obligation for each loan; grants reduce eligible basis under §42(d)(5)(A) and fill the gap at closing.
        </p>
        <!-- #1937: HB26-1065 Transit Zone credit. Informational only: it adds
             nothing to the stack, and shows only for an exact site with
             supported THIZ program evidence (setTransitZoneContext). -->
        <div id="dc-tz-note" data-tz-context="none" hidden
          style="margin:0 0 var(--sp2);padding:var(--sp2);border-left:3px solid var(--accent);background:var(--bg2);font-size:var(--small);line-height:1.45;"></div>
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
            ▸ Soft-funding program reference (descriptions + links)
          </summary>
          <div id="dc-soft-funding-ref-list" style="margin-top:var(--sp2);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px, 100%),1fr));gap:var(--sp2) var(--sp3);font-size:var(--small);"></div>
        </details>
        <div id="dc-funding-context-card" data-funding-context-surface="deal-calculator" hidden style="margin-top:var(--sp3);"></div>
      </fieldset>
    </div>

    <!-- LIHTC Pro Forma column (R4)
         All performance-side outputs: credit, mortgage sizing, DSCR /
         stress tests, rent achievability, peer deals, plus the
         Methodology & Formulas panel (collapsed by default).
         Sources & Uses + Year-15 Exit live in the Capital Stack column
         to the right at desktop widths. -->
    <div id="dc-pro-forma-col" style="min-width:0;">
      <h3 style="font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        <span data-dc-mode="rental">LIHTC Pro Forma</span><span data-dc-mode="ownership" hidden>Ownership Feasibility</span>
      </h3>

      <!-- Methodology & Formulas — collapsed by default. Shows every formula
           the calculator uses with the current numbers substituted in, plus
           inline-editable tunable constants for non-standard underwriting
           boxes (e.g. a bank using 28 % rent burden, or a lender using
           tighter stress percentages). -->
      <details id="dc-formulas-panel" data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);background:var(--bg2);">
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
            <strong style="display:block;margin-bottom:0.25rem;">1. Monthly gross rent ceiling (2BR example)</strong>
            <p id="dc-rent-limit-formula"></p>
            <div style="margin-top:0.4rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <label for="dc-const-rent-burden" style="font-size:var(--tiny);color:var(--muted);">Rent burden:</label>
              <input id="dc-const-rent-burden" disabled aria-describedby="dc-rent-burden-help" type="number" min="20" max="50" step="1" value="30"
                style="width:5rem;padding:0.25rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);font-size:var(--small);"> <span style="font-size:var(--tiny);color:var(--muted);">%</span>
              <span id="dc-formula-ceiling-eg" style="font-size:var(--tiny);color:var(--muted);margin-left:auto;">—</span>
            </div>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;line-height:1.5;">
              <span id="dc-rent-burden-help"></span><br>
              The non-CHFA formula uses HUD Income Limits: Studio = 1 person, 1BR = average of 1 and 2,
              2BR = 3, 3BR = 4-person × 1.04, and 4BR = 4-person × 1.16.
              <a href="https://www.huduser.gov/portal/datasets/il.html" target="_blank" rel="noopener">HUD household-size adjustments</a>.
              This formula is not a published program limit.<br>
              <strong>Gross vs net rent:</strong> these are GROSS rent ceilings
              (published for CHFA or calculated for other AMI restrictions). Tenant-paid NET rent = gross − utility
              allowance, published per-jurisdiction by HUD or the local PHA.
              The pro forma below uses gross rent as a conservative ceiling;
              real underwriting subtracts UA.
              <br>
              <strong>Middle-income bands:</strong> 110% and 120% AMI are shown
              as planning bands for Colorado's Middle Income Housing Tax Credit
              (MIHTC, 80–120% AMI) and Prop 123 context; this calculator does
              not size MIHTC credits. They are not federal LIHTC-credit-eligible and are excluded from
              qualified basis and annual credit calculations.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">2. Annual gross rents</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              gross_rents = Σ<sub>tier ∈ {30,40,50,60,70,80,100,110,120}</sub> ( units_at_tier × ceiling<sub>tier</sub> × 12 )
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
              sized_mortgage = max(0, NOI ÷ DCR_target − must_pay_soft_service) ÷ senior_payment_constant
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              DCR target is an input above (default 1.20×; conservative lenders use 1.25×, aggressive 1.15×). The senior payment constant uses the stated repayment type (including payments after any interest-only period). Entered-amount mode retains your principal instead of sizing it.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">5. DSCR + stress scenarios</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;margin-bottom:0.35rem;">
              senior_DSCR = NOI ÷ senior_service; all_must_pay_DSCR = NOI ÷ total_required_service
            </code>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8125rem;background:var(--card);padding:0.4rem 0.5rem;border-radius:3px;line-height:1.7;">
              stress_NOI = (rents × rent_mult) × (1 − (vacancy + vac_delta)) − (opex × opex_mult) − reserve − tax
            </div>
            <div style="margin-top:0.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px, 100%),1fr));gap:0.5rem;">
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
            <div style="margin-top:0.25rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px, 100%),1fr));gap:0.5rem;">
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
              Units at 70%, 80%, 100%, 110%, and 120% AMI can contribute rent in the pro forma, but only ≤60% AMI rows contribute federal LIHTC qualified basis in this screening model.
            </p>
          </div>

          <div style="margin-bottom:var(--sp3);">
            <strong style="display:block;margin-bottom:0.25rem;">7. Sources &amp; Uses gap</strong>
            <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;background:var(--card);padding:0.15rem 0.45rem;border-radius:3px;display:inline-block;">
              gap = TDC − equity − supportable_mortgage − deferred_dev_fee − soft_sources
            </code>
            <p style="font-size:var(--tiny);color:var(--muted);margin:0.4rem 0 0;">
              Whatever's left after equity, perm debt, and deferred fee. Bridged by the tranches you enter under &ldquo;Soft Funding Stack&rdquo;. Each tranche is either a <strong>loan</strong> (amortized and repayable, so it carries debt service) or a <strong>grant</strong> (which reduces eligible basis under &sect;42(d)(5)(A)). An impact-fee <em>waiver</em> is a grant; an impact-fee <em>deferral</em> is a loan &mdash; enter it as one, with its rate and term, or the model will treat repayable money as free.
            </p>
          </div>

          <details style="margin-top:var(--sp3);font-size:var(--tiny);line-height:1.55;">
            <summary style="cursor:pointer;font-weight:600;">What the terms in these formulas mean</summary>
            <dl style="margin:0.5rem 0 0;display:grid;grid-template-columns:minmax(9rem,max-content) 1fr;gap:0.25rem 0.75rem;">
              <dt><code>tier_pct</code></dt><dd style="margin:0;">The income tier a home is priced for, such as 60% of AMI.</dd>
              <dt><code>MTSP_AMI</code></dt><dd style="margin:0;">HUD's income limit for tax-credit housing in the county, for the household size shown.</dd>
              <dt><code>rent_burden</code></dt><dd style="margin:0;">The share of income a household is assumed to spend on rent (30% is standard).</dd>
              <dt><code>units_at_tier</code></dt><dd style="margin:0;">How many homes are priced at that tier.</dd>
              <dt><code>gross_rents</code></dt><dd style="margin:0;">Total yearly rent if every home rents at its ceiling.</dd>
              <dt><code>opex</code></dt><dd style="margin:0;">Yearly operating expenses.</dd>
              <dt><code>rep_reserve</code></dt><dd style="margin:0;">Money set aside each year for future repairs and replacements.</dd>
              <dt><code>net_property_tax</code></dt><dd style="margin:0;">Property tax after any exemption.</dd>
              <dt><code>DCR_target</code></dt><dd style="margin:0;">The minimum ratio of NOI to mortgage payments the lender requires.</dd>
              <dt><code>mortgage_constant</code></dt><dd style="margin:0;">The yearly mortgage payment per dollar borrowed, set by the rate and term.</dd>
              <dt><code>annual_debt_service</code></dt><dd style="margin:0;">Total mortgage payments for the year.</dd>
              <dt><code>rent_mult</code>, <code>opex_mult</code>, <code>vac_delta</code></dt><dd style="margin:0;">The stress-test settings: how far rents drop, how much expenses rise, and how many points vacancy rises.</dd>
              <dt><code>eligible_basis</code></dt><dd style="margin:0;">The share of development cost that tax credits can be claimed on.</dd>
              <dt><code>credit_rate</code></dt><dd style="margin:0;">The yearly credit percentage: 9% (competitive) or about 4%.</dd>
              <dt><code>equity_price</code></dt><dd style="margin:0;">What the investor pays for each $1 of tax credit.</dd>
              <dt><code>supportable_mortgage</code></dt><dd style="margin:0;">The largest first mortgage the project's income can carry (formula 4).</dd>
              <dt><code>deferred_dev_fee</code></dt><dd style="margin:0;">Part of the developer fee left in the deal and paid later from cash flow.</dd>
              <dt><code>soft_sources</code></dt><dd style="margin:0;">Grants and low-cost loans entered under the Soft Funding Stack.</dd>
            </dl>
          </details>

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
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;"><span data-dc-mode="rental">LIHTC Credit Estimates</span><span data-dc-mode="ownership" hidden>For-Sale Ownership Feasibility</span> <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(screening-level)</span></legend>

        <div data-dc-mode="rental">
        <!-- Adjacent-to-headline disclaimer (per methodology-gaps deep-dive):
             the "Screening tool only" note in the page intro is easy to miss
             once a user is staring at a 7-figure equity number. Repeat the
             framing right next to the headline outputs so it stays in view. -->
        <p role="note" style="margin:0 0 var(--sp2);padding:0.4rem 0.6rem;font-size:var(--tiny);background:rgba(217,119,6,.08);border-left:3px solid var(--warn,#d97706);border-radius:0 4px 4px 0;color:var(--text);line-height:1.45;">
          <strong style="color:var(--warn,#d97706);">⚠ Screening estimate, not underwriting.</strong>
          The equity figure below uses your itemized costs (or the invented example budget) and public assumptions for equity pricing. Real syndicator pricing varies ±3-8¢/credit by deal characteristics — confirm with your investor before relying on this number for site control or capital-stack decisions.
        </p>

        <dl id="dc-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Qualified Basis</dt>
          <dd id="dc-r-basis" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Credit capacity (annual)</dt>
          <dd id="dc-cb-capacity" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Credit requested (annual)</dt>
          <dd id="dc-cb-requested" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Credit awarded (annual)</dt>
          <dd id="dc-cb-awarded" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Tax Credits used for equity</dt>
          <dd id="dc-r-credits" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">10-Year Credit Equity</dt>
          <dd id="dc-r-equity" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Est. Annual Rent Revenue</dt>
          <dd id="dc-r-rents" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-cb-credit-note" role="status" style="font-size:var(--tiny);line-height:1.45;margin:.35rem 0 0;"></p>
        <details id="dc-cb-panel" data-dc-mode="rental" style="margin-top:var(--sp2);border:1px solid var(--border);border-radius:var(--radius);padding:.5rem .75rem;background:var(--bg2);">
          <summary style="cursor:pointer;min-height:44px;font-weight:700;font-size:var(--small);">How basis and credit were calculated</summary>
          <div id="dc-cb-detail" style="font-size:var(--small);line-height:1.45;"></div>
        </details>
        <p id="dc-rent-allowance-status" role="status" aria-live="polite" style="font-size:var(--tiny);line-height:1.45;"></p>
        <p id="dc-allowance-local-notice" role="status" hidden style="font-size:var(--tiny);"></p>
        <p id="dc-gap-note" style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);display:none;"></p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Verify: Annual credits and equity are illustrative — confirm equity pricing with your syndicator
          (compare the Novogradac benchmark shown under Credit Pricing). Gross rents follow the selected rent-limit setting;
          the rent comparison names its source and year. Spot-check against current market rents before underwriting.
        </p>
        </div>

        <div id="dc-ownership-feasibility" data-dc-mode="ownership" hidden style="margin-top:var(--sp3);padding:var(--sp2);border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <p id="dc-own-actor-legend" style="margin:0 0 .5rem;font-size:var(--tiny);color:var(--muted);line-height:1.45;">
            Each row names whose money it describes.
            <strong>Resident</strong>: the household at the target AMI.
            <strong>Developer / operator</strong>: the project's cost side.
            <strong>Bridge</strong>: the gap between the two, which public subsidy must fill.
            <strong>Public interest</strong>: the steward's claim on the home and its resale proceeds.
          </p>
          <dl id="dc-own-rows" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0.45rem 0.75rem;font-size:var(--small);margin:0;">
            <dt data-actor="developer" style="color:var(--muted);">Development cost / unit <span class="dc-own-actor" data-actor="developer">Developer / operator</span></dt>
            <dd id="dc-own-cost-per-unit" style="font-weight:700;text-align:right;">—</dd>

            <dt data-actor="developer" style="color:var(--muted);">Development cost / gross SF <span class="dc-own-actor" data-actor="developer">Developer / operator</span></dt>
            <dd id="dc-own-cost-per-sf" style="font-weight:700;text-align:right;">—</dd>

            <dt data-actor="resident" style="color:var(--muted);">Max affordable sale price (<span id="dc-own-target-label">80% AMI</span>) <span class="dc-own-actor" data-actor="resident">Resident</span></dt>
            <dd id="dc-own-max-price" style="font-weight:700;text-align:right;">—</dd>

            <dt data-actor="bridge" style="color:var(--muted);">Subsidy gap / unit <span class="dc-own-actor" data-actor="bridge">Bridge: developer cost − resident capacity</span></dt>
            <dd id="dc-own-gap-per-unit" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

            <dt data-actor="bridge" style="color:var(--muted);">Total ownership gap <span class="dc-own-actor" data-actor="bridge">Bridge</span></dt>
            <dd id="dc-own-total-gap" style="font-weight:700;text-align:right;">—</dd>

            <dt data-actor="public" style="color:var(--muted);">Public interest at resale (<span id="dc-own-public-convention">selected mechanism</span>, moderate scenario) <span class="dc-own-actor" data-actor="public">Public interest</span></dt>
            <dd id="dc-own-public-recovery" style="font-weight:700;text-align:right;">—</dd>
          </dl>
          <p id="dc-own-note" style="margin:.45rem 0 0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">
            Select a county to load HUD AMI and price the ownership affordability limit.
          </p>
          <p data-actor="resident" style="margin:.55rem 0 0;font-weight:700;font-size:var(--tiny);color:var(--text);">Resident over time <span class="dc-own-actor" data-actor="resident">Resident</span></p>
          <p style="margin:.1rem 0 0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">Equity the household builds while it owns the home. These inputs drive the resale screen below.</p>
          <div data-actor="resident" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;margin-top:.35rem;font-size:var(--tiny);">
            <label>Holding period (years)
              <input id="dc-own-resale-years" type="number" min="0" step="1" value="5" style="width:100%;margin-top:.15rem;">
            </label>
            <label>Est. remaining principal
              <input id="dc-own-resale-principal" type="number" min="0" step="1000" placeholder="0" style="width:100%;margin-top:.15rem;">
            </label>
            <label>Selling costs
              <input id="dc-own-resale-costs" type="number" min="0" step="1000" placeholder="0" style="width:100%;margin-top:.15rem;">
            </label>
            <label>Shared-appreciation assumption
              <input id="dc-own-resale-appreciation" type="number" step="1000" placeholder="0" style="width:100%;margin-top:.15rem;">
            </label>
          </div>
          <div id="dc-own-resale-screen" data-actor="public" style="margin-top:.45rem;border-top:1px solid var(--border);padding-top:.45rem;">
            <p style="margin:0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">
              Resale convention screen loads after source data.
            </p>
          </div>
          <div id="dc-own-funding-stack" data-actor="developer" style="margin-top:.45rem;border-top:1px solid var(--border);padding-top:.45rem;">
            <p style="margin:0;font-size:var(--tiny);color:var(--muted);line-height:1.45;">
              Developer ownership funding stack loads after source data.
            </p>
          </div>
        </div>

        <!-- F257-6 — Development budget breakdown (typical shares). The
             headline outputs above show the equity raised but not what
             the total dev cost is going toward. The block below back-
             solves into the typical line items so the user can see what
             portion of TDC each represents. Shares are CHFA-typical for
             a new-construction 9% deal in Colorado; vary by site
             conditions and project type. -->
        <details id="dc-budget-breakdown-wrap" data-dc-mode="rental" style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:.55rem .75rem;background:var(--bg2);">
          <summary style="cursor:pointer;font-weight:700;font-size:var(--small);">Development Budget — from your cost lines</summary>
          <p style="margin:.45rem 0 .35rem;font-size:var(--tiny);color:var(--muted);line-height:1.5;">
            Totals of the cost lines entered in Development Costs. The contractor contract is one of these groups, counted once.
          </p>
          <dl id="dc-budget-breakdown" style="display:grid;grid-template-columns:1fr auto auto;gap:.4rem 1rem;font-size:var(--small);margin:.35rem 0 .35rem;"></dl>
        </details>

        <!-- F257-6 — "How to adjust" advisory. Surfaces 2-3 levers the
             user can pull when the calculated gap is wide or the deal
             is otherwise marginal. Updated live by recalculate(). -->
        <div id="dc-adjust-guidance" data-dc-mode="rental" hidden role="note"
          style="margin-top:var(--sp3);padding:.6rem .75rem;border:1px solid var(--accent);border-left-width:4px;border-radius:var(--radius);background:color-mix(in oklab,var(--card) 85%,var(--accent) 15%);font-size:var(--small);line-height:1.5;">
          <div style="font-weight:700;color:var(--accent);margin-bottom:.25rem;">How to adjust for a better fit</div>
          <ul id="dc-adjust-guidance-list" style="margin:.25rem 0 0;padding-left:1.2rem;"></ul>
        </div>

        <!-- F257-7 — Building type / amenities / operating expense
             reference card. Informational; doesn't modify the live
             pro-forma calculation. The cost-per-unit ranges are
             Colorado-typical for 2026 new-construction at moderate
             complexity and are not from a published source — they
             are a screening sanity check, not an underwriting
             reference. -->
        <details id="dc-design-reference" data-dc-mode="rental" style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:.55rem .75rem;background:var(--bg2);">
          <summary style="cursor:pointer;font-weight:700;font-size:var(--small);">Building type, amenities, and expenses — reference</summary>
          <p style="margin:.45rem 0 .35rem;font-size:var(--tiny);color:var(--muted);line-height:1.5;">
            How design and operating choices typically affect the LIHTC pro-forma. None of these inputs auto-adjust the calculation above — they are CHFA-aligned planning context for sponsor + GC conversations.
          </p>
          <div style="font-size:var(--small);line-height:1.55;">
            <div style="font-weight:700;color:var(--accent);margin:.55rem 0 .25rem;">Construction type → per-unit cost (CO, 2026, planning band)</div>
            <ul style="margin:.15rem 0 .35rem;padding-left:1.2rem;">
              <li><strong>Townhome / duplex / fourplex:</strong> ~$220–$290k/unit. Lowest entitlement friction; suited to small-town and missing-middle sites.</li>
              <li><strong>3-story walk-up garden:</strong> ~$240–$310k/unit. Most-common LIHTC type in CO outside the metro core; no elevator or sprinkler-design upgrade.</li>
              <li><strong>4-story Type V over podium:</strong> ~$290–$370k/unit. Adds elevator + commercial-grade life-safety; common in mid-density suburban infill.</li>
              <li><strong>5-story Type III mid-rise:</strong> ~$340–$430k/unit. Urban infill where land cost is high; full sprinklered + structured parking.</li>
            </ul>
            <div style="font-weight:700;color:var(--accent);margin:.55rem 0 .25rem;">Amenities under CHFA QAP Section 5</div>
            <p style="margin:.1rem 0 .35rem;">CHFA's QAP awards amenity points in several categories — confirm current values in the latest QAP before relying on these for scoring:</p>
            <ul style="margin:.15rem 0 .35rem;padding-left:1.2rem;">
              <li><strong>Energy efficiency / green building</strong> is a requirement, not points: every project must certify under Enterprise Green Communities, LEED or NGBS (QAP Section 8: &ldquo;CHFA requires all projects to obtain green building certification&rdquo;). All-electric or a higher-level certification (DOE Efficient New Homes, PHIUS or PHI; the 2027-28 draft adds EGC+) is &ldquo;considered more competitive&rdquo; under a Guiding Principle. Budget the certification and consultant in hard and soft costs. See <a href="green-building-guide.html">Green Building in a Colorado Deal</a> for which program fits which deal and how efficiency lowers the utility allowance.</li>
              <li><strong>Universal design / accessibility</strong> beyond Code (Type A and Type B units, full visitability, sensory units) — usually scored.</li>
              <li><strong>Resident services</strong> aligned with the population served (financial literacy, after-school, supportive-services partnerships).</li>
              <li><strong>Community amenities</strong> (community room, on-site computer lab, gardens, playground, transit access).</li>
            </ul>
            <p style="margin:.1rem 0 .35rem;font-size:var(--tiny);color:var(--muted);">
              Reference: <a href="https://www.chfainfo.com/getattachment/7535845e-c0fa-4061-9bcb-60d7158ea294/2025-2026-QAP-Second-Amendment.pdf" target="_blank" rel="noopener">CHFA 2025-26 QAP Second Amendment</a>, Section 5 Scoring Criteria.
            </p>
            <div style="font-weight:700;color:var(--accent);margin:.55rem 0 .25rem;">Operating expenses (PUPA — per-unit per-annum)</div>
            <ul style="margin:.15rem 0 .35rem;padding-left:1.2rem;">
              <li><strong>Family family (Type V) — CO planning range:</strong> ~$5,800–$7,400 PUPA.</li>
              <li><strong>Senior family (Type V) — CO planning range:</strong> ~$5,200–$6,800 PUPA.</li>
              <li><strong>Permanent supportive housing:</strong> ~$7,500–$9,500 PUPA (services + 24/7 staffing).</li>
              <li><strong>Mid-rise / Type III:</strong> add ~$400–$700 PUPA over the Type V baseline for elevator + life-safety maintenance.</li>
            </ul>
            <p style="margin:.1rem 0 .25rem;font-size:var(--tiny);color:var(--muted);">
              Operating expenses are the largest swing factor in supportable NOI. CHFA's market study guide directs underwriters to compare proposed expenses against current peer-property data in the PMA. The supportable-mortgage estimate above uses a single OpEx assumption; for sponsor-level work, expense PUPA should be tightened against the specific building type and management plan.
            </p>
          </div>
        </details>
      </fieldset>

      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Supportable First Mortgage <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(estimate · screening-level)</span></legend>
        <dl id="dc-mortgage-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Mortgage Constant (annual)</dt>
          <dd id="dc-r-mc" style="font-weight:700;text-align:right;">—</dd>

          <dt id="dc-mortgage-label" style="color:var(--muted);">Supportable First Mortgage</dt>
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
      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Service Coverage &amp; Stress Tests</legend>
        <p id="dc-noi-allowance-status" role="status" aria-live="polite" style="font-size:var(--tiny);line-height:1.45;"></p>
        <dl id="dc-dscr-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);"><abbr data-glossary="NOI">NOI</abbr> (stabilized, annual)</dt>
          <dd id="dc-r-noi-stab" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Debt Service</dt>
          <dd id="dc-r-ads" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Senior <abbr data-glossary="DSCR">DSCR</abbr> (1st mortgage, stabilized)</dt>
          <dd id="dc-r-dscr-base" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-dscr-target-note" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);margin-bottom:var(--sp2);">—</p>
        <p>All must-pay coverage: <strong id="dc-all-must-pay-dscr">Unavailable</strong></p>
        <p id="dc-loan-coverage" role="status" aria-live="polite" aria-atomic="true" style="font-size:var(--small);"></p>

        <table id="dc-dscr-stress-table" style="width:100%;border-collapse:collapse;font-size:var(--small);margin-top:var(--sp2);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Stress Scenario</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Annual Stressed NOI</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">DSCR</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">vs target</th>
            </tr>
          </thead>
          <tbody>
            <tr data-scenario="base"><td>Base / stabilized</td><td id="dc-stress-base-noi" style="text-align:right;">—</td><td id="dc-stress-base-dscr" style="text-align:right;">—</td><td id="dc-stress-base-margin" style="text-align:right;">—</td></tr>
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
        <p style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);margin-bottom:0;">
          Each stress row lowers NOI and keeps every must-pay loan payment at its base amount, so the coverage
          shown is what the committed loans would face. A lender resizing the loan to the stressed NOI would lend less instead.
        </p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Banker / syndicator rule of thumb: conservative lenders want DSCR ≥ 1.15 under a moderate stress scenario
          and DSCR ≥ 1.10 under combined stress. A deal that falls below 1.00 under the combined case may need
          additional credit enhancement, a lower DCR sizing target, or a smaller loan.
        </p>
      </fieldset>

      <!-- Rent Achievability Check -->
      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Rent Achievability Check</legend>
        <p id="dc-rent-ach-intro" style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Compares the selected rent ceilings (at each AMI tier) against the county's HUD FMR 2BR market rent.
          When the ceiling exceeds market rent, proforma revenue at the ceiling is over-stated and the
          deal's actual DSCR will come in below underwriting.
        </p>
        <table id="dc-rent-ach-table" style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <caption id="dc-rent-limit-caption" style="text-align:left;" aria-live="polite"></caption>
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">AMI Tier</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Rent ceiling</th>
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
          <div style="font-size:var(--tiny);color:var(--muted);font-weight:600;margin-bottom:0.35rem;">HUD FMR by bedroom size (FY2027, gross rent $USD/mo)</div>
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
          <span id="dc-rent-limit-example"></span><br>HUD FMR is the 40th-percentile
          market rent for the area and lags ~18 mo. For a binding market-rent test, commission a rent comparability study
          before closing. Source:
          <a href="https://www.huduser.gov/portal/datasets/fmr.html" target="_blank" rel="noopener">HUD FMR FY2027</a>.
        </p>
      </fieldset>

      <!-- Peer Deals — comparable LIHTC projects in same county + credit type -->
      <fieldset data-dc-mode="rental" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
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
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Award year</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Units</th>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Flags</th>
            </tr>
          </thead>
          <tbody id="dc-peers-body">
            <tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Select a county to see peer deals.</td></tr>
          </tbody>
        </table>
        <p id="dc-peers-empty" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);margin-bottom:0;display:none;"></p>
        <p id="dc-peers-flag-note" style="font-size:var(--tiny);color:var(--muted);font-style:italic;margin-top:var(--sp2);margin-bottom:0;display:none;"></p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ HUD LIHTC DB does not publish per-project TDC, equity pricing, or stabilized DSCR — those come from syndicator filings (private). What you see here: project name, the year CHFA awarded the credits (not the year the property opened — CHFA publishes no placed-in-service year, and projects typically open two to three years after award), total units, QCT/DDA/non-profit flags. Use as a sanity-check for unit-count and credit-type fit, not as a financial benchmark.
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
    <div id="dc-capital-stack-col" data-dc-mode="rental" style="min-width:0;">
      <h3 style="font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 var(--sp2);padding:0 .15rem .35rem;border-bottom:1px solid var(--border);">
        Capital Stack &amp; Exit
      </h3>

      <!-- Sources & Uses Panel -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Sources &amp; Uses Summary</legend>
        <table id="dc-su-table" data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);">
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
              <td style="padding:0.3rem 0.25rem;">Federal credit equity</td>
              <td id="dc-su-equity" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-equity-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr id="dc-su-state-row" hidden>
              <td style="padding:0.3rem 0.25rem;">State credit equity</td>
              <td id="dc-su-state" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-state-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr id="dc-su-added-row" hidden>
              <td id="dc-su-added-label" style="padding:0.3rem 0.25rem;">Added credit equity</td>
              <td id="dc-su-added" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-added-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr id="dc-su-credit-note-row" hidden>
              <td id="dc-su-credit-note" colspan="3" style="padding:0 0.25rem 0.3rem;font-size:var(--tiny);color:var(--muted);"></td>
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

      <!-- DOH PR 3 — Permanent financing in the Division of Housing layout.
           Regroups the sources above; it changes no result. -->
      <fieldset id="dc-pf-doh" data-no-source="calculator output: regroups the inputs and sources above" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Permanent Financing (Colorado DOH layout)</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);line-height:1.45;">
          The same sources as above, grouped as the Colorado Division of Housing (DOH) application's Permanent Financing Sources tab groups them.
          Set each soft-funding tranche's group under "Counts in DOH's sources as".
        </p>
        <p id="dc-pf-reason" role="status" hidden style="margin:0 0 var(--sp2);font-size:var(--small);color:var(--warn,#b45309);"></p>
        <div style="overflow-x:auto;"><table id="dc-pf-table" data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead><tr>
            <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Financing source</th>
            <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Total</th>
            <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">% of TDC</th>
          </tr></thead>
          <tbody id="dc-pf-rows"></tbody>
        </table></div>
        <details style="margin-top:var(--sp2);">
          <summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:var(--small);font-weight:700;">Hard mortgages and coverage</summary>
          <div id="dc-pf-mortgages" style="font-size:var(--small);"></div>
          <dl id="dc-pf-coverage" style="display:grid;grid-template-columns:1fr auto;gap:0.2rem var(--sp2);margin:var(--sp2) 0 0;font-size:var(--small);"></dl>
        </details>
        <details style="margin-top:var(--sp2);">
          <summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:var(--small);font-weight:700;">Maximum loan by value (DOH quick calculation)</summary>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">Beside sizing by coverage: value at a cap rate, or an appraised value, times a loan-to-value ratio. Leave blank to skip.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--sp2);">
            <label style="font-size:var(--small);color:var(--muted);">Cap rate (%)<input id="dc-pf-cap-rate" type="number" min="0" max="20" step="0.05" value="" style="display:block;width:100%;min-height:44px;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
            <label style="font-size:var(--small);color:var(--muted);">Loan-to-value on cap-rate value (%)<input id="dc-pf-cap-lvr" type="number" min="0" max="100" step="1" value="" style="display:block;width:100%;min-height:44px;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
            <label style="font-size:var(--small);color:var(--muted);">Appraised value ($)<input id="dc-pf-appraised" type="number" min="0" step="10000" value="" style="display:block;width:100%;min-height:44px;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
            <label style="font-size:var(--small);color:var(--muted);">Loan-to-value on appraised value (%)<input id="dc-pf-appraised-lvr" type="number" min="0" max="100" step="1" value="" style="display:block;width:100%;min-height:44px;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
          </div>
          <dl id="dc-pf-maxloan" style="display:grid;grid-template-columns:1fr auto;gap:0.2rem var(--sp2);margin:var(--sp2) 0 0;font-size:var(--small);"></dl>
        </details>
      </fieldset>

      <!-- DOH PR 4: DOH's Permanent Sources & Uses Budget, by activity. Each
           soft source says what it pays for; the rest pay for the whole project. -->
      <fieldset id="dc-act-doh" data-no-source="calculator output: regroups the inputs and sources above" style="min-width:0;border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Sources and uses by activity (DOH layout)</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">Each cost category's cost and the soft sources that pay for it. Choose what a source pays for, its status and whether it is a state request on its row under Soft Funding Stack. Tax credit equity, the first mortgage and the deferred fee pay for the project as a whole.</p>
        <p id="dc-act-reason" role="status" hidden style="margin:0 0 var(--sp2);font-size:var(--small);color:var(--warn,#b45309);"></p>
        <p id="dc-act-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
        <div style="overflow-x:auto;"><table id="dc-act-table" data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:0.3rem 0.25rem;color:var(--muted);text-transform:none;letter-spacing:normal;">Activity and sources</th>
            <th scope="col" style="text-align:right;padding:0.3rem 0.25rem;color:var(--muted);text-transform:none;letter-spacing:normal;">Total cost</th>
            <th scope="col" style="text-align:right;padding:0.3rem 0.25rem;color:var(--muted);text-transform:none;letter-spacing:normal;">State funds</th>
            <th scope="col" style="text-align:right;padding:0.3rem 0.25rem;color:var(--muted);text-transform:none;letter-spacing:normal;">Other funds</th>
          </tr></thead>
          <tbody id="dc-act-rows"></tbody>
        </table></div>
      </fieldset>

      <!-- DOH PR 4: DOH's 15-Year Operating Proforma rows, from the engine's
           projection and loan schedule. -->
      <fieldset id="dc-doh15" data-no-source="calculator output: regroups the inputs and sources above" style="min-width:0;border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">15-year operating pro forma (DOH layout)</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">Cash left after the mortgages and any bridge loan pays the asset management fee first, then cash-flow loans, then the deferred developer fee. Rent and expense growth are the Operating Pro Forma Projection's.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--sp2);margin-bottom:var(--sp2);">
          <label style="font-size:var(--small);color:var(--muted);">Asset management fee, year 1 ($/yr)<input id="dc-asset-mgmt-fee" type="number" min="0" step="500" value="0" style="display:block;width:100%;min-height:44px;box-sizing:border-box;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
          <label style="font-size:var(--small);color:var(--muted);">Asset management fee increase (%/yr)<input id="dc-asset-mgmt-growth" type="number" min="0" max="10" step="0.5" value="3" style="display:block;width:100%;min-height:44px;box-sizing:border-box;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
          <label style="font-size:var(--small);color:var(--muted);">Bridge-loan debt service ($/yr)<input id="dc-bridge-ds" type="number" min="0" step="1000" value="0" style="display:block;width:100%;min-height:44px;box-sizing:border-box;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
          <label style="font-size:var(--small);color:var(--muted);">Years of bridge-loan payments<input id="dc-bridge-years" type="number" min="0" max="50" step="1" value="0" style="display:block;width:100%;min-height:44px;box-sizing:border-box;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);"></label>
        </div>
        <p id="dc-doh15-reason" role="status" hidden style="margin:0 0 var(--sp2);font-size:var(--small);color:var(--warn,#b45309);"></p>
        <p id="dc-doh15-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
        <dl id="dc-doh15-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.2rem var(--sp2);margin:0 0 var(--sp2);font-size:var(--small);"></dl>
        <details>
          <summary style="cursor:pointer;min-height:44px;font-size:var(--small);">Year-by-year rows and totals</summary>
          <div style="overflow-x:auto;"><table id="dc-doh15-table" data-no-sort style="border-collapse:collapse;font-size:var(--small);white-space:nowrap;"></table></div>
          <div style="overflow-x:auto;margin-top:var(--sp2);"><table id="dc-doh15-totals" data-no-sort style="width:100%;border-collapse:collapse;font-size:var(--small);"></table></div>
        </details>
      </fieldset>

      <!-- L6 — Year-15 exit analysis. Closes the IC packet: resale value
           at hold-period end, remaining debt balances, net sale proceeds,
           deferred-fee payback timing, return on the deferred fee. -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Exit Analysis at the End of the Hold Period</legend>
        <p style="font-size:var(--tiny);color:var(--muted);margin:0 0 var(--sp2);">
          Projects a sale at the end of the hold period you enter below (15 years unless changed). NOI growth
          and expense inflation use the same rates as the pro forma. Resale value capitalizes the final hold
          year's NOI, not the next year's, at the exit cap rate, before selling costs.
        </p>
        <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:var(--sp2);margin-bottom:var(--sp2);">
          <label style="font-size:var(--small);color:var(--muted);">
            Hold period (years)
            <input id="dc-exit-hold" type="number" min="5" max="30" step="1" value="15"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <label style="font-size:var(--small);color:var(--muted);">
            Exit cap rate (%)
            <input id="dc-exit-cap" type="number" min="3.0" max="12.0" step="0.05" value="6.5"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
        </div>
        <dl id="dc-exit-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 0.75rem;font-size:var(--small);margin:0;">
          <dt id="dc-exit-noi-label" style="color:var(--muted);">Year-N stabilized NOI</dt>
          <dd id="dc-exit-noi" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt id="dc-exit-resale-label" style="color:var(--muted);">Resale value (NOI ÷ exit cap)</dt>
          <dd id="dc-exit-resale" style="margin:0;text-align:right;font-weight:700;color:var(--accent);">—</dd>
          <dt style="color:var(--muted);">Remaining 1st mortgage balance</dt>
          <dd id="dc-exit-mortbal" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);">Remaining soft-loan balance</dt>
          <dd id="dc-exit-softbal" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--muted);font-weight:700;border-top:1px solid var(--border);padding-top:6px;">Net sale proceeds (before selling costs)</dt>
          <dd id="dc-exit-net" style="margin:0;text-align:right;font-weight:700;color:var(--good,#047857);border-top:1px solid var(--border);padding-top:6px;">—</dd>
          <dt style="color:var(--muted);">Deferred fee payback year</dt>
          <dd id="dc-exit-defyr" style="margin:0;text-align:right;font-weight:700;">—</dd>
          <dt style="color:var(--text);font-weight:700;">Sponsor's return on the deferred fee <a href="#dcWaterfallHeading" style="font-weight:400;">(from the partnership split)</a></dt>
          <dd id="dc-exit-sponsor-irr" style="margin:0;text-align:right;font-weight:700;color:var(--accent);">—</dd>
          <dt style="color:var(--muted);">Same fee, counting all partnership cash and sale proceeds (includes the investor's share)</dt>
          <dd id="dc-exit-irr" style="margin:0;text-align:right;font-weight:600;color:var(--muted);">—</dd>
        </dl>
        <p id="dc-exit-notes" style="font-size:var(--tiny);color:var(--muted);margin:var(--sp2) 0 0;line-height:1.5;"></p>
      </fieldset>
      ${window.DealLenderSchedulesView && window.DealLenderSchedulesView.panelHtml ? window.DealLenderSchedulesView.panelHtml() : ''}
    </div><!-- /#dc-capital-stack-col -->
  </div><!-- /#dc-calc-grid -->

  <!-- Collapsible Assumptions Panel -->
  <details data-dc-mode="rental" style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);">
    <summary style="font-size:var(--small);font-weight:700;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:0.4rem;">
      <span>&#9660;</span> Assumptions
    </summary>
    <div style="margin-top:var(--sp2);font-size:var(--small);">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp2) var(--sp3);">
        <label style="display:block;">
          <span style="color:var(--muted);">Credit Pricing ($/credit)</span>
          <input id="dc-equity-price" type="number" min="0.50" max="1.20" step="0.01" value="0.82"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          <p style="margin:.4rem 0;">Review benchmarks in <a data-workflow-link="deal-equity" href="article-pricing.html">Tax Credit Equity Markets</a>.</p>
          <!-- F230 — Novogradac equity pricing benchmark button. Populated
               by _initNovogradacBenchmark() below from data/market/novogradac-equity-pricing.json -->
          <div id="dc-novogradac-benchmark" style="margin-top:.3rem;font-size:.8125rem;line-height:1.4;color:var(--muted);"></div>
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
        QCT/DDA basis boost: <strong id="dc-assump-qct-status">not selected</strong>
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

    // The input is rendered after the browser's initial fragment navigation.
    if (window.location && window.location.hash === '#dc-equity-price') {
      var priceTarget = document.getElementById('dc-equity-price');
      priceTarget.closest('details').open = true;
      priceTarget.focus();
      if (priceTarget.scrollIntoView) priceTarget.scrollIntoView({ block: 'center' });
    }

    // Attach event listeners
    document.getElementById('dc-edit-unit-mix').addEventListener('click', editMixHere);
    const ids = ['dc-unit-mix-source', 'dc-unrepresented-schedule-rows', 'dc-tdc', 'dc-gross-sf', 'dc-res-sf', 'dc-restricted-sf', 'dc-boost-evidence', 'dc-boost-pct', 'dc-building-type', 'dc-units', 'dc-sale-target-ami',
      'dc-noi', 'dc-dcr', 'dc-rate', 'dc-term', 'dc-equity-price',
      'dc-pf-cap-rate', 'dc-pf-cap-lvr', 'dc-pf-appraised', 'dc-pf-appraised-lvr',
      'dc-asset-mgmt-fee', 'dc-asset-mgmt-growth', 'dc-bridge-ds', 'dc-bridge-years',
      'dc-senior-mode', 'dc-senior-lender-type', 'dc-senior-amount', 'dc-senior-type', 'dc-senior-maturity', 'dc-senior-io-years', 'dc-senior-priority', 'dc-senior-cfpay',
      'dc-vacancy', 'dc-rep-reserve', 'dc-prop-tax', 'dc-tax-exempt',
      'dc-own-resale-years', 'dc-own-resale-principal', 'dc-own-resale-costs',
      'dc-own-resale-appreciation', 'dc-gsf-standard', 'dc-gsf-efficiency',
      // (Per-tranche fields wired below via renderSoftTranches.)
    ];
    DEAL_AMI_BANDS.forEach(function (pct) {
      ids.push('dc-chk-' + pct, 'dc-units-' + pct, 'dc-br-' + pct);
      SPLIT_BR_TYPES.forEach(function (br) {
        ids.push('dc-units-' + pct + '-' + br);
      });
    });
    ['dc-market-rent-source'].concat(SPLIT_BR_TYPES.map(function (br) { return 'dc-market-rent-' + br; })).forEach(function (id) {
      document.getElementById(id).addEventListener('input', captureMarketOverrides);
    });
    ids.push('dc-market-rent-mode', 'dc-market-rent-source', 'dc-market-bedroom');
    SPLIT_BR_TYPES.forEach(function (br) { ids.push('dc-market-rent-' + br); });
    ['dc-market-rent-mode', 'dc-market-bedroom'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', recalculate);
    });
    var gsfApply = document.getElementById('dc-gsf-apply');
    if (gsfApply) gsfApply.addEventListener('click', applyGrossSfEstimate);
    var gsfField = document.getElementById('dc-gross-sf');
    if (gsfField) gsfField.addEventListener('input', clearGrossSfDerivation);
    var gsfEff = document.getElementById('dc-gsf-efficiency');
    if (gsfEff) gsfEff.addEventListener('input', function () { gsfEff.dataset.userSet = '1'; });
    ['dc-credit-requested', 'dc-credit-awarded', 'dc-state-annual', 'dc-state-standard-annual', 'dc-state-price', 'dc-ioi', 'dc-special-pop', 'dc-acq-42d2', 'dc-grant-acq', 'dc-grant-outside', 'dc-state-awarded', 'dc-state-path', 'dc-state-fees',
      'dc-add-kind', 'dc-add-evidence', 'dc-add-annual', 'dc-add-years', 'dc-add-price', 'dc-add-fees', 'dc-add-program-year',
      'dc-add-mode', 'dc-add-displaces', 'dc-add-displaced-annual', 'dc-add-fed-cut',
      'dc-bond-amount', 'dc-constr-loan', 'dc-constr-rate', 'dc-constr-months', 'dc-constr-draw', 'dc-opex-target']
      .concat(['fed', 'state', 'add'].reduce(function (acc, src) {
        return acc.concat(['closing', 'completion', 'stabilization'].map(function (st) { return 'dc-' + src + '-payin-' + st; }));
      }, [])).forEach(function (id) { ids.push(id); });
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
    });
    ['dc-ioi', 'dc-special-pop', 'dc-acq-42d2', 'dc-state-awarded', 'dc-state-path', 'dc-add-kind', 'dc-add-mode', 'dc-add-displaces', 'dc-bond-post2025'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', recalculate);
    });
    // #2160: cost lines. A partly eligible line shows its eligible-part field.
    var costHost = document.getElementById('dc-cost-lines');
    if (costHost) {
      var onCost = function (event) {
        var t = event.target;
        if (t && /-basis$/.test(t.id)) {
          var lineId = t.id.replace(/^dc-cost-/, '').replace(/-basis$/, '');
          var wrap = costHost.querySelector('[data-cost-partial="' + lineId + '"]');
          if (wrap) { wrap.hidden = t.value !== 'partial'; wrap.style.display = wrap.hidden ? 'none' : ''; }
        }
        recalculate();
      };
      costHost.addEventListener('input', onCost);
      costHost.addEventListener('change', onCost);
    }
    // DOH PR 2: operating budget and other income lines.
    var opHost = document.getElementById('dc-op-lines');
    if (opHost) { opHost.addEventListener('input', recalculate); opHost.addEventListener('change', recalculate); }
    var useTotal = document.getElementById('dc-cost-use-total');
    if (useTotal) useTotal.addEventListener('click', function () {
      var r = _lastResult && _lastResult.costBasis && _lastResult.costBasis.summary;
      var cb = costBasisModule();
      var sumAll = cb ? cb.summarizeCosts(readCostLines(), Infinity) : null;
      var itemized = sumAll && !(sumAll.reason && !/Total Development Cost/.test(sumAll.reason)) ? sumAll.itemized : (r && r.itemized);
      if (!(itemized > 0)) return;
      var tdcEl = document.getElementById('dc-tdc');
      tdcEl.value = String(Math.round(itemized));
      tdcEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    var clearCosts = document.getElementById('dc-cost-clear');
    if (clearCosts) clearCosts.addEventListener('click', function () {
      if (costHost) costHost.querySelectorAll('input').forEach(function (input) { input.value = ''; });
      var note = document.getElementById('dc-cost-example-note');
      if (note) note.textContent = 'Example budget cleared. Enter your project\'s cost lines.';
      var wrap = document.getElementById('dc-cost-lines-wrap');
      if (wrap) wrap.open = true;
      recalculate();
    });
    // Select elements also need 'change' listener for reliable cross-browser support
    var taxExemptSel = document.getElementById('dc-tax-exempt');
    if (taxExemptSel) taxExemptSel.addEventListener('change', recalculate);
    var saleTargetSel = document.getElementById('dc-sale-target-ami');
    if (saleTargetSel) saleTargetSel.addEventListener('change', recalculate);
    ['dc-rent-limit-regime', 'dc-prop123-program', 'dc-prop123-petition'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      ['input', 'change'].forEach(function (event) {
        el.addEventListener(event, function () {
          updateAmiLimitsFromFmr(_countyFips);
          if (typeof window.__announceUpdate === 'function') window.__announceUpdate('Rent limits updated.');
        });
      });
    });
    var minimumSetAsideSel = document.getElementById('dc-minimum-set-aside');
    if (minimumSetAsideSel) minimumSetAsideSel.addEventListener('change', recalculate);
    ['dc-mode-rental', 'dc-mode-ownership'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        _renderFundingContextCard();
        recalculate();
      });
    });
    // P7: BR-type selectors fire 'change' not 'input'
    DEAL_AMI_BANDS.map(function (pct) { return 'dc-br-' + pct; }).forEach(function (id) {
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
      // Retired labels (2026-10-26 source check): no official page names these
      // programs. Kept so saved deals still load, listed apart, never the default.
      { v: 'chfa_htf',         l: 'CHFA HTF (retired label; use CHFA HOF or CMF)', retired: true },
      { v: 'prop123',          l: 'Prop 123' },
      { v: 'local_pha',        l: 'Local PHA / Housing Trust' },
      { v: 'chfa_cmf',         l: 'CHFA Capital Magnet Fund' },
      { v: 'dola_htf',         l: 'DOLA HTF (retired label; use DOH HDG or HDLF)', retired: true },
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
    // #2160: whether a grant contains federal money decides whether it reduces
    // basis. These programs are federal funds by statute; Prop 123 is state
    // money. Every other program is left for the user to answer.
    var FEDERAL_FUND_DEFAULTS = { home: 'federal', cdbg: 'federal', nhtf: 'federal', chfa_cmf: 'federal', prop123: 'nonfederal' };
    function defaultFundSource(program) { return FEDERAL_FUND_DEFAULTS[program] || ''; }
    // DOH PR 3: where the tranche counts in DOH's Permanent Financing Sources.
    function defaultDohGroup(program) { var pf = permanentFinancingModule(); return pf ? pf.defaultGroup(program) : ''; }
    // DOH PR 4: what a source pays for, its status, and whether it is a state request.
    function defaultStateRequest(program) { var ds = dohSchedulesModule(); return ds ? ds.defaultStateRequest(program) : false; }
    function activityOptions(t) {
      var ds = dohSchedulesModule();
      if (!ds) return '';
      return [['', 'The whole project']].concat(ds.ACTIVITIES.map(function (a) { return [a.id, a.label]; })).map(function (o) {
        return '<option value="' + o[0] + '"' + ((t.activity || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('');
    }
    function dohGroupOptions(t) {
      var pf = permanentFinancingModule();
      if (!pf) return '';
      if (t.program === pf.HISTORIC_PROGRAM && t.mode !== 'loan') return '<option value="">Tax credit equity: federal historic credit</option>';
      return [['', 'Not answered']].concat(pf.GROUPS.map(function (g) { return [g.id, g.label]; })).map(function (o) {
        return '<option value="' + o[0] + '"' + ((t.doh || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('');
    }

    function _trancheRowHtml(t) {
      var idSuffix = t.id;
      function opt(p) {
        return '<option value="' + p.v + '"' + (p.v === t.program ? ' selected' : '') + '>' + p.l + '</option>';
      }
      var opts = SOFT_PROGRAMS.filter(function (p) { return !p.retired; }).map(opt).join('') +
        '<optgroup label="Retired labels (no current program)">' +
        SOFT_PROGRAMS.filter(function (p) { return p.retired; }).map(opt).join('') + '</optgroup>';
      var inputCss = 'padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);width:100%;min-height:44px;';
      var labelCss = 'font-size:var(--tiny);color:var(--muted);display:block;margin-bottom:0.15rem;';
      return ''
        + '<div data-tranche-id="' + idSuffix + '" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--bg2);">'
        + '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp2);gap:var(--sp2);">'
        + '    <select class="dc-tr-prog" aria-label="Soft-funding program (tranche ' + idSuffix + ')" style="' + inputCss + 'flex:1;">' + opts + '</select>'
        + '    <button type="button" class="dc-tr-remove" aria-label="Remove this tranche" '
        + '      style="background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:var(--radius);padding:0.2rem 0.5rem;cursor:pointer;font-size:var(--small);">✕</button>'
        + '  </div>'
        + '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--sp2);align-items:end;">'
        + '    <label style="display:block;"><span style="' + labelCss + '">Amount ($)</span>'
        + '      <input class="dc-tr-amount" type="number" min="0" step="10000" value="' + (t.amount == null ? '' : t.amount) + '" style="' + inputCss + '">'
        + '    </label>'
        + '    <label style="display:block;"><span style="' + labelCss + '">Rate (%)</span>'
        + '      <input class="dc-tr-rate" type="number" min="0" max="20" step="0.1" value="' + (t.rate == null ? '' : t.rate) + '" style="' + inputCss + '">'
        + '    </label>'
        + '    <label style="display:block;"><span style="' + labelCss + '">Amortization (yrs)</span>'
        + '      <input class="dc-tr-term" type="number" min="1" max="50" step="1" value="' + (t.term == null ? '' : t.term) + '" style="' + inputCss + '">'
        + '    </label>'
        + '  </div>'
        + '  <fieldset style="border:none;padding:0;margin:var(--sp2) 0 0;">'
        + '    <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:var(--tiny);color:var(--muted);margin-right:var(--sp3);">'
        + '      <input type="radio" class="dc-tr-mode" name="dc-tr-mode-' + idSuffix + '" value="loan"' + (t.mode === 'loan' ? ' checked' : '') + '> Loan'
        + '    </label>'
        + '    <label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:var(--tiny);color:var(--muted);">'
        + '      <input type="radio" class="dc-tr-mode" name="dc-tr-mode-' + idSuffix + '" value="grant"' + (t.mode === 'grant' ? ' checked' : '') + '> Grant'
        + '    </label>'
        + '  </fieldset>'
        + '  <label style="display:block;margin-top:0.5rem;">Federal money in this source?'
        + '    <select class="dc-tr-fed" style="' + inputCss + '">'
        + [['', 'Not answered'], ['federal', 'Yes: a grant with federal money reduces eligible basis'], ['nonfederal', 'No federal money']].map(function (o) {
            return '<option value="' + o[0] + '"' + ((t.fundSource || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('')
        + '    </select></label>'
        + '  <label style="display:block;margin-top:0.5rem;">Counts in DOH\'s sources as'
        + '    <select class="dc-tr-doh" style="' + inputCss + '">' + dohGroupOptions(t) + '</select></label>'
        + '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--sp2);margin-top:0.5rem;">'
        + '    <label style="display:block;">Pays for<select class="dc-tr-activity" style="' + inputCss + '">' + activityOptions(t) + '</select></label>'
        + '    <label style="display:block;">Status<select class="dc-tr-status" style="' + inputCss + '">'
        + [['pending', 'Pending'], ['committed', 'Committed']].map(function (o) {
            return '<option value="' + o[0] + '"' + ((t.status || 'pending') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></label>'
        + '    <label style="display:block;">State funds request?<select class="dc-tr-state" style="' + inputCss + '">'
        + [['yes', 'Yes'], ['no', 'No']].map(function (o) {
            return '<option value="' + o[0] + '"' + ((t.stateRequest ? 'yes' : 'no') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></label>'
        + '  </div>'
        + '  <label style="display:block;margin-top:0.5rem;">Repayment obligation <select class="dc-tr-type" style="' + inputCss + '">' + loanTypeOptions(dealEngine().loanTerms(t).loan.type) + '</select></label>'
        + '  <details style="margin-top:var(--sp2);">'
        + '    <summary style="cursor:pointer;min-height:44px;">Loan terms and cash-flow priority</summary>'
        + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:var(--sp2);">'
        + '      <label style="display:block;">Maturity (years)<input class="dc-tr-maturity" type="number" min="1" max="50" value="' + (t.maturity === undefined ? t.term : t.maturity == null ? '' : t.maturity) + '" style="' + inputCss + '"></label>'
        + '      <label style="display:block;">Interest-only years<input class="dc-tr-io" type="number" min="0" max="49" value="' + (t.ioYears === undefined ? 2 : t.ioYears == null ? '' : t.ioYears) + '" style="' + inputCss + '"></label>'
        + '      <label style="display:block;">Residual cash-flow share (%)<input class="dc-tr-cfpay" type="number" min="0" max="100" value="' + (t.cashflowPayPct === undefined ? 100 : t.cashflowPayPct == null ? '' : t.cashflowPayPct) + '" style="' + inputCss + '"></label>'
        + '      <label style="display:block;">Priority (1 first)<input class="dc-tr-priority" type="number" min="1" max="12" value="' + (t.priority === undefined ? 5 : t.priority == null ? '' : t.priority) + '" style="' + inputCss + '"></label>'
        + '    </div>'
        + '    <p style="font-size:var(--tiny);">Screening assumptions: cash-flow loans receive their share of remaining positive cash after must-pay debt, in priority order. Unpaid interest compounds annually. Forgivable loans assume all principal and accrued interest are forgiven at maturity only if the agreement’s conditions are met. Confirm these terms with the lender; public funding is not automatically forgivable.</p>'
        + '  </details>'
        + '</div>';
    }

    function renderSoftTranches() {
      var host = document.getElementById('dc-soft-tranches');
      if (!host) return;
      if (_softTranches.length === 0) {
        // Seed with a default empty tranche so the UI isn't empty on first load.
        // F194: also seed cashflowPayPct, accrueMode, priority defaults
        _softTranches.push({ id: ++_trancheCounter, program: 'other', amount: 0, mode: 'loan', rate: 3.0, term: 30, maturity: 30, ioYears: 2, loanType: 'amortizing', cashflowPayPct: 100, priority: 5 });
      }
      var provenance = window.InputProvenance;
      var previousOrigins = {};
      if (provenance) host.querySelectorAll('[data-tranche-id]').forEach(function (row) {
        previousOrigins[row.dataset.trancheId] = provenance.captureLocal(row);
      });
      _softTranches.forEach(function (t) {
        if (t.fundSource === undefined) t.fundSource = defaultFundSource(t.program);
        if (t.doh === undefined) t.doh = defaultDohGroup(t.program);
        if (t.stateRequest === undefined) t.stateRequest = defaultStateRequest(t.program);
        if (t.status === undefined) t.status = 'pending';
        if (t.activity === undefined) t.activity = '';
      });
      host.innerHTML = _softTranches.map(_trancheRowHtml).join('');
      if (provenance) {
        provenance.apply(host);
        host.querySelectorAll('[data-tranche-id]').forEach(function (row) {
          var previous = previousOrigins[row.dataset.trancheId];
          if (!previous) return;
          // Share keys follow row order; local origins follow the surviving
          // tranche identity when a preceding row is deleted.
          Object.keys(previous).forEach(function (id) {
            var field = row.querySelector('.dc-tr-' + id.replace(/^ip-tr-\d+-/, ''));
            if (field) provenance.restoreLocal(previous[id], field);
          });
        });
      }

      host.querySelectorAll('[data-tranche-id]').forEach(function (rowEl) {
        var trId = parseInt(rowEl.getAttribute('data-tranche-id'), 10);
        var t = _softTranches.find(function (x) { return x.id === trId; });
        if (!t) return;

        rowEl.querySelector('.dc-tr-prog').addEventListener('change', function () {
          t.program = this.value;
          t.fundSource = defaultFundSource(t.program);
          rowEl.querySelector('.dc-tr-fed').value = t.fundSource;
          t.doh = defaultDohGroup(t.program);
          rowEl.querySelector('.dc-tr-doh').innerHTML = dohGroupOptions(t);
          t.stateRequest = defaultStateRequest(t.program);
          rowEl.querySelector('.dc-tr-state').value = t.stateRequest ? 'yes' : 'no';
          recalculate();
        });
        rowEl.querySelector('.dc-tr-activity').addEventListener('change', function () { t.activity = this.value; recalculate(); });
        rowEl.querySelector('.dc-tr-status').addEventListener('change', function () { t.status = this.value; recalculate(); });
        rowEl.querySelector('.dc-tr-state').addEventListener('change', function () { t.stateRequest = this.value === 'yes'; recalculate(); });
        rowEl.querySelector('.dc-tr-doh').addEventListener('change', function () {
          t.doh = this.value;
          recalculate();
        });
        rowEl.querySelector('.dc-tr-fed').addEventListener('change', function () {
          t.fundSource = this.value;
          recalculate();
        });
        [['amount', 'amount'], ['rate', 'rate'], ['term', 'term'], ['maturity', 'maturity'],
          ['io', 'ioYears'], ['cfpay', 'cashflowPayPct'], ['priority', 'priority']].forEach(function (pair) {
          rowEl.querySelector('.dc-tr-' + pair[0]).addEventListener('input', function () {
            t[pair[1]] = this.value.trim() === '' ? null : Number(this.value);
            recalculate();
          });
        });
        rowEl.querySelector('.dc-tr-type').addEventListener('change', function () {
          t.loanType = this.value;
          if (t.ioYears === undefined) t.ioYears = 2;
          recalculate();
        });
        rowEl.querySelectorAll('.dc-tr-mode').forEach(function (modeRadio) {
          modeRadio.addEventListener('change', function () {
            if (this.checked) {
              t.mode = this.value;
              // A historic credit row's DOH choices depend on loan or grant.
              rowEl.querySelector('.dc-tr-doh').innerHTML = dohGroupOptions(t);
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
        // F194: new tranches default to surplus-only (0% CF-pay), accrue mode,
        // priority 8 (mid-stack) — typical for new soft debt added late in capital stack.
        _softTranches.push({ id: ++_trancheCounter, program: 'prop123', amount: 0, mode: 'loan', rate: 0, term: 30, maturity: 30, ioYears: 2, loanType: 'accrue_defer', cashflowPayPct: 0, priority: 8 });
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
    var devfeePctSlider = null;
    var devfeePctLabel  = null;
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
          // #1973: the TZ pairing differs for 9% and 4% applications.
          setTransitZoneContext(_tzLastResult);

          // Update equity price default to match credit rate scenario
          var newDefault = _getCreditPricingDefault(is4Pct);
          EQUITY_PRICE_DEFAULT = newDefault;
          var eqInput = document.getElementById('dc-equity-price');
          if (eqInput) {
            eqInput.value = newDefault.toFixed(2);
            if (window.InputProvenance) window.InputProvenance.mark(eqInput, { status: 'assumption' });
          }

          _renderFundingContextCard();
          recalculate();
        });
      }
    });

    // #2160: the boost designation and its evidence drive the basis.
    var boostSelect = document.getElementById('dc-boost-designation');
    if (boostSelect) boostSelect.addEventListener('change', function () {
      var qctStatus = document.getElementById('dc-assump-qct-status');
      if (qctStatus) qctStatus.textContent = boostSelect.value !== 'none' ? 'selected: ' + boostSelect.options[boostSelect.selectedIndex].text : 'not selected';
      recalculate();
    });

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
          if (fEl) {
            fEl.value = def[id];
            if (window.InputProvenance) window.InputProvenance.mark(fEl, { status: 'assumption' });
          }
        });
        if (_countyFips) updateAmiLimitsFromFmr(_countyFips);
        _renderConstantModifiedFlag();
        recalculate();
      });
    }

    restoreManualMix();
    restoreMarketOverrideDisplay();
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
  // ── #1842: permit-declared structure cost as CONTEXT under the TDC input ──
  //
  // Census BPS "Value" is what applicants declared to the permitting office
  // for the STRUCTURE: no land, soft costs, fees or financing, so it is not
  // TDC and runs well under a Colorado LIHTC budget. It is fit for one job —
  // a relative county cost index and a sanity check on a figure somebody
  // typed. So it is rendered as a note the reader can compare against, and
  // it never populates a field: not TDC, and never the $/SF input, whose
  // whole discipline is that nothing invents a figure for it.
  function setPermitsData(data) {
    _permits = data && data.counties && typeof data.counties === 'object' ? data : null;
    renderPermitContext(_countyFips);
  }

  function permitRecordFor(fips) {
    if (!_permits || !fips) return null;
    var county = _permits.counties[String(fips)];
    if (!county || !county.declared_value_per_unit_mf_5yr) return null;
    return { name: county.name, rec: county.declared_value_per_unit_mf_5yr };
  }

  function renderPermitContext(fips) {
    var el = document.getElementById('dc-tdc-permit-context');
    if (!el) return;
    var found = permitRecordFor(fips);
    if (!found) { el.hidden = true; el.textContent = ''; return; }
    var rec = found.rec;
    var text;
    if (typeof rec.value === 'number' && rec.value > 0) {
      text = 'For comparison: permit-declared structure cost in ' + found.name + ', ' + (rec.window || '') +
        ': $' + Math.round(rec.value).toLocaleString('en-US') + ' per multifamily unit across ' +
        (Number(rec.units) || 0).toLocaleString('en-US') + ' permitted units (Census Building Permits Survey). ' +
        'Structure only: it excludes land, soft costs, fees and financing, so it is not total development cost.';
      var tdcEl = document.getElementById('dc-tdc');
      var unitsEl = document.getElementById('dc-units');
      var tdc = parseFloat(tdcEl && tdcEl.value);
      var units = parseFloat(unitsEl && unitsEl.value);
      if (Number.isFinite(tdc) && tdc > 0 && Number.isFinite(units) && units > 0) {
        var perUnit = tdc / units;
        text += ' Your TDC works out to $' + Math.round(perUnit).toLocaleString('en-US') + ' per unit, ' +
          (perUnit / rec.value).toFixed(1) + '\u00d7 that figure.';
      }
    } else {
      text = 'Permit-declared structure cost in ' + found.name + ': not shown; ' + (rec.basis || 'too few permitted units to mean anything') + '.';
    }
    el.textContent = text;
    el.hidden = false;
  }

  // ── #1814: gross-area estimate from the unit mix ───────────────────────
  function setUnitSizeStandards(data) {
    _unitSizeStandards = data && Array.isArray(data.standards) ? data : null;
    var sel = document.getElementById('dc-gsf-standard');
    if (sel) {
      while (sel.options.length > 1) sel.remove(1);
      (_unitSizeStandards ? _unitSizeStandards.standards : []).forEach(function (std) {
        var opt = document.createElement('option');
        opt.value = std.id;
        opt.textContent = std.label + ' — ' + std.jurisdiction + (std.applies_to_colorado ? '' : ' (not Colorado)');
        sel.appendChild(opt);
      });
    }
    var eff = document.getElementById('dc-gsf-efficiency');
    var effNote = document.getElementById('dc-gsf-efficiency-note');
    var meta = _unitSizeStandards && _unitSizeStandards.meta && _unitSizeStandards.meta.efficiency;
    if (eff && meta && Number.isFinite(meta.default) && !eff.dataset.userSet) eff.value = String(meta.default);
    if (effNote) {
      effNote.textContent = meta
        ? 'Efficiency default ' + meta.default + ' (benchmarks ' + meta.range[0] + ' to ' + meta.range[1] + ', trade press, not a regulation). Change it here; the working updates.'
        : 'Reference data unavailable; enter gross area directly.';
    }
    updateGrossSfEstimate();
  }

  /** Units by bedroom type across every checked AMI tier (split rows win over the tier dropdown). */
  function collectBedroomMix() {
    var mix = {};
    SPLIT_BR_TYPES.forEach(function (b) { mix[b] = 0; });
    if (_resolvedDealMix && _resolvedDealMix.available) {
      _resolvedDealMix.restrictedRows.concat(_resolvedDealMix.marketRows).forEach(function (r) {
        var br = SPLIT_BR_TYPES.find(function (b) { return RENT_BEDROOMS[b] === r.bedrooms; });
        if (br) mix[br] += r.units;
      });
      return mix;
    }
    DEAL_AMI_BANDS.forEach(function (pct) {
      var chk = document.getElementById('dc-chk-' + pct);
      if (!chk || !chk.checked) return;
      var splitTotal = 0;
      SPLIT_BR_TYPES.forEach(function (br) {
        var el = document.getElementById('dc-units-' + pct + '-' + br);
        var n = parseInt(el && el.value, 10);
        if (isFinite(n) && n > 0) { mix[br] += n; splitTotal += n; }
      });
      if (splitTotal > 0) return;
      var uInput = document.getElementById('dc-units-' + pct);
      var brSel = document.getElementById('dc-br-' + pct);
      var u = parseInt(uInput && uInput.value, 10);
      var br = (brSel && brSel.value) || '2br';
      if (isFinite(u) && u > 0 && mix.hasOwnProperty(br)) mix[br] += u;
    });
    return mix;
  }

  function selectedUnitSizeStandard() {
    var sel = document.getElementById('dc-gsf-standard');
    if (!sel || !sel.value || !_unitSizeStandards) return null;
    return _unitSizeStandards.standards.filter(function (std) { return std.id === sel.value; })[0] || null;
  }

  function computeGrossSfEstimate() {
    if (!UnitSize) return null;
    var eff = document.getElementById('dc-gsf-efficiency');
    return UnitSize.derive({
      standard: selectedUnitSizeStandard(),
      mix: collectBedroomMix(),
      efficiency: eff ? eff.value : NaN
    });
  }

  function updateGrossSfEstimate() {
    var working = document.getElementById('dc-gsf-working');
    var btn = document.getElementById('dc-gsf-apply');
    if (!working || !btn || !UnitSize) return;
    var result = computeGrossSfEstimate();
    working.textContent = UnitSize.workingText(result, selectedUnitSizeStandard());
    btn.disabled = !(result && result.status === 'ok');
  }

  function applyGrossSfEstimate() {
    var result = computeGrossSfEstimate();
    if (!result || result.status !== 'ok') return;
    var field = document.getElementById('dc-gross-sf');
    var help = document.getElementById('dc-gross-sf-help');
    if (!field) return;
    var std = selectedUnitSizeStandard();
    field.value = String(result.grossSf);
    field.setAttribute('data-derived', result.standardId || 'estimate');
    if (help) help.textContent = 'Estimated from the unit mix: ' + UnitSize.workingText(result, std) + ' Typing a value here replaces the estimate.';
    recalculate();
  }

  function clearGrossSfDerivation() {
    var field = document.getElementById('dc-gross-sf');
    var help = document.getElementById('dc-gross-sf-help');
    if (!field || !field.hasAttribute('data-derived')) return;
    field.removeAttribute('data-derived');
    if (help) help.textContent = 'Total constructed area including circulation and common space — not the sum of unit sizes. Enter it to see cost per square foot.';
  }

  var _lastResult = null;
  function dealEngine() {
    return window.DealEngine || (typeof require === 'function' ? require('./deal-engine.js') : null);
  }
  function getResult() { return _lastResult == null ? null : JSON.parse(JSON.stringify(_lastResult)); }

  // Exports consume the captured result, never the rendered currency strings.
  function getOutputRecords(result, mode) {
    result = result || getResult();
    mode = mode || currentDealMode();
    var paths = mode === 'ownership' ? {
      costPerUnit: ['forSale.tdcPerUnit'], costPerGrossSf: ['forSale.tdcPerSf'],
      maxAffordablePrice: ['forSale.maxAffordableSalePrice'], subsidyGapPerUnit: ['forSale.subsidyGapPerUnit'],
      totalOwnershipGap: ['forSale.totalSubsidyGap']
    } : {
      eligibleBasis: ['eligibleBasis'], annualCredits: ['annualCredits'], creditEquity: ['equity'],
      stateCreditEquity: ['stateEquity'],
      annualRents: ['annualRents'], developerFee: ['devFeeTotal'], deferredDeveloperFee: ['deferredDevFee'],
      stabilizedNoi: ['noi'], mortgageConstant: ['mc', 'percent4'], firstMortgage: ['mortgage'],
      annualDebtService: ['annualDebtService'], dscr: ['baseDSCR', 'ratio'],
      allMustPayDebtService: ['allMustPayDebtService'], allMustPayDscr: ['allMustPayDSCR', 'ratio'],
      breakEvenOccupancy: ['breakEvenOcc', 'percent1'], totalDevelopmentCost: ['tdc'], fundingGap: ['gap'],
      annualOperatingExpenses: ['annualOpex'], annualReserves: ['annualRepReserve'], annualPropertyTax: ['netPropTax'],
      annualSoftDebtService: ['impactDebtService'], exitNoi: ['exit.nNoi'], resaleValue: ['exit.resale'],
      firstMortgageAtExit: ['exit.firstMortBal'], softDebtAtExit: ['exit.softBal'], netExitProceeds: ['exit.netProceeds']
    };
    var records = {};
    Object.keys(paths).forEach(function (key) {
      var path = paths[key][0], style = paths[key][1];
      var value = path.split('.').reduce(function (obj, part) { return obj == null ? null : obj[part]; }, result);
      var reason = result && result.unavailable[path];
      if (typeof value !== 'number' || !isFinite(value)) {
        value = null; reason = reason || 'The deal calculation is unavailable.';
      }
      var display = value == null ? 'Unavailable — ' + reason : style === 'ratio' ? value.toFixed(2) + 'x'
        : style === 'percent4' ? (value * 100).toFixed(4) + '%'
        : style === 'percent1' ? (value * 100).toFixed(1) + '%' : '$' + Math.round(value).toLocaleString('en-US');
      if (value != null && key === 'stabilizedNoi' && !result.dscrAutoMode && value > 0) display += ' (manual)';
      if (result && !result.chfaRegime && ['eligibleBasis', 'annualCredits', 'creditEquity', 'stateCreditEquity'].indexOf(key) !== -1) {
        display = key === 'eligibleBasis' ? 'Not applicable' : NO_LIHTC_CREDITS;
      }
      records[key] = { value: value, display: display, unavailableReason: reason || null };
    });
    // #2161: an added credit's results travel with the deal only when one is entered.
    var ac = mode !== 'ownership' && result && result.costBasis && result.costBasis.addedCredit;
    if (ac) [['addedCreditGrossEquity', ac.gross], ['addedCreditNetNewEquity', ac.net], ['fundingGapWithAddedCredit', ac.gapAfter]].forEach(function (p) {
      var v = Number.isFinite(p[1]) ? p[1] : null;
      var why = v === null ? (ac.reason || 'The funding gap before the added credit is unavailable.') : null;
      records[p[0]] = { value: v, display: v === null ? 'Unavailable — ' + why : (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'), unavailableReason: why };
    });
    return records;
  }

  function readDealInputs() {
    var fields = {};
    // The partnership terms and the stress sliders sit in their own panels below
    // the mount; the split and the stress readouts read them too (L7).
    document.querySelectorAll('#dealCalcMount input[id], #dealCalcMount select[id], [id^="pf-"], input[id^="dc-wf-"], select[id^="dc-wf-"], input[id^="dc-stress-"]').forEach(function (el) {
      fields[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    });
    // Whether Market Analysis placed the site in a Transit Zone. Read from the last
    // result, not an input, so a saved or shared deal never carries a stale answer.
    fields['dc-tz-in-zone'] = transitZoneInZone(_tzLastResult);
    var ownership = readOwnershipSources({
      ami4Person: getCurrentAmi4Person(),
      targetAmiPct: (parseFloat(fields['dc-sale-target-ami']) || 80) / 100,
      developerFundingPrograms: _developerOwnershipFunding, resaleConventions: _resaleConventions,
      resaleHoldingYears: parseFloat(fields['dc-own-resale-years']) || 5,
      resaleRemainingPrincipal: parseFloat(fields['dc-own-resale-principal']) || 0,
      resaleSellingCosts: parseFloat(fields['dc-own-resale-costs']) || 0,
      resaleMarketAppreciation: parseFloat(fields['dc-own-resale-appreciation']) || 0,
      resaleSubsidyType: _resaleSelection.subsidyType, resaleConventionId: _resaleSelection.selectedConventionId
    });
    var operating = readOperatingLines();
    return { fields: fields, ownership: ownership, resolvedDealMix: _resolvedDealMix, amiLimits: _amiLimits,
      amiLimitsByBr: _amiLimitsByBr, countyFips: _countyFips, creditRate: _creditRate,
      constants: _constants, utilityAllowance: _utilityAllowance,
      equityPriceDefault: EQUITY_PRICE_DEFAULT, minimumSetAsideElection: currentMinimumSetAsideElection(),
      regime: rentLimitRegime(), perBrMarket: _countyFips ? getZoriPerBrRent(_countyFips) : null,
      prop123: { prop123Rules: _prop123Rules, program: selectValue('dc-prop123-program'),
        petitionJurisdiction: selectValue('dc-prop123-petition') },
      manualMarket: _resolvedDealMix.available ? null : readManualMarketInputs(),
      hasUnitMixWarning: !!document.getElementById('dc-units-sync-warn'),
      tranches: typeof window.DealCalcSoftTranches === 'function' ? (window.DealCalcSoftTranches() || []) : [],
      costLines: readCostLines(), costRules: _costRules, chfaCommonAppTables: _chfaTables,
      operatingLines: operating ? operating.lines : null, otherIncomeLines: operating ? operating.income : null,
      fmrData: window.HudFmr && _countyFips ? window.HudFmr.getFmrByFips(_countyFips) : null };
  }

  function recalculate() {
    if (_hydratingSharedScenario) return;
    observeSubjectProject();
    _resolvedDealMix = resolveDealMix();
    renderDealMixContext(_resolvedDealMix);
    updateGrossSfEstimate();
    renderPermitContext(_countyFips);
    _utilityAllowance = resolveUtilityAllowance();
    var inputs = readDealInputs();
    _lastResult = dealEngine().computeDeal(inputs);
    renderDealResult(_lastResult, inputs);
    // After the panels that wrap recalculate() have rendered too.
    setTimeout(quietPreCountyAbsence, 0);
    saveManualMix();
    try { document.dispatchEvent(new CustomEvent('deal-calc:updated', { detail: { result: getResult() } })); } catch(_) {}
  }

  // Before any county is chosen, every rent-dependent cell would repeat the
  // same "Unavailable — Select a county…" sentence (~25 times on a fresh
  // page; site audit F12). Keep the absence honest but say it once: each such
  // cell shows a dash, with the reason kept for hover and screen readers. Runs
  // only while the county picker is empty, so a chosen county is untouched.
  var PRE_COUNTY_REASON = 'Unavailable — Select a county to load AMI rent limits.';
  function quietPreCountyAbsence() {
    // Display-only tidy-up: skip quietly where the DOM lacks tree walking
    // (lightweight test documents), and never let it break a calculation.
    if (typeof document === 'undefined' || typeof document.createTreeWalker !== 'function' ||
        typeof document.querySelector !== 'function') return;
    try { _quietPreCountyAbsence(); } catch (_) { /* cosmetic only */ }
  }
  function _quietPreCountyAbsence() {
    var sel = document.getElementById('dc-county-select');
    if (!sel) return;
    var mount = document.querySelector('main') || document.body;
    if (sel.value) {
      // County chosen: drop the hover note from cells the renderers refilled.
      Array.prototype.forEach.call(mount.querySelectorAll('[data-pre-county]'), function (el) {
        el.removeAttribute('data-pre-county');
        if (el.title === 'Unavailable until a county is selected') el.removeAttribute('title');
      });
      return;
    }
    var walker = document.createTreeWalker(mount, 4 /* NodeFilter.SHOW_TEXT */);
    var hits = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue.trim() === PRE_COUNTY_REASON && n.parentNode && n.parentNode.childNodes.length === 1) hits.push(n.parentNode);
    }
    hits.forEach(function (el) {
      // The quick-estimate answer panel states the reason once; it and the
      // headline figures it mirrors must keep showing the same text.
      if (el.id && (el.id.indexOf('dq-out-') === 0 || document.getElementById('dq-out-' + el.id))) return;
      el.textContent = '—';
      el.title = 'Unavailable until a county is selected';
      var sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = ' unavailable until a county is selected';
      el.appendChild(sr);
      el.setAttribute('data-pre-county', '');
    });
    // Panels that render later (stress, waterfall) are caught as they appear.
    if (!_preCountyObserver && typeof MutationObserver === 'function') {
      var queued = false;
      _preCountyObserver = new MutationObserver(function () {
        if (queued) return;
        queued = true;
        setTimeout(function () { queued = false; quietPreCountyAbsence(); }, 0);
      });
      _preCountyObserver.observe(mount, { childList: true, subtree: true, characterData: true });
    }
  }
  var _preCountyObserver = null;

  // #2160: itemized costs, basis, credit figures and the CHFA tests. Every
  // absent figure shows its reason; nothing falls back to a typical share.
  // DOH PR 2: operating budget subtotals, per-line property totals, DOH's
  // per unit per year expenses and other income. Absent figures show a reason.
  // DOH PR 3: the sources regrouped as DOH's Permanent Financing Sources tab.
  var _lastPermanentFinancing = null;
  var _lastPfSummary = null;
  // DOH PR 4: sources and uses by activity, and DOH's 15-year pro forma rows.
  var _lastDohSchedules = null;
  function renderDohSchedules(result, fmt) {
    var ds = dohSchedulesModule(), pf = permanentFinancingModule();
    var suRows = document.getElementById('dc-act-rows');
    if (!ds || !pf || !suRows) return;
    function money(v) { return v === null || v === undefined ? '—' : fmt(v); }
    var su = ds.sourcesByActivity({ costSummary: result.costBasis && result.costBasis.summary,
      financing: _lastPfSummary, tranches: result.tranches || [], labels: pf.PROGRAM_LABELS });
    var cell = 'padding:0.3rem 0.25rem;font-size:var(--small);vertical-align:top;';
    function names(list) {
      return list.map(function (e) {
        return _escHtml(e.name) + (e.status ? ' (' + (e.status === 'committed' ? 'committed' : 'pending') + ')' : '');
      }).join(', ');
    }
    function tr(key, label, cost, state, other, sources, opts) {
      opts = opts || {};
      // The sources sit under the activity name, so the table fits a phone.
      return '<tr data-su-row="' + key + '"' + (opts.strong ? ' style="background:var(--bg2);font-weight:700;"' : '') + '>'
        + '<th scope="row" style="' + cell + 'text-align:left;text-transform:none;letter-spacing:normal;font-weight:' + (opts.strong ? '700' : '400') + ';">' + _escHtml(label)
        + '<span data-su="sources" style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">' + sources + '</span></th>'
        + '<td data-su="cost" style="' + cell + 'text-align:right;">' + cost + '</td>'
        + '<td data-su="state" style="' + cell + 'text-align:right;">' + state + '</td>'
        + '<td data-su="other" style="' + cell + 'text-align:right;">' + other + '</td></tr>';
    }
    // "—" is for an unknown amount; a category with no state or other dollars shows $0.
    function amt(v) { return v == null ? '—' : money(v); }
    var html = su.rows.map(function (r) {
      return tr(r.id, r.label, money(r.cost), amt(r.state), amt(r.other), names(r.sources));
    }).join('');
    if (su.notItemized) html += tr('not_itemized', 'Not itemized', money(su.notItemized), '—', '—', '');
    var t = su.totals;
    if (su.general) html += tr('general', 'Whole project', '', amt(su.general.state), amt(su.general.other), names(su.general.sources));
    if (t) {
      html += tr('total', 'Total', money(t.cost), money(t.state), money(t.other), '', { strong: true })
        + tr('gap', 'Gap (surplus)', '', '', money(t.gap), '');
    }
    suRows.innerHTML = html;
    var suReason = document.getElementById('dc-act-reason');
    if (suReason) { suReason.textContent = su.reasons.join(' '); suReason.hidden = !su.reasons.length; }
    // Screen readers hear when an edit moves dollars on the activity table.
    var actLive = document.getElementById('dc-act-live');
    // Every row with a source is read out, its sources and their status
    // included; an unknown amount is read as unavailable, never $0.
    function spoken(v) { return v === null || v === undefined ? 'unavailable' : fmt(v); }
    var actText = 'Sources by activity updated. ' + su.rows.concat(su.general ? [Object.assign({ label: 'Whole project' }, su.general)] : [])
      .filter(function (r) { return r.sources && r.sources.length; })
      .map(function (r) { return r.label + ': state ' + spoken(r.state) + ', other ' + spoken(r.other) + ' (' + r.sources.map(function (e) { return e.name + (e.status ? ', ' + (e.status === 'committed' ? 'committed' : 'pending') : ''); }).join('; ') + ')'; }).join('; ')
      + (t ? '. Gap ' + spoken(t.gap) + '.' : '.');
    if (actLive && actLive.dataset.last !== undefined && actLive.dataset.last !== actText) actLive.textContent = actText;
    if (actLive) actLive.dataset.last = actText;

    var f = ds.fifteenYear(result);
    var reasonEl = document.getElementById('dc-doh15-reason');
    var doh15Notice = f.reason ? 'Unavailable — ' + f.reason : f.notice ? 'Some years are unavailable — ' + f.notice : '';
    if (reasonEl) { reasonEl.textContent = doh15Notice; reasonEl.hidden = !doh15Notice; }
    var sumEl = document.getElementById('dc-doh15-summary');
    var tableEl = document.getElementById('dc-doh15-table');
    var totalsEl = document.getElementById('dc-doh15-totals');
    _lastDohSchedules = JSON.parse(JSON.stringify({ sourcesByActivity: su, fifteenYear: f }));
    if (!f.rows) {
      if (sumEl) sumEl.innerHTML = '';
      if (tableEl) tableEl.innerHTML = '';
      if (totalsEl) totalsEl.innerHTML = '';
      return;
    }
    var df = f.deferredFee;
    var y15 = f.rows[f.rows.length - 1];
    // Screen readers hear when an edit changes the schedule's answer.
    var liveEl = document.getElementById('dc-doh15-live');
    var liveText = 'DOH 15-year schedule updated. Deferred developer fee ' + (df.paybackYear ? 'repaid in year ' + df.paybackYear : df.amount === 0 ? 'none' : 'not repaid: ' + (df.reason || 'unavailable')) + '.';
    if (liveEl && liveEl.dataset.last !== undefined && liveEl.dataset.last !== liveText) liveEl.textContent = liveText;
    if (liveEl) liveEl.dataset.last = liveText;
    if (sumEl) sumEl.innerHTML = [
      ['Year-15 cash after payments', money(y15.availableAfterPayments), 'cash15'],
      ['Deferred developer fee repaid', df.paybackYear ? 'Year ' + df.paybackYear : df.amount === 0 ? 'No deferred fee' : _escHtml(df.reason || '—'), 'payback'],
      ['Deferred fee unpaid after year 15', money(df.unpaidAfter), 'unpaid']
    ].concat(f.assetMgmt.unpaidAfter !== 0 ? [['Asset management fee owed after year 15', money(f.assetMgmt.unpaidAfter), 'asset-unpaid']] : []).map(function (p) { return '<dt style="color:var(--muted);">' + _escHtml(p[0]) + '</dt><dd data-doh15="' + p[2] + '" style="margin:0;text-align:right;font-weight:700;">' + p[1] + '</dd>'; }).join('');
    var c = 'padding:0.25rem 0.4rem;text-align:right;border-bottom:1px solid var(--border);text-transform:none;letter-spacing:normal;';
    // A narrow, wrapping label column that stays put while the years scroll.
    var lc = c + 'text-align:left;position:sticky;left:0;background:var(--card);white-space:normal;min-width:7rem;max-width:8.5rem;font-size:var(--tiny);';
    function line(key, label, values, opts) {
      opts = opts || {};
      return '<tr data-doh15-row="' + key + '"' + (opts.strong ? ' style="font-weight:700;"' : '') + '><th scope="row" style="' + lc + '">' + _escHtml(label) + '</th>'
        + values.map(function (v) { return '<td style="' + c + '">' + v + '</td>'; }).join('') + '</tr>';
    }
    function col(key, fmtFn) { return f.rows.map(function (x) { return (fmtFn || money)(x[key]); }); }
    var head = '<thead><tr><th scope="col" style="' + lc + '">Year</th>'
      + f.rows.map(function (x) { return '<th scope="col" style="' + c + 'color:var(--muted);">' + x.year + '</th>'; }).join('') + '</tr></thead>';
    var body = line('rent', 'Rent income', col('rentIncome'))
      + line('vacancy', 'Less vacancy', col('vacancy'))
      + line('other_income', 'Other income', col('otherIncome'))
      + line('egi', 'Effective gross income', col('egi'))
      + line('expenses', 'Total annual expenses', col('expenses'))
      + line('noi', 'Net operating income', col('noi'), { strong: true })
      + line('debt_service', 'Total debt service', col('debtService'))
      + line('bridge', 'Bridge loan debt service', col('bridge'))
      + line('cf_available', 'Cash flow available', col('cashFlowAvailable'), { strong: true })
      + line('dcr', 'Debt coverage ratio', col('dcr', function (v) { return v === null || v === undefined ? '—' : v.toFixed(2); }))
      // Must-pay debt service NOI could not cover is added to the loan
      // balance, not paid from cash, so it comes back here.
      + (f.rows.some(function (x) { return x.mustPayUnpaid > 0; }) ? line('unpaid_ds', 'Debt service left unpaid (added to the loan balance)', col('mustPayUnpaid')) : '')
      + line('asset_fee', 'Asset management fees', col('assetMgmtFee'))
      + f.loans.map(function (l, n) {
        return line('cf_loan_' + (n + 1), l.label + ' (' + (pf.PROGRAM_LABELS[l.program] || l.program) + ')', f.rows.map(function (x) { return money(x.cashFlowLoans[n]); }));
      }).join('')
      + line('deferred_fee', 'Deferred developer fees', col('deferredFee'))
      + (f.rows.some(function (x) { return x.deficitRecovered > 0; }) ? line('deficit', 'Repays earlier deficits', col('deficitRecovered')) : '')
      + line('after', 'Available cash after payments', col('availableAfterPayments'), { strong: true });
    if (tableEl) tableEl.innerHTML = head + '<tbody>' + body + '</tbody>';
    function totalRow(key, label, w) {
      return '<tr data-doh15-total="' + key + '"><th scope="row" style="' + c + 'text-align:left;">' + _escHtml(label) + '</th><td style="' + c + '">' + money(w.first10) + '</td><td style="' + c + '">' + money(w.last5) + '</td><td style="' + c + '">' + money(w.total) + '</td></tr>';
    }
    if (totalsEl) totalsEl.innerHTML = '<thead><tr><th scope="col" style="' + c + 'text-align:left;">Paid from cash flow</th><th scope="col" style="' + c + 'color:var(--muted);">Yrs 1–10</th><th scope="col" style="' + c + 'color:var(--muted);">Yrs 11–15</th><th scope="col" style="' + c + 'color:var(--muted);">Total</th></tr></thead><tbody>'
      + totalRow('deferred_fee', 'Deferred developer fee', df.totals)
      + f.loans.map(function (l) { return totalRow(l.label.replace(/\W+/g, '_').toLowerCase(), l.label, l.totals); }).join('')
      + totalRow('asset_fee', 'Asset management fees', f.assetMgmt)
      + totalRow('bridge', 'Bridge loan debt service', f.bridge) + '</tbody>';
  }
  function renderPermanentFinancing(result, fmt) {
    var pf = permanentFinancingModule();
    var rowsEl = document.getElementById('dc-pf-rows');
    if (!pf || !rowsEl) return;
    function val(id) { var e = document.getElementById(id); return e ? String(e.value).trim() : ''; }
    var s = pf.summarize({ result: result, tranches: result.tranches || [], seniorLenderType: val('dc-senior-lender-type'),
      capRatePct: val('dc-pf-cap-rate'), capLvrPct: val('dc-pf-cap-lvr'),
      appraisedValue: val('dc-pf-appraised'), appraisedLvrPct: val('dc-pf-appraised-lvr') });
    _lastPermanentFinancing = pf.exportView(s);
    _lastPfSummary = s;
    var t = s.totals;
    function money(v) { return v === null || v === undefined ? '—' : fmt(v); }
    function pct(v) { var p = s.pctOfTdc(v); return p === null ? '—' : (p * 100).toFixed(1) + '%'; }
    var cell = 'padding:0.3rem 0.25rem;font-size:var(--small);';
    function row(key, label, v, opts) {
      opts = opts || {};
      return '<tr data-pf-row="' + key + '"' + (opts.strong ? ' style="background:var(--bg2);"' : '') + '>'
        + '<td style="' + cell + (opts.indent ? 'padding-left:1.1rem;color:var(--muted);' : '') + (opts.strong ? 'font-weight:700;' : '') + '">' + _escHtml(label) + '</td>'
        + '<td data-pf-amount style="' + cell + 'text-align:right;font-weight:' + (opts.indent ? '400' : '700') + ';">' + money(v) + '</td>'
        + '<td style="' + cell + 'text-align:right;color:var(--muted);">' + (opts.noPct ? '' : pct(v)) + '</td></tr>';
    }
    var tc = s.taxCredit;
    var html = row('conventional', 'Conventional', t.conventional)
      + row('tax_exempt', 'Tax-exempt', t.taxExempt)
      + row('federal_financing', 'Federal financing', t.federalFinancing)
      + row('tax_credits', 'Tax credit equity', t.taxCredits)
      + row('nine', '9% LIHTC proceeds', tc.nine, { indent: true })
      + row('four', '4% LIHTC proceeds', tc.four, { indent: true })
      + row('historic', 'Federal historic credit', tc.historic, { indent: true })
      + (tc.state === 0 ? '' : row('state', 'Colorado state credit (not a DOH row)', tc.state, { indent: true }))
      + (!tc.added ? '' : row('added', (tc.addedLabel || 'Added credit') + ' (not a DOH row)', tc.added, { indent: true }))
      + row('government', 'Government grants and soft debt', t.government)
      + row('other_grants', 'Other grants (non-governmental)', t.otherGrants)
      + row('owner', 'Owner equity', t.ownerEquity)
      + row('deferred_fee', 'Deferred developer fee', s.deferredDevFee, { indent: true })
      + (s.unclassified.length ? row('unclassified', 'Not yet grouped', t.unclassified) : '')
      + row('total_sources', 'Total sources', t.totalSources, { strong: true })
      + row('gap', 'Gap (surplus)', t.gap)
      + row('tdc', 'Total development cost', t.tdc, { strong: true });
    rowsEl.innerHTML = html;
    var reasonEl = document.getElementById('dc-pf-reason');
    var reasons = s.reasons.filter(function (r, i, all) { return all.indexOf(r) === i; });
    if (reasonEl) { reasonEl.textContent = reasons.join(' '); reasonEl.hidden = !reasons.length; }
    var typeLabel = {};
    pf.LENDER_TYPES.forEach(function (lt) { typeLabel[lt.id] = lt.label; });
    var mortEl = document.getElementById('dc-pf-mortgages');
    if (mortEl) mortEl.innerHTML = s.hardMortgages.map(function (m, i) {
      var name = m.source === 'senior' ? 'First mortgage' : m.label + ' (' + (pf.PROGRAM_LABELS[m.program] || m.program) + ')';
      return '<p data-pf-mortgage="' + i + '" style="margin:0.3rem 0;">' + _escHtml(name) + ': '
        + (m.lenderType ? _escHtml(typeLabel[m.lenderType]) : 'loan type not chosen') + ', '
        + money(m.principal) + ' principal, ' + money(m.annualPayment) + ' a year, DCR '
        + (m.cumulativeDcr === null ? '—' : m.cumulativeDcr.toFixed(2)) + '</p>';
    }).join('');
    function dl(pairs) { return pairs.map(function (p) { return '<dt style="color:var(--muted);">' + _escHtml(p[0]) + '</dt><dd data-pf="' + p[2] + '" style="margin:0;text-align:right;font-weight:700;">' + p[1] + '</dd>'; }).join(''); }
    var covEl = document.getElementById('dc-pf-coverage');
    if (covEl) covEl.innerHTML = dl([
      ['DCR on all hard debt', s.dcr === null ? '—' : s.dcr.toFixed(2), 'dcr'],
      ['Break-even occupancy', s.breakEven === null ? '—' : (s.breakEven * 100).toFixed(1) + '%', 'bep'],
      ['Possible debt service at ' + pf.DOH_DCR.toFixed(2) + ' DCR', money(s.possibleDebtService), 'possible-ds']
    ]);
    var maxEl = document.getElementById('dc-pf-maxloan');
    if (maxEl) {
      var c = s.maxLoan.byCap, a = s.maxLoan.byAppraisal;
      maxEl.innerHTML = dl([
        ['Value at cap rate', c.reason ? _escHtml(c.reason) : money(c.value), 'cap-value'],
        ['Maximum loan by cap-rate value', c.reason ? '—' : money(c.maxLoan), 'cap-max'],
        ['Maximum loan by appraised value', a.reason ? _escHtml(a.reason) : money(a.maxLoan), 'appraised-max'],
        ['Hard debt above the lower maximum', s.overMaxLoan === null ? '—' : money(s.overMaxLoan), 'over-max']
      ]);
    }
  }
  function renderOperatingBudget(result, fmt) {
    var ob = operatingBudgetModule();
    var sum = result.operatingSummary;
    if (!ob || !sum) return;
    function setText(id, text) { var e = document.getElementById(id); if (e) e.textContent = text; }
    var units = result.units > 0 ? result.units : null;
    var reasonEl = document.getElementById('dc-op-reason');
    if (reasonEl) { reasonEl.textContent = sum.reason || ''; reasonEl.hidden = !sum.reason; }
    setText('dc-op-total', sum.reason ? '—' : fmt(sum.perUnitYear) + ' (' + fmt(sum.perUnitMonth) + ' a month)');
    setText('dc-op-income-total', sum.reason ? '—' : fmt(sum.otherIncomePerUnitYear));
    // Taxes count net of the selected exemption, as NOI does.
    var taxEl = document.getElementById('dc-prop-tax'), exemptEl = document.getElementById('dc-tax-exempt');
    var grossTax = taxEl ? String(taxEl.value).trim() : '';
    var netTax = grossTax === '' || !Number.isFinite(Number(grossTax)) ? grossTax
      : Number(grossTax) * (1 - (exemptEl ? (Number(exemptEl.value) || 0) : 0) / 100);
    var pupa = ob.pupaExpenses(sum, netTax,
      document.getElementById('dc-rep-reserve') && document.getElementById('dc-rep-reserve').value);
    setText('dc-op-pupa', pupa.value == null ? pupa.reason : fmt(pupa.value));
    // An expense target is checked against the expenses used; it never replaces them.
    var tgEl = document.getElementById('dc-op-target-check'), tg = result.expenseTarget;
    if (tgEl) {
      var tgText = !tg || !tg.entered ? '' : tg.reason ? tg.reason
        : tg.below ? 'The target is ' + fmt(tg.difference) + ' a unit a year below the expenses used (' + fmt(tg.used) + '). The calculator keeps the expenses'
          + (tg.coverageAtTarget != null ? ': year-1 coverage is ' + tg.coverageUsed.toFixed(2) + 'x on them, and would read ' + tg.coverageAtTarget.toFixed(2) + 'x at the target.' : '.')
        : 'The target is at or above the expenses used (' + fmt(tg.used) + ' a unit a year).';
      tgEl.textContent = tgText;
      tgEl.style.color = tg && tg.below ? 'var(--warn,#b45309)' : '';
    }
    document.querySelectorAll('[data-op-subtotal]').forEach(function (span) {
      var g = span.getAttribute('data-op-subtotal');
      var v = g === 'income' ? sum.otherIncomePerUnitYear : sum.groups && sum.groups[g];
      // DOH's Total Other includes real estate taxes and the replacement reserve.
      if (g === 'other') v = pupa.value == null ? null : v + (pupa.value - sum.perUnitYear);
      span.textContent = sum.reason || v == null ? '—' : fmt(v) + ' per unit';
    });
    function perText(v) {
      if (sum.reason || !(v > 0)) return '';
      return units ? fmt(v * units) + ' a year for ' + units + ' units' : 'Enter Total Units for the property total.';
    }
    document.querySelectorAll('[data-op-per]').forEach(function (span) { span.textContent = perText(sum.byId && sum.byId[span.getAttribute('data-op-per')]); });
    document.querySelectorAll('[data-op-income-per]').forEach(function (span) { span.textContent = perText(sum.incomeById && sum.incomeById[span.getAttribute('data-op-income-per')]); });
    // DOH asks whether utilities are included in rent. The calculator takes that
    // from the utility allowance set in Market Analysis, which already sets rent.
    var ua = _utilityAllowance || {};
    setText('dc-op-utilities-note', ua.applied
      ? 'Utilities in rent: the utility allowance follows ' + ((ua.basis && ua.basis.reference) || 'your Market Analysis setting') + '. Budget the utilities the owner pays on the Utilities line.'
      : 'Utilities in rent: not set. Set who pays which utilities in Market Analysis → Subject project, then budget the owner-paid ones on the Utilities line.');
  }

  /** #2161: the added credit's gross and net new equity, and the gap with it counted in the sources. */
  function renderAddedCredit(result, fmt) {
    var ac = result.costBasis && result.costBasis.addedCredit;
    var kind = document.getElementById('dc-add-kind');
    var tzNote = document.getElementById('dc-add-tz-note');
    if (tzNote) tzNote.hidden = !(kind && kind.value === 'tz');
    var wrap = document.getElementById('dc-add-result');
    if (!wrap) return;
    wrap.hidden = !ac;
    if (!ac) return;
    var reason = document.getElementById('dc-add-reason');
    if (reason) { reason.hidden = !ac.reason; reason.textContent = ac.reason || ''; }
    function amt(v) { return v == null ? 'Not available' : v < 0 ? '-' + fmt(-v) : fmt(v); }
    var eligibility = { 'unknown': 'Eligibility unknown', 'not in a zone': 'Not eligible: site not in a Transit Zone',
      'evidence entered': 'Evidence entered', 'not location-based': 'Not tied to location' }[ac.eligibility] || 'Eligibility unknown';
    var rows = [
      ['Eligibility', eligibility, ac.evidence],
      ['Gross equity', amt(ac.gross), ac.gross == null ? null : fmt(ac.annual) + ' a year, equal each year, for ' + ac.years + ' years at $' + ac.price.toFixed(2) + (ac.programYear ? ', program year ' + ac.programYear : '')],
      ['Less equity of the credit it replaces', ac.displaced == null ? 'Not available' : ac.displaced ? '-' + fmt(ac.displaced) : fmt(0), ac.displaces],
      ['Less equity from the federal credit cut', ac.resizedFederal == null ? 'Not available' : ac.resizedFederal ? '-' + fmt(ac.resizedFederal) : fmt(0), null],
      ['Net new equity before fees', amt(ac.netBeforeFees), null],
      ['Less new investor fees', ac.net == null ? 'Not available' : ac.fees ? '-' + fmt(ac.fees) : fmt(0), null],
      ['Net new equity', amt(ac.net), ac.net != null && ac.net < 0 ? 'Negative: this credit brings less than it displaces.' : null],
      ['Funding gap before deferred fee, without this credit', amt(ac.gapBefore), null],
      ['Funding gap before deferred fee, with this credit', amt(ac.gapAfter), ac.gapAfter == null ? 'Not counted in the sources and uses until every figure above is available.' : 'As in the sources and uses.'],
      ['Possible cut to another award', ac.awardReduction ? ac.awardReduction.text : 'rule not sourced', ac.awardReduction && ac.awardReduction.citation]
    ];
    var body = document.getElementById('dc-add-rows');
    if (body) body.innerHTML = rows.map(function (r, i) {
      var strong = r[0] === 'Net new equity';
      return '<tr data-add-row="' + i + '"><th scope="row" style="text-align:left;font-weight:' + (strong ? '700' : '400') + ';padding:0.3rem 0.25rem;border-top:1px solid var(--border);">' + _escHtml(r[0])
        + (r[2] ? '<span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">' + _escHtml(r[2]) + '</span>' : '') + '</th>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:' + (strong ? '700' : '400') + ';padding:0.3rem 0.25rem;border-top:1px solid var(--border);">' + _escHtml(r[1]) + '</td></tr>';
    }).join('');
  }

  function renderCostBasis(result, fmt) {
    var cbr = result.costBasis;
    if (!cbr) return;
    function el(id) { return document.getElementById(id); }
    function setText(id, text) { var e = el(id); if (e) e.textContent = text; }
    function money(v, reason) { return v == null ? (reason || 'Not available') : fmt(v); }
    function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
    var sum = cbr.summary, basis = cbr.basis;
    setText('dc-cb-itemized', sum.reason ? '—' : fmt(sum.itemized));
    setText('dc-cb-not-itemized', money(sum.notItemized, '—'));
    setText('dc-cb-eligible-cost', money(sum.eligible, '—'));
    setText('dc-cb-contract', sum.reason ? '—' : fmt(sum.contract));
    var reasonEl = el('dc-cb-cost-reason');
    if (reasonEl) { reasonEl.textContent = sum.reason || ''; reasonEl.hidden = !sum.reason; }
    (sum.contingencies || []).forEach(function (c) {
      var span = document.querySelector('[data-cost-remaining="' + c.id + '"]');
      if (span) span.textContent = c.remaining == null ? c.reason : 'Remaining: ' + fmt(c.remaining) + (c.reason ? ' (' + c.reason + ')' : '');
    });
    // Category subtotals and each line's cost per unit and per square foot.
    var perUnits = cbr.costPerSf && cbr.costPerSf.units, perSf = cbr.costPerSf && cbr.costPerSf.residentialSf;
    var lineError = sum.reason && !/Total Development Cost/.test(sum.reason) && !/Itemize development costs/.test(sum.reason);
    document.querySelectorAll('[data-cost-subtotal]').forEach(function (span) {
      var v = sum.groups && sum.groups[span.getAttribute('data-cost-subtotal')];
      span.textContent = lineError || v == null ? '—' : fmt(v);
    });
    document.querySelectorAll('[data-cost-per]').forEach(function (span) {
      var v = sum.byId && sum.byId[span.getAttribute('data-cost-per')];
      if (lineError || !(v > 0)) { span.textContent = ''; return; }
      span.textContent = [perUnits ? fmt(v / perUnits) + ' per unit' : null, perSf ? '$' + (v / perSf).toFixed(2) + ' per residential SF' : null].filter(Boolean).join(' · ');
    });
    document.querySelectorAll('[data-cost-remaining]').forEach(function (span) {
      if (!(sum.contingencies || []).some(function (c) { return c.id === span.getAttribute('data-cost-remaining'); })) span.textContent = '';
    });
    var chfa = !!result.chfaRegime;
    setText('dc-cb-capacity', !chfa ? 'Not applicable' : money(basis.capacity, 'Unavailable'));
    setText('dc-cb-requested', !chfa ? 'Not applicable' : basis.requested == null ? 'Not entered' : fmt(basis.requested));
    setText('dc-cb-awarded', !chfa ? 'Not applicable' : basis.awarded == null ? 'Not entered' : fmt(basis.awarded));
    var notes = [];
    if (chfa) {
      if (result.basisUnknownReason) notes.push(result.basisUnknownReason);
      if (basis.gapMethod.binding) notes.push(basis.gapMethod.reason);
      else if (basis.cap.binding) notes.push(basis.cap.reason);
      notes = notes.concat(basis.flags || []);
      if (basis.creditForEquityBasis) notes.push('Equity uses the ' + basis.creditForEquityBasis + ' figure.');
    }
    setText('dc-cb-credit-note', notes.join(' '));

    var rows = [];
    function row(label, value, note) {
      rows.push('<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:.2rem .75rem;padding:.3rem 0;border-top:1px solid var(--border);">'
        + '<span>' + _escHtml(label) + (note ? '<span style="display:block;font-size:var(--tiny);color:var(--muted);">' + _escHtml(note) + '</span>' : '') + '</span>'
        + '<strong style="text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;">' + _escHtml(value) + '</strong></div>');
    }
    function heading(text) { rows.push('<h4 style="margin:var(--sp2) 0 .2rem;font-size:var(--small);">' + _escHtml(text) + '</h4>'); }
    heading('Basis and credit');
    // Outside CHFA LIHTC there is no credit, so no basis or credit figures to show.
    if (!chfa) row('Basis and credit calculation', 'Not applicable', NO_LIHTC_CREDITS);
    else {
      row('Cost in eligible basis', money(basis.eligibleBasis, basis.reasons.eligibleBasis));
      if (basis.feeReduction > 0) row('Less fees above CHFA\'s limits', fmt(basis.feeReduction), 'CHFA limits the fees in calculating credit; a reduction in fees reduces eligible basis (QAP 3.M.3).');
      row('Less federally funded grants', money(basis.grantReduction, basis.reasons.afterGrant), 'Grants with federal money reduce basis; loans and grants with no federal money do not (26 U.S.C. 42(d)(5)(A)).'
        + (basis.grantOutsideBasis > 0 ? ' ' + fmt(basis.grantOutsideBasis) + ' of federal grant money paid for costs outside basis and does not reduce it.' : '')
        + (basis.grantOnAcquisition > 0 ? (basis.grantSplitEntered ? ' As entered: ' : ' Spread over acquisition and other basis in proportion (the credit rates match and no boost applies): ') + fmt(basis.grantOnAcquisition) + ' against acquisition.' : ''));
      row('Basis after grants', money(basis.afterGrant, basis.reasons.afterGrant));
      row('Basis boost', basis.boost.applied ? 'Applied: ' + basis.boost.designation + ', ' + Math.round((basis.boost.multiplier - 1) * 100) + '%' : 'Not applied', basis.boost.applied ? basis.boost.citation : basis.boost.reason);
      row('Basis after boost', money(basis.boostedBasis, basis.reasons.afterGrant));
      row('Applicable fraction', basis.applicableFraction == null ? (basis.reasons.applicableFraction || 'Not available') : pct(basis.applicableFraction),
        basis.applicableFraction == null ? null : 'Lower of the unit fraction (' + pct(basis.unitFraction) + ') and the floor-space fraction (' + pct(basis.floorFraction) + ').');
      row('Qualified basis', money(basis.qualifiedBasis, basis.reasons.applicableFraction));
      if (basis.acquisitionQualified > 0) row('Acquisition credit rate', basis.acquisitionRate == null ? basis.reasons.acquisitionRate : (basis.acquisitionRate * 100).toFixed(2) + '%',
        basis.acquisitionCitation ? 'Acquisition basis earns CHFA\'s 4% acquisition floor, not 9% (' + basis.acquisitionCitation + '). The calculator has no input for a higher applicable percentage.' : 'Acquisition basis earns the same rate on a 4% deal.');
      if (basis.acquisitionQualified > 0) row('CHFA minimum rehabilitation', 'Not checked', costBasisModule().REHAB_MINIMUM_NOTE);
      row('Method One: qualified basis credit', money(basis.calculatedCredit, basis.reasons.acquisitionRate || 'Not available'),
        String(result.creditType) === '4' && !(cbr.bondTest && cbr.bondTest.bondAmount !== null) ? costBasisModule().BOND_TEST_NOTE : null);
      var bt = cbr.bondTest;
      if (bt && bt.applies && bt.bondAmount !== null) {
        row('Bond test: bonds / (basis + land)', bt.ratio == null ? bt.reason : (Math.round(bt.ratio * 1000) / 10).toFixed(1) + '%'
          + (bt.passes == null ? '' : bt.passes ? ' · meets the ' + Math.round(bt.threshold * 100) + '% test' : ' · below the ' + Math.round(bt.threshold * 100) + '% test'),
          [bt.passes == null ? bt.reason : null, bt.aggregateBasis != null ? 'Aggregate basis ' + fmt(bt.aggregateBasis) + '. ' + bt.note : null,
            bt.minimumBonds != null ? 'Bonds needed: ' + fmt(bt.minimumBonds) + '. ' + (bt.basisCushion >= 0 ? 'Basis could grow ' + fmt(bt.basisCushion) + ' before the test fails.' : 'Short by ' + fmt(-bt.basisCushion) + ' of basis at this bond amount.') : null,
            bt.flags.join(' ') || null, bt.citation].filter(Boolean).join(' '));
      }
      row('CHFA per-project limit', basis.cap.applied ? fmt(basis.cap.amount) : 'Not applied', (basis.cap.reason || basis.cap.citation || '') + (basis.cap.applied ? ' ' + costBasisModule().APPLICANT_LIMIT_NOTE : ''));
      row('Method Two: gap calculation', basis.gapMethod.applied ? fmt(basis.gapMethod.credit) : 'Not calculated',
        basis.gapMethod.applied ? (basis.gapMethod.binding ? basis.gapMethod.reason : 'Uses not covered by sources other than federal and state credit equity: ' + fmt(Math.max(0, basis.gapMethod.gap)) + ', divided by the credit price and 10 years (' + basis.gapMethod.citation + ').') : basis.gapMethod.reason);
      var m3 = basis.costLimitMethod || {};
      row('Method Three: cost basis limits (draft)', m3.checked ? fmt(m3.credit) : 'Not checked',
        m3.checked ? (m3.lower ? 'Lower than the capacity below: CHFA would reserve no more than ' + fmt(m3.credit) + ' if these limits are adopted. ' : '') + m3.reason : m3.reason);
      row('Credit capacity', money(basis.capacity, 'Not available'), basis.capacity == null && basis.reasons.capacity ? basis.reasons.capacity
        : 'The smaller of Method One and Method Two. Method Three uses limits from CHFA\'s 2027 workbook under a draft QAP, so it is shown above but not applied.');
    }

    heading('Cost per unit and per square foot');
    var psf = cbr.costPerSf;
    // DOH's hard, land and soft cost per unit and per square foot of the units.
    [['Hard cost per unit', psf.hardPerUnit, 0], ['Land cost per unit', psf.landPerUnit, 0], ['Soft cost per unit', psf.softPerUnit, 0],
      ['Hard cost per residential SF', psf.hardPerSf, 2], ['Land cost per residential SF', psf.landPerSf, 2], ['Soft cost per residential SF', psf.softPerSf, 2]].forEach(function (p) {
      row(p[0], p[1].value == null ? p[1].reason : p[2] ? '$' + p[1].value.toFixed(2) : fmt(p[1].value),
        p[0] === 'Hard cost per unit' ? 'Hard cost is the lines DOH counts in its hard-cost evaluation: existing structures, site improvements, permit and tap fees, construction, general requirements, contractor overhead and profit, and the contingencies.' : null);
    });
    [['Contractor contract per gross SF', psf.contractPerGrossSf], ['Contractor contract per residential SF', psf.contractPerResidentialSf],
      ['Total development cost per gross SF', psf.totalPerGrossSf], ['Total development cost per residential SF', psf.totalPerResidentialSf]].forEach(function (p) {
      row(p[0], p[1].value == null ? p[1].reason : '$' + p[1].value.toFixed(2));
    });

    if ((sum.contingencies || []).length) {
      heading('Contingencies');
      sum.contingencies.forEach(function (c) {
        row(c.label, c.remaining == null ? c.reason : fmt(c.remaining) + ' remaining', 'Original ' + fmt(c.original) + (c.used == null ? '' : ' · proposed use ' + fmt(c.used)));
      });
    }

    heading('Debt coverage (CHFA underwriting)');
    var uw = cbr.underwriting;
    row('Lowest coverage, years 1-' + (uw.minimum.status.rule ? uw.minimum.status.rule.forecast_years : 15),
      uw.minimum.lowest == null ? uw.minimum.reason : uw.minimum.lowest.toFixed(2) + 'x · ' + (uw.minimum.passes ? 'meets' : 'below') + ' the 1.15x minimum',
      uw.minimum.status.citation || null);
    row('Coverage in year 1', uw.high.firstYear == null ? uw.high.reason : uw.high.firstYear.toFixed(2) + 'x' + (uw.high.exceeds ? ' · above 1.30x, CHFA may award less credit' : ''),
      uw.high.status.citation || null);

    heading('Budget checks');
    var ci = cbr.constructionInterest;
    if (ci) row('Construction interest budget', ci.passes == null ? ci.reason : fmt(ci.budget) + (ci.passes ? ' · covers the estimate' : ' · ' + fmt(ci.shortfall) + ' below the estimate'),
      ci.estimate != null ? 'Estimate: loan x rate x months x average share drawn = ' + fmt(ci.estimate) + '. A draw schedule from the lender replaces this estimate.' : null);
    var orc = cbr.operatingReserve;
    if (orc) row('Operating reserve', orc.passes == null ? orc.reason : fmt(orc.reserve) + (orc.months != null ? ' · ' + orc.months.toFixed(1) + ' months of expenses and debt service' : '') + (orc.passes ? ' · meets CHFA\'s minimum' : ' · below CHFA\'s minimum of ' + fmt(orc.minimum)),
      orc.citation ? 'CHFA requires at least four months of operating expenses plus four months of debt service (' + orc.citation + '). Expenses here include property taxes.' : null);
    var dfr = cbr.deferredFee;
    if (dfr) row('Deferred developer fee repaid by year ' + (dfr.years || 15), dfr.passes == null ? dfr.reason
      : dfr.fee === 0 ? 'No fee deferred' : dfr.passes ? 'Yes, in year ' + dfr.yearRepaid : 'No: ' + fmt(dfr.owed) + ' still owed',
      dfr.citation ? 'CHFA reviews whether cash flow can pay the deferred fee over its 15-year pro forma (' + dfr.citation + '). A deferred fee that cash flow cannot repay may not count in eligible basis.' : null);

    var pay = cbr.payIn;
    // Credit equity is $0 outside CHFA LIHTC, so there is nothing to pay in.
    if (chfa) {
      heading('Equity pay-in');
      [['Federal credit equity', pay.federal], ['State credit equity', pay.state],
        [(cbr.addedCredit && cbr.addedCredit.label || 'Added credit') + ' equity (gross)', pay.added]].forEach(function (p) {
        if (!p[1]) return;
        row(p[0], p[1].installments ? p[1].installments.map(function (i) { return fmt(i.amount); }).join(' / ') : p[1].reason,
          p[1].installments ? 'Closing / completion / stabilization' : null);
      });
      if (cbr.stateCredit.entered) row('State credit allowed (annual)', money(cbr.stateCredit.allowedAnnual, cbr.stateCredit.reason),
        [cbr.stateCredit.capReason, cbr.stateCredit.years ? 'Claimed over the ' + cbr.stateCredit.years + '-year allocation (' + cbr.stateCredit.termCitation + ').' : null,
          cbr.stateCredit.fees ? 'Equity ' + fmt(cbr.stateCredit.grossEquity) + ' less ' + fmt(cbr.stateCredit.fees) + ' investor fees.' : null].filter(Boolean).join(' ') || null);
    }

    heading('Rules');
    (cbr.rules || []).forEach(function (r) {
      row(r.key.replace(/_/g, ' '), r.applied ? 'Applied' : r.reason, r.applied ? r.citation : null);
      if (r.draft) row(r.key.replace(/_/g, ' ') + ' (draft)', 'Shown, not applied', r.draft.location || null);
    });
    if (cbr.rulesVersion) rows.push('<p style="font-size:var(--tiny);color:var(--muted);margin:.35rem 0 0;">Rules file version ' + _escHtml(cbr.rulesVersion) + ': data/policy/lihtc-underwriting-rules.json. No draft rules are recorded unless listed above.</p>');
    var detail = el('dc-cb-detail');
    if (detail) detail.innerHTML = rows.join('');

    var fees = el('dc-cb-fee-tests');
    if (fees) {
      var dev = cbr.developerFee, con = cbr.contractorFee;
      var devText = dev.passes == null ? 'Developer fee test: ' + dev.reason
        : 'Developer plus consultant fee ' + fmt(dev.fee) + (dev.passes ? ' is within' : ' is above') + ' CHFA\'s ' + (dev.limitPct * 100).toFixed(0) + '% limit of ' + fmt(dev.limit)
          + ' (base ' + fmt(dev.base) + ', tested before deferral).' + (dev.passes ? '' : ' The ' + fmt(dev.excess) + ' excess' + (cbr.feeExcess && cbr.feeExcess.developer < dev.excess - 0.5 ? ' (' + fmt(cbr.feeExcess.developer) + ' of it in basis)' : '') + ' comes out of eligible basis.');
      var conText = con.passes == null ? 'Contractor fee test: ' + con.reason
        : 'Contractor overhead and profit ' + fmt(con.fee) + (con.passes ? ' is within' : ' is above') + ' CHFA\'s ' + (con.limitPct * 100).toFixed(0) + '% limit of ' + fmt(con.limit) + '.'
          + (con.passes ? '' : ' The ' + fmt(cbr.feeExcess && cbr.feeExcess.contractor !== null ? cbr.feeExcess.contractor : con.excess) + ' in basis above the limit comes out of eligible basis.');
      fees.innerHTML = '<p style="margin:0 0 .3rem;' + (dev.passes === false ? 'color:var(--bad,#b91c1c);font-weight:600;' : '') + '">' + _escHtml(devText) + '</p>'
        + (cbr.feeBase && cbr.feeBase.note ? '<p style="margin:0 0 .3rem;font-size:var(--tiny);color:var(--muted);">' + _escHtml(cbr.feeBase.note) + '</p>' : '')
        + (cbr.dohFeeShare ? '<p data-doh-fee-share style="margin:0 0 .3rem;font-size:var(--tiny);color:var(--muted);">' + _escHtml(cbr.dohFeeShare.value == null
          ? 'Division of Housing (DOH) developer fee share: ' + cbr.dohFeeShare.reason
          : 'Division of Housing (DOH) developer fee share: ' + (cbr.dohFeeShare.value * 100).toFixed(1) + '% of total cost less the fee, reserves and acquisition (' + fmt(cbr.dohFeeShare.fee) + ' of ' + fmt(cbr.dohFeeShare.base)
            + '). DOH\'s spreadsheet shows this, counting its administration fee; CHFA\'s limit above tests the developer and consultant fees and is what changes basis.') + '</p>' : '')
        + '<p style="margin:0;' + (con.passes === false ? 'color:var(--bad,#b91c1c);font-weight:600;' : '') + '">' + _escHtml(conText) + '</p>';
    }

    var bud = el('dc-budget-breakdown');
    if (bud) {
      var cb = costBasisModule();
      var b = result.budget || {};
      if (!b.groups) bud.innerHTML = '<dt>' + _escHtml(b.reason || 'Itemize development costs.') + '</dt><dd></dd><dd></dd>';
      else {
        var total = result.tdc;
        var cells = cb.GROUPS.map(function (g) {
          var v = b.groups[g.id];
          return '<dt style="color:var(--muted);">' + _escHtml(g.label) + '</dt><dd style="text-align:right;color:var(--muted);">' + (total > 0 ? (100 * v / total).toFixed(0) + '%' : '—') + '</dd><dd style="text-align:right;font-weight:700;">' + fmt(v) + '</dd>';
        });
        cells.push('<dt style="color:var(--muted);">Not itemized</dt><dd style="text-align:right;color:var(--muted);">' + (total > 0 ? (100 * b.notItemized / total).toFixed(0) + '%' : '—') + '</dd><dd style="text-align:right;font-weight:700;">' + fmt(b.notItemized) + '</dd>');
        cells.push('<dt style="border-top:1px solid var(--border);padding-top:.35rem;font-weight:700;">Total Development Cost</dt><dd style="border-top:1px solid var(--border);padding-top:.35rem;text-align:right;">100%</dd><dd style="border-top:1px solid var(--border);padding-top:.35rem;text-align:right;font-weight:700;">' + fmt(total) + '</dd>');
        bud.innerHTML = cells.join('');
      }
    }
  }

  function renderDealResult(result, inputs) {
    var scheduleMode = result.scheduleMode;
    function fmt(n) {
      if (!isFinite(n)) return '—';
      return '$' + Math.round(n).toLocaleString('en-US');
    }
    function fmtPct(n) {
      if (!isFinite(n) || n === 0) return '—';
      return (n * 100).toFixed(1) + '%';
    }
    function vacFrac() { return result.vacancyRate; }
    // Numbers only: several of these are written into the page as HTML.
    function numeric(value) { return value == null ? NaN : Number(value); }
    var tdc = numeric(result.tdc);
    var units = numeric(result.units);
    var totalGrant = numeric(result.totalGrant);
    var totalLoanPrincipal = numeric(result.totalLoanPrincipal);
    var totalSoftDebtService = numeric(result.totalSoftDebtService);
    var trancheBreakdown = result.trancheBreakdown;
    var impactGrant = numeric(result.impactGrant);
    var annualRents = numeric(result.annualRents);
    var amiUnitSum = numeric(result.amiUnitSum);
    var marketRegime = result.marketRegime;
    var chfaRegime = result.chfaRegime;
    var allowanceRevenueReason = result.allowanceRevenueReason;
    var capOn = result.capOn;
    var perBrMarket = result.perBrMarket;
    var pricedRows = result.pricedRows;
    var manualMarket = result.manualMarket;
    var capBindings = result.capBindings;
    var minimumSetAsideResult = result.minimumSetAsideResult;
    var lihtcUnits = numeric(result.lihtcUnits);
    var applicableFraction = numeric(result.applicableFraction);
    var eligibleBasisRaw = numeric(result.eligibleBasisRaw);
    var eligibleBasis = numeric(result.eligibleBasis);
    var annualCredits = numeric(result.annualCredits);
    var equity = numeric(result.equity);
    var unitMixError = result.unitMixError;
    var devFeeTotal = numeric(result.devFeeTotal);
    var deferredPctSlider = numeric(result.deferredPctSlider);
    var autoBalance = result.autoBalance;
    var deferredDevFee = numeric(result.deferredDevFee);
    var noi = numeric(result.noi);
    var netPropTax = result.netPropTax;
    var taxSavings = numeric(result.taxSavings);
    var dcr = numeric(result.dcr);
    var mc = numeric(result.mc);
    var mortgage = numeric(result.mortgage);
    var noiUnknownReason = result.noiUnknownReason;
    var rentsUnknownReason = result.rentsUnknownReason;
    var capRate = result.capRate;
    var annualDebtService = numeric(result.annualDebtService);
    var breakEvenOcc = result.breakEvenOcc;
    var dscrAutoMode = result.dscrAutoMode;
    var baseDSCR = result.baseDSCR;
    var stress = result.stress;
    var deferredCap = numeric(result.deferredCap);
    var gapBeforeDeferred = numeric(result.gapBeforeDeferred);
    var devFeeAtClosing = numeric(result.devFeeAtClosing);
    var gap = numeric(result.gap);
    var exit = result.exit;
    var tornado = result.tornado;
    var budget = result.budget;
    var fundingGap = numeric(result.fundingGap);
    var gapPct = numeric(result.gapPct);
    var hasWorkforceUnits = result.hasWorkforceUnits;
    var achResult = result.achResult;
    var simpleGap = numeric(result.simpleGap);
    var totalSoftSourceAmt = numeric(result.totalSoftSourceAmt);
    var sensitivityKnown = result.sensitivityKnown;
    var tranches = inputs.tranches;
    var autoNoi = document.getElementById('dc-auto-noi');
    renderManualMarket(result);
    updateDealModeUi();
    renderForSaleFeasibility(result.forSale);
    _rentScheduleSnapshot = { mode: scheduleMode ? 'schedule' : 'manual', rows: pricedRows,
      countyFips: _countyFips, regime: rentLimitRegime(), totalUnits: units, vacancyRate: vacFrac(),
      reason: scheduleMode ? null : _resolvedDealMix.reason,
      sourceMeta: scheduleMode ? _resolvedDealMix.sourceMeta : { countyFips: _countyFips,
        rentLimits: getRentLimitsMetadata(), utilityAllowance: getUtilityAllowanceMetadata(), vacancyRate: vacFrac() } };

    renderMinimumSetAsideStatus(minimumSetAsideResult);

    renderUtilityAllowanceContext(allowanceRevenueReason);

    // Q5: surface the achievable-rent cap status on the UI.
    _renderAchievableCapStatus(capOn, perBrMarket, capBindings);

    // Surface the applicable-fraction math when mixed-income or unrestricted units are present.
    var afNoteEl = document.getElementById('dc-applicable-fraction-note');
    if (afNoteEl) {
      if (lihtcUnits < units && lihtcUnits > 0) {
        var floorFraction = result.costBasis && result.costBasis.basis ? result.costBasis.basis.floorFraction : null;
        afNoteEl.innerHTML =
          '<strong style="color:var(--accent,#096e65);">Mixed-income deal:</strong> ' +
          lihtcUnits + ' LIHTC units / ' + units +
          ' total residential = unit fraction ' + (100 * lihtcUnits / units).toFixed(1) + '%; floor-space fraction ' +
          (floorFraction == null ? '<strong>not entered</strong> (enter both floor areas)' : (floorFraction * 100).toFixed(1) + '%') +
          '. Applicable fraction (the lower) <strong>' + (isFinite(applicableFraction) ? (applicableFraction * 100).toFixed(1) + '%' : 'unavailable') + '</strong>. ' +
          'Qualified basis ' + fmt(result.basisForApplicableFractionNote) +
          ' (vs ' + fmt(eligibleBasisRaw) + ' if 100% LIHTC). ' +
          'Market-rate and unrestricted units generate rent but no federal LIHTC credits per IRC §42(c)(1)(B).';
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
      } else if (units > 0 && amiUnitSum < units) {
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
    if (unitMixError) {
      var msaStatus = document.getElementById('dc-minimum-set-aside-status');
      if (msaStatus && chfaRegime) {
        msaStatus.innerHTML = '<strong>Not evaluated.</strong> AMI-tier units (' + amiUnitSum +
          ') exceed Total Units (' + units + '), so the minimum set-aside cannot be tested. ' +
          'Fix the unit mix above.';
        msaStatus.style.borderColor = 'var(--warn,#d97706)';
      }
    }
    var devfeeEl = document.getElementById('dc-r-devfee');
    if (devfeeEl) devfeeEl.textContent = tdc > 0 ? fmt(devFeeTotal) : '—';
    if (autoNoi && autoNoi.checked) {
      var noiComputedEl = document.getElementById('dc-noi-computed');
      if (noiComputedEl) noiComputedEl.textContent = isFinite(noi) ? fmt(noi) : '—';
    }
    // H — Refresh deferred + closing display now that auto-balance has
    // finalized the deferredDevFee value. (devFeeTotal is invariant.)
    var deferredEl = document.getElementById('dc-r-deferred');
    var devfeeClosingEl = document.getElementById('dc-r-devfee-closing');
    if (deferredEl) deferredEl.textContent = tdc > 0 ? fmt(deferredDevFee) : '—';
    if (devfeeClosingEl) devfeeClosingEl.textContent = tdc > 0 ? fmt(devFeeAtClosing) : '—';
    // Mark the deferred row so the user sees the auto-balance decision.
    var autoNote = document.getElementById('dc-deferred-auto-note');
    if (autoNote) {
      if (autoBalance && !isFinite(gapBeforeDeferred)) {
        // NaN fails every comparison below, which used to land on "Deal is
        // balanced" — a verdict about a gap nobody could compute.
        autoNote.textContent = 'Nothing to balance yet: the funding gap depends on the first mortgage, which needs a known NOI. ' +
          (noiUnknownReason || rentsUnknownReason || '');
        // Rental sizing only: an ownership deal has no NOI-sized first
        // mortgage, and must not show rental/LIHTC terms (PC-2).
        autoNote.hidden = currentDealMode() === 'ownership';
      } else if (autoBalance) {
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
    // #2160: an unknown basis, credit or equity names its reason.
    function basisText(value, key) {
      return tdc > 0 ? (isFinite(value) ? fmt(value) : 'Unavailable — ' + (result.unavailable[key] || 'Not available for these inputs.')) : '—';
    }
    document.getElementById('dc-r-basis').textContent = chfaRegime ? basisText(eligibleBasis, 'eligibleBasis') : 'Not applicable';
    document.getElementById('dc-results').style.gridTemplateColumns = chfaRegime ? '1fr auto' : 'minmax(0, 1fr) minmax(0, 1.5fr)';
    [['dc-r-credits', annualCredits], ['dc-r-equity', equity]].forEach(function (entry) {
      var el = document.getElementById(entry[0]);
      el.textContent = chfaRegime ? basisText(entry[1], entry[0] === 'dc-r-credits' ? 'annualCredits' : 'equity') : NO_LIHTC_CREDITS;
      el.dataset.lihtcApplicable = String(chfaRegime);
      el.style.fontSize = chfaRegime ? '' : 'var(--tiny)';
      el.style.marginLeft = chfaRegime ? '' : '0';
    });
    document.getElementById('dc-r-rents').textContent = fmt(annualRents);
    explainFigure('dc-r-rents', 'scheduled-rent-revenue', { rows: pricedRows,
      unavailableReason: isFinite(annualRents) ? null : rentsUnknownReason,
      sources: explanationSourceContext() + (scheduleMode ? ' · allowance: ' + (_resolvedDealMix.sourceMeta.allowanceBasis.reference || _resolvedDealMix.sourceMeta.allowanceBasis.method) +
        ' · effective ' + (_resolvedDealMix.sourceMeta.allowanceBasis.effectiveDate || 'date not required') +
        ' · market-rent sources: ' + _resolvedDealMix.marketRows.map(function (r) { return r.source; }).join('; ') :
        ' · unrestricted market rents: ' + (manualMarket.source || 'no unrestricted units')) });

    // #2160: budget totals come from the itemized cost lines.
    renderCostBasis(result, fmt);
    renderAddedCredit(result, fmt);
    renderOperatingBudget(result, fmt);
    renderPermanentFinancing(result, fmt);
    renderDohSchedules(result, fmt);

    // F257-6 — "How to adjust" advisory. Surfaces 2-3 short levers when
    // the deal is marginal. Drives off the same equity / mortgage / NOI
    // figures already computed above.
    try {
      var adjustWrap = document.getElementById('dc-adjust-guidance');
      var adjustList = document.getElementById('dc-adjust-guidance-list');
      if (adjustWrap && adjustList && tdc > 0) {
        var levers = [];
        // Wide gap → suggest deeper income targeting + basis boost
        if (gapPct > 0.30) {
          levers.push(
            '<strong>Funding gap is wide (' + Math.round(gapPct * 100) + '% of TDC, ~' + fmt(fundingGap) + ').</strong> ' +
            'Consider deepening the AMI mix to attract more soft funding (DOH HHPG, Prop 123, HOME), checking whether the site sits inside a QCT or DDA for the 130% basis boost, or right-sizing the unit count so the supportable mortgage is a larger share of the stack.'
          );
        } else if (gapPct > 0.15) {
          levers.push(
            '<strong>Moderate funding gap (' + Math.round(gapPct * 100) + '% of TDC, ~' + fmt(fundingGap) + ').</strong> ' +
            'A typical state-credit or DOH gap-funding layer in the 10-20% range usually closes a gap of this size — confirm the current DOH NOFA timing alongside the CHFA LOI deadline.'
          );
        }
        // Thin supportable mortgage → suggest construction-type and AMI levers
        if (mortgage > 0 && tdc > 0 && mortgage < tdc * 0.35) {
          levers.push(
            '<strong>Supportable mortgage covers ~' + Math.round(100 * mortgage / tdc) + '% of TDC.</strong> ' +
            'When debt carry is thin, common levers are: pick a lower-cost construction type (a 3-story walk-up or townhome typically pencils at $200-280k/unit vs $300-380k/unit for mid-rise), shift the AMI mix toward 50% / 60% to lift achievable rents, or stack additional soft debt to reduce hard-debt obligations.'
          );
        }
        // Workforce/market tiers above 60% → flag achievable-rent risk
        if (hasWorkforceUnits) {
          var capChk = document.getElementById('dc-achievable-cap');
          if (capChk && !capChk.checked) {
            levers.push(
              '<strong>Workforce / market-rate units in the mix.</strong> ' +
              'The planning ceiling for 70%-120% AMI often exceeds achievable market rent — toggle "Cap 70%-120% AMI rents at market (ZORI)" above to underwrite at min(ceiling, market) per CHFA QAP guidance.'
            );
          }
        }
        if (levers.length === 0) {
          adjustWrap.hidden = true;
        } else {
          adjustList.innerHTML = levers.map(function (s) { return '<li style="margin:.2rem 0;">' + s + '</li>'; }).join('');
          // The levers quote the rental LIHTC gap — keep the box out of
          // ownership mode even though this runs after updateDealModeUi().
          adjustWrap.hidden = currentDealMode() === 'ownership';
        }
      }
    } catch (_) { /* never break recalc on advisory render */ }

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
    function _setMargin(id, delta) {
      var el = document.getElementById(id);
      if (!el) return;
      if (delta == null || !isFinite(delta)) { el.textContent = '—'; return; }
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
    _setDscr('dc-all-must-pay-dscr', result.allMustPayDSCR);
    var debtSummary = document.getElementById('dc-loan-coverage');
    if (debtSummary) {
      var coverage = result.coverage;
      var weakest = function (record) { return record ? 'year ' + record.year + ' (' + record.ratio.toFixed(2) + 'x)' : 'unavailable — needs known NOI and positive scheduled debt service'; };
      debtSummary.textContent = coverage ? coverage.measuredYears + ' of ' + coverage.years.length + ' forecast years have known NOI and loan terms. Weakest measured senior coverage: ' + weakest(coverage.weakestSenior) +
        ' · Weakest measured all must-pay coverage: ' + weakest(coverage.weakestAllMustPay) +
        '. Regular operating payments only; maturity balloons below require repayment or refinancing.'
        : 'Unavailable — ' + (result.unavailable.coverage || 'Enter loan terms and NOI.');
    }
    var mortgageLabel = document.getElementById('dc-mortgage-label');
    if (mortgageLabel) mortgageLabel.textContent = result.seniorMode === 'entered' ? 'Entered senior mortgage' : 'Supportable First Mortgage';
    var enteredSenior = document.getElementById('dc-senior-amount');
    if (enteredSenior) enteredSenior.disabled = result.seniorMode !== 'entered';

    var targetNote = document.getElementById('dc-dscr-target-note');
    if (targetNote) {
      if (baseDSCR != null && isFinite(baseDSCR)) {
        targetNote.textContent = (result.seniorMode === 'entered' ? 'Entered senior amount; coverage is measured.' : 'Sized from NOI and target DCR ' + dcr.toFixed(2) + 'x after must-pay soft debt.') + ' Stress tests use all must-pay operating debt; balloons are shown separately.';
      } else {
        targetNote.textContent = 'Enter NOI (or enable auto-compute) and mortgage terms to see DSCR.';
      }
    }

    var allCoverageEl = document.getElementById('dc-all-must-pay-dscr');
    if (allCoverageEl && result.allMustPayDSCR === null) allCoverageEl.textContent = 'Unavailable — ' + result.unavailable.allMustPayDSCR;
    var manualNote = document.getElementById('dc-dscr-manual-note');
    var stressTableEl = document.getElementById('dc-dscr-stress-table');
    if (manualNote && stressTableEl) {
      if (!manualNote.dataset.defaultText) manualNote.dataset.defaultText = manualNote.textContent;
      manualNote.textContent = manualNote.dataset.defaultText;
      if (stress) {
        manualNote.style.display = 'none';
        stressTableEl.style.display = '';
      } else {
        manualNote.style.display = '';
        stressTableEl.style.display = 'none';
      }
    }

    var baseRow = result.stressBase;
    document.getElementById('dc-stress-base-noi').textContent = baseRow ? fmt(baseRow.noi) : '—';
    _setDscr('dc-stress-base-dscr', baseRow && baseRow.dscr);
    _setMargin('dc-stress-base-margin', baseRow && baseRow.margin);
    if (stress) {
      ['rent10', 'vac5', 'opex10', 'combined'].forEach(function (k) {
        var row = stress[k];
        var noiEl = document.getElementById('dc-r-stress-' + k + '-noi');
        if (noiEl) noiEl.textContent = !MoneyFormatter.isAbsent(row.noi) ? fmt(row.noi) : '—';
        _setDscr('dc-r-stress-' + k + '-dscr', row.dscr);
        _setMargin('dc-r-stress-' + k + '-margin', row.margin);
      });
    }

    renderRentLimitContext();

    // ── Render rent-achievability table ────────────────────────────
    // Pulls the AMI-tier rent ceilings from _amiLimits (already populated
    // by HudFmr for the selected county) and the HUD FMR 2BR benchmark
    // via HudFmr.getFmrByFips. Null-safe: shows the "select a county"
    // message when data isn't available yet.
    var achBody = document.getElementById('dc-rent-ach-body');
    var fmrGrid = document.getElementById('dc-rent-ach-fmr-grid');
    var fmrData = inputs.fmrData;

    if (achBody && marketRegime) {
      achBody.innerHTML = DEAL_AMI_BANDS.map(function (tier) {
        return '<tr><td>' + tier + '% AMI</td><td colspan="4">No restricted limit (market-rate)</td></tr>';
      }).join('');
      if (fmrGrid) fmrGrid.style.display = 'none';
    } else if (achBody && achResult) {
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
      achBody.innerHTML = DEAL_AMI_BANDS.map(function (tier) {
        var t = achResult.tiers.find(function (entry) { return entry.pct === tier; });
        if (!t) return '<tr><td>' + tier + '% AMI</td><td colspan="4">' + rentLimitText(rentCeilingFor(tier, '2br')) + '</td></tr>';
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

    var hudMeta = window.HudFmr && window.HudFmr.getMeta && window.HudFmr.getMeta() || {};
    markSource(fmrGrid, countySource({ source: hudMeta.source, sourceUrl: hudMeta.url_fmr,
      sourceValue: fmrData, vintage: hudMeta.fiscal_year, why: 'HUD fair market rents provide the county bedroom-size benchmark.' }), !!fmrData);

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
      } else if (lihtcFeats.length === 0 && hudLihtc && hudLihtc.getSource && hudLihtc.getSource() === 'unavailable') {
        // Every source failed. Say so — an empty table here would read as
        // "no comparable deals exist", which the data never said.
        peersBody.innerHTML = '<tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">LIHTC project data is unavailable right now, so no peer deals can be shown. This is a load failure, not an absence of comparable projects.</td></tr>';
        if (peersEmpty) peersEmpty.style.display = 'none';
      } else if (lihtcFeats.length === 0) {
        peersBody.innerHTML = '<tr><td colspan="5" style="padding:0.5rem;text-align:center;color:var(--muted);font-size:var(--tiny);">Loading LIHTC project database…</td></tr>';
        if (peersEmpty) peersEmpty.style.display = 'none';
        // Trigger a load once if we haven't tried yet
        if (hudLihtc && hudLihtc.load && !window.__dcPeerLoadTried) {
          window.__dcPeerLoadTried = true;
          hudLihtc.load().then(function () { recalculate(); }).catch(function () { recalculate(); });
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
            // Strictly `=== true`. A null here is unknown, not a negative, and
            // must not draw a badge NOR be silently skipped — the note built
            // below says which fields the source withheld.
            if (p.isQct === true)     flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--good-dim,#d1fae5);color:var(--good,#047857);margin-right:3px;" title="Qualified Census Tract">QCT</span>');
            if (p.isDda === true)     flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--info-dim,#dbeafe);color:var(--info,#2563eb);margin-right:3px;" title="Difficult Development Area">DDA</span>');
            if (p.isNonProf === true) flags.push('<span style="display:inline-block;font-size:var(--tiny);padding:1px 5px;border-radius:3px;background:var(--accent-dim,#d1fae5);color:var(--accent,#096e65);margin-right:3px;" title="Non-profit sponsor">NP</span>');
            // Highlight size match
            var sizeProximity = units > 0 ? Math.abs(p.units - units) : null;
            var unitColor = (sizeProximity !== null && sizeProximity <= Math.max(10, units * 0.2)) ? 'var(--good,#047857)' : 'var(--text)';
            return '<tr style="border-bottom:1px solid var(--border);">' +
              '<td style="padding:0.3rem 0.25rem;font-weight:600;">' + p.name +
                (p.creditType !== '—' ? ' <span style="font-size:var(--tiny);color:var(--muted);font-weight:400;">' + p.creditType + '</span>' : '') +
              '</td>' +
              '<td style="padding:0.3rem 0.25rem;color:var(--muted);font-size:var(--tiny);">' + (p.city || '—') + '</td>' +
              '<td style="text-align:right;padding:0.3rem 0.25rem;">' + (p.yearAward || '—') + '</td>' +
              '<td style="text-align:right;padding:0.3rem 0.25rem;font-weight:600;color:' + unitColor + ';">' + (p.units || '—') + '</td>' +
              '<td style="padding:0.3rem 0.25rem;">' + (flags.join('') || '<span style="color:var(--muted);font-size:var(--tiny);">—</span>') + '</td>' +
            '</tr>';
          }).join('');
        }

        // Disclose withheld flags ONCE for the table. A per-row "not
        // published" chip on three columns across eight rows is noise that
        // gets skimmed; a single line under the table is read. Only fields
        // actually withheld are named, and only when no row could supply
        // them — if any comparable has a real value, the badges carry the
        // information and the note would be misleading.
        var flagNote = document.getElementById('dc-peers-flag-note');
        if (flagNote) {
          var withheld = [
            { key: 'isQct',     label: 'QCT' },
            { key: 'isDda',     label: 'DDA' },
            { key: 'isNonProf', label: 'non-profit sponsor' }
          ].filter(function (f) {
            return peers.length > 0 && peers.every(function (p) { return p[f.key] === null; });
          }).map(function (f) { return f.label; });

          if (withheld.length) {
            var isAre = withheld.length === 1 ? 'is' : 'are';
            flagNote.textContent =
              withheld.join(', ') + ' status ' + isAre + ' not published by CHFA for these ' +
              'properties, so no badge above means unknown — not "no". QCT and DDA ' +
              'determine 30% basis boost eligibility; confirm a specific site against ' +
              'HUD\u2019s QCT/DDA maps before relying on it.';
            flagNote.style.display = '';
          } else {
            flagNote.textContent = '';
            flagNote.style.display = 'none';
          }
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
    var impactLabelEl = document.getElementById('dc-su-impact-label');
    var impactNoteEl  = document.getElementById('dc-su-impact-note');
    if (impactLabelEl) {
      impactLabelEl.textContent = 'Soft-funding stack (' + tranches.filter(function (t) { return (t.amount||0) > 0; }).length + ' tranches)';
    }
    if (impactNoteEl) {
      var parts = [];
      var basisGrant = numeric(result.costBasis && result.costBasis.grants && result.costBasis.grants.reduction);
      if (totalGrant > 0) parts.push(fmt(totalGrant) + ' grants' + (isFinite(basisGrant) ? ' (' + fmt(basisGrant) + ' federally funded, which reduces basis)' : ''));
      if (totalLoanPrincipal > 0) parts.push(fmt(totalLoanPrincipal) + ' loans @ ' + fmt(totalSoftDebtService) + '/yr debt service');
      impactNoteEl.textContent = parts.length ? parts.join(' · ') : 'Add tranches to model CHFA / Prop 123 / local PHA stack.';
    }

    // Update Sources & Uses table. Its equity is the credit equity the gap counts: federal,
    // state and any added credit (#2161), less what the added credit replaces or cuts.
    var cs = result.creditStack || { federal: equity, state: result.stateEquity, added: 0 };
    explainFigure('dc-su-gap', 'funding-gap', { tdc: tdc, equity: numeric(dealEngine().creditStackTotal(result)), mortgage: mortgage, grants: impactGrant, softLoans: totalLoanPrincipal, deferred: deferredDevFee,
      unavailableReason: !isFinite(gap) ? (noiUnknownReason || rentsUnknownReason || 'financing sources are unavailable') : tdc > 0 ? null : 'total development cost is missing',
      sources: explanationSourceContext() });
    var su = {
      equity:   { amt: numeric(cs.federal), id: 'dc-su-equity' },
      state:    { amt: numeric(cs.state),   id: 'dc-su-state' },
      added:    { amt: numeric(cs.added),   id: 'dc-su-added' },
      mortgage: { amt: mortgage,           id: 'dc-su-mortgage' },
      deferred: { amt: deferredDevFee,     id: 'dc-su-deferred' },
      impactds: { amt: totalSoftSourceAmt, id: 'dc-su-impact-ds' },
      gap:      { amt: gap,                id: 'dc-su-gap' },
      tdc:      { amt: tdc,                id: 'dc-su-tdc' }
    };
    var stateRow = document.getElementById('dc-su-state-row');
    if (stateRow) stateRow.hidden = !(result.costBasis && result.costBasis.stateCredit && result.costBasis.stateCredit.entered);
    var addedRow = document.getElementById('dc-su-added-row');
    if (addedRow) addedRow.hidden = !cs.counted;
    var addedLabel = document.getElementById('dc-su-added-label');
    if (addedLabel) addedLabel.textContent = (cs.label || 'Added credit') + ' equity, after its investor fees';
    var creditNote = document.getElementById('dc-su-credit-note'), creditNoteRow = document.getElementById('dc-su-credit-note-row');
    var acr = result.costBasis && result.costBasis.addedCredit, noteParts = [];
    if (cs.counted && acr) {
      if (acr.displaced) noteParts.push(acr.displaces + ' equity is ' + fmt(acr.displaced) + ' less, because the ' + cs.label.toLowerCase() + ' replaces part of it.');
      if (acr.resizedFederal) noteParts.push('Federal credit equity is ' + fmt(acr.resizedFederal) + ' less for the federal credit cut.');
    } else if (cs.reason) noteParts.push(cs.reason);
    if (creditNote) creditNote.textContent = noteParts.join(' ');
    if (creditNoteRow) creditNoteRow.hidden = !noteParts.length;
    ['equity', 'state', 'added', 'mortgage', 'deferred', 'impactds', 'gap', 'tdc'].forEach(function (key) {
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
          var label = _escHtml(progLabels[t.program] || t.program) +
            ' — ' + (t.mode === 'grant'
              ? '<span style="color:var(--accent)">grant</span>'
              : _escHtml(dealEngine().LOAN_TYPES[t.loanType] || 'Repayment type unavailable') + ' · ' + (t.rate == null ? 'rate unavailable' : t.rate + '%') + ' · maturity ' + (t.maturity == null ? 'unavailable' : 'year ' + t.maturity));
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

    (function renderExit() {
      if (!document.getElementById('dc-exit-hold') || !document.getElementById('dc-exit-cap')) return;
      var holdYears = numeric(exit.holdYears);
      var exitCap = numeric(exit.exitCap);
      var rentGrowth = numeric(exit.rentGrowth);
      var expGrowth = numeric(exit.expGrowth);
      var nNoi = numeric(exit.nNoi);
      var resale = numeric(exit.resale);
      var firstMortBal = numeric(exit.firstMortBal);
      var softBal = numeric(exit.softBal);
      var netProceeds = numeric(exit.netProceeds);
      var irr = numeric(exit.irr);
      var dfYr = exit.dfYr;
      // Write to DOM
      function _setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
      _setText('dc-exit-noi',    isFinite(nNoi)    ? fmt(nNoi)    : '—');
      _setText('dc-exit-resale', isFinite(resale)  ? fmt(resale)  : '—');
      _setText('dc-exit-mortbal', tdc > 0 ? fmt(firstMortBal) : '—');
      _setText('dc-exit-softbal', tdc > 0 ? fmt(softBal)      : '—');
      _setText('dc-exit-net',    isFinite(netProceeds) ? fmt(netProceeds) : '—');
      // An asset management fee still owed at the sale comes out of it (DOH PR 4).
      // The line exists only while something is owed, so the panel is unchanged otherwise.
      var assetOwed = numeric(exit.assetMgmtOwed), assetDd = document.getElementById('dc-exit-assetmgmt');
      var softDd = document.getElementById('dc-exit-softbal');
      if (isFinite(assetOwed) && assetOwed > 0 && softDd) {
        if (!assetDd) {
          var assetDt = document.createElement('dt');
          assetDt.id = 'dc-exit-assetmgmt-label';
          assetDt.style.color = 'var(--muted)';
          assetDt.textContent = 'Accrued asset management fee owed';
          assetDd = document.createElement('dd');
          assetDd.id = 'dc-exit-assetmgmt';
          assetDd.style.cssText = 'margin:0;text-align:right;font-weight:700;';
          softDd.parentNode.insertBefore(assetDt, softDd.nextSibling);
          softDd.parentNode.insertBefore(assetDd, assetDt.nextSibling);
        }
        assetDd.textContent = fmt(assetOwed);
      } else if (assetDd) {
        var oldDt = document.getElementById('dc-exit-assetmgmt-label');
        if (oldDt) oldDt.remove();
        assetDd.remove();
      }
      _setText('dc-exit-defyr',  dfYr ? 'Year ' + dfYr : !isFinite(holdYears) ? '—' : (deferredDevFee > 0 ? '> ' + holdYears + 'y' : 'n/a'));
      // The row labels name the year and the cap actually used.
      _setText('dc-exit-noi-label', isFinite(holdYears) ? 'Year-' + holdYears + ' stabilized NOI' : 'Sale-year stabilized NOI');
      _setText('dc-exit-resale-label', isFinite(holdYears) && isFinite(exitCap)
        ? 'Resale value (year-' + holdYears + ' NOI ÷ ' + (exitCap * 100).toFixed(2) + '% cap)' : 'Resale value (NOI ÷ exit cap)');
      var wfx = result.waterfall, sponsorIrr = wfx ? numeric(wfx.sponsorIrr) : NaN;
      [['dc-exit-sponsor-irr', sponsorIrr, true], ['dc-exit-irr', irr, false]].forEach(function (p) {
        var el = document.getElementById(p[0]);
        if (!el) return;
        el.textContent = Number.isFinite(p[1]) ? (p[1] * 100).toFixed(1) + '%' : '—';
        el.style.color = !Number.isFinite(p[1]) || !p[2] ? '' : p[1] >= 0.08 ? 'var(--good, #047857)' : p[1] > 0 ? 'var(--accent)' : 'var(--warn, #d97706)';
      });
      var notesEl = document.getElementById('dc-exit-notes');
      if (notesEl) {
        var notes = [];
        var exitReason = result.unavailable['exit.holdYears'] || result.unavailable['exit.exitCap'];
        if (exitReason) notes.push(exitReason);
        if (isFinite(holdYears)) notes.push('Year-' + holdYears + ' NOI with rents changing ' + (rentGrowth * 100).toFixed(1) +
                   '%/yr and ' + (expGrowth * 100).toFixed(1) + '%/yr expense inflation.');
        if (isFinite(resale)) {
          notes.push('Resale capitalizes year-' + holdYears + ' NOI at ' + (exitCap * 100).toFixed(2) + '% exit cap.');
        }
        if (isFinite(netProceeds)) {
          // No public source gives a default selling cost, so none is invented.
          notes.push('Net sale proceeds are before selling costs (broker, transfer and closing costs are not subtracted).');
        }
        if (isFinite(sponsorIrr)) {
          notes.push('The sponsor\'s return counts the deferred fee (' + fmt(deferredDevFee) + ') as its money in and only the cash the partnership split pays the sponsor: ' +
                     fmt(numeric(wfx.sponsorCash)) + ' over the hold, under the deal terms in the partnership panel.');
        } else if (deferredDevFee > 0 && !exitReason) {
          notes.push('Sponsor\'s return unavailable: ' + (result.unavailable['waterfall.sponsorIrr'] || result.unavailable.waterfall || 'the partnership split is unavailable.'));
        }
        if (isFinite(irr)) {
          notes.push('The second return counts every dollar of yearly cash and sale proceeds as coming back on the fee, including the investor\'s share, so it overstates what the sponsor keeps. Neither counts predevelopment spending, other GP equity or tax benefits.');
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
    // Every bar but equity is NOI or mortgage under a perturbation. With no
    // known rent roll each of them is an unknown drawn as a $0 bar, so show
    // why instead of a chart.
    var tornadoMount = document.getElementById('tornadoChartMount');
    if (tornadoMount && tdc > 0 && !sensitivityKnown) {
      var rollKnown = isFinite(noi) && !rentsUnknownReason;
      tornadoMount.innerHTML = '<p style="font-size:var(--small);color:var(--muted);margin:.5rem 0;">' +
        (rollKnown && result.basisUnknownReason
          ? 'Sensitivity needs a known credit amount. ' + _escHtml(result.basisUnknownReason)
          : 'Sensitivity needs a known NOI and rent roll. ' + ((!isFinite(noi) && noiUnknownReason) || rentsUnknownReason || '')) + '</p>';
    }
    if (window.TornadoSensitivity && tdc > 0 && sensitivityKnown && tornadoMount) {
      try {
        var eqP = numeric(tornado.eqP);
        var ir = numeric(tornado.ir);
        var vu = numeric(tornado.vu);
        var ou = numeric(tornado.ou);
        var eqLo = numeric(tornado.eqLo);
        var eqHi = numeric(tornado.eqHi);
        var mortLo = numeric(tornado.mortLo);
        var mortHi = numeric(tornado.mortHi);
        var noiLo = numeric(tornado.noiLo);
        var noiHi = numeric(tornado.noiHi);
        var vacLoEgi = numeric(tornado.vacLoEgi);
        var vacHiEgi = numeric(tornado.vacHiEgi);

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
              // vacFrac() * 100 is binary floating point: 7% arrives as
              // 7.000000000000001 and was printed that way. Round to the
              // tenth the input is entered in.
              note: 'Vacancy ' + (Math.round(Math.max(1, vu - 2) * 10) / 10) + '% to ' +
                (Math.round(Math.min(15, vu + 2) * 10) / 10) + '%',
              color: '#059669' }
          ]
        }, 'tornadoChartMount');
      } catch (e) {
        console.warn('[deal-calculator] Tornado sensitivity error:', e.message);
      }
    }

    // Rent-based outputs stay blocked even when a manual NOI or deferred fee
    // is entered: those independent inputs do not make the rent roll known.
    var rentOutputs = ['dc-r-rents', 'dc-r-beo'];
    var noiOutputs = ['dc-noi-computed', 'dc-r-noi-stab', 'dc-r-mortgage', 'dc-su-mortgage', 'dc-su-gap',
      'dc-r-cap-rate', 'dc-r-ads', 'dc-r-dscr-base', 'dc-dscr-target-note', 'dc-dscr-manual-note'];
    var exitOutputs = ['dc-exit-noi', 'dc-exit-resale', 'dc-exit-mortbal', 'dc-exit-softbal',
      'dc-exit-net', 'dc-exit-defyr', 'dc-exit-irr', 'dc-exit-sponsor-irr', 'dc-exit-notes'];
    var missingMarketOutputs = rentOutputs.concat(autoNoi && autoNoi.checked ? noiOutputs : []);
    rentOutputs.concat(noiOutputs, exitOutputs).forEach(function (id) {
      var el = document.getElementById(id);
      var exitBlocked = !isFinite(annualRents) && exitOutputs.indexOf(id) !== -1;
      var blocked = exitBlocked || (manualMarket.unavailableReason && missingMarketOutputs.indexOf(id) !== -1);
      el.dataset.unavailableReason = blocked ? (manualMarket.unavailableReason || 'rent_roll_unavailable') : '';
      if (blocked) el.textContent = 'Unavailable — ' + (manualMarket.message || rentsUnknownReason);
    });
    var reason = result.noiUnknownReason || result.rentsUnknownReason;
    var dependent = {
      'dc-noi-computed': 'noi', 'dc-r-noi-stab': 'noi', 'dc-r-mortgage': 'mortgage',
      'dc-su-mortgage': 'mortgage', 'dc-su-gap': 'gap', 'dc-r-ads': 'annualDebtService',
      'dc-r-deferred': 'deferredDevFee', 'dc-su-deferred': 'deferredDevFee',
      'dc-r-devfee-closing': 'devFeeAtClosing', 'dc-r-cap-rate': 'capRate',
      'dc-r-beo': 'breakEvenOcc', 'dc-r-dscr-base': 'baseDSCR',
      'dc-stress-base-noi': 'noi', 'dc-stress-base-dscr': 'allMustPayDSCR', 'dc-all-must-pay-dscr': 'allMustPayDSCR'
    };
    Object.keys(dependent).forEach(function (id) {
      var el = document.getElementById(id), key = dependent[id];
      if (!el) return;
      if (result[key] == null) {
        el.dataset.unavailableReason = manualMarket.unavailableReason || result.unavailable[key] || reason;
        el.textContent = 'Unavailable — ' + (result.unavailable[key] || reason);
      } else delete el.dataset.unavailableReason;
    });
    delete document.getElementById('dc-adjust-guidance-list').dataset.unavailableReason;
    var exitReason = result.exit.nNoi == null ? result.unavailable['exit.nNoi'] : null;
    if (result.exit.loanUnavailableReason) {
      ['dc-exit-mortbal', 'dc-exit-softbal', 'dc-exit-net', 'dc-exit-defyr', 'dc-exit-irr'].forEach(function (id) {
        var el = document.getElementById(id);
        el.dataset.unavailableReason = result.exit.loanUnavailableReason;
        el.textContent = 'Unavailable — ' + result.exit.loanUnavailableReason;
      });
    }
    if (exitReason) exitOutputs.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.dataset.unavailableReason = manualMarket.unavailableReason || exitReason; el.textContent = 'Unavailable — ' + exitReason; }
    });
    // A cap rate the exit cannot use leaves the NOI known but no price, so the
    // price and everything paid from it say why.
    var capReason = !exitReason && result.exit.exitCap == null ? result.unavailable['exit.exitCap'] : null;
    if (capReason) ['dc-exit-resale', 'dc-exit-net', 'dc-exit-irr', 'dc-exit-sponsor-irr'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.dataset.unavailableReason = capReason; el.textContent = 'Unavailable — ' + capReason; }
    });
    var sponsorEl = document.getElementById('dc-exit-sponsor-irr');
    if (sponsorEl && !exitReason && !capReason && !(result.waterfall && result.waterfall.sponsorIrr != null)) {
      var spReason = result.waterfall ? result.unavailable['waterfall.sponsorIrr'] : result.unavailable.waterfall;
      if (spReason) { sponsorEl.dataset.unavailableReason = spReason; sponsorEl.textContent = 'Unavailable — ' + spReason; }
    }
    if (result.noi == null && reason) {
      ['dc-dscr-manual-note', 'dc-adjust-guidance-list'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.dataset.unavailableReason = reason;
        // A <ul> may hold only <li> children (screen readers announce the
        // list from them), so the reason goes in a list item there.
        var target = el;
        if (el.tagName === 'UL') { el.textContent = ''; target = document.createElement('li'); el.appendChild(target); }
        target.textContent = 'Unavailable — ' + reason;
      });
      document.getElementById('dc-adjust-guidance').hidden = currentDealMode() === 'ownership';
    }

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

  function _workflowJurisdictionContext() {
    try {
      var project = window.WorkflowState && window.WorkflowState.getActiveProject && window.WorkflowState.getActiveProject();
      var jx = project && (project.jurisdiction || (project.steps && project.steps.jurisdiction));
      if (!jx) return null;
      if (jx.geoType && jx.geoid) {
        return {
          geoType: jx.geoType,
          geoid: jx.geoid,
          name: jx.name || jx.displayName || null,
          countyFips: jx.countyFips || (jx.geoType === 'county' ? jx.geoid : null),
          countyName: jx.countyName || (jx.geoType === 'county' ? jx.name : null),
          placeGeoid: jx.placeGeoid || (/^\d{7}$/.test(jx.geoid) ? jx.geoid : null)
        };
      }
      if (jx.placeGeoid && /^\d{7}$/.test(jx.placeGeoid)) {
        return {
          geoType: 'place',
          geoid: jx.placeGeoid,
          name: jx.displayName || jx.name || null,
          countyFips: jx.countyFips || jx.fips || null,
          countyName: jx.countyName || jx.name || null,
          placeGeoid: jx.placeGeoid
        };
      }
      if (jx.countyFips || jx.fips) {
        return {
          geoType: 'county',
          geoid: jx.countyFips || jx.fips,
          name: jx.countyName || jx.name || null,
          countyFips: jx.countyFips || jx.fips,
          countyName: jx.countyName || jx.name || null
        };
      }
    } catch (_) {}
    return null;
  }

  function _renderJurisdictionContext(ctx) {
    var el = document.getElementById('dc-jurisdiction-context');
    if (!el) return;
    var placeName = ctx && (ctx.name || ctx.displayName);
    if (!ctx || (ctx.geoType !== 'place' && ctx.geoType !== 'cdp') || !placeName) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    var countyName = ctx.countyName || 'selected county';
    var countyContextName = /\s+County$/i.test(countyName) ? countyName : countyName + ' County';
    el.textContent = 'Analyzing ' + placeName + ', ' + countyContextName + ' context for HUD AMI/FMR inputs.';
    el.hidden = false;
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
      // County convention: units − households, negative = deficit. Clamp
      // positive (surplus) values to 0 — abs() would report phantom need.
      var g = rec.gap_units_minus_households_le_ami_pct || {};
      bands.forEach(function (b) { out[b] = Math.max(0, -(Number(g[b]) || 0)); });
    }
    return out;
  }

  // The homes-short figures shown to a reader: renter homes affordable AND
  // available to each income group (HUD CHAS Tables 15C and 14B), the same
  // file the homepage cards render. A cheap home rented by a higher-income
  // household does not count. Place record first (F45), county otherwise.
  // The line shows homes_short_nested: never fewer homes short in a wider
  // band (this site's rule, stated on the line; HUD's own tier figure is
  // homes_short).
  function _findChasRecord(fips, placeGeoid) {
    if (!_chasAaData) return null;
    var place = placeGeoid && _chasAaData.places && _chasAaData.places[placeGeoid];
    if (place) return { rec: place, kind: 'place' };
    var county = fips && _chasAaData.counties && _chasAaData.counties[String(fips).padStart(5, '0')];
    return county ? { rec: county, kind: 'county' } : null;
  }

  // A tier the file does not carry, or a value that is not a count, is null,
  // never 0.
  function _homesShortFromRecord(rec) {
    var tiers = (rec && rec.tiers) || {};
    var out = {};
    ['30', '50', '80'].forEach(function (b) {
      var t = tiers[b] || {};
      var v = t.homes_short_nested;
      var p = t.homes_per_100_households;
      out[b] = {
        short: (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null,
        per100: (typeof p === 'number' && isFinite(p) && p >= 0) ? p : null
      };
    });
    return out;
  }

  // F257 — "Pre-fill from local need" handler. Allocates the LIHTC-eligible
  // tier inputs (30/50/60% AMI) proportionally to the documented gap counts
  // for the selected jurisdiction. Prefers place-level gap when available,
  // falls back to county-level. Workforce/middle-income tiers (70%-120% AMI) are
  // left untouched — the prefill targets the LIHTC pool only.
  function _prefillAmiFromGap() {
    var metaEl = document.getElementById('dc-ami-prefill-meta');
    var totalEl = document.getElementById('dc-units');
    var totalUnits = Math.max(1, parseInt(totalEl && totalEl.value, 10) || 0);
    var placeGeoid = _getActivePlaceGeoid();
    var place = placeGeoid ? _findAmiGapPlace(placeGeoid) : null;
    // A manually selected county must not prefill from the former workflow place.
    var context = _workflowJurisdictionContext();
    if (context && context.countyFips && context.countyFips !== _countyFips) place = null;
    var rec = place || _findAmiGapCounty(_countyFips);
    var sourceMeta = (place ? _amiGapPlaceData : _amiGapData) && (place ? _amiGapPlaceData : _amiGapData).meta;
    var series = place ? [rec && rec.households_le_ami_pct, rec && rec.units_priced_affordable_le_ami_pct]
      : [rec && rec.gap_units_minus_households_le_ami_pct];
    var complete = rec && sourceMeta && sourceMeta.acs_year && series.every(function (values) {
      return values && ['30', '50', '60'].every(function (band) {
        return values[band] != null && values[band] !== '' && Number.isFinite(Number(values[band]));
      });
    });
    if (!complete) {
      [30, 40, 50, 60].forEach(function (tier) {
        [''].concat(SPLIT_BR_TYPES.map(function (br) { return '-' + br; })).forEach(function (suffix) {
          var field = document.getElementById('dc-units-' + tier + suffix);
          if (!field) return;
          field.value = '';
          if (window.InputProvenance) window.InputProvenance.missing(field, 'No complete local affordability-gap source is available.');
          prefillEvents(field);
        });
      });
      rec = null;
    }
    if (!rec) {
      if (metaEl) {
        metaEl.hidden = false;
        metaEl.textContent = 'No affordability-gap record available for the selected jurisdiction yet. Pick a county or place first.';
      }
      return;
    }
    var kind = place ? 'place' : 'county';
    var gaps = _gapTrioFromRecord(rec, kind);
    var label = place ? (rec.place_name || 'this place')
                      : (rec.county_name || 'this county');
    var origin = countySource({ source: sourceMeta.source || 'Census ACS renter affordability-gap counts',
      sourceUrl: place ? 'data/co_ami_gap_by_place.json' : 'data/co_ami_gap_by_county.json',
      vintage: 'ACS ' + sourceMeta.acs_year + ' · HUD FY' + sourceMeta.hud_income_limits_year,
      geography: label, why: 'Project units allocated proportionally to the local 30%, 50% and 60% AMI shortfalls; an allocation estimate, not a project commitment.' });
    var total = (gaps['30'] || 0) + (gaps['50'] || 0) + (gaps['60'] || 0);
    if (total <= 0) {
      if (metaEl) {
        metaEl.hidden = false;
        metaEl.textContent = 'The gap record for ' + label + ' reports 0 households needing housing at ≤60% AMI — nothing to pre-fill.';
      }
      return;
    }
    // Proportional allocation; round 30 + 50 first, then balance 60 so the
    // three tiers sum exactly to totalUnits.
    var u30 = Math.round(totalUnits * (gaps['30'] / total));
    var u50 = Math.round(totalUnits * (gaps['50'] / total));
    var u60 = Math.max(0, totalUnits - u30 - u50);
    var before = {};
    [30, 40, 50, 60].forEach(function (pct) {
      var inp = document.getElementById('dc-units-' + pct);
      var chk = document.getElementById('dc-chk-' + pct);
      before[pct] = (inp ? String(inp.value) : '') + '|' + (chk ? chk.checked : '');
    });
    function _setRow(pct, units) {
      var chk = document.getElementById('dc-chk-' + pct);
      var inp = document.getElementById('dc-units-' + pct);
      if (chk) chk.checked = units > 0;
      if (inp) { inp.value = String(units); markSource(inp, origin, true); }
      SPLIT_BR_TYPES.forEach(function (br) {
        var splitInp = document.getElementById('dc-units-' + pct + '-' + br);
        if (splitInp) { splitInp.value = '0'; markSource(splitInp, Object.assign({}, origin, { why: 'Split-grid entries cleared by the local-need allocation; choose a bedroom mix before enabling the grid.' }), true); }
      });
    }
    _setRow(30, u30);
    _setRow(40, 0);
    _setRow(50, u50);
    _setRow(60, u60);
    // Trigger recalc by dispatching input events on each changed field.
    [30, 40, 50, 60].forEach(function (pct) {
      var inp = document.getElementById('dc-units-' + pct);
      if (inp) prefillEvents(inp);
      SPLIT_BR_TYPES.forEach(function (br) {
        var splitInp = document.getElementById('dc-units-' + pct + '-' + br);
        if (splitInp) prefillEvents(splitInp);
      });
      var chk = document.getElementById('dc-chk-' + pct);
      if (chk) chk.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (metaEl) {
      metaEl.hidden = false;
      var pct30 = total > 0 ? Math.round(100 * gaps['30'] / total) : 0;
      var pct50 = total > 0 ? Math.round(100 * gaps['50'] / total) : 0;
      var pct60 = Math.max(0, 100 - pct30 - pct50);
      // On a phone the tier rows sit below the fold, so the note itself must
      // say what changed — or that nothing did because the tiers already match.
      var changed = [30, 40, 50, 60].filter(function (pct) {
        var inp = document.getElementById('dc-units-' + pct);
        var chk = document.getElementById('dc-chk-' + pct);
        return before[pct] !== (inp ? String(inp.value) : '') + '|' + (chk ? chk.checked : '');
      });
      var setLine = 'Units set below: 30% AMI ' + u30 + ' · 40% AMI 0 · 50% AMI ' + u50 + ' · 60% AMI ' + u60 + '.';
      metaEl.innerHTML =
        (changed.length ? '<strong>Allocated ' + totalUnits + ' units</strong>'
          : '<strong>No change:</strong> your tiers already match the allocation of ' + totalUnits + ' units') +
        ' proportional to the documented gap in ' + label +
        ' (' + (kind === 'place' ? 'place-level' : 'county-level') + '): ' +
        pct30 + '% at 30% AMI · ' + pct50 + '% at 50% AMI · ' + pct60 + '% at 60% AMI. ' + setLine + ' ' +
        'Workforce/middle-income tiers (70%-120%) left unchanged — adjust manually for mixed-income deals.';
      changed.forEach(function (pct) {
        var inp = document.getElementById('dc-units-' + pct);
        if (!inp) return;
        inp.style.outline = '2px solid var(--accent)';
        setTimeout(function () { inp.style.outline = ''; }, 2500);
      });
    }
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
    // 5k-pop town's gap is dramatically smaller than its county's.
    var found = _findChasRecord(fips, placeGeoid);
    if (!found) { container.hidden = true; return; }
    var rec   = found.rec;
    var kind  = found.kind;
    var short = _homesShortFromRecord(rec);
    var label = rec.name || 'this jurisdiction';
    var vintage = (_chasAaData && _chasAaData.meta && _chasAaData.meta.vintage) || '';
    function shown(b) {
      var t = short[b];
      if (t.short == null) return '—';
      return Math.round(t.short).toLocaleString() +
        (t.per100 == null ? '' : ' (' + Math.round(t.per100) + ' per 100)');
    }
    // Built from text nodes: the place and county names come from a data file.
    container.textContent = '';
    var head = document.createElement('strong');
    head.style.color = 'var(--accent)';
    head.textContent = 'Affordability Gap — ' + label;
    if (kind === 'place') {
      var lvl = document.createElement('span');
      lvl.style.color = 'var(--muted)';
      lvl.style.fontWeight = '400';
      lvl.textContent = ' · place-level';
      head.appendChild(lvl);
    }
    container.appendChild(head);
    container.appendChild(document.createElement('br'));
    container.appendChild(document.createTextNode('Rental homes short: ≤30% AMI: ' + shown('30') +
      ' • ≤50% AMI: ' + shown('50') + ' • ≤80% AMI: ' + shown('80')));
    container.appendChild(document.createElement('br'));
    var note = document.createElement('span');
    note.style.fontSize = '0.95em';
    note.textContent = 'HUD CHAS' + (vintage ? ' ' + vintage : '') + '. Each band includes the ones below it. ' +
      'This site, not HUD, never shows a band fewer homes short than a band inside it, because homes renting above what ' +
      'the lower incomes can pay do not close their shortfall. ' +
      'A home counts only if its rent is affordable to the group and it is vacant or rented by someone in the group; ' +
      'per 100 is affordable, available homes for every 100 renter households. HUD\'s tables have no 60% tier.';
    container.appendChild(note);
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

    // The predictor applies its OWN `_num(inputs.proposedUnits, 60)` default,
    // so passing an unknown unit count through simply resurrects the 60 one
    // layer down — the same defect in a second place. It already has the right
    // primitive for this (`_missing()`), it just is not used on that field.
    //
    // Rather than reach into the predictor from here, refuse to ask it a
    // question that has no unit count in it, and say so on screen.

    // Was `|| 60`: clearing the field silently produced a 60-unit project's
    // economics with nothing on screen saying where 60 came from. A default
    // that looks deliberate is harder to notice than a zero.
    var _unitsEl = document.getElementById('dc-units');
    var _unitsRaw = parseInt(_unitsEl && _unitsEl.value, 10);
    var units = Number.isFinite(_unitsRaw) && _unitsRaw > 0 ? _unitsRaw : NaN;
    if (!Number.isFinite(units)) {
      // dc-concept-rec is created on demand by the predictor's own renderer,
      // so the message lands exactly where the result would have.
      var _recCard = document.getElementById('dc-concept-rec');
      if (_recCard) {
        _recCard.innerHTML = '<p class="dc-note">Enter a total unit count to screen this concept. '
          + 'No prediction is shown, rather than one based on an assumed project size.</p>';
        _recCard.hidden = false;
      }
      return;
    }
    var dealInputs = {
      // No project-specific funding amount or bound PMA score is supplied here.
      // Keep them absent; program caps are not an available project balance.
      softFundingAvailable: null,
      pmaScore: null,
      geoid: fips || undefined,
      countyFips: fips || null,    // drives hard-cost geographic multiplier in predictor
      proposedUnits: units,
      isQct: ['qct', 'dda', 'sadda'].indexOf((document.getElementById('dc-boost-designation') || {}).value) !== -1
    };

    // AMI gap data
    var county = _findAmiGapCounty(fips);
    // County convention: units − households at or below each threshold,
    // negative = deficit. The thresholds overlap, so the predictor converts
    // them to bands before anything sums them (the ≤30% households were
    // counted three times before 2026-10-18).
    var shortfall = county && predictor.amiShortfallFromCounty ? predictor.amiShortfallFromCounty(county) : null;
    if (shortfall) {
      Object.assign(dealInputs, shortfall);
      dealInputs.ami30Scope = 'area';
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
      recCard.setAttribute('data-dc-mode', 'rental');
      recCard.style.cssText = 'margin-top:var(--sp3);padding:var(--sp2) var(--sp3);' +
        'border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);';
      mount.appendChild(recCard);
    }
    // LIHTC-specific recommendation — created after updateDealModeUi() has
    // already swept [data-dc-mode], so set the current mode's state directly.
    recCard.hidden = currentDealMode() === 'ownership';
    var rec = result.base;
    var esc = _referenceEscape;
    var missing = Object.keys(rec.inputAvailability || {}).filter(function (key) {
      return rec.inputAvailability[key].unavailableReason;
    });
    recCard.innerHTML =
      '<h3 style="margin:0 0 0.5rem;font-size:0.95rem;">' +
      (rec.confidenceBadge || '') + ' Concept Recommendation: <strong>' +
      rec.recommendedExecution + ' ' + (rec.conceptType || '').charAt(0).toUpperCase() +
      (rec.conceptType || '').slice(1) + ' Housing</strong>' +
      ' <span style="font-size:0.75em;color:var(--muted);">' + rec.confidence + ' confidence</span></h3>' +
      '<ul style="margin:0;padding-left:1.25rem;font-size:var(--small);">' +
      (rec.keyRationale || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
      '</ul>' + (missing.length ? '<div class="dc-note" data-predictor-missing><strong>Missing inputs</strong><ul>' +
        missing.map(function (key) { var input = rec.inputAvailability[key];
          return '<li data-missing-input="' + esc(key) + '" data-unavailable-reason="' + esc(input.unavailableReason) + '">' +
            esc(input.label) + ': ' + esc(input.reason) + '</li>';
        }).join('') + '</ul></div>' : '') +
      // Need notes and the 15-year pencil test on the recommended mix (js/mix-check.js).
      (window.LIHTCConceptCardRenderer && window.LIHTCConceptCardRenderer.mixCheckHtml
        ? window.LIHTCConceptCardRenderer.mixCheckHtml(rec.mixCheck) : '');
    recCard.hidden = false;
    if (rec.mixCheck && rec.mixCheck.pending && predictor.whenMixDataReady && !_runDealPredictor.waiting) {
      _runDealPredictor.waiting = true;
      predictor.whenMixDataReady().then(function () {
        _runDealPredictor.waiting = false;
        var sel = document.getElementById('dc-county-select');
        _runDealPredictor((sel && sel.value) || fips);
      });
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------
  /* A link can open the calculator in ownership mode (?mode=ownership): the
   * nav's "For-Sale Feasibility" item and the for-sale route's Deal step both
   * do (docs/DEVELOPER-TRACKS.md). Any other value leaves the default. */
  function applyModeFromUrl() {
    var mode = new URLSearchParams(window.location.search).get('mode');
    if (mode !== 'ownership') return;
    var radio = document.getElementById('dc-mode-ownership');
    if (!radio || radio.checked) return;
    radio.checked = true;
    var view = radio.ownerDocument.defaultView || window;
    radio.dispatchEvent(new view.Event('change', { bubbles: true }));
  }

  function init() {
    var mount = document.getElementById('dealCalcMount');
    if (!mount) return;
    render(mount);
    applyModeFromUrl();
    _renderSoftFundingReference();
    var chfaLoad = window.__DealCalcChfaTablePromise || fetch('data/chfa-income-rent-limits-2026.json').then(function (r) {
      return r.ok ? r.json() : null;
    });
    chfaLoad.then(setChfaRentTable).catch(function () { setChfaRentTable(null); });
    function loadJson(url) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    loadJson('data/hud-home-rent-limits-co-2026.json').then(function (t) { setProgramRentTables(t, undefined); });
    loadJson('data/policy/prop123-rental-rules.json').then(function (t) { setProgramRentTables(undefined, t); });
    loadJson('data/policy/lihtc-underwriting-rules.json').then(function (t) { _costRules = t; recalculate(); });
    loadJson('data/policy/chfa-common-app-tables.json').then(function (t) { _chfaTables = t; recalculate(); });

    // Phase-4 follow-up — re-scan for <abbr data-glossary> tags now that the
    // output panel HTML has been injected. The inline-glossary boot fires on
    // DOMContentLoaded against an empty mount, so without this the NOI /
    // DSCR / IRC §42 tooltip wrappers never get hydrated.
    if (window.InlineGlossary && typeof window.InlineGlossary.decorate === 'function') {
      try { window.InlineGlossary.decorate(mount); } catch (_) { /* never break render */ }
    }

    // Mark which figures are the user's and which are the tool's starting
    // assumptions. 109 of the 133 visible fields arrive pre-filled — Total
    // Development Cost at $20,000,000, Total Units at 60 — and without this
    // they are indistinguishable from a value the user entered. Additive and
    // read-only with respect to values, so it cannot alter a calculation.
    if (window.InputProvenance && typeof window.InputProvenance.apply === 'function') {
      try { window.InputProvenance.apply(mount); } catch (_) { /* never break render */ }
    }

    // Eagerly trigger the HUD LIHTC dataset load so the Peer Deals panel
    // has data ready when the user picks a county. Non-blocking; fails
    // silently — the panel handles the absent-data state gracefully.
    if (window.HudLihtc && typeof window.HudLihtc.load === 'function' && !window.HudLihtc.isLoaded()) {
      window.HudLihtc.load().then(function () {
        if (typeof recalculate === 'function') recalculate();
      }).catch(function () { /* peer deals panel handles empty case */ });
    }

    // F257 — Wire the "Pre-fill from local need" button on the AMI mix block.
    var prefillBtn = document.getElementById('dc-ami-prefill');
    if (prefillBtn) {
      prefillBtn.addEventListener('click', function (e) {
        e.preventDefault();
        _prefillAmiFromGap();
      });
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
        // A share link carries the sender's county (deal-calculator-share.js
        // sets this before init). It wins over the recipient's own workflow
        // jurisdiction, which would otherwise re-select a different county
        // after the link hydrated — or none, leaving every output at "—".
        if (window.__DealCalcSharedCounty && _selectCounty(window.__DealCalcSharedCounty)) return;
        var _fallbackCounty = function () {
          // Pre-select the jurisdiction county so user doesn't re-enter it.
          // GEO-1 writes a canonical countyFips for place/CDP selections;
          // legacy projects may still only have fips.
          var fips = null;
          var workflowCtx = _workflowJurisdictionContext();
          _renderJurisdictionContext(workflowCtx);
          if (workflowCtx && workflowCtx.countyFips) fips = workflowCtx.countyFips;
          try {
            if (!fips) {
              var _proj = window.WorkflowState && window.WorkflowState.getActiveProject();
              var _jx   = _proj && (_proj.jurisdiction || (_proj.steps && _proj.steps.jurisdiction));
              if (_jx && _jx.fips) fips = _jx.fips;
            }
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
            _renderJurisdictionContext(ctx);
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
        updateAmiLimitsFromFmr(fips);
        _renderAmiGapInfo(fips, _getActivePlaceGeoid());
        _runDealPredictor(fips);
        _renderCrossCountyDisclosure(fips);
        _renderHmdaContext(fips);
        _renderFundingContextCard();
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
    // Homes short shown on the gap line. Soft-fail: the line stays hidden.
    fetch(_gapResolver('data/hna/chas_affordable_available.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (data && data.counties) {
        _chasAaData = data;
        var sel = document.getElementById('dc-county-select');
        if (sel && sel.value) _renderAmiGapInfo(sel.value, _getActivePlaceGeoid());
      }
    }).catch(function () { /* gap line stays hidden */ });
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

    // #1973: the sourced QAP's TZ per-project pairing, read from the HB26-1065
    // entry. Soft-fail — the funding note then says the amounts could not be
    // loaded rather than show a number.
    fetch(_gapResolver('data/policy/tax-credit-legislation.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) { setTzCreditPairing(data); })
      .catch(function () { setTzCreditPairing(null); });

    fetch(_gapResolver('data/policy/soft-funding-status.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      _softFundingStatus = data;
      _renderFundingContextCard();
      _renderSoftFundingReference();
    }).catch(function () {
      _softFundingStatus = null;
      _renderFundingContextCard();
      _renderSoftFundingReference();
    });

    fetch(_gapResolver('data/policy/developer-ownership-funding.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      _developerOwnershipFunding = data && Array.isArray(data.programs) ? data : null;
      if (currentDealMode() === 'ownership') recalculate();
    }).catch(function () {
      _developerOwnershipFunding = null;
      if (currentDealMode() === 'ownership') recalculate();
    });

    fetch(_gapResolver('data/hna/permits.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      setPermitsData(data);
    }).catch(function () {
      setPermitsData(null);
    });

    fetch(_gapResolver('data/policy/unit-size-standards.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      setUnitSizeStandards(data);
    }).catch(function () {
      setUnitSizeStandards(null);
    });

    fetch(_gapResolver('data/policy/resale-conventions.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      _resaleConventions = data && Array.isArray(data.conventions) ? data : null;
      if (currentDealMode() === 'ownership') recalculate();
    }).catch(function () {
      _resaleConventions = null;
      if (currentDealMode() === 'ownership') recalculate();
    });

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

    fetch(_gapResolver('data/market/acs_renter_bedrooms_co.json')).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      _renterBedroomMix = data;
      if (_countyFips) { _renderZoriMarketContext(_countyFips); recalculate(); }
    }).catch(function () { _renterBedroomMix = null; if (_countyFips) recalculate(); });


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

    // Published 2020–24 B25064 baseline, preserving suppressed values.
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

    // Published B25064 for this place, otherwise the explicitly named county.
    var placeGeoid = zoriContext(fips).geoid;
    var acsPlace = _acsRent && _acsRent.places && _acsRent.places[placeGeoid];
    var acsRec = acsPlace && acsPlace.county_fips === fips ? acsPlace :
      _acsRent && _acsRent.counties && _acsRent.counties[fips];
    if (acsRec && Number.isFinite(acsRec.median_gross_rent) && acsRec.median_gross_rent > 0) {
      html += '<strong>' + marketContextHtml(acsRec.name) + '</strong> ACS median gross rent: $' +
        acsRec.median_gross_rent.toLocaleString() + '/mo · Census B25064, ' + marketContextHtml(_acsRent.meta.vintage) + '.';
    } else if (acsRec) {
      html += marketContextHtml(acsRec.name) + ': ACS median gross rent unavailable.';
    }

    // F96 — ZORI (monthly, all-BR). Adds the fresher signal where Zillow
    // has sufficient listing volume.
    var zori = window.ZoriRentUtils && window.ZoriRentUtils.getMarketRent(_zoriData, fips, zoriContext(fips));
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
        '. <span style="opacity:.85;">Bedroom estimates normalize HUD FMR ratios to the local ACS renter bedroom mix.</span>';
      if (html.indexOf('<div') !== -1) html += '</div>';
      var distributed = getZoriPerBrRent(fips);
      if (distributed && distributed._meta.review_flag) html += '<div data-review-flag="zori_2br_below_fmr">' +
        marketContextHtml(distributed._meta.review_flag.note) + '</div>';
    } else if (!html) {
      // No ZORI AND no ACS — shouldn't happen but bail gracefully.
      el.textContent = 'Market rent data unavailable for this geography.';
      el.style.color = 'var(--muted)';
      return;
    }

    // F96 — DOLA Survey triangulation (regional). Always 14 CO regions;
    // we look up the region for this county via the survey's county
    // map.
    var dolaLine = _dolaTriangulationLine(fips);
    if (dolaLine) html += '<div style="margin-top:.25rem;">' + dolaLine + '</div>';

    el.innerHTML = html;
    el.style.color = 'var(--muted)';
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
   * Q5: After recalculate() runs, surface which 70%-120% AMI rows actually
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
        '. <span style="color:var(--accent,#096e65);">Cap not binding</span> — planning ceilings on 70%-120% AMI ' +
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
   * When basis_boost_eligible is true a note tells the user the site appears
   * to be designated. The boost itself is never selected automatically: it
   * needs the user to choose the designation and record its evidence (#2160).
   *
   * @param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
   */
  function setDesignationContext(basisBoostEligible) {
    var note = document.getElementById('dc-qct-dda-note');
    if (!note) return; // calculator not yet mounted — intentional no-op
    note.textContent = basisBoostEligible
      ? 'HUD data place this site in a QCT or DDA. Choose the designation above and record the evidence to apply the boost.' : '';
    note.style.display = basisBoostEligible ? 'block' : 'none';
  }

  /**
   * HB26-1065 Transit Zone (TZ) state credit — a possible source, never
   * added to the stack (#1937 Phase 4, #1973). Called by the PMA transit-zone
   * gate with a TransitZone.status() result. The line appears only when the
   * site passes TransitZone.fundingPath. It states the sourced QAP's per-project
   * pairing for the selected credit type. The amounts live only in the
   * HB26-1065 entry's `tz_credit_pairing` in
   * data/policy/tax-credit-legislation.json, pinned to the QAP text in
   * data/audit/chfa-qap-watch.json; until that file loads no amount is shown.
   * The statewide cap below must match the same entry
   * (test/transit-zone-funding-line.test.js).
   */
  var TZ_CREDIT = {
    statewideCapMillions: 8.33,
    years: '2027–2033'
  };
  var _tzPairing = null;        // HB26-1065 entry's tz_credit_pairing, once loaded
  var _tzLastResult = null;     // last TransitZone result, for re-rendering
  function setTzCreditPairing(legislation) {
    var entries = legislation && Array.isArray(legislation.entries) ? legislation.entries : [];
    var entry = entries.filter(function (e) { return /^hb26-1065/i.test((e && e.id) || ''); })[0];
    var p = entry && entry.tz_credit_pairing;
    _tzPairing = (p && p.nine_percent && p.four_percent_round_two)
      ? Object.assign({}, p, { last_verified: p.last_verified || entry.last_verified || null }) : null;
    setTransitZoneContext(_tzLastResult);
  }
  function _tzMoney(n) {
    return (typeof n === 'number' && n > 0) ? '$' + n.toLocaleString('en-US') : null;
  }
  function _tzPairingSentence(is4Pct) {
    var p = _tzPairing;
    if (!p) return 'The QAP’s per-project amounts could not be loaded, so none is shown. ';
    var title = p.title || p.source;
    var date = p.source_date || p.date || p.last_verified;
    if (!title || !date || (p.status !== 'draft' && p.status !== 'adopted')) {
      return 'QAP status, source or date unavailable; per-project amounts are not shown. ';
    }
    var documentLabel = title + ' (' + ((p.source_date || p.date) ? 'dated ' : 'checked ') + date + ')';
    var qapStatus = p.status === 'draft' ? 'draft QAP (§3.L, not yet adopted)' : 'adopted QAP (§3.L)';
    var main = is4Pct ? p.four_percent_round_two : p.nine_percent;
    var alt = p.if_no_state_gap_funds &&
      (is4Pct ? p.if_no_state_gap_funds.four_percent_round_two : p.if_no_state_gap_funds.nine_percent);
    var a27 = _tzMoney(main && main['2027']);
    var a28 = _tzMoney(main && main['2028']);
    if (!a27 || !a28) return 'The QAP’s per-project amounts could not be read, so none is shown. ';
    // The sourced QAP pairs annual credit; HB26-1065 credit is claimed in each of
    // six credit years, so an amount without its unit reads as a total.
    if (p.unit !== 'annual') return 'The QAP’s per-project amounts could not be read, so none is shown. ';
    var s = is4Pct
      ? 'For a 4% application in Round Two, the ' + qapStatus + ' lets CHFA pair up to ' + a27 +
        ' a year (2027 awards) or ' + a28 + ' a year (2028 awards) of annual standard state credit or TZ credit, where eligible, alongside accelerated state credit. '
      : 'For a 9% application, the ' + qapStatus + ' pairs, if requested, a fixed ' + a27 +
        ' a year (2027 awards) or ' + a28 + ' a year (2028 awards) of annual standard state credit or TZ credit, where eligible. ';
    s = documentLabel + '. ' + s;
    s += 'These are annual amounts, claimed in each credit year, not a project total. ';
    s += 'It is one allowance: TZ credit replaces standard state credit, it does not add to it. ';
    var b27 = _tzMoney(alt && alt['2027']);
    var b28 = _tzMoney(alt && alt['2028']);
    if (b27 && b28) {
      s += 'If state gap funds are not available under the §3.B.9 pilot, §3.L.1 sets ' + (is4Pct ? 'up to ' : '') +
        b27 + ' a year (2027) and ' + b28 + ' a year (2028) instead. ';
    }
    return s + (p.status === 'draft' ? 'Check the final QAP before relying on these amounts. '
      : 'Confirm project eligibility under the adopted QAP. ');
  }
  /** 'yes' inside an official zone polygon, 'no' when the official map places the site
   * outside one, '' when Market Analysis has not answered. */
  function transitZoneInZone(result) {
    var tz = window.TransitZone;
    if (!result || !tz || typeof tz.fundingPath !== 'function') return '';
    if (tz.fundingPath(result)) return 'yes';
    var p = result.program;
    return p && p.qualified === false && p.determinationMethod === 'point_in_official_polygon' ? 'no' : '';
  }

  function setTransitZoneContext(result) {
    var before = transitZoneInZone(_tzLastResult);
    _tzLastResult = result || null;
    // A Transit Zone credit's eligibility turns on this answer, so recompute when it changes.
    var kind = document.getElementById('dc-add-kind');
    if (kind && kind.value === 'tz' && transitZoneInZone(_tzLastResult) !== before) recalculate();
    var note = document.getElementById('dc-tz-note');
    if (!note) return; // calculator not yet mounted — intentional no-op
    // The rule lives in TransitZone.fundingPath so this line and the PMA gate
    // cannot disagree; without it, show nothing rather than guess.
    var tz = window.TransitZone;
    var path = tz && typeof tz.fundingPath === 'function' ? tz.fundingPath(result) : null;
    note.hidden = !path;
    note.setAttribute('data-tz-context', path ? 'passes' : (result ? result.status : 'none'));
    if (!path) { note.innerHTML = ''; return; }
    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var is4Pct = _activeCreditIs4Pct();
    note.innerHTML =
      '<strong>Possible source, not in this stack unless entered as an added credit: Colorado Transit Zone (TZ) state credit (HB26-1065).</strong> ' +
      'This site is inside a Transit and Housing Investment Zone on OEDIT’s published map. ' +
      'CHFA may allocate up to $' +
      TZ_CREDIT.statewideCapMillions.toFixed(2) + ' million a year statewide in ' + TZ_CREDIT.years + ', in lieu of standard state credit. ' +
      '<span data-qap-status="' + esc(_tzPairing && _tzPairing.status || 'unavailable') + '" data-tz-pairing="' + (_tzPairing ? (is4Pct ? '4pct' : '9pct') : 'unavailable') + '">' +
      esc(_tzPairingSentence(is4Pct)) + '</span>' +
      '<span data-tz-designation="' + esc(result.designation) + '" style="color:var(--muted);">' + esc(result.program.programRule) + '</span>';
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
    function _refresh() {
      try {
        // Refresh label readouts
        SLIDERS.forEach(function (s) {
          var slider = document.getElementById(s.id);
          var label = document.getElementById(s.label);
          if (slider && label) label.textContent = s.fmt(slider.value);
        });
        // Build impact readouts
        var result = getResult();
        var impacts = result && result.sliderImpacts;
        var stressPrice = _read('dc-stress-equity-price');
        var tdcOverrunPct = _read('dc-stress-tdc-overrun') / 100;
        var leaseupMonths = _read('dc-stress-leaseup');
        function impact(id, key, render) {
          var el = document.getElementById(id);
          if (!el) return;
          var reason = result && result.unavailable['sliderImpacts.' + key] || 'The deal calculation is unavailable.';
          if (!impacts || impacts[key] == null) {
            el.dataset.unavailableReason = reason;
            el.textContent = 'Unavailable — ' + reason;
          } else {
            delete el.dataset.unavailableReason;
            el.textContent = render(impacts);
          }
        }
        impact('dc-stress-equity-impact', 'equity', function (v) {
          return 'Equity proceeds: ' + _fmtMoney(v.equity) + ' (Δ ' +
            (v.equityDelta >= 0 ? '+' : '') + _fmtMoney(v.equityDelta) + ' vs. base ' + _fmtMoney(v.baseEquity) + ')';
        });
        impact('dc-stress-tdc-impact', 'tdc', function (v) {
          return 'Stressed TDC: ' + _fmtMoney(v.tdc) + (v.overrun > 0 ? ' (+' + _fmtMoney(v.overrun) +
            ' overrun; assume covered by GP equity / soft-debt gap)' : ' (no overrun)');
        });
        impact('dc-stress-leaseup-impact', 'year1Loss', function (v) {
          return 'Year-1 NOI loss estimate: ' + _fmtMoney(v.year1Loss) + ' (linear ramp; covered by lease-up reserve if funded)';
        });
        // L7: the rent cut and the coverage floor read the engine's
        // sliderImpacts.rentCut. The loan is never resized; the floor shows the
        // loan this NOI would carry beside the loan as sized.
        var cutView = impacts && impacts.rentCut;
        var cutReason = (result && result.unavailable && result.unavailable['sliderImpacts.rentCut'])
          || (result && !result.dscrAutoMode ? 'Turn on auto-compute NOI: a typed NOI has no rents to cut.' : 'Enter the rents and loan terms to see this.');
        var rentEl = document.getElementById('dc-stress-rent-low-impact');
        if (rentEl) {
          if (!cutView) {
            rentEl.dataset.unavailableReason = cutReason;
            rentEl.textContent = 'Unavailable — ' + cutReason;
          } else {
            delete rentEl.dataset.unavailableReason;
            rentEl.textContent = !cutView.deepUnits ? 'No units at 30–50% AMI, so this cut changes nothing.'
              : cutView.deepUnits + ' units at 30–50% AMI bring ' + _fmtMoney(cutView.deepRents) + ' a year. '
                + (cutView.pct > 0 ? 'A ' + cutView.pct.toFixed(0) + '% cut lowers NOI by ' + _fmtMoney(cutView.noiLoss)
                  + ' to ' + _fmtMoney(cutView.noi)
                  + (typeof cutView.coverage === 'number' ? '; first-mortgage coverage ' + cutView.baseCoverage.toFixed(2) + 'x → ' + cutView.coverage.toFixed(2) + 'x.' : '.')
                  : 'Move the slider to cut them.');
          }
        }
        var floorEl = document.getElementById('dc-stress-dscr-impact');
        if (floorEl) {
          if (cutView && typeof cutView.coverage === 'number') {
            delete floorEl.dataset.unavailableReason;
            var after = cutView.pct > 0 ? ' after the rent cut' : '';
            floorEl.textContent = 'Coverage ' + cutView.coverage.toFixed(2) + 'x' + after + ' '
              + (cutView.meetsFloor ? 'meets' : 'falls short of') + ' a ' + cutView.floor.toFixed(2) + 'x floor. '
              + 'At that floor NOI carries ' + _fmtMoney(cutView.supportedDebtService) + ' a year of first-mortgage payments'
              + (typeof cutView.supportedLoan === 'number' && typeof cutView.loanRoom === 'number'
                ? ', about a ' + _fmtMoney(cutView.supportedLoan) + ' loan vs. ' + _fmtMoney(cutView.loan) + ' as sized ('
                  + (cutView.loanRoom >= 0 ? _fmtMoney(cutView.loanRoom) + ' of room' : _fmtMoney(-cutView.loanRoom) + ' too large') + '; not resized).'
                : ' (loan not resized).');
          } else {
            var floor = _read('dc-stress-dscr-floor') || 1.15;
            var base = result && result.baseDSCR;
            if (typeof base === 'number' && isFinite(base)) {
              delete floorEl.dataset.unavailableReason;
              floorEl.textContent = 'Base coverage ' + base.toFixed(2) + 'x '
                + (base >= floor ? 'meets' : 'falls short of') + ' a ' + floor.toFixed(2) + 'x floor (loan not resized).';
            } else {
              var dscrReason = (result && result.unavailable && result.unavailable.baseDSCR) || 'Enter NOI and mortgage terms to see coverage.';
              floorEl.dataset.unavailableReason = dscrReason;
              floorEl.textContent = 'Unavailable — ' + dscrReason;
            }
          }
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
            '<br><span style="color:var(--muted);font-size:.8125rem">' +
            'Every stress here keeps the loans at their base amounts; nothing is resized. The rent cut and the coverage floor work together; the equity, cost and lease-up rows each move one figure on their own. ' +
            'Read each impact row above for line-item deltas. Per-tranche soft-debt controls (CF-pay %, accrue mode, priority) live in the "Soft Funding Stack" panel above; ' +
            'full capital event waterfall (GP/LP split, preferred return, catch-up) renders below the Tornado Chart.' +
            '</span>';
        }
      } catch (e) {
        console.warn('[DealCalc] stress slider refresh failed', e);
      }
    }
    document.addEventListener('deal-calc:updated', _refresh);
    SLIDERS.forEach(function (s) {
      var slider = document.getElementById(s.id);
      if (slider) {
        slider.addEventListener('input', recalculate);
        slider.addEventListener('change', recalculate);
      }
    });
    // First paint
    setTimeout(_refresh, 100);

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
  // The renderer subscribes to the engine result published by recalculate.
  function _initCapitalEventWaterfall() {
    function _fmtMoney(n) {
      if (n == null || !isFinite(n)) return 'Unavailable';
      n = Number(n);  // a number from here on; the tables are written as HTML
      if (n === 0) return '$0';
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
    function _renderTable(wf, unavailable) {
      var rows = wf.tiers.map(function (t) {
        var pct = wf.grossProceeds > 0 ? (t.amount / wf.grossProceeds * 100) : 0;
        var pctStr = pct >= 0.05 ? pct.toFixed(1) + '%' : '—';
        var color = t.amount > 0 ? 'var(--text)' : 'var(--faint)';
        return '<tr>' +
          '<td style="padding:3px 6px;color:' + color + ';">' + _escHtml(t.name) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;font-weight:600;color:' + color + ';">' + _fmtMoney(t.amount) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:var(--muted);">' + pctStr + '</td>' +
          '<td style="padding:3px 6px;color:var(--muted);font-size:.8125rem;">' + _escHtml(t.recipient) + '</td>' +
        '</tr>';
      }).join('');
      // tabindex lets keyboard users scroll it when it overflows at phone width.
      // Tier order is the payout order, so this table never sorts.
      return '<table data-no-sort tabindex="0" aria-label="Exit sale waterfall by tier" style="width:100%;border-collapse:collapse;font-size:.82rem;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
        '<th style="text-align:left;padding:3px 6px;color:var(--muted);font-weight:600;">Waterfall tier</th>' +
        '<th style="text-align:right;padding:3px 6px;color:var(--muted);font-weight:600;">Amount</th>' +
        '<th style="text-align:right;padding:3px 6px;color:var(--muted);font-weight:600;">% of gross</th>' +
        '<th style="text-align:left;padding:3px 6px;color:var(--muted);font-weight:600;">Recipient</th>' +
        '</tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr style="border-top:2px solid var(--border);">' +
        '<td style="padding:6px;font-weight:700;">Gross proceeds (sale)</td>' +
        '<td style="padding:6px;text-align:right;font-weight:700;color:var(--accent);">' + _fmtMoney(wf.grossProceeds) + '</td>' +
        '<td colspan="2" style="padding:6px;color:var(--muted);font-size:.8125rem;">Sale value before the payoff tiers above</td>' +
        '</tr></tfoot>' +
        '</table>' +
        // Bottom-line summary
        '<div style="margin-top:.8rem;padding:.5rem .65rem;background:var(--bg2);border-radius:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px, 100%),1fr));gap:8px 16px;font-size:.82rem;">' +
        '<div><strong style="color:var(--muted);">LP cash received:</strong> <span style="font-weight:700;">' + _fmtMoney(wf.lpTotal) + '</span></div>' +
        '<div><strong style="color:var(--muted);">LP cash multiple:</strong> <span style="font-weight:700;">' + (!MoneyFormatter.isAbsent(wf.lpMultiple) ? Number(wf.lpMultiple).toFixed(2) + 'x' : 'Unavailable — ' + _escHtml(unavailable['waterfall.lpMultiple'])) + '</span></div>' +
        '<div><strong style="color:var(--muted);">LP cash IRR (excl. credits):</strong> <span style="font-weight:700;">' + (!MoneyFormatter.isAbsent(wf.lpCashIrr) ? _fmtPct(wf.lpCashIrr) : 'Unavailable — ' + _escHtml(unavailable['waterfall.lpCashIrr'])) + '</span></div>' +
        '<div><strong style="color:var(--muted);">GP cash received:</strong> <span style="font-weight:700;">' + _fmtMoney(wf.gpTotal) + '</span></div>' +
        '</div>' +
        '<p style="margin:.5rem 0 0;font-size:.8125rem;color:var(--faint);line-height:1.4;">' +
        '<strong>LP IRR caveat:</strong> the LP\'s primary return on a LIHTC deal is the tax credits ($' +
        (wf.annualCredits != null ? wf.annualCredits.toLocaleString('en-US') : 'unavailable') +
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
      var n = wf.hold;
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
      wf.annual.forEach(function (row) {
        var y = Number(row.year), lpY = row.lp, gpY = row.gp;
        cumLp = row.cumLp; cumGp = row.cumGp;
        var isExit = (y === n);
        rows += '<tr' + (isExit ? ' style="background:var(--accent-dim);font-weight:600;"' : '') + '>' +
          '<td style="padding:3px 6px;text-align:right;color:var(--muted);">Year ' + y + (isExit ? ' (exit)' : '') + '</td>' +
          '<td style="padding:3px 6px;text-align:right;">' + _fmtMoney(lpY) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;">' + _fmtMoney(gpY) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:' + (cumLp >= 0 ? 'var(--good)' : 'var(--bad)') + ';">' + _fmtMoney(cumLp) + '</td>' +
          '<td style="padding:3px 6px;text-align:right;color:' + (cumGp >= 0 ? 'var(--good)' : 'var(--muted)') + ';">' + _fmtMoney(cumGp) + '</td>' +
          '</tr>';
      });
      // Year-by-year schedule: kept in year order like the other statements.
      return '<table data-no-sort tabindex="0" aria-label="Year-by-year LP and GP cash" style="width:100%;border-collapse:collapse;font-size:.8125rem;">' +
        '<thead><tr style="position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--border);">' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">Year</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">LP cash</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">GP cash</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">LP cumulative</th>' +
        '<th style="text-align:right;padding:4px 6px;color:var(--muted);">GP cumulative</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p style="margin:.5rem .5rem 0;font-size:.8125rem;color:var(--faint);line-height:1.4;">' +
        'Annual cash: surplus after loan payments and the deferred fee, split ' + (wf.terms ? +(wf.terms.lpOpsShare * 100).toFixed(2) : 99.99) + '% LP / ' +
        (wf.terms ? +((1 - wf.terms.lpOpsShare) * 100).toFixed(2) : 0.01) + '% GP, the investor share entered above. ' +
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
        var result = getResult();
        var wf = result && result.waterfall;
        var autoEl = document.getElementById('dc-wf-lp-equity-auto');
        // What the investor pays in for the credits, the same amount the waterfall uses when not overridden.
        var autoLp = result ? dealEngine().investorCapital(result) : null;
        if (autoEl) autoEl.textContent = _fmtMoney(autoLp);
        var reason = result && result.unavailable.waterfall || 'The deal calculation is unavailable.';
        ['dcWaterfallTable', 'dcWaterfallAnnualTable'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          if (!wf) { el.dataset.unavailableReason = reason; el.textContent = 'Unavailable — ' + reason; }
          else delete el.dataset.unavailableReason;
        });
        if (!wf) return;
        var tableEl = document.getElementById('dcWaterfallTable');
        if (tableEl) tableEl.innerHTML = _renderTable(wf, result.unavailable);
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
    document.addEventListener('deal-calc:updated', _refresh);
    ['dc-wf-lp-equity', 'dc-wf-pref', 'dc-wf-gp-residual', 'dc-wf-catchup', 'dc-wf-lp-ops-share', 'dc-wf-exit', 'dc-wf-buyout'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', recalculate);
        el.addEventListener('change', recalculate);
      }
    });
    var detailsEl = document.getElementById('dcWaterfallDetails');
    if (detailsEl) detailsEl.addEventListener('toggle', _refresh);
    // First paint
    setTimeout(_refresh, 150);

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
  // The reference follows the tranche dropdown's identifiers and order.
  // Program facts come from the same loaded policy record as the funding
  // context card; an unmapped/custom program has no verified terms here.
  // Prop 123 keeps the shared policy timeline description. The impact-fee
  // card retains its statutory context, without inventing loan terms.
  var _softFundingTimelineEvent = null;
  var SOFT_REFERENCE = [
    { k: 'chfa_htf', id: 'CHFA-HTF', name: 'CHFA HTF' },
    { k: 'prop123', id: 'PROP123-AHTF', name: 'Prop 123' },
    { k: 'local_pha', name: 'Local PHA / Housing Trust' },
    { k: 'chfa_cmf', id: 'CHFA-CMF', name: 'CHFA Capital Magnet Fund' },
    { k: 'dola_htf', id: 'DOLA-HTF', name: 'DOLA HTF' },
    { k: 'home', id: 'HOME-CO', name: 'HOME' },
    { k: 'cdbg', name: 'CDBG' },
    { k: 'nhtf', id: 'NHTF-CO', name: 'NHTF' },
    { k: 'impact_fee_loan', name: 'Impact Fee Loan / Waiver',
      notes: 'C.R.S. 29-20-104.5(5): a local government "may waive" an impact fee on low- or moderate-income or affordable employee housing as it defines it — permitted, not required. Subsection (6) allows deferring collection to building permit or certificate of occupancy. Water/sewer taps are often charged by a separate district. Verified local measures: data/policy/fee-reductions.json.' },
    { k: 'sponsor_loan', name: 'Sponsor / Affiliate Loan' },
    { k: 'historic_tc', name: 'Historic Tax Credit (cash equivalent)' },
    { k: 'nmtc', id: 'NMTC-CO', name: 'NMTC' },
    { k: 'seller_carry', name: 'Seller-carry note' },
    { k: 'other', name: 'Other / custom' }
  ];
  function _referenceEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _renderSoftFundingReference() {
    var listEl = document.getElementById('dc-soft-funding-ref-list');
    if (!listEl) return;
    var esc = _referenceEscape;
    var programs = _softFundingStatus && _softFundingStatus.programs || {};
    // A retired label names no current program, so it is not offered as a reference.
    // Prop 123 stays: its umbrella record is retired as a source, but the card shows
    // the shared policy-timeline description of the real program.
    listEl.innerHTML = SOFT_REFERENCE.filter(function (ref) {
      var rp = ref.id && programs[ref.id];
      return ref.k === 'prop123' || !(rp && rp.status === 'retired');
    }).map(function (ref) {
      var p = programs[ref.id];
      var timeline = ref.k === 'prop123' && _softFundingTimelineEvent;
      var description = timeline ? timeline.detail : p && p.description;
      var sourceUrl = p && p.source_url;
      // Source strings are data, never markup or executable URLs.
      var url = '';
      try { if (new URL(sourceUrl).protocol === 'https:') url = sourceUrl; } catch (_) {}
      var cap = p && p.max_rule && p.max_rule.max_amount;
      var capText = typeof cap === 'number' && isFinite(cap) ? '$' + cap.toLocaleString('en-US') : 'Unavailable';
      var terms = p ?
        '<p data-program-cap style="margin:.35rem 0;font-size:var(--small);">Published project cap: ' + esc(capText) + '</p>' +
        '<p data-program-terms style="font-size:var(--tiny);">' + esc(p.max_rule && p.max_rule.text || 'Published cap terms unavailable.') + '</p>' +
        '<p data-program-source-note style="font-size:var(--tiny);">' + esc(p.source_note || 'Source detail unavailable.') + '</p>' +
        '<p data-program-verified style="font-size:var(--tiny);">Checked: ' + esc(p.last_verified || 'Unavailable') + '</p>'
        : '<p data-unavailable-reason="program_terms_missing">Verified program terms unavailable. Obtain the applicable source and award terms.</p>';
      return '<div data-program-reference="' + esc(ref.k) + '" data-program-id="' + esc(ref.id || '') + '" style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2);background:var(--card);min-width:0;overflow-wrap:anywhere;">' +
        '<strong>' + esc(p && p.name || ref.name) + '</strong>' +
        '<p data-program-type style="font-size:var(--tiny);">' + esc(p && p.funding_type ? p.funding_type.replace(/_/g, ' ') : 'Funding type unavailable') + '</p>' +
        '<p data-program-description="' + esc(ref.k) + '">' + esc(description || 'No verified description in the program reference.') + '</p>' + terms +
        (ref.notes ? '<p style="font-size:var(--tiny);">' + esc(ref.notes) + '</p>' : '') +
        (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:var(--tiny);overflow-wrap:anywhere;word-break:break-word;">' + esc(url.replace(/^https?:\/\//, '')) + ' ↗</a>' : '<span>Source unavailable</span>') + '</div>';
    }).join('');
  }
  function _initSoftFundingReference() {
    _renderSoftFundingReference();
    var timelineUrl = 'data/policy/policy-timeline.json';
    if (window.resolveAssetUrl) timelineUrl = window.resolveAssetUrl(timelineUrl);
    fetch(timelineUrl).then(function (r) { if (!r.ok) throw new Error('Policy unavailable'); return r.json(); })
      .then(function (timeline) {
        _softFundingTimelineEvent = (timeline.events || []).find(function (e) { return e.id === 'prop123'; }) || null;
        _renderSoftFundingReference();
      }).catch(function () { /* The program reference remains the source for terms. */ });
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
        // F216 — audit caught this referencing nonexistent `the deferred developer fee`.
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
          pill.style.cssText = 'margin-top:4px;padding:4px 10px;font-size:.8125rem;line-height:1.4;border-radius:var(--radius-sm);background:' + bg + ';color:' + fg + ';border:1px solid currentColor;font-weight:600;';
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
  //   3. **Credit type match** (15 pts) — 9% / 4% — from the calculator's
  //      credit-rate selector
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
      // The calculator's own 9%/4% selector. This used to be inferred from the
      // equity price (>= $0.85 meant 9%), which stopped working once 4%
      // credits began pricing at or above 9% in 2025-Q3.
      var rate4 = document.getElementById('dc-rate-4');
      return rate4 && rate4.checked ? '4%' : '9%';
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
              'Source: <a href="https://www.chfainfo.com/rental-housing/housing-credit/" target="_blank" rel="noopener" style="color:var(--accent);">CHFA Housing Tax Credit Properties</a> + HUD Multifamily + CHFA Preservation. ' +
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
  // ──────────────────────────────────────────────────────────────────
  // F230 — Novogradac equity pricing benchmark integration
  // ──────────────────────────────────────────────────────────────────
  //
  // The Deal Calc's "Credit Pricing ($/credit)" input previously had a
  // hardcoded default of $0.90 — a fiction. Novogradac publishes the
  // actual market benchmark monthly (national + regional + asset-class).
  // F230 fetches the JSON, shows the current benchmark next to the input,
  // and adds a one-click "Use benchmark" button.
  function _initNovogradacBenchmark() {
    function _go() {
      var target = document.getElementById('dc-novogradac-benchmark');
      var input = document.getElementById('dc-equity-price');
      if (!target || !input) return;
      fetch('data/market/novogradac-equity-pricing.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.pricing) return;
          _applyNovogradacPricingDefaults(j, { force: true });
          var nat = j.pricing.national_avg || {};
          var co = (j.pricing.by_state && j.pricing.by_state.CO) || {};
          var asOf = (j.meta && j.meta.as_of) || '—';
          // A missing or non-positive price is unknown: show a dash, offer no button.
          var fmt = function (v) { var n = _numOrNull(v); return n ? '$' + n.toFixed(2) : '—'; };
          var options = [
            { price: _numOrNull(nat.credit_9pct), label: 'national 9%', geography: 'United States (9% credits)' },
            { price: _numOrNull(nat.credit_4pct), label: 'national 4%', geography: 'United States (4% credits)' },
            { price: _numOrNull(co.median_all_credits), label: 'Colorado median', geography: 'Colorado (all credit types)' }
          ];
          target.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;">' +
              '<span><strong style="color:var(--accent);">📊 Novogradac ' + _escHtml(asOf) + ':</strong> ' +
                'national 9% = <strong>' + fmt(nat.credit_9pct) + '</strong>; ' +
                'national 4% = <strong>' + fmt(nat.credit_4pct) + '</strong>; ' +
                'Colorado median (all credits) = <strong>' + fmt(co.median_all_credits) + '</strong>.' +
              '</span>' +
              '<div style="display:flex;gap:.3rem;flex-wrap:wrap;">' +
                options.map(function (o, index) {
                  if (!o.price) return '';
                  return '<button type="button" class="dc-novo-apply" data-option="' + index + '" data-price="' + o.price + '" ' +
                          'style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);padding:2px 8px;border-radius:4px;font-size:.8125rem;font-weight:700;cursor:pointer;">' +
                    'Use ' + o.label + ' ($' + o.price.toFixed(2) + ')' +
                  '</button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div style="margin-top:.25rem;font-size:.8125rem;color:var(--faint);">' +
              'Source: <a href="' + _escHtml((j.meta && j.meta.source_url) || 'https://www.novoco.com') + '" target="_blank" rel="noopener" style="color:var(--accent);">Novogradac & Co. LLP</a> · ' +
              'Vintage ' + _escHtml((j.meta && j.meta.vintage) || '—') + ' · ' +
              'Verify against current Novogradac publication before quoting in IC memo.' +
            '</div>';
          // Wire the apply buttons
          target.querySelectorAll('.dc-novo-apply').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var o = options[+btn.getAttribute('data-option')];
              if (o && o.price) {
                input.value = o.price.toFixed(2);
                if (window.InputProvenance) window.InputProvenance.mark(input, { status: 'assumption',
                  source: j.meta && j.meta.source, sourceUrl: j.meta && j.meta.source_url,
                  vintage: j.meta && j.meta.vintage, geography: o.geography,
                  why: 'A published-context screening estimate; verify current project-specific pricing.' });
                prefillEvents(input);
              }
            });
          });
        })
        .catch(function () { /* silent — data file missing degrades gracefully */ });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(_go, 200); });
    } else {
      setTimeout(_go, 200);
    }
  }
  _initNovogradacBenchmark();

  // Perm-rate hint for the Interest Rate input: the live 10-year Treasury
  // from data/fred-data.json (refreshed daily by fetch-fred-data.yml) plus a
  // spread the page states and the user can change. It replaced a typed
  // "Freddie Mac outlook" snapshot (2026-10) whose 10Y, fed funds and 5.90%
  // implied rate had no citable source and had drifted a point below market.
  function _latestFredValue(doc, id) {
    var s = doc && doc.series && doc.series[id];
    var obs = s && (s.observations || s.data);
    if (!Array.isArray(obs)) return null;
    for (var i = obs.length - 1; i >= 0; i--) {
      // FRED writes "." for a day with no value: unknown, skipped, never 0.
      var raw = obs[i] && obs[i].value;
      if (raw == null || raw === '' || raw === '.') continue;
      var n = Number(raw);
      if (isFinite(n) && n > 0) return { value: n, date: obs[i].date || null };
    }
    return null;
  }

  // Set by any input/change on the rate field (typing, a prefill, the hint's
  // own apply) and by shared-scenario hydration.
  var _permRateWritten = false;
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'dc-rate') _permRateWritten = true; }, true);
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'dc-rate') _permRateWritten = true; }, true);

  function _initFreddieBenchmark() {
    function _go() {
      var target = document.getElementById('dc-freddie-benchmark');
      var input = document.getElementById('dc-rate');
      if (!target || !input) return;
      Promise.all([
        fetch('data/fred-data.json').then(function (r) { return r.ok ? r.json() : null; }),
        fetch('data/policy/lihtc-assumptions.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (res) {
        var t10 = _latestFredValue(res[0], 'DGS10');
        var a = res[1] && res[1].permRateSpreadOverTreasury;
        var spread = a && Number.isFinite(a.spreadPct) && a.spreadPct >= 0 ? a.spreadPct : null;
        if (!t10 || spread == null) {
          target.textContent = '';
          return;
        }
        target.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem;flex-wrap:wrap;">' +
            '<span><strong style="color:var(--accent);">🏦 Perm-rate hint:</strong> ' +
              '10Y Treasury ' + t10.value.toFixed(2) + '% (FRED, ' + _escHtml(t10.date || '—') + ') + ' +
              '<label>spread <input type="number" id="dc-perm-spread" min="0" max="5" step="0.05" value="' + spread.toFixed(2) + '" ' +
                'style="width:4.2em;font-size:.8125rem;" aria-label="Assumed perm-loan spread over the 10-year Treasury, percentage points"> pts</label> = ' +
              '<strong id="dc-perm-hint">' + (t10.value + spread).toFixed(2) + '%</strong>' +
            '</span>' +
            '<button type="button" id="dc-freddie-apply" ' +
                    'style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);padding:2px 8px;border-radius:4px;font-size:.8125rem;font-weight:700;cursor:pointer;">' +
              'Use this rate' +
            '</button>' +
          '</div>' +
          '<div style="margin-top:.2rem;font-size:.8125rem;color:var(--faint);">' +
            'Source: <a href="https://fred.stlouisfed.org/series/DGS10" target="_blank" rel="noopener" style="color:var(--accent);">FRED DGS10</a>. ' +
            'The spread is ' + _escHtml(a.note || 'a COHO assumption') + ' Get a lender rate sheet before an LOI.' +
          '</div>';
        var spreadEl = document.getElementById('dc-perm-spread');
        var hintEl = document.getElementById('dc-perm-hint');
        function current() {
          var sp = Number(spreadEl.value);
          return spreadEl.value !== '' && isFinite(sp) && sp >= 0 ? t10.value + sp : null;
        }
        spreadEl.addEventListener('input', function () {
          var r = current();
          hintEl.textContent = r == null ? '—' : r.toFixed(2) + '%';
        });
        function apply(r) {
          input.value = r.toFixed(2);
          if (window.InputProvenance) window.InputProvenance.mark(input, { status: 'assumption',
            source: 'FRED DGS10 plus an assumed spread', sourceUrl: 'https://fred.stlouisfed.org/series/DGS10',
            vintage: t10.date, geography: 'United States',
            why: '10-year Treasury plus a stated spread; verify with a lender rate sheet.' });
          prefillEvents(input);
        }
        document.getElementById('dc-freddie-apply').addEventListener('click', function () {
          var r = current();
          if (r != null) apply(r);
        });
        // The template's rate is an offline placeholder. Until anything
        // writes the field, start from the hint so the page shows one rate
        // rule; a rate the user typed or a shared link restored, even 6.5,
        // is left alone.
        if (!_permRateWritten) apply(t10.value + spread);
      }).catch(function () { /* silent — graceful degradation */ });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(_go, 200); });
    } else {
      setTimeout(_go, 200);
    }
  }
  _initFreddieBenchmark();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initChfaComparables);
  } else {
    _initChfaComparables();
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function (event) {
      if ((event.key === 'coho.subjectProject.v1' || event.key === null) && document.getElementById('dc-r-rents')) recalculate();
    });
  }

  window.__DealCalc = {
    init: init,
    renderForTest: render,
    recalculate: recalculate,
    getResult: getResult,
    getOutputRecords: getOutputRecords,
    getPermanentFinancing: function () { return _lastPermanentFinancing == null ? null : JSON.parse(JSON.stringify(_lastPermanentFinancing)); },
    getDohSchedules: function () { return _lastDohSchedules == null ? null : JSON.parse(JSON.stringify(_lastDohSchedules)); },
    updateAmiLimitsFromFmr: updateAmiLimitsFromFmr,
    setChfaRentTable: setChfaRentTable,
    setCostRules: function (rules) { _costRules = rules; recalculate(); },
    setProgramRentTables: setProgramRentTables,
    getRentLimitsMetadata: getRentLimitsMetadata,
    getUtilityAllowanceMetadata: getUtilityAllowanceMetadata,
    getRentScheduleMetadata: getRentScheduleMetadata,
    setSharedRentSchedule: setSharedRentSchedule,
    beginSharedScenario: function () { _hydratingSharedScenario = true; _permRateWritten = true; _manualBaseValues = null; },
    endSharedScenario: function () { restoreMarketOverrideDisplay(); _hydratingSharedScenario = false; recalculate(); },
    setSharedUtilityAllowance: setSharedUtilityAllowance,
    getAmiLimitsByBr: function () { return _amiLimitsByBr == null ? null : JSON.parse(JSON.stringify(_amiLimitsByBr)); },
    setDesignationContext: setDesignationContext,
    setTransitZoneContext: setTransitZoneContext,
    setTzCreditPairing: setTzCreditPairing,
    /* Exposed for testing — pure functions, no DOM access */
    computeDscrStressScenarios: computeDscrStressScenarios,
    computeForSaleFeasibility:  computeForSaleFeasibility,
    computeOwnershipResale:     computeOwnershipResale,
    setPermitsData:             setPermitsData,
    renderPermitContext:        renderPermitContext,
    setUnitSizeStandards:       setUnitSizeStandards,
    collectBedroomMix:          collectBedroomMix,
    computeGrossSfEstimate:     computeGrossSfEstimate,
    applyGrossSfEstimate:       applyGrossSfEstimate,
    renderForSaleFeasibility:   renderForSaleFeasibility,
    computeDeveloperOwnershipFundingStack: computeDeveloperOwnershipFundingStack,
    applyNovogradacPricingDefaults: _applyNovogradacPricingDefaults,
    findPeerDeals:              findPeerDeals,
    computeRentAchievability:   computeRentAchievability,
    getAmiBands:                function () { return DEAL_AMI_BANDS.slice(); },
    isLihtcCreditEligiblePct:   isLihtcCreditEligiblePct,
    evaluateMinimumSetAside:    evaluateMinimumSetAside,
    DEFAULT_MINIMUM_SET_ASIDE_ELECTION: DEFAULT_MINIMUM_SET_ASIDE_ELECTION,
    /* Q5 — exposed so the test harness can inject ZORI fixtures without DOM */
    getZoriCountyRent:          getZoriCountyRent,
    getZoriPerBrRent:           getZoriPerBrRent,
    getEquityPricingDefaults:   function () { return Object.assign({}, _equityPricingDefaults); },
    renderJurisdictionContextForTest: _renderJurisdictionContext,
    workflowJurisdictionContextForTest: _workflowJurisdictionContext,
    _setDeveloperOwnershipFundingForTest: function (d) { _developerOwnershipFunding = d || null; },
    _setResaleConventionsForTest: function (d) { _resaleConventions = d || null; },
    _setZoriDataForTest:        function (d) { _zoriData = d; },
    _setAmiLimitsForTest:       function (limits, byBr, fips) {
      _amiLimits = limits || null;
      _amiLimitsByBr = byBr || null;
      _countyFips = fips || null;
    },
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
