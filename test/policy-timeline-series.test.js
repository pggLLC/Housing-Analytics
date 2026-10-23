'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const { parseScript } = require('meriyah');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));
const feed = json('data/chfa-lihtc.json');
const timeline = json('data/policy/policy-timeline.json');
const geoConfig = json('data/hna/geo-config.json');
const helper = require('../js/components/lihtc-by-year.js');
const plain = v => JSON.parse(JSON.stringify(v));
const wait = async (fn, message = 'render completed') => { for (let i = 0; i < 400 && !fn(); i++) await new Promise(r => setTimeout(r, 5)); assert(fn(), message); };
// market-intelligence.html is now the Market Signals tab of colorado-deep-dive.html.
const pages = ['economic-dashboard.html', 'colorado-deep-dive.html'];
function render(page, data = feed, missing = [], hash) {
  const charts = new Map();
  const dom = new JSDOM(read(page), {
    // The Market Signals tab loads only when opened, so open it by hash.
    runScripts: 'dangerously', url: 'https://cohoanalytics.com/' + page + (hash !== undefined ? hash : page === 'colorado-deep-dive.html' ? '#tab-signals' : ''),
    pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.fetch = async url => {
        const rel = new URL(String(url), w.location.href).pathname.slice(1);
        if (missing.includes(rel)) return { ok: false, status: 503 };
        if (!rel.startsWith('data/') || !fs.existsSync(path.join(ROOT, rel))) return { ok: false, status: 404 };
        return { ok: true, json: async () => rel === 'data/chfa-lihtc.json' ? plain(data) : json(rel) };
      };
      w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.Chart = function (ctx, cfg) {
        this.type = cfg.type; this.data = cfg.data; this.options = cfg.options; this.update = () => {}; this.resize = () => {}; this.destroy = () => {};
        charts.set(ctx.id || ctx.canvas?.id, this);
      };
      w.Chart.getChart = id => charts.get(id);
      const nested = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : (t[k] = nested()) });
      w.Chart.defaults = nested();
      // The real inline page code runs; local dependencies are loaded in their
      // declared order. External map/CDN libraries are irrelevant to these cards.
      const doc = new JSDOM(read(page)).window.document;
      for (const script of doc.querySelectorAll('script[src]')) {
        const src = script.getAttribute('src');
        if (!missing.includes(src) && ['js/data-service-portable.js', 'js/components/policy-timeline.js', 'js/components/lihtc-by-year.js', 'js/historical-trends.js', 'js/market-intelligence.js'].includes(src)) w.eval(read(src));
      }
    }
  });
  return { dom, w: dom.window, doc: dom.window.document, charts };
}

// Independent aggregation of the actual CHFA file, not the helper's output.
function expected(data) {
  const rows = data.features.map(f => f.properties).filter(p => Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC) >= 1986 && Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC) <= new Date().getFullYear());
  const dates = rows.map(p => Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC));
  const years = Array.from({ length: Math.max(...dates) - Math.min(...dates) + 1 }, (_, i) => Math.min(...dates) + i);
  const values = (pred, field) => years.map(y => rows.filter(p => Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC) === y && pred(p)).reduce((n, p) => n + (field ? Number(p[field]) : 1), 0));
  return { years, range: years[0] + '–' + years.at(-1), rows, values };
}

test('all three real pages list exactly the curated timeline, with historical status and sources', async () => {
  assert(timeline.events.length > 0);
  let checked = 0;
  for (const page of pages) {
    const r = render(page);
    try {
      await wait(() => r.doc.querySelectorAll('[data-policy-event-id]').length);
      const items = [...r.doc.querySelectorAll('[data-policy-event-id]')];
      assert.deepEqual(items.map(e => e.dataset.policyEventId), timeline.events.map(e => e.id), page);
      for (const [i, item] of items.entries()) {
        const e = timeline.events[i];
        assert.equal(item.querySelector('[data-policy-detail]').textContent, e.detail);
        assert.equal(item.querySelector('a').href, e.source_url);
        assert.equal(item.dataset.policyStatus, e.date < new Date().toISOString().slice(0, 10) ? 'historical' : e.status);
        checked++;
      }
    } finally { r.dom.window.close(); }
  }
  assert.equal(checked, timeline.events.length * pages.length);
});

