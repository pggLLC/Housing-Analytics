/** Pure project-scenario/v1 loader, validator, derivation, and adapter. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectScenario = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CLASSIFICATIONS = ['observed', 'derived', 'modeled', 'user_entered', 'not_available'];
  var PARTNER_ROLES = ['developer', 'steward', 'lender', 'counselor', 'administrator', 'land_owner', 'broker'];
  var HOUSEHOLD_SIZE_BY_BEDROOM = { 1: 2, 2: 3, 3: 4, 4: 5 };
  var BANNED = new RegExp([
    'fore' + 'cast', 'capture' + ' rate', 'absor' + 'ption', 'sell' + 'out',
    'time-' + 'phasing', '\\bcommit' + 'ted\\b', '\\bguaran' + 'teed\\b'
  ].join('|'), 'i');

  function fail(message) { throw new Error('ProjectScenario: ' + message); }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function sameBand(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && a[0] === b[0] && a[1] === b[1]; }
  function sum(rows) { return rows.reduce(function (total, row) { return total + row.count; }, 0); }
  function classified(node, path) {
    if (!node || typeof node !== 'object' || !CLASSIFICATIONS.includes(node.classification)) fail(path + ' classification');
    if (node.classification === 'observed' && !node.source) fail(path + ' observed source');
    if (Object.prototype.hasOwnProperty.call(node, 'value') && node.value === null && node.verify !== true) fail(path + ' null requires verify');
    if (node.classification === 'not_available') {
      if (Object.prototype.hasOwnProperty.call(node, 'value') && node.value !== null) fail(path + ' not_available must be null');
      if (Object.prototype.hasOwnProperty.call(node, 'value') && node.owner_input_required !== true) fail(path + ' owner input required');
    }
  }
  function numericRange(range, path) {
    if (!Array.isArray(range) || range.length !== 2 || !finite(range[0]) || !finite(range[1]) || range[0] > range[1]) fail(path + ' numeric range');
  }
  function walkCommitments(value, path) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      if (key === 'is_commitment' && value[key] !== false) fail(path + '.' + key + ' must be false');
      walkCommitments(value[key], path + '.' + key);
    });
  }
  function walkStale(value) {
    if (typeof value === 'number' && (value === 94100 || value === 87.3 || value === 82.2 || (value >= 536000 && value <= 594000))) fail('stale figure');
    if (value && typeof value === 'object') Object.keys(value).forEach(function (key) { walkStale(value[key]); });
  }

  function validate(doc, registries) {
    if (!doc || doc.schema !== 'project-scenario/v1') fail('schema');
    if (!doc.meta || doc.meta.status !== 'hypothesis_to_test' || !Array.isArray(doc.meta.owner_inputs_pending)) fail('meta');
    ['tdc_build_up', 'land_value', 'phasing', 'hrwc_terms', 'development_partner', 'lender'].forEach(function (key) { if (doc.meta.owner_inputs_pending.indexOf(key) < 0) fail('owner_inputs_pending ' + key); });
    if (!doc.jurisdiction || !/^08\d{5}$/.test(doc.jurisdiction.place_geoid) || !/^08\d{3}$/.test(doc.jurisdiction.county_fips)) fail('jurisdiction');
    if (doc.partners != null && !Array.isArray(doc.partners)) fail('partners array');
    var landOwners = 0;
    (doc.partners || []).forEach(function (partner, index) {
      classified(partner, 'partners[' + index + ']');
      if (PARTNER_ROLES.indexOf(partner.role) < 0) fail('partner role');
      if (partner.is_commitment !== false) fail('partner commitment');
      if (partner.role === 'land_owner') landOwners += 1;
      if (partner.name == null && partner.provider_id == null && partner.verify !== true) fail('unknown partner requires verify');
      if (partner.classification === 'not_available' && partner.owner_input_required !== true) fail('partner owner input required');
      if (partner.provider_id != null && registries && registries.stewardshipProviders) {
        var providers = registries.stewardshipProviders.providers || [];
        if (!providers.some(function (provider) { return provider.id === partner.provider_id; })) fail('unresolved partner provider_id');
      }
    });
    if (landOwners > 1) fail('multiple land owners');
    ['ami_4person', 'home_value', 'median_sale_price'].forEach(function (key) {
      var node = doc.local_baseline && doc.local_baseline[key];
      classified(node, 'local_baseline.' + key);
      if (node.value !== null && !finite(node.value)) fail('local_baseline.' + key + ' number-or-null');
    });
    var program = doc.program;
    if (!program || !Array.isArray(program.unit_mix) || !Array.isArray(program.ami_mix)) fail('program');
    classified(program.total_units, 'program.total_units');
    classified(program.tenure_form, 'program.tenure_form');
    if (!Number.isInteger(program.total_units.value) || program.total_units.value <= 0) fail('total units');
    program.unit_mix.forEach(function (row, index) {
      classified(row, 'program.unit_mix[' + index + ']');
      if (!Number.isInteger(row.bedrooms) || !HOUSEHOLD_SIZE_BY_BEDROOM[row.bedrooms] || !Number.isInteger(row.count) || row.count < 0) fail('unit mix row');
      numericRange(row.sqft_range, 'unit_mix sqft');
    });
    program.ami_mix.forEach(function (row, index) {
      classified(row, 'program.ami_mix[' + index + ']');
      numericRange(row.band, 'ami_mix band');
      if (row.band[0] <= 0 || row.band[1] > 2 || !Number.isInteger(row.count) || row.count < 0 || !HOUSEHOLD_SIZE_BY_BEDROOM[row.representative_bedrooms]) fail('ami mix row');
    });
    if (sum(program.unit_mix) !== program.total_units.value) fail('unit mix count mismatch');
    if (sum(program.ami_mix) !== program.total_units.value) fail('AMI mix count mismatch');
    if (program.variant_note) classified(program.variant_note, 'program.variant_note');
    if (!doc.land || !doc.land.disposition_model || doc.land.hypothesis_to_test !== true) fail('land hypothesis');
    classified(doc.land.land_value_per_unit, 'land.land_value_per_unit');
    Object.keys(doc.costs || {}).forEach(function (key) {
      classified(doc.costs[key], 'costs.' + key);
      if (doc.costs[key].value !== null && !finite(doc.costs[key].value)) fail('costs.' + key + ' number-or-null');
    });
    if (!doc.costs || !doc.costs.tdc) fail('costs.tdc');
    classified(doc.carrying && doc.carrying.hoa_monthly, 'carrying.hoa_monthly');
    numericRange(doc.carrying.hoa_monthly.range, 'HOA range');
    if (!finite(doc.carrying.hoa_monthly.higher_cost_scenario)) fail('higher HOA');
    classified(doc.carrying.property_tax, 'carrying.property_tax');
    if (!Array.isArray(doc.assistance_ranges) || !doc.assistance_ranges.length) fail('assistance ranges');
    doc.assistance_ranges.forEach(function (row, index) {
      classified(row, 'assistance_ranges[' + index + ']');
      numericRange(row.band, 'assistance band');
      numericRange(row.range, 'assistance range');
      if (row.is_commitment !== false) fail('assistance commitment');
    });
    if (!doc.stewardship || doc.stewardship.is_commitment !== false) fail('stewardship commitment');
    classified(doc.stewardship.terms, 'stewardship.terms');
    classified(doc.phasing, 'phasing');
    walkCommitments(doc, 'doc');
    walkStale(doc);
    if (BANNED.test(JSON.stringify(doc))) fail('banned language');
    return true;
  }

  function load(input, registries) {
    var doc = typeof input === 'string' ? JSON.parse(input) : JSON.parse(JSON.stringify(input));
    validate(doc, registries);
    return doc;
  }

  function derive(doc, engine, options) {
    validate(doc);
    if (!engine || typeof engine.maxAffordablePrice !== 'function') fail('OwnershipFinance engine');
    options = options || {};
    var ami = doc.local_baseline.ami_4person.value;
    var localPrice = doc.local_baseline.home_value.value;
    var modelId = options.modelId || 'conservative_screening';
    var hoa = options.hoaScenario === 'higher_cost' ? doc.carrying.hoa_monthly.higher_cost_scenario : 0;
    var bands = doc.program.ami_mix.map(function (row) {
      var midpoint = (row.band[0] + row.band[1]) / 2;
      var householdSize = HOUSEHOLD_SIZE_BY_BEDROOM[row.representative_bedrooms];
      var maxPrice = ami == null || localPrice == null ? null : engine.maxAffordablePrice(ami, midpoint, { modelId: modelId, householdSize: householdSize, hoaMonthly: hoa });
      var gap = maxPrice == null ? null : localPrice - maxPrice;
      var assistance = doc.assistance_ranges.find(function (candidate) { return sameBand(candidate.band, row.band); });
      var status = gap == null || !assistance ? 'unknown' : assistance.range[1] >= Math.max(0, gap) ? 'sufficient' : 'insufficient';
      return { band: row.band.slice(), midpoint: midpoint, count: row.count, representativeBedrooms: row.representative_bedrooms, householdSize: householdSize, maxAffordablePrice: maxPrice, gapVsLocalPrice: gap, assistanceRangeCheck: status, classification: 'derived' };
    });
    var tdc = doc.costs.tdc.value;
    return {
      convention: 'representative-bedroom household size: 1BR→2-person, 2BR→3-person, 3BR→4-person, 4BR→5-person',
      modelId: modelId,
      bands: bands,
      totalUnits: doc.program.total_units.value,
      tdcDependent: {
        tdcPerUnit: tdc == null ? 'not_available' : tdc / doc.program.total_units.value,
        subsidyPerUnit: tdc == null ? 'not_available' : tdc / doc.program.total_units.value - bands.reduce(function (total, row) { return total + (row.maxAffordablePrice || 0) * row.count; }, 0) / doc.program.total_units.value,
        classification: tdc == null ? 'not_available' : 'derived'
      },
      classification: 'derived'
    };
  }

  function toSubjectProject(doc) {
    validate(doc);
    var bedroomRows = doc.program.unit_mix.map(function (row) { return { row: row, remaining: row.count }; });
    var amiRows = doc.program.ami_mix.map(function (row) { return { row: row, remaining: row.count }; });
    var unitMix = [];
    var b = 0;
    var a = 0;
    while (b < bedroomRows.length && a < amiRows.length) {
      var count = Math.min(bedroomRows[b].remaining, amiRows[a].remaining);
      unitMix.push({
        bedrooms: bedroomRows[b].row.bedrooms + 'BR',
        ami_tier: Math.round(((amiRows[a].row.band[0] + amiRows[a].row.band[1]) / 2) * 100),
        count: count,
        sqft: Math.round((bedroomRows[b].row.sqft_range[0] + bedroomRows[b].row.sqft_range[1]) / 2),
        proposed_gross_rent: null,
        utility_allowance: null
      });
      bedroomRows[b].remaining -= count;
      amiRows[a].remaining -= count;
      if (!bedroomRows[b].remaining) b += 1;
      if (!amiRows[a].remaining) a += 1;
    }
    return {
      project_name: doc.meta.name,
      address: '',
      county_fips: doc.jurisdiction.county_fips,
      county_name: 'Mesa',
      total_units: doc.program.total_units.value,
      site_acres: null,
      buildings: null,
      construction_type: 'new_construction',
      credit_type: 'ownership screening',
      in_migration_pct: 0,
      target_population: 'family',
      use_hera_special: false,
      pis_date: null,
      unit_mix: unitMix,
      amenities: [],
      notes: 'Project scenario adapter; verify owner inputs.',
      updated_at: null
    };
  }

  return { CLASSIFICATIONS: CLASSIFICATIONS.slice(), PARTNER_ROLES: PARTNER_ROLES.slice(), HOUSEHOLD_SIZE_BY_BEDROOM: Object.assign({}, HOUSEHOLD_SIZE_BY_BEDROOM), load: load, validate: validate, derive: derive, toSubjectProject: toSubjectProject };
}));
