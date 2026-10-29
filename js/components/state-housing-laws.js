/**
 * js/components/state-housing-laws.js
 * ====================================
 * "State housing laws that apply here" for the Housing Needs Assessment pages.
 *
 * Reads data/policy/state-housing-laws.json, a copy of DOLA's Multilaw
 * Applicability sheet keyed by GEOID (scripts/policy/build_state_housing_laws.py),
 * and fills every [data-state-laws] mount. It leads with SB24-174, the law that
 * makes counties and towns send DOLA a housing needs assessment by
 * December 31, 2026, then lists every law in DOLA's own words.
 *
 * Which geography: the one the report shows (HNAState.state.current, announced
 * as `hna:geography-changed`), as in place-deals-limits.js. A CDP is
 * unincorporated, so its county's obligations apply. Statewide and combined
 * views get a one-line pointer instead of a list.
 *
 * COHO doesn't decide compliance. The card says so and links DOLA.
 */
(function (global) {
  'use strict';
  if (global.StateHousingLaws) return;

  var DATA = 'data/policy/state-housing-laws.json';
  var DOLA_PAGE = 'https://dlg.colorado.gov/housing-plans';
  var promise = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function load() {
    if (promise) return promise;
    var url = global.resolveAssetUrl ? global.resolveAssetUrl(DATA) : DATA;
    promise = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(DATA + ' returned ' + r.status);
      return r.json();
    });
    promise.catch(function () { promise = null; });
    return promise;
  }

  function longDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function fips5(f) {
    if (f === null || f === undefined || f === '') return null;
    f = String(f);
    if (f.length === 3) f = '08' + f;
    return /^08\d{3}$/.test(f) ? f : null;
  }

  function isCdp(hna, cur) {
    if (/\(CDP\)\s*$/i.test(cur.label || '')) return true;
    var sel = hna.els && hna.els.geoSelect;
    var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    return !!(opt && opt.value === String(cur.geoid) && opt.getAttribute('data-subtype') === 'cdp');
  }

  // { kind: 'loading' | 'none' | 'area' } or { kind: 'geo', geoid, label, viaCounty }
  function context() {
    var hna = global.HNAState;
    var cur = hna && hna.state ? hna.state.current : null;
    if (!hna || !hna.state) return { kind: 'none' };
    if (!cur) return { kind: 'loading' };
    if (cur.geoType === 'combined' || cur.geoType === 'regional-comparison') return { kind: 'area' };
    if (cur.geoType === 'county') {
      var cf = fips5(cur.geoid);
      return cf ? { kind: 'geo', geoid: cf, label: cur.label || '' } : { kind: 'none' };
    }
    // The place selector lists CDPs too and stores them as geoType 'place';
    // the option's data-subtype (or the "(CDP)" label) says which they are,
    // as hna-controller.js reads it.
    if (cur.geoType === 'place' && !isCdp(hna, cur)) return { kind: 'geo', geoid: String(cur.geoid), label: cur.label || '', county: fips5(cur.contextCounty) };
    if (cur.geoType === 'cdp' || cur.geoType === 'place') {
      var c = fips5(cur.contextCounty);
      return c ? { kind: 'geo', geoid: String(cur.geoid), label: cur.label || '', county: c, cdp: true } : { kind: 'none' };
    }
    return { kind: 'none' };
  }

  function isRequired(status) { return /^required/i.test(status || ''); }

  function badge(status) {
    var cls = isRequired(status) ? 'shl-req' : /^conditional/i.test(status || '') ? 'shl-cond' : 'shl-ex';
    return '<span class="shl-badge ' + cls + '">' + esc(status || 'Not listed') + '</span>';
  }

  function ensureStyles() {
    if (document.getElementById('shl-styles')) return;
    var st = document.createElement('style');
    st.id = 'shl-styles';
    st.textContent = [
      '.shl-card { border:1px solid var(--border); border-left:4px solid var(--accent); border-radius:6px; padding:.65rem .8rem; margin:.4rem 0 .75rem; background:var(--card2, var(--bg2)); }',
      '.shl-card h3 { margin:0 0 .35rem; font-size:1rem; }',
      '.shl-card p { margin:.25rem 0; line-height:1.5; font-size:.94rem; }',
      '.shl-badge { display:inline-block; font-size:.82rem; font-weight:600; padding:1px 7px; border-radius:10px; border:1px solid var(--border-strong); }',
      '.shl-req { background:var(--accent); color:var(--on-accent, #fff); border-color:var(--accent); }',
      '.shl-list { list-style:none; padding:0; margin:.45rem 0 0; display:grid; gap:.45rem; }',
      '.shl-list li { border-top:1px solid var(--border); padding-top:.4rem; }',
      '.shl-list .shl-name { font-weight:700; }',
      '.shl-note { color:var(--muted); font-size:.86rem; }',
      '.shl-card details > summary { cursor:pointer; font-weight:600; color:var(--accent); min-height:44px; display:flex; align-items:center; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function hnaLine(row, law, src) {
    var status = row.laws[law.id];
    var head = '<p><strong>Housing needs assessment (SB24-174):</strong> ' + badge(status) + '</p>';
    if (!isRequired(status)) return head;
    var approved = row.hna_approved || [];
    var asOf = src && (src.rechecked || src.as_of);
    var tail = approved.length
      ? 'DOLA lists ' + approved.map(function (a) {
          return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a> as approved on ' + esc(longDate(a.date));
        }).join('; ') + '.'
      : 'DOLA\'s approved list had no assessment for it when we checked on ' + esc(longDate(asOf)) + '.';
    return head + '<p>It is due to DOLA by <strong>December 31, 2026</strong> and must follow DOLA\'s method. ' + tail +
      ' <a href="' + DOLA_PAGE + '" target="_blank" rel="noopener">DOLA\'s guide, checklist and planning grants</a>.</p>';
  }

  function render(mount, doc, ctx) {
    var src = doc.meta || {};
    var source = '<p class="shl-note">Source: DOLA, <a href="' + esc(src.source_url) + '" target="_blank" rel="noopener">which state housing laws apply to each jurisdiction</a>, read ' +
      esc(longDate(src.fetched)) + '. DOLA decides whether a place complies; COHO doesn\'t.</p>';
    if (ctx.kind === 'loading') { mount.innerHTML = ''; return; }
    if (ctx.kind !== 'geo') {
      mount.innerHTML = '<div class="shl-card"><h3>State housing laws</h3><p>Pick a county or town to see which state housing laws apply there, including whether it must send DOLA a housing needs assessment by December 31, 2026.</p>' + source + '</div>';
      return;
    }
    // A place DOLA lists by name keeps its own row even when the census files
    // still call it a CDP (Keystone); other CDPs use the county's.
    var all = doc.jurisdictions || {};
    var viaCounty = ctx.cdp && !all[ctx.geoid];
    var row = all[viaCounty ? ctx.county : ctx.geoid];
    if (!row && ctx.county && !ctx.cdp) {
      mount.innerHTML = '<div class="shl-card"><h3>State housing laws</h3><p>DOLA\'s list doesn\'t include ' + esc(ctx.label) + '. <a href="' + esc(src.source_url) + '" target="_blank" rel="noopener">Check DOLA\'s list</a>.</p>' + source + '</div>';
      return;
    }
    if (!row) { mount.innerHTML = ''; return; }
    var who = viaCounty
      ? '<p>' + esc(ctx.label) + ' is unincorporated, so ' + esc(row.name) + '\'s obligations apply.</p>'
      : '';
    var laws = doc.laws || [];
    var hnaLaw = laws.filter(function (l) { return l.id === 'sb24-174-hna'; })[0];
    var req = laws.filter(function (l) { return isRequired(row.laws[l.id]); }).length;
    var items = laws.map(function (l) {
      return '<li><span class="shl-name">' + esc(l.name) + '</span> <span class="shl-note">(' + esc(l.bill) + ')</span><br>' +
        badge(row.laws[l.id]) + '<br><span>' + esc(l.plain) + '</span> <a href="' + esc(l.url) + '" target="_blank" rel="noopener">Source</a></li>';
    }).join('');
    mount.innerHTML = '<div class="shl-card"><h3>State housing laws for ' + esc(row.name) + '</h3>' + who +
      (hnaLaw ? hnaLine(row, hnaLaw, src.hna_approved_source) : '') +
      '<details><summary>All ' + laws.length + ' laws DOLA tracks (' + req + ' required here)</summary><ul class="shl-list">' + items + '</ul></details>' +
      source + '</div>';
  }

  function update() {
    var mounts = document.querySelectorAll('[data-state-laws]');
    if (!mounts.length) return;
    var ctx = context();
    load().then(function (doc) {
      ensureStyles();
      for (var i = 0; i < mounts.length; i++) render(mounts[i], doc, ctx);
    }).catch(function () {
      for (var i = 0; i < mounts.length; i++) mounts[i].innerHTML = '';
    });
  }

  function start() {
    document.addEventListener('hna:geography-changed', update);
    update();
  }

  global.StateHousingLaws = { update: update, _context: context };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}(typeof window !== 'undefined' ? window : this));
