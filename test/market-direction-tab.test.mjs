#!/usr/bin/env node
/**
 * Market Direction tab on colorado-deep-dive.html: what the page shows must
 * agree with the files it reads, in a real browser on the committed data.
 *
 *   - the county tiles equal meta.call_counts for every call the file has (a served copy
 *     adds a county with not enough data), and the headline names each count by its measure;
 *   - the headline's statewide permit figures are the sums of the counties' permits_ytd;
 *   - the county table has one row per county in the file, each with the file's call
 *     and its year-to-date permits;
 *   - a reading the file has no value for shows "No reading" with the file's reason,
 *     never a number (and the scan finds at least one);
 *   - the town table shows every town by default and every place with CDPs included;
 *   - a county's project list is exactly the ledger projects placed in that county;
 *   - the tab button controls the panel and the toggle script draws the tab;
 *   - the Realtor.com columns (homes for sale, days on market, price cuts) show the
 *     listings file's figures, mark the counties it flags, and name its month; a county
 *     the month's file leaves out, or a listings file that will not load, shows
 *     "No reading" with the reason while the rest of the table still renders.
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
const BASE = readJson('data/market/market-direction.json');
const LISTINGS = readJson('data/market/realtor_inventory_co.json');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
const LEDGER = readJson('data/market/development-activity.json');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
// Eagle: it has towns and a scattered-site project the ledger places in two counties.
const PICK = '08037';

// listings: undefined serves the committed file, null answers 404, an object is served in its place.
async function render(browser, script, md = null, listings = undefined) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1));
    if (rel === JS && script != null) return route.fulfill({ body: script, contentType: 'text/javascript' });
    if (rel === 'data/market/market-direction.json' && md) return route.fulfill({ body: JSON.stringify(md), contentType: 'application/json' });
    if (rel === 'data/market/realtor_inventory_co.json' && listings !== undefined) {
      return listings === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ body: JSON.stringify(listings), contentType: 'application/json' });
    }
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await tab.goto(`${ORIGIN}/colorado-deep-dive.html#tab-direction`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => document.querySelectorAll('#mdCountyBody tr').length > 1, null, { timeout: 30000 }).catch(() => {});
  await tab.waitForFunction(() => ((document.getElementById('mdListingsNote') || {}).textContent || '').trim().length > 0, null, { timeout: 15000 }).catch(() => {});
  const view = await tab.evaluate(async (pick) => {
    const rows = (id) => [...document.querySelectorAll(`#${id} tr`)].map((tr) => [...tr.cells].map((c) => {
      const k = c.cloneNode(true);
      k.querySelectorAll('.gl-tooltip-popup').forEach((x) => x.remove());
      const notes = [...k.querySelectorAll('[data-export-note]')].map((n) => { n.remove(); return n.textContent.trim(); });
      return { text: k.textContent.trim(), note: notes.join(' ') };
    }));
    const heads = [...document.querySelectorAll('#mdCountyHead th')].map((th) => th.textContent.trim());
    const out = {
      summary: (document.getElementById('mdSummary') || {}).textContent || '',
      intro: (document.getElementById('mdIntro') || {}).textContent || '',
      mapText: (document.getElementById('mdMapText') || {}).textContent || '',
      legend: [...document.querySelectorAll('#mdLegend li')].map((li) => li.textContent.trim()),
      kpis: [...document.querySelectorAll('#mdKpis .mi-kpi')].map((k) => ({ value: k.querySelector('.mi-kpi-value').textContent.trim(), label: k.querySelector('.mi-kpi-label').textContent.trim() })),
      heads,
      counties: rows('mdCountyBody'),
      listingsNote: (document.getElementById('mdListingsNote') || {}).textContent || '',
      townHeads: [...document.querySelectorAll('#mdTownHead th')].map((th) => th.textContent.trim()),
      towns: rows('mdTownBody').length,
      defs: [...document.querySelectorAll('#mdCalls li')].map((li) => { const c = li.cloneNode(true); c.querySelectorAll('.gl-tooltip-popup').forEach((x) => x.remove()); return { call: li.getAttribute('data-md-call'), text: c.textContent }; }),
    };
    const cdp = document.getElementById('mdCdps');
    if (cdp) { cdp.checked = true; cdp.dispatchEvent(new Event('change')); }
    out.withCdps = rows('mdTownBody').length;
    const iType = [...document.querySelectorAll('#mdTownHead th')].map((th) => th.textContent.trim()).indexOf('Type');
    out.cdpRows = iType < 0 ? -1 : rows('mdTownBody').filter((r) => r[iType] && r[iType].text === 'CDP').length;
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

const LABEL = { emerging: 'Emerging', steady: 'Steady', softening: 'Softening', falling_demand: 'Falling demand', not_enough_data: 'Not enough data' };
// The headline's clause for a count: the words after it, up to the next comma, "and <number>" or full stop.
const clauses = (sentence, n) => [...sentence.matchAll(new RegExp(`\\b${n} ((?:are |is )?[^,.]*?)(?=, | and \\d|\\.)`, 'g'))].map((m) => m[1]);
// A falling-demand clause agrees with its rule when it names a decline in exactly the demand
// measures the rule's thresholds read (household population, jobs where there is a jobs
// threshold) and never calls household population "households". Other calls name their label.
function agrees(clause, k, thresholds) {
  if (k === 'falling_demand') {
    return /\b(losing|los[st]|declin\w*|fall\w*|shrink\w*|drop\w*)\b/.test(clause) &&
      (!thresholds.population || /household population/.test(clause)) &&
      /\bjobs\b/.test(clause) === !!thresholds.jobs && !/\bhouseholds\b/.test(clause);
  }
  if (k === 'not_enough_data') return /\bdata\b/.test(clause);
  return clause.toLowerCase().includes((LABEL[k] || k).toLowerCase());
}
const int = (s) => Number(String(s).replace(/[^\d]/g, ''));

function checks({ view, errors }, MD = BASE, LI = LISTINGS) {
  const fails = [];
  const fail = (m) => fails.push(m);
  if (errors.length) fail(`page errors: ${errors.join('; ')}`);
  const cc = MD.meta.call_counts;
  const counties = Object.entries(MD.counties);

  // tiles and headline
  // every call the file defines or counts, so no county drops out of the tiles, headline, legend or map text
  const calls = [...new Set([...Object.keys(MD.meta.calls), ...Object.keys(cc)])].filter((k) => cc[k] || k !== 'not_enough_data');
  if (view.kpis.length !== calls.length) fail(`${view.kpis.length} county tiles, the file has ${calls.length} calls`);
  if (Object.values(cc).reduce((a, b) => a + b, 0) !== counties.length) fail('meta.call_counts does not total the counties');
  const sentences = view.summary.split(/(?<=\.)\s+/);
  const countySentence = sentences.find((t) => t.includes(`${counties.length} counties`)) || '';
  const townSentence = sentences.find((t) => /\btowns,/.test(t)) || '';
  for (const k of calls) {
    const label = LABEL[k] || k;
    if (!view.legend.includes(label)) fail(`the map legend lacks ${label}`);
    const tile = view.kpis.find((t) => t.label.toLowerCase().startsWith(label.toLowerCase()));
    if (!tile) fail(`no tile for ${label}`);
    else if (int(tile.value) !== cc[k]) fail(`${label} tile shows ${tile.value}, the file counts ${cc[k]}`);
    if (cc[k] && !clauses(countySentence, cc[k]).some((c) => agrees(c, k, MD.meta.thresholds))) fail(`headline does not give ${cc[k]} ${label} in terms of its rule: ${countySentence}`);
  }
  const tc = (MD.meta.places.call_counts || {}).town || {};
  for (const k of ['emerging', 'softening', 'falling_demand']) {
    if (tc[k] && !clauses(townSentence, tc[k]).some((c) => agrees(c, k, MD.meta.places.thresholds))) fail(`headline does not give ${tc[k]} ${LABEL[k]} towns in terms of the town rule: ${townSentence}`);
  }
  for (const [, c] of counties) if (!view.mapText.includes(c.name.replace(/ County$/, ''))) fail(`the map's text alternative omits ${c.name}`);
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
      if (!r[iPrice] || r[iPrice].text !== 'No reading' || r[iPrice].note !== p.unavailable_reason) fail(`${c.name}: missing price shows "${r[iPrice] && r[iPrice].text}" (${r[iPrice] && r[iPrice].note})`);
    } else if (r[iPrice] && /No reading/.test(r[iPrice].text)) fail(`${c.name}: price ${p.value} shown as no reading`);
  }
  if (!absent) fail('no county lacks a price reading: the absent-value check scanned nothing');

  // Realtor.com listings: the file's figures, its flag, its month; a gap reads "No reading" with why
  const iSale = col('Homes for sale'), iDom = col('Days on market'), iCut = col('Listings with a price cut');
  if (iSale < 0 || iDom < 0 || iCut < 0) fail(`county table lacks a listings column: ${view.heads.join(' | ')}`);
  else {
    const month = LI ? monthName(LI.meta.month) : null;
    const why = LI ? `Not in Realtor.com’s file for ${month}` : 'The Realtor.com listings file could not be loaded';
    let missing = 0, flagged = 0;
    for (const [fips, c] of counties) {
      const r = byName.get(c.name);
      if (!r) continue;
      const l = LI && LI.counties[fips];
      if (!l) {
        missing++;
        for (const i of [iSale, iDom, iCut]) if (r[i].text !== 'No reading' || r[i].note !== why) fail(`${c.name}: absent listing shows "${r[i].text}" (${r[i].note})`);
        continue;
      }
      const mark = l.quality_flag === 1 ? ' †' : '';
      if (mark) flagged++;
      const sale = `${l.active_listings.toLocaleString('en-US')} (`;
      if (!r[iSale].text.startsWith(sale) || !r[iSale].text.endsWith(')' + mark)) fail(`${c.name}: homes for sale shown ${r[iSale].text}, the file ${l.active_listings}${mark}`);
      if (r[iDom].text !== `${l.median_days_on_market} days${mark}`) fail(`${c.name}: days on market shown ${r[iDom].text}, the file ${l.median_days_on_market}${mark}`);
      if (r[iCut].text !== `${l.price_reduced_share_pct.toFixed(0)}%${mark}`) fail(`${c.name}: price cuts shown ${r[iCut].text}, the file ${l.price_reduced_share_pct}${mark}`);
    }
    if (LI) {
      if (!view.listingsNote.includes(`Realtor.com listings for ${month}`)) fail(`the listings note does not name ${month}: ${view.listingsNote}`);
      if (flagged && !view.listingsNote.includes(`flags ${flagged} ${flagged === 1 ? 'county' : 'counties'}`)) fail(`the listings note does not count the ${flagged} flagged counties: ${view.listingsNote}`);
      if (missing && !view.listingsNote.includes(`${missing} ${missing === 1 ? 'county is' : 'counties are'} not in`)) fail(`the listings note does not count the ${missing} counties missing: ${view.listingsNote}`);
    } else if (!/could not be loaded/.test(view.listingsNote)) fail(`the listings note does not say the file failed: ${view.listingsNote}`);
  }

  // the introduction names the demand readings each rule uses: jobs only where the file has a jobs threshold
  const [countyLine, townLine] = view.intro.split(/(?=A town call)/);
  if (!countyLine || !townLine) fail(`the introduction does not describe county and town calls separately: ${view.intro}`);
  else {
    if (/\bjobs\b/.test(countyLine) !== !!MD.meta.thresholds.jobs) fail(`the county introduction ${MD.meta.thresholds.jobs ? 'omits' : 'claims'} jobs`);
    if (/reads[^.]*\bjobs\b[^.]*against/.test(townLine) !== !!MD.meta.places.thresholds.jobs) fail(`the town introduction ${MD.meta.places.thresholds.jobs ? 'omits' : 'claims'} jobs`);
  }

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
  const cdps = places.length - towns;
  if (view.cdpRows !== cdps) fail(`with CDPs the Type column marks ${view.cdpRows} rows CDP, the file has ${cdps}`);
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

  // A county with too little data to call: the committed file has none, so serve a copy
  // that moves one county (not the picked one) to not_enough_data and recounts.
  const gap = structuredClone(BASE);
  const moved = Object.keys(gap.counties).find((f) => f !== PICK && gap.counties[f].call === 'steady');
  gap.meta.call_counts.steady--;
  gap.meta.call_counts.not_enough_data = (gap.meta.call_counts.not_enough_data || 0) + 1;
  gap.counties[moved].call = 'not_enough_data';
  const gapFails = checks(await render(browser, null, gap), gap);
  assert.deepEqual(gapFails, [], gapFails.join('\n'));
  console.log(`  a county with not enough data (${gap.counties[moved].name}) is counted in the tiles, headline, legend and map text`);

  // A month's listings file without one county, and no listings file at all: the gap reads
  // "No reading" with the reason, and the calls, permits and projects still render.
  const thin = structuredClone(LISTINGS);
  const dropped = Object.keys(thin.counties).find((f) => f !== PICK);
  delete thin.counties[dropped];
  const thinFails = checks(await render(browser, null, null, thin), BASE, thin);
  assert.deepEqual(thinFails, [], thinFails.join('\n'));
  console.log(`  a county missing from the listings file (${LISTINGS.counties[dropped].name}) shows no reading, with the reason`);
  const goneFails = checks(await render(browser, null, null, null), BASE, null);
  assert.deepEqual(goneFails, [], goneFails.join('\n'));
  console.log('  a listings file that will not load leaves the rest of the table intact');
  for (const [name, from, to, expect, li] of [
    ['a county missing from the listings shown as zero', "return { text: NONE, title: l.why || 'Realtor.com publishes no figure for this county this month', sort: null };", "return { text: '0', title: '', sort: 0 };", /absent listing shows/, thin],
    ['the Realtor.com flag dropped', "(l.row.quality_flag === 1 ? ' †' : '')", "''", /shown .* the file .*†/, undefined],
    ['the listings month misnamed', "listings for ' + escapeHtml(monthName(listings.meta.month))", "listings for this month' + ''", /does not name/, undefined],
  ]) {
    assert.ok(src.includes(from), `sabotage "${name}": the target text is in the script`);
    const bad = src.replace(from, to);
    const f = checks(await render(browser, bad, null, li), BASE, li === undefined ? LISTINGS : li);
    assert.ok(f.some((m) => expect.test(m)), `sabotage "${name}" was not caught: ${f.join(' / ') || 'no failures'}`);
    console.log(`  sabotage caught: ${name}`);
  }
  const fixed = "  var COUNTY_ORDER = [];";
  assert.ok(src.includes(fixed), 'sabotage "the county calls hard-coded": the target text is in the script');
  const hard = src.replace(fixed, "  var COUNTY_ORDER = ['emerging', 'steady', 'softening', 'falling_demand'];").replace('      COUNTY_ORDER = countyOrder(d);\n', '');
  assert.notEqual(hard, src);
  const hf = checks(await render(browser, hard, gap), gap);
  assert.ok(hf.some((m) => /tiles|Not enough data|omits/.test(m)), `sabotage "the county calls hard-coded" was not caught: ${hf.join(' / ') || 'no failures'}`);
  console.log('  sabotage caught: the county calls hard-coded to four');

  const SABOTAGE = [
    ['a tile count off by one', "fmtInt(cc[k] || 0)", "fmtInt((cc[k] || 0) + 1)", /tile shows/],
    ['the county call shown as Steady', "return { text: callLabel(c.call), sort: COUNTY_ORDER.indexOf(c.call) };", "return { text: 'Steady', sort: 0 };", /table says Steady/],
    ['a missing reading shown as zero', "if (!s || !isNum(s.value)) return", "if (!s) return", /missing price shows/],
    ['the reason for a missing reading dropped', "var note = v.text === NONE && v.title ?", "var note = false ?", /missing price shows/],
    ['last year’s permits dropped', "' vs ' + fmtInt(p.prior_ytd && p.prior_ytd.total)", "' vs 0'", /permits shown/],
    ['town definitions replaced by county ones', "town = m.places.calls[k]", "town = m.calls[k]", /lacks the definition/],
    ['town introduction given the county rule', "'A town call reads ' + demand(data.meta.places.thresholds)", "'A town call reads ' + demand(data.meta.thresholds)", /town introduction claims jobs/],
    ['CDPs shown by default', "return (cdps || p.type === 'town')", "return (true || p.type === 'town')", /town table shows/],
    ['falling demand called a loss of households', "'losing household population and jobs'", "'losing households and jobs'", /headline does not give \d+ Falling demand in/],
    ['the town line given the county jobs rule', "' losing household population with a market signal that agrees.'", "' losing household population and jobs with a market signal that agrees.'", /Falling demand towns/],
    ['CDPs labelled as towns', "var t = p.type === 'cdp' ? 'CDP' : 'Town';", "var t = 'Town';", /Type column marks/],
    ['multi-county projects left out', " || (Array.isArray(p.county_fips_all) && p.county_fips_all.indexOf(fips) >= 0)", '', /lists \d+ projects/],
  ];
  const REWORD = [
    ['falling demand reworded', "'losing household population and jobs'", "'with declining household population and jobs'"],
    ['the town falling-demand line reworded', "' losing household population with a market signal that agrees.'", "' with shrinking household population and a market signal that agrees.'"],
  ];
  for (const [name, from, to] of REWORD) {
    assert.ok(src.includes(from), `reword "${name}": the target text is in the script`);
    const ok = src.replace(from, to);
    assert.notEqual(ok, src, `reword "${name}" changed the script`);
    const f = checks(await render(browser, ok));
    assert.deepEqual(f, [], `reword "${name}" kept the meaning but failed: ${f.join(' / ')}`);
    console.log(`  reword stays green: ${name}`);
  }
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
