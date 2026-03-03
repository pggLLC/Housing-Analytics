/**
 * js/pma-site-selection.js
 * PMA (Primary Market Area) + Site Selection Scoring Engine.
 * Uses public data only: ACS tract metrics, HUD LIHTC, TIGER tract centroids.
 *
 * Weights: demand 0.35 | capture 0.35 | rentPressure 0.20 | landSupply 0.07 | workforce 0.03
 *
 * Usage:
 *   PmaSiteSelection.analyze({ lat, lng, radiusMiles, proposedUnits, amiBand })
 *   => Promise<{ siteScore, subscores, riskFlags, comps, captureSimulator }>
 */
(function () {
  'use strict';

  var WEIGHTS = { demand: 0.35, capture: 0.35, rentPressure: 0.20, landSupply: 0.07, workforce: 0.03 };

  // ── Haversine distance (miles) ──────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    var R = 3958.8; // Earth radius in miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Sub-score functions (all return 0–100) ──────────────────────────────────

  function scoreDemand(tracts) {
    if (!tracts.length) return 50;
    var totalRenters = tracts.reduce(function (s, t) { return s + (t.renter_households || 0); }, 0);
    var burdened = tracts.reduce(function (s, t) {
      return s + ((t.cost_burden_rate || 0) * (t.renter_households || 0));
    }, 0);
    var burdenRate = totalRenters > 0 ? burdened / totalRenters : 0;
    var rentersScore = Math.min(100, (totalRenters / 5000) * 50);
    var burdenScore = Math.min(100, burdenRate * 200);
    return Math.round((rentersScore + burdenScore) / 2);
  }

  function scoreCapture(tracts, lihtcFeatures, proposedUnits) {
    var qualRenters = tracts.reduce(function (s, t) { return s + (t.renter_households || 0); }, 0);
    var existingUnits = lihtcFeatures.reduce(function (s, f) {
      return s + (Number((f.properties || f).N_UNITS || (f.properties || f).total_units || 0) || 0);
    }, 0);
    var proposed = proposedUnits || 0;
    if (!qualRenters) return 50;
    var captureRate = (existingUnits + proposed) / qualRenters;
    if (captureRate < 0.12) return 100;
    if (captureRate < 0.15) return 90;
    if (captureRate < 0.20) return 75;
    if (captureRate < 0.25) return 60;
    if (captureRate < 0.30) return 45;
    return 30;
  }

  function scoreRentPressure(tracts) {
    if (!tracts.length) return 55;
    var validTracts = tracts.filter(function (t) { return t.median_gross_rent && t.median_household_income; });
    if (!validTracts.length) return 55;
    var totalRPI = validTracts.reduce(function (s, t) {
      var rpi = t.median_gross_rent / ((0.30 * t.median_household_income) / 12);
      return s + rpi;
    }, 0);
    var avgRPI = totalRPI / validTracts.length;
    if (avgRPI >= 1.15) return 95;
    if (avgRPI >= 1.00) return 80;
    if (avgRPI >= 0.90) return 70;
    return 55;
  }

  function scoreLandSupply(tracts) {
    if (!tracts.length) return 50;
    var validTracts = tracts.filter(function (t) { return t.vacancy_rate != null; });
    if (!validTracts.length) return 50;
    var avgVac = validTracts.reduce(function (s, t) { return s + t.vacancy_rate; }, 0) / validTracts.length;
    // Low vacancy => higher constraint => higher score
    if (avgVac < 0.03) return 90;
    if (avgVac < 0.05) return 75;
    if (avgVac < 0.08) return 60;
    if (avgVac < 0.12) return 45;
    return 30;
  }

  function scoreWorkforce() {
    // v1.0 placeholder — LODES data integration planned for v1.1
    return 65;
  }

  // ── Risk flags ──────────────────────────────────────────────────────────────

  function computeRiskFlags(tracts, lihtcFeatures, proposedUnits) {
    var flags = [];
    var qualRenters = tracts.reduce(function (s, t) { return s + (t.renter_households || 0); }, 0);
    var existingUnits = lihtcFeatures.reduce(function (s, f) {
      return s + (Number((f.properties || f).N_UNITS || (f.properties || f).total_units || 0) || 0);
    }, 0);
    var captureRate = qualRenters > 0 ? (existingUnits + (proposedUnits || 0)) / qualRenters : 0;
    if (captureRate >= 0.25) flags.push({ flag: 'high_capture_risk', label: 'High Capture Risk', detail: 'Capture rate ≥ 25%: PMA may already be well-served by affordable inventory.' });

    var totalRenters = tracts.reduce(function (s, t) { return s + (t.renter_households || 0); }, 0);
    var burdened = tracts.reduce(function (s, t) { return s + ((t.cost_burden_rate || 0) * (t.renter_households || 0)); }, 0);
    var burdenRate = totalRenters > 0 ? burdened / totalRenters : 0;
    if (burdenRate >= 0.45) flags.push({ flag: 'high_cost_pressure', label: 'High Cost Pressure', detail: 'Cost burden rate ≥ 45%: severe affordability stress in PMA.' });

    var validTracts = tracts.filter(function (t) { return t.median_gross_rent && t.median_household_income; });
    if (validTracts.length) {
      var avgRPI = validTracts.reduce(function (s, t) {
        return s + t.median_gross_rent / ((0.30 * t.median_household_income) / 12);
      }, 0) / validTracts.length;
      if (avgRPI >= 1.10) flags.push({ flag: 'elevated_rent_pressure', label: 'Elevated Rent Pressure', detail: 'Rent Pressure Index ≥ 1.10: median rent exceeds 30% AMI threshold.' });
    }
    return flags;
  }

  // ── Capture simulator ───────────────────────────────────────────────────────

  function captureSimulator(tracts, lihtcFeatures, proposedUnits, amiBand) {
    var qualRenters = tracts.reduce(function (s, t) { return s + (t.renter_households || 0); }, 0);
    var existingUnits = lihtcFeatures.reduce(function (s, f) {
      return s + (Number((f.properties || f).N_UNITS || (f.properties || f).total_units || 0) || 0);
    }, 0);
    var proposed = proposedUnits || 0;
    // AMI band factor: estimated share of renter HH qualifying at each AMI level,
    // derived from HUD income limit distributions (v1.0 approximation; refine with CHAS data in v1.1)
    var amiFactor = amiBand <= 30 ? 0.15 : amiBand <= 50 ? 0.30 : amiBand <= 60 ? 0.40 : amiBand <= 80 ? 0.60 : 1.0;
    var bandRenters = Math.round(qualRenters * amiFactor);
    var bandCapture = bandRenters > 0 ? proposed / bandRenters : 0;
    var overallPenetration = qualRenters > 0 ? (existingUnits + proposed) / qualRenters : 0;
    return {
      amiBand: amiBand,
      proposedUnits: proposed,
      qualifiedRenterHH: qualRenters,
      bandRenterHH: bandRenters,
      bandCaptureRate: bandCapture,
      overallPenetrationProxy: overallPenetration,
      existingAffordableUnits: existingUnits
    };
  }

  // ── Main analyze function ───────────────────────────────────────────────────

  function analyze(opts) {
    var lat = opts.lat;
    var lng = opts.lng;
    var radiusMiles = opts.radiusMiles || 5;
    var proposedUnits = opts.proposedUnits || 0;
    var amiBand = opts.amiBand || 60;

    function load(url) {
      if (typeof DataService !== 'undefined' && DataService.getJSON) {
        return DataService.getJSON(url);
      }
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    var centroidsUrl = typeof DataService !== 'undefined'
      ? DataService.baseData('market/tract_centroids_co.json')
      : 'data/market/tract_centroids_co.json';
    var acsUrl = typeof DataService !== 'undefined'
      ? DataService.baseData('market/acs_tract_metrics_co.json')
      : 'data/market/acs_tract_metrics_co.json';
    var lihtcUrl = typeof DataService !== 'undefined'
      ? DataService.baseData('market/hud_lihtc_co.geojson')
      : 'data/market/hud_lihtc_co.geojson';

    return Promise.all([
      load(centroidsUrl).catch(function () { return { features: [] }; }),
      load(acsUrl).catch(function () { return { tracts: [] }; }),
      load(lihtcUrl).catch(function () { return { features: [] }; })
    ]).then(function (results) {
      var centroidsGeo = results[0];
      var acsData = results[1];
      var lihtcGeo = results[2];

      // Build ACS lookup by tract GEOID
      var tractMap = {};
      var tractList = Array.isArray(acsData.tracts) ? acsData.tracts : [];
      tractList.forEach(function (t) { if (t.tract_geoid) tractMap[t.tract_geoid] = t; });

      // Filter tract centroids within PMA radius
      var centroids = Array.isArray(centroidsGeo.features) ? centroidsGeo.features : [];
      var pmaTracts = [];
      centroids.forEach(function (f) {
        var coords = f.geometry && f.geometry.coordinates;
        if (!coords) return;
        var tLng = coords[0], tLat = coords[1];
        var dist = haversine(lat, lng, tLat, tLng);
        if (dist <= radiusMiles) {
          var geoid = (f.properties && f.properties.GEOID) || '';
          var metrics = tractMap[geoid] || {};
          pmaTracts.push(Object.assign({ geoid: geoid, dist: dist }, metrics));
        }
      });

      // Filter LIHTC comps within PMA radius
      var lihtcFeatures = Array.isArray(lihtcGeo.features) ? lihtcGeo.features : [];
      var pmaLihtc = lihtcFeatures.filter(function (f) {
        var coords = f.geometry && f.geometry.coordinates;
        if (!coords) return false;
        var fLng = coords[0], fLat = coords[1];
        return haversine(lat, lng, fLat, fLng) <= radiusMiles;
      });

      // Compute sub-scores
      var demand = scoreDemand(pmaTracts);
      var capture = scoreCapture(pmaTracts, pmaLihtc, proposedUnits);
      var rentPressure = scoreRentPressure(pmaTracts);
      var landSupply = scoreLandSupply(pmaTracts);
      var workforce = scoreWorkforce();

      var siteScore = Math.round(
        demand * WEIGHTS.demand +
        capture * WEIGHTS.capture +
        rentPressure * WEIGHTS.rentPressure +
        landSupply * WEIGHTS.landSupply +
        workforce * WEIGHTS.workforce
      );

      var riskFlags = computeRiskFlags(pmaTracts, pmaLihtc, proposedUnits);
      var sim = captureSimulator(pmaTracts, pmaLihtc, proposedUnits, amiBand);

      return {
        siteScore: siteScore,
        subscores: { demand: demand, capture: capture, rentPressure: rentPressure, landSupply: landSupply, workforce: workforce },
        weights: WEIGHTS,
        riskFlags: riskFlags,
        tractCount: pmaTracts.length,
        comps: {
          count: pmaLihtc.length,
          estimatedUnits: pmaLihtc.reduce(function (s, f) {
            return s + (Number((f.properties || f).N_UNITS || (f.properties || f).total_units || 0) || 0);
          }, 0)
        },
        captureSimulator: sim,
        params: { lat: lat, lng: lng, radiusMiles: radiusMiles, proposedUnits: proposedUnits, amiBand: amiBand }
      };
    });
  }

  window.PmaSiteSelection = { analyze: analyze };
})();
