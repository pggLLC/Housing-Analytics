/**
 * js/hna/combined-geo.js
 * Pure helpers for Phase 2 combined HNA geographies.
 *
 * No DOM reads and no fetches. Callers pass parsed datasets.
 */
(function () {
  'use strict';

  var BANDS = ['lte30', '31to50', '51to80', '81to100', '100plus'];
  var GAP_BANDS = ['30', '40', '50', '60', '70', '80', '100'];

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeType(type) {
    if (type === 'place' || type === 'cdp' || type === 'county') return type;
    return String(type || '');
  }

  function aliasMap(datasets) {
    return (datasets && datasets.aliases && (datasets.aliases.aliases || datasets.aliases)) || {};
  }

  function resolveAlias(geoid, datasets) {
    var key = String(geoid || '').padStart(7, '0');
    return aliasMap(datasets)[key] || key;
  }

  function normalizeMember(member, datasets) {
    var type = normalizeType(member && member.geoType);
    var geoid = String(member && member.geoid || '');
    if (type === 'place' || type === 'cdp') geoid = resolveAlias(geoid, datasets);
    return { geoType: type, geoid: geoid };
  }

  function memberKey(member) {
    return member.geoType + ':' + member.geoid;
  }

  function placeCountySet(geoid, datasets) {
    var cross = datasets && datasets.crossCountyPlaces && datasets.crossCountyPlaces.places || {};
    var placeCounty = datasets && datasets.placeCountyLookup && datasets.placeCountyLookup.places || {};
    var rec = cross[geoid];
    if (rec && Array.isArray(rec.all_counties) && rec.all_counties.length) {
      return rec.all_counties.map(function (county) {
        return String(county && county.fips || county);
      });
    }
    var county = placeCounty[geoid];
    return county ? [String(county)] : [];
  }

  function validateCombo(members, datasets) {
    var errors = [];
    var normalized = Array.isArray(members)
      ? members.map(function (m) { return normalizeMember(m, datasets || {}); })
      : [];
    if (normalized.length < 2 || normalized.length > 6) {
      errors.push('Select 2 to 6 non-overlapping jurisdictions.');
    }
    var seen = {};
    normalized.forEach(function (m) {
      if (!/^(place|cdp|county)$/.test(m.geoType) || !m.geoid) {
        errors.push('Each member must be a place, CDP, or county with a GEOID.');
      }
      var key = memberKey(m);
      if (seen[key]) errors.push('Duplicate member: ' + key + '.');
      seen[key] = true;
    });
    var countyMembers = {};
    normalized.filter(function (m) { return m.geoType === 'county'; }).forEach(function (m) {
      countyMembers[m.geoid] = true;
    });
    normalized.filter(function (m) { return m.geoType !== 'county'; }).forEach(function (m) {
      placeCountySet(m.geoid, datasets || {}).forEach(function (county) {
        if (countyMembers[county]) {
          errors.push('A place/CDP overlaps a selected county. Use the place + containing county paired view instead.');
        }
      });
    });
    return {
      valid: errors.length === 0,
      errors: errors,
      members: normalized,
    };
  }

  function emptyBandMap() {
    var out = {};
    BANDS.forEach(function (band) {
      out[band] = { total: 0, cost_burdened_30pct: 0, cost_burdened_50pct: 0 };
    });
    return out;
  }

  function addBandMap(target, source) {
    source = source || {};
    BANDS.forEach(function (band) {
      var src = source[band] || {};
      target[band].total += num(src.total);
      target[band].cost_burdened_30pct += num(src.cost_burdened_30pct != null ? src.cost_burdened_30pct : src.cost_burdened);
      target[band].cost_burdened_50pct += num(src.cost_burdened_50pct != null ? src.cost_burdened_50pct : src.severely_burdened);
    });
  }

  function finalizeBands(map) {
    BANDS.forEach(function (band) {
      var rec = map[band];
      rec.pct_cost_burdened_30 = rec.total ? rec.cost_burdened_30pct / rec.total : 0;
      rec.pct_cost_burdened_50 = rec.total ? rec.cost_burdened_50pct / rec.total : 0;
      rec.cost_burdened = rec.cost_burdened_30pct;
      rec.severely_burdened = rec.cost_burdened_50pct;
      rec.pct_cost_burdened = rec.pct_cost_burdened_30;
    });
    return map;
  }

  function recordForMember(member, datasets) {
    if (member.geoType === 'county') {
      return datasets && datasets.countyChas && datasets.countyChas.counties && datasets.countyChas.counties[member.geoid] || null;
    }
    return datasets && datasets.placeChas && datasets.placeChas.places && datasets.placeChas.places[member.geoid] || null;
  }

  function qualityRank(q) {
    return { High: 3, Medium: 2, Low: 1, Unavailable: 0 }[q] || 0;
  }

  function memberQuality(record, member) {
    if (!record) return { quality: 'Unavailable', reason: memberKey(member) + ' missing CHAS record' };
    if (record.low_confidence) return { quality: 'Medium', reason: (record.name || member.geoid) + ' low confidence' };
    if (record.acs_anchor === true || (record.acs_anchor && record.acs_anchor.applied === true)) {
      return { quality: 'Medium', reason: (record.name || member.geoid) + ' ACS anchor applied' };
    }
    return { quality: 'High', reason: '' };
  }

  function worstQuality(items) {
    var worst = { quality: 'High', reason: '' };
    items.forEach(function (item) {
      if (qualityRank(item.quality) < qualityRank(worst.quality)) worst = item;
    });
    return worst;
  }

  function aggregateChas(members, datasets) {
    var renter = emptyBandMap();
    var owner = emptyBandMap();
    var qualities = [];
    var names = [];
    members.forEach(function (member) {
      var rec = recordForMember(member, datasets);
      qualities.push(memberQuality(rec, member));
      if (!rec) return;
      names.push(rec.name || rec.county_name || rec.place_name || member.geoid);
      addBandMap(renter, rec.renter_hh_by_ami);
      addBandMap(owner, rec.owner_hh_by_ami);
    });
    finalizeBands(renter);
    finalizeBands(owner);
    var summary = {
      total_renter_hh: BANDS.reduce(function (s, b) { return s + renter[b].total; }, 0),
      total_owner_hh: BANDS.reduce(function (s, b) { return s + owner[b].total; }, 0),
      renter_cb30_count: BANDS.reduce(function (s, b) { return s + renter[b].cost_burdened_30pct; }, 0),
      renter_cb50_count: BANDS.reduce(function (s, b) { return s + renter[b].cost_burdened_50pct; }, 0),
      owner_cb30_count: BANDS.reduce(function (s, b) { return s + owner[b].cost_burdened_30pct; }, 0),
      owner_cb50_count: BANDS.reduce(function (s, b) { return s + owner[b].cost_burdened_50pct; }, 0),
    };
    summary.renter_cb30_share = summary.total_renter_hh ? summary.renter_cb30_count / summary.total_renter_hh : 0;
    summary.renter_cb50_share = summary.total_renter_hh ? summary.renter_cb50_count / summary.total_renter_hh : 0;
    summary.owner_cb30_share = summary.total_owner_hh ? summary.owner_cb30_count / summary.total_owner_hh : 0;
    summary.owner_cb50_share = summary.total_owner_hh ? summary.owner_cb50_count / summary.total_owner_hh : 0;
    var worst = worstQuality(qualities);
    return {
      name: 'Combined screening area',
      summary: summary,
      renter_hh_by_ami: renter,
      owner_hh_by_ami: owner,
      dataQuality: worst.quality,
      caveat: worst.reason,
      memberNames: names,
    };
  }

  function gapRecordForMember(member, datasets) {
    if (member.geoType === 'county') {
      var counties = datasets && datasets.amiGapCounty && datasets.amiGapCounty.counties || [];
      if (Array.isArray(counties)) return counties.find(function (r) { return String(r.fips) === member.geoid; }) || null;
      return counties[member.geoid] || null;
    }
    return datasets && datasets.amiGapPlace && datasets.amiGapPlace.places && datasets.amiGapPlace.places[member.geoid] || null;
  }

  function cumulativeValue(record, field, band) {
    return num(record && record[field] && record[field][band]);
  }

  function aggregateAmiGap(members, datasets) {
    var cumHouseholds = {};
    var cumUnits = {};
    var available = true;
    members.forEach(function (member) {
      var rec = gapRecordForMember(member, datasets);
      if (!rec) {
        available = false;
        return;
      }
      GAP_BANDS.forEach(function (band) {
        cumHouseholds[band] = num(cumHouseholds[band]) + cumulativeValue(rec, 'households_le_ami_pct', band);
        cumUnits[band] = num(cumUnits[band]) + cumulativeValue(rec, 'units_priced_affordable_le_ami_pct', band);
      });
    });
    var prevHh = 0;
    var prevUnits = 0;
    var runningGap = 0;
    var perBand = {};
    var cumulativeGap = {};
    GAP_BANDS.forEach(function (band) {
      var hh = num(cumHouseholds[band]);
      var units = num(cumUnits[band]);
      var bandGap = Math.max(0, (hh - prevHh) - (units - prevUnits));
      perBand[band] = bandGap;
      runningGap += bandGap;
      cumulativeGap[band] = runningGap;
      prevHh = hh;
      prevUnits = units;
    });
    return {
      available: available,
      households_le_ami_pct: cumHouseholds,
      units_priced_affordable_le_ami_pct: cumUnits,
      per_band_gap: perBand,
      gap_units_minus_households_le_ami_pct: cumulativeGap,
      gapSource: 'combined',
    };
  }

  function countySet(members, datasets) {
    var out = {};
    members.forEach(function (member) {
      if (member.geoType === 'county') out[member.geoid] = true;
      else placeCountySet(member.geoid, datasets || {}).forEach(function (county) { out[county] = true; });
    });
    return Object.keys(out).sort();
  }

  function availabilityFor(members, datasets) {
    var counties = countySet(members, datasets);
    return {
      snapshot: { available: true },
      chas: { available: true },
      amiGap: { available: true },
      ownershipNeed: { available: true },
      commuting: { available: false, reason: 'Not available for combined areas — view members individually.' },
      lehd: { available: false, reason: 'Not available for combined areas — view members individually.' },
      projections: { available: false, reason: 'Not available for combined areas unless every member has compatible place-level projections.' },
      neighborhoodContext: { available: false, reason: 'Not available for combined areas — view members individually.' },
      lihtcMap: { available: false, reason: 'LIHTC map remains county/statewide scoped for combined areas.' },
      amiLimits: {
        available: counties.length === 1,
        reason: counties.length === 1 ? '' : 'Multi-county combined areas list county AMI limits separately; they are never blended.',
        counties: counties,
      },
    };
  }

  function weightedMetricRange(members, datasets, valueGetter, weightGetter) {
    var rows = [];
    members.forEach(function (member) {
      var rec = recordForMember(member, datasets);
      if (!rec) return;
      var value = valueGetter(member, rec);
      var weight = weightGetter(member, rec);
      if (value == null || !Number.isFinite(Number(value))) return;
      rows.push({ member: member, name: rec.name || rec.county_name || rec.place_name || member.geoid, value: Number(value), weight: num(weight) });
    });
    var totalWeight = rows.reduce(function (s, r) { return s + r.weight; }, 0);
    var weightedAverage = totalWeight ? rows.reduce(function (s, r) { return s + r.value * r.weight; }, 0) / totalWeight : null;
    rows.sort(function (a, b) { return a.value - b.value; });
    return {
      available: rows.length > 0,
      min: rows[0] || null,
      max: rows[rows.length - 1] || null,
      weightedAverage: weightedAverage,
      method: 'MODELED',
      caveat: 'Combined areas do not have a true median; show member range and household-weighted average only.',
    };
  }

  function aggregate(members, datasets) {
    datasets = datasets || {};
    var validation = validateCombo(members, datasets);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors, members: validation.members };
    }
    var chas = aggregateChas(validation.members, datasets);
    var gap = aggregateAmiGap(validation.members, datasets);
    var availability = availabilityFor(validation.members, datasets);
    if (!gap.available) availability.amiGap = { available: false, reason: 'AMI gap unavailable for one or more combined members.' };
    return {
      valid: true,
      members: validation.members,
      label: validation.members.map(function (m) { return m.geoid; }).join(' + '),
      pseudoChasRecord: chas,
      amiGapEntry: gap,
      availability: availability,
      dataQuality: chas.dataQuality,
      caveats: chas.caveat ? [chas.caveat] : [],
      countyFips: availability.amiLimits.counties,
      medianMetrics: {
        homeValue: weightedMetricRange(validation.members, datasets, function (member, _rec) {
          var home = datasets.homeValues && datasets.homeValues[member.geoid];
          return home && (home.value != null ? home.value : home.median_home_value);
        }, function (_member, rec) {
          return rec.summary && (num(rec.summary.total_renter_hh) + num(rec.summary.total_owner_hh));
        }),
      },
    };
  }

  window.HNACombinedGeo = {
    GAP_BANDS: GAP_BANDS,
    validateCombo: validateCombo,
    aggregate: aggregate,
    resolveAlias: resolveAlias,
  };
}());
