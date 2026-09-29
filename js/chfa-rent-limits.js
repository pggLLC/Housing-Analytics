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

  function unavailableMessage(reason) {
    var messages = {
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
      fees_invalid: 'Enter valid nonoptional fees',
      county_missing: 'County rent limits unavailable',
      tier_missing: 'AMI tier unavailable',
      bedroom_size_missing: 'Bedroom size unavailable'
    };
    return messages[reason] || 'Rent unavailable';
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

  function _lookup(table, fips, tier, opts) {
    var county = _countyRow(table, fips);
    if (!county) return { unavailableReason: 'county_missing' };
    var hit = _findTier(_tiersBucket(county, opts && opts.useHera), tier);
    return hit || { unavailableReason: 'tier_missing' };
  }

  function maxGrossRent(table, fips, tier, bedrooms, opts) {
    var hit = _lookup(table, fips, tier, opts);
    if (hit.unavailableReason) return { grossRent: null, unavailableReason: hit.unavailableReason };
    var key = BR_TO_CHFA_KEY[bedrooms];
    var rent = key && hit.row.max_rents ? _allowance(hit.row.max_rents[key]) : null;
    if (rent == null) return { grossRent: null, unavailableReason: 'bedroom_size_missing' };
    return Object.assign({ grossRent: rent }, _metadata(table, hit, BR_HH_SIZE[bedrooms]));
  }

  function incomeLimit(table, fips, tier, householdSize, opts) {
    var hit = _lookup(table, fips, tier, opts);
    if (hit.unavailableReason) return { incomeLimit: null, unavailableReason: hit.unavailableReason };
    var limit = hit.row.income_limits ? _allowance(hit.row.income_limits[householdSize + 'p']) : null;
    if (limit == null) return { incomeLimit: null, unavailableReason: 'household_size_missing' };
    return Object.assign({ incomeLimit: limit }, _metadata(table, hit, +householdSize));
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

  return {
    REGULATION_URL: REGULATION_URL,
    ALLOWANCE_METHODS: ALLOWANCE_METHODS,
    RESIDENT_UTILITIES: RESIDENT_UTILITIES,
    allowanceBasisStatus: allowanceBasisStatus,
    allowanceBasisCaption: allowanceBasisCaption,
    unavailableMessage: unavailableMessage,
    maxGrossRent: maxGrossRent,
    incomeLimit: incomeLimit,
    maxContractRent: maxContractRent,
    // County picker metadata and the existing SubjectProject public constant.
    countyRow: _countyRow,
    BR_HH_SIZE: BR_HH_SIZE
  };
});