test('an unavailable timeline stays unavailable while the CHFA series can still render', async () => {
  for (const page of pages) {
    const r = render(page, feed, ['data/policy/policy-timeline.json']);
    try {
      await wait(() => r.doc.querySelector('[data-policy-timeline]').textContent.includes('could not be loaded'));
      assert.equal(r.doc.querySelectorAll('[data-policy-event-id]').length, 0);
      if (page === 'colorado-deep-dive.html') await wait(() => r.charts.has('chartLihtcTimeline') && r.charts.has('lihtcTrendChart'));
    } finally { r.dom.window.close(); }
  }
});

test('missing PolicyTimeline or a failed load preserves charts on every consumer and shows a visible note', async () => {
  let checked = 0;
  for (const missing of [['js/components/policy-timeline.js'], ['data/policy/policy-timeline.json']]) {
    for (const page of [...pages, 'construction-commodities.html']) {
      const r = render(page, feed, missing);
      try {
        if (page === 'construction-commodities.html') {
          r.w.createPriceChart('steel-chart', [{ name: 'Test', history: [{ date: '2025-01-01', value: 100 }] }], 'Test');
        }
        await wait(() => r.doc.querySelector('[data-policy-timeline-status]')?.hidden === false);
        assert.match(r.doc.querySelector('[data-policy-timeline-status]').textContent, /Policy timeline unavailable/);
        if (missing[0].endsWith('.js')) assert.equal(r.w.PolicyTimeline, undefined);
        const chartIds = page === 'colorado-deep-dive.html' ? ['foreclosure-chart', 'concessions-chart', 'chartLihtcTimeline', 'lihtcTrendChart'] :
          page === 'construction-commodities.html' ? ['steel-chart'] : [];
        await wait(() => r.charts.size > 0 && chartIds.every(id => r.charts.has(id)), page + ': rendered charts ' + [...r.charts.keys()].join(', '));
        for (const chart of r.charts.values()) {
          assert.equal(Object.keys(chart.options.plugins?.annotation?.annotations || {}).length, 0, page + ': no policy markers');
        }
        checked++;
      } finally { r.dom.window.close(); }
    }
  }
  assert.equal(checked, 6, 'every policy chart consumer checked with both failures');
});

test('missing LihtcByYear or failed series data shows unavailable without breaking other charts', async () => {
  let checked = 0;
  for (const missing of [['js/components/lihtc-by-year.js'], ['data/chfa-lihtc.json'], ['data/hna/geo-config.json']]) {
    // Historical Trends is the Deep Dive's #tab-history; it renders when opened.
    for (const [page, id, note, hash] of [
      ['colorado-deep-dive.html', 'chfaTimelineChart', '#htErrorBanner', '#tab-history'],
      ['colorado-deep-dive.html', 'chartLihtcTimeline', '#lihtcTimelineSourceNote'],
      ['colorado-deep-dive.html', 'lihtcTrendChart', '#lihtc-trend-status']
    ]) {
      const r = render(page, feed, missing, hash);
      try {
        await wait(() => /unavailable|failed/i.test(r.doc.querySelector(note).textContent));
        assert.equal(r.charts.has(id), false, page + ': no fabricated series');
        assert.equal(r.doc.querySelector(note).hidden, false);
        if (page === 'colorado-deep-dive.html') await wait(() => r.charts.has('foreclosure-chart'));
        if (id === 'lihtcTrendChart') await wait(() => r.charts.has('demandChart') && r.charts.has('supplyChart'));
        checked++;
      } finally { r.dom.window.close(); }
    }
  }
  assert.equal(checked, 9, 'every series consumer checked with missing module and both failed inputs');
});

