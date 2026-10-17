#!/usr/bin/env node
/**
 * Market Direction tab on colorado-deep-dive.html: what the page shows must
 * agree with the files it reads, in a real browser on the committed data.
 *
 *   - the four county tiles equal meta.call_counts, and the headline names each count;
 *   - the headline's statewide permit figures are the sums of the counties' permits_ytd;
 *   - the county table has one row per county in the file, each with the file's call
 *     and its year-to-date permits;
 *   - a reading the file has no value for shows "No reading" with the file's reason,
 *     never a number (and the scan finds at least one);
 *   - the town table shows every town by default and every place with CDPs included;
 *   - a county's project list is exactly the ledger projects placed in that county;
 *   - the tab button controls the panel and the toggle script draws the tab.
 * The second half serves sabotaged copies of the tab's script, proves each
 * mutation changed the file, and proves the checks catch it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const JS = 'js/market-direction.js';
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const MD = readJson('data/market/market-direction.json');
const LEDGER = readJson('data/market/development-activity.json');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
// Eagle: it has towns and a scattered-site project the ledger places in two counties.
const PICK = '08037';

async function render(browser, script) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1));
    if (rel === JS && script != null) return route.fulfill({ body: script, contentType: 'text/javascript' });
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await tab.goto(`${ORIGIN}/colorado-deep-dive.html#tab-direction`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => document.querySelectorAll('#mdCountyBody tr').length > 1, null, { timeout: 30000 }).catch(() => {});
  const view = await tab.evaluate(async (pick) => {
    const rows = (id) => [...document.querySelectorAll(`#${id} tr`)].map((tr) => [...tr.cells].map((c) => ({ text: c.textContent.trim(), title: c.getAttribute('title') || '' })));
    const heads = [...document.querySelectorAll('#mdCountyHead th')].map((th) => th.textContent.trim());
    const out = {
      summary: (document.getElementById('mdSummary') || {}).textContent || '',
      kpis: [...document.querySelectorAll('#mdKpis .mi-kpi')].map((k) => ({ value: k.querySelector('.mi-kpi-value').textContent.trim(), label: k.querySelector('.mi-kpi-label').textContent.trim() })),
      heads,
      counties: rows('mdCountyBody'),
      townHeads: [...document.querySelectorAll('#mdTownHead th')].map((th) => th.textContent.trim()),
      towns: rows('mdTownBody').length,
      defs: [...document.querySelectorAll('#mdCalls li')].map((li) => { const c = li.cloneNode(true); c.querySelectorAll('.gl-tooltip-popup').forEach((x) => x.remove()); return { call: li.getAttribute('data-md-call'), text: c.textContent }; }),
    };
    const cdp = document.getElementById('mdCdps');
    if (cdp) { cdp.checked = true; cdp.dispatchEvent(new Event('change')); }
    out.withCdps = rows('mdTownBody').length;
    if (cdp) { cdp.checked = false; cdp.dispatchEvent(new Event('change')); }
    const sel = document.getElementById('mdCounty');
    if (sel) { sel.value = pick; sel.dispatchEvent(new Event('change')); }
    for (let i = 0; i < 100 && !/^(?!Loading)/.test((document.querySelector('#mdProjectBody tr') || {}).textContent || 'Loading'); i++) await new Promise((r) => setTimeout(r, 100));
    out.projects = [...document.querySelectorAll('#mdProjectBody tr')].map((tr) => tr.cells[0].textContent.trim());
    out.pickedTowns = rows('mdTownBody').map((r) => r[1] && r[1].text);
    return out;
  }, PICK);
  await tab.close();
  return { view, errors };
}

const LABEL = { emerging: 'Emerging', steady: 'Steady', softening: 'Softening', falling_demand: 'Falling demand' };
const int = (s) => Number(String(s).replace(/[^\d]/g, ''));

function checks({ view, errors }) {
  const fails = [];
  const fail = (m) => fails.push(m);
  if (errors.length) fail(`page errors: ${errors.join('; ')}`);
  const cc = MD.meta.call_counts;
  const counties = Object.entries(MD.counties);

  // tiles and headline
  if (view.kpis.length !== 4) fail(`${view.kpis.length} county tiles, expected 4`);
  for (const [k, label] of Object.entries(LABEL)) {
    const tile = view.kpis.find((t) => t.label.toLowerCase().startsWith(label.toLowerCase()));
    if (!tile) fail(`no tile for ${label}`);
    else if (int(tile.value) !== cc[k]) fail(`${label} tile shows ${tile.value}, the file counts ${cc[k]}`);
    if (!new RegExp(`\\b${cc[k]} (are |is )?${k === 'falling_demand' ? 'losing' : label.toLowerCase()}`).test(view.summary)) fail(`headline does not give ${cc[k]} ${label}`);
  }
  if (!view.summary.includes(`${counties.length} counties`)) fail(`headline does not say ${counties.length} counties`);
  const now = counties.reduce((s, [, c]) => s + c.permits_ytd.ytd.total, 0);
  const before = counties.reduce((s, [, c]) => s + c.permits_ytd.prior_ytd.total, 0);
  if (!view.summary.includes(now.toLocaleString('en-US')) || !view.summary.includes(before.toLocaleString('en-US'))) fail(`headline permits differ from the county sums ${now} / ${before}`);

  // county table
  const col = (name) => view.heads.indexOf(name);
  const iCall = col('Call'), iYtd = col('Homes permitted this year vs last'), iPrice = col('Home prices');
  if (iCall < 0 || iYtd < 0 || iPrice < 0) fail(`county table lacks a column: ${view.heads.join(' | ')}`);
  if (view.counties.length !== counties.length) fail(`county table has ${view.counties.length} rows, the file ${counties.length}`);
  const byName = new Map(view.counties.map((r) => [r[0].text, r]));
  let absent = 0;
  for (const [, c] of counties) {
    const r = byName.get(c.name);
    if (!r) { fail(`${c.name} missing from the county table`); continue; }
    if (r[iCall] && r[iCall].text !== LABEL[c.call]) fail(`${c.name}: table says ${r[iCall].text}, the file ${c.call}`);
    const y = c.permits_ytd;
    const want = `${y.ytd.total.toLocaleString('en-US')} vs ${y.prior_ytd.total.toLocaleString('en-US')}`;
    if (r[iYtd] && r[iYtd].text !== want) fail(`${c.name}: permits shown ${r[iYtd].text}, the file ${want}`);
    const p = c.signals.price;
    if (p.value == null) {
      absent++;
      if (!r[iPrice] || r[iPrice].text !== 'No reading' || r[iPrice].title !== p.unavailable_reason) fail(`${c.name}: missing price shows "${r[iPrice] && r[iPrice].text}" (${r[iPrice] && r[iPrice].title})`);
    } else if (r[iPrice] && /No reading/.test(r[iPrice].text)) fail(`${c.name}: price ${p.value} shown as no reading`);
  }
  if (!absent) fail('no county lacks a price reading: the absent-value check scanned nothing');

  // each call's definitions are the file's own, county and town
  for (const [k, def] of [...Object.entries(MD.meta.calls).map(([k, d]) => [k, d]), ...Object.entries(MD.meta.places.calls)]) {
    const li = view.defs.find((d) => d.call === k);
    if (!li || !li.text.includes(def)) fail(`"How a call is made" lacks the definition of ${k}: ${def.slice(0, 60)}…`);
  }

  // towns
  const places = Object.values(MD.places);
  const towns = places.filter((p) => p.type === 'town').length;
  if (view.towns !== towns) fail(`town table shows ${view.towns} rows, the file has ${towns} towns`);
  if (view.withCdps !== places.length) fail(`with CDPs the table shows ${view.withCdps}, the file has ${places.length} places`);
  const pickedName = MD.counties[PICK].name;
  const pickedTowns = places.filter((p) => p.type === 'town' && p.county_fips === PICK).length;
  if (view.pickedTowns.length !== pickedTowns || view.pickedTowns.some((n) => n !== pickedName)) fail(`picking ${pickedName} shows ${view.pickedTowns.length} towns, the file has ${pickedTowns}`);

  // projects
  const want = LEDGER.projects.filter((p) => p.county_fips === PICK || (p.county_fips_all || []).includes(PICK)).map((p) => p.name).sort();
  if (!want.length) fail(`the ledger has no project in ${pickedName}: the project check scanned nothing`);
  if (!LEDGER.projects.some((p) => (p.county_fips_all || []).includes(PICK))) fail(`no multi-county project in ${pickedName}: that join is unchecked`);
  if (JSON.stringify([...view.projects].sort()) !== JSON.stringify(want)) fail(`${pickedName} lists ${view.projects.length} projects, the ledger ${want.length}`);
  return fails;
}

// the page wiring, read from source
const html = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
assert.match(html, /<button role="tab" id="btn-direction"[^>]*aria-controls="tab-direction"/, 'the Market Direction tab button controls its panel');
assert.match(html, /<div role="tabpanel" id="tab-direction" aria-labelledby="btn-direction"/, 'the panel names its tab');
assert.match(html, /targetId === 'tab-direction' && window\.MarketDirection\)\s*{\s*window\.MarketDirection\.init\(\)/, 'the toggle draws the tab on reveal');
assert.match(html, /<script defer src="js\/market-direction\.js"><\/script>/, 'the page loads the tab script');
const src = fs.readFileSync(path.join(ROOT, JS), 'utf8');
assert.ok(src.includes("'market/market-direction.json'") && src.includes("'market/development-activity.json'"), 'the script reads the two files the test checks against');

const bundled = chromium.executablePath();
// The same lookup as test/table-export-rendered.test.js, which CI runs: playwright's
// own browser, else the one puppeteer installs, else a preinstalled Chromium.
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  const fails = checks(await render(browser, null));
  assert.deepEqual(fails, [], fails.join('\n'));
  console.log('market-direction tab: PASS (page agrees with market-direction.json and the ledger)');

  const SABOTAGE = [
    ['a tile count off by one', "fmtInt(cc[k] || 0)", "fmtInt((cc[k] || 0) + 1)", /tile shows/],
    ['the county call shown as Steady', "return { text: callLabel(c.call), sort: COUNTY_ORDER.indexOf(c.call) };", "return { text: 'Steady', sort: 0 };", /table says Steady/],
    ['a missing reading shown as zero', "if (!s || !isNum(s.value)) return", "if (!s) return", /missing price shows/],
    ['last year’s permits dropped', "' vs ' + fmtInt(p.prior_ytd && p.prior_ytd.total)", "' vs 0'", /permits shown/],
    ['town definitions replaced by county ones', "town = m.places.calls[k]", "town = m.calls[k]", /lacks the definition/],
    ['CDPs shown by default', "return (cdps || p.type === 'town')", "return (true || p.type === 'town')", /town table shows/],
    ['multi-county projects left out', " || (Array.isArray(p.county_fips_all) && p.county_fips_all.indexOf(fips) >= 0)", '', /lists \d+ projects/],
  ];
  for (const [name, from, to, expect] of SABOTAGE) {
    assert.ok(src.includes(from), `sabotage "${name}": the target text is in the script`);
    const bad = src.replace(from, to);
    assert.notEqual(bad, src, `sabotage "${name}" changed the script`);
    const f = checks(await render(browser, bad));
    assert.ok(f.some((m) => expect.test(m)), `sabotage "${name}" was not caught: ${f.join(' / ') || 'no failures'}`);
    console.log(`  sabotage caught: ${name}`);
  }
} finally {
  await browser.close();
}
