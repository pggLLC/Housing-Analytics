/* Zillow's all-homes index distributed with HUD bedroom ratios, normalized
 * to the selected geography's published ACS renter bedroom mix. */
(function (root) {
  'use strict';
  function normalizeFips(fips) {
    var digits = String(fips || '').replace(/\D/g, '');
    return digits && digits.length <= 5 ? digits.padStart(5, '0') : null;
  }
  function positive(value) {
    return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
  }
  function normalizedName(name) {
    return String(name || '').replace(/\s*\((?:city|town|cdp)\)\s*$/i, '').trim().toLowerCase();
  }
  function rentRecord(data, rec, geoid, scope) {
    if (!rec || !positive(rec.rent)) return null;
    return { rent: Number(rec.rent), vintage_month: rec.vintage_month || data.meta && data.meta.vintage_month || null,
      name: rec.name || null, geoid: geoid, scope: scope,
      sourceUrl: data.meta && data.meta[scope === 'place' ? 'city_url' : 'county_url'],
      yoy: Number.isFinite(rec.yoy_change_pct) ? rec.yoy_change_pct : null };
  }
  function getCountyRent(data, fips) {
    var key = normalizeFips(fips);
    return data && data.counties && key ? rentRecord(data, data.counties[key], key, 'county') : null;
  }
  function getMarketRent(data, fips, options) {
    options = options || {};
    var place = options.bedroomMix && options.bedroomMix.places && options.bedroomMix.places[options.geoid];
    // Bind the name to the official GEOID/county record, never a prefix or an unrelated saved place.
    if (place && place.county_fips === normalizeFips(fips) && data && data.cities) {
      var keys = Object.keys(data.cities).filter(function (key) {
        return normalizedName(data.cities[key].name) === normalizedName(place.name);
      });
      if (keys.length === 1) {
        var city = rentRecord(data, data.cities[keys[0]], options.geoid, 'place');
        if (city) return city;
      }
    }
    return getCountyRent(data, fips);
  }
  function getPerBedroomRent(data, fips, hudFmr, options) {
    options = options || {};
    var zori = getMarketRent(data, fips, options);
    if (!zori || !hudFmr || typeof hudFmr.getFmrByFips !== 'function') return null;
    var mixData = options.bedroomMix;
    var bucket = mixData && mixData[zori.scope === 'place' ? 'places' : 'counties'];
    var mix = bucket && bucket[zori.geoid];
    var fmr = hudFmr.getFmrByFips(fips);
    if (!mix || mix.unavailable_reason || !mix.bedrooms || !fmr) return null;
    var counts = mix.bedrooms;
    var keys = ['studio', '1br', '2br', '3br', '4br'];
    var fields = ['efficiency', 'one_br', 'two_br', 'three_br', 'four_br'];
    var weights = [counts.studio, counts['1br'], counts['2br'], counts['3br'],
      counts['4br'] == null || counts['5plus'] == null ? null : counts['4br'] + counts['5plus']];
    if (weights.some(function (n) { return !Number.isFinite(n) || n < 0; }) ||
        fields.some(function (field) { return !positive(fmr[field]); })) return null;
    var total = weights.reduce(function (sum, n) { return sum + n; }, 0);
    if (!(total > 0) || total !== mix.renter_units) return null;
    // Normalization preserves the all-homes level, rather than assigning it to 2BR.
    var weightedFmr = fields.reduce(function (sum, field, i) { return sum + Number(fmr[field]) * weights[i]; }, 0) / total;
    var result = {};
    keys.forEach(function (br, i) { result[br] = Math.round(zori.rent * Number(fmr[fields[i]]) / weightedFmr); });
    var hudMeta = typeof hudFmr.getMeta === 'function' ? hudFmr.getMeta() || {} : {};
    var label = 'Zillow ZORI (all homes, ' + zori.name + ', ' + zori.vintage_month +
      ') distributed by HUD FMR bedroom ratios and ACS renter bedroom mix' +
      ' (HUD FY' + (hudMeta.fiscal_year || 'unavailable') + '; ACS ' + mixData.meta.vintage + ')';
    result._meta = Object.assign({}, zori, { source: label, bedroomMixVintage: mixData.meta.vintage,
      bedroomMixSourceUrl: mixData.meta.source_url, fmrVintage: hudMeta.fiscal_year || null,
      fmrSourceUrl: hudMeta.url_fmr || null, renterUnits: total, weights: weights,
      method: 'FMR ratios normalized to local renter bedroom counts; 4BR includes 5+BR.',
      review_flag: result['2br'] < Number(fmr.two_br) ? { reason: 'zori_2br_below_fmr',
        estimated_rent: result['2br'], fmr_2br: Number(fmr.two_br),
        note: 'The distributed 2BR ZORI estimate is below HUD 2BR FMR; review local market evidence.' } : null });
    return result;
  }
  var api = { normalizeFips: normalizeFips, getCountyRent: getCountyRent,
    getMarketRent: getMarketRent, getPerBedroomRent: getPerBedroomRent };
  root.ZoriRentUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof self !== 'undefined' ? self : this));
