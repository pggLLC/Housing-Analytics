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

  /**
   * Existing affordable supply inside a PMA, kept in its two parts so every
   * surface can label what it shows. LIHTC projects come from the CHFA/HUD
   * LIHTC features; "other assisted" is the non-LIHTC inventory (HUD
   * Multifamily Assisted, USDA Rural Development, local PBV, CHFA
   * preservation) from data/affordable-housing/properties.json.
   *
   * Unit totals sum only projects that report a unit count. Projects that do
   * not are counted in unitsUnknownCount and disclosed through
   * unitsUnavailableReason, so a total that omits them is labelled as a floor
   * rather than presented as complete. A units field is null when projects
   * exist but none of them report a count.
   *
   * @param {Array} lihtcFeatures - GeoJSON features already filtered to the PMA
   * @param {Array} otherProps    - non-LIHTC property records already filtered to the PMA
   */
  function summarizeAffordableSupply(lihtcFeatures, otherProps) {
    function tally(items, unitsOf) {
      var t = { count: 0, knownUnits: 0, unitsUnknownCount: 0 };
      (items || []).forEach(function (item) {
        t.count += 1;
        var n = unitsOf(item || {});
        if (n == null) t.unitsUnknownCount += 1;
        else t.knownUnits += n;
      });
      t.units = (t.count > 0 && t.unitsUnknownCount === t.count) ? null : t.knownUnits;
      return t;
    }
    var lihtc = tally(lihtcFeatures, function (f) {
      var p = f.properties || {};
      return reportedUnitCount(p.N_UNITS) || reportedUnitCount(p.TOTAL_UNITS);
    });
    var other = tally(otherProps, function (p) {
      return reportedUnitCount(p.total_units) || reportedUnitCount(p.assisted_units);
    });
    var count = lihtc.count + other.count;
    var unknown = lihtc.unitsUnknownCount + other.unitsUnknownCount;
    var knownUnits = lihtc.knownUnits + other.knownUnits;
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
        : null
    };
  }

  return {
    reportedUnitCount: reportedUnitCount,
    summarizeAffordableSupply: summarizeAffordableSupply
  };
}));