test('all 64 counties are represented, and Baca and Moffat show county-scoped zero series', async () => {
  const series = helper.series(feed.features, { geoConfig });
  assert.equal(geoConfig.counties.length, 64);
  assert.deepEqual(Object.keys(series.counties).sort(), geoConfig.counties.map(c => c.label.replace(/ County$/i, '')).sort());
  const r = render('colorado-deep-dive.html');
  try {
    await wait(() => r.charts.has('lihtcTrendChart'));
    for (const county of ['Baca', 'Moffat']) {
      assert(!feed.features.some(f => f.properties.CNTY_NAME.replace(/ County$/i, '') === county), county + ': actually absent from CHFA feed');
      for (const values of Object.values(series.counties[county])) {
        assert(values.length > 0);
        assert(values.every(n => n === 0));
      }
      const selector = r.doc.getElementById('countySelect');
      selector.value = county; selector.dispatchEvent(new r.w.Event('change'));
      await wait(() => r.charts.get('lihtcTrendChart').data.datasets[0].label.startsWith(county));
      const chart = r.charts.get('lihtcTrendChart');
      assert.equal(chart.type, 'bar');
      assert.equal(r.doc.getElementById('lihtcTrendChart').dataset.county, county);
      assert.equal(chart.data.datasets.length, 1);
      assert.deepEqual(plain(chart.data.labels).map(Number), series.years);
      assert.deepEqual(plain(chart.data.datasets[0].data), series.years.map(() => 0));
      const note = r.doc.getElementById('lihtc-trend-status');
      assert(!note.hidden);
      assert(note.textContent.includes(county));
      assert.match(note.textContent, /No CHFA-listed LIHTC projects/);
    }
  } finally { r.dom.window.close(); }
});

test('the three CHFA charts and headings agree with the feed, including a changed year range', async () => {
  let checked = 0;
  const changed = plain(feed);
  // Shift the data window, so a hard-coded heading matching today's file fails.
  for (const f of changed.features) for (const key of ['AwardYear', 'YR_ALLOC', 'YEAR_ALLOC']) if (f.properties[key]) f.properties[key]--;
  for (const data of [feed, changed]) {
    const exp = expected(data), result = helper.series(data.features);
    assert(exp.rows.length > 0);
    assert.deepEqual(result.years, exp.years);
    assert.deepEqual(result.totals.projects, exp.values(() => true));
    assert.deepEqual(result.totals.liUnits, exp.values(() => true, 'LI_UNITS'));
    for (const [page, id, title, hash] of [
      ['colorado-deep-dive.html', 'chfaTimelineChart', 'htCHFAHeading', '#tab-history'],
      ['colorado-deep-dive.html', 'chartLihtcTimeline', 'lihtcTimelineTitle'],
      ['colorado-deep-dive.html', 'lihtcTrendChart', 'lihtc-trend-heading']
    ]) {
      const r = render(page, data, [], hash);
      try {
        await wait(() => r.charts.has(id));
        const chart = r.charts.get(id);
        assert.deepEqual(plain(chart.data.labels).map(Number), exp.years, page);
        const heading = r.doc.getElementById(title);
        assert(heading.textContent.includes(exp.range), page + ': heading uses the rendered years');
        assert.equal(heading.dataset.yearRange, exp.range);
        if (id === 'chfaTimelineChart') {
          const actual = exp.years.map((_, i) => chart.data.datasets.reduce((n, d) => n + d.data[i], 0));
          assert.deepEqual(actual, exp.values(() => true));
          const buckets = ['nine', 'four', 'other'].filter(k => result.credits[k].projects.some(n => n > 0));
          assert.equal(chart.data.datasets.length, buckets.length);
          buckets.forEach((key, i) => assert.deepEqual(plain(chart.data.datasets[i].data), result.credits[key].projects));
          r.doc.querySelector('[data-award-metric="units"]').click();
          const unitChart = r.charts.get(id);
          buckets.forEach((key, i) => assert.deepEqual(plain(unitChart.data.datasets[i].data), result.credits[key].units));
          let cumulative = 0;
          assert.deepEqual(plain(r.charts.get('stockTimelineChart').data.datasets[0].data), exp.values(() => true, 'N_UNITS').map(n => (cumulative += n)));
          assert.deepEqual(exp.years.map((_, i) => unitChart.data.datasets.reduce((n, d) => n + d.data[i], 0)), exp.values(() => true, 'N_UNITS'));
          assert(r.doc.getElementById('htStockHeading').textContent.includes(exp.range));
          assert(r.doc.getElementById('htFeedCoverage').textContent.includes(String(data.features.length)));
          assert(r.doc.getElementById('htFeedCoverage').textContent.includes(exp.range));
        } else if (id === 'chartLihtcTimeline') {
          assert.deepEqual(plain(chart.data.datasets[0].data), result.totals.liUnits);
        } else {
          for (const dataset of chart.data.datasets) {
            assert.deepEqual(plain(dataset.data), exp.values(p => p.CNTY_NAME.replace(/ County$/i, '') === dataset.label));
            assert.deepEqual(plain(dataset.data), result.counties[dataset.label].projects);
          }
          const selector = r.doc.getElementById('countySelect');
          selector.value = 'Mesa'; selector.dispatchEvent(new r.w.Event('change'));
          await wait(() => r.charts.get(id).data.datasets[0].label.startsWith('Mesa'));
          assert.deepEqual(plain(r.charts.get(id).data.datasets[0].data), result.counties.Mesa.projects);
        }
        checked++;
      } finally { r.dom.window.close(); }
    }
  }
  assert.equal(checked, 6, 'every listed chart checked twice');
});

