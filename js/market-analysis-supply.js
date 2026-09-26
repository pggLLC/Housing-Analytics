/**
 * Existing affordable supply inside a PMA (LIHTC + other assisted).
 * Exposed as window.PMAAffordableSupply; CommonJS for tests.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PMAAffordableSupply = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // A blank, zero, or non-numeric unit count means the source did not report
  // one — it is unknown, not a project with zero units.
  function reportedUnitCount(v) {
    if (v == null || v === '') return null;
    var n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Affordable units of one record: the restricted/assisted count first, the
  // project's total units only when that is not reported. `fallback` marks a
  // record counted at total units (which can include market-rate units), so
  // the summary can disclose how many there were. Neither reported → null.
  function _affordableUnits(restricted, total) {
    var r = reportedUnitCount(restricted);
    if (r != null) return { units: r, fallback: false };
    var t = reportedUnitCount(total);
    return t != null ? { units: t, fallback: true } : { units: null, fallback: false };
  }

  // CHFA/HUD LIHTC feature: LI_UNITS (income-restricted) over N_UNITS /
  // TOTAL_UNITS (every unit in the building, market-rate included).
  function lihtcAffordableUnits(feature) {
    var p = (feature && feature.properties) || {};
    return _affordableUnits(p.LI_UNITS,
      reportedUnitCount(p.N_UNITS) != null ? p.N_UNITS : p.TOTAL_UNITS);
  }

  // Other-assisted record (data/affordable-housing/properties.json):
  // assisted_units over total_units.
  function otherAssistedAffordableUnits(prop) {
    var p = prop || {};
    return _affordableUnits(p.assisted_units, p.total_units);
  }

  /* ── De-duplication: other-assisted records that are a LIHTC project ──
   * properties.json merges several feeds; a CHFA Preservation or HUD MF
   * record is often the same building as a CHFA LIHTC feature under a
   * slightly different name ("Clyburn at Stapleton" / "Clyburn at
   * Stableton", "Renova V Sage Court" / "Renova 5 Sage Court Apartments").
   * The feeds share no id, so the rule is location + name, and it is
   * deliberately conservative — a record is a duplicate only when BOTH hold:
   *   1. it lies within DUPLICATE_MAX_METERS of a LIHTC feature, and
   *   2. the two names share at least one distinctive token: a lowercase
   *      alphanumeric word of 3+ characters that is not a number, a roman
   *      numeral, or a generic housing / street / direction word.
   * A matched record is dropped from the other-assisted side; the LIHTC
   * feature is kept, so the property is counted once, at its LIHTC figure.
   */
  var DUPLICATE_MAX_METERS = 100;
  var GENERIC_NAME_WORDS = (
    'the and for with aka apartments apartment apts apt homes home housing hsg residences residence ' +
    'senior seniors elderly village villas villa place phase llc lllp llp inc corp resyndication redo ' +
    'rehab acquisition family families community communities center street avenue road drive court ' +
    'square plaza park terrace gardens garden heights manor lofts commons tower towers building north ' +
    'south east west new old colorado denver project properties property units rental affordable view ' +
    'vista station crossing pointe point house townhomes townhouses flats saint landmark group mgmt ' +
    'management dha otk lihtc'
  ).split(/\s+/).reduce(function (o, w) { o[w] = true; return o; }, {});

  function nameTokens(name) {
    var out = {};
    String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(function (t) {
      if (t.length < 3 || GENERIC_NAME_WORDS[t] || /^[0-9]+$/.test(t) || /^[ivxl]+$/.test(t)) return;
      out[t] = true;
    });
    return out;
  }

  function _sharesToken(a, b) {
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && b[k]) return true;
    return false;
  }

  function _meters(lat1, lon1, lat2, lon2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // A coordinate that is missing is missing — never 0 (0,0 is a real place).
  function _coord(v) {
    if (v == null || v === '') return null;
    var n = +v;
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Split other-assisted records into those kept and those that duplicate a
   * LIHTC feature (rule above). Records or features without coordinates or a
   * distinctive name never match — they are kept, not guessed at.
   *
   * @returns {{kept: Array, duplicates: Array, duplicatesRemoved: number}}
   */
  function removeLihtcDuplicates(lihtcFeatures, otherProps) {
    var lihtc = [];
    (lihtcFeatures || []).forEach(function (f) {
      var c = f && f.geometry && f.geometry.coordinates;
      var p = (f && f.properties) || {};
      var lng = c ? _coord(c[0]) : null, lat = c ? _coord(c[1]) : null;
      var toks = nameTokens(p.PROJECT || p.PROJECT_NAME || p.ReportedName);
      if (lat == null || lng == null || !Object.keys(toks).length) return;
      lihtc.push({ lat: lat, lng: lng, tokens: toks });
    });
    var kept = [], duplicates = [];
    (otherProps || []).forEach(function (p) {
      var lat = p ? _coord(p.lat) : null, lng = p ? _coord(p.lng) : null;
      var toks = nameTokens(p && p.property_name);
      var dup = lat != null && lng != null && lihtc.some(function (l) {
        return _meters(lat, lng, l.lat, l.lng) <= DUPLICATE_MAX_METERS && _sharesToken(toks, l.tokens);
      });
      (dup ? duplicates : kept).push(p);
    });
    return { kept: kept, duplicates: duplicates, duplicatesRemoved: duplicates.length };
  }

  /**
   * Existing affordable supply inside a PMA, kept in its two parts so every
   * surface can label what it shows. LIHTC projects come from the CHFA/HUD
   * LIHTC features; "other assisted" is the non-LIHTC inventory (HUD
   * Multifamily Assisted, USDA Rural Development, local PBV, CHFA
   * preservation) from data/affordable-housing/properties.json.
   *
   * Units are affordable units: LIHTC LI_UNITS and other-assisted
   * assisted_units. A project that does not report those is counted at its
   * total units and disclosed through unitsFallbackReason. Projects that
   * report no unit count at all are counted in unitsUnknownCount and
   * disclosed through unitsUnavailableReason, so a total that omits them is
   * labelled as a floor rather than presented as complete. A units field is
   * null when projects exist but none of them report a count.
   *
   * Other-assisted records that are the same property as a LIHTC feature in
   * the same PMA are removed first (removeLihtcDuplicates), so a property
   * listed by both feeds is counted once; duplicatesRemoved says how many.
   *
   * @param {Array} lihtcFeatures - GeoJSON features already filtered to the PMA
   * @param {Array} otherProps    - non-LIHTC property records already filtered to the PMA
   */
  function summarizeAffordableSupply(lihtcFeatures, otherProps) {
    function tally(items, unitsOf) {
      var t = { count: 0, knownUnits: 0, unitsUnknownCount: 0, fallbackCount: 0 };
      (items || []).forEach(function (item) {
        t.count += 1;
        var u = unitsOf(item || {});
        if (u.units == null) t.unitsUnknownCount += 1;
        else {
          t.knownUnits += u.units;
          if (u.fallback) t.fallbackCount += 1;
        }
      });
      t.units = (t.count > 0 && t.unitsUnknownCount === t.count) ? null : t.knownUnits;
      return t;
    }
    var dedup = removeLihtcDuplicates(lihtcFeatures, otherProps);
    var lihtc = tally(lihtcFeatures, lihtcAffordableUnits);
    var other = tally(dedup.kept, otherAssistedAffordableUnits);
    var count = lihtc.count + other.count;
    var unknown = lihtc.unitsUnknownCount + other.unitsUnknownCount;
    var knownUnits = lihtc.knownUnits + other.knownUnits;
    var fallback = lihtc.fallbackCount + other.fallbackCount;
    var fallbackParts = [];
    if (lihtc.fallbackCount) {
      fallbackParts.push(lihtc.fallbackCount + ' LIHTC project' + (lihtc.fallbackCount === 1 ? '' : 's') +
        ' without an income-restricted unit count');
    }
    if (other.fallbackCount) {
      fallbackParts.push(other.fallbackCount + ' other assisted project' + (other.fallbackCount === 1 ? '' : 's') +
        ' without an assisted unit count');
    }
    var dups = dedup.duplicatesRemoved;
    return {
      lihtcCount: lihtc.count,
      lihtcUnits: lihtc.units,
      otherAssistedCount: other.count,
      otherAssistedUnits: other.units,
      affordableCount: count,
      affordableUnits: (count > 0 && unknown === count) ? null : knownUnits,
      // What capture-rate scoring receives: a floor, never a guess.
      affordableUnitsKnown: knownUnits,
      unitsUnknownCount: unknown,
      unitsUnavailableReason: unknown > 0
        ? unknown + ' of ' + count + ' project' + (count === 1 ? '' : 's') + ' lack a unit count. ' +
          'Their units are left out of the supply total, so existing units and the capture rate are understated.'
        : null,
      // Projects counted at total units because the affordable count is not reported.
      lihtcUnitsFallbackCount: lihtc.fallbackCount,
      otherAssistedUnitsFallbackCount: other.fallbackCount,
      unitsFallbackCount: fallback,
      unitsFallbackReason: fallback > 0
        ? fallbackParts.join(' and ') + (fallback === 1 ? ' is' : ' are') +
          ' counted at total units, which can include market-rate units, so existing affordable units may be overstated.'
        : null,
      // Other-assisted records dropped as the same property as a LIHTC project.
      duplicatesRemoved: dups,
      duplicatesReason: dups > 0
        ? dups + ' other assisted record' + (dups === 1 ? ' is' : 's are') +
          ' the same property as a LIHTC project in this area and ' + (dups === 1 ? 'is' : 'are') +
          ' counted once, as LIHTC.'
        : null
    };
  }

  return {
    reportedUnitCount: reportedUnitCount,
    lihtcAffordableUnits: lihtcAffordableUnits,
    otherAssistedAffordableUnits: otherAssistedAffordableUnits,
    nameTokens: nameTokens,
    removeLihtcDuplicates: removeLihtcDuplicates,
    DUPLICATE_MAX_METERS: DUPLICATE_MAX_METERS,
    summarizeAffordableSupply: summarizeAffordableSupply
  };
}));
