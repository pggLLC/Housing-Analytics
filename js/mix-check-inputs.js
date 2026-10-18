/**
 * mix-check-inputs.js — gathers what js/mix-check.js needs for one county or place,
 * so every recommender reads the same files the same way.
 *
 *   data/market/chas_co.json (or data/hna/chas_affordability_gap.json, same rows)
 *       county renter cost burden by income band, HUD CHAS
 *   data/hna/place-chas.json          place renter cost burden (low_confidence skipped)
 *   data/chfa-income-rent-limits-2026.json   CHFA two-bedroom rent limits, 30–80% AMI,
 *       and the rural resort flag
 *   data/policy/lihtc-underwriting-rules.json  CHFA minimum pro forma assumptions
 *   data/policy/co-developer-funding-guide.json   the MIHTC program (id chfa-mihtc)
 *   data/hud-fmr-income-limits.json, data/market/zori_rents_co.json,
 *   data/market/apartment_list_co.json   current rents (never ACS median gross rent)
 *
 * build() and check() are pure and run in node; load() fetches what a page has not
 * already loaded; renderHtml() is the shared block each page drops into its card.
 * An unknown input stays null; nothing is coerced to 0.
 * Exposed as window.MixCheckInputs and module.exports.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MixCheckInputs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PATHS = {
    countyChas: 'data/market/chas_co.json',
    placeChas: 'data/hna/place-chas.json',
    limits: 'data/chfa-income-rent-limits-2026.json',
    rules: 'data/policy/lihtc-underwriting-rules.json',
    guide: 'data/policy/co-developer-funding-guide.json',
    fmr: 'data/hud-fmr-income-limits.json',
    zori: 'data/market/zori_rents_co.json',
    apartmentList: 'data/market/apartment_list_co.json'
  };
  var TIERS = ['30', '40', '50', '60', '70', '80'];
  var BANDS = [['31to50', '31–50% AMI'], ['51to80', '51–80% AMI'], ['81to100', '81–100% AMI']];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s*\((?:town|city|cdp|county)\)\s*$/, '')
      .replace(/^(?:city|town) of\s+/, '').replace(/\s+(?:city|town|cdp)$/, '').trim();
  }

  // ------------------------------------------------------------ pure

  // County CHAS row from either file shape: chas_co.json { records: [] } or
  // chas_affordability_gap.json { counties: { fips: row } }.
  function countyChasRecord(file, fips) {
    if (!file || !fips) return null;
    if (Array.isArray(file.records)) return file.records.find(function (r) { return r && r.fips === fips; }) || null;
    return (file.counties && file.counties[fips]) || null;
  }
  function placeChasRecord(fileOrRecord, geoid) {
    if (!fileOrRecord || !geoid) return null;
    var rec = fileOrRecord.places ? fileOrRecord.places[geoid] : fileOrRecord;
    return rec && rec.renter_hh_by_ami && rec.low_confidence !== true ? rec : null;
  }
  // [{ key, label, households, burdenedPct (0–100) }] for the bands MixCheck reads.
  function bandsFrom(rec) {
    var rba = rec && rec.renter_hh_by_ami;
    if (!rba) return [];
    return BANDS.map(function (b) {
      var row = rba[b[0]] || {};
      var total = num(row.total);
      var share = num(row.pct_cost_burdened_30);
      if (share === null && total) {
        var cb = num(row.cost_burdened_30pct);
        share = cb === null ? null : cb / total;
      }
      return { key: b[0], label: b[1], households: total, burdenedPct: share === null ? null : share * 100 };
    });
  }
  function limitsFor(file, fips) {
    var c = file && Array.isArray(file.counties) ? file.counties.find(function (x) { return x && x.fips === fips; }) : null;
    var out = {};
    if (c && c.regular_tiers) {
      TIERS.forEach(function (t) {
        var r = c.regular_tiers[t];
        var v = num(r && r.max_rents && r.max_rents['2br']);
        if (v !== null && v > 0) out[t] = v;
      });
    }
    return { limits: out, ruralResort: c ? !!c.rural_resort : null };
  }
  // Current rents a new unit competes with. ACS median gross rent includes long-held
  // cheap leases, so it is left out.
  function rentsFor(files, fips, placeName) {
    var out = [];
    var fmr = files.fmr && Array.isArray(files.fmr.counties) ? files.fmr.counties.find(function (c) { return c && c.fips === fips; }) : null;
    var f2 = num(fmr && fmr.fmr && fmr.fmr.two_br);
    if (f2 !== null && f2 > 0) out.push({ kind: 'fmr2br', label: 'HUD two-bedroom fair market rent', rent: f2 });
    var z = files.zori && files.zori.counties && files.zori.counties[fips];
    var zr = num(z && z.rent);
    if (zr !== null && zr > 0) out.push({ kind: 'zori', label: 'Zillow observed rent, ' + (z.name || 'county'), rent: zr });
    if (placeName && files.apartmentList && files.apartmentList.cities) {
      var key = norm(placeName);
      var al = files.apartmentList.cities[key];
      var a2 = num(al && al.rent_2br);
      if (al && norm(al.name) === key && a2 !== null && a2 > 0) out.push({ kind: 'apartmentList2br', label: 'Apartment List two-bedroom rent, ' + al.name, rent: a2 });
    }
    return out;
  }
  function mihtcFrom(guide) {
    var p = guide && Array.isArray(guide.programs) ? guide.programs.find(function (x) { return x && x.id === 'chfa-mihtc'; }) : null;
    return p ? { name: p.name, url: p.official_url || null } : null;
  }

  /**
   * build(files, { countyFips, placeGeoid?, placeName?, placeRecord? }, MixCheck)
   * files: { countyChas, placeChas, limits, rules, guide, fmr, zori, apartmentList }, any may be null.
   */
  function build(files, opts, MixCheck) {
    var f = files || {}, o = opts || {};
    var place = placeChasRecord(o.placeRecord || f.placeChas, o.placeGeoid);
    var county = countyChasRecord(f.countyChas, o.countyFips);
    var rec = place || county;
    var bands = bandsFrom(rec);
    var lim = limitsFor(f.limits, o.countyFips);
    var rents = rentsFor(f, o.countyFips, o.placeName);
    return {
      countyFips: o.countyFips || null,
      chasScope: place ? 'place' : county ? 'county' : null,
      chasName: place ? (place.name || o.placeName || null) : county ? (county.name || null) : null,
      chasVintage: (place ? ((f.placeChas || {}).meta || {}).vintage_chas : ((f.countyChas || {}).meta || {}).vintage) || null,
      bands: bands,
      burden: MixCheck ? MixCheck.burdenByBand(bands) : null,
      limits: lim.limits,
      ruralResort: lim.ruralResort,
      limitsYear: ((f.limits || {}).meta || {}).fiscal_year || null,
      rents: rents,
      rentRange: MixCheck ? MixCheck.rentRange(rents) : null,
      fmrYear: ((f.fmr || {}).meta || {}).fiscal_year || null,
      zoriMonth: ((f.zori || {}).meta || {}).vintage_month || null,
      mihtc: mihtcFrom(f.guide),
      rules: f.rules || null
    };
  }

  /**
   * check(MixCheck, inputs, { units?, gap50?, need20yr?, senior? }) → the need notes and the
   * 15-year pencil for these inputs, plus the sentences pages print.
   */
  function check(MixCheck, inputs, opts) {
    var i = inputs || {}, o = opts || {};
    var nn = MixCheck.needNotes({
      burden: i.burden, gap50: o.gap50 === undefined ? null : o.gap50,
      lim70: i.limits && i.limits['70'] !== undefined ? i.limits['70'] : null,
      lim80: i.limits && i.limits['80'] !== undefined ? i.limits['80'] : null,
      rentRange: i.rentRange, ruralResort: !!i.ruralResort, mihtc: i.mihtc,
      need20yr: o.need20yr === undefined ? null : o.need20yr
    });
    var p = MixCheck.pencil({ limits: i.limits || {}, units: o.units || null, rules: i.rules, senior: !!o.senior });
    return {
      notes: nn.notes,
      workforce: nn.workforce,
      pencil: p,
      mixSentence: o.units ? MixCheck.mixSentence(p) : null,
      tierLines: p.ok ? p.tiers.map(MixCheck.tierLine) : [],
      assumptions: p.ok ? MixCheck.assumptionsLine(p.assumptions) : null,
      reason: p.ok ? null : p.reason
    };
  }

  // One source line in plain words, naming every file a number on the block came from.
  function sourceLine(inputs) {
    var i = inputs || {}, parts = [];
    if (i.chasScope) parts.push('HUD CHAS ' + (i.chasVintage || '') + ' renter cost burden by income' + (i.chasScope === 'place' ? ' (place estimate)' : ' (county)'));
    if (i.limits && Object.keys(i.limits).length) parts.push('CHFA ' + (i.limitsYear || '') + ' income and rent limits');
    if (i.rules) parts.push('CHFA Qualified Allocation Plan underwriting minimums');
    (i.rents || []).forEach(function (r) {
      if (r.kind === 'fmr2br') parts.push('HUD fair market rent FY' + (i.fmrYear || ''));
      if (r.kind === 'zori') parts.push('Zillow Observed Rent Index' + (i.zoriMonth ? ' (' + i.zoriMonth.slice(0, 7) + ')' : ''));
      if (r.kind === 'apartmentList2br') parts.push('Apartment List rent report');
    });
    if (i.mihtc) parts.push('CHFA program page for the ' + i.mihtc.name);
    return parts.length ? 'Sources: ' + parts.join('; ') + '.' : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * renderHtml(result, inputs, { heading?, mixLead?, showTiers? }) → an HTML block.
   * Plain markup with the site's colour tokens so it sits in any card.
   */
  function renderHtml(result, inputs, opts) {
    var o = opts || {}, r = result || {};
    var muted = 'color:var(--muted,#555);';
    var h = '<div class="mix-check-block" style="margin-top:12px;font-size:1rem;line-height:1.5;overflow-wrap:anywhere;">';
    if (o.heading) h += '<h4 style="margin:0 0 6px;font-size:1rem;">' + esc(o.heading) + '</h4>';
    var burden = inputs && inputs.burden;
    if (burden && o.showBurden !== false) {
      h += '<p style="margin:0 0 6px;">Renters paying more than 30% of income, by income band: ' +
        Object.keys(burden).map(function (k) {
          var b = burden[k];
          return esc(b.label) + ' ' + Math.round(b.burdened).toLocaleString('en-US') + ' of ' + Math.round(b.households).toLocaleString('en-US') + ' (' + Math.round(b.pct) + '%)';
        }).join('; ') + '.</p>';
    }
    if (r.notes && r.notes.length) {
      h += '<ul style="margin:0 0 8px;padding-left:1.2em;">' + r.notes.map(function (n) { return '<li style="margin:.2rem 0;">' + esc(n) + '</li>'; }).join('') + '</ul>';
    }
    if (r.pencil && r.pencil.ok) {
      if (r.mixSentence) h += '<p style="margin:0 0 6px;">' + esc((o.mixLead ? o.mixLead + ' ' : '') + (r.mixSentence || '')) + '</p>';
      if (o.showTiers !== false && r.tierLines.length) {
        h += '<p style="margin:0 0 2px;">Each rent level on its own, per unit:</p><ul style="margin:0 0 6px;padding-left:1.2em;">' +
          r.tierLines.map(function (l) { return '<li style="margin:.15rem 0;">' + esc(l) + '</li>'; }).join('') + '</ul>';
      }
      h += '<p style="margin:0;font-size:.9rem;' + muted + '">' + esc(r.assumptions) + '</p>';
    } else if (r.reason) {
      h += '<p style="margin:0;' + muted + '">Whether the mix pays its way is not shown: ' + esc(r.reason) + '</p>';
    }
    var src = sourceLine(inputs);
    if (src) h += '<p style="margin:6px 0 0;font-size:.9rem;' + muted + '">' + esc(src) + '</p>';
    return h + '</div>';
  }

  // ------------------------------------------------------------ browser loading

  var cache = {};
  function defaultFetch(path) {
    var g = typeof window !== 'undefined' ? window : {};
    if (typeof g.safeFetchJSON === 'function') return g.safeFetchJSON(path);
    if (g.DataService && typeof g.DataService.getJSON === 'function') return g.DataService.getJSON(path);
    var url = typeof g.resolveAssetUrl === 'function' ? g.resolveAssetUrl(path) : path;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  /**
   * load({ have?: { key: alreadyLoadedJson }, keys?: [...], fetchJson? }) → Promise<files>.
   * Files the page already holds are reused; each missing file is fetched once per page
   * and a failed fetch gives null for that file, never a rejection.
   */
  function load(opts) {
    var o = opts || {}, have = o.have || {};
    var keys = o.keys || Object.keys(PATHS);
    var fetchJson = o.fetchJson || defaultFetch;
    var files = {};
    return Promise.all(keys.map(function (k) {
      if (have[k]) { files[k] = have[k]; return null; }
      if (!cache[k]) cache[k] = Promise.resolve().then(function () { return fetchJson(PATHS[k]); }).catch(function () { return null; });
      return cache[k].then(function (v) { files[k] = v || null; });
    })).then(function () { return files; });
  }

  return {
    PATHS: PATHS, TIERS: TIERS,
    countyChasRecord: countyChasRecord, placeChasRecord: placeChasRecord, bandsFrom: bandsFrom,
    limitsFor: limitsFor, rentsFor: rentsFor, mihtcFrom: mihtcFrom,
    build: build, check: check, sourceLine: sourceLine, renderHtml: renderHtml, load: load
  };
}));
