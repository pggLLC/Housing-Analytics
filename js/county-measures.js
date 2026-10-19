/**
 * js/county-measures.js
 *
 * County measures shared by the home page map (js/components/home-need-map.js)
 * and the data map (data-map-browser.html), so both draw the same figures and
 * grey out the same counties.
 *
 *   CountyMeasures.loadField(field, fetchJson) → Promise<{ values, unreliable, names, boundaries }>
 *     values[field][geoid]     number
 *     unreliable[field][geoid] true when the figure is too uncertain to rank
 *     names[geoid]             county name ("Adams County")
 *     detail[geoid]            { renters_lte50, affordable_lte50, renters_lte80, subsidized } for popups
 *
 * Sources:
 *   ACS 5-year figures: data/co-county-demographics.json (scripts/build_co_demographics.py)
 *   Permits: Census Building Permits Survey counts in data/hna/permits.json
 *   Ratios: the same ACS five-year medians (rent and value against income)
 *   Lowest-income shortfall: HUD CHAS 2018–2022 (data/hna/chas_affordable_available.json)
 *   Projections: State Demography Office county forecast (data/hna/projections/<fips>.json)
 *   Margins: data/hna/acs-reliability.json
 */
(function () {
  'use strict';

  var PATHS = {
    boundaries: 'data/co-county-boundaries.json',
    demographics: 'data/co-county-demographics.json',
    permits: 'data/hna/permits.json',
    chas: 'data/hna/chas_affordable_available.json',
    reliability: 'data/hna/acs-reliability.json',
  };

  // ACS: the site's rule (methods §10) that a coefficient of variation above
  // 30% is "use with caution"; for a ratio, the two inputs' CVs are combined
  // (root sum of squares). Fields map to the ACS variables in
  // data/hna/acs-reliability.json.
  var CV_LIMIT = 0.30;
  var CV_FIELDS = {
    median_gross_rent: ['DP04_0134E'],
    median_hh_income: ['DP03_0062E'],
    median_home_value: ['DP04_0089E'],
    cost_burden_share: ['rent_burden_30plus'],
    rent_to_income: ['DP04_0134E', 'DP03_0062E'],
    home_value_to_income: ['DP04_0089E', 'DP03_0062E'],
  };
  // HUD CHAS has no margins. A county is too uncertain to rank when it has
  // fewer than 100 renter households at or below 30% AMI, or when most of
  // its "available" homes are vacant units (often seasonal), which can
  // make a tight market read as having no shortfall.
  var CHAS_MIN_HOUSEHOLDS = 100;

  var FIELDS = {
    median_gross_rent: { fmt: 'money', suffix: '/mo' },
    cost_burden_share: { fmt: 'pct' },
    vacancy_rate: { fmt: 'pct' },
    median_hh_income: { fmt: 'money' },
    median_home_value: { fmt: 'moneyK' },
    permits_per_1k: { fmt: 'num' },
    home_value_to_income: { fmt: 'ratio' },
    rent_to_income: { fmt: 'pctWhole' },
    missing_per_100_lte30: { fmt: 'num0' },
    // State Demography Office (DOLA) county forecast, 2024 base year, from
    // data/hna/projections/<fips>.json. Loaded only when one is picked.
    dola_pop_change_20yr: { fmt: 'pctSigned', projection: true },
    dola_new_homes_per_1k: { fmt: 'num0', projection: true },
    // Recent permits (BPS 2021–2025 average) ÷ DOLA's projected annual need
    // over the next 10 years, both from data/hna/permits.json.
    build_pace_vs_need: { fmt: 'ratio' },
    // HUD CHAS 2018–2022, 50% AMI tier: renter households still without an
    // affordable home per 100, after every affordable home is counted,
    // subsidized and market-rate alike.
    short_per_100_lte50: { fmt: 'num0' },
    // Subsidized homes on record (data/affordable-housing/properties.json:
    // CHFA LIHTC and preservation, HUD multifamily, USDA Rural Development)
    // per 100 renter households at or below 80% AMI, the ceiling most of
    // these programs serve. Loaded only when picked.
    subsidized_per_100_lte80: { fmt: 'num0', inventory: true },
  };
  // A county projected to need fewer than 10 homes a year is too small to
  // compare with its permits: one project swings the ratio tenfold.
  var PACE_MIN_ANNUAL_NEED = 10;

  function format(v, fmt, suffix) {
    if (v == null || !Number.isFinite(Number(v))) return 'no data';
    v = Number(v);
    if (fmt === 'money') return '$' + Math.round(v).toLocaleString('en-US') + (suffix || '');
    if (fmt === 'pct') return Math.round(v * 100) + '%';
    if (fmt === 'ratio') return v.toFixed(1) + '×';
    if (fmt === 'pctWhole') return Math.round(v) + '%';
    if (fmt === 'pctSigned') return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + '%';
    if (fmt === 'num0') return String(Math.round(v));
    if (fmt === 'moneyK') return v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : '$' + Math.round(v / 1000) + 'K';
    return v.toFixed(1);
  }

  function defaultFetch(path) {
    if (typeof window.safeFetchJSON === 'function') return window.safeFetchJSON(path);
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; });
  }

  function mark(unreliable, field, geoid) {
    (unreliable[field] = unreliable[field] || {})[geoid] = true;
  }

  function chasThin(t) {
    return Number(t.renter_households) < CHAS_MIN_HOUSEHOLDS ||
      Number(t.vacant_for_rent) > Number(t.occupied_by_group);
  }

  // Ray-casting point-in-polygon over GeoJSON Polygon / MultiPolygon rings.
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeometry(x, y, g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(function (rings) {
      return inRing(x, y, rings[0]) && !rings.slice(1).some(function (h) { return inRing(x, y, h); });
    });
  }

  var pending = null;

  function load(fetchJson) {
    if (pending) return pending;
    var get = fetchJson || defaultFetch;
    var optional = function (p) { return get(p).catch(function () { return null; }); };
    pending = Promise.all([
      get(PATHS.boundaries), get(PATHS.demographics),
      optional(PATHS.permits), optional(PATHS.chas), optional(PATHS.reliability),
    ]).then(function (res) {
      var boundaries = res[0];
      var demo = res[1] && res[1].counties;
      var permits = res[2] && res[2].counties;
      var chas = res[3] && res[3].counties;
      var reliability = res[4] && res[4].geos;
      if (!boundaries || !Array.isArray(boundaries.features) || !demo) throw new Error('no county data');

      var values = {};
      var unreliable = {};
      var names = {};
      var detail = {};
      Object.keys(FIELDS).forEach(function (k) { values[k] = {}; });

      boundaries.features.forEach(function (f) {
        var p = f.properties || {};
        var geoid = p.GEOID;
        if (!geoid) return;
        names[geoid] = p.NAMELSAD || p.NAME || 'County';
        var row = demo[p.NAME];
        if (!row) return;
        ['median_gross_rent', 'cost_burden_share', 'vacancy_rate', 'median_hh_income', 'median_home_value'].forEach(function (k) {
          var v = Number(row[k]);
          if (row[k] != null && Number.isFinite(v)) values[k][geoid] = v;
        });
        var pr = permits && permits[geoid];
        var avg = pr && pr.avg_annual_total_5yr ? Number(pr.avg_annual_total_5yr.value) : NaN;
        var pop = Number(row.population);
        if (Number.isFinite(avg) && pop > 0) values.permits_per_1k[geoid] = avg / pop * 1000;
        var pv = pr && pr.production_vs_need;
        var need = pv ? Number(pv.annual_need_10yr_dola) : NaN;
        var built = pv ? Number(pv.permits_avg_annual_5yr) : NaN;
        if (Number.isFinite(need) && need > 0 && Number.isFinite(built)) {
          values.build_pace_vs_need[geoid] = built / need;
          if (need < PACE_MIN_ANNUAL_NEED) mark(unreliable, 'build_pace_vs_need', geoid);
        }
      });

      // Ratios from the same five-year medians the other measures show, so
      // every ACS figure on the map shares one vintage.
      Object.keys(values.median_hh_income).forEach(function (geoid) {
        var inc = values.median_hh_income[geoid];
        if (!(inc > 0)) return;
        var rent = values.median_gross_rent[geoid];
        var value = values.median_home_value[geoid];
        if (Number.isFinite(rent)) values.rent_to_income[geoid] = rent * 12 / inc * 100;
        if (Number.isFinite(value)) values.home_value_to_income[geoid] = value / inc;
      });

      if (chas) {
        Object.keys(chas).forEach(function (geoid) {
          var t = chas[geoid] && chas[geoid].tiers && chas[geoid].tiers['30'];
          var per100 = t ? Number(t.homes_per_100_households) : NaN;
          if (!t || t.homes_per_100_households == null || !Number.isFinite(per100)) return;
          values.missing_per_100_lte30[geoid] = Math.max(0, 100 - per100);
          if (chasThin(t)) mark(unreliable, 'missing_per_100_lte30', geoid);
          var t50 = chas[geoid].tiers['50'];
          var p50 = t50 ? Number(t50.homes_per_100_households) : NaN;
          if (t50 && t50.homes_per_100_households != null && Number.isFinite(p50)) {
            values.short_per_100_lte50[geoid] = Math.max(0, 100 - p50);
            if (chasThin(t50)) mark(unreliable, 'short_per_100_lte50', geoid);
          }
          var t80 = chas[geoid].tiers['80'];
          if (t80 && Number(t80.renter_households) > 0) {
            detail[geoid] = {
              renters_lte50: t50 ? Number(t50.renter_households) : null,
              affordable_lte50: t50 ? Number(t50.affordable_available_homes) : null,
              renters_lte80: Number(t80.renter_households),
            };
            if (chasThin(t80)) mark(unreliable, 'subsidized_per_100_lte80', geoid);
          }
        });
      }

      if (reliability) {
        Object.keys(CV_FIELDS).forEach(function (field) {
          Object.keys(values[field]).forEach(function (geoid) {
            var geo = reliability[geoid];
            if (!geo) return;
            var sumSq = 0;
            var known = CV_FIELDS[field].every(function (v) {
              var cv = geo[v] ? Number(geo[v].cv) : NaN;
              if (!Number.isFinite(cv)) return false;
              sumSq += cv * cv;
              return true;
            });
            if (known && Math.sqrt(sumSq) > CV_LIMIT) mark(unreliable, field, geoid);
          });
        });
      }

      return { values: values, unreliable: unreliable, names: names, boundaries: boundaries, detail: detail };
    });
    pending.catch(function () { pending = null; });
    return pending;
  }

  var pendingProjections = null;

  // DOLA projections are one file per county (about 1.4 MB together), so
  // they load only when a projection measure is picked.
  function loadProjections(fetchJson) {
    if (pendingProjections) return pendingProjections;
    var get = fetchJson || defaultFetch;
    pendingProjections = load(fetchJson).then(function (res) {
      var geoids = Object.keys(res.names);
      return Promise.all(geoids.map(function (geoid) {
        return get('data/hna/projections/' + geoid + '.json').catch(function () { return null; });
      })).then(function (files) {
        files.forEach(function (d, i) {
          var geoid = geoids[i];
          var pop = d && d.population_dola;
          if (!Array.isArray(pop) || !(pop[0] > 0)) return;
          var last = Number(pop[pop.length - 1]);
          if (Number.isFinite(last)) res.values.dola_pop_change_20yr[geoid] = (last / pop[0] - 1) * 100;
          var inc = d.housing_need && d.housing_need.incremental_units_needed_dola;
          var base = d.base && Number(d.base.population);
          var lastInc = Array.isArray(inc) ? Number(inc[inc.length - 1]) : NaN;
          if (Number.isFinite(lastInc) && base > 0) res.values.dola_new_homes_per_1k[geoid] = Math.max(0, lastInc) / base * 1000;
        });
        return res;
      });
    });
    pendingProjections.catch(function () { pendingProjections = null; });
    return pendingProjections;
  }

  var pendingInventory = null;

  // Subsidized homes by county. Records without a county code are placed
  // by their coordinates. The file is about 1.5 MB, so it loads only when
  // the subsidized measure is picked.
  function loadInventory(fetchJson) {
    if (pendingInventory) return pendingInventory;
    var get = fetchJson || defaultFetch;
    pendingInventory = load(fetchJson).then(function (res) {
      return get('data/affordable-housing/properties.json').then(function (j) {
        var feats = res.boundaries.features;
        var units = {};
        var seen = {};
        (j && Array.isArray(j.properties) ? j.properties : []).forEach(function (p) {
          var n = Number(p.assisted_units);
          if (!(n > 0)) return;
          // The same building can appear twice under two names (a CHFA and
          // a HUD or USDA record): same street number, ZIP and unit count,
          // and within about 150 m of each other. Two buildings that share a
          // number on different streets are farther apart than that.
          var num = String(p.address || '').trim().split(/\s+/)[0];
          if (num && p.zip && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
            var key = num + '|' + p.zip + '|' + n;
            var prior = seen[key] || [];
            var dup = prior.some(function (q) {
              var dy = (q[0] - p.lat) * 111320;
              var dx = (q[1] - p.lng) * 111320 * Math.cos(p.lat * Math.PI / 180);
              return dx * dx + dy * dy < 150 * 150;
            });
            if (dup) return;
            prior.push([p.lat, p.lng]);
            seen[key] = prior;
          }
          var geoid = p.county_fips;
          if (!geoid && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
            for (var i = 0; i < feats.length; i++) {
              if (feats[i].geometry && inGeometry(p.lng, p.lat, feats[i].geometry)) { geoid = feats[i].properties.GEOID; break; }
            }
          }
          if (geoid) units[geoid] = (units[geoid] || 0) + n;
        });
        Object.keys(res.detail).forEach(function (geoid) {
          var d = res.detail[geoid];
          d.subsidized = units[geoid] || 0;
          res.values.subsidized_per_100_lte80[geoid] = d.subsidized / d.renters_lte80 * 100;
          // More subsidized homes on record than renter households CHAS
          // counts at that income: the two sources disagree too much to rank.
          if (d.subsidized > d.renters_lte80) mark(res.unreliable, 'subsidized_per_100_lte80', geoid);
        });
        return res;
      });
    });
    pendingInventory.catch(function () { pendingInventory = null; });
    return pendingInventory;
  }

  // Values for one measure, loading the projection files when it needs them.
  function loadField(field, fetchJson) {
    var f = FIELDS[field] || {};
    if (f.projection) return loadProjections(fetchJson);
    if (f.inventory) return loadInventory(fetchJson);
    return load(fetchJson);
  }

  window.CountyMeasures = { load: load, loadField: loadField, FIELDS: FIELDS, format: format };
})();
