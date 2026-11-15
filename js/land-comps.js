// js/land-comps.js: land sales near a site, from the State of Colorado public parcel layer, and a first read on
// the site's best use. Shared by the free Land value tool (summary only) and the member site brief (each sale).
//
// Source: State of Colorado Public Parcels (OIT), Colorado_Public_Parcels MapServer layer 0
// (https://gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0).
// Each parcel carries only its LAST recorded sale, as the county reported it, so land later built on drops out.
// The state allows use with credit but forbids resale of the rows, so the free site shows only the summary.
//
// Vacant land: the county's land-use text when it says "vacant", or the Colorado Division of Property Taxation
// abstract code 0100-0560 (vacant residential, commercial, industrial, PUD lots and vacant acreage; listed in
// Adams County's Property Classification Codes, 27 Mar 2018). Counties whose records carry neither are marked
// "vacant or built, unknown" and their sales are flagged, never silently mixed in.
//
// No time adjustment: there is no Colorado land price index to adjust with, so older sales are shown with their
// year and the window is widened only when too few recent sales are found. Below 3 sales there is no middle value.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LandComps = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var LAYER = 'https://gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0/query';
  var SOURCE_PAGE = 'https://gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0';
  var MIN_PRICE = 1000;           // under this a "sale" is usually a family transfer or a correction deed
  var MAX_MILES = 15, PAGE = 2000, MAX_PAGES = 4;
  // Counties whose state-layer records give no reliable vacant label (read 15 Nov 2026: Adams and Jefferson send
  // broad classes only, Broomfield and Garfield local codes, Archuleta local codes, Boulder no land use at all).
  var NO_VACANT_LABEL = ['Adams', 'Archuleta', 'Boulder', 'Broomfield', 'Garfield', 'Jefferson'];
  // The widening steps, in order. The first that finds 5 or more sales is used.
  var STEPS = [
    { miles: 5, since: '2023-01-01', lo: 0.5, hi: 3 },
    { miles: 10, since: '2023-01-01', lo: 0.5, hi: 3 },
    { miles: 10, since: '2020-01-01', lo: 0.5, hi: 3 },
    { miles: 15, since: '2020-01-01', lo: 0.5, hi: 3 },
    { miles: 15, since: '2018-01-01', lo: 0.25, hi: 4 }
  ];
  var ENOUGH = 5, MIN_FOR_MIDDLE = 3;

  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    var n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
    return String(v == null ? '' : v).trim() === '' ? NaN : (Number.isFinite(n) ? n : NaN);
  }

  // Sale dates as the counties send them (seen 20 Oct 2026): 5/12/2016, 20160524, 20190228000000,
  // 04/28/2016 00:00:00, 2016-05-24, epoch milliseconds, blank. Returns YYYY-MM-DD or null.
  function saleDate(v) {
    var s = String(v == null ? '' : v).trim(), m;
    if (!s) return null;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{6})?$/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if (/^-?\d{10,13}$/.test(s)) { var d = new Date(Number(s)); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
    return null;
  }

  // true = vacant land, false = built or not vacant, null = the county's record can't say.
  function isVacant(use, code, county) {
    if (use && /vacant/i.test(use)) return true;
    var c = String(code == null ? '' : code).split(/[,\s]/)[0];
    if (/^\d{3,4}$/.test(c)) {
      var n = Number(c.length === 3 ? '0' + c : c);
      return n >= 100 && n <= 599;
    }
    if (NO_VACANT_LABEL.indexOf(county) >= 0) return null;
    if (use) return false;
    return null;
  }

  // A rough centre for a parcel shape: the mean of its outer ring's corners (enough for a distance in miles).
  function centre(geom) {
    if (!geom) return null;
    if (Number.isFinite(geom.x) && Number.isFinite(geom.y)) return { lon: geom.x, lat: geom.y };
    var ring = geom.rings && geom.rings[0];
    if (!ring || !ring.length) return null;
    var x = 0, y = 0;
    ring.forEach(function (p) { x += p[0]; y += p[1]; });
    return { lon: x / ring.length, lat: y / ring.length };
  }

  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // A parcel's acres: the county's figure, or from its shape where the county left acres blank.
  // { acres, fromShape } or null.
  function parcelAcres(f) {
    var a = (f && f.attributes) || {}, acres = num(a.landAcres);
    if (acres > 0) return { acres: acres, fromShape: false };
    var at = centre(f && f.geometry), sq = num(a['Shape.STArea()']);
    return at && sq > 0 ? { acres: sq / sqDegPerAcre(at.lat), fromShape: true } : null;
  }

  // One state-layer feature as a plain sale record. Null when it has no usable price, acres or date.
  function fromFeature(f, subject) {
    var a = (f && f.attributes) || {};
    var price = num(a.salePrice), date = saleDate(a.saleDate), at = centre(f && f.geometry);
    var pa = parcelAcres(f), fromShape = !!(pa && pa.fromShape), acres = pa ? pa.acres : NaN;
    if (!(price >= MIN_PRICE) || !(acres > 0) || !date || !at) return null;
    var rec = {
      county: a.countyName || '', parcel: String(a.parcel_id || a.account || ''),
      address: [a.situsAdd, a.sitAddCty].filter(Boolean).join(', '),
      acres: acres, acresFromShape: fromShape, price: price, date: date, ppa: price / acres,
      assessed: num(a.apprValTot), use: [a.landUseDsc, a.landUseCde].filter(Boolean).join(' \u00b7 '),
      vacant: isVacant(a.landUseDsc, a.landUseCde, a.countyName), fileDate: a.dateReceived || '',
      lat: at.lat, lon: at.lon, url: a.URL || ''
    };
    if (subject && Number.isFinite(subject.lat)) rec.miles = miles(subject, rec);
    return rec;
  }

  // Square degrees to acres at a latitude (the layer is in WGS84, so Shape.STArea() is in square degrees).
  // Denver, Arapahoe, Routt and La Plata leave landAcres blank on many parcels; their acres come from the shape.
  var M_PER_DEG_LAT = 110574, M_PER_DEG_LON_EQ = 111320, M2_PER_ACRE = 4046.8564;
  function sqDegPerAcre(lat) { return M2_PER_ACRE / (M_PER_DEG_LAT * M_PER_DEG_LON_EQ * Math.cos(lat * Math.PI / 180)); }

  // Vacant land only, read by the server where the county labels it: land-use text with "vacant", or a Division
  // of Property Taxation vacant code (0100-0599; Gilpin writes them with three digits). HOA common areas left out.
  var VACANT_WHERE = "(UPPER(landUseDsc) LIKE '%VACANT%' OR landUseCde LIKE '01%' OR landUseCde LIKE '02%' OR landUseCde LIKE '03%'" +
    " OR landUseCde LIKE '04%' OR landUseCde LIKE '05%' OR landUseCde LIKE '1__' OR landUseCde LIKE '2__' OR landUseCde LIKE '3__'" +
    " OR landUseCde LIKE '4__' OR landUseCde LIKE '5__') AND (landUseDsc IS NULL OR UPPER(landUseDsc) NOT LIKE '%COMMON%')";

  // The query for priced vacant parcels near a point, sized for the widest step. Acres are filtered by the
  // server (from the shape where the county left acres blank); dates are read here, as each county writes them
  // differently.
  function queryParams(subject, offset) {
    var wide = STEPS[STEPS.length - 1], k = sqDegPerAcre(subject.lat);
    var acres = subject.acres > 0
      ? ' AND ((landAcres >= ' + (subject.acres * wide.lo).toFixed(4) + ' AND landAcres <= ' + (subject.acres * wide.hi).toFixed(4) + ')' +
        ' OR (landAcres IS NULL AND Shape.STArea() >= ' + (subject.acres * wide.lo * k * 0.9).toExponential(6) + ' AND Shape.STArea() <= ' + (subject.acres * wide.hi * k * 1.1).toExponential(6) + '))'
      : '';
    return {
      where: "salePrice IS NOT NULL AND salePrice <> '0' AND " + VACANT_WHERE + acres,
      geometry: subject.lon.toFixed(6) + ',' + subject.lat.toFixed(6), geometryType: 'esriGeometryPoint', inSR: '4326',
      distance: String(MAX_MILES), units: 'esriSRUnit_StatuteMile', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'countyName,parcel_id,account,situsAdd,sitAddCty,landAcres,landUseCde,landUseDsc,saleDate,salePrice,apprValTot,dateReceived,URL,Shape.STArea()',
      returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.0005', orderByFields: 'OBJECTID',
      resultOffset: String(offset || 0), resultRecordCount: String(PAGE), f: 'json'
    };
  }

  // The county that holds a point, read from the parcel under it (county name only). Null off any parcel.
  function countyAt(point, fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    var body = new URLSearchParams({ geometry: point.lon.toFixed(6) + ',' + point.lat.toFixed(6), geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'countyName', returnGeometry: 'false', resultRecordCount: '1', f: 'json' });
    return f(LAYER, { method: 'POST', body: body }).then(function (r) { return r.json(); })
      .then(function (j) { var a = j && j.features && j.features[0] && j.features[0].attributes; return a ? a.countyName : null; });
  }

  // Fetches the priced parcels near the subject, page by page. fetchImpl is window.fetch in a browser.
  function fetchNear(subject, fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.reject(new Error('This browser cannot reach the state parcel layer.'));
    var out = [], truncated = false;
    function page(n) {
      var body = new URLSearchParams(queryParams(subject, n * PAGE));
      return f(LAYER, { method: 'POST', body: body }).then(function (r) {
        if (!r.ok) throw new Error('The state parcel layer answered ' + r.status + '.');
        return r.json();
      }).then(function (j) {
        if (j.error) throw new Error('The state parcel layer: ' + (j.error.message || 'error'));
        (j.features || []).forEach(function (ft) { var rec = fromFeature(ft, subject); if (rec) out.push(rec); });
        if (j.exceededTransferLimit && n + 1 < MAX_PAGES) return page(n + 1);
        if (j.exceededTransferLimit) truncated = true;
      });
    }
    return page(0).then(function () { return { sales: out, truncated: truncated, accessed: new Date().toISOString().slice(0, 10) }; });
  }

  function inStep(rec, step, subject, vacantOnly) {
    if (!(rec.miles <= step.miles) || rec.date < step.since) return false;
    if (subject.acres > 0 && (rec.acres < subject.acres * step.lo || rec.acres > subject.acres * step.hi)) return false;
    if (vacantOnly && rec.vacant !== true) return false;
    return true;
  }

  // Picks the sales: the first widening step with 5 or more, else the widest step's.
  function pick(subject, sales, opts) {
    var vacantOnly = !opts || opts.vacantOnly !== false;
    var steps = (opts && opts.steps) || STEPS, chosen = null, i;
    for (i = 0; i < steps.length; i++) {
      var got = sales.filter(function (r) { return inStep(r, steps[i], subject, vacantOnly); });
      chosen = { step: steps[i], index: i, sales: got };
      if (got.length >= ENOUGH) break;
    }
    chosen.widened = chosen.index > 0;
    chosen.sales.sort(function (a, b) { return a.miles - b.miles; });
    return chosen;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // The summary the free site shows: counts, rules, spread, middle and middle half, and where a price ranks.
  // Never a single "value": the middle is $ per acre from records, arithmetic only.
  function summarize(picked, subject, askingPrice) {
    var s = picked.sales, ppa = s.map(function (r) { return r.ppa; }).sort(function (a, b) { return a - b; });
    var counties = {}, unknown = 0;
    s.forEach(function (r) { counties[r.county] = r.fileDate; if (r.vacant === null) unknown++; });
    var out = {
      count: s.length, rule: picked.step, widened: picked.widened, unknownVacant: unknown,
      counties: Object.keys(counties).sort().map(function (c) { return { county: c, fileDate: counties[c] }; }),
      milesMax: s.length ? Math.max.apply(null, s.map(function (r) { return r.miles; })) : NaN,
      acresMin: s.length ? Math.min.apply(null, s.map(function (r) { return r.acres; })) : NaN,
      acresMax: s.length ? Math.max.apply(null, s.map(function (r) { return r.acres; })) : NaN,
      dateMin: s.length ? s.reduce(function (m, r) { return r.date < m ? r.date : m; }, s[0].date) : null,
      dateMax: s.length ? s.reduce(function (m, r) { return r.date > m ? r.date : m; }, s[0].date) : null,
      ppaMin: ppa.length ? ppa[0] : NaN, ppaMax: ppa.length ? ppa[ppa.length - 1] : NaN,
      median: NaN, q1: NaN, q3: NaN, ask: null, ppaSorted: ppa
    };
    if (s.length >= MIN_FOR_MIDDLE) {
      out.median = quantile(ppa, 0.5); out.q1 = quantile(ppa, 0.25); out.q3 = quantile(ppa, 0.75);
    }
    if (askingPrice > 0 && subject.acres > 0 && s.length) {
      var a = askingPrice / subject.acres;
      out.ask = { ppa: a, above: ppa.filter(function (v) { return v < a; }).length, of: ppa.length };
    }
    return out;
  }

  // The appraiser's four tests, each marked checked, partly checked or not checked, from what is known.
  // inputs: { zoning: '' | 'mf-right' | 'mf-cup' | 'rezone' | 'mixed' | 'commercial' | 'other',
  //   zoningSource, zoningCode and zoningDesc (the county's recorded code, shown but not read), acres, homes, residual (most the deal can pay, or null), env (member screen result or null) }
  function bestUse(inputs) {
    var i = inputs || {}, z = i.zoning || '';
    var legal = z === 'mf-right' ? { status: 'checked', answer: 'Yes', text: 'Apartments are allowed by right' }
      : z === 'mf-cup' ? { status: 'partly', answer: 'With a hearing', text: 'Apartments need a conditional use permit, so a public hearing decides' }
      : z === 'mixed' ? { status: 'partly', answer: 'Probably', text: 'Mixed-use zoning often allows apartments; check the use table' }
      : z === 'rezone' ? { status: 'checked', answer: 'Not yet', text: 'The site needs rezoning before apartments are allowed' }
      : z === 'commercial' ? { status: 'partly', answer: 'Not as zoned', text: 'Commercial zoning: apartments need a rezoning or a conversion the town allows' }
      : z === 'other' ? { status: 'partly', answer: 'Unclear', text: 'Check the town’s use table for apartments' }
      : i.zoningCode ? { status: 'partly', answer: 'Zoned ' + i.zoningCode, text: 'The county records zoning ' + i.zoningCode + (i.zoningDesc ? ' (' + i.zoningDesc + ')' : '') + '. CoHO does not yet read what each local code allows; check the town\u2019s use table' }
      : { status: 'not_checked', answer: 'Not checked', text: i.zoningNote || 'Zoning not entered' };
    if (z && i.zoningSource) legal.text += ' (' + i.zoningSource + ')';
    legal.text += '.';

    var density = i.acres > 0 && i.homes > 0 ? i.homes / i.acres : null;
    var phys = { status: 'not_checked', answer: 'Not checked', text: 'Enter the acres and the number of homes.' };
    if (density != null) {
      phys = { status: 'partly', answer: Math.round(density * 10) / 10 + ' homes an acre',
        text: 'Size only. Slope, flood, wetlands, soils, road access and water and sewer are not checked here.' };
      if (i.env) {
        phys.status = i.env.flags && i.env.flags.length ? 'partly' : 'checked';
        phys.text = i.env.flags && i.env.flags.length ? 'Environmental screen flags: ' + i.env.flags.join('; ') + '. Road access and taps not checked.' : 'The environmental screen found no flag. Road access and water and sewer taps are not checked.';
      }
    }

    var r = i.residual;
    var fin = r == null || !Number.isFinite(r) ? { status: 'not_checked', answer: 'Not checked', text: 'Enter the deal’s cost and sources to see the most it can pay for land.' }
      : r > 0 ? { status: 'checked', answer: 'Yes', text: 'The deal leaves money for land after it is built.' }
      : { status: 'checked', answer: 'No', text: 'As entered, nothing is left for land.' };

    var most = { status: 'not_checked', answer: 'Not checked', text: 'Compare a 9% rental, a 4% rental and homes for sale in the Deal Calculator. Market-rate building is not modelled on CoHO.' };
    return [
      { id: 'legal', title: 'Is it allowed?', result: legal },
      { id: 'physical', title: 'Can it be built?', result: phys },
      { id: 'financial', title: 'Does it pay for itself?', result: fin },
      { id: 'productive', title: 'Which use is worth most?', result: most }
    ];
  }

  // What to find out next, ordered by how much each could move the price. Built from the gaps only.
  // ctx: { zoning, summary (from summarize, or null), holdingYears (member), publicOwner (member) }
  function questions(ctx) {
    var c = ctx || {}, q = [], s = c.summary;
    if (!c.zoning || c.zoning === 'rezone' || c.zoning === 'commercial' || c.zoning === 'other')
      q.push({ id: 'zoning', text: 'Ask the planning office whether apartments are allowed here, and how long a rezoning takes if not.' });
    if (c.publicOwner) q.push({ id: 'public-owner', text: 'The owner is a public or nonprofit body. Ask whether it would sell, lease or partner, and whether the 2026 state law on faster approvals for their land applies.' });
    q.push({ id: 'taps', text: 'Ask the water and sewer providers whether taps are available and what they cost. Tap fees can move the land price more than anything else.' });
    if (s && s.ask && s.ask.of >= MIN_FOR_MIDDLE && s.ask.above / s.ask.of >= 0.75)
      q.push({ id: 'ask-high', text: 'The asking price is above ' + s.ask.above + ' of ' + s.ask.of + ' nearby sales. Ask the seller what the price is based on.' });
    if (!s || s.count < ENOUGH)
      q.push({ id: 'few-sales', text: 'Few recorded sales were found. Ask a local land broker about recent sales, including off-market ones.' });
    if (s && s.count) q.push({ id: 'related', text: 'Some sales may be between relatives or related companies. These records can’t screen them; check the deed type at the county.' });
    q.push({ id: 'minerals', text: 'Ask the title company whether the mineral rights were split off from the land.' });
    if (Number.isFinite(c.holdingYears)) q.push({ id: 'held', text: 'The owner has held the land ' + Math.round(c.holdingYears) + ' years. Long holds can mean a low tax basis and interest in an installment sale.' });
    return q;
  }

  // Owner types the 2026 state law on public and nonprofit land names (school districts, colleges, BOCES, housing
  // authorities, transit districts, local governments, affordable housing nonprofits), read from the owner's name.
  // A signal to check, never a finding: names are as the county records them.
  var PUBLIC_OWNER = [
    ['housing authority', /HOUSING AUTH|\bHA\b.*HOUSING|HOUSING (DEVELOPMENT|PARTNERS)? ?AUTH/],
    ['school district', /SCHOOL DIST|\bSCHOOL DISTRICT|\bSD ?\d|\bR-?\d+J?\b.*SCHOOL|BOARD OF EDUCATION/],
    ['college or university', /UNIVERSITY|COLLEGE|\bBOCES\b|BOARD OF (REGENTS|TRUSTEES)/],
    ['transit district', /TRANSPORTATION DIST|TRANSIT|\bRTD\b/],
    ['town, city or county', /^(TOWN|CITY|COUNTY) OF\b|\b(TOWN|CITY) OF [A-Z]|BOARD OF COUNTY COMM|COUNTY COMMISSIONERS|\bCOUNTY OF\b|CITY AND COUNTY/],
    ['state of Colorado', /^STATE OF COLORADO|STATE BOARD OF LAND|COLORADO STATE LAND|DEPARTMENT OF TRANSPORTATION|\bCDOT\b/],
    ['housing nonprofit or land trust', /HABITAT FOR HUMANITY|LAND TRUST|COMMUNITY LAND|HOUSING (TRUST|CORP|FOUNDATION)|NEIGHBORWORKS/]
  ];
  function ownerType(name) {
    var n = String(name || '').toUpperCase();
    for (var i = 0; i < PUBLIC_OWNER.length; i++) if (PUBLIC_OWNER[i][1].test(n)) return PUBLIC_OWNER[i][0];
    return null;
  }

  return {
    LAYER: LAYER, SOURCE_PAGE: SOURCE_PAGE, STEPS: STEPS, ENOUGH: ENOUGH, MIN_FOR_MIDDLE: MIN_FOR_MIDDLE, MAX_MILES: MAX_MILES,
    NO_VACANT_LABEL: NO_VACANT_LABEL, saleDate: saleDate, isVacant: isVacant, centre: centre, miles: miles,
    fromFeature: fromFeature, queryParams: queryParams, fetchNear: fetchNear, countyAt: countyAt, sqDegPerAcre: sqDegPerAcre, parcelAcres: parcelAcres, pick: pick, summarize: summarize,
    bestUse: bestUse, questions: questions, ownerType: ownerType
  };
});
