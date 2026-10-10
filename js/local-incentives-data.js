/**
 * js/local-incentives-data.js
 * Pure logic behind the Local Housing Incentives page (local-incentives.html).
 *
 * It joins four hand-verified files into one view per Colorado jurisdiction:
 *   data/policy/fee-reductions.json      fee relief (entries) and land-use incentives (land_use)
 *   data/policy/local-housing-funds.json dedicated funds, taxes, linkage fees, land and ownership tools
 *   data/policy/incentive-coverage.json  who was checked and found nothing, or could not be read
 *   data/policy/prop123_jurisdictions.json  Prop 123 commitment filings (DOLA)
 * and data/policy/incentive-alternatives.json, the catalog of tools with their
 * Colorado legal basis.
 *
 * The rule this module exists to keep: a jurisdiction with no record has NOT
 * been shown to have no program. Every scope of every jurisdiction is in one of
 * three states, and they are never collapsed:
 *   'records'     at least one verified record
 *   'none_found'  someone read the official source and it has no such measure
 *   'unreadable'  the official source could not be read
 *   'not_checked' nobody has looked yet
 *
 * No DOM, no fetch, no clock: the page and the tests both call it.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LocalIncentivesData = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var SCOPES = ['fees', 'land_use', 'funds'];

  // Fee components, in the order a developer meets them. A record's
  // fee_category decides its row; the deep dive shows every row, so a
  // component with no relief is visible rather than missing.
  var FEE_COMPONENTS = [
    { id: 'water_tap', label: 'Water tap / connection', categories: ['tap_water'] },
    { id: 'sewer_tap', label: 'Sewer tap / plant investment', categories: ['tap_sewer', 'plant_investment'] },
    { id: 'system_development', label: 'System development charge', categories: ['system_development'] },
    { id: 'impact', label: 'Impact fees (roads, parks, police, fire, schools, other)',
      categories: ['impact_transportation', 'impact_parks', 'impact_police_fire', 'impact_school', 'impact_other'] },
    { id: 'permit', label: 'Building permit and plan review', categories: ['building_permit', 'plan_review'] },
    { id: 'use_tax', label: 'Construction use tax', categories: ['use_tax'] },
    { id: 'utility_rate', label: 'Monthly utility rates', categories: ['utility_rate'] }
  ];

  var FEE_MEASURE_LABELS = {
    waived: 'Waived', reduced: 'Reduced', deferred: 'Deferred (still owed)',
    rate_discount: 'Rate discount', reimbursed: 'Reimbursed'
  };

  var LAND_USE_LABELS = {
    inclusionary_zoning: 'Inclusionary zoning', expedited_review: 'Expedited review',
    density_bonus: 'Density bonus', parking_reduction: 'Parking reduction',
    dimensional_relief: 'Dimensional relief', reduced_lot_size: 'Reduced lot size',
    land_dedication_or_donation: 'Land dedication or donation',
    by_right_or_admin_approval: 'By-right or administrative approval', other: 'Other land-use incentive'
  };

  var FUND_TOOL_LABELS = {
    housing_trust_fund: 'Housing trust fund', dedicated_sales_tax: 'Dedicated sales tax',
    dedicated_property_tax: 'Dedicated property tax (mill levy)', lodging_or_str_tax: 'Lodging or short-term-rental tax',
    other_excise_tax: 'Other excise tax', linkage_fee: 'Linkage / housing impact fee', in_lieu_fee: 'Inclusionary fee in lieu',
    real_estate_transfer_tax: 'Real estate transfer tax', land_bank_or_public_land: 'Land banking or public land',
    community_land_trust: 'Community land trust', shared_equity_or_deed_restriction: 'Shared equity or deed-restriction purchase',
    housing_authority: 'Housing authority funding', tax_increment_or_urban_renewal: 'Tax increment / urban renewal', other: 'Other local funding'
  };

  // City-and-county governments are one jurisdiction with two geoids.
  var CONSOLIDATED = { '08031': '0820000', '08014': '0809280' };

  // DOLA's filing names that do not reduce mechanically to a geo-config label.
  var PROP123_ALIASES = {
    'City of Canon City': '0811810',
    'Town of Mt. Crested Butte': '0852570',
    'Town of Creede': '0814765'
  };

  function canonicalGeoid(geoid) {
    return CONSOLIDATED[geoid] || geoid;
  }

  /** geo-config.json → Map geoid → { geoid, name, kind: county|place|cdp, county } */
  function geographies(geoConfig) {
    var out = new Map();
    (geoConfig.counties || []).forEach(function (r) {
      out.set(r.geoid, { geoid: r.geoid, name: r.label, kind: 'county', county: r.geoid });
    });
    (geoConfig.places || []).forEach(function (r) {
      out.set(r.geoid, { geoid: r.geoid, name: r.label, kind: 'place', county: r.containingCounty || null });
    });
    (geoConfig.cdps || []).forEach(function (r) {
      out.set(r.geoid, { geoid: r.geoid, name: r.label, kind: 'cdp', county: r.containingCounty || null });
    });
    return out;
  }

  function labelIndex(geo) {
    var byLabel = new Map();
    geo.forEach(function (g) { byLabel.set(g.name.toLowerCase(), g.geoid); });
    return byLabel;
  }

  /**
   * A DOLA filing name ("City of Aurora", "Town of Erie", "Adams County",
   * "City and County of Denver") → geoid, or null. Only municipalities and
   * counties can file, so a name that resolves only to a CDP is returned as
   * null: it is not a municipality, whatever the filing list says.
   */
  function resolveFilingName(name, geo, byLabel) {
    byLabel = byLabel || labelIndex(geo);
    var n = String(name || '').trim();
    if (PROP123_ALIASES[n]) return PROP123_ALIASES[n];
    if (/ County$/.test(n)) return byLabel.get(n.toLowerCase()) || null;
    var m = n.match(/^(City and County|City|Town) of (.+)$/);
    if (!m) return null;
    var base = m[2].toLowerCase();
    var tries = m[1] === 'Town' ? [base + ' (town)', base + ' (city)'] : [base + ' (city)', base + ' (town)'];
    for (var i = 0; i < tries.length; i++) {
      var id = byLabel.get(tries[i]);
      if (id && geo.get(id).kind === 'place') return id;
    }
    return null;
  }

  function prop123Index(prop123, geo) {
    var byLabel = labelIndex(geo);
    var byGeoid = new Map();
    var unmatched = [];
    ((prop123 && prop123.jurisdictions) || []).forEach(function (j) {
      var id = resolveFilingName(j.name, geo, byLabel);
      if (!id) { unmatched.push(j.name); return; }
      byGeoid.set(canonicalGeoid(id), j);
    });
    return { byGeoid: byGeoid, unmatched: unmatched, updated: (prop123 && prop123.updated) || null };
  }

  /** Every verified record as { scope, tool, record }, keyed by canonical geoid. */
  function recordIndex(fees, funds) {
    var by = new Map();
    function add(geoid, item) {
      var id = canonicalGeoid(geoid);
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(item);
    }
    ((fees && fees.entries) || []).forEach(function (r) {
      if (r.state && r.state !== 'CO') return;
      add(r.geoid, { scope: 'fees', tool: 'fee:' + r.measure, record: r });
    });
    ((fees && fees.land_use) || []).forEach(function (r) {
      if (r.state && r.state !== 'CO') return;
      add(r.geoid, { scope: 'land_use', tool: 'land_use:' + r.measure, record: r });
    });
    ((funds && funds.entries) || []).forEach(function (r) {
      add(r.geoid, { scope: 'funds', tool: 'funds:' + r.tool, record: r });
    });
    return by;
  }

  // A repealed program, a failed ballot measure or an expired tax is history,
  // not a tool in use.
  function inUse(item) {
    var r = item.record;
    if (item.scope === 'fees') return r.kind !== 'repealed';
    if (item.scope === 'land_use') return r.status !== 'repealed';
    return r.status === 'adopted';
  }

  function coverageIndex(coverage) {
    var by = new Map();
    ((coverage && coverage.jurisdictions) || []).forEach(function (row) {
      by.set(canonicalGeoid(row.geoid), row);
    });
    return by;
  }

  /** One scope's state for one jurisdiction. */
  function scopeState(items, ledgerRow, scope) {
    if (items.some(function (i) { return i.scope === scope; })) return 'records';
    var r = ledgerRow && ledgerRow.result_by_scope && ledgerRow.result_by_scope[scope];
    if (r === 'none_found' || r === 'unreadable') return r;
    return 'not_checked';
  }

  /** Map a catalog tool's maps_to onto the record tool keys it counts. */
  function toolKeys(tool) {
    var m = tool.maps_to || {};
    var keys = [];
    (m.fee_measure || []).forEach(function (x) { keys.push('fee:' + x); });
    (m.land_use_measure || []).forEach(function (x) { keys.push('land_use:' + x); });
    (m.funds_tool || []).forEach(function (x) { keys.push('funds:' + x); });
    return keys;
  }

  /** A catalog tool may narrow a fee measure to some fee categories (e.g. rate discounts → utility_rate). */
  function itemMatchesTool(item, tool) {
    if (toolKeys(tool).indexOf(item.tool) === -1) return false;
    var cats = tool.maps_to && tool.maps_to.fee_category;
    if (item.scope === 'fees' && cats && cats.length) return cats.indexOf(item.record.fee_category) !== -1;
    return true;
  }

  /**
   * Build the whole model once.
   * docs: { geoConfig, fees, funds, coverage, prop123, alternatives }
   */
  function build(docs) {
    var geo = geographies(docs.geoConfig || {});
    var records = recordIndex(docs.fees, docs.funds);
    var ledger = coverageIndex(docs.coverage);
    var p123 = prop123Index(docs.prop123, geo);
    var tools = ((docs.alternatives && docs.alternatives.tools) || []).slice();

    function itemsFor(geoid) { return records.get(canonicalGeoid(geoid)) || []; }

    function profile(geoid) {
      var g = geo.get(geoid);
      if (!g) return null;
      var canon = canonicalGeoid(geoid);
      // A CDP has no government of its own: its county's tools apply.
      var inherits = g.kind === 'cdp' && g.county ? geo.get(g.county) : null;
      var subject = inherits || g;
      var items = itemsFor(subject.geoid);
      var row = ledger.get(canonicalGeoid(subject.geoid)) || null;
      var states = {};
      SCOPES.forEach(function (s) { states[s] = scopeState(items, row, s); });
      return {
        geoid: geoid,
        canonicalGeoid: canon,
        name: g.name,
        kind: g.kind,
        county: g.county,
        inheritsFrom: inherits ? inherits.geoid : null,
        items: items,
        ledger: row,
        states: states,
        prop123: p123.byGeoid.get(canonicalGeoid(subject.geoid)) || null
      };
    }

    // Adoption of each catalog tool: distinct jurisdictions with a record in use.
    function adopters(tool) {
      var out = [];
      records.forEach(function (items, geoid) {
        if (items.some(function (i) { return inUse(i) && itemMatchesTool(i, tool); })) out.push(geoid);
      });
      return out.sort();
    }

    var adoption = tools.map(function (t) { return { tool: t, adopters: adopters(t) }; });

    /**
     * Alternatives for one jurisdiction: catalog tools it has no record of,
     * ranked by how many Colorado jurisdictions use them, with adopters in the
     * same county listed first. "No record" is not "does not have": the caller
     * shows the scope's coverage state beside every suggestion.
     * Tools Colorado law closes to new local use, or whose revenue cannot go
     * to housing, are returned separately as `ruledOut`, with the reason.
     */
    function alternatives(geoid) {
      var p = profile(geoid);
      if (!p) return null;
      var subject = p.inheritsFrom || p.geoid;
      var county = (geo.get(subject) || {}).county;
      var mine = p.items.filter(inUse);
      var suggestions = [];
      var ruledOut = [];
      adoption.forEach(function (a) {
        var t = a.tool;
        if (mine.some(function (i) { return itemMatchesTool(i, t); })) return;
        if (t.colorado_status === 'prohibited_for_new' || t.colorado_status === 'not_usable_for_housing') {
          ruledOut.push({ tool: t, adopters: a.adopters });
          return;
        }
        var near = a.adopters.filter(function (id) {
          var g = geo.get(id);
          return id !== canonicalGeoid(subject) && g && (g.county === county || id === county);
        });
        suggestions.push({ tool: t, adopters: a.adopters, nearby: near });
      });
      suggestions.sort(function (x, y) {
        return (y.nearby.length - x.nearby.length) || (y.adopters.length - x.adopters.length) ||
          String(x.tool.label).localeCompare(String(y.tool.label));
      });
      return { profile: p, suggestions: suggestions, ruledOut: ruledOut };
    }

    /** Statewide coverage: how many counties and municipalities are in each state per scope. */
    function coverageSummary() {
      var out = { jurisdictions: 0, any_records: 0, by_scope: {} };
      SCOPES.forEach(function (s) { out.by_scope[s] = { records: 0, none_found: 0, unreadable: 0, not_checked: 0 }; });
      var seen = new Set();
      geo.forEach(function (g) {
        if (g.kind === 'cdp') return;
        var canon = canonicalGeoid(g.geoid);
        if (seen.has(canon)) return;
        seen.add(canon);
        var p = profile(g.geoid);
        out.jurisdictions++;
        if (p.items.length) out.any_records++;
        SCOPES.forEach(function (s) { out.by_scope[s][p.states[s]]++; });
      });
      return out;
    }

    return {
      geo: geo,
      records: records,
      prop123: p123,
      adoption: adoption,
      profile: profile,
      alternatives: alternatives,
      coverageSummary: coverageSummary
    };
  }

  /** Which FEE_COMPONENTS row a fee record belongs to. */
  function componentOf(record) {
    for (var i = 0; i < FEE_COMPONENTS.length; i++) {
      if (FEE_COMPONENTS[i].categories.indexOf(record.fee_category) !== -1) return FEE_COMPONENTS[i].id;
    }
    return null;
  }

  return {
    SCOPES: SCOPES,
    FEE_COMPONENTS: FEE_COMPONENTS,
    FEE_MEASURE_LABELS: FEE_MEASURE_LABELS,
    LAND_USE_LABELS: LAND_USE_LABELS,
    FUND_TOOL_LABELS: FUND_TOOL_LABELS,
    CONSOLIDATED: CONSOLIDATED,
    PROP123_ALIASES: PROP123_ALIASES,
    canonicalGeoid: canonicalGeoid,
    geographies: geographies,
    resolveFilingName: resolveFilingName,
    prop123Index: prop123Index,
    recordIndex: recordIndex,
    inUse: inUse,
    toolKeys: toolKeys,
    itemMatchesTool: itemMatchesTool,
    componentOf: componentOf,
    build: build
  };
}));
