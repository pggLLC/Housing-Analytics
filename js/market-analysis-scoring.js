(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PMAMarketScoring = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var AMI_60_PCT = 0.60;
  var MAX_AFFORDABLE_RENT_PCT = 0.30;

  var WEIGHTS = {
    demand:       0.30,
    captureRisk:  0.25,
    rentPressure: 0.15,
    landSupply:   0.15,
    workforce:    0.15
  };

  var RISK = {
    // 85 percent: CHFA's 2027-28 draft QAP (third draft, criteria for
    // approval) says capture rates above it "will not be accepted without
    // additional data to support demand". The 2025-26 QAP, in force through
    // 2026, sets no number. Same number as CHFA_CAPTURE_LIMIT below.
    captureHigh:       0.85,
    costBurdenHigh:    0.45,
    rentPressureElev:  1.10
  };

  function scoreDemand(acs) {
    acs = acs || {};
    var cb = acs.cost_burden_rate || 0;
    var scb = acs.severe_cost_burden_rate;
    var pov = acs.poverty_rate;
    var renterShare = acs.total_hh ? acs.renter_hh / acs.total_hh : 0;

    var cbScore = Math.min(100, (cb / 0.55) * 100);
    var scbScore = scb != null ? Math.min(100, (scb / 0.30) * 100) : null;
    var povScore = pov != null ? Math.min(100, (pov / 0.25) * 100) : null;
    var renterScore = Math.min(100, (renterShare / 0.60) * 100);

    var blend = [
      { score: cbScore, weight: 0.45 },
      { score: scbScore, weight: 0.20 },
      { score: povScore, weight: 0.10 },
      { score: renterScore, weight: 0.25 }
    ];
    var available = blend.filter(function (b) { return b.score != null; });
    var weightSum = available.reduce(function (s, b) { return s + b.weight; }, 0);
    if (weightSum <= 0) return 0;
    var weighted = available.reduce(function (s, b) {
      return s + b.score * (b.weight / weightSum);
    }, 0);
    return Math.round(weighted);
  }

  function scoreCaptureRisk(acs, existingUnits, proposedUnits, chasEligible) {
    acs = acs || {};
    existingUnits = existingUnits || 0;
    proposedUnits = proposedUnits || 0;

    var qualRenters;
    var denominatorSource;
    if (chasEligible && chasEligible.value && chasEligible.value > 0) {
      qualRenters = chasEligible.value;
      denominatorSource = chasEligible.source === 'chfa_qualified' ? 'chfa_qualified' : 'chas_lihtc_eligible';
    } else {
      qualRenters = acs.renter_hh || 1;
      denominatorSource = acs.renter_hh ? 'acs_total_renter_hh' : 'fallback_1';
    }

    var capture = (existingUnits + proposedUnits) / qualRenters;
    // 100 with no units; 0 at the 85 percent line (CHFA 2027-28 draft QAP).
    var score = Math.max(0, Math.min(100, (1 - capture / RISK.captureHigh) * 100));
    return {
      score: Math.round(score),
      capture: capture,
      qualRenters: qualRenters,
      denominatorSource: denominatorSource,
      chasBreakdown: chasEligible && chasEligible.tier_breakdown || null
    };
  }

  /**
   * Estimate LIHTC-eligible renter households (<=80% AMI) inside a PMA buffer.
   *
   * CHAS income tiers are county-wide, while the PMA buffer is tract-scoped.
   * For each county touched by the buffer, scale that county's CHAS tiers by
   * buffer renter HH / county CHAS renter HH. This keeps the income-qualified
   * denominator narrowed to <=80% AMI without accidentally using a whole
   * county's renter pool for a small urban buffer.
   *
   * @param {Object<string,Object>} chasCounties - chasData.counties
   * @param {Array<Object>} bufTracts - buffer tracts with geoid/_bufferShare
   * @param {Object<string,Object>} acsIdx - tract metrics keyed by geoid
   * @returns {{
   *   value: number|null,
   *   tier_breakdown: Object|null,
   *   source: 'chas'|'unavailable',
   *   counties: Array<{fips:string, share:number, lihtc_eligible:number}>
   * }}
   */
  function chasLihtcEligibleRenters(chasCounties, bufTracts, acsIdx) {
    if (!chasCounties || !bufTracts || !bufTracts.length || !acsIdx) {
      return { value: null, tier_breakdown: null, source: 'unavailable', counties: [] };
    }

    var rentersByCounty = {};
    bufTracts.forEach(function (tract) {
      var gid = String(tract && tract.geoid || '');
      if (gid.length < 5) return;
      var metrics = acsIdx[gid];
      var renterHh = metrics && metrics.renter_hh;
      if (typeof renterHh !== 'number' || renterHh <= 0) return;
      var share = (typeof tract._bufferShare === 'number') ? tract._bufferShare : 1;
      if (share <= 0) return;
      var fips = gid.slice(0, 5);
      rentersByCounty[fips] = (rentersByCounty[fips] || 0) + renterHh * share;
    });

    var lihtcEligible = 0;
    var breakdown = { lte30: 0, '31to50': 0, '51to80': 0 };
    var perCounty = [];

    Object.keys(rentersByCounty).forEach(function (fips) {
      var rec = chasCounties[fips];
      var pop = rec && rec.renter_hh_by_ami;
      if (!pop) return;

      var chasCountyTotalRenters = 0;
      ['lte30', '31to50', '51to80', '81to100', '100plus'].forEach(function (tier) {
        var total = pop[tier] && pop[tier].total;
        if (typeof total === 'number' && total > 0) chasCountyTotalRenters += total;
      });
      if (chasCountyTotalRenters <= 0) return;

      // County CHAS is the only income-tier source currently available, so
      // assume the PMA buffer's income mix matches the county's income mix.
      var countyScale = Math.min(1, rentersByCounty[fips] / chasCountyTotalRenters);
      if (countyScale <= 0) return;

      var countyLihtc = 0;
      ['lte30', '31to50', '51to80'].forEach(function (tier) {
        var total = pop[tier] && pop[tier].total;
        if (typeof total !== 'number' || total <= 0) return;
        var apportioned = total * countyScale;
        countyLihtc += apportioned;
        breakdown[tier] += apportioned;
      });

      if (countyLihtc <= 0) return;
      lihtcEligible += countyLihtc;
      perCounty.push({ fips: fips, share: countyScale, lihtc_eligible: Math.round(countyLihtc) });
    });

    if (lihtcEligible <= 0) {
      return { value: null, tier_breakdown: null, source: 'unavailable', counties: [] };
    }

    Object.keys(breakdown).forEach(function (k) { breakdown[k] = Math.round(breakdown[k]); });

    return {
      value: Math.round(lihtcEligible),
      tier_breakdown: breakdown,
      source: 'chas',
      counties: perCounty.sort(function (a, b) { return b.share - a.share; })
    };
  }

  /*
   * CHFA Market Study Guide (QAP Appendix A, section 7 Demand Analysis):
   * a renter household counts toward a unit when its income is at or below
   * the unit's AMI limit, the maximum Housing Tax Credit gross rent is no
   * more than 40 percent of its income, and it is no larger than the unit
   * allows (all in the 2025-26 QAP's Appendix A). The 85 percent line is
   * from the 2027-28 draft QAP: capture rates above it "will not be accepted
   * without additional data to support demand".
   */
  var CHFA_RENT_SHARE_OF_INCOME = 0.40;
  var CHFA_MAX_OCCUPANTS = { '1br': 2, '2br': 3, '3br': 5 };
  // CHFA sets no studio size; one person is the occupancy tax-credit rents
  // impute to a studio (IRC 42(g)(2)(C)), so a studio serves one person.
  var STUDIO_MAX_OCCUPANTS = 1;
  var CHFA_DEFAULT_BEDROOMS = ['1br', '2br', '3br'];
  var CHFA_CAPTURE_LIMIT = 0.85;
  // CHAS income tiers in percent of the county's AMI; the last is open-ended.
  var CHAS_TIER_BINS = [[0, 30], [30, 50], [50, 80], [80, 100], [100, Infinity]];

  // How a household is matched to a bedroom size (paul, 8 Nov 2026). The
  // default shares two-person households between a one-bedroom and a
  // two-bedroom in the shares two-person renters at 20-60% AMI live in, in
  // the market's own Census area (PUMA, ACS 2020-24 PUMS), blended with the
  // statewide share where the local sample is small (data file
  // two_person_split; Colorado: 28% studio or 1BR, 72% 2BR or more,
  // n = 2,439). 'smallest' is the older rule, kept as a labelled
  // comparison: every household takes the smallest offered unit that fits.
  var BEDROOM_RULES = { shared: 'shared', smallest: 'smallest' };
  var TWO_PERSON_SMALL_SHARE_CO = 0.282;
  var DEFAULT_SIZE_VALUES = [1, 2, 3, 4, 5, 6.68];
  var SIZE_FIT_TOLERANCE = 0.01;   // each fitted size share within 1 point of the published share

  // One set of size factors for the whole market area, found by iterative
  // proportional fitting, so the renter households the count actually uses
  // (each CHAS tier's count spread over that tier's PUMS sizes) have the
  // area's published size shares (ACS B25009). groups: [{count, sizes:[w1..w6]}],
  // one per tract and CHAS tier; target: six shares adding to 1.
  function areaSizeFit(groups, target) {
    var n = target.length;
    function modelled(f) {
      var out = [0, 0, 0, 0, 0, 0], tot = 0;
      groups.forEach(function (g) {
        var gd = 0, s;
        for (s = 0; s < n; s++) gd += g.sizes[s] * f[s];
        if (!(gd > 0)) return;
        for (s = 0; s < n; s++) out[s] += g.count * g.sizes[s] * f[s] / gd;
        tot += g.count;
      });
      return tot > 0 ? out.map(function (v) { return v / tot; }) : null;
    }
    var f = [1, 1, 1, 1, 1, 1];
    var base = modelled(f);
    if (!base) return null;
    for (var it = 0; it < 200; it++) {
      var cur = modelled(f), moved = 0;
      for (var s = 0; s < n; s++) {
        if (cur[s] > 0 && target[s] > 0) { var r = target[s] / cur[s]; f[s] *= r; moved = Math.max(moved, Math.abs(r - 1)); }
        else if (target[s] === 0) f[s] = 0;
      }
      if (moved < 1e-6) break;
    }
    // A group (tract and CHAS tier) with renters must keep some of them:
    // zeroing all its sizes would drop it from the count, not refit it (Codex #2751).
    var lost = groups.some(function (g) {
      if (!(g.count > 0)) return false;
      var had = 0, kept = 0;
      for (var s2 = 0; s2 < n; s2++) { had += g.sizes[s2]; kept += g.sizes[s2] * f[s2]; }
      return had > 0 && !(kept > 0);
    });
    if (lost) return null;
    var fitted = modelled(f);
    // A fit that cannot reach the published shares (a size the sample lacks,
    // or tiers that pin the sizes) is not a match: the caller then uses the
    // sample as it is and says so (Codex #2751).
    for (var k = 0; k < n; k++) if (!fitted || Math.abs(fitted[k] - target[k]) > SIZE_FIT_TOLERANCE) return null;
    return { base: base, fitted: fitted, factors: f };
  }

  /**
   * Renter households in a market area who could rent a tax-credit unit at
   * one or more AMI tiers, by CHFA's rules.
   *
   * For each tract, each CHAS income tier count is multiplied by the share
   * of that tier's renters (ACS PUMS, the tract's PUMA) whose size fits an
   * offered unit (1-3 bedroom by default) and whose income falls between the
   * 40%-of-income rent floor and the tier's limit. Three choices are
   * explicit and reported back (opts):
   *  - bedroom rule: two-person households split between a 1BR and a 2BR
   *    when both are offered, in the shares local two-person renters live in
   *    (default), or the older smallest-unit rule;
   *  - CHAS tier counts scaled to the tract's ACS 2020-24 renter households
   *    when opts.acsIdx carries them;
   *  - the PUMS size mix fitted to the market area's published renter
   *    household size counts (ACS 2020-24 B25009, by tract) when opts.sizeIdx
   *    carries them;
   *  - households in which everyone attends college left out, when the
   *    demand file carries student_share (tax credit homes generally cannot
   *    go to all-student households).
   *
   * @param {Object} demand - data/market/chfa_renter_demand_co.json
   * @param {Object<string,Object>} limitsByFips - CHFA current-year county records (regular_tiers)
   * @param {Array<Object>} bufTracts - buffer tracts with geoid/_bufferShare
   * @param {Array<number>} tiers - AMI percents of the proposed units, e.g. [30, 60]
   * @param {Array<string>} [bedrooms] - unit sizes offered ('0br'..'3br');
   *   default 1-3BR. Household sizes no offered unit fits are left out, as
   *   CHFA's guide says (no one-bedroom units: no one-person households).
   * @param {{rule?:string, acsIdx?:Object, sizeIdx?:Object<string,Array<number>>}} [opts]
   * @returns {{value:number|null, byTier:Object<string,number>, byBedroom:Object<string,number>,
   *   source:string, tractsUsed:number, tractsMissing:number, reason:string|null, assumptions:Object}}
   */
  function chfaQualifiedRenters(demand, limitsByFips, bufTracts, tiers, bedrooms, opts) {
    opts = opts || {};
    var rule = opts.rule === BEDROOM_RULES.smallest ? BEDROOM_RULES.smallest : BEDROOM_RULES.shared;
    var acsIdx = opts.acsIdx || null;
    var empty = function (reason) {
      return { value: null, byTier: {}, source: 'unavailable', tractsUsed: 0, tractsMissing: 0, reason: reason };
    };
    if (!demand || !demand.tracts || !demand.pumas) return empty('the qualified-renter file did not load');
    if (!limitsByFips) return empty('CHFA income and rent limits did not load');
    if (!bufTracts || !bufTracts.length) return empty('no tracts in the market area');
    tiers = (tiers || []).filter(function (t) { return t > 0; });
    if (!tiers.length) return empty('no AMI tier was given');
    var caps = { '0br': STUDIO_MAX_OCCUPANTS, '1br': 2, '2br': 3, '3br': 5 };
    // At least one person per bedroom: CHFA's example drops one-person
    // households when no one-bedroom units are offered, so a larger unit
    // does not stand in for a smaller one that is missing.
    var mins = { '0br': 1, '1br': 1, '2br': 2, '3br': 3 };
    var offered = (bedrooms && bedrooms.length ? bedrooms : CHFA_DEFAULT_BEDROOMS)
      .filter(function (b) { return caps[b] != null; })
      .sort();
    if (!offered.length) return empty('no bedroom size was given');
    // The smallest offered unit a household of n fits: it has the lowest rent.
    function unitFor(n) {
      for (var i = 0; i < offered.length; i++) {
        if (n >= mins[offered[i]] && n <= caps[offered[i]]) return offered[i];
      }
      return null;
    }
    var split = demand.two_person_split || null;
    function smallShare(puma) {
      var row = split && split.pumas && split.pumas[puma];
      if (row && row[0] >= 0 && row[0] <= 1) return row[0];
      return split && split.statewide_small_share > 0 ? split.statewide_small_share : TWO_PERSON_SMALL_SHARE_CO;
    }
    // Units a household of n is counted toward, with shares that add to 1.
    function unitsFor(n, puma) {
      var br = unitFor(n);
      if (!br) return [];
      if (rule === BEDROOM_RULES.shared && n === 2 && br === '1br' && offered.indexOf('2br') !== -1) {
        var sh = smallShare(puma);
        return [{ br: '1br', share: sh }, { br: '2br', share: 1 - sh }];
      }
      return [{ br: br, share: 1 }];
    }

    // floors[fips|puma][tier][size-1] = [{br, share, floor}] where floor is
    // the lowest qualifying income as a percent of AMI, or null.
    var floorCache = {};
    function floorsFor(fips, puma) {
      var key = fips + '|' + puma;
      if (floorCache[key] !== undefined) return floorCache[key];
      var rec = limitsByFips[fips];
      var reg = rec && rec.regular_tiers;
      var lim50 = reg && reg['50'] && reg['50'].income_limits;
      if (!lim50) return (floorCache[key] = null);
      var out = {};
      tiers.forEach(function (t) {
        var tierRec = reg[String(t)];
        out[t] = [1, 2, 3, 4, 5, 6].map(function (n) {
          var lim = lim50[n + 'p'];
          return unitsFor(n, puma).map(function (u) {
            var rent = tierRec && tierRec.max_rents && tierRec.max_rents[u.br];
            var floor = (rent > 0 && lim > 0) ? (rent * 12 / CHFA_RENT_SHARE_OF_INCOME) / lim * 50 : null;
            return { br: u.br, share: u.share, floor: floor };
          });
        });
      });
      return (floorCache[key] = out);
    }

    var sizeValues = (demand.size_values && demand.size_values.length === 6) ? demand.size_values : DEFAULT_SIZE_VALUES;
    var sizeIdx = opts.sizeIdx || null;
    var students = demand.student_share && demand.student_share.pumas ? demand.student_share : null;
    // PUMS bins are percent of the PUMA's renter-weighted limit. Where the
    // PUMA spans counties with different limits, move each bin onto this
    // tract's county scale before comparing it with county cut-offs.
    function toCountyFor(gid, puma) {
      var pLim = demand.puma_lim50_2024 && demand.puma_lim50_2024[puma];
      var cLim = demand.county_lim50_2024 && demand.county_lim50_2024[gid.slice(0, 5)];
      return [0, 1, 2, 3, 4, 5].map(function (i) {
        return (pLim && cLim && pLim[i] > 0 && cLim[i] > 0) ? pLim[i] / cLim[i] : 1;
      });
    }
    function binPct(mix, s, b, toCounty) {
      // the last bin holds everything above 120%
      return b === mix[s].length - 1 ? Infinity : (b + 0.5) * toCounty[s];
    }
    var PUMA_SCALE = [1, 1, 1, 1, 1, 1];
    function pumaTierOf(pct) {
      for (var j = 0; j < CHAS_TIER_BINS.length; j++) if (inRange(pct, CHAS_TIER_BINS[j])) return j;
      return CHAS_TIER_BINS.length - 1;
    }
    function inRange(pct, range) {
      return !(pct < range[0] || (range[1] !== Infinity && pct >= range[1]));
    }
    function countScaleFor(gid, chasTotal) {
      var acsRow = acsIdx && acsIdx[gid];
      var acsR = acsRow && acsRow.renter_hh != null ? Number(acsRow.renter_hh) : NaN;
      return (acsIdx && isFinite(acsR) && acsR >= 0 && chasTotal > 0) ? acsR / chasTotal : null;
    }
    function chasTotalOf(row) {
      var t = 0;
      for (var k = 1; k <= CHAS_TIER_BINS.length; k++) t += row[k] > 0 ? row[k] : 0;
      return t;
    }
    // First pass: the renter households the count spreads over sizes, so
    // the sizes are fitted on them and not on the raw PUMA sample. The
    // target is the published size counts of the same tracts.
    var tilt = null, areaShares = null, sizeTracts = 0;
    if (sizeIdx) {
      var groups = [], want = [0, 0, 0, 0, 0, 0];
      bufTracts.forEach(function (tract) {
        var gid = String(tract && tract.geoid || '');
        var share = (typeof tract._bufferShare === 'number') ? tract._bufferShare : 1;
        var row = demand.tracts[gid];
        var mix = row && demand.pumas[row[0]];
        // Same tracts as the count below: one without usable limits is skipped there.
        if (share <= 0 || !row || !mix || !floorsFor(gid.slice(0, 5), row[0])) return;
        var pub = sizeIdx[gid];
        if (Array.isArray(pub) && pub.length === 6) {
          sizeTracts += 1;
          for (var s = 0; s < 6; s++) want[s] += (pub[s] > 0 ? pub[s] : 0) * share;
        }
        var cs = countScaleFor(gid, chasTotalOf(row));
        var toCounty = toCountyFor(gid, row[0]);
        CHAS_TIER_BINS.forEach(function (range, k) {
          var count = row[k + 1];
          if (!(count > 0)) return;
          var sizes = [0, 0, 0, 0, 0, 0];
          for (var s2 = 0; s2 < mix.length; s2++) {
            for (var b = 0; b < mix[s2].length; b++) {
              if (mix[s2][b] && inRange(binPct(mix, s2, b, toCounty), range)) sizes[s2] += mix[s2][b];
            }
          }
          groups.push({ count: count * (cs == null ? 1 : cs) * share, sizes: sizes });
        });
      });
      var wantTotal = want.reduce(function (t, v) { return t + v; }, 0);
      if (wantTotal > 0) {
        areaShares = want.map(function (v) { return v / wantTotal; });
        tilt = areaSizeFit(groups, areaShares);
      }
    }
    function meanSize(sh) {
      return sh ? sh.reduce(function (t, v, i) { return t + v * sizeValues[i]; }, 0) : null;
    }
    function studentShare(puma, s, k) {
      var p = students && students.pumas[puma];
      var v = p && p[s] && p[s][k];
      return typeof v === 'number' && v > 0 && v <= 1 ? v : 0;   // 1 = every household in the cell is all-student (Codex #2751)
    }

    var byTier = {}, byBr = {};
    tiers.forEach(function (t) { byTier[t] = 0; });
    offered.forEach(function (b) { byBr[b] = 0; });
    var total = 0, withStudents = 0, used = 0, missing = 0, scaled = 0, unscaled = 0, chasRenters = 0, acsRenters = 0;
    var pumasUsed = {}, splitNum = 0, splitDen = 0, ownNum = 0;

    bufTracts.forEach(function (tract) {
      var gid = String(tract && tract.geoid || '');
      var share = (typeof tract._bufferShare === 'number') ? tract._bufferShare : 1;
      if (share <= 0) return;
      var row = demand.tracts[gid];
      var mix = row && demand.pumas[row[0]];
      var floors = row && floorsFor(gid.slice(0, 5), row[0]);
      if (!row || !mix || !floors) { missing += 1; return; }
      used += 1;
      pumasUsed[row[0]] = true;
      // CHAS 2018-22 tier counts, scaled to the tract's ACS 2020-24 renters.
      var chasTotal = chasTotalOf(row);
      var cs = countScaleFor(gid, chasTotal);
      var countScale = cs == null ? 1 : cs;
      if (cs != null) scaled += 1; else if (acsIdx) unscaled += 1;
      chasRenters += chasTotal * share;
      acsRenters += chasTotal * countScale * share;
      var twoPersonHere = 0;
      var toCounty = toCountyFor(gid, row[0]);
      CHAS_TIER_BINS.forEach(function (range, k) {
        var count = row[k + 1];
        if (!(count > 0)) return;
        var tierTotal = 0, anyTier = 0, anyAll = 0, twoW = 0, perTier = {}, perBr = {};
        tiers.forEach(function (t) { perTier[t] = 0; });
        for (var s = 0; s < mix.length; s++) {
          var f = tilt ? tilt.factors[s] : 1;
          for (var b = 0; b < mix[s].length; b++) {
            var wAll = mix[s][b] * f;
            if (!wAll) continue;
            var pct = binPct(mix, s, b, toCounty);
            if (!inRange(pct, range)) continue;
            // All-student households stay in the tier total (CHAS counts them)
            // but not among those who qualify. Their shares were measured on
            // the PUMA's own income scale, so the bin's unadjusted tier picks
            // the share (Codex #2751).
            var keep = 1 - studentShare(row[0], s, pumaTierOf(binPct(mix, s, b, PUMA_SCALE)));
            tierTotal += wAll;
            if (s === 1) twoW += wAll;
            var w = wAll * keep;
            var parts = floors[tiers[0]][s];
            for (var u = 0; u < parts.length; u++) {
              var fits = false;
              for (var i = 0; i < tiers.length; i++) {
                var t = tiers[i], part = floors[t][s][u];
                if (part.floor != null && pct <= t && pct >= part.floor) { perTier[t] += w * part.share; fits = true; }
              }
              if (fits) {
                anyTier += w * parts[u].share;
                anyAll += wAll * parts[u].share;
                perBr[parts[u].br] = (perBr[parts[u].br] || 0) + w * parts[u].share;
              }
            }
          }
        }
        if (tierTotal <= 0) return;
        var scale = count * countScale * share / tierTotal;
        total += anyTier * scale;
        withStudents += anyAll * scale;
        twoPersonHere += twoW * scale;
        tiers.forEach(function (t) { byTier[t] += perTier[t] * scale; });
        Object.keys(perBr).forEach(function (br) { byBr[br] += perBr[br] * scale; });
      });
      // The disclosed split is weighted by the two-person renters it is applied to.
      var sRow = split && split.pumas && split.pumas[row[0]];
      splitNum += smallShare(row[0]) * twoPersonHere;
      ownNum += (sRow && sRow[2] != null ? sRow[2] : 0) * twoPersonHere;
      splitDen += twoPersonHere;
    });

    if (!used) return empty('no tract in the market area has CHAS and PUMS data');
    Object.keys(byTier).forEach(function (t) { byTier[t] = Math.round(byTier[t]); });
    Object.keys(byBr).forEach(function (b) { byBr[b] = Math.round(byBr[b]); });
    var pumaList = Object.keys(pumasUsed).sort();
    var cases = 0;
    pumaList.forEach(function (p) { var r = split && split.pumas && split.pumas[p]; if (r) cases += r[1] || 0; });
    return { value: Math.round(total), byTier: byTier, byBedroom: byBr, source: 'chfa_qualified', tractsUsed: used, tractsMissing: missing,
      bedrooms: offered, reason: null,
      assumptions: {
        rule: rule,
        // Weighted by the market area's two-person renters in the AMI bands counted.
        twoPersonSmallShare: splitDen > 0 ? Math.round(splitNum / splitDen * 1000) / 1000 : null,
        localWeight: splitDen > 0 ? Math.round(ownNum / splitDen * 100) / 100 : 0,
        localCases: cases,
        pumas: pumaList,
        statewideSplit: split ? { share: split.statewide_small_share, cases: split.statewide_cases } : null,
        renterScale: acsIdx ? { tractsScaled: scaled, tractsNotScaled: unscaled,
          chasRenters: Math.round(chasRenters), acsRenters: Math.round(acsRenters) } : null,
        // Published renter size shares of the area's tracts (B25009), and the
        // regional sample's shares spread over this area's CHAS income mix
        // before the fit; averages from the same shares.
        areaSizeShares: areaShares ? areaShares.map(function (v) { return Math.round(v * 1000) / 1000; }) : null,
        pumsSizeShares: tilt ? tilt.base.map(function (v) { return Math.round(v * 1000) / 1000; }) : null,
        sizeTracts: sizeTracts,
        areaRenterSize: areaShares ? Math.round(meanSize(areaShares) * 100) / 100 : null,
        pumsRenterSize: tilt ? Math.round(meanSize(tilt.base) * 100) / 100 : null,
        sizeMatched: !!tilt,
        // Qualified households left out because everyone in them attends college.
        studentsRemoved: students ? Math.round(withStudents - total) : null,
        // Bedroom sizes each household size (1-6+) is counted toward, from the
        // offered sizes; null = no offered size fits and the size is left out.
        fit: [1, 2, 3, 4, 5, 6].map(function (n) {
          var u = unitsFor(n, null);
          return u.length ? u.map(function (x) { return x.br; }) : null;
        })
      } };
  }

  function scoreRentPressure(acs, countyAmi) {
    acs = acs || {};
    if (!countyAmi || countyAmi <= 0) {
      return { score: null, ratio: null, amiUsed: null, amiSource: 'unavailable', unavailable: true };
    }
    var ami60Rent = (countyAmi * AMI_60_PCT * MAX_AFFORDABLE_RENT_PCT) / 12;
    var ratio = acs.median_gross_rent ? acs.median_gross_rent / ami60Rent : 0;
    var score = Math.min(100, Math.max(0, (ratio - 0.70) / (1.50 - 0.70) * 100));
    return { score: Math.round(score), ratio: ratio, amiUsed: countyAmi, amiSource: 'county', unavailable: false };
  }

  // #1163/#1171 — the Land/Supply vacancy signal scores RENTAL vacancy
  // (Census HVS convention) against a single 0.10 ceiling. Current tract data
  // applies a seasonal-share discount to vacant-for-rent as an STR proxy before
  // scoring; raw rental vacancy and legacy total vacancy remain fallbacks for
  // stale data files.
  var RENTAL_VACANCY_CEILING = 0.10;
  var LEGACY_TOTAL_VACANCY_CEILING = 0.12;

  function scoreMarketTightnessDetail(acs) {
    var strAdjusted = acs ? Number(acs.str_adjusted_rental_vacancy_rate) : NaN;
    if (acs && acs.str_adjusted_rental_vacancy_rate != null && isFinite(strAdjusted)) {
      var adjustedScore = Math.max(0, Math.min(100, (1 - strAdjusted / RENTAL_VACANCY_CEILING) * 100));
      return { score: Math.round(adjustedScore), basis: 'rental_vacancy_str_adjusted' };
    }
    var rental = acs ? Number(acs.rental_vacancy_rate) : NaN;
    if (acs && acs.rental_vacancy_rate != null && isFinite(rental)) {
      var score = Math.max(0, Math.min(100, (1 - rental / RENTAL_VACANCY_CEILING) * 100));
      return { score: Math.round(score), basis: 'rental_vacancy' };
    }
    // Legacy fallback (stale tract file without rental_vacancy_rate, or
    // suppressed rental universe): historical behavior verbatim — total
    // vacancy at 0.12, defaulting suppressed input to a neutral 0.05.
    var vac = (acs && acs.vacancy_rate != null) ? acs.vacancy_rate : 0.05;
    var legacy = Math.max(0, Math.min(100, (1 - vac / LEGACY_TOTAL_VACANCY_CEILING) * 100));
    return { score: Math.round(legacy), basis: 'legacy_total_vacancy' };
  }

  function scoreMarketTightness(acs) {
    return scoreMarketTightnessDetail(acs).score;
  }

  // #1171 — residual STR-distortion disclosure. Prefer the STR-adjusted
  // vacancy rate when present; raw rental vacancy is the stale-data fallback.
  // Most resort-core buffers should stop flagging after the seasonal-share
  // proxy discount. Residual flags mean the adjusted rate is still materially
  // depressed in a seasonal-dominated market and should be verified locally.
  var STR_FLAG_RENTAL_VACANCY_MIN = 0.08;
  var STR_FLAG_TOTAL_VACANCY_MIN = 0.25;

  function isStrDistorted(acs) {
    if (!acs) return false;
    var basis = acs.str_adjusted_rental_vacancy_rate != null
      ? acs.str_adjusted_rental_vacancy_rate
      : acs.rental_vacancy_rate;
    var rental = Number(basis);
    var total = Number(acs.vacancy_rate);
    return basis != null && isFinite(rental) &&
           acs.vacancy_rate != null && isFinite(total) &&
           rental >= STR_FLAG_RENTAL_VACANCY_MIN &&
           total >= STR_FLAG_TOTAL_VACANCY_MIN;
  }

  function scoreTier(s) {
    if (s >= 80) return { label: 'Strong', color: 'var(--good)' };
    if (s >= 60) return { label: 'Moderate', color: 'var(--accent)' };
    if (s >= 40) return { label: 'Marginal', color: 'var(--warn)' };
    return { label: 'Weak', color: 'var(--bad)' };
  }

  return {
    AMI_60_PCT: AMI_60_PCT,
    MAX_AFFORDABLE_RENT_PCT: MAX_AFFORDABLE_RENT_PCT,
    RENTAL_VACANCY_CEILING: RENTAL_VACANCY_CEILING,
    LEGACY_TOTAL_VACANCY_CEILING: LEGACY_TOTAL_VACANCY_CEILING,
    WEIGHTS: WEIGHTS,
    RISK: RISK,
    scoreDemand: scoreDemand,
    scoreCaptureRisk: scoreCaptureRisk,
    chasLihtcEligibleRenters: chasLihtcEligibleRenters,
    chfaQualifiedRenters: chfaQualifiedRenters,
    CHFA_CAPTURE_LIMIT: CHFA_CAPTURE_LIMIT,
    CHFA_RENT_SHARE_OF_INCOME: CHFA_RENT_SHARE_OF_INCOME,
    CHFA_MAX_OCCUPANTS: CHFA_MAX_OCCUPANTS,
    CHFA_DEFAULT_BEDROOMS: CHFA_DEFAULT_BEDROOMS,
    BEDROOM_RULES: BEDROOM_RULES,
    areaSizeFit: areaSizeFit,
    TWO_PERSON_SMALL_SHARE_CO: TWO_PERSON_SMALL_SHARE_CO,
    scoreRentPressure: scoreRentPressure,
    scoreMarketTightness: scoreMarketTightness,
    scoreMarketTightnessDetail: scoreMarketTightnessDetail,
    STR_FLAG_RENTAL_VACANCY_MIN: STR_FLAG_RENTAL_VACANCY_MIN,
    STR_FLAG_TOTAL_VACANCY_MIN: STR_FLAG_TOTAL_VACANCY_MIN,
    isStrDistorted: isStrDistorted,
    scoreTier: scoreTier
  };
}));
