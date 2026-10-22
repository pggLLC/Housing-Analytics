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
 * The county comes from WorkflowState.getJurisdiction() (countyFips, 5 digits);
 * a town resolves to its containing county. Both mounts redraw when the
 * jurisdiction changes (workflow:step-updated / workflow:project-loaded).
 */
(function (global) {
  'use strict';
  if (global.PlaceDealsLimits) return;

  var DEALS_INDEX = 'data/deals/index.json';
  var LIMITS = 'data/chfa-income-rent-limits-2026.json';
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
      '.pdl-scroll { overflow-x:auto; margin:.4rem 0; }',
      '.pdl-table { border-collapse:collapse; width:100%; font-size:.85rem; font-variant-numeric:tabular-nums; }',
      '.pdl-scroll .pdl-table th, .pdl-scroll .pdl-table td { padding:.3rem .45rem; border-bottom:1px solid var(--border); text-align:right; white-space:nowrap !important; word-break:normal !important; overflow-wrap:normal !important; }',
      '.pdl-scroll .pdl-table th:first-child, .pdl-scroll .pdl-table td:first-child { text-align:left; }',
      '.pdl-fold { margin-top:.5rem; }',
      '.pdl-fold > summary { cursor:pointer; font-weight:600; color:var(--accent); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function currentCounty() {
    var j = null;
    try { j = global.WorkflowState && global.WorkflowState.getJurisdiction && global.WorkflowState.getJurisdiction(); } catch (_) {}
    if (!j) return null;
    var fips = j.countyFips || (j.geoType === 'county' ? j.geoid : null);
    if (!fips) return null;
    fips = String(fips);
    if (fips.length === 3) fips = '08' + fips;
    if (!/^08\d{3}$/.test(fips)) return null;
    var place = (j.geoType === 'place' || j.geoType === 'cdp') ? (j.displayName || j.name) : null;
    return { fips: fips, place: place };
  }

  // County name as CHFA's limits file prints it ("Mesa"), keyed by 5-digit FIPS.
  function countyName(limits, fips) {
    var row = (limits.counties || []).filter(function (c) { return c.fips === fips; })[0];
    return row ? row.county_name : null;
  }

  function amiRange(mix) {
    var levels = (mix || []).map(function (m) { return parseInt(m.level, 10); }).filter(function (n) { return n > 0; });
    if (!levels.length) return '';
    var lo = Math.min.apply(null, levels), hi = Math.max.apply(null, levels);
    return (lo === hi ? lo : lo + '–' + hi) + '% AMI';
  }

  // ── Awarded deals in this county ──────────────────────────────────────────
  function renderDeals(mount) {
    var c = currentCounty();
    if (!c) {
      mount.innerHTML = '<p class="pdl-note">Pick a county or town to see the tax credit deals awarded there.</p>';
      return;
    }
    Promise.all([fetchJson(DEALS_INDEX), fetchJson(LIMITS)]).then(function (res) {
      var name = countyName(res[1], c.fips);
      if (!name) { mount.innerHTML = ''; return; }
      var rows = (res[0].deals || []).filter(function (d) { return d.county === name; })
        .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.name).localeCompare(String(b.name)); });
      var allLink = 'deal-summary.html?county=' + encodeURIComponent(name);
      if (!rows.length) {
        var yrs = (res[0].deals || []).map(function (d) { return Number(d.year) || 0; }).filter(Boolean);
        var span = yrs.length ? ' (' + Math.min.apply(null, yrs) + '–' + Math.max.apply(null, yrs) + ')' : '';
        mount.innerHTML = '<p class="pdl-note">None of the ' + (res[0].deals || []).length + ' awards with a write-up so far' + span + ' is in ' +
          esc(name) + ' County. Every CHFA, OEDIT and DOLA award is listed on <a href="where-housing-money-goes.html">Where Colorado\'s Housing Money Goes</a>.</p>';
        return;
      }
      var shown = rows.slice(0, SHOW_DEALS);
      return Promise.all(shown.map(function (d) {
        return fetchJson('data/deals/' + d.slug + '.json').catch(function () { return null; });
      })).then(function (details) {
        var items = shown.map(function (d, i) {
          var full = details[i] || {};
          var bits = [d.city, d.award, d.units ? Number(d.units).toLocaleString('en-US') + ' homes' : null, amiRange(full.income_mix)].filter(Boolean);
          return '<li class="pdl-deal">' +
            '<a class="pdl-deal__name" href="deal-summary.html?d=' + esc(d.slug) + '">' + esc(d.name) + '</a>' +
            '<span class="pdl-deal__meta">' + esc(bits.join(' · ')) + '</span>' +
            (full.status && full.status.label ? '<span class="pdl-deal__status"><strong>Status:</strong> ' + esc(full.status.label) + '</span>' : '') +
            '</li>';
        }).join('');
        mount.innerHTML =
          '<p class="pdl-note"><strong>' + rows.length + '</strong> award' + (rows.length === 1 ? '' : 's') + ' in ' + esc(name) +
          ' County ha' + (rows.length === 1 ? 's' : 've') + ' a sourced write-up' + (c.place ? '. The list covers the whole county ' + esc(c.place) + ' is in' : '') + '.</p>' +
          '<ul class="pdl-list">' + items + '</ul>' +
          '<p class="pdl-note">' + (rows.length > SHOW_DEALS ? 'Showing the ' + SHOW_DEALS + ' newest. ' : '') +
          '<a href="' + esc(allLink) + '">All write-ups for ' + esc(name) + ' County</a>. Each write-up gives the income and bedroom mix, the public money, who is involved and what is still open, with sources. ' +
          'Total development cost is shown only where a public record prints it.</p>';
      });
    }).catch(function () {
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

  function renderLimits(mount) {
    var c = currentCounty();
    if (!c) {
      mount.innerHTML = '<p class="pdl-note">Pick a county or town to see CHFA\'s 2026 rent and income limits for it.</p>';
      return;
    }
    fetchJson(LIMITS).then(function (lim) {
      var m = lim.meta || {};
      var row = (lim.counties || []).filter(function (x) { return x.fips === c.fips; })[0];
      if (!row || !row.regular_tiers) { mount.innerHTML = ''; return; }
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
      mount.innerHTML =
        '<p class="pdl-note">Limits for ' + esc(row.county_name) + ' County' + (c.place ? ', which ' + esc(c.place) + ' uses' : '') +
        '. Effective ' + esc(date(m.effective_date)) + '; projects must use them by ' + esc(date(m.implementation_cutoff)) + '. Figures as CHFA prints them.</p>' +
        '<h3 style="margin:.6rem 0 .2rem;font-size:1rem">Maximum monthly rent</h3>' + rents +
        '<details class="pdl-fold"><summary>Income limits by household size</summary>' + incomes + '</details>' +
        (notes.length ? '<p class="pdl-note">' + notes.join(' ') + '</p>' : '') +
        '<p class="pdl-note">Source: <a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">' + esc(m.source || 'CHFA rent and income limits') + '</a>. ' +
        'Rents are gross rents, before any utility allowance. CHFA\'s published table is the binding reference for an application.</p>';
    }).catch(function () {
      mount.innerHTML = '<p class="pdl-note">The CHFA limits could not be loaded. Try reloading the page.</p>';
    });
  }

  function renderAll() {
    ensureStyles();
    Array.prototype.forEach.call(document.querySelectorAll('[data-place-deals]'), renderDeals);
    Array.prototype.forEach.call(document.querySelectorAll('[data-chfa-limits]'), renderLimits);
  }

  var lastKey = null;
  function onChange() {
    var c = currentCounty();
    var key = c ? c.fips + '|' + (c.place || '') : '';
    if (key === lastKey) return;
    lastKey = key;
    renderAll();
  }

  function start() {
    if (!document.querySelector('[data-place-deals], [data-chfa-limits]')) return;
    document.addEventListener('workflow:step-updated', onChange);
    document.addEventListener('workflow:project-loaded', onChange);
    onChange();
  }

  global.PlaceDealsLimits = { render: renderAll, _currentCounty: currentCounty, _amiRange: amiRange };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
