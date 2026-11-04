#!/usr/bin/env node
/**
 * Market types (data/market/market-types.json) and the Market Types tab on
 * colorado-deep-dive.html.
 *
 * The file:
 *   - every place's type is the one its own readings give under the written rules;
 *   - the counts in meta equal the places;
 *   - every menu item names a record that exists in its source file and carries an
 *     https link, and every "already here" entry does too;
 *   - the conditions (no rent edge, small place) agree with the readings.
 * The tab, in a real browser on the committed data:
 *   - one tile per type, each with the file's town count;
 *   - the town table lists every town;
 *   - a picked town shows its type, its reason and linked menu items;
 *   - a CDP with too little data shows its county's type and says so.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const D = readJson('data/market/market-types.json');
const M = D.meta;
const R = M.rules;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

function typeOf(r) {
  if ((r.seasonal_share != null && r.seasonal_share >= R.seasonal_share) || r.call === 'second_home_shift') return 'resort';
  if (r.jobs && r.working_residents && r.jobs >= R.job_centre_jobs && r.jobs / r.working_residents >= R.job_centre_ratio) return 'job_centre';
  if (r.call === 'emerging' || (r.household_growth_pct != null && r.household_growth_pct >= R.growing_pct)) return 'growing';
  if (r.call === 'softening' || r.call === 'falling_demand' || (r.household_growth_pct != null && r.household_growth_pct <= R.shrinking_pct)) return 'softening';
  if ((r.call == null || r.call === 'not_enough_data') && r.household_growth_pct == null) return 'too_little_data';
  return 'steady';
}

const places = Object.entries(D.places);
ok(places.length === 546, `546 geographies (got ${places.length})`);
const counts = Object.fromEntries(M.order.map((t) => [t, { county: 0, town: 0, cdp: 0 }]));
for (const [g, p] of places) {
  ok(M.order.includes(p.type), `${g}: known type`);
  ok(typeOf(p.readings) === p.type, `${p.name}: type follows the written rules`);
  ok(p.stability >= 0 && p.stability <= 1, `${p.name}: stability is a share`);
  ok(p.modifiers.includes('no_rent_edge') === (p.readings.rent_edge === 'no_edge'), `${p.name}: rent edge condition`);
  if (p.level !== 'county') {
    const small = p.readings.population != null && p.readings.population < R.small_population;
    ok(p.modifiers.includes('small_place') === small, `${p.name}: small place condition`);
  }
  ok(p.modifiers.includes('no_prop123') === !p.readings.prop123_committed, `${p.name}: Prop 123 condition`);
  for (const h of p.here_now) ok(/^https:\/\//.test(h.url), `${p.name}: ${h.name} links to its source`);
  counts[p.type][p.level]++;
}
assert.deepEqual(counts, M.counts, 'meta counts equal the places'); checks++;

// Prop 123 against the DOLA list itself, with the same name reconciliation as
// comparableName() in js/prop123-map.js (accents, "City of", Central City).
const comparable = (s) => String(s || '').replace(/\s+\([^)]*\)$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s\-.&]/g, '').trim()
  .replace(/^(city and county|city|town|village) of\s+/, '').replace(/\s+county$/, '')
  .replace(/^mt\.?\s+/, 'mount ').replace(/^central city$/, 'central').trim();
const P123 = readJson('data/policy/prop123_jurisdictions.json').jurisdictions
  .filter((j) => /^(committed|commitment met)$/i.test(j.status || ''));
const townByName = new Map(places.filter(([, p]) => p.level === 'town').map(([, p]) => [comparable(p.name), p]));
// Keystone incorporated in 2024; the Census still counts it as a CDP.
const notYetTowns = new Set(['keystone']);
for (const j of P123.filter((x) => x.kind === 'municipality')) {
  const key = comparable(j.name);
  if (notYetTowns.has(key)) continue;
  ok(townByName.has(key), `${j.name}: filed town is in the file`);
  ok(townByName.get(key).readings.prop123_committed === true, `${j.name}: filed commitment is counted`);
}
for (const [key, p] of townByName) {
  const own = P123.some((j) => j.kind === 'municipality' && comparable(j.name) === key);
  const cityCounty = P123.some((j) => /^city and county of/i.test(j.name) && comparable(j.name) === key);
  ok(p.readings.prop123_committed === (own || cityCounty), `${p.name}: Prop 123 status matches the DOLA list`);
}
for (const n of ['Cañon City (city)', 'Central City (city)']) {
  ok(places.some(([, p]) => p.name === n && p.readings.prop123_committed), `${n}: filing found`);
}

const files = {
  'data/policy/co-developer-funding-guide.json': (d) => d.programs,
  'data/policy/incentive-alternatives.json': (d) => d.tools,
  'data/policy/homeownership-programs.json': (d) => d.programs,
};
for (const [key, it] of Object.entries(M.items)) {
  ok(/^https:\/\//.test(it.url), `${key}: https source link`);
  const [file, id] = it.record.split('#');
  ok(files[file](readJson(file)).some((r) => r.id === id), `${key}: record ${id} exists in ${file}`);
}
const used = [...Object.values(M.menus).flat(), ...Object.values(M.modifiers).flatMap((m) => m.items)];
for (const u of used) ok(M.items[u.item] && u.why, `${u.item}: menu entry resolves and says why`);
ok(M.validation.stable_80_share > 0 && M.validation.cluster_check.adjusted_rand != null, 'validation recorded');

// The tab in a browser. Skipped (not failed) where Playwright is not installed.
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* no browser here */ }
if (chromium) {
  const ORIGIN = 'http://example.org';
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
  // Same browser lookup as table-export-rendered: a named Chromium, else
  // Playwright's own if downloaded, else the one puppeteer installs (CI).
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (fs.existsSync(bundled) ? bundled : await (await import('puppeteer')).default.executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const tab = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const file = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await tab.goto(`${ORIGIN}/colorado-deep-dive.html#tab-types`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => document.querySelectorAll('#mtTownBody tr').length > 1, null, { timeout: 30000 });
  const tiles = await tab.$$eval('#mtTiles .mt-tile', (b) => b.map((x) => ({ t: x.dataset.type, n: Number(x.querySelector('.mt-tile-n').textContent) })));
  ok(tiles.length === M.order.length, 'one tile per type');
  for (const t of tiles) ok(t.n === M.counts[t.t].town, `${t.t} tile shows the file's town count`);
  const towns = places.filter(([, p]) => p.level === 'town').length;
  ok((await tab.$$('#mtTownBody tr')).length === towns, 'the table lists every town');

  const pick = places.find(([, p]) => p.level === 'town' && p.type === 'resort');
  await tab.selectOption('#mtPick', pick[0]);
  const card = await tab.$eval('#mtPlace', (e) => ({ text: e.textContent, links: [...e.querySelectorAll('.mt-menu a')].map((a) => a.href) }));
  ok(card.text.includes(pick[1].basis) && card.text.includes(M.types.resort.label), `${pick[1].name}: card shows its type and reason`);
  ok(card.links.length >= M.menus.resort.length && card.links.every((h) => h.startsWith('https:')), 'menu items are linked');

  // A funding record that is closed or has no round must say so on the card.
  const closedKey = Object.keys(M.items).find((k) => M.items[k].status === 'closed');
  const closedMod = closedKey && Object.keys(M.modifiers).find((k) => M.modifiers[k].items.some((u) => u.item === closedKey));
  if (closedMod) {
    const small = places.find(([, p]) => p.level === 'town' && p.modifiers.includes(closedMod));
    await tab.selectOption('#mtPick', small[0]);
    const flags = await tab.$$eval('#mtPlace .mt-menu li', (li) => li.map((x) => x.textContent));
    ok(flags.some((t) => t.includes(M.items[closedKey].name) && t.includes('Closed')), `${M.items[closedKey].name}: shown as Closed`);
  }
  for (const it of Object.values(M.items)) {
    if (it.kind === 'funding' && ['closed', 'watch', 'ended', 'ending'].includes(it.status)) ok(it.status_reason, `${it.name}: availability reason carried`);
  }

  const thin = places.find(([, p]) => p.type === 'too_little_data' && p.county_fips);
  await tab.selectOption('#mtPick', thin[0]);
  const thinText = await tab.$eval('#mtPlace', (e) => e.textContent);
  const county = D.places[thin[1].county_fips];
  ok(thinText.includes(county.name) && thinText.includes(M.types[county.type].label), `${thin[1].name}: shows its county's type`);

  // One town count everywhere: summary, tiles and table agree, singular is "1 town", cells line up at the top.
  const counts = await tab.evaluate(() => ({
    summary: parseInt(document.getElementById('mtSummary').textContent, 10),
    tiles: [...document.querySelectorAll('#mtTiles .mt-tile-n')].reduce((s, e) => s + Number(e.textContent), 0),
    table: parseInt(document.getElementById('mtTownCount').textContent, 10),
    tileText: [...document.querySelectorAll('#mtTiles .mt-tile-top')].map((e) => e.textContent),
    align: getComputedStyle(document.querySelector('#mtTownBody th')).verticalAlign,
  }));
  ok(counts.summary === counts.tiles && counts.tiles === counts.table, `summary, tiles and table count the same towns (${counts.summary}/${counts.tiles}/${counts.table})`);
  ok(!counts.tileText.some((t) => /^1 towns$/.test(t.trim())), 'one town reads "1 town"');
  ok(counts.align === 'top', 'town table cells line up at the top');
  await tab.click(`#mtTiles .mt-tile[data-type="job_centre"]`);
  ok((await tab.$$('#mtTownBody tr')).length === M.counts.job_centre.town, 'a tile filters the table');
  const wide = await tab.evaluate(() => document.documentElement.scrollWidth);
  ok(wide <= 390, `no sideways page scroll at 390px (got ${wide})`);
  ok(errors.length === 0, `no page errors: ${errors.join('; ')}`);
  await browser.close();
} else {
  console.log('market-types: browser checks skipped (Playwright not installed)');
}
console.log(`market-types: ${checks} checks passed`);