test('Construction Commodities also sources its remaining monthly markers from the timeline', async () => {
  const r = render('construction-commodities.html');
  try {
    const dates = timeline.events.map(e => e.date.slice(0, 7) + '-01');
    r.w.createPriceChart('steel-chart', [{ name: 'Fixture commodity', history: dates.map(date => ({ date, value: 100 })) }], 'Fixture');
    await wait(() => Object.keys(r.charts.get('steel-chart').options.plugins.annotation.annotations).length > 0);
    const annotations = r.charts.get('steel-chart').options.plugins.annotation.annotations;
    assert.deepEqual(Object.keys(annotations), timeline.events.map(e => e.id));
    timeline.events.forEach(e => assert.equal(annotations[e.id].xMin, e.date.slice(0, 7) + '-01'));
    const link = r.doc.querySelector('a[href="economic-dashboard.html#policyTimelineHeading"]');
    assert(link);
    assert(new JSDOM(read('economic-dashboard.html')).window.document.getElementById('policyTimelineHeading'));
  } finally { r.dom.window.close(); }
});

test('the calculator renders the timeline Prop 123 description, without a second literal', async () => {
  const { openPage, close } = require('./helpers/deal-calculator-page.cjs');
  try {
    const p = await openPage('');
    const record = timeline.events.find(e => e.id === 'prop123');
    await wait(() => p.d.querySelector('[data-program-description="prop123"]')?.textContent === record.detail);
    assert.equal(p.d.querySelector('[data-program-description="prop123"]').textContent, record.detail);
  } finally { close(); }
});

