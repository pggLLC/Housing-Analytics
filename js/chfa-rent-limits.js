/** CHFA published rent/income lookups and contract-rent arithmetic. No DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChfaRentLimits = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var REGULATION_URL = 'https://www.law.cornell.edu/cfr/text/26/1.42-10';
  var ALLOWANCE_METHODS = Object.freeze([
    ['rhs_building', 'RHS-assisted building', '(b)(1)', 'RHS-assisted buildings must use the RHS allowance.'],
    ['rhs_tenant', 'RHS-assisted tenant', '(b)(2)', 'Any RHS-assisted tenant makes the RHS allowance apply building-wide.'],
    ['hud_regulated', 'HUD-regulated building', '(b)(3)', 'HUD-regulated buildings without RHS assistance use the HUD allowance.'],
    ['pha_section8_tenant', 'PHA — Section 8 tenant', '(b)(4)(i)', 'In other buildings, HUD-assisted tenants use the Section 8 PHA allowance.'],
    ['pha', 'PHA (default)', '(b)(4)(ii)(A)', 'Otherwise, the PHA allowance applies unless a (B)–(E) estimate is obtained.'],
    ['utility_company', 'Utility company estimate', '(b)(4)(ii)(B)', 'For eligible other units: a written local utility estimate for comparable units.'],
    ['agency_estimate', 'Housing credit agency estimate', '(b)(4)(ii)(C)', 'For eligible other units: a written estimate from the agency with jurisdiction.'],
    ['hud_usm', 'HUD Utility Schedule Model', '(b)(4)(ii)(D)', 'For eligible other units: the HUD model using qualifying utility rates.'],
    ['energy_model', 'Energy consumption model', '(b)(4)(ii)(E)', 'For eligible other units: a qualified professional’s model, subject to agency review.'],
    ['owner_pays_all', 'Owner pays all utilities', null, 'Residents pay no utilities: $0 allowance; not a §1.42-10 method.']
  ].map(function (m) {
    return Object.freeze({ method: m[0], label: m[1], paragraph: m[2], applicability: m[3], sourceUrl: REGULATION_URL });
  }));
  var RESIDENT_UTILITIES = Object.freeze({
    heat: 'Heat', cooking: 'Cooking', water_heating: 'Water heating',
    other_electric: 'Other electric', air_conditioning: 'Air conditioning',
    water: 'Water', sewer: 'Sewer', trash: 'Trash'
  });

  function allowanceBasisStatus(basis, countyFips) {
    basis = basis || {};
    function blocked(reason) { return { complete: false, unavailableReason: reason }; }
    if (!ALLOWANCE_METHODS.some(function (m) { return m.method === basis.method; })) {
      return blocked('allowance_method_missing');
    }
    var paid = basis.resident_paid;
    if (basis.method === 'owner_pays_all') {
      return Array.isArray(paid) && paid.length === 0
        ? { complete: true, unavailableReason: null } : blocked('owner_pays_all_resident_utilities');
    }
    if (typeof basis.reference !== 'string' || !basis.reference.trim()) return blocked('allowance_reference_missing');
    var date = basis.effective_date;
    var parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
    if (!parsed || !isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return blocked('allowance_date_missing');
    }
    // Compare calendar dates in the user's local timezone, with no time-of-day cutoff.
    var now = new Date();
    var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if (date > today) return blocked('allowance_date_in_future');
    if (!Array.isArray(paid) || paid.length === 0 || paid.some(function (key) {
      return !Object.prototype.hasOwnProperty.call(RESIDENT_UTILITIES, key);
    })) return blocked('resident_utilities_missing');
    if (!countyFips || basis.bound_county_fips !== countyFips) return blocked('allowance_basis_other_geography');
    return { complete: true, unavailableReason: null };
  }

  // Package C remains the only source of entered allowance amounts and fees.
  // Missing bedrooms remain null; the calculator checks only bedrooms it uses.
  function allowanceByBedroom(subject, countyFips) {
    var result = { applied: false, reason: null, perBedroom: {}, feesPerBedroom: {},
      basis: { method: null, reference: null, effectiveDate: null } };
    var bedrooms = Object.keys(BR_TO_CHFA_KEY);
    bedrooms.forEach(function (br) { result.perBedroom[br] = null; result.feesPerBedroom[br] = 0; });
    function blocked(reason) { result.reason = reason; return result; }
    if (!subject) return blocked('subject_project_unavailable');
    var basis = subject.utility_allowance_basis;
    var status = allowanceBasisStatus(basis, countyFips);
    if (!status.complete) return blocked(status.unavailableReason);
    if (!countyFips || subject.county_fips !== countyFips) return blocked('allowance_basis_other_geography');
    result.basis = { method: basis.method, reference: basis.reference || null, effectiveDate: basis.effective_date || null };
    var rows = Array.isArray(subject.unit_mix) ? subject.unit_mix : [];
    for (var i = 0; i < bedrooms.length; i++) {
      var br = bedrooms[i];
      var matching = rows.filter(function (row) { return row.ami_tier !== 'market' && row.bedrooms === br; });
      var allowances = matching.map(function (row) { return _allowance(row.utility_allowance); });
      var fees = matching.map(function (row) {
        return row.fees == null || (typeof row.fees === 'string' && !row.fees.trim()) ? 0 : _allowance(row.fees);
      });
      if (fees.some(function (v) { return v == null; })) return blocked('fees_invalid:' + br);
      var known = allowances.filter(function (v) { return v != null; });
      if ((basis.method !== 'owner_pays_all' && known.some(function (v) { return v !== known[0]; })) ||
          fees.some(function (v) { return v !== fees[0]; })) return blocked('allowance_conflict:' + br);
      result.perBedroom[br] = basis.method === 'owner_pays_all' ? 0
        : allowances.length && allowances.every(function (v) { return v != null; }) ? allowances[0] : null;
      result.feesPerBedroom[br] = fees.length ? fees[0] : 0;
    }
    result.applied = true;
    return result;
  }

  function unavailableMessage(reason) {
    var messages = {
      subject_project_unavailable: 'Subject project unavailable',
      rent_module_unavailable: 'Rent module unavailable',
      allowance_conflict: 'Conflicting utility allowances or fees',
      allowance_bedroom_missing: 'Utility allowance missing for bedroom size',
      allowance_method_missing: 'Choose a utility allowance method',
      allowance_reference_missing: 'Enter the allowance schedule, authority or model',
      allowance_date_missing: 'Enter a valid allowance effective date',
      allowance_date_in_future: 'Allowance effective date is in the future',
      resident_utilities_missing: 'Select the utilities residents pay',
      allowance_basis_other_geography: 'Source the allowance for this county',
      owner_pays_all_resident_utilities: 'Owner pays all requires no resident-paid utilities',
      utility_allowance_missing: 'Enter UA',
      deductions_exceed_gross_rent: 'Allowance exceeds max rent',
      gross_rent_missing: 'Gross rent unavailable',
      proposed_rent_missing: 'Enter a positive proposed gross rent',
      market_rent_missing: 'Enter a positive market rent',
      market_rent_source_missing: 'Enter the market-rent source citation',
      over_chfa_max: 'Proposed gross rent exceeds the CHFA maximum',
      row_unit_count_invalid: 'Enter a positive whole-number row count',
      unit_count_invalid: 'Enter valid project and row unit counts',
      unit_count_mismatch: 'Scheduled units do not match the project total',
      schedule_empty: 'Add units to the rent schedule',
      unpriced_rows: 'Rent unavailable for rows',
      no_priced_rows: 'Rent unavailable — no priced rows',
      vacancy_rate_missing: 'Enter the vacancy rate to see effective rent',
      vacancy_rate_invalid: 'Vacancy rate must be between 0% and 100%',
      fees_invalid: 'Enter valid nonoptional fees',
      county_missing: 'County rent limits unavailable',
      tier_missing: 'AMI tier unavailable',
      bedroom_size_missing: 'Bedroom size unavailable',
      income_limit_missing: 'Household income limit unavailable',
      rent_burden_invalid: 'Enter a valid rent burden',
      regime_unknown: 'Choose a rent-limit setting',
      unrestricted_market: 'No restricted limit (market-rate)',
      hera_pis_missing: 'Enter a valid placed-in-service date for HERA',
      hera_pis_after_2008: 'HERA requires a placed-in-service date on or before 2008-12-31',
      hera_county_unavailable: 'HERA Special limits are unavailable for this county'
    };
    var parts = String(reason || '').split(':');
    return (messages[parts[0]] || 'Rent unavailable') + (parts[1] ? ' — ' + parts[1] : '');
  }

  function allowanceBasisCaption(basis, countyFips) {
    var method = ALLOWANCE_METHODS.find(function (m) { return basis && m.method === basis.method; });
    if (!method || !allowanceBasisStatus(basis, countyFips).complete) return '';
    return 'Utility allowance: ' + method.label + (basis.method === 'owner_pays_all'
      ? ' — $0 allowance; effective date not required' : ' · effective ' + basis.effective_date);
  }

  // IRS §42 LIHTC max-rent imputed household size by bedroom count.
  var BR_HH_SIZE = {
    'efficiency': 1.0,
    '1BR':        1.5,
    '2BR':        3.0,
    '3BR':        4.5,
    '4BR':        6.0
  };

  // Bedroom → CHFA's max_rents key.
  var BR_TO_CHFA_KEY = {
    'efficiency': '0br', '1BR': '1br', '2BR': '2br', '3BR': '3br', '4BR': '4br'
  };

  function _countyRow(data, fips) {
    if (!data || !data.counties || !fips) return null;
    fips = String(fips).padStart(5, '0');
    return data.counties.find(function (c) { return c.fips === fips; }) || null;
  }

  // Pick the right tier bucket given HERA preference.
  function _tiersBucket(countyRow, useHera) {
    if (!countyRow) return null;
    if (useHera && countyRow.hera_special && countyRow.hera_tiers) {
      // HERA-flagged counties only publish HERA limits for a subset of tiers
      // (30/40/45/50/55/60 typically). For tiers above the HERA range, fall
      // back to regular limits.
      return { hera: countyRow.hera_tiers, regular: countyRow.regular_tiers };
    }
    return { regular: countyRow.regular_tiers };
  }

  function _findTier(buckets, tier) {
    if (!buckets) return null;
    var key = String(tier);
    if (buckets.hera && buckets.hera[key]) return { row: buckets.hera[key], hera: true };
    if (buckets.regular && buckets.regular[key]) return { row: buckets.regular[key], hera: false };
    return null;
  }

  function _allowance(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '') ||
        (typeof v !== 'number' && typeof v !== 'string')) return null;
    var n = +v;
    return isFinite(n) && n >= 0 ? n : null;
  }

  function _metadata(table, hit, familySize) {
    var meta = table.meta || {};
    return {
      hera: hit.hera,
      familySize: familySize,
      tableYear: meta.fiscal_year == null ? null : meta.fiscal_year,
      effectiveDate: meta.effective_date || null,
      sourceUrl: meta.source_url || null
    };
  }

  // CHFA meta.hera_special_note is the authority for the PIS cutoff.
  function heraStatus(table, fips, opts) {
    if (!opts || !opts.useHera) return { complete: true, unavailableReason: null };
    var date = opts.pisDate;
    var parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
    var reason = null;
    if (!parsed || !isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) reason = 'hera_pis_missing';
    else if (date > '2008-12-31') reason = 'hera_pis_after_2008';
    else {
      var county = _countyRow(table, fips);
      if (!county || !county.hera_special) reason = 'hera_county_unavailable';
    }
    return { complete: !reason, unavailableReason: reason,
      sourceNote: table && table.meta ? table.meta.hera_special_note : null };
  }

  function _lookup(table, fips, tier, opts) {
    var county = _countyRow(table, fips);
    if (!county) return { unavailableReason: 'county_missing' };
    var hera = heraStatus(table, fips, opts);
    if (!hera.complete) return { unavailableReason: hera.unavailableReason };
    var hit = _findTier(_tiersBucket(county, opts && opts.useHera), tier);
    return hit || { unavailableReason: 'tier_missing' };
  }

  function maxGrossRent(table, fips, tier, bedrooms, opts) {
    var hit = _lookup(table, fips, tier, opts);
    if (hit.unavailableReason) return { grossRent: null, unavailableReason: hit.unavailableReason };
    var key = BR_TO_CHFA_KEY[bedrooms];
    var rent = key && hit.row.max_rents ? _allowance(hit.row.max_rents[key]) : null;
    if (rent == null || rent <= 0) return { grossRent: null, unavailableReason: 'bedroom_size_missing' };
    return Object.assign({ grossRent: rent }, _metadata(table, hit, BR_HH_SIZE[bedrooms]));
  }

  function incomeLimit(table, fips, tier, householdSize, opts) {
    var hit = _lookup(table, fips, tier, opts);
    if (hit.unavailableReason) return { incomeLimit: null, unavailableReason: hit.unavailableReason };
    var limit = hit.row.income_limits ? _allowance(hit.row.income_limits[householdSize + 'p']) : null;
    if (limit == null) return { incomeLimit: null, unavailableReason: 'household_size_missing' };
    return Object.assign({ incomeLimit: limit }, _metadata(table, hit, +householdSize));
  }

  var FORMULA_METHOD = 'Formula ceiling for a non-CHFA AMI-restricted rental — not a published program limit';
  var HUD_IL_URL = 'https://www.huduser.gov/portal/datasets/il.html';

  function rentCeiling(args) {
    args = args || {};
    var regime = args.regime || 'chfa_lihtc';
    var table = regime === 'chfa_lihtc' ? args.chfaTable : args.hudTable;
    var meta = table && table.meta || {};
    var result = { grossRent: null, regime: regime, method: null, source: null,
      tableYear: null, effectiveDate: null, sourceUrl: null, unavailableReason: null };
    function blocked(reason) { result.unavailableReason = reason; return result; }
    if (regime === 'market') {
      result.method = 'Unrestricted market rent';
      result.source = 'Market rents';
      return blocked('unrestricted_market');
    }
    if (regime === 'chfa_lihtc') {
      result.method = 'CHFA published maximum gross rent';
      result.source = meta.source || 'CHFA';
      result.tableYear = meta.fiscal_year == null ? null : meta.fiscal_year;
      result.effectiveDate = meta.effective_date || null;
      result.sourceUrl = meta.source_url || null;
      var published = maxGrossRent(table, args.fips, args.tier, args.bedrooms,
        { useHera: args.useHera, pisDate: args.pisDate });
      result.grossRent = published.grossRent;
      result.unavailableReason = published.unavailableReason || null;
      return result;
    }
    if (regime !== 'ami_formula') return blocked('regime_unknown');
    result.method = FORMULA_METHOD;
    result.source = 'HUD Income Limits';
    result.tableYear = meta.income_limits_fiscal_year || meta.fiscal_year || null;
    result.effectiveDate = meta.income_limits_effective_date || meta.effective_date || null;
    result.sourceUrl = meta.url_il || HUD_IL_URL;
    var county = _countyRow(table, args.fips);
    if (!county) return blocked('county_missing');
    // HUD family-size adjustments: 5 persons = 108%, 6 = 116% of 4p.
    // 3BR imputes 4.5 persons: average of 100% and 108% = 104%.
    // Source: https://www.huduser.gov/portal/datasets/il.html
    var sizes = { efficiency: [1], '1BR': [1, 2], '2BR': [3], '3BR': [4], '4BR': [4] };
    var persons = sizes[args.bedrooms];
    if (!persons) return blocked('bedroom_size_missing');
    var il = county.income_limits || {};
    var values = persons.map(function (n) { return _allowance(il['il50_' + n + 'person']); });
    if (values.some(function (v) { return v == null || v <= 0; })) return blocked('income_limit_missing');
    var limit = values.reduce(function (sum, v) { return sum + v; }, 0) / values.length;
    if (args.bedrooms === '3BR') limit *= 1.04;
    if (args.bedrooms === '4BR') limit *= 1.16;
    var tier = _allowance(args.tier);
    var burden = _allowance(args.rentBurden);
    if (tier == null || tier <= 0) return blocked('tier_missing');
    if (burden == null || burden <= 0 || burden > 1) return blocked('rent_burden_invalid');
    result.grossRent = limit * (tier / 50) * burden / 12;
    return result;
  }

  function maxContractRent(args) {
    args = args || {};
    var feesEntered = args.fees != null && !(typeof args.fees === 'string' && args.fees.trim() === '');
    var gross = _allowance(args.grossRent);
    var ua = _allowance(args.utilityAllowance);
    var fees = feesEntered ? _allowance(args.fees) : 0;
    function unavailable(reason) {
      return { contractRent: null, unavailableReason: reason, feesEntered: feesEntered };
    }
    if (args.basisStatus != null && !args.basisStatus.complete) return unavailable(args.basisStatus.unavailableReason);
    if (ua == null) return unavailable('utility_allowance_missing');
    if (gross == null) return unavailable('gross_rent_missing');
    if (fees == null) return unavailable('fees_invalid');
    if (ua + fees > gross) return unavailable('deductions_exceed_gross_rent');
    return { contractRent: gross - ua - fees, feesEntered: feesEntered };
  }

  // Monthly, per-unit rents; annual revenue is contract rent before expenses.
  // vacancy_rate is an entered fraction (0..1), never an assumed rate.
  // hudTable is optional and supplies comparison benchmarks only.
  function rentSchedule(subject, opts) {
    subject = subject || {};
    opts = opts || {};
    var basisStatus = api.allowanceBasisStatus(subject.utility_allowance_basis, subject.county_fips);
    var ownerPays = subject.utility_allowance_basis && subject.utility_allowance_basis.method === 'owner_pays_all';
    var hudCounty = _countyRow(opts.hudTable, subject.county_fips);
    var fmrKeys = { efficiency: 'efficiency', '1BR': 'one_br', '2BR': 'two_br', '3BR': 'three_br', '4BR': 'four_br' };
    var rows = (Array.isArray(subject.unit_mix) ? subject.unit_mix : []).map(function (row, i) {
      var market = row.ami_tier === 'market';
      var count = _allowance(row.count);
      var gross = _allowance(market ? row.market_rent : row.proposed_gross_rent);
      var rentMissing = gross == null || gross <= 0;
      var ua = market || ownerPays ? 0 : _allowance(row.utility_allowance);
      var feesEntered = row.fees != null && !(typeof row.fees === 'string' && !row.fees.trim());
      var fees = market || !feesEntered ? 0 : _allowance(row.fees);
      var limit = market ? { grossRent: null, unavailableReason: 'unrestricted_market' }
        : api.maxGrossRent(opts.chfaTable, subject.county_fips, row.ami_tier, row.bedrooms,
          { useHera: !!subject.use_hera_special, pisDate: subject.pis_date });
      // Keep the published net ceiling available independently of proposed rent.
      var maxNet = market ? { contractRent: null, unavailableReason: 'unrestricted_market' }
        : api.maxContractRent({ grossRent: limit.grossRent, utilityAllowance: ua, fees: row.fees, basisStatus: basisStatus });
      var maxNetReason = market ? 'unrestricted_market' : !basisStatus.complete ? basisStatus.unavailableReason
        : limit.grossRent == null ? limit.unavailableReason : maxNet.unavailableReason || null;
      var reason = null, contract = null;
      if (count == null || !Number.isInteger(count) || count <= 0) reason = 'row_unit_count_invalid';
      else if (rentMissing) reason = market ? 'market_rent_missing' : 'proposed_rent_missing';
      else if (market) {
        if (typeof row.market_rent_source !== 'string' || !row.market_rent_source.trim()) reason = 'market_rent_source_missing';
        else contract = gross;
      } else if (limit.grossRent == null) reason = limit.unavailableReason;
      else if (gross > limit.grossRent) reason = 'over_chfa_max';
      else {
        var net = api.maxContractRent({ grossRent: gross, utilityAllowance: ua, fees: row.fees, basisStatus: basisStatus });
        reason = net.unavailableReason || null;
        contract = net.contractRent;
      }
      var fmr = hudCounty && hudCounty.fmr ? _allowance(hudCounty.fmr[fmrKeys[row.bedrooms]]) : null;
      if (fmr != null && fmr <= 0) fmr = null;
      return { rowNumber: i + 1, bedrooms: row.bedrooms, amiTier: row.ami_tier, count: count,
        isMarket: market, rentMissing: rentMissing, rowReason: reason,
        grossResidentRent: rentMissing ? null : gross, contractRent: reason ? null : contract,
        utilityAllowance: ua, fees: fees, feesEntered: !market && feesEntered,
        marketRentSource: market && typeof row.market_rent_source === 'string' ? row.market_rent_source.trim() : null,
        limit: limit, maxNetRent: maxNetReason ? null : maxNet.contractRent, maxNetReason: maxNetReason,
        headroom: !market && limit.grossRent != null && !rentMissing ? limit.grossRent - gross : null,
        fmr: fmr, vsFmr: !rentMissing && fmr != null ? (gross - fmr) / fmr * 100 : null };
    });
    var invalidCounts = rows.some(function (r) { return r.count == null || !Number.isInteger(r.count) || r.count <= 0; });
    var scheduledUnits = invalidCounts ? null : rows.reduce(function (n, r) { return n + r.count; }, 0);
    var projectUnits = _allowance(subject.total_units);
    var countReason = scheduledUnits != null && scheduledUnits !== projectUnits ? 'unit_count_mismatch' : null;
    if (!countReason && (invalidCounts || projectUnits == null || !Number.isInteger(projectUnits) || projectUnits <= 0)) countReason = 'unit_count_invalid';
    if (!countReason && rows.length === 0) countReason = 'schedule_empty';
    var unpricedRows = rows.filter(function (r) { return r.rowReason; }).map(function (r) {
      return { rowNumber: r.rowNumber, bedrooms: r.bedrooms, amiTier: r.amiTier, rowReason: r.rowReason };
    });
    var missingRentRows = rows.filter(function (r) { return r.rentMissing; }).map(function (r) { return r.rowNumber; });
    var reason = countReason || (unpricedRows.length ? 'unpriced_rows' : null);
    var vacancy = _allowance(subject.vacancy_rate);
    var vacancyReason = vacancy == null ? 'vacancy_rate_missing' : vacancy > 1 ? 'vacancy_rate_invalid' : null;
    var totals = { restrictedUnits: null, marketUnits: null, le80Units: null, le80Share: null,
      contractRent: null, grossResidentRent: null, utilityAllowance: null,
      annualScheduledRent: null, effectiveRentAfterVacancy: null,
      unavailableReason: reason, effectiveRentUnavailableReason: reason || vacancyReason };
    function weighted(priced, key) {
      var units = priced.reduce(function (n, r) { return n + r.count; }, 0);
      return units > 0 ? priced.reduce(function (sum, r) { return sum + r[key] * r.count; }, 0) / units : null;
    }
    if (!reason) {
      totals.restrictedUnits = rows.reduce(function (n, r) { return n + (r.isMarket ? 0 : r.count); }, 0);
      totals.marketUnits = scheduledUnits - totals.restrictedUnits;
      totals.le80Units = rows.reduce(function (n, r) { return n + (!r.isMarket && +r.amiTier <= 80 ? r.count : 0); }, 0);
      totals.le80Share = totals.le80Units / scheduledUnits;
      totals.contractRent = weighted(rows, 'contractRent');
      totals.grossResidentRent = weighted(rows, 'grossResidentRent');
      totals.utilityAllowance = weighted(rows, 'utilityAllowance');
      totals.annualScheduledRent = rows.reduce(function (sum, r) { return sum + r.contractRent * r.count * 12; }, 0);
      if (!vacancyReason) totals.effectiveRentAfterVacancy = totals.annualScheduledRent * (1 - vacancy);
    }
    // The comparison may describe only priced rows when rents are still blank.
    // It is not a complete-project revenue total. Other defects block it, too.
    var comparisonReason = countReason || (rows.some(function (r) {
      return r.rowReason && r.rowReason !== 'proposed_rent_missing' && r.rowReason !== 'market_rent_missing';
    }) ? 'unpriced_rows' : null);
    var priced = rows.filter(function (r) { return !r.rowReason; });
    if (!comparisonReason && !priced.length) comparisonReason = 'no_priced_rows';
    var comparison = { unavailableReason: comparisonReason, pricedRows: priced.length,
      pricedUnits: null, grossResidentRent: null, contractRent: null, utilityAllowance: null,
      maxGrossRent: null, fmr: null, vsFmr: null };
    if (!comparisonReason) {
      comparison.pricedUnits = priced.reduce(function (n, r) { return n + r.count; }, 0);
      comparison.grossResidentRent = weighted(priced, 'grossResidentRent');
      comparison.contractRent = weighted(priced, 'contractRent');
      comparison.utilityAllowance = weighted(priced, 'utilityAllowance');
      var restricted = priced.filter(function (r) { return !r.isMarket; });
      if (restricted.length) comparison.maxGrossRent = restricted.reduce(function (sum, r) {
        return sum + r.limit.grossRent * r.count;
      }, 0) / restricted.reduce(function (n, r) { return n + r.count; }, 0);
      // Never compare averages drawn from different sets of units.
      if (priced.every(function (r) { return r.fmr != null; })) {
        comparison.fmr = weighted(priced, 'fmr');
        comparison.vsFmr = (comparison.grossResidentRent - comparison.fmr) / comparison.fmr * 100;
      }
    }
    // Carry provenance with the priced result so downstream consumers never need
    // to re-read a different subject or infer its county from a rent amount.
    var meta = opts.chfaTable && opts.chfaTable.meta || {};
    var basis = subject.utility_allowance_basis || {};
    var sourceMeta = { countyFips: subject.county_fips || null,
      tableYear: meta.fiscal_year == null ? null : meta.fiscal_year,
      effectiveDate: meta.effective_date || null, sourceUrl: meta.source_url || null,
      allowanceBasis: { method: basis.method || null, reference: basis.reference || null, effectiveDate: basis.effective_date || null },
      marketRentSources: rows.filter(function (r) { return r.isMarket; }).map(function (r) {
        return { rowNumber: r.rowNumber, bedrooms: r.bedrooms, source: r.marketRentSource };
      }), vacancyRate: vacancyReason ? null : vacancy };
    return { countyFips: subject.county_fips || null, sourceMeta: sourceMeta,
      rows: rows, scheduledUnits: scheduledUnits, projectUnits: projectUnits,
      unpricedRows: unpricedRows, missingRentRows: missingRentRows, totals: totals, comparison: comparison,
      basisStatus: basisStatus, vacancyRate: vacancyReason ? null : vacancy };
  }

  // Convert already-priced rows; this adapter performs no rent arithmetic.
  function dealMixFromSchedule(schedule, opts) {
    opts = opts || {};
    var reason = !schedule || !schedule.totals ? 'subject_project_unavailable'
      : schedule.totals.unavailableReason || schedule.totals.effectiveRentUnavailableReason;
    if (reason) return { available: false, reason: 'schedule_unavailable:' + reason };
    if (!opts.countyFips || schedule.countyFips !== opts.countyFips) return { available: false, reason: 'schedule_other_county' };
    if (opts.regime !== 'chfa_lihtc') return { available: false, reason: 'schedule_requires_chfa_setting' };
    return { available: true, totalUnits: schedule.scheduledUnits, vacancyRate: schedule.vacancyRate,
      restrictedRows: schedule.rows.filter(function (r) { return !r.isMarket; }).map(function (r) {
        return { tier: Number(r.amiTier), bedrooms: r.bedrooms, units: r.count, contractRent: r.contractRent };
      }), marketRows: schedule.rows.filter(function (r) { return r.isMarket; }).map(function (r) {
        return { bedrooms: r.bedrooms, units: r.count, rent: r.contractRent, source: r.marketRentSource };
      }), sourceMeta: JSON.parse(JSON.stringify(schedule.sourceMeta)) };
  }

  var api = {
    REGULATION_URL: REGULATION_URL,
    ALLOWANCE_METHODS: ALLOWANCE_METHODS,
    RESIDENT_UTILITIES: RESIDENT_UTILITIES,
    allowanceBasisStatus: allowanceBasisStatus,
    allowanceByBedroom: allowanceByBedroom,
    allowanceBasisCaption: allowanceBasisCaption,
    unavailableMessage: unavailableMessage,
    rentCeiling: rentCeiling,
    heraStatus: heraStatus,
    maxGrossRent: maxGrossRent,
    incomeLimit: incomeLimit,
    maxContractRent: maxContractRent,
    rentSchedule: rentSchedule,
    dealMixFromSchedule: dealMixFromSchedule,
    // County picker metadata and the existing SubjectProject public constant.
    countyRow: _countyRow,
    BR_HH_SIZE: BR_HH_SIZE
  };
  return api;
});
