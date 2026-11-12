// Data and methods, the five pages the live site keeps under its Data menu: Trust center (#/data/trust),
// Data explorer (#/data/explorer), Data map (#/data/map), Data quality (#/data/quality) and Data status
// (#/data/status). Every figure is read from the site's own files: the file list (data/_manifest.json), the
// nightly check results (data/_qa-status.json), place coverage (data/hna/place-chas-coverage-stats.json),
// the source registry (js/data-source-inventory.js) and the dataset checks in js/data-quality-check.js.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var VENDOR = global.LAB_VENDOR;
  var LIVE = 'https://cohoanalytics.com/';
  // The live site's data checks resolve their file paths through this hook; point it at the site's copy.
  if (typeof global.resolveAssetUrl !== 'function') global.resolveAssetUrl = function (p) { return VENDOR + p; };

  function day(iso) { return iso ? String(iso).slice(0, 10) : null; }
  function mb(bytes) { return bytes >= 1e6 ? (bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB'; }
  function loading(title, s) {
    var head = T.head({ kind: 'data', crumbs: T.trail('data', title), title: title });
    if (s.error) return head + '<p class="callout">' + esc(s.error) + '</p>';
    return head + '<p role="status" class="note">Loading the site’s files…</p>';
  }

  // ---------- Nightly checks (data/_qa-status.json) ----------
  // The five layers the site runs on its data, in its own order, with what each one catches in plain words
  // (docs/CONTRIBUTING.md, "QA/QC layers").
  var CHECKS = [
    { id: 'schema', name: 'File structure', what: 'Every key file opens and has the fields the pages read.' },
    { id: 'sentinel', name: 'Row counts', what: 'Counts stay above their floors, such as all 64 counties.' },
    { id: 'bounds', name: 'Sensible values', what: 'Numbers fall in realistic ranges, such as a vacancy rate under 100%.' },
    { id: 'freshness', name: 'Freshness', what: 'Each tracked file is newer than its refresh window allows.' },
    { id: 'plausibility', name: 'Cross-checks', what: 'Figures from different sources agree where they should.' }
  ];
  // The count each layer prints at the end of its run, read as the layer wrote it.
  function tally(id, L) {
    if (!L) return null;
    if (id === 'freshness') return L.ok != null ? num(L.ok) + ' files within their window, ' + num(L.stale || 0) + ' past it, ' + num(L.missing || 0) + ' missing' : null;
    if (id === 'plausibility' && L.passed != null) return num(L.passed) + ' passed, ' + num(L.failed || 0) + ' failed';
    var t = String(L.output_tail || '');
    var m = /Results:\s*(\d+) passed, (\d+) failed/.exec(t);
    if (m) return num(+m[1]) + ' passed, ' + num(+m[2]) + ' failed';
    m = /Summary:\s*(\d+) ok, (\d+) below floor, (\d+) missing/.exec(t);
    if (m) return num(+m[1]) + ' above their floor, ' + num(+m[2]) + ' below, ' + num(+m[3]) + ' missing';
    return null;
  }
  function passWord(st) { return st === 'pass' ? ['Passed', 'ok'] : st === 'fail' ? ['Failed', 'bad'] : ['Not run', 'na']; }
  function checkList(qa) {
    return '<ol class="dq-checks">' + CHECKS.map(function (c) {
      var L = qa.layers[c.id], w = passWord(L && L.status), n = tally(c.id, L);
      return '<li class="dq-check dq-' + w[1] + '"><span class="dq-mark" aria-hidden="true">' + (w[1] === 'ok' ? '✓' : w[1] === 'bad' ? '!' : '–') + '</span>' +
        '<div><p class="dq-name"><strong>' + esc(c.name) + '</strong> <span class="dq-word">' + esc(w[0]) + '</span></p>' +
        '<p class="dq-what">' + esc(c.what) + '</p>' + (n ? '<p class="dq-n">' + esc(n) + '</p>' : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  function passed(qa) { return CHECKS.filter(function (c) { return qa.layers[c.id] && qa.layers[c.id].status === 'pass'; }).length; }

  // ---------- Trust center ----------
  function trust() {
    var s = UI.load({ qa: 'data/_qa-status.json', files: 'data/_manifest.json', reg: 'data/manifest.json' });
    if (!s.data) return loading('Trust center', s);
    var qa = s.data.qa, I = global.DataSourceInventory, stats = I ? I.getStats() : null;
    var ok = passed(qa), when = day(qa.generated_at);
    var attention = I ? I.getSources().filter(function (x) { return x.status === 'stale' || x.status === 'aging' || x.status === 'unavailable'; }).length : null;
    var finding = (ok === CHECKS.length ? 'All five data checks passed on ' + when + '.' : ok + ' of ' + CHECKS.length + ' data checks passed on ' + when + '.') +
      (stats ? ' ' + num(attention) + ' of ' + num(stats.total) + ' sources are past or near their refresh date.' : '');
    var steps = [
      { n: '1', title: 'A public agency publishes it', detail: stats ? num(stats.total) + ' sources, each with its publisher' : 'Each source names its publisher', href: '#/data/sources', go: 'Data sources' },
      { n: '2', title: 'The site keeps a dated copy', detail: num(s.data.files.files.filter(function (f) { return !MEMBER.test(f.path); }).length) + ' files, each with its update date', href: '#/data/explorer', go: 'Data explorer' },
      { n: '3', title: 'Five checks run on the copies', detail: ok + ' of 5 passed, ' + when, href: '#/data/quality', go: 'Data quality' },
      { n: '4', title: 'Each figure shows its source', detail: 'Publisher and date under every number', href: '#/guide/methods', go: 'Methods' }
    ];
    return T.head({
      kind: 'data', crumbs: T.trail('data', 'Trust center'), title: 'Trust center',
      answer: 'Whether the numbers can be relied on: who publishes each one, how fresh the copy is, and the checks every file passes before a page shows it.',
      dated: s.data, datedWord: 'Checked'
    }) +
      UI.intro('Can I trust the numbers on this site?', finding) +
      '<h2>How a number reaches a page</h2><ol class="trust-steps">' + steps.map(function (x) {
        return '<li><a href="' + esc(x.href) + '"><span class="ts-n" aria-hidden="true">' + x.n + '</span><span class="ts-title">' + esc(x.title) + '</span>' +
          '<span class="ts-detail">' + esc(x.detail) + '</span><span class="ts-go">' + esc(x.go) + ' →</span></a></li>';
      }).join('') + '</ol>' +
      '<h2>Look closer</h2><div class="hub-cards">' + [
        ['#/data/status', 'Data status', 'The four datasets the main tools need, checked in your browser now.'],
        ['#/data/map', 'Data map', 'Every map layer the site keeps, drawn over Colorado’s counties.'],
        ['#/data/sources', 'Data sources', 'Each source’s publisher, last update and expected cadence.'],
        ['#/data/quality', 'Data quality', 'The five checks in detail, and place coverage.']
      ].map(function (c) { return '<a class="hub-card" href="' + c[0] + '"><span class="hub-card-title">' + esc(c[1]) + '</span><span class="hub-card-desc">' + esc(c[2]) + '</span></a>'; }).join('') + '</div>' +
      healthOverview(stats) +
      '<h3>Raw files</h3><p>The site’s own lists of its data files, as it publishes them: <a href="' + LIVE + 'data/manifest.json">the source list ↗</a> and <a href="' + LIVE + 'data/_manifest.json">every file with its size and fields ↗</a>. The <a href="#/data/explorer">Data explorer</a> reads the second one.</p>' +
      maintainers(s.data) +
      T.source('COHO nightly data checks', LIVE + 'data-review-hub.html', when) +
      T.next('Next', [{ href: '#/guide/methods', label: 'How the numbers are made →' }, { href: '#/guide/about', label: 'About COHO', secondary: true }]);
  }

  // The live Trust center's overview tiles: every source the freshness monitor watches, by status, and the
  // average freshness of the ones that have a window. Read from the source registry by its own rules.
  function healthOverview(stats) {
    if (!stats) return '';
    var c = stats.counts;
    var tiles = [
      [num(stats.total), 'Sources watched', 'Every source in the registry'],
      [num(c.current || 0), 'Current', 'Within their window'],
      [num(c.aging || 0), 'Aging', 'Near the end of their window'],
      [num(c.stale || 0), 'Stale', 'Past their window'],
      [num(c.live || 0), 'Live', 'Read from the publisher on demand'],
      [num(c.unknown || 0), 'No date', 'No update date recorded'],
      [stats.avgFreshness != null ? stats.avgFreshness + '%' : '—', 'Average freshness', 'Across sources with a window; 100% is just brought in']
    ];
    return '<h2>Data health overview</h2><ul class="fresh-tiles dt-health">' + tiles.map(function (t) {
      return '<li><span class="fresh-n">' + esc(t[0]) + '</span><span class="fresh-word">' + esc(t[1]) + '</span><span class="fresh-why">' + esc(t[2]) + '</span></li>';
    }).join('') + '</ul>' +
      '<p class="note">' + num(c.curated || 0) + ' sources are kept by hand, ' + num(c.planned || 0) + ' are planned and ' + num(c.unavailable || 0) + ' cannot be refreshed; none of those has a window to score. <a href="#/data/sources">Every source</a>.</p>';
  }

  // ---------- For maintainers: how new files are caught ----------
  // The paths the live site's discovery scan looks for (js/data-source-discovery.js, PROBE_PATHS). Here the scan
  // runs against the site's own file lists instead of the web server: a path is on the site when the full file
  // list (_manifest.json) has it, and registered when the source list (manifest.json) does.
  var PROBE_PATHS = ['data/manifest.json', 'data/chfa-lihtc.json', 'data/fred-data.json', 'data/car-market.json', 'data/car-market-report-2026-02.json',
    'data/car-market-report-2026-03.json', 'data/car-market-report-2026-04.json', 'data/census-acs-state.json', 'data/co-county-boundaries.json',
    'data/co-county-demographics.json', 'data/co-county-economic-indicators.json', 'data/co-demographics.json', 'data/co-historical-allocations.json',
    'data/co_ami_gap_by_county.json', 'data/dda-colorado.json', 'data/glossary.json', 'data/hud-fmr-income-limits.json', 'data/insights-meta.json',
    'data/lihtc-trends-by-county.json', 'data/policy_briefs.json', 'data/qct-colorado.json', 'data/states-10m.json', 'data/allocations.json',
    'data/market/hud_lihtc_co.geojson', 'data/market/acs_tract_metrics_co.json', 'data/market/tract_centroids_co.json', 'data/market/nhpd_co.geojson',
    'data/market/reference-projects.json', 'data/environmental/fema-flood-co.geojson', 'data/environmental/epa-superfund-co.json',
    'data/policy/soft-funding-status.json', 'data/policy/chfa-awards-historical.json', 'data/policy/county-ownership.json',
    'data/amenities/grocery_co.geojson', 'data/hna/chas_affordability_gap.json'];
  function scan(d) {
    var have = {}, reg = {};
    ((d.files && d.files.files) || []).forEach(function (f) { have['data/' + f.path] = true; });
    if (d.reg) Object.keys(d.reg.files || {}).forEach(function (k) { reg[k] = true; });
    (d.reg && d.reg.sources || []).forEach(function (x) { if (x.file_path) reg[x.file_path] = true; });
    return PROBE_PATHS.map(function (p) { return { path: p, on: !!have[p] || p === 'data/manifest.json' && !!d.reg, reg: !!reg[p] }; });
  }
  function maintainers(d) {
    var r = scan(d), found = r.filter(function (x) { return x.on; }), pending = found.filter(function (x) { return !x.reg; }), gone = r.filter(function (x) { return !x.on && x.reg; });
    var name = function (p) { return p.replace(/^data\//, ''); };
    return '<details class="dt-maint"><summary>For maintainers: how new and missing files are caught</summary>' +
      '<h2>Admin and configuration</h2>' +
      '<h3>Daily data-source check</h3><p>An automated check runs every day to:</p><ul><li>look for new data files that are not in the source list yet;</li><li>check each source’s age against its expected update window;</li><li>write a discovery report;</li><li>flag new files for a maintainer to review.</li></ul>' +
      '<h3 id="dt-scan">Discovery scan</h3><p>The scan looks for ' + r.length + ' known file paths and compares them with the site’s source list. Today: <strong>' + found.length + ' found</strong>, ' + (found.length - pending.length) + ' already registered, ' +
      '<strong>' + pending.length + ' pending review</strong>' + (gone.length ? ', ' + gone.length + ' registered but missing' : '') + ', ' + (r.length - found.length) + ' not on the site.</p>' +
      '<h3>Pending discovery</h3>' + (pending.length ? '<p>Files the site has that are not in its source list yet. On the live page a maintainer approves each one to download a patch for the list.</p><ul class="dt-paths">' + pending.map(function (x) { return '<li><code>' + esc(name(x.path)) + '</code></li>'; }).join('') + '</ul>' : '<p>No file is waiting for review.</p>') +
      '<h3>Discovery configuration</h3><p>The scan settings are for maintainers only. Visitors run it against the source list the site ships with; private audit files are never loaded. <a href="' + LIVE + 'data-review-hub.html">Run the scan on the live Trust center ↗</a></p>' +
      '<h3>Probed file paths</h3><ul class="dt-paths">' + r.map(function (x) {
        var w = x.on ? (x.reg ? 'registered' : 'pending review') : 'not on the site';
        return '<li class="dt-' + (x.on ? (x.reg ? 'ok' : 'new') : 'off') + '"><code>' + esc(name(x.path)) + '</code> <span>' + esc(w) + '</span></li>';
      }).join('') + '</ul></details>';
  }

  // ---------- Data quality ----------
  function quality() {
    var s = UI.load({ qa: 'data/_qa-status.json', cov: 'data/hna/place-chas-coverage-stats.json' });
    if (!s.data) return loading('Data quality', s);
    var qa = s.data.qa, cov = s.data.cov, when = day(qa.generated_at), ok = passed(qa);
    var fr = qa.layers.freshness || {}, files = fr.files || [];
    var tot = cov.totals || {};
    var short = Object.keys(cov.by_county || {}).map(function (k) { return cov.by_county[k]; }).filter(function (c) { return c.uncovered > 0; });
    var frRows = files.map(function (f) {
      return { file: String(f.file || '').replace(/^data\//, ''), age: f.ageDays, sla: f.slaDays, status: f.status === 'OK' ? 'Within window' : f.status === 'STALE' ? 'Past window' : f.status, from: String(f.source || '').replace(/^field:/, '') };
    });
    return T.head({
      kind: 'data', crumbs: T.trail('data', 'Data quality'), title: 'Data quality',
      answer: 'The five checks the site runs on its data every night, what each one catches, and how many places have their own figures.',
      meta: '<span class="scope-tag">Checked ' + esc(when) + '</span>',
      facts: [
        { value: ok + ' of 5', label: 'Checks passed', source: 'COHO nightly data checks', href: LIVE + 'dashboard-data-quality.html' },
        { value: num(fr.ok || 0) + ' of ' + num(files.length), label: 'Tracked files within their refresh window', source: 'COHO nightly data checks', href: LIVE + 'dashboard-data-quality.html' },
        { value: (tot.coverage_pct != null ? tot.coverage_pct + '%' : null), label: 'Of ' + num(tot.registry_places) + ' places with their own affordability figures', source: 'COHO place coverage', href: LIVE + 'dashboard-data-quality.html' }
      ]
    }) +
      '<h2>The five checks</h2>' + checkList(qa) +
      '<h2>Files with a refresh window</h2>' +
      '<div data-no-source="catalog: the site’s own file checks, run when this page opens">' + UI.table('fresh', 'Tracked files, their age and the window each is allowed', [
        { key: 'file', label: 'File' },
        { key: 'age', label: 'Age (days)', num: true, tip: 'Days since the date the file records for itself' },
        { key: 'sla', label: 'Allowed (days)', num: true, tip: 'The refresh window the check allows this file' },
        { key: 'status', label: 'Result' },
        { key: 'from', label: 'Date read from', tip: 'The field in the file that carries its date' }
      ], frRows, { noun: 'files', placeholder: 'File name' }) + '</div>' +
      '<h2>Is my place using precise or estimated figures?</h2>' +
      '<p>Affordability figures for a town come from Census tracts added up to the town’s boundary (a match against the Census Bureau’s 2024 place map). That is precise even for towns that cross a county line, such as Erie, Aurora or Longmont. A place the map does not cover uses its county’s rates instead, which is an estimate. ' + esc(num(tot.covered_direct)) + ' places match directly and ' + esc(num(tot.covered_via_alias)) + ' through another name the Census uses; ' +
      esc(num(tot.uncovered_county_fallback || 0)) + ' fall back to county figures.</p>' +
      placeBuckets(tot, cov) +
      (short.length ? UI.table('cov', 'Counties with a place that falls back to county figures', [
        { key: 'name', label: 'County' }, { key: 'total_places', label: 'Places', num: true }, { key: 'uncovered', label: 'Falling back', num: true }
      ], short, { noun: 'counties', placeholder: 'County' }) : '<p class="note">No county has a place that falls back.</p>') +
      T.source('COHO place coverage, from HUD CHAS 2018–2022 tracts and Census TIGER 2024 places', LIVE + 'dashboard-data-quality.html', day(cov.meta && cov.meta.generated_at)) +
      sourceHealth() + pipelineLog(qa) + apiSetup() +
      T.next('Next', [{ href: '#/data/status', label: 'Data status →' }, { href: '#/data/sources', label: 'Data sources', secondary: true }]);
  }

  // The four buckets every registry place falls into (js/place-chas-coverage-panel.js), with what each means.
  function placeBuckets(t, cov) {
    var pct = function (n) { return t.registry_places ? (n / t.registry_places * 100).toFixed(1) + '%' : '—'; };
    var b = [
      ['Matched directly', t.covered_direct, 'Tracts added up to the town’s own boundary.', 'ok'],
      ['Matched through another name', t.covered_via_alias, 'Duplicate names in the place list, such as Pueblo, Englewood or Parker, matched to the Census record.', 'ok'],
      ['Matched, but rounds to zero', t.covered_with_zero_apportion, 'Very small places, such as Eads, Walden or Dinosaur, where the share of a tract rounds to nothing. Shown as low confidence.', 'mid'],
      ['County figures instead', t.uncovered_county_fallback, 'No match on the Census map, so the place shows its county’s rates. Mostly military bases, tribal lands and the smallest unincorporated places.', 'low']
    ];
    var list = cov.uncovered_places || [];
    return '<ul class="dq-buckets">' + b.map(function (x) {
      return '<li class="dq-b-' + x[3] + '"><span class="fresh-n">' + esc(num(x[1] || 0)) + '</span><span class="fresh-word">' + esc(x[0]) + '</span><span class="note">' + esc(pct(x[1] || 0)) + ' of ' + esc(num(t.registry_places)) + ' places</span><span class="fresh-why">' + esc(x[2]) + '</span></li>';
    }).join('') + '</ul>' +
      (list.length ? '<details><summary>Places using county figures (' + list.length + ')</summary><ul>' + list.map(function (p) {
        return '<li>' + esc(p.name) + ' <span class="note">(' + esc(((cov.by_county || {})[p.county_fips] || {}).name || p.county_fips) + ' County)</span></li>';
      }).join('') + '</ul></details>' : '<p class="note">Every place in the list has its own tract-based figures today.</p>');
  }

  // ---------- Data source health ----------
  // The five files the live Data quality page checks by name, each with the field that carries its date, how
  // old it may be, and how it is refreshed (dashboard-data-quality.html, DATA_SOURCES).
  var HEALTH = [
    { name: 'Census ACS (state)', file: 'data/census-acs-state.json', ts: ['meta', 'pulled_at_utc'], max: 8, notes: 'Checked weekly (Saturdays); ACS itself is released once a year. Needs a Census key.' },
    { name: 'Colorado county demographics', file: 'data/co-county-demographics.json', ts: ['meta', 'refreshed_utc'], max: 3, notes: 'Updated daily by the data refresh. Falls back gracefully if the key is missing.' },
    { name: 'CHFA tax credit properties', file: 'data/chfa-lihtc.json', ts: ['fetchedAt'], max: 10, notes: 'Updated weekly. No key needed.' },
    { name: 'FRED economic data', file: 'data/fred-data.json', ts: ['updated'], max: 3, notes: 'Updated daily. Needs a FRED key.' },
    { name: 'Data manifest', file: 'data/manifest.json', ts: ['generated'], max: 3, notes: 'Rebuilt after each successful data fetch.' }
  ];
  function deep(o, keys) { for (var i = 0; i < keys.length; i++) { if (o == null || typeof o !== 'object') return null; o = o[keys[i]]; } return o == null ? null : String(o); }
  function ago(iso) {
    if (!iso) return '—';
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (isNaN(d)) return iso;
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.floor(d / 30) + ' months ago' : day(iso);
  }
  var health = { rows: null, started: false };
  function healthRows() {
    if (health.started) return health.rows;
    health.started = true;
    Promise.all(HEALTH.map(function (h) {
      return fetch(VENDOR + h.file).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
        var ts = deep(d, h.ts), stale = ts && (Date.now() - new Date(ts).getTime()) / 86400000 > h.max;
        return { h: h, ts: ts, state: stale ? 'Stale' : 'Present', log: h.name + ': ' + (stale ? 'STALE, last refreshed ' + (ts || 'unknown') + ' (over its ' + h.max + '-day window)' : 'present, last refreshed ' + (ts || 'unknown')) };
      }, function (e) { return { h: h, ts: null, state: 'Missing', log: h.name + ': ' + e.message }; });
    })).then(function (rows) { health.rows = rows; Shell.render(); });
    return null;
  }
  function sourceHealth() {
    var rows = healthRows();
    return '<h2 id="dq-health">Data source health</h2><p>Where the main tools’ data comes from, and how fresh it is right now. Each file is checked against the window its refresh job allows.</p>' +
      (!rows ? '<p class="note">Checking the five files…</p>' : '<ul class="dq-health">' + rows.map(function (r) {
        var cls = r.state === 'Present' ? 'ok' : r.state === 'Stale' ? 'mid' : 'low';
        return '<li class="dq-h-' + cls + '"><p class="dq-name"><strong>' + esc(r.h.name) + '</strong> <span class="src-status">' + esc(r.state) + '</span></p>' +
          '<p class="note">' + esc(r.h.file.replace(/^data\//, '')) + ' · refreshed ' + esc(ago(r.ts)) + ' · window ' + r.h.max + ' days</p><p class="dq-what">' + esc(r.h.notes) + '</p></li>';
      }).join('') + '</ul>');
  }

  // ---------- Pipeline log ----------
  // What the checks wrote: this page's five file checks, then the last lines each nightly layer printed.
  function pipelineLog(qa) {
    var rows = health.rows || [];
    var strip = function (t) { return String(t || '').replace(/\bdata\//g, ''); };
    return '<h2 id="dq-log">Pipeline log</h2><p class="note">Recent automated data-check activity, as the checks wrote it.</p>' +
      '<pre class="dq-log">' + esc(rows.length ? rows.map(function (r) { return r.log; }).join('\n') : 'Waiting for the first file check…') + '</pre>' +
      CHECKS.map(function (c) {
        var L = qa.layers[c.id]; if (!L) return '';
        var tail = strip(L.output_tail || (L.ok != null ? L.ok + ' ok, ' + (L.stale || 0) + ' stale, ' + (L.missing || 0) + ' missing' : ''));
        return tail ? '<details class="dq-log-layer"><summary>' + esc(c.name) + ': last run ' + esc(day(qa.generated_at)) + ', ' + esc(passWord(L.status)[0].toLowerCase()) + '</summary><pre class="dq-log">' + esc(tail.trim()) + '</pre></details>' : '';
      }).join('');
  }

  // ---------- API keys (maintainers) ----------
  // The live page's key cards and key list (dashboard-data-quality.html). The lab asks for no key: the site's
  // scheduled data builds keep their own keys privately, and the live page stores a typed key only in that browser.
  var KEYS = [
    { key: 'CENSUS_API_KEY', label: 'Census key', what: 'Census data loads without a key, but the Census Bureau limits keyless use to 500 requests a day.', cost: 'Free', href: 'https://api.census.gov/data/key_signup.html' },
    { key: 'FRED_API_KEY', label: 'FRED key', what: 'Economic indicator series. Without it the economy pages use the last saved copy.', cost: 'Free', href: 'https://fred.stlouisfed.org/docs/api/api_key.html' },
    { key: 'REGRID_API_KEY', label: 'Regrid parcel key', what: 'Live parcel and zoning data. An optional paid source; COHO has not funded a subscription, and the market study’s parcel layer does not use it.', cost: 'Paid', href: 'https://regrid.com/plans' },
    { key: 'BRIDGE_BROWSER_TOKEN', label: 'Bridge Interactive token', what: 'Browser access to Bridge listing data.', cost: 'Account', href: 'https://bridgedataoutput.com/docs/explorer' },
    { key: 'BRIDGE_DATASET', label: 'Bridge dataset code', what: 'Leave blank for Bridge’s sample data; once MLS access is approved, the code Bridge assigns to that MLS.', cost: 'Account', href: 'https://bridgedataoutput.com/docs/explorer/reso-web-api' }
  ];
  function apiSetup() {
    return '<details class="dt-maint"><summary>For maintainers: data service keys</summary>' +
      '<h2>API configuration</h2><p>Maintainer setup, not needed to use the site. The scheduled data builds supply the Census and FRED keys privately, so every page here reads saved copies and needs no key. A browser shows “Not set” for each key unless one was entered on the live page.</p>' +
      '<h2>API key setup</h2><p>On the live Data quality page a maintainer can enter a key for testing. It is saved only in that browser and never sent to a server. This site never asks for a key.</p>' +
      '<ul class="pw-list">' + KEYS.map(function (k) {
        return '<li><p><strong>' + esc(k.label) + '</strong> <span class="src-status">' + esc(k.cost) + '</span></p><p class="note">' + esc(k.what) + ' <a href="' + esc(k.href) + '">Get one ↗</a></p></li>';
      }).join('') + '</ul><p><a href="' + LIVE + 'dashboard-data-quality.html">Key setup on the live Data quality page ↗</a></p></details>';
  }

  // ---------- Data status ----------
  // The live page's own checks (js/data-quality-check.js), run here against the site's copy of each file.
  var dq = { reports: null, error: null, started: false };
  var FRESH = { fresh: 'Fresh', aging: 'Aging', stale: 'Stale', unknown: 'No date in file' };
  function status() {
    var D = global.DataQuality;
    var head = T.head({
      kind: 'data', crumbs: T.trail('data', 'Data status'), title: 'Data status',
      answer: 'Whether the four datasets the main tools depend on load, hold what they should, and are recent enough for how often they change.',
      // The checks run in the browser when the page opens, as on the live page, so the stamp is today.
      meta: dq.reports ? T.stamp('Checked', new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })) : ''
    });
    if (!D) return head + '<p class="callout">The site’s data checks did not load.</p>';
    if (!dq.started) {
      dq.started = true;
      D.runAll().then(function (r) { dq.reports = r; Shell.render(); }, function (e) { dq.error = String(e && e.message || e); Shell.render(); });
    }
    if (dq.error) return head + '<p class="callout">The checks did not finish (' + esc(dq.error) + ').</p>';
    if (!dq.reports) return head + '<p role="status" class="note">Checking each dataset…</p>';
    var r = dq.reports, good = r.filter(function (x) { return x.ok; }).length;
    var by = function (k) { return r.filter(function (x) { return x.freshness === k; }).length; };
    var ages = [['fresh', 'fresh'], ['aging', 'aging'], ['stale', 'stale'], ['unknown', 'without a date the check can read']].filter(function (k) { return by(k[0]); })
      .map(function (k) { return by(k[0]) + ' ' + k[1]; });
    return head +
      UI.intro('Are the datasets behind the main tools healthy today?', good + ' of ' + r.length + ' datasets pass their checks' + (function () {
        var warn = r.filter(function (x) { return !x.ok && !x.critical; }).length, err = r.filter(function (x) { return !x.ok && x.critical; }).length;
        return warn || err ? ' (' + [warn ? warn + ' with a warning' : '', err ? err + ' with an error' : ''].filter(Boolean).join(', ') + ')' : '';
      })() + '. By age: ' + ages.join(', ') + '.') +
      '<ul class="dq-cards">' + r.map(function (x) {
        return '<li class="dq-card ' + (x.ok ? 'dq-ok' : 'dq-bad') + '"><p class="dq-name"><strong>' + esc(x.label) + '</strong></p>' +
          '<p><span class="dq-word">' + (x.ok ? 'Passes its check' : 'Fails its check') + '</span> · <span class="fresh-word">' + esc(FRESH[x.freshness] || x.freshness) + '</span></p>' +
          (x.coverageLabel ? '<p class="dq-what">' + esc(x.coverageLabel) + '</p>' : '') +
          '<p class="dq-n">' + (x.featureCount ? num(x.featureCount) + ' records · ' : '') + (x.dataAsOf ? 'Data as of ' + esc(day(x.dataAsOf)) : 'No date recorded in the file') + '</p>' +
          (x.message ? '<p class="note">' + esc(x.message) + '</p>' : '') +
          (x.sourceUrl ? '<p class="metric-source"><a href="' + esc(x.sourceUrl) + '">' + esc(x.sourceLabel || 'Source') + '</a></p>' : '') + '</li>';
      }).join('') + '</ul>' +
      '<p class="note">Checked in your browser when this page opened, against the site’s copy of each file. “Fresh”, “Aging” and “Stale” use each dataset’s own window: FRED weekly, CHFA tax credit properties every two weeks, county boundaries and the county affordability gap yearly. A stale file is older than its source usually updates, not a broken page; the site keeps the last good copy. The checks re-read the files; they do not fetch new data, which the scheduled builds do.</p>' +
      '<h2>All data sources</h2><p>What is fresh, and what is estimated or aging? Every dataset the main tools rely on, one row each.</p>' +
      '<div data-no-source="catalog: the site’s own dataset checks, run when this page opens">' + UI.table('dqall', 'The datasets behind the main tools and their checks', [
        { key: 'label', label: 'Dataset' },
        { key: 'result', label: 'Result', tip: 'Passes, or fails as a warning or as an error for a dataset a main tool cannot run without' },
        { key: 'n', label: 'Records', num: true, fmt: function (v) { return num(v); } },
        { key: 'asOf', label: 'Data as of', tip: 'The date the file records for its own data' },
        { key: 'age', label: 'Age', tip: 'How recent the copy is against its window' },
        { key: 'msg', label: 'Notes' }
      ], r.map(function (x) {
        return { label: x.label, result: x.ok ? 'Passes' : x.critical ? 'Error' : 'Warning', n: x.featureCount > 0 ? x.featureCount : null, asOf: x.dataAsOf ? day(x.dataAsOf) : null, age: FRESH[x.freshness] || x.freshness, msg: x.message || null };
      }), { noun: 'datasets', placeholder: 'Dataset' }) + '</div>' +
      contentFreshness() +
      T.next('Next', [{ href: '#/data/quality', label: 'Data quality →' }, { href: '#/data/sources', label: 'Every source', secondary: true }]);
  }

  // ---------- Content freshness ----------
  // The live page's alert pipeline card: when the news and policy feed last ran (data/policy_briefs.json, meta),
  // warned when it is more than 7 days old or has no feeds.
  function contentFreshness() {
    var s = UI.load({ briefs: 'data/policy_briefs.json' });
    var head = '<h2>Content freshness</h2>';
    if (s.error) return head + '<p class="note">The news and policy feed’s status is unavailable.</p>';
    if (!s.data) return head + '<p class="note">Checking the news and policy feed…</p>';
    var m = s.data.briefs.meta || {}, gen = m.generated ? new Date(m.generated) : null;
    var age = gen ? Math.floor((Date.now() - gen.getTime()) / 86400000) : null;
    var alerts = m.source_alerts || m.alert_count || 0, active = (m.feed_count || 0) > 0 || alerts > 0, stale = age != null && age > 7;
    var word = !active ? 'No feeds' : stale ? 'May be stalled' : 'Running';
    return head + '<ul class="ds-content"><li class="' + (active && !stale ? 'dq-h-ok' : 'dq-h-mid') + '"><p class="dq-name"><strong>News and policy alerts</strong> <span class="src-status">' + esc(word) + '</span></p>' +
      '<p class="dq-what">' + esc(num(alerts)) + ' alerts from public sources' + (m.brief_count ? ' and ' + esc(num(m.brief_count)) + ' briefs' : '') + '. Last run ' + esc(day(m.generated) || '—') + (age != null ? ' (' + age + ' day' + (age === 1 ? '' : 's') + ' ago)' : '') + '.</p>' +
      '<p class="note">' + (stale ? 'More than 7 days since the last run; the feed may be stalled.' : 'Flagged when the feed has not run in 7 days.') + ' <a href="#/news">Housing news</a>.</p></li></ul>';
  }

  // ---------- Glossary ----------
  // The live site's Glossary panel (js/glossary.js) as a page: every term in data/glossary.json, in the file's
  // own words, with a filter. No term or definition is written here.
  function glossary() {
    var s = UI.load({ g: 'data/glossary.json' });
    if (!s.data) return loading('Glossary', s);
    var terms = (s.data.g.terms || []).slice().sort(function (a, b) { return String(a.term).localeCompare(String(b.term), 'en', { sensitivity: 'base' }); });
    var rows = terms.map(function (t) { return { term: t.term, full: t.full || '', def: t.definition || t.short || '' }; });
    return T.head({
      kind: 'data', crumbs: T.trail('data', 'Glossary'), title: 'Glossary',
      answer: 'Plain definitions of the ' + num(rows.length) + ' tax credit and housing terms used on this site.',
      meta: day(s.data.g.updated) ? T.stamp('Updated', day(s.data.g.updated)) : ''
    }) +
      '<div data-no-source="definition: plain-language terms">' + UI.table('gloss', 'Housing and tax credit terms', [
        { key: 'term', label: 'Term', tip: 'The term or its initials, as pages print it' },
        { key: 'full', label: 'Stands for', tip: 'The full name, where the term is a short form' },
        { key: 'def', label: 'What it means', tip: 'The site’s own definition' }
      ], rows, { noun: 'terms', placeholder: 'Term or word' }) + '</div>' +
      '<p class="note">Definitions are COHO’s own plain summaries, not legal definitions. For the rule itself, follow the source named on the page where the term is used.</p>' +
      T.next('Next', [{ href: '#/guide/methods', label: 'How the numbers are made →' }, { href: '#/data', label: 'Data and methods', secondary: true }]);
  }

  // ---------- Data explorer ----------
  // Files that feed member tools are left out of the list.
  var MEMBER = /^(jurisdiction-briefs|entitled-land|alerts)\/|^reports\/developer-/;
  var KIND = { json: 'JSON', geojson: 'Map (GeoJSON)', csv: 'Table (CSV)' };
  function explorer(params) {
    var s = UI.load({ files: 'data/_manifest.json' });
    if (!s.data) return loading('Data explorer', s);
    var m = s.data.files, all = m.files.filter(function (f) { return !MEMBER.test(f.path); });
    var newest = all.reduce(function (a, f) { return f.mtime > a ? f.mtime : a; }, '');
    var folders = UI.tally(all, function (f) { return f.path.indexOf('/') > -1 ? f.path.split('/')[0] : 'top level'; });
    var pick = params.get('file'), f = pick && all.filter(function (x) { return x.path === pick; })[0];
    var detail = f ? '<section class="dex-file" id="dex-file" tabindex="-1" aria-labelledby="dex-file-h"><h2 id="dex-file-h">' + esc(f.path) + '</h2>' +
      '<dl class="dex-meta"><div><dt>Kind</dt><dd>' + esc(KIND[f.kind] || f.kind) + '</dd></div><div><dt>Size</dt><dd>' + esc(mb(f.size_bytes)) + '</dd></div>' +
      '<div><dt>Updated</dt><dd>' + esc(day(f.mtime)) + '</dd></div>' +
      (f.primary_array_length != null ? '<div><dt>Records</dt><dd>' + esc(num(f.primary_array_length)) + (f.primary_array_key ? ' in “' + esc(f.primary_array_key) + '”' : '') + '</dd></div>' : '') + '</dl>' +
      (f.keys && f.keys.length ? '<p class="dex-keys-h">Fields at the top of the file</p><ul class="dex-keys">' + f.keys.map(function (k) { return '<li><code>' + esc(k) + '</code></li>'; }).join('') + '</ul>' : '') +
      (f.primary_array_first_keys && f.primary_array_first_keys.length ? '<p class="dex-keys-h">Fields in each record</p><ul class="dex-keys">' + f.primary_array_first_keys.map(function (k) { return '<li><code>' + esc(k) + '</code></li>'; }).join('') + '</ul>' : '') +
      '<p><a class="button-link secondary" href="' + esc(LIVE + 'data/' + f.path) + '">Open the file (' + esc(mb(f.size_bytes)) + ') ↗</a></p></section>' : '';
    var rows = all.map(function (x) {
      return { path: x.path, folder: x.path.indexOf('/') > -1 ? x.path.split('/')[0] : 'top level', kind: KIND[x.kind] || x.kind, size: x.size_bytes, records: x.primary_array_length, updated: day(x.mtime) };
    });
    return T.head({
      kind: 'data', crumbs: T.trail('data', 'Data explorer'), title: 'Data explorer',
      answer: 'Every data file behind the site’s pages: what it holds, how big it is and when it last changed. Pick a file to see its fields.',
      meta: '<span class="scope-tag">List made ' + esc(day(m.meta.generated_at)) + '</span> Files that feed member tools are not listed.',
      facts: [
        { value: num(all.length), label: 'Data files', source: 'COHO file list', href: LIVE + 'data-explorer.html' },
        { value: mb(all.reduce(function (a, x) { return a + x.size_bytes; }, 0)), label: 'In all', source: 'COHO file list', href: LIVE + 'data-explorer.html' },
        { value: day(newest), label: 'Most recent change', source: 'COHO file list', href: LIVE + 'data-explorer.html' }
      ]
    }) + detail +
      UI.bars('Files by folder', 'Most of the files are the housing needs assessment’s one file per place.', folders.slice(0, 10), num) + T.source('COHO file list', LIVE + 'data-explorer.html', 'made ' + day(m.meta.generated_at)) +
      UI.table('files', 'Every data file', [
        { key: 'path', label: 'File', href: function (r) { return '#/data/explorer?file=' + encodeURIComponent(r.path); } },
        { key: 'kind', label: 'Kind' },
        { key: 'size', label: 'Size', num: true, fmt: function (v) { return mb(v); } },
        { key: 'records', label: 'Records', num: true, fmt: function (v) { return num(v); }, tip: 'Rows in the file’s main list, where it has one' },
        { key: 'updated', label: 'Updated' }
      ], rows, { noun: 'files', placeholder: 'File or folder name' }) + T.source('COHO file list', LIVE + 'data-explorer.html', 'made ' + day(m.meta.generated_at)) +
      // The live explorer's CSV button: the whole file list, as listed here.
      (global.LabOpportunities && global.LabOpportunities.csvLink ? global.LabOpportunities.csvLink('coho-data-files', 'Download the file list (CSV)', ['File', 'Kind', 'Size (bytes)', 'Records', 'Updated'],
        rows.map(function (r) { return [r.path, r.kind, r.size, r.records == null ? '' : r.records, r.updated || '']; })) : '') +
      T.next('Next', [{ href: '#/data/map', label: 'See the map files on a map →' }, { href: '#/data/sources', label: 'Who publishes each source', secondary: true }]);
  }

  // ---------- Data map ----------
  // Built in data-map.js (layers, search and "What's here").
  function dataMap(params) { return global.LabDataMap.view(params); }

  global.LabDataMore = { glossary: glossary, trust: trust, explorer: explorer, map: dataMap, quality: quality, status: status, CHECKS: CHECKS, MEMBER: MEMBER, PROBE_PATHS: PROBE_PATHS, HEALTH: HEALTH, scan: scan, placeBuckets: placeBuckets };
})(window);
