/** Pure for-sale capture, penetration, and phased-sales scenario arithmetic. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForsaleCapture = api;
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var ProjectScenario = root && root.ProjectScenario;
  if (typeof require === 'function') ProjectScenario = ProjectScenario || require('./project-scenario.js');

  var SELLOUT_SCENARIOS = [24, 30, 36, 48];
  var NOT_AVAILABLE = 'not_available';
  var ZERO_POOL = 'pool_zero_see_data_limitations';
  var LABEL_SUFFIX = ' — scenario, not a prediction';
  var COMPETITIVE_SUPPLY_NOTE = 'Capture scenarios do not account for competing for-sale inventory or pipeline; no supply data source exists yet. A professional market study must supply the competitive set.';
  // Calibration: internal/docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md (F-CAL-3).
  var HUMILITY_CAVEAT = 'Even professionally delineated market areas captured only 44% of actual applicants at the Fruita Mews benchmark; outside-area demand of 9–56% is documented. Treat capture scenarios as screening arithmetic, not achievable-sales claims.';
  var DEFAULT_POOL_GROWTH = {
    share: null,
    classification: 'modeled',
    basis: 'Annual buyer-pool replenishment or turnover requires owner-supplied evidence.',
    verify: true
  };

  function fail(message) { throw new Error('ForsaleCapture: ' + message); }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function sum(values) { return values.reduce(function (total, value) { return total + value; }, 0); }
  function denominator(value, basis) { return { value: value, basis: basis, classification: 'modeled' }; }
  function figure(value, denominatorValue, basis, reason) {
    var out = { value: value, denominator: denominator(denominatorValue, basis), classification: 'modeled' };
    if (reason) out.reason = reason;
    return out;
  }
  function unavailableFigure(basis) { return figure(NOT_AVAILABLE, NOT_AVAILABLE, basis); }
  function allocateEven(total, months) {
    var monthly = [];
    var assigned = 0;
    var share = total / months;
    for (var i = 0; i < months; i += 1) {
      var value = i === months - 1 ? total - assigned : share;
      monthly.push(value);
      assigned += value;
    }
    return monthly;
  }
  function validateGrowth(input) {
    var growth = Object.assign({}, DEFAULT_POOL_GROWTH, input || {});
    if (!growth || ['modeled', 'user_entered'].indexOf(growth.classification) < 0) fail('poolGrowthAnnual classification');
    if (growth.verify !== true || typeof growth.basis !== 'string' || !growth.basis.trim()) fail('poolGrowthAnnual evidence fields');
    if (growth.share !== null && (!finite(growth.share) || growth.share < -1)) fail('poolGrowthAnnual share');
    return growth;
  }
  function validatePacing(pacing, total) {
    pacing = pacing || {};
    var allowed = ['selloutMonths', 'distribution', 'poolGrowthAnnual'];
    Object.keys(pacing).forEach(function (key) { if (allowed.indexOf(key) < 0) fail('unsupported pacing key: ' + key); });
    var months = pacing.selloutMonths === undefined ? 30 : pacing.selloutMonths;
    if (!Number.isInteger(months) || months < 1) fail('selloutMonths must be a positive integer');
    var distribution = pacing.distribution === undefined ? 'even' : pacing.distribution;
    if (distribution !== 'even' && !Array.isArray(distribution)) fail('distribution');
    if (Array.isArray(distribution)) {
      if (distribution.length !== months || distribution.some(function (value) { return !finite(value) || value < 0; })) fail('monthlyArray length and values');
      if (sum(distribution) !== total) fail('monthlyArray must sum to total_units');
    }
    return { months: months, distribution: distribution, growth: validateGrowth(pacing.poolGrowthAnnual) };
  }
  function annualize(monthly) {
    var years = [];
    for (var start = 0; start < monthly.length; start += 12) years.push(sum(monthly.slice(start, start + 12)));
    return years;
  }
  function falloutShare(funnelResult) {
    var stage = funnelResult.stages && funnelResult.stages.find(function (item) { return item.id === 'contract_fallout'; });
    return stage && finite(stage.share) ? stage.share : null;
  }
  function grossFigure(closings, survivalShare) {
    if (survivalShare === null || survivalShare === 0) return unavailableFigure('the Phase-6 contract_fallout survival share');
    return figure(closings / survivalShare, survivalShare, 'the Phase-6 contract_fallout survival share');
  }
  function scenarioUnitsByAmi(scenarioDoc) {
    var out = {};
    scenarioDoc.program.ami_mix.forEach(function (row) { out[Math.round(row.band[0] * 100) + '-' + Math.round(row.band[1] * 100)] = row.count; });
    return out;
  }
  function scenarioUnitsByType(scenarioDoc) {
    var out = {};
    scenarioDoc.program.unit_mix.forEach(function (row, index) { out['unit_' + (index + 1)] = row.count; });
    return out;
  }
  function scenarioUnitsByBedroom(scenarioDoc) {
    var out = {};
    scenarioDoc.program.unit_mix.forEach(function (row) { out[row.bedrooms] = (out[row.bedrooms] || 0) + row.count; });
    return out;
  }
  function crossTab(units, poolTab, unavailable, includeMeta) {
    var out = {};
    Object.keys(units).forEach(function (key) {
      var poolRow = poolTab && poolTab[key];
      var pool = poolRow && poolRow.value;
      var value = unavailable || pool === NOT_AVAILABLE || !finite(pool) ? NOT_AVAILABLE : pool === 0 ? NOT_AVAILABLE : units[key] / pool;
      var reason = !unavailable && pool === 0 ? ZERO_POOL : undefined;
      out[key] = figure(value, unavailable ? NOT_AVAILABLE : pool, 'Phase-6 modeled effective demand cross-tab pool', reason);
      out[key].numerator = unavailable ? NOT_AVAILABLE : units[key];
      if (includeMeta && poolRow) {
        out[key].gapVsLocalPrice = poolRow.gapVsLocalPrice;
        out[key].assistanceRangeCheck = poolRow.assistanceRangeCheck;
      }
    });
    return out;
  }
  function sensitivityFigures(total, sensitivity, unavailable) {
    if (unavailable) return NOT_AVAILABLE;
    if (!sensitivity) return null;
    var out = {};
    ['low', 'base', 'high'].forEach(function (key) {
      out[key] = sensitivity[key] === 0
        ? figure(NOT_AVAILABLE, 0, 'Phase-6 modeled effective-demand sensitivity pool', ZERO_POOL)
        : figure(total / sensitivity[key], sensitivity[key], 'Phase-6 modeled effective-demand sensitivity pool');
    });
    return out;
  }
  function buildScenario(scenarioDoc, funnelResult, months, distribution, growth, unavailable) {
    var total = scenarioDoc.program.total_units.value;
    var monthly = unavailable ? NOT_AVAILABLE : Array.isArray(distribution) ? distribution.slice() : allocateEven(total, months);
    var annual = unavailable ? NOT_AVAILABLE : annualize(monthly);
    var fallout = falloutShare(funnelResult);
    var annualCapture = NOT_AVAILABLE;
    if (!unavailable) {
      var priorClosings = 0;
      annualCapture = annual.map(function (closings, index) {
        var pool = growth.share === null
          ? Math.max(0, funnelResult.effectiveDemand - priorClosings)
          : Math.max(0, funnelResult.effectiveDemand * Math.pow(1 + growth.share, index) - priorClosings);
        priorClosings += closings;
        return pool === 0
          ? figure(NOT_AVAILABLE, 0, 'Buyer pool available at the start of scenario year ' + (index + 1), ZERO_POOL)
          : figure(closings / pool, pool, 'Buyer pool available at the start of scenario year ' + (index + 1));
      });
    }
    return {
      selloutMonths: months,
      scenarioLabel: months + '-month sellout' + LABEL_SUFFIX,
      classification: 'modeled',
      monthlyClosings: monthly,
      annualClosings: annual,
      grossContractsNeeded: unavailable ? unavailableFigure('the Phase-6 contract_fallout survival share') : grossFigure(total, fallout),
      annualCaptureRate: annualCapture,
      totalProjectPenetration: unavailable ? unavailableFigure('Phase-6 modeled effective demand') : funnelResult.effectiveDemand === 0
        ? figure(NOT_AVAILABLE, 0, 'Phase-6 modeled effective demand', ZERO_POOL)
        : figure(total / funnelResult.effectiveDemand, funnelResult.effectiveDemand, 'Phase-6 modeled effective demand'),
      captureSensitivity: sensitivityFigures(total, funnelResult.sensitivity, unavailable),
      poolDepletionModeled: growth.share === null,
      poolGrowthAnnual: growth
    };
  }

  function run(scenarioDoc, funnelResult, pacing) {
    if (!ProjectScenario) fail('ProjectScenario dependency unavailable');
    ProjectScenario.validate(scenarioDoc);
    if (!funnelResult || !Array.isArray(funnelResult.stages)) fail('Phase-6 FunnelResult required');
    var total = scenarioDoc.program.total_units.value;
    var configured = validatePacing(pacing, total);
    var months = SELLOUT_SCENARIOS.slice();
    if (months.indexOf(configured.months) < 0) months.push(configured.months);
    var unavailable = funnelResult.effectiveDemand === NOT_AVAILABLE;
    var scenarios = months.map(function (item) {
      var distribution = item === configured.months ? configured.distribution : 'even';
      return buildScenario(scenarioDoc, funnelResult, item, distribution, configured.growth, unavailable);
    });
    return {
      scenarios: scenarios,
      captureByAmiBand: crossTab(scenarioUnitsByAmi(scenarioDoc), funnelResult.byAmiBand, unavailable, true),
      captureByUnitType: crossTab(scenarioUnitsByType(scenarioDoc), funnelResult.byUnitType, unavailable, false),
      captureByBedroom: crossTab(scenarioUnitsByBedroom(scenarioDoc), funnelResult.byBedroom, unavailable, false),
      classification: 'modeled',
      competitiveSupplyNote: COMPETITIVE_SUPPLY_NOTE,
      captureHumilityCaveat: HUMILITY_CAVEAT,
      phasingSource: 'user_pacing — scenario phasing is an owner input pending'
    };
  }

  return {
    SELLOUT_SCENARIOS: SELLOUT_SCENARIOS.slice(),
    DEFAULT_POOL_GROWTH: Object.assign({}, DEFAULT_POOL_GROWTH),
    run: run
  };
}));
