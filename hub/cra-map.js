// The bank and CRA coverage map on the Deal team guide ("Which banks have CRA reasons to invest").
// It is the live page's component (Housing-Analytics js/components/cra-coverage-map.js) redrawn with the lab's
// map kit: the same file (data/cra/co-bank-branches.json), the same two readings, the same bank and county
// lists, and the live component's own wording in the panels. The choices live in the address:
//   cra=exp          the expansive reading (conservative when absent)
//   cra.bank=<cert>  one bank: its branch counties and offices
//   cra.county=<geoid>  one county: the banks behind it
//   cra.dots=0       hide the branch dots
// Port target: this draws from HA's data file only; in HA the live component stays as it is.
(function (global) {
  'use strict';
  var UI = global.LabUI, Shell = global.LabShell, K = global.LabMap;
  var esc = Shell.esc;
  var AT = 'g-dt-cra';

  // The live map's classes, lightest to darkest, on the lab's map steps.
  var BINS = [
    { min: 11, color: 'var(--map-5)', label: '11 or more banks' },
    { min: 6, color: 'var(--map-4)', label: '6 to 10' },
    { min: 3, color: 'var(--map-2)', label: '3 to 5' },
    { min: 1, color: 'var(--map-1)', label: '1 or 2' },
    { min: 0, color: 'var(--map-empty)', label: 'No bank branch' }
  ];
  var EXPANSIVE = 'var(--map-2)', BANK_COUNTY = 'var(--map-4)';
  var SIZE_LABEL = { large: 'Large (investment test)', intermediate: 'Intermediate small (community development test)', small: 'Small (lending test only)' };
  var REG_LABEL = { OCC: 'OCC', FDIC: 'FDIC', FED: 'Federal Reserve' };
  var TIP_SIZE = 'Set by total assets on December 31 of the two prior years. Only large banks are graded on an investment test; intermediate small banks on a community development test that includes investments; small banks on lending only.';
  var TIP_EXAM = 'The federal agency that examines the bank for CRA. Its performance evaluation search has the bank\'s assessment areas.';
  var TIP_HQ = 'Main office city and state, from the FDIC.';

  function binFor(n) { for (var i = 0; i < BINS.length; i++) if (n >= BINS[i].min) return BINS[i]; return BINS[BINS.length - 1]; }
  function money(k) {
    if (k === null || k === undefined) return 'Not reported';
    var d = k * 1000;
    if (d >= 1e9) return '$' + (d / 1e9).toFixed(1) + 'B';
    if (d >= 1e6) return '$' + Math.round(d / 1e6) + 'M';
    if (d > 0) return '$' + Math.round(d / 1e3) + 'K';
    return '$0';
  }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  function fdic(cert) { return 'https://banks.data.fdic.gov/bankfind-suite/bankfind/details/' + encodeURIComponent(cert); }
  function bankLink(cert, name) { return '<a href="' + fdic(cert) + '" rel="noopener">' + esc(name) + '</a>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The address with some of the map's choices changed; null removes one. It always lands back on this part.
  function link(params, set) {
    var p = new URLSearchParams(params.toString());
    Object.keys(set).forEach(function (k) { if (set[k] == null) p.delete(k); else p.set(k, set[k]); });
    p.set('at', AT);
    return '#/guide/deal-team?' + p.toString();
  }

  function state(params, d) {
    var bank = params.get('cra.bank'), county = params.get('cra.county');
    if (!d.banks[bank]) bank = null;
    if (!d.counties[county] && !/^08\d{3}$/.test(county || '')) county = null;
    // A county's table lists every bank, so a county ends the one-bank view (the pickers clear the other).
    if (county) bank = null;
    return { bank: bank, county: county, mode: bank ? 'conservative' : params.get('cra') === 'exp' ? 'expansive' : 'conservative',
      dots: bank ? true : params.get('cra.dots') !== '0' };
  }

  function sizeCols() {
    return [{ key: 'size', label: 'CRA size', tip: TIP_SIZE }, { key: 'examiner', label: 'Examiner', tip: TIP_EXAM }, { key: 'hq', label: 'Headquarters', tip: TIP_HQ }];
  }
  function bankRow(d, cert, extra) {
    var b = d.banks[cert], r = { name: b.name, cert: cert, size: SIZE_LABEL[b.cra_size] || 'Unknown', examiner: REG_LABEL[b.regulator] || b.regulator || '', hq: b.hq };
    Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
  var NAME_COL = { key: 'name', label: 'Bank', href: function (r) { return fdic(r.cert); } };

  function addresses(d, title, list, withBank) {
    if (!list.length) return '';
    return '<details class="cra-addresses"><summary>' + esc(title) + ' (' + list.length + ')</summary><ul>' + list.map(function (o) {
      return '<li>' + (withBank ? bankLink(o[0], d.banks[o[0]].name) + ': ' : '') + esc(o[3]) + ', ' + esc(o[4]) + ' ' + esc(o[5]) + '</li>';
    }).join('') + '</ul></details>';
  }

  function countyPanel(d, st, names) {
    var g = st.county, name = names[g] || (d.counties[g] || {}).name || g;
    var here = d.counties[g] ? d.counties[g].banks : {}, certs = Object.keys(here);
    var offices = (d.offices || []).filter(function (o) { return o[6] === g; }).sort(function (a, b) {
      return d.banks[a[0]].name.localeCompare(d.banks[b[0]].name) || a[3].localeCompare(b[3]);
    });
    var addr = addresses(d, 'Branch addresses in ' + name, offices, true);
    if (st.mode === 'conservative') {
      if (!certs.length) return '<h4>' + esc(name) + '</h4><p>No FDIC-insured bank reports a branch here. Switch to the expansive reading to see banks that could still count an investment here.</p>';
      certs.sort(function (a, b) { return (here[b].deposits_k || 0) - (here[a].deposits_k || 0); });
      return '<h4>' + esc(name) + ': ' + plural(certs.length, 'bank', 'banks') + ' with a branch</h4>' +
        '<p>Each is a first call, once you confirm the project\'s census tract is inside its assessment area (its performance evaluation or public file shows the area).</p>' +
        UI.table('cra-here', 'Banks with a branch in ' + name, [NAME_COL,
          { key: 'branches', label: 'Branches here', num: true, tip: 'Offices this bank reports in the county in the FDIC Summary of Deposits.' },
          { key: 'deposits', label: 'Deposits here', num: true, fmt: money, tip: 'Deposits booked at this bank\'s offices in the county, as of June 30.' }].concat(sizeCols()),
        certs.map(function (c) { return bankRow(d, c, { branches: here[c].branches, deposits: here[c].deposits_k }); }), { noun: 'banks' }) + addr;
    }
    var others = Object.keys(d.banks).filter(function (c) { return !here[c] && (d.banks[c].cra_size === 'large' || d.banks[c].cra_size === 'intermediate'); });
    var unknown = Object.keys(d.banks).filter(function (c) { return !here[c] && !d.banks[c].cra_size; }).length;
    others.sort(function (a, b) {
      return (d.banks[a].cra_size === 'large' ? 0 : 1) - (d.banks[b].cra_size === 'large' ? 0 : 1) || d.banks[b].co_branches - d.banks[a].co_branches;
    });
    var large = others.filter(function (c) { return d.banks[c].cra_size === 'large'; }).length, isb = others.length - large;
    return '<h4>' + esc(name) + ': ' + others.length + ' more banks may be able to count an investment here</h4>' +
      '<p>These banks have Colorado branches but none in ' + esc(name) + '. Under the 1995 CRA rules examiners apply today:</p><ul>' +
      '<li>The ' + large + ' large banks are graded on an investment test that counts investments benefiting “a broader statewide or regional area that includes the bank’s assessment area(s)” (12 CFR 228.23(a)).</li>' +
      '<li>The ' + isb + ' intermediate small banks have a community development test whose rule text names no area; the agencies’ guidance says a retail institution “will receive consideration” for activity in that broader area, so it may count for them too.</li>' +
      '<li>Either way, only “as long as the institution has been responsive to community development needs and opportunities in its assessment area(s)” (Interagency Q&amp;A §__.12(h)–6). The bank’s latest performance evaluation says whether examiners found that.</li></ul>' +
      '<p>' + (certs.length ? 'The ' + plural(certs.length, 'bank', 'banks') + ' with a branch here ' + (certs.length === 1 ? 'is' : 'are') + ' under the conservative reading. ' : '') +
      'Small banks are left out: their examiners weigh investments only as an optional part of a lending test (12 CFR 228.26(b)).' +
      (unknown ? ' ' + unknown + (unknown === 1 ? ' bank is' : ' banks are') + ' also left out because the FDIC has not reported both year-end asset totals that set its size class.' : '') + '</p>' +
      UI.table('cra-more', 'Banks with Colorado branches but none in ' + name, [NAME_COL,
        { key: 'branches', label: 'Colorado branches', num: true, tip: 'All offices this bank reports in Colorado.' },
        { key: 'counties', label: 'Colorado counties', num: true, tip: 'Colorado counties where this bank has at least one branch.' }].concat(sizeCols()),
      others.map(function (c) { return bankRow(d, c, { branches: d.banks[c].co_branches, counties: d.banks[c].co_counties.length }); }), { noun: 'banks' }) + addr;
  }

  function bankPanel(d, st, names, params) {
    var cert = st.bank, b = d.banks[cert];
    var gs = b.co_counties.filter(function (g) { return d.counties[g] && d.counties[g].banks[cert]; });
    gs.sort(function (a, c) { return (d.counties[c].banks[cert].deposits_k || 0) - (d.counties[a].banks[cert].deposits_k || 0); });
    var mine = (d.offices || []).filter(function (o) { return o[0] === cert; }).sort(function (a, c) { return a[4].localeCompare(c[4]) || a[3].localeCompare(c[3]); });
    var reach = b.cra_size === 'large' || b.cra_size === 'intermediate'
      ? 'Under the expansive reading it may also count an investment elsewhere in Colorado, if it has served these areas first.'
      : b.cra_size === 'small' ? 'As a small bank, its examiners weigh investments only as an optional part of its lending test (12 CFR 228.26(b)).' : '';
    return '<h4>' + bankLink(cert, b.name) + ': ' + plural(b.co_branches, 'branch', 'branches') + ' in ' + plural(gs.length, 'county', 'counties') + '</h4>' +
      '<p>CRA size: ' + esc(SIZE_LABEL[b.cra_size] || 'Unknown') + '. Examiner: ' + esc(REG_LABEL[b.regulator] || b.regulator || '') + '. Headquarters: ' + esc(b.hq) + '.</p>' +
      '<p>The shaded counties are where it has a branch, a first screen for its assessment areas; its performance evaluation or public file shows the areas themselves. ' + reach + '</p>' +
      UI.table('cra-bank', 'Counties where ' + b.name + ' has a branch', [{ key: 'county', label: 'County' },
        { key: 'branches', label: 'Branches', num: true, tip: 'Offices this bank reports in the county in the FDIC Summary of Deposits.' },
        { key: 'deposits', label: 'Deposits', num: true, fmt: money, tip: 'Deposits booked at this bank\'s offices in the county, as of June 30.' }],
      gs.map(function (g) { var h = d.counties[g].banks[cert]; return { county: names[g] || g, branches: h.branches, deposits: h.deposits_k }; }), { noun: 'counties' }) +
      addresses(d, 'Branch addresses', mine, false) +
      '<p><a class="button-link secondary" href="' + esc(link(params, { 'cra.bank': null })) + '">Show all banks</a></p>';
  }

  function view(params) {
    var s = UI.load({ b: 'data/co-county-boundaries.json', cra: 'data/cra/co-bank-branches.json' });
    if (s.error) return '<p class="callout">The bank map could not load. The FDIC Summary of Deposits link below has the same branch list.</p>';
    if (!s.data) return '<p role="status" class="note">Loading the bank map…</p>';
    var d = s.data.cra, feats = s.data.b.features, st = state(params, d), names = {};
    feats.forEach(function (f) { names[f.properties.GEOID] = f.properties.NAMELSAD || f.properties.NAME + ' County'; });
    var count = function (g) { return d.counties[g] ? Object.keys(d.counties[g].banks).length : 0; };
    var bankIn = function (g) { return !!(d.counties[g] && d.counties[g].banks[st.bank]); };
    var shownOffices = !st.dots ? [] : (d.offices || []).filter(function (o) { return !st.bank || o[0] === st.bank; });

    var paths = feats.map(function (f) {
      var g = f.properties.GEOID, n = count(g);
      var fill = st.bank ? (bankIn(g) ? BANK_COUNTY : 'var(--map-empty)') : st.mode === 'conservative' ? binFor(n).color : EXPANSIVE;
      var label = names[g] + ': ' + (st.bank ? (bankIn(g) ? plural(d.counties[g].banks[st.bank].branches, 'branch', 'branches') : 'no branch')
        : plural(n, 'bank', 'banks') + ' with a branch');
      return '<a href="' + esc(link(params, { 'cra.county': g, 'cra.bank': null })) + '" aria-label="' + esc(label) + '"><path d="' + K.path(f.geometry) + '" fill="' + fill + '"' +
        (g === st.county ? ' class="is-picked"' : '') + '><title>' + esc(label) + '</title></path></a>';
    }).join('');
    var dots = shownOffices.length ? '<g class="cra-dots">' + shownOffices.map(function (o) {
      return '<circle cx="' + K.x(o[2]).toFixed(1) + '" cy="' + K.y(o[1]).toFixed(1) + '" r="2.4"><title>' + esc(d.banks[o[0]].name + ': ' + o[3] + ', ' + o[4] + ' ' + o[5]) + '</title></circle>';
    }).join('') + '</g>' : '';
    var title = st.bank ? 'Counties where ' + d.banks[st.bank].name + ' has a branch'
      : st.mode === 'conservative' ? 'Banks with a branch in each county' : 'Every county: a bank with a Colorado branch may get credit here';
    var aria = st.bank ? 'Map of Colorado with the counties where ' + d.banks[st.bank].name + ' has a branch shaded, and a dot at each of its ' + shownOffices.length + ' branch offices. Its counties and addresses are listed below the map.'
      : st.mode === 'conservative' ? 'Map of Colorado counties shaded by the number of banks with a branch in each' + (st.dots ? ', with a dot at each branch office' : '') + '. Choose a county from the list below the map for the same information.'
      : 'Map of Colorado with every county shaded the same' + (st.dots ? ', with a dot at each branch office' : '') + ': under the expansive reading, a large or intermediate small bank with a Colorado branch may get credit in any county. Choose a county from the list below the map for the same information.';
    var key = function (color, text, dot) { return '<li><i' + (dot ? ' class="cra-key-dot"' : '') + ' style="background:' + color + '"></i>' + esc(text) + '</li>'; };
    var legend = (st.bank ? key(BANK_COUNTY, 'County where ' + d.banks[st.bank].name + ' has a branch') + key('var(--map-empty)', 'No branch')
      : st.mode === 'conservative' ? BINS.map(function (b) { return key(b.color, b.label); }).join('')
      : key(EXPANSIVE, 'Every county: a large or intermediate small bank with a Colorado branch may get credit here, if it has served its own areas first')) +
      (shownOffices.length ? key('var(--rust)', 'Bank branch (addresses are listed below the map)', true) : '');

    var chips = '<nav class="dm-chips" aria-label="Which reading"><ul>' + [['conservative', 'Conservative: banks with a branch here', null], ['expansive', 'Expansive: statewide', 'exp']].map(function (c) {
      return '<li><a' + (st.mode === c[0] && !st.bank ? ' class="is-on" aria-current="true"' : '') + ' href="' + esc(link(params, { cra: c[2], 'cra.bank': null })) + '">' + esc(c[1]) + '</a></li>';
    }).join('') + '<li><a' + (st.dots ? ' class="is-on" aria-current="true"' : '') + ' href="' + esc(link(params, { 'cra.dots': st.dots ? '0' : null })) + '">Show bank branch locations</a></li></ul></nav>';
    var pick = function (key, label, cur, first, opts) {
      return '<label class="opp-menu"><span>' + esc(label) + '</span><select data-cra-pick="' + key + '"><option value="">' + esc(first) + '</option>' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
    };
    var bankOpts = Object.keys(d.banks).sort(function (a, b) { return d.banks[a].name.localeCompare(d.banks[b].name); }).map(function (c) {
      return [c, d.banks[c].name + ' (' + plural(d.banks[c].co_branches, 'branch', 'branches') + ')'];
    });
    var countyOpts = Object.keys(names).sort(function (a, b) { return names[a].localeCompare(names[b]); }).map(function (g) { return [g, names[g]]; });
    var menus = '<div class="opp-menus" role="group" aria-label="Pick a bank or a county">' + pick('bank', 'Bank', st.bank, 'All banks', bankOpts) + pick('county', 'County', st.county, 'Choose a county', countyOpts) + '</div>';

    var panel = st.county ? countyPanel(d, st, names) : st.bank ? bankPanel(d, st, names, params)
      : '<p>Select a county on the map, or choose one from the list, to see the banks.</p>';
    var m = d.meta || {};
    return '<div class="cra-map" id="cra-map">' + chips +
      '<figure class="pres-map money-map cra-figure"><figcaption><strong>' + esc(title) + '</strong></figcaption>' +
      '<div class="pm-frame"><svg viewBox="0 0 ' + K.W + ' ' + K.H + '" role="group" aria-label="' + esc(aria) + '">' + paths + dots + K.cities() + '</svg></div>' +
      '<ul class="mk-legend">' + legend + '</ul></figure>' +
      '<p class="note cra-asof">Branches as of ' + esc(longDate(m.sod_as_of)) + '; ' + esc(m.bank_count) + ' banks, ' + esc(m.branch_count) + ' Colorado offices.</p>' +
      menus + '<div class="cra-panel" aria-live="polite">' + panel + '</div></div>';
  }

  // The guide's text keeps an empty box where the live page mounts its map; the lab's map goes there.
  var HOLE = /<div>\s*Show bank branch locations[\s\S]*?<p><\/p>\s*<p><\/p>\s*<\/div>/;
  function insert(html, params) {
    var map = view(params);
    return HOLE.test(html) ? html.replace(HOLE, function () { return map; }) : html + map;
  }

  // The two pickers. Picking a bank clears the county and the reading (a bank's branch counties are the
  // conservative reading); picking a county clears the bank.
  document.addEventListener('change', function (ev) {
    var key = ev.target.dataset && ev.target.dataset.craPick;
    if (!key) return;
    var hash = location.hash.replace(/^#\/?/, ''), i = hash.indexOf('?');
    var p = new URLSearchParams(i < 0 ? '' : hash.slice(i + 1)), v = ev.target.value;
    if (key === 'bank') { p.delete('cra.county'); if (v) { p.set('cra.bank', v); p.delete('cra'); } else p.delete('cra.bank'); }
    else { p.delete('cra.bank'); if (v) p.set('cra.county', v); else p.delete('cra.county'); }
    p.set('at', AT);
    history.replaceState(null, '', '#/guide/deal-team?' + p.toString());
    Shell.render();
    var again = document.querySelector('[data-cra-pick="' + key + '"]');
    if (again) again.focus();
  });

  global.LabCra = { view: view, insert: insert, BINS: BINS, money: money };
})(window);
