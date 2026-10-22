/**
 * js/components/place-deals-limits.js
 * ===================================
 * Two county lookups for the Housing Needs Assessment pages, drawn from data
 * the site already publishes elsewhere:
 *
 *   [data-place-deals]   Awarded tax credit deals in the picked county that have
 *                        a sourced write-up (data/deals/index.json + each record),
 *                        newest first, each linking to its deal-summary.html page.
 *   [data-chfa-limits]   CHFA's 2026 maximum rents and income limits for the
 *                        picked county (data/chfa-income-rent-limits-2026.json),
 *                        as CHFA prints them.
 *
 * Which geography: on an HNA page, the one the report is showing
 * (HNAState.state.current, announced by hna-controller.js as
 * `hna:geography-changed`), because a link can open a geography other than the
 * saved workflow jurisdiction and combined views never save one. Elsewhere,
 * WorkflowState.getJurisdiction(). A town resolves to its county; a town that
 * spans counties (data/hna/cross-county-places.json) resolves to all of them.
 */
(function (global) {
  'use strict';
  if (global.PlaceDealsLimits) return;

  var DEALS_INDEX = 'data/deals/index.json';
  var LIMITS = 'data/chfa-income-rent-limits-2026.json';
  var CROSS_COUNTY = 'data/hna/cross-county-places.json';
  var SHOW_DEALS = 5;
  var cache = {};

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fetchJson(url) {
    if (cache[url]) return cache[url];
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    cache[url] = fetch(resolved).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.json();
    });
    cache[url].catch(function () { delete cache[url]; });
    return cache[url];
  }

  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  function ensureStyles() {
    if (document.getElementById('pdl-styles')) return;
    var st = document.createElement('style');
    st.id = 'pdl-styles';
    st.textContent = [
      '.pdl-list { list-style:none; padding:0; margin:.4rem 0; display:grid; gap:.45rem; }',
      '.pdl-deal { border:1px solid var(--border); border-radius:6px; padding:.55rem .7rem; background:var(--card2, var(--bg2)); display:grid; gap:.15rem; }',
      '.pdl-deal__name { font-weight:700; }',
      '.pdl-deal__meta { color:var(--muted); font-size:.9rem; }',
      '.pdl-deal__status { font-size:.9rem; }',
      '.pdl-note { color:var(--muted); font-size:.9rem; margin:.35rem 0 0; }',
      '.pdl-pick { display:flex; flex-wrap:wrap; align-items:center; gap:.4rem; margin:.5rem 0 0; font-weight:600; font-size:.9rem; }',
      '.pdl-pick select { min-height:44px; font:inherit; font-weight:400; padding:4px 8px; border:1px solid var(--border-strong); border-radius:6px; background:var(--card); color:var(--text); }',
      '.pdl-scroll { overflow-x:auto; margin:.4rem 0; }',
      '.pdl-table { border-collapse:collapse; width:100%; font-size:.85rem; font-variant-numeric:tabular-nums; }',
      '.pdl-scroll .pdl-table th, .pdl-scroll .pdl-table td { padding:.3rem .45rem; border-bottom:1px solid var(--border); text-align:right; white-space:nowrap !important; word-break:normal !important; overflow-wrap:normal !important; }',
      '.pdl-scroll .pdl-table th:first-child, .pdl-scroll .pdl-table td:first-child { text-align:left; }',
      '.pdl-fold { margin-top:.5rem; }',
      '.pdl-fold > summary { cursor:pointer; font-weight:600; color:var(--accent); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function fips5(f) {
    if (f === null || f === undefined || f === '') return null;
    f = String(f);
    if (f.length === 3) f = '08' + f;
    return /^08\d{3}$/.test(f) ? f : null;
  }

  // What the page is showing:
  //   { kind: 'loading' }                     HNA has not picked a geography yet
  //   { kind: 'none' }                        statewide, or nothing picked
  //   { kind: 'area', label }                 a combined or regional view (several places)
  //   { kind: 'county'|'place', fips, place, placeGeoid }
  function context() {
    var hna = global.HNAState;
    if (hna && hna.state) {
      var cur = hna.state.current;
      if (!cur) return { kind: 'loading' };
      if (cur.geoType === 'combined' || cur.geoType === 'regional-comparison') return { kind: 'area', label: cur.label || '' };
      if (cur.geoType === 'county') {
        var cf = fips5(cur.geoid);
        return cf ? { kind: 'county', fips: cf, place: null, placeGeoid: null } : { kind: 'none' };
      }
      if (cur.geoType === 'place' || cur.geoType === 'cdp') {
        var pf = fips5(cur.contextCounty);
        return pf ? { kind: 'place', fips: pf, place: cur.label || null, placeGeoid: String(cur.geoid) } : { kind: 'none' };
      }
      return { kind: 'none' };
    }
    var j = null;
    try { j = global.WorkflowState && global.WorkflowState.getJurisdiction && global.WorkflowState.getJurisdiction(); } catch (_) {}
    if (!j) return { kind: 'none' };
    var fips = fips5(j.countyFips || (j.geoType === 'county' ? j.geoid : null));
    if (!fips) return { kind: 'none' };
    var isPlace = j.geoType === 'place' || j.geoType === 'cdp';
    return {
      kind: isPlace ? 'place' : 'county',
      fips: fips,
      place: isPlace ? (j.displayName || j.name || null) : null,
      placeGeoid: isPlace ? (String(j.placeGeoid || j.geoid || '') || null) : null
    };
  }

  // Every county the picked geography sits in, primary first.
  function countiesFor(ctx) {
    if (!ctx.placeGeoid) return Promise.resolve([ctx.fips]);
    return fetchJson(CROSS_COUNTY).then(function (reg) {
      var row = reg && reg.places && reg.places[ctx.placeGeoid];
      if (!row || !row.all_counties || row.all_counties.length < 2) return [ctx.fips];
      var list = row.all_counties.map(function (c) { return fips5(c.fips); }).filter(Boolean);
      var primary = fips5(row.primary_county) || ctx.fips;
      return [primary].concat(list.filter(function (f) { return f !== primary; }));
    }).catch(function () { return [ctx.fips]; });
  }

  // County names as CHFA's limits file prints them ("Mesa"), keyed by 5-digit FIPS.
  function nameOf(limits, fips) {
    var row = (limits.counties || []).filter(function (c) { return c.fips === fips; })[0];
    return row ? row.county_name : null;
  }

  function joinNames(names) {
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function amiRange(mix) {
    var levels = (mix || []).map(function (m) { return parseInt(m.level, 10); }).filter(function (n) { return n > 0; });
    if (!levels.length) return '';
    var lo = Math.min.apply(null, levels), hi = Math.max.apply(null, levels);
    return (lo === hi ? lo : lo + '–' + hi) + '% AMI';
  }

  // The message for a page with no single county to show: null while the HNA is still
  // loading (keep the placeholder), '' when there is a county.
  function noCounty(ctx, what) {
    if (ctx.kind === 'loading') return null;
    if (ctx.kind === 'area') return '<p class="pdl-note">This view combines several places, so it has no single county. Pick one county or town to see ' + what + '.</p>';
    if (ctx.kind === 'none') return '<p class="pdl-note">Pick a county or town to see ' + what + '.</p>';
    return '';
  }

  // Each render stamps its mount; a slower earlier render (the user changed county while its
  // files were loading) checks the stamp and drops its result instead of overwriting the newer one.
  var seq = 0;
  function stamp(mount) { mount.setAttribute('data-pdl-seq', String(++seq)); return String(seq); }
  function current(mount, id) { return mount.getAttribute('data-pdl-seq') === id; }

  // ── Awarded deals in this county ──────────────────────────────────────────
  function renderDeals(mount, ctx) {
    var id = stamp(mount);
    ctx = ctx || context();
    var msg = noCounty(ctx, 'the tax credit deals awarded there');
    if (msg !== '') { if (msg) mount.innerHTML = msg; return; }
    Promise.all([fetchJson(DEALS_INDEX), fetchJson(LIMITS), countiesFor(ctx)]).then(function (res) {
      if (!current(mount, id)) return;
      var all = res[0].deals || [];
      var names = res[2].map(function (f) { return nameOf(res[1], f); }).filter(Boolean);
      if (!names.length) { mount.innerHTML = ''; return; }
      var multi = names.length > 1;
      var rows = all.filter(function (d) { return names.indexOf(d.county) !== -1; })
        .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.name).localeCompare(String(b.name)); });
      var where = joinNames(names) + (multi ? ' counties' : ' County');
      var spans = multi && ctx.place ? esc(ctx.place) + ' spans ' + esc(where) + ', so write-ups from each are listed. ' : '';
      var links = names.map(function (n) {
        return '<a href="deal-summary.html?county=' + encodeURIComponent(n) + '">All write-ups for ' + esc(n) + ' County</a>';
      }).join(' · ');
      if (!rows.length) {
        var yrs = all.map(function (d) { return Number(d.year) || 0; }).filter(Boolean);
        var span = yrs.length ? ' (' + Math.min.apply(null, yrs) + '–' + Math.max.apply(null, yrs) + ')' : '';
        mount.innerHTML = '<p class="pdl-note">' + spans + 'None of the ' + all.length + ' awards with a write-up so far' + span + ' is in ' +
          esc(where) + '. Every CHFA, OEDIT and DOLA award is listed on <a href="where-housing-money-goes.html">Where Colorado\'s Housing Money Goes</a>.</p>';
        return;
      }
      var shown = rows.slice(0, SHOW_DEALS);
      return Promise.all(shown.map(function (d) {
        return fetchJson('data/deals/' + d.slug + '.json').catch(function () { return null; });
      })).then(function (details) {
        if (!current(mount, id)) return;
        var items = shown.map(function (d, i) {
          var full = details[i] || {};
          var bits = [d.city, multi ? d.county + ' County' : null, d.award, d.units ? Number(d.units).toLocaleString('en-US') + ' homes' : null, amiRange(full.income_mix)].filter(Boolean);
          return '<li class="pdl-deal">' +
            '<a class="pdl-deal__name" href="deal-summary.html?d=' + esc(d.slug) + '">' + esc(d.name) + '</a>' +
            '<span class="pdl-deal__meta">' + esc(bits.join(' · ')) + '</span>' +
            (full.status && full.status.label ? '<span class="pdl-deal__status"><strong>Status:</strong> ' + esc(full.status.label) + '</span>' : '') +
            '</li>';
        }).join('');
        mount.innerHTML =
          '<p class="pdl-note">' + spans + '<strong>' + rows.length + '</strong> award' + (rows.length === 1 ? '' : 's') + ' in ' + esc(where) +
          ' ha' + (rows.length === 1 ? 's' : 've') + ' a sourced write-up' +
          (ctx.place && !multi ? '. The list covers the whole county ' + esc(ctx.place) + ' is in' : '') + '.</p>' +
          '<ul class="pdl-list">' + items + '</ul>' +
          '<p class="pdl-note">' + (rows.length > SHOW_DEALS ? 'Showing the ' + SHOW_DEALS + ' newest. ' : '') + links +
          '. Each write-up gives the income and bedroom mix, the public money, who is involved and what is still open, with sources. ' +
          'Total development cost is shown only where a public record prints it.</p>';
      });
    }).catch(function () {
      if (!current(mount, id)) return;
      mount.innerHTML = '<p class="pdl-note">The deal write-ups could not be loaded. Try reloading the page.</p>';
    });
  }

  // ── CHFA 2026 rent and income limits ──────────────────────────────────────
  function tierTable(tiers, cols, colLabel, colTip, pick, caption) {
    var keys = Object.keys(tiers).sort(function (a, b) { return Number(a) - Number(b); });
    return '<div class="pdl-scroll"><table class="pdl-table"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>' +
      '<th scope="col" data-tip="Income limit tier, as a share of area median income (AMI)">AMI</th>' +
      cols.map(function (k) { return '<th scope="col" data-tip="' + esc(colTip(k)) + '">' + esc(colLabel(k)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      keys.map(function (t) {
        var vals = pick(tiers[t]) || {};
        return '<tr><td>' + esc(t) + '%</td>' + cols.map(function (k) {
          return '<td>' + (vals[k] ? money(vals[k]) : '—') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function limitsBody(m, row, ctx, multi) {
    var brLabel = { '0br': 'Studio', '1br': '1 BR', '2br': '2 BR', '3br': '3 BR', '4br': '4 BR' };
    var rents = tierTable(row.regular_tiers, m.bedrooms || ['0br', '1br', '2br', '3br', '4br'],
      function (k) { return brLabel[k] || k; },
      function (k) { return 'Maximum monthly rent, including utilities, for a ' + (brLabel[k] || k) + ' home'; },
      function (t) { return t.max_rents; }, 'Maximum monthly rent by bedroom size');
    var sizes = ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p'];
    var incomes = tierTable(row.regular_tiers, sizes,
      function (k) { return k.replace('p', '') + ' pers.'; },
      function (k) { return 'Maximum annual household income for ' + k.replace('p', '') + (k === '1p' ? ' person' : ' people'); },
      function (t) { return t.income_limits; }, 'Maximum annual income by household size');
    var date = function (s) {
      var d = new Date(String(s) + 'T00:00:00');
      return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };
    var notes = [];
    if (row.rural_resort) notes.push(esc(row.county_name) + ' is one of the rural resort counties where CHFA also prints tiers above 120% AMI, so the table runs to ' +
      Math.max.apply(null, Object.keys(row.regular_tiers).map(Number)) + '%.');
    if (row.hera_special) notes.push('This county also has HERA Special limits, which apply only to tax credit projects placed in service by December 31, 2008. They are in CHFA\'s PDF and are not shown here.');
    return '<p class="pdl-note">Limits for ' + esc(row.county_name) + ' County' + (ctx.place && !multi ? ', which ' + esc(ctx.place) + ' uses' : '') +
      '. Effective ' + esc(date(m.effective_date)) + '; projects must use them by ' + esc(date(m.implementation_cutoff)) + '. Figures as CHFA prints them.</p>' +
      '<h3 style="margin:.6rem 0 .2rem;font-size:1rem">Maximum monthly rent</h3>' + rents +
      '<details class="pdl-fold"><summary>Income limits by household size</summary>' + incomes + '</details>' +
      (notes.length ? '<p class="pdl-note">' + notes.join(' ') + '</p>' : '') +
      '<p class="pdl-note">Source: <a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">' + esc(m.source || 'CHFA rent and income limits') + '</a>. ' +
      'Rents are gross rents, before any utility allowance. CHFA\'s published table is the binding reference for an application.</p>';
  }

  function renderLimits(mount, ctx) {
    var id = stamp(mount);
    ctx = ctx || context();
    var msg = noCounty(ctx, 'CHFA\'s 2026 rent and income limits for it');
    if (msg !== '') { if (msg) mount.innerHTML = msg; return; }
    Promise.all([fetchJson(LIMITS), countiesFor(ctx)]).then(function (res) {
      if (!current(mount, id)) return;
      var lim = res[0], m = lim.meta || {};
      var rows = res[1].map(function (f) { return (lim.counties || []).filter(function (x) { return x.fips === f && x.regular_tiers; })[0]; }).filter(Boolean);
      if (!rows.length) { mount.innerHTML = ''; return; }
      if (rows.length === 1) { mount.innerHTML = limitsBody(m, rows[0], ctx, false); return; }
      // A town in more than one county: its limits depend on which county the site is in.
      var selId = 'pdlCounty' + id;
      mount.innerHTML =
        '<p class="pdl-note">' + esc(ctx.place || 'This place') + ' spans ' + esc(joinNames(rows.map(function (r) { return r.county_name; }))) +
        ' counties, and each county has its own limits. Use the county your site is in.</p>' +
        '<label class="pdl-pick" for="' + selId + '">County <select id="' + selId + '">' +
        rows.map(function (r, i) { return '<option value="' + i + '">' + esc(r.county_name) + ' County' + (i === 0 ? ' (most residents)' : '') + '</option>'; }).join('') +
        '</select></label><div data-pdl-body></div>';
      var body = mount.querySelector('[data-pdl-body]');
      var sel = mount.querySelector('select');
      var draw = function () { body.innerHTML = limitsBody(m, rows[Number(sel.value) || 0], ctx, true); };
      sel.addEventListener('change', draw);
      draw();
    }).catch(function () {
      if (!current(mount, id)) return;
      mount.innerHTML = '<p class="pdl-note">The CHFA limits could not be loaded. Try reloading the page.</p>';
    });
  }

  function renderAll() {
    ensureStyles();
    var ctx = context();
    Array.prototype.forEach.call(document.querySelectorAll('[data-place-deals]'), function (el) { renderDeals(el, ctx); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-chfa-limits]'), function (el) { renderLimits(el, ctx); });
  }

  var lastKey = null;
  function onChange() {
    var c = context();
    var key = [c.kind, c.fips || '', c.placeGeoid || '', c.label || ''].join('|');
    if (key === lastKey) return;
    lastKey = key;
    renderAll();
  }

  function start() {
    if (!document.querySelector('[data-place-deals], [data-chfa-limits]')) return;
    document.addEventListener('hna:geography-changed', onChange);
    document.addEventListener('workflow:step-updated', onChange);
    document.addEventListener('workflow:project-loaded', onChange);
    onChange();
  }

  global.PlaceDealsLimits = {
    render: renderAll,
    _context: context,
    _countiesFor: countiesFor,
    _amiRange: amiRange,
    _renderDeals: renderDeals,
    _renderLimits: renderLimits
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
