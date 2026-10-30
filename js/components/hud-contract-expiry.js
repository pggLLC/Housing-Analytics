/**
 * js/components/hud-contract-expiry.js
 * ====================================
 * "Federal rent subsidy contracts ending soon" on the Preservation page.
 *
 * Reads data/market/hud_s8_contracts_co.json, Colorado's rows from HUD's
 * Multifamily Assistance & Section 8 Contracts database
 * (scripts/hud/build_hud_s8_contracts.py), and fills #hudContracts with a
 * one-line count, a county and year filter, and a table that table-sort.js
 * sorts and table-header-tips.js explains.
 *
 * "Term ends" is the end of HUD's overall contract term. Owners can renew,
 * so the section calls it a date to watch, never a loss.
 */
(function (global) {
  'use strict';
  if (global.HudContractExpiry) return;

  var DATA = 'data/market/hud_s8_contracts_co.json';
  var YEARS_AHEAD = 5;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function num(n) { return Number(n || 0).toLocaleString('en-US'); }

  // HUD writes most names in capitals; show them in title case, keeping
  // roman numerals and anything with a digit as written.
  function niceName(s) {
    s = String(s || '');
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/[a-z0-9'.&-]+/g, function (w) {
      if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(w) || /\d/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  }

  // The last day of the window: Dec 31, YEARS_AHEAD years after HUD's date.
  function windowEnd(asOf, years) {
    var y = Number(String(asOf || '').slice(0, 4)) || new Date().getUTCFullYear();
    return (y + years) + '-12-31';
  }

  function pick(doc, county, until) {
    return (doc.contracts || []).filter(function (c) {
      return (!county || c.county_fips === county) && (!until || (c.term_ends && c.term_ends <= until));
    });
  }

  function summary(rows, until, countyName) {
    var homes = rows.reduce(function (s, c) { return s + (c.assisted_units || 0); }, 0);
    var where = countyName ? ' in ' + esc(countyName) + ' County' : ' in Colorado';
    var when = until ? ' end their current term by ' + esc(fmtDate(until)) : ' are listed';
    return '<strong>' + num(rows.length) + ' HUD rent subsidy contract' + (rows.length === 1 ? '' : 's') +
      '</strong>, covering <strong>' + num(homes) + ' homes</strong>' + where + ',' + when + '.';
  }

  // Property, date and homes come first so a phone shows them without scrolling sideways.
  function tableRows(rows) {
    if (!rows.length) return '<tr><td colspan="6">No contracts match these filters.</td></tr>';
    return rows.map(function (c) {
      var ended = /expired/i.test(c.status || '');
      return '<tr class="pres-row">' +
        '<td>' + esc(niceName(c.property_name)) + '</td>' +
        '<td>' + esc(fmtDate(c.term_ends)) + (ended ? ' <span class="hce-ended">(HUD lists it as expired)</span>' : '') + '</td>' +
        '<td class="num">' + esc(c.assisted_units === null ? '—' : num(c.assisted_units)) + '</td>' +
        '<td>' + esc(c.city) + '</td>' +
        '<td>' + esc(c.county_name) + '</td>' +
        '<td>' + esc(c.program) + '</td>' +
        '</tr>';
    }).join('');
  }

  function ensureStyles() {
    if (document.getElementById('hce-styles')) return;
    var st = document.createElement('style');
    st.id = 'hce-styles';
    st.textContent = [
      '#hudContracts .hce-controls { display:flex; flex-wrap:wrap; gap:var(--sp3, .75rem); margin:.5rem 0 .75rem; }',
      '#hudContracts .hce-ended { color:var(--warn); font-size:.86rem; }',
      '#hudContracts td.num { text-align:right; }',
      // 340 rows would make a phone page very long: the list scrolls in its own box.
      '#hudContracts .pres-table-wrap { max-height:32rem; overflow:auto; padding:0; }',
      '#hudContracts .pres-th { position:sticky; top:0; z-index:1; }',
      '#hudContracts td:first-child { min-width:9rem; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function render(mount, doc) {
    var m = doc.meta || {};
    var defaultUntil = windowEnd(m.as_of, YEARS_AHEAD);
    var counties = {};
    (doc.contracts || []).forEach(function (c) { if (c.county_fips) counties[c.county_fips] = c.county_name; });
    var countyOpts = Object.keys(counties).sort(function (a, b) { return counties[a].localeCompare(counties[b]); })
      .map(function (f) { return '<option value="' + esc(f) + '">' + esc(counties[f]) + ' County</option>'; }).join('');
    var y0 = Number(String(m.as_of || '').slice(0, 4)) || new Date().getUTCFullYear();
    var yearOpts = [1, 2, 5, 10].map(function (n) {
      var v = windowEnd(m.as_of, n);
      return '<option value="' + v + '"' + (n === YEARS_AHEAD ? ' selected' : '') + '>By the end of ' + (y0 + n) + '</option>';
    }).join('') + '<option value="">Any year</option>';

    ensureStyles();
    mount.innerHTML =
      '<h2 id="hudContractsHeading">Federal rent subsidy contracts ending soon</h2>' +
      '<p>HUD pays part of the rent in these properties under Section 8 and Section 202/811 contracts. ' +
      'When a contract\'s term ends, the owner can renew it or leave the program. An ending term is a date to watch, not a loss.</p>' +
      '<p id="hudContractsSummary" role="status">' + summary(pick(doc, '', defaultUntil), defaultUntil, '') + '</p>' +
      '<div class="hce-controls">' +
        '<label class="pres-filter-label">County <select id="hudContractsCounty" class="pres-select"><option value="">All counties</option>' + countyOpts + '</select></label>' +
        '<label class="pres-filter-label">Term ends <select id="hudContractsUntil" class="pres-select">' + yearOpts + '</select></label>' +
      '</div>' +
      '<div class="pres-table-wrap" role="region" aria-label="HUD rent subsidy contracts">' +
        '<table class="pres-table" id="hudContractsTable" aria-label="HUD rent subsidy contracts in Colorado">' +
          '<thead><tr>' +
            '<th scope="col" class="pres-th" title="Property name as HUD lists it.">Property</th>' +
            '<th scope="col" class="pres-th" title="End of the contract\'s overall term (HUD tracs_overall_expiration_date). Owners can renew.">Term ends</th>' +
            '<th scope="col" class="pres-th" title="Homes this contract pays rent on. A property can have more than one contract.">Assisted homes</th>' +
            '<th scope="col" class="pres-th" title="City in HUD\'s property address.">City</th>' +
            '<th scope="col" class="pres-th" title="County in HUD\'s property record.">County</th>' +
            '<th scope="col" class="pres-th" title="HUD program that pays the rent subsidy.">Program</th>' +
          '</tr></thead>' +
          '<tbody id="hudContractsBody">' + tableRows(pick(doc, '', defaultUntil)) + '</tbody>' +
        '</table>' +
      '</div>' +
      '<p class="pres-footnote">Source: <a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">HUD Multifamily Assistance &amp; Section 8 Contracts database</a>, ' +
      'current as of ' + esc(fmtDate(m.as_of)) + ', read ' + esc(fmtDate(m.fetched)) + '. ' +
      'It covers HUD project-based contracts only, not Housing Tax Credit, USDA or local restrictions. ' +
      'Owner and manager contacts are not copied here; HUD\'s file has them.</p>';

    var county = mount.querySelector('#hudContractsCounty');
    var until = mount.querySelector('#hudContractsUntil');
    function update() {
      var rows = pick(doc, county.value, until.value);
      mount.querySelector('#hudContractsSummary').innerHTML = summary(rows, until.value, county.value ? counties[county.value] : '');
      mount.querySelector('#hudContractsBody').innerHTML = tableRows(rows);
    }
    county.addEventListener('change', update);
    until.addEventListener('change', update);
  }

  function start() {
    var mount = document.getElementById('hudContracts');
    if (!mount) return;
    var url = global.resolveAssetUrl ? global.resolveAssetUrl(DATA) : DATA;
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error(DATA + ' returned ' + r.status);
      return r.json();
    }).then(function (doc) { render(mount, doc); }).catch(function () {
      mount.innerHTML = '<h2 id="hudContractsHeading">Federal rent subsidy contracts ending soon</h2>' +
        '<p>HUD\'s contract list didn\'t load. See <a href="https://www.hud.gov/hud-partners/multifamily-assist-section8-database" target="_blank" rel="noopener">HUD\'s Section 8 contracts database</a>.</p>';
    });
  }

  global.HudContractExpiry = { _pick: pick, _windowEnd: windowEnd, _niceName: niceName };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}(typeof window !== 'undefined' ? window : this));
