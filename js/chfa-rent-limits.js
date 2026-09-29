/** CHFA published rent/income lookups and contract-rent arithmetic. No DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChfaRentLimits = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

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
    if (ua == null) return unavailable('utility_allowance_missing');
    if (gross == null) return unavailable('gross_rent_missing');
    if (fees == null) return unavailable('fees_invalid');
    if (ua + fees > gross) return unavailable('deductions_exceed_gross_rent');
    return { contractRent: gross - ua - fees, feesEntered: feesEntered };
  }

  return {
    maxGrossRent: maxGrossRent,
    incomeLimit: incomeLimit,
    maxContractRent: maxContractRent,
    // County picker metadata and the existing SubjectProject public constant.
    countyRow: _countyRow,
    BR_HH_SIZE: BR_HH_SIZE
  };
});