function literals(code) {
  const hits = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectExpression') {
      const keys = node.properties.filter(p => p.value?.type === 'Literal').map(p => p.key?.name || p.key?.value);
      const label = node.properties.find(p => (p.key?.name || p.key?.value) === 'label')?.value;
      const content = label?.properties?.find(p => (p.key?.name || p.key?.value) === 'content')?.value;
      if (node.properties.some(p => (p.key?.name || p.key?.value) === 'xMin') && content?.type === 'Literal') hits.push(node.start);
      if (keys.includes('title') && keys.includes('date') && keys.includes('detail') ||
          keys.includes('label') && keys.includes('desc') && (keys.includes('year') || keys.includes('match'))) hits.push(node.start);
    }
    for (const child of Object.values(node)) if (child && typeof child === 'object') {
      if (Array.isArray(child)) child.forEach(walk); else walk(child);
    }
  }
  walk(parseScript(code, { next: true, globalReturn: true, ranges: true }));
  return hits;
}
function files(dir) { return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? e.name === 'vendor' ? [] : files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
test('no page or client JS keeps policy-event literals outside the data record', () => {
  assert(literals("const events = [{title:'Synthetic', date:'2000-01-01', detail:'Example'}];").length > 0, 'scanner is non-vacuous');
  assert(literals("const annotations = {covid: {xMin: date, label: {content: 'COVID-19'}}};").length > 0, 'scanner also detects the retired annotation-only copies');
  let scanned = 0;
  const htmlPages = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  for (const file of [...files('js').filter(f => f.endsWith('.js')), ...htmlPages]) {
    const source = read(file);
    let codes = [source];
    if (file.endsWith('.html')) {
      assert(!/data-policy-event-id\s*=/.test(source), file + ': authored timeline item');
      const dom = new JSDOM(source);
      codes = [...dom.window.document.querySelectorAll('script:not([src])')].filter(s => !s.type || /javascript/.test(s.type)).map(s => s.textContent);
      dom.window.close();
    }
    for (const code of codes) {
      assert.deepEqual(literals(code), [], file + ': hard-coded policy event'); scanned++;
    }
  }
  assert(htmlPages.length > 500 && scanned > 300, 'non-empty repository-wide scan');
  console.log('Scanned ' + htmlPages.length + ' pages and ' + scanned + ' script blocks/files for duplicated policy events.');
});

test('the Deep Dive does not load Market Signals until its tab is opened', async () => {
  const r = render('colorado-deep-dive.html', feed, [], '');
  try {
    await wait(() => r.charts.has('foreclosure-chart'), 'the Deep Dive tab rendered');
    await new Promise(res => setTimeout(res, 200));
    for (const id of ['demandChart', 'supplyChart', 'lihtcTrendChart']) assert.equal(r.charts.has(id), false, id + ' built while its tab was hidden');
    r.doc.getElementById('btn-signals').click();
    await wait(() => ['demandChart', 'supplyChart', 'lihtcTrendChart'].every(id => r.charts.has(id)), 'Market Signals rendered once opened');
  } finally { r.dom.window.close(); }
});

test('every policy event has its own color, and each chart key matches the line it names', async () => {
  // The legend under each chart is the only way to tell the dashed event
  // lines apart. When every event drew in one indigo (2026-10-11) the key
  // carried no information.
  const r = render('colorado-deep-dive.html');
  try {
    await wait(() => r.charts.has('lihtcTrendChart') && r.doc.querySelector('.lihtc-trend-event-legend'));
    const events = r.w.PolicyTimeline.chartEvents(timeline);
    assert.equal(events.length, timeline.events.length);
    const colors = events.map(e => e.pillBg.toLowerCase());
    assert.equal(new Set(colors).size, timeline.events.length, 'one color per event in data/policy/policy-timeline.json: ' + colors.join(' '));
    for (const e of events) assert.equal(e.lineColor, e.pillBg, e.label + ': the line and its key swatch are one color');

    const annotations = plain(r.charts.get('lihtcTrendChart').options.plugins.annotation.annotations);
    const chips = [...r.doc.querySelectorAll('.lihtc-trend-event-legend > span')];
    assert(chips.length >= 2, 'the trend chart shows a key with several events');
    const seen = new Set();
    for (const chip of chips) {
      const name = chip.querySelector('strong').textContent;
      const swatch = chip.querySelector('span').style.background;
      const line = annotations[name.replace(/\s+/g, '_').toLowerCase()];
      assert(line, name + ': the key names a line on the chart');
      const probe = r.doc.createElement('span');
      probe.style.background = line.borderColor;
      assert.equal(swatch, probe.style.background, name + ': key swatch is the line color');
      assert(!seen.has(swatch), name + ': shares its key color with another event');
      seen.add(swatch);
    }
  } finally { r.dom.window.close(); }
});

test('event color tokens: one per event, AA on their card, and far enough apart to tell apart', () => {
  // Rule 10 of .github/copilot-instructions.md: chart colors come from the
  // theme tokens and meet 4.5:1. The distance floor is the legend check's in
  // scripts/audit/chart-axes-audit.mjs.
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = h => { const [r, g, b] = hex(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const lab = h => {
    const [r, g, b] = hex(h);
    const f = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883]
      .map(t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
  };
  const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  const css = read('css/site-theme.css');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const tokens = text => [...text.matchAll(/--event-(\d+):\s*(#[0-9a-f]{6})/gi)].map(m => m[2].toLowerCase());
  const card = text => /--card:\s*(#[0-9a-f]{6})/i.exec(text)[1];
  const sets = [
    ['light', tokens(css.slice(0, darkAt)), card(css.slice(0, darkAt))],
    ['dark', tokens(css.slice(darkAt)), card(css.slice(darkAt))],
    ['dark (dark-mode.css)', tokens(read('css/dark-mode.css').slice(read('css/dark-mode.css').indexOf('html.dark-mode {'))), card(css.slice(darkAt))]
  ];
  for (const [name, colors, bg] of sets) {
    assert(colors.length >= timeline.events.length, `${name}: ${colors.length} event tokens for ${timeline.events.length} events`);
    for (const c of colors) assert(contrast(c, bg) >= 4.5, `${name}: ${c} is ${contrast(c, bg).toFixed(2)}:1 on ${bg}`);
    colors.forEach((a, i) => colors.slice(i + 1).forEach(b => assert(deltaE(a, b) >= 20, `${name}: ${a} and ${b} are too close`)));
  }
  assert.deepEqual(sets[2][1], sets[1][1], 'both dark-mode sets agree');
  const fallback = /var EVENT_COLORS = \[([^\]]+)\]/.exec(read('js/components/policy-timeline.js'))[1].match(/#[0-9a-f]{6}/gi).map(c => c.toLowerCase());
  assert.deepEqual(fallback, sets[0][1], 'the script fallback is the light token set');
});

test('economic indicator cards draw each event as a vertical line at its month', async () => {
  // Daily series repeat "Jul 26" for every day of the month. A repeated label
  // cannot be placed on a category axis, so a label-valued marker ran corner
  // to corner and read as a trend line (2026-10-22).
  const r = render('economic-dashboard.html');
  try {
    await wait(() => r.charts.has('ch-BAA10Y'), 'the Baa spread card renders');
    let checked = 0;
    for (const [id, chart] of r.charts) {
      if (!String(id).startsWith('ch-')) continue;
      const labels = chart.data.labels.map(String);
      for (const [name, line] of Object.entries(chart.options.plugins.annotation.annotations || {})) {
        assert(Number.isInteger(line.xMin), id + ' ' + name + ': x position is an index, not a label');
        assert.equal(line.xMax, line.xMin, id + ' ' + name + ': the line is vertical');
        assert.equal(line.yMin, undefined, id + ' ' + name + ': the line spans the full height');
        assert.equal(labels.indexOf(labels[line.xMin]), line.xMin, id + ' ' + name + ': sits at the first point of its month');
        checked++;
      }
    }
    assert(checked > 0, 'some card shows a policy event');
    const baa = r.charts.get('ch-BAA10Y').data.labels.map(String);
    assert(new Set(baa).size < baa.length, 'the daily fixture repeats labels, so the index matters');
  } finally { r.dom.window.close(); }
});
