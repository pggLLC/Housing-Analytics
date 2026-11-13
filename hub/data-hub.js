// Data and methods: the menu's hub (#/data) and Data sources (#/data/sources). Sources come from the live
// site's own registry (js/data-source-inventory.js, window.DataSourceInventory); its status and freshness
// rules are the registry's, not the lab's. Status is worked out against today's date from the dates in the
// pinned copy, so it ages as the copy does.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl, UI = global.LabUI;
  var esc = Shell.esc, num = UI.num;
  var LIVE = 'https://cohoanalytics.com/dashboard-data-sources-ui.html';
  // Each status says what it means in words; colour is never the only signal.
  var STATUS = {
    current: ['Current', 'Updated within its declared cadence'],
    aging: ['Aging', 'Past most of its cadence; due soon'],
    stale: ['Stale', 'Older than its cadence allows'],
    live: ['Live', 'Read on demand; no snapshot date'],
    curated: ['Kept by hand', 'Maintained by hand; no cadence to measure'],
    planned: ['Planned', 'Listed, not yet brought in'],
    unavailable: ['Unavailable', 'Cannot be refreshed; last good copy kept'],
    unknown: ['No date', 'No update date recorded']
  };
  function pill(st) { var s = STATUS[st] || [st, '']; return '<span class="src-status src-' + esc(st) + '" title="' + esc(s[1]) + '">' + esc(s[0]) + '</span>'; }
  // A few registry names carry an HTML entity ("Parcel &amp; Zoning"); read them as text. Folder prefixes on file
  // names ("data/…") are dropped, as the live tables show them.
  function plain(t) { return String(t == null ? '' : t).replace(/&amp;/g, '&').replace(/\bdata\//g, ''); }
  function safe(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }

  // 4.1: every source counted once by status, as one bar and a row of tiles. Each tile carries the status word
  // and its meaning, so colour is never the only signal; the ones that need attention jump to their list.
  var FRESH_COLOR = { current: 'var(--c-green)', aging: 'var(--c-amber)', stale: 'var(--rust)', unavailable: 'var(--text-rust)', live: 'var(--c-blue)', curated: 'var(--c-purple)', planned: 'var(--grey)', unknown: 'var(--grey-line)' };
  function freshness(all, order) {
    var n = {}; all.forEach(function (s) { n[s.status] = (n[s.status] || 0) + 1; });
    var shown = order.filter(function (k) { return n[k]; });
    var bar = '<div class="fresh-bar" aria-hidden="true">' + shown.map(function (k) {
      return '<span style="flex:' + n[k] + ';background:' + FRESH_COLOR[k] + '" title="' + esc(STATUS[k][0] + ': ' + n[k]) + '"></span>';
    }).join('') + '</div>';
    var tiles = '<ul class="fresh-tiles">' + shown.map(function (k) {
      var att = k === 'aging' || k === 'stale' || k === 'unavailable';
      var inner = '<span class="fresh-n">' + num(n[k]) + '</span><span class="fresh-word"><span class="fresh-dot" style="background:' + FRESH_COLOR[k] + '" aria-hidden="true"></span>' + esc(STATUS[k][0]) + '</span><span class="fresh-why">' + esc(STATUS[k][1]) + '</span>';
      return '<li>' + (att ? '<a href="' + esc(location.hash.split('?')[0]) + '" data-jump="needs-attention">' + inner + '</a>' : inner) + '</li>';
    }).join('') + '</ul>';
    return '<section class="fresh" aria-label="Sources by status"><h2>How fresh the sources are</h2>' + bar + tiles +
      '<p class="note">Each of the ' + num(all.length) + ' sources is counted once. Aging, stale and unavailable tiles open the list of what needs attention.</p></section>';
  }

  // ---------- Sources: the live Data sources dashboard's views, from the same registry ----------
  var DAY = 86400000;
  // Days until a source is due again: its last update plus its declared window (js/temporal-dashboard.js).
  function daysUntil(s) {
    if (!s.lastUpdated || !s.maxAgeDays) return null;
    var t = new Date(s.lastUpdated).getTime();
    return isNaN(t) ? null : Math.ceil((t + s.maxAgeDays * DAY - Date.now()) / DAY);
  }
  function dueText(s) {
    var u = daysUntil(s);
    if (u == null) return '';
    if (u < 0) return Math.abs(u) + ' days overdue';
    if (u === 0) return 'Due today';
    return 'Due in ' + u + ' day' + (u === 1 ? '' : 's');
  }
  // Statewide, part of the state or none, read from the registry's coverage words (js/geographic-dashboard.js).
  function coverage(s, county) {
    var cov = String(s.coverage || '').toLowerCase();
    if (county) {
      if (cov.includes('statewide') || cov.includes('64 count') || cov.includes('all count')) return 'full';
      if (cov.includes(county.toLowerCase())) return 'full';
      if (cov.includes('metro') || cov.includes('region')) return 'partial';
      return 'none';
    }
    if (cov.includes('statewide') || cov.includes('64 count') || cov.includes('all count') || cov.includes('national')) return 'full';
    if (cov.includes('county') || cov.includes('metro') || cov.includes('region')) return 'partial';
    if (cov.includes('colorado')) return 'partial';
    return 'none';
  }
  var COV = { full: ['Statewide', '●'], partial: ['Part of the state', '◐'], none: ['Not covered', '○'] };
  var COUNTIES = ['Adams', 'Alamosa', 'Arapahoe', 'Archuleta', 'Baca', 'Bent', 'Boulder', 'Broomfield', 'Chaffee', 'Cheyenne', 'Clear Creek', 'Conejos', 'Costilla',
    'Crowley', 'Custer', 'Delta', 'Denver', 'Dolores', 'Douglas', 'Eagle', 'Elbert', 'El Paso', 'Fremont', 'Garfield', 'Gilpin', 'Grand', 'Gunnison',
    'Hinsdale', 'Huerfano', 'Jackson', 'Jefferson', 'Kiowa', 'Kit Carson', 'La Plata', 'Lake', 'Larimer', 'Las Animas', 'Lincoln', 'Logan', 'Mesa', 'Mineral',
    'Moffat', 'Montezuma', 'Montrose', 'Morgan', 'Otero', 'Ouray', 'Park', 'Phillips', 'Pitkin', 'Prowers', 'Pueblo', 'Rio Blanco', 'Rio Grande',
    'Routt', 'Saguache', 'San Juan', 'San Miguel', 'Sedgwick', 'Summit', 'Teller', 'Washington', 'Weld', 'Yuma'];
  // Where a source is used, when the registry does not say: the live Trust center's own guess from its tags.
  var USED = { lihtc: ['LIHTC Dashboard', 'Compliance Dashboard', 'Market Analysis'], chfa: ['LIHTC Dashboard', 'CHFA Portfolio'], fred: ['Economic Dashboard', 'Colorado Market'],
    census: ['Housing Needs Assessment', 'Colorado Deep Dive'], hud: ['LIHTC Dashboard', 'Housing Needs Assessment'], ami: ['Housing Needs Assessment', 'Compliance Dashboard'],
    car: ['Colorado Market', 'Economic Dashboard'], boundaries: ['All Maps'], amenity: ['Market Analysis'], nhpd: ['Preservation Dashboard'] };
  function whereUsed(s) {
    if (s.whereUsed && s.whereUsed.length) return s.whereUsed;
    var tags = (s.tags || []).join(' ').toLowerCase() + ' ' + String(s.id || '').toLowerCase(), out = [];
    Object.keys(USED).forEach(function (k) { if (tags.indexOf(k) > -1) USED[k].forEach(function (u) { if (out.indexOf(u) < 0) out.push(u); }); });
    return out;
  }
  // A local file name without its folder prefix, as the live tables show it.
  function fileName(f) { return f ? String(f).replace(/^data\//, '') : null; }
  function score(v) { return v == null ? '—' : v + '%'; }
  function meter(v, label) {
    if (v == null) return '<span class="ds-meter-none">No cadence to score</span>';
    var cls = v >= 70 ? 'ok' : v >= 40 ? 'mid' : 'low';
    return '<span class="ds-meter" role="img" aria-label="' + esc((label ? label + ': ' : '') + v + '% fresh') + '"><span class="ds-meter-fill ds-' + cls + '" style="width:' + v + '%"></span></span><span class="ds-meter-n">' + v + '%</span>';
  }

  // One source's full record, as the live Trust center's Metadata window shows it.
  function sourceDetail(s) {
    var u = safe(s.url), used = whereUsed(s);
    var rows = [['Group', plain(s.category)], ['Format', s.format], ['Published by', plain(s.provider)], ['Coverage', plain(s.coverage)], ['Unit', s.geoUnit],
      ['What it holds', plain(s.features)], ['Brought in', s.lastUpdated], ['Expected', s.updateFrequency], ['Status', (STATUS[s.status] || [s.status])[0]],
      ['Kept', s.maintenance || 'Automated refresh'], ['Why', s.maintenanceNote], ['Last known good', s.lastKnownGood], ['Freshness', s.freshnessScore != null ? s.freshnessScore + '%' : null],
      ['Site file', fileName(s.localFile)], ['Tags', (s.tags || []).join(', ')]];
    return '<section class="ds-detail" id="ds-detail" tabindex="-1" aria-labelledby="ds-detail-h"><h2 id="ds-detail-h">' + esc(plain(s.name)) + ' ' + pill(s.status) + '</h2>' +
      (s.description ? '<p>' + esc(plain(s.description)) + '</p>' : '') +
      '<dl class="dex-meta">' + rows.filter(function (r) { return r[1] != null && r[1] !== ''; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (used.length ? '<p><strong>Used in:</strong> ' + esc(used.join(', ')) + '</p>' : '') +
      (s.alternatives && s.alternatives.length ? '<h3>Other sources for the same figures</h3><ul class="ds-alt">' + s.alternatives.map(function (a) {
        return '<li>' + (safe(a.url) ? '<a href="' + esc(a.url) + '">' + esc(plain(a.title)) + '</a>' : esc(plain(a.title))) + (a.description ? ': ' + esc(plain(a.description)) : '') + '</li>';
      }).join('') + '</ul>' : '') +
      '<p class="actions">' + (u ? '<a class="button-link secondary" href="' + esc(u) + '">' + esc(plain(s.provider) || 'Source') + ' ↗</a> ' : '') +
      (s.apiEndpoint && safe(s.apiEndpoint) ? '<a class="button-link secondary" href="' + esc(s.apiEndpoint) + '">Live data service ↗</a> ' : '') +
      '<a class="button-link secondary" href="#/data/sources">Close</a></p></section>';
  }

  // Due soon, recent activity, freshness by group and by source, the next 30 days, and coverage.
  function dueSoon(I) {
    var due = I.getDueSoon(30).sort(function (a, b) { return daysUntil(a) - daysUntil(b); });
    return '<section class="ds-col" aria-labelledby="ds-due"><h2 id="ds-due">Due soon: the next 30 days</h2>' +
      (due.length ? '<ul class="ds-due">' + due.map(function (s) {
        return '<li><strong>' + esc(plain(s.name)) + '</strong> <span class="ds-when">' + esc(dueText(s)) + '</span><span class="note">' + esc(plain(s.category)) + '. Updates ' + esc(String(s.updateFrequency || 'with no set cadence').toLowerCase()) + '; last brought in ' + esc(s.lastUpdated || '—') + '.</span></li>';
      }).join('') + '</ul>' : '<p class="note">No source is due for a refresh in the next 30 days.</p>') + '</section>';
  }
  function recent(all) {
    var r = all.filter(function (s) { return s.lastUpdated; }).sort(function (a, b) { return new Date(b.lastUpdated) - new Date(a.lastUpdated); }).slice(0, 15);
    return '<section class="ds-col" aria-labelledby="ds-recent"><h2 id="ds-recent">Recent activity</h2><p class="note">The 15 sources brought in most recently.</p><ol class="ds-recent">' + r.map(function (s) {
      return '<li><span class="ds-date">' + esc(String(s.lastUpdated).slice(0, 10)) + '</span> <span>' + esc(plain(s.name)) + '</span> ' + pill(s.status) + '</li>';
    }).join('') + '</ol></section>';
  }
  function byGroup(all) {
    var cats = {};
    all.forEach(function (s) { var c = plain(s.category) || 'Other'; (cats[c] = cats[c] || []).push(s); });
    return '<h2 id="ds-groups">Freshness by group</h2><p class="note">Each group’s average freshness: 100% means just brought in, 0% means at the end of its window. Hand-kept and planned sources have no window, so they are not scored.</p>' +
      '<ul class="ds-groups">' + Object.keys(cats).sort().map(function (c) {
        var xs = cats[c], scored = xs.filter(function (s) { return s.freshnessScore != null; });
        var avg = scored.length ? Math.round(scored.reduce(function (a, s) { return a + s.freshnessScore; }, 0) / scored.length) : null;
        var stale = xs.filter(function (s) { return s.status === 'stale'; }).length;
        return '<li><p class="ds-group-h">' + esc(c) + '</p><p>' + meter(avg, c) + '</p><p class="note">' + xs.length + ' source' + (xs.length === 1 ? '' : 's') + (stale ? ', <strong class="ds-stale">' + stale + ' stale</strong>' : '') + '</p></li>';
      }).join('') + '</ul>';
  }
  function bySource(all) {
    var sorted = all.slice().sort(function (a, b) {
      if (a.daysSinceUpdate == null) return 1; if (b.daysSinceUpdate == null) return -1; return b.daysSinceUpdate - a.daysSinceUpdate;
    });
    var row = function (s) {
      return '<li><p class="ds-src-h"><span>' + esc(plain(s.name)) + '</span> ' + pill(s.status) + '</p><p class="ds-src-m">' + meter(s.freshnessScore, plain(s.name)) +
        '<span class="note">' + esc([plain(s.category), s.updateFrequency, s.lastUpdated ? 'last ' + s.lastUpdated : null, dueText(s)].filter(Boolean).join(' · ')) + '</span></p></li>';
    };
    return '<h2 id="ds-by-source">Data freshness by source</h2><p class="note">Oldest first, so the ones nearest their next refresh lead.</p>' +
      '<ol class="ds-sources">' + sorted.slice(0, 12).map(row).join('') + '</ol>' +
      (sorted.length > 12 ? '<details class="ds-more"><summary>All ' + sorted.length + ' sources</summary><ol class="ds-sources" start="13">' + sorted.slice(12).map(row).join('') + '</ol></details>' : '');
  }
  function schedule(all) {
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var days = [];
    for (var i = 0; i < 30; i++) days.push({ d: new Date(Date.now() + i * DAY), list: [] });
    all.forEach(function (s) { var u = daysUntil(s); if (u != null && u >= 0 && u < 30) days[u].list.push(plain(s.name)); });
    var busy = days.filter(function (x) { return x.list.length; });
    var label = function (x) { return MON[x.d.getMonth()] + ' ' + x.d.getDate(); };
    return '<h2 id="ds-schedule">30-day update schedule</h2><p class="note">Sources whose window runs out on each of the next 30 days, from today.</p>' +
      '<ol class="ds-cal" aria-label="Sources due each day for the next 30 days">' + days.map(function (x, i) {
        var n = x.list.length;
        var short = i === 0 || x.d.getDate() === 1 ? label(x) : String(x.d.getDate());
        return '<li class="' + (n ? (n >= 3 ? 'ds-cal-3' : 'ds-cal-1') : '') + (i === 0 ? ' ds-today' : '') + '"' + (n ? ' title="' + esc(x.list.join(', ')) + '"' : '') + '><span class="ds-cal-d"><span class="visually-hidden">' + esc(label(x)) + '</span><span aria-hidden="true">' + esc(short) + '</span></span><span class="ds-cal-n">' + (n ? n + ' due' : '<span class="visually-hidden">none due</span>') + '</span></li>';
      }).join('') + '</ol>' +
      (busy.length ? '<ul class="ds-cal-list">' + busy.map(function (x) { return '<li><strong>' + esc(label(x)) + ':</strong> ' + esc(x.list.join(', ')) + '</li>'; }).join('') + '</ul>' : '<p class="note">Nothing falls due in the next 30 days.</p>');
  }
  function coverageViews(all, county) {
    var n = { full: 0, partial: 0, none: 0 };
    all.forEach(function (s) { n[coverage(s)]++; });
    var cats = {};
    all.forEach(function (s) { var c = plain(s.category) || 'Other'; var o = cats[c] = cats[c] || { full: 0, partial: 0, none: 0, total: 0 }; o[coverage(s)]++; o.total++; });
    // Colorado's border is a rectangle; the map shades it by how many sources reach all of it.
    var W = 360, H = 260, fullW = Math.round(W * n.full / all.length), partW = Math.round(W * n.partial / all.length);
    var map = '<figure class="ds-cov-map" data-no-source="catalog: drawn from COHO’s own source registry"><svg viewBox="0 0 ' + W + ' ' + (H + 40) + '" role="img" aria-label="' + esc('Colorado: ' + n.full + ' of ' + all.length + ' sources cover the whole state, ' + n.partial + ' part of it, ' + n.none + ' none') + '">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" class="ds-co"/>' +
      '<rect x="0" y="' + (H - 18) + '" width="' + fullW + '" height="18" class="ds-cov-full"/><rect x="' + fullW + '" y="' + (H - 18) + '" width="' + partW + '" height="18" class="ds-cov-part"/>' +
      '<text x="' + W / 2 + '" y="' + (H / 2 - 10) + '" text-anchor="middle" class="ds-co-n">' + n.full + ' of ' + all.length + '</text>' +
      '<text x="' + W / 2 + '" y="' + (H / 2 + 18) + '" text-anchor="middle" class="ds-co-t">sources cover all of Colorado</text>' +
      '<text x="0" y="' + (H + 28) + '" class="ds-co-l">● Statewide ' + n.full + '   ◐ Part of the state ' + n.partial + '   ○ None ' + n.none + '</text></svg>' +
      '<figcaption class="note">Colorado’s border drawn to scale. The band along the bottom splits the ' + all.length + ' sources by how much of the state each one covers, from its registry entry.</figcaption></figure>';
    var groups = '<h3 id="ds-cov-groups">Coverage by group</h3><ul class="ds-groups">' + Object.keys(cats).sort().map(function (c) {
      var o = cats[c], pct = o.total ? Math.round(o.full * 100 / o.total) : 0;
      return '<li><p class="ds-group-h">' + esc(c) + '</p><p>' + meter(pct, c + ' statewide') + '</p>' +
        '<p class="ds-cov-n"><span>● ' + o.full + ' statewide</span> <span>◐ ' + o.partial + ' part</span> <span>○ ' + o.none + ' none</span></p></li>';
    }).join('') + '</ul>';
    var c = COUNTIES.indexOf(county) > -1 ? county : 'Denver';
    var rows = all.map(function (s) { var k = coverage(s, c); return { name: plain(s.name), group: plain(s.category), unit: s.geoUnit, here: COV[k][1] + ' ' + (k === 'full' ? 'Covered' : COV[k][0]), state: COV[coverage(s)][1] + ' ' + COV[coverage(s)][0], cov: plain(s.coverage) }; });
    var matrix = '<h3 id="ds-cov-matrix">Coverage matrix</h3><p class="note">Which sources reach one county. Pick a county:</p>' +
      '<p><label for="ds-county" class="visually-hidden">County</label><select id="ds-county" data-ds-county>' + COUNTIES.map(function (x) { return '<option' + (x === c ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></p>' +
      '<details class="ds-more"' + (COUNTIES.indexOf(county) > -1 ? ' open' : '') + '><summary>Every source in ' + esc(c) + ' County</summary><div data-no-source="catalog: COHO’s own source registry">' + UI.table('covm', 'Each source’s reach in ' + c + ' County and statewide', [
        { key: 'name', label: 'Source' }, { key: 'here', label: c + ' County', tip: 'Read from the coverage words in the source’s registry entry' },
        { key: 'state', label: 'Colorado' }, { key: 'unit', label: 'Unit' }, { key: 'cov', label: 'Coverage, as listed' }
      ], rows, { noun: 'sources', placeholder: 'Source or group' }) + '</div></details>';
    var here = { full: 0, partial: 0, none: 0 }; all.forEach(function (s) { here[coverage(s, c)]++; });
    matrix = matrix.replace('<details', '<p>In ' + esc(c) + ' County: <strong>' + here.full + '</strong> sources cover it, ' + here.partial + ' cover part of it, ' + here.none + ' do not.</p><details');
    return '<h2 id="ds-coverage">Coverage map</h2>' + map + groups + matrix;
  }

  // Exports, as the live dashboard offers them: the registry as CSV or JSON, and the freshness report.
  var EXPORT_COLS = ['id', 'name', 'category', 'format', 'status', 'lastUpdated', 'updateFrequency', 'features', 'provider', 'url'];
  function exportFile(kind) {
    var I = global.DataSourceInventory; if (!I) return;
    var all = I.getSources(), stats = I.getStats(), body, name, type;
    if (kind === 'csv') {
      body = [EXPORT_COLS.join(',')].concat(all.map(function (s) { return EXPORT_COLS.map(function (h) { return '"' + (s[h] != null ? plain(s[h]) : '').replace(/"/g, '""') + '"'; }).join(','); })).join('\n');
      name = 'data-sources-audit.csv'; type = 'text/csv';
    } else if (kind === 'json') {
      body = JSON.stringify(all, null, 2); name = 'data-sources-audit.json'; type = 'application/json';
    } else {
      var c = stats.counts;
      body = ['# Data Freshness Report', '', '**Generated:** ' + new Date().toISOString(), '', '## Summary', '', '| Metric | Value |', '|---|---|',
        '| Monitored Files | ' + stats.total + ' |', '| Current | ' + (c.current || 0) + ' |', '| Aging | ' + (c.aging || 0) + ' |', '| Stale | ' + (c.stale || 0) + ' |',
        '| Unknown | ' + (c.unknown || 0) + ' |', '| Avg Freshness | ' + (stats.avgFreshness != null ? stats.avgFreshness + '%' : 'N/A') + ' |', '']
        .concat(all.some(function (s) { return s.status === 'stale'; }) ? ['## Stale Sources', ''].concat(all.filter(function (s) { return s.status === 'stale'; }).map(function (s) { return '- ' + plain(s.name); }), ['']) : [])
        .concat(['## All Sources', '', '| Name | Category | Status | Days Since Update | Score |', '|---|---|---|---|---|'])
        .concat(all.map(function (s) { return '| ' + plain(s.name) + ' | ' + plain(s.category) + ' | ' + s.status + ' | ' + (s.daysSinceUpdate != null ? s.daysSinceUpdate : '—') + ' | ' + score(s.freshnessScore) + ' |'; })).join('\n') + '\n';
      name = 'data-freshness-report.md'; type = 'text/markdown';
    }
    var url = URL.createObjectURL(new Blob([body], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-ds-export]');
      if (b) { ev.preventDefault(); exportFile(b.getAttribute('data-ds-export')); }
    });
    document.addEventListener('change', function (ev) {
      if (!ev.target || !ev.target.hasAttribute || !ev.target.hasAttribute('data-ds-county')) return;
      // The pick stays in the address, so Back and a copied link return to the same county.
      history.replaceState(null, '', '#/data/sources?county=' + encodeURIComponent(ev.target.value));
      Shell.render();
      var sel = document.getElementById('ds-county'); if (sel) sel.focus();
    });
  }

  function sources(params) {
    var get = function (k) { return params && typeof params.get === 'function' ? params.get(k) : null; };
    var I = global.DataSourceInventory;
    var crumbs = T.trail('data', 'Data sources');
    if (!I) return T.head({ kind: 'data', crumbs: crumbs, title: 'Data sources' }) + '<p class="callout">The live site’s source registry did not load.</p>';
    var all = I.getSources(), stats = I.getStats();
    var order = ['current', 'aging', 'stale', 'live', 'curated', 'unavailable', 'planned', 'unknown'];
    var attention = all.filter(function (s) { return s.status === 'stale' || s.status === 'aging' || s.status === 'unavailable'; });
    var pick = get('source'), picked = pick && all.filter(function (s) { return s.id === pick; })[0];
    var rows = all.map(function (s) {
      return { id: s.id, name: plain(s.name), category: plain(s.category), provider: plain(s.provider), format: s.format, updated: s.lastUpdated, every: s.updateFrequency, status: s.status, statusLabel: (STATUS[s.status] || [s.status])[0], fresh: s.freshnessScore, cov: COV[coverage(s)][0], geo: s.geoUnit };
    });
    var apis = I.getApiSources ? I.getApiSources().filter(function (s) { return safe(s.apiEndpoint); }) : [];
    var newest = all.reduce(function (m, s) { return s.lastUpdated && s.lastUpdated > m ? s.lastUpdated : m; }, '');
    return T.head({
      kind: 'data', crumbs: crumbs, title: 'Data sources',
      answer: 'Every source behind the site, who publishes it, when it was last brought in and whether that is recent enough for how often it changes.',
      meta: '<span class="scope-tag">Status as of ' + esc(newest) + '</span> From each source’s own release date, by the live site’s rules.',
      facts: [
        { value: num(stats.total), label: 'Sources in the registry, in ' + stats.categories + ' groups', source: 'COHO source registry', href: LIVE },
        { value: num(stats.counts.current || 0), label: 'Current for their cadence', source: 'COHO source registry', href: LIVE },
        { value: num(attention.length), label: 'Aging, stale or unavailable', source: 'COHO source registry', href: LIVE }
      ]
    }) +
      (picked ? sourceDetail(picked) : '') +
      T.onThisPage([{ id: 'needs-attention', title: 'Needs attention' }, { id: 'ds-due', title: 'Due soon' }, { id: 'ds-groups', title: 'Freshness' }, { id: 'ds-schedule', title: 'Next 30 days' }, { id: 'ds-coverage', title: 'Coverage' }, { id: 'ds-all', title: 'Every source' }], true) +
      freshness(all, order) +
      (attention.length ? '<h2 id="needs-attention" tabindex="-1">Needs attention</h2><ul class="pw-list">' + attention.map(function (s) {
        var u = safe(s.url);
        return '<li><p>' + pill(s.status) + ' <strong>' + esc(plain(s.name)) + '</strong></p><p class="note">Last brought in ' + esc(s.lastUpdated || 'never') + (s.daysSinceUpdate != null ? ', ' + num(s.daysSinceUpdate) + ' days ago' : '') + '; expected ' + esc(s.updateFrequency || 'no cadence') + '.' + (u ? ' <a href="' + esc(u) + '">' + esc(plain(s.provider)) + '</a>' : '') + '</p>' +
          '<p class="note"><a href="#/data/sources?source=' + esc(encodeURIComponent(s.id)) + '">' + (s.maintenanceNote ? 'Why, and the last good copy' : 'Its full record') + ' →</a></p></li>';
      }).join('') + '</ul>' : '') +
      '<div class="ds-two">' + dueSoon(I) + recent(all) + '</div>' +
      byGroup(all) + bySource(all) + schedule(all) + coverageViews(all, get('county')) +
      '<h2 id="ds-all">Every source</h2>' +
      '<p class="note">' + order.filter(function (k) { return all.some(function (s) { return s.status === k; }); }).map(function (k) { return pill(k) + ' ' + esc(STATUS[k][1]); }).join('<br>') + '</p>' +
      '<p class="note">Pick a source’s name for its full record: what it holds, why it has no cadence where it has none, where it is used and other places to get the same figures.</p>' +
      UI.table('sources', 'Every data source, as the registry lists it', [
        { key: 'name', label: 'Source', href: function (r) { return '#/data/sources?source=' + encodeURIComponent(r.id); } },
        { key: 'category', label: 'Group' },
        { key: 'provider', label: 'Published by' },
        { key: 'format', label: 'Format' },
        { key: 'updated', label: 'Brought in', tip: 'Date the site last refreshed its copy' },
        { key: 'every', label: 'Expected', tip: 'How often the source changes, as the registry declares it' },
        { key: 'statusLabel', label: 'Status', tip: 'The registry’s own rule, worked out against today’s date' },
        { key: 'fresh', label: 'Freshness', num: true, fmt: function (v) { return v + '%'; }, tip: '100% just brought in; 0% at the end of its window' },
        { key: 'cov', label: 'Coverage', tip: 'Statewide, part of the state or none, read from the registry entry' },
        { key: 'geo', label: 'Unit' }
      ], rows, { noun: 'sources', placeholder: 'Source, group or publisher' }) +
      '<p class="actions ds-exports"><button type="button" class="button-link secondary" data-ds-export="csv">Download the list (CSV)</button> <button type="button" class="button-link secondary" data-ds-export="json">Full records (JSON)</button> <button type="button" class="button-link secondary" data-ds-export="md">Freshness report (Markdown)</button></p>' +
      (apis.length ? '<h2 id="ds-apis">Live data services</h2><p class="note">' + apis.length + ' sources can also be read straight from the publisher’s own service.</p><ul class="ds-apis">' + apis.map(function (s) {
        return '<li><strong>' + esc(plain(s.name)) + '</strong> <a href="' + esc(s.apiEndpoint) + '">' + esc(plain(s.provider) || 'Service') + ' service ↗</a></li>';
      }).join('') + '</ul>' : '') +
      '<p class="note">The status rules and the cadences are the live site’s (<a href="' + LIVE + '">Data sources on cohoanalytics.com</a>).</p>' +
      T.next('Next', [{ href: '#/guide/methods', label: 'How the numbers are made →' }, { href: '#/guide/about', label: 'About COHO', secondary: true }]);
  }

  // The hub: one card per page in the menu. No figure shows twice.
  function hub() {
    var m = global.LabNav.MENUS.filter(function (x) { return x.id === 'data'; })[0];
    var card = function (it) {
      return '<a class="hub-card' + (it.lab ? '' : ' is-live') + '" href="' + esc(global.LabNav.href(it)) + '"><span class="hub-card-title">' + esc(it.label) + (it.lab ? '' : ' <span class="live-tag">live site ↗</span>') + '</span><span class="hub-card-desc">' + esc(it.desc) + '</span></a>';
    };
    return T.head({ kind: 'hub', crumbs: [{ label: 'Home', href: '#/' }, { label: m.title }], title: m.title, answer: esc(m.question) }) +
      m.groups.map(function (g) { return '<h2>' + esc(g.title) + '</h2><div class="hub-cards">' + g.items.map(card).join('') + '</div>'; }).join('');
  }

  Shell.views.data = function (params, parts) {
    var M = global.LabDataMore;
    switch (parts[1]) {
      case 'sources': return sources(params);
      case 'trust': return M.trust();
      case 'explorer': return M.explorer(params);
      case 'map': return M.map(params);
      case 'quality': return M.quality();
      case 'status': return M.status();
      case 'glossary': return M.glossary();
      default: return hub();
    }
  };
  global.LabData = { sources: sources, hub: hub, STATUS: STATUS, coverage: coverage, daysUntil: daysUntil, COUNTIES: COUNTIES };
})(window);
