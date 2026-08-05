/** Pure screening-grade effective-demand funnel. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EffectiveDemand = api;
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var ProjectScenario = root && root.ProjectScenario;
  var OwnershipFinance = root && root.OwnershipFinance;
  if (typeof require === 'function') {
    ProjectScenario = ProjectScenario || require('./project-scenario.js');
    OwnershipFinance = OwnershipFinance || require('../hna/ownership-finance.js');
  }

  var PROTECTED_LABEL = 'potential buyer pool (moderate-income renter households) - not committed demand';
  var STAGE_IDS = [
    'household_size_compatibility', 'first_time_buyer_share', 'tenure_preference',
    'down_payment_readiness', 'debt_credit_readiness', 'mortgage_readiness',
    'unit_type_preference', 'location_preference', 'shared_equity_acceptance',
    'purchase_readiness_window', 'contract_fallout'
  ];
  var EVIDENCE = {
    household_size_compatibility: 'Requires household composition research matched to the Phase-4 bedroom-to-household-size convention.',
    first_time_buyer_share: 'Requires locally sourced first-time buyer records or primary research.',
    tenure_preference: 'Requires buyer surveys or other local primary research; not derivable from ACS/CHAS.',
    down_payment_readiness: 'Requires lender pre-qualification data or counseling-pipeline data; not derivable from ACS/CHAS.',
    debt_credit_readiness: 'Requires lender or counselor records unavailable in ACS/CHAS.',
    mortgage_readiness: 'Requires lender underwriting evidence; not derivable from ACS/CHAS.',
    unit_type_preference: 'Requires buyer surveys and broker input for the proposed unit mix.',
    location_preference: 'Requires buyer surveys and local broker input.',
    shared_equity_acceptance: 'Requires tested buyer response to the proposed shared-equity terms.',
    purchase_readiness_window: 'Requires buyer surveys and a professionally supported readiness window.',
    contract_fallout: 'Requires lender, broker, or comparable-project transaction records.'
  };
  var DEFAULT_ASSUMPTIONS = {};
  STAGE_IDS.forEach(function (id) {
    DEFAULT_ASSUMPTIONS[id] = { share: null, classification: 'modeled', basis: EVIDENCE[id], verify: true, sensitivity: null };
  });

  function fail(message) { throw new Error('EffectiveDemand: ' + message); }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function bandKey(band) { return Math.round(band[0] * 100) + '-' + Math.round(band[1] * 100); }
  function valueOf(row) { return typeof row === 'number' ? row : row && row.value; }
  function unavailableTabs(template) {
    var out = {};
    Object.keys(template).forEach(function (key) { out[key] = Object.assign({}, template[key], { value: 'not_available', classification: 'modeled' }); });
    return out;
  }
  function allocate(total, rows, weight) {
    var result = {};
    var denominator = rows.reduce(function (sum, row) { return sum + weight(row); }, 0);
    if (denominator === 0) {
      if (total !== 0) fail('allocation denominator');
      rows.forEach(function (row) { result[row.key] = Object.assign({}, row.meta, { value: 0, classification: 'modeled' }); });
      return result;
    }
    var assigned = 0;
    var lastPositive = -1;
    rows.forEach(function (row, index) { if (weight(row) > 0) lastPositive = index; });
    rows.forEach(function (row, index) {
      var value = index === lastPositive ? total - assigned : total * weight(row) / denominator;
      assigned += value;
      result[row.key] = Object.assign({}, row.meta, { value: value, classification: 'modeled' });
    });
    return result;
  }
  function validateAssumption(id, assumption, increase) {
    if (!assumption || (assumption.classification !== 'modeled' && assumption.classification !== 'user_entered')) fail(id + ' classification');
    if (assumption.verify !== true || typeof assumption.basis !== 'string' || !assumption.basis.trim()) fail(id + ' evidence fields');
    if (assumption.share !== null && !finite(assumption.share)) fail(id + ' share');
    if (increase) {
      if (assumption.share !== null && (assumption.allowIncrease !== true || assumption.share < 1.09 || assumption.share > 1.56)) fail('in_migration requires allowIncrease and a multiplier within 1.09-1.56');
    } else if (assumption.share !== null && (assumption.share < 0 || assumption.share > 1)) fail(id + ' share must be 0..1');
    if (assumption.sensitivity !== null && assumption.sensitivity !== undefined) {
      if (!['low', 'base', 'high'].every(function (key) { return finite(assumption.sensitivity[key]); })) fail(id + ' sensitivity');
      if (assumption.sensitivity.low > assumption.sensitivity.base || assumption.sensitivity.base > assumption.sensitivity.high) fail(id + ' sensitivity order');
      if (assumption.share !== null && assumption.sensitivity.base !== assumption.share) fail(id + ' sensitivity base must equal share');
      if (!increase && (assumption.sensitivity.low < 0 || assumption.sensitivity.high > 1)) fail(id + ' sensitivity bounds');
      if (increase && (assumption.sensitivity.low < 1.09 || assumption.sensitivity.high > 1.56)) fail('in_migration sensitivity range');
    }
  }
  function completeSensitivity(stageAssumptions, migration) {
    var all = stageAssumptions.every(function (a) { return a.sensitivity && ['low', 'base', 'high'].every(function (key) { return finite(a.sensitivity[key]); }); });
    if (migration && migration.share !== null) all = all && migration.sensitivity && ['low', 'base', 'high'].every(function (key) { return finite(migration.sensitivity[key]); });
    return Boolean(all);
  }
  function sensitivityResult(pool, stageAssumptions, migration) {
    if (!completeSensitivity(stageAssumptions, migration)) return null;
    function total(key) {
      var n = pool;
      if (migration && migration.share !== null) n *= migration.sensitivity[key];
      stageAssumptions.forEach(function (a) { n *= a.sensitivity[key]; });
      return n;
    }
    var result = { low: total('low'), base: total('base'), high: total('high') };
    if (result.low > result.base || result.base > result.high) fail('sensitivity must satisfy low <= base <= high');
    return result;
  }

  function fromOwnershipNeed(scenarioDoc, ownershipNeed) {
    var screen = ownershipNeed && ownershipNeed.priceBandScreen;
    if (!screen || screen.label !== PROTECTED_LABEL || !Array.isArray(screen.rows)) fail('real ownership-need priceBandScreen required');
    var rowByKey = {};
    screen.rows.forEach(function (row) { rowByKey[row.key] = row; });
    var groups = {};
    scenarioDoc.program.ami_mix.forEach(function (row) {
      var sourceKey = row.band[1] <= 0.8 ? 'lte80' : row.band[1] <= 1 ? '81to100' : '101to120';
      groups[sourceKey] = (groups[sourceKey] || 0) + row.count;
    });
    var byAmiBand = {};
    scenarioDoc.program.ami_mix.forEach(function (row) {
      var sourceKey = row.band[1] <= 0.8 ? 'lte80' : row.band[1] <= 1 ? '81to100' : '101to120';
      var sourceRow = rowByKey[sourceKey];
      var count = sourceRow.potentialBuyerPoolHouseholds * row.count / groups[sourceKey];
      byAmiBand[bandKey(row.band)] = { value: count, classification: 'derived', sourceLabel: screen.sourceLabel, label: PROTECTED_LABEL };
    });
    return {
      total: Object.keys(byAmiBand).reduce(function (sum, key) { return sum + byAmiBand[key].value; }, 0),
      byAmiBand: byAmiBand,
      classification: 'derived',
      sourceLabel: screen.sourceLabel,
      label: PROTECTED_LABEL,
      allocationConvention: 'CHAS price-screen rows allocated among matching scenario AMI bands in proportion to scenario unit counts.'
    };
  }

  function run(scenarioDoc, observedInputs, assumptions) {
    assumptions = assumptions || {};
    if (!ProjectScenario || !OwnershipFinance) fail('Phase-4 dependencies unavailable');
    var derived = ProjectScenario.derive(scenarioDoc, OwnershipFinance);
    if (!observedInputs || !finite(observedInputs.total) || observedInputs.total < 0 || ['observed', 'derived'].indexOf(observedInputs.classification) < 0 || observedInputs.label !== PROTECTED_LABEL) fail('observed inputs');
    if (!observedInputs.byAmiBand || Object.keys(observedInputs.byAmiBand).some(function (key) { return ['observed', 'derived'].indexOf(observedInputs.byAmiBand[key].classification) < 0; })) fail('observed AMI classifications');
    var configured = STAGE_IDS.map(function (id) { return Object.assign({}, DEFAULT_ASSUMPTIONS[id], assumptions[id] || {}); });
    configured.forEach(function (item, index) { validateAssumption(STAGE_IDS[index], item, false); });
    var migration = assumptions.in_migration ? Object.assign({}, assumptions.in_migration) : null;
    if (migration) validateAssumption('in_migration', migration, true);
    var stages = [{ id: 'observed_base', inputCount: observedInputs.total, share: null, outputCount: observedInputs.total, classification: observedInputs.classification, basis: observedInputs.sourceLabel, label: PROTECTED_LABEL }];
    var current = observedInputs.total;
    var unresolved = [];
    var unavailable = false;
    if (migration) {
      var migrationOutput = migration.share === null ? 'not_available' : current * migration.share;
      stages.push({ id: 'in_migration', inputCount: current, share: migration.share, outputCount: migrationOutput, classification: 'modeled', assumptionClassification: migration.classification, basis: migration.basis, verify: true, allowIncrease: migration.allowIncrease === true });
      if (migration.share === null) { unresolved.push('in_migration'); unavailable = true; } else current = migrationOutput;
    }
    configured.forEach(function (item, index) {
      var id = STAGE_IDS[index];
      var input = unavailable ? 'not_available' : current;
      var output = item.share === null || unavailable ? 'not_available' : current * item.share;
      stages.push({ id: id, inputCount: input, share: item.share, outputCount: output, classification: 'modeled', assumptionClassification: item.classification, basis: item.basis, verify: true });
      if (item.share === null) unresolved.push(id);
      if (output === 'not_available') unavailable = true; else current = output;
    });
    var amiTemplate = {};
    derived.bands.forEach(function (row) {
      var key = bandKey(row.band);
      amiTemplate[key] = { band: row.band.slice(), midpoint: row.midpoint, representativeBedrooms: row.representativeBedrooms, householdSize: row.householdSize, maxAffordablePrice: row.maxAffordablePrice, gapVsLocalPrice: row.gapVsLocalPrice, assistanceRangeCheck: row.assistanceRangeCheck };
    });
    var unitRows = scenarioDoc.program.unit_mix.map(function (row, i) { return { key: 'unit_' + (i + 1), count: row.count, meta: { bedrooms: row.bedrooms, sqftRange: row.sqft_range.slice(), scenarioUnits: row.count } }; });
    var bedroomCounts = {};
    scenarioDoc.program.unit_mix.forEach(function (row) { bedroomCounts[row.bedrooms] = (bedroomCounts[row.bedrooms] || 0) + row.count; });
    var bedroomRows = Object.keys(bedroomCounts).map(function (key) { return { key: key, count: bedroomCounts[key], meta: { bedrooms: Number(key), scenarioUnits: bedroomCounts[key] } }; });
    var effective = unavailable ? 'not_available' : current;
    var byAmiBand;
    var byUnitType;
    var byBedroom;
    if (unavailable) {
      byAmiBand = unavailableTabs(amiTemplate);
      byUnitType = unavailableTabs(allocate(1, unitRows, function (row) { return row.count; }));
      byBedroom = unavailableTabs(allocate(1, bedroomRows, function (row) { return row.count; }));
    } else {
      var observedRows = derived.bands.map(function (row) { var key = bandKey(row.band); return { key: key, count: valueOf(observedInputs.byAmiBand[key]), meta: amiTemplate[key] }; });
      byAmiBand = allocate(effective, observedRows, function (row) { return row.count; });
      byUnitType = allocate(effective, unitRows, function (row) { return row.count; });
      byBedroom = allocate(effective, bedroomRows, function (row) { return row.count; });
    }
    return {
      stages: stages, byAmiBand: byAmiBand, byUnitType: byUnitType, byBedroom: byBedroom,
      effectiveDemand: effective, observedPool: observedInputs.total, observedPoolLabel: PROTECTED_LABEL, unresolvedStages: unresolved,
      classification: 'modeled', screeningCaveat: 'Screening-grade modeled funnel; the potential buyer pool is not committed demand.',
      professionalStudyNote: 'A professional study and primary research must supply broker and lender input, comparable-project performance evidence, and buyer surveys.',
      allocationConvention: 'AMI results retain observed-screen proportions; unit-type and bedroom results use proportional scenario unit counts.',
      householdSizeConvention: derived.convention,
      sensitivity: unavailable ? null : sensitivityResult(observedInputs.total, configured, migration)
    };
  }

  return { STAGE_IDS: STAGE_IDS.slice(), DEFAULT_ASSUMPTIONS: copy(DEFAULT_ASSUMPTIONS), PROTECTED_LABEL: PROTECTED_LABEL, fromOwnershipNeed: fromOwnershipNeed, run: run };
}));
