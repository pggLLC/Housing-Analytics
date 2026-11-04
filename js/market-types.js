/**
 * market-types.js — Market Types tab on colorado-deep-dive.html.
 *
 * Reads data/market/market-types.json (scripts/market/build_market_types.py, a
 * step of the derived chain): a type for every county, town and CDP from written
 * rules, the conditions that change its menu, the local funds already in place,
 * and a menu of Colorado programs and tools, each linked to its own source.
 * Type names, rules, menus and items are all read from the file's meta, so the
 * page cannot disagree with the build. Nothing here is a score.
 */
(function (global) {
  'use strict';

  var FILE = 'market/market-types.json';
  var COLORS = {
    resort: '#7c3aed', job_centre: '#1d4ed8', growing: '#047857',
    softening: '#b45309', steady: '#6b7280', too_little_data: '#d1d5db'
  };
  var STATUS = {
    authorized: '', authorized_with_voter_approval: 'Needs voter approval',
    unclear: 'Colorado authority unclear', prohibited_for_new: 'Not open to new adoption',
    required_for_subject_jurisdictions: 'Required in some places',
    // Funding availability, worded as on the developer funding guide.
    closed: 'Closed', ended: 'Ended', ending: 'Ending', watch: 'No round announced'
  };
  var started = false;
  var data = null;
  var filter = { type: '', county: '' };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dataUrl(key) {
    if (global.DataService && typeof global.DataService.baseData === 'function') return global.DataService.baseData(key);
    return 'data/' + key;
  }
  function safeUrl(u) { return String(u || '').indexOf('https:') === 0 ? u : ''; }
  function link(name, url) {
    var u = safeUrl(url);
    return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(name) + '</a>' : esc(name);
  }
  function typeLabel(t) { return (data.meta.types[t] || {}).label || t; }
  function pill(t) {
    return '<span class="mt-pill" style="--mt:' + (COLORS[t] || '#9ca3af') + '">' + esc(typeLabel(t)) + '</span>';
  }

  function rows() {
    return Object.keys(data.places).map(function (g) { var p = data.places[g]; p.geoid = g; return p; });
  }

  function renderTiles() {
    var m = data.meta;
    var html = m.order.map(function (t) {
      var c = m.counts[t] || {};
      var towns = (c.town || 0);
      var on = filter.type === t ? ' aria-pressed="true"' : ' aria-pressed="false"';
      return '<button type="button" class="mt-tile" data-type="' + esc(t) + '"' + on + ' style="--mt:' + COLORS[t] + '">'
        + '<span class="mt-tile-top"><span class="mt-tile-n">' + towns + '</span> towns</span>'
        + '<span class="mt-tile-l">' + esc(m.types[t].label) + '</span>'
        + '<span class="mt-tile-p">' + esc(m.types[t].plain) + '</span>'
        + '<span class="mt-tile-c">' + (c.county || 0) + ' counties</span></button>';
    }).join('');
    el('mtTiles').innerHTML = html;
    Array.prototype.forEach.call(el('mtTiles').querySelectorAll('.mt-tile'), function (b) {
      b.addEventListener('click', function () {
        filter.type = filter.type === b.getAttribute('data-type') ? '' : b.getAttribute('data-type');
        el('mtType').value = filter.type;
        renderTiles();
        renderTable();
      });
    });
  }

  function itemHtml(entry) {
    var it = data.meta.items[entry.item];
    if (!it) return '';
    var st = STATUS[it.status];
    return '<li><strong>' + link(it.name, it.url) + '</strong>'
      + (st ? ' <span class="mt-flag" title="' + esc(it.status_reason || '') + '">' + esc(st) + '</span>' : '')
      + '<span class="mt-why">' + esc(entry.why) + '</span></li>';
  }

  function renderPlace(geoid) {
    var p = data.places[geoid];
    var box = el('mtPlace');
    if (!p) { box.innerHTML = '<p class="data-note">Pick a county or town above to see its market pattern and the options that tend to fit.</p>'; return; }
    var m = data.meta;
    var shown = p;
    var lean = '';
    if (p.type === 'too_little_data' && p.county_fips && data.places[p.county_fips]) {
      shown = data.places[p.county_fips];
      lean = '<p class="data-note">Public data is too thin to set a pattern for ' + esc(p.name) + ', so this uses ' + esc(shown.name) + '’s pattern.</p>';
    }
    var t = shown.type;
    var stab = shown.stability >= 0.8 ? '' :
      '<p class="mt-caution">Near the line: under seasonal-share uncertainty this pattern holds in ' + Math.round(shown.stability * 100) + '% of redraws of the ACS seasonal share. The other readings are not redrawn.</p>';
    var near = shown.near_line && shown.near_line.length ? '<p class="data-note">Close to a rule threshold on ' + esc(shown.near_line.join(' and ')) + '.</p>' : '';
    var mods = (p.modifiers || []).map(function (k) {
      var mm = m.modifiers[k];
      return mm ? '<span class="mt-chip" title="' + esc(mm.rule) + '">' + esc(mm.label) + '</span>' : '';
    }).join('');
    var menu = (m.menus[t] || []).map(itemHtml).join('');
    (p.modifiers || []).forEach(function (k) {
      var mm = m.modifiers[k];
      if (mm && mm.items.length) menu += '<li class="mt-sub">' + esc(mm.label) + '</li>' + mm.items.map(itemHtml).join('');
    });
    var here = (p.here_now || []).map(function (h) {
      return '<li>' + link(h.name, h.url) + ' <span class="mt-kind">' + esc(h.kind) + '</span></li>';
    }).join('');
    box.innerHTML = '<div class="mt-card" style="--mt:' + COLORS[t] + '">'
      + '<h3 class="mt-name">' + esc(p.name) + (p.county ? ' <span class="mt-county">' + esc(p.county) + '</span>' : '') + '</h3>'
      + '<p>' + pill(t) + ' ' + esc(shown.basis) + '</p>' + lean + stab + near
      + '<p class="mt-plain">' + esc(m.types[t].plain) + '</p>'
      + (mods ? '<p class="mt-chips">' + mods + '</p>' : '')
      + '<div class="mt-cols"><div><h4>Options that tend to fit</h4><ul class="mt-menu">' + (menu || '<li>No menu for this pattern.</li>') + '</ul></div>'
      + '<div><h4>Already here</h4><ul class="mt-here">' + (here || '<li>No local housing fund or housing authority program in our records.</li>') + '</ul></div></div>'
      + '</div>';
  }

  function renderTable() {
    var list = rows().filter(function (p) {
      if (p.level !== 'town') return false;
      if (filter.type && p.type !== filter.type) return false;
      if (filter.county && p.county_fips !== filter.county) return false;
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    el('mtTownCount').textContent = list.length + ' towns';
    el('mtTownBody').innerHTML = list.length ? list.map(function (p) {
      var mods = (p.modifiers || []).map(function (k) { return data.meta.modifiers[k] ? data.meta.modifiers[k].label : k; }).join(', ');
      return '<tr><th scope="row"><button type="button" class="mt-link" data-geoid="' + esc(p.geoid) + '">' + esc(p.name.replace(/ \((city|town)\)$/, '')) + '</button></th>'
        + '<td>' + pill(p.type) + '</td><td>' + esc(p.basis) + (p.stability < 0.8 ? ' <span class="mt-flag">near the line</span>' : '') + '</td>'
        + '<td>' + esc(mods || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="4">No towns match.</td></tr>';
    Array.prototype.forEach.call(el('mtTownBody').querySelectorAll('.mt-link'), function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-geoid');
        el('mtPick').value = g;
        renderPlace(g);
        el('mtPlace').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  // Only the types that have a town in the chosen county, so no pick leads to an empty table.
  function fillTypes() {
    var present = {};
    rows().forEach(function (p) {
      if (p.level === 'town' && (!filter.county || p.county_fips === filter.county)) present[p.type] = true;
    });
    if (filter.type && !present[filter.type]) filter.type = '';
    el('mtType').innerHTML = '<option value="">Every pattern</option>' + data.meta.order.filter(function (t) { return present[t]; }).map(function (t) {
      return '<option value="' + t + '">' + esc(typeLabel(t)) + '</option>';
    }).join('');
    el('mtType').value = filter.type;
  }

  function fillSelects() {
    var all = rows();
    var groups = [['county', 'Counties'], ['town', 'Towns'], ['cdp', 'Census-designated places']];
    el('mtPick').innerHTML = '<option value="">Pick a county or town</option>' + groups.map(function (g) {
      return '<optgroup label="' + g[1] + '">' + all.filter(function (p) { return p.level === g[0]; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (p) { return '<option value="' + esc(p.geoid) + '">' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    el('mtCounty').innerHTML = '<option value="">All counties</option>' + all.filter(function (p) { return p.level === 'county'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (p) { return '<option value="' + esc(p.geoid) + '">' + esc(p.name) + '</option>'; }).join('');
    fillTypes();
    el('mtPick').addEventListener('change', function () { renderPlace(this.value); });
    el('mtCounty').addEventListener('change', function () { filter.county = this.value; fillTypes(); renderTiles(); renderTable(); });
    el('mtType').addEventListener('change', function () { filter.type = this.value; renderTiles(); renderTable(); });
  }

  function renderMethod() {
    var m = data.meta;
    el('mtRules').innerHTML = m.order.map(function (t) {
      return '<li>' + pill(t) + ' ' + esc(m.types[t].rule) + '</li>';
    }).join('') + Object.keys(m.modifiers).map(function (k) {
      return '<li><strong>' + esc(m.modifiers[k].label) + ':</strong> ' + esc(m.modifiers[k].rule) + ' Adds to the menu; does not change the pattern.</li>';
    }).join('');
    var v = m.validation;
    el('mtChecks').innerHTML =
      '<li><strong>Stability under seasonal-share uncertainty: ' + Math.round(v.stable_80_share * 100) + '% of places keep their pattern in at least 80% of redraws.</strong> ' + esc(v.stability) + '</li>'
      + '<li><strong>Cluster check: ' + v.cluster_check.adjusted_rand.toFixed(2) + '.</strong> ' + esc(v.cluster_check.reading)
      + ' Groups found by ' + esc(v.cluster_check.method) + ' (' + v.cluster_check.places + ' places) only partly match the written patterns, which is why the patterns are rules you can read rather than clusters.</li>';
    el('mtLimits').innerHTML = m.limits.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('')
      + '<li>' + esc(m.menu_note) + '</li>';
    el('mtSources').innerHTML = m.sources.map(function (s) { return '<li><code>' + esc(s) + '</code></li>'; }).join('');
  }

  function render() {
    var m = data.meta;
    var towns = rows().filter(function (p) { return p.level === 'town' && p.type !== 'too_little_data'; }).length;
    el('mtSummary').textContent = towns + ' Colorado towns and all 64 counties sorted into five COHO market patterns by written rules, each with the Colorado programs and local tools that tend to fit it.';
    el('mtGenerated').textContent = m.generated_at ? 'Built from the market calls of ' + m.generated_at.slice(0, 10) + '.' : '';
    fillSelects();
    renderTiles();
    renderPlace('');
    renderTable();
    renderMethod();
  }

  function init() {
    if (started) return;
    started = true;
    fetch(dataUrl(FILE)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) { data = d; render(); }).catch(function (e) {
      started = false;
      el('mtSummary').textContent = 'The market patterns file could not be loaded (' + e.message + ').';
    });
  }

  global.MarketTypes = { init: init, _colors: COLORS };

  // Opened straight onto the tab (#tab-types): the tab script has already revealed it.
  document.addEventListener('DOMContentLoaded', function () {
    var panel = el('tab-types');
    if (panel && !panel.hidden) init();
  });
})(typeof window !== 'undefined' ? window : globalThis);
