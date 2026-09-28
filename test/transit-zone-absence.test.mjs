#!/usr/bin/env node
/**
 * An unknown transit-zone status never renders as "No" or "Outside"
 * (#1937; finish line PC-3; AGENTS.md "an unmeasurable quantity is null,
 * never 0").
 *
 * One sweep across every surface that shows the zone answer (SURFACES,
 * at the end) — fed every way the answer can be unknown: stop data
 * or map status that did not load, stop data past its SLA, a site outside
 * Colorado or with unreadable coordinates, an OEDIT zone file that cannot be
 * read, a geography with no figures, a panel still loading or showing
 * another place, the helper script missing. For each, the surface must say
 * it does not know (Unavailable / insufficient / hidden) and must not show a
 * share, an "Outside" or "passes" result, an official designation, or a
 * pointer to the Transit Zone credit.
 *
 * The surfaces are the real files, loaded as the pages load them. Non-vacuity
 * is on the sweep: every surface must have been checked against every
 * condition that applies to it, and each check must have found the surface's
 * own "unknown" signal — a surface that rendered nothing passes nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const TZ = require('../js/transit-zone.js');
const Contract = require('../js/workflow/recommendation-contract.js');
const Page = require('../js/workflow/recommendation-page.js');
const STZ = require('../js/project-market-study/study-transit-zone.js');

const stops = json('data/amenities/transit_stops_statewide_co.geojson');
const byGeo = json('data/hna/transit-zone-by-geography.json');
const mapStatus = json('data/policy/thiz-map-status.json');
const DAY = 86400e3;
const FRESH = new Date(Date.parse(stops.meta.generated) + DAY);
const STALE = new Date(Date.parse(stops.meta.generated) + 40 * DAY);
const FRESH_AREA = new Date(Date.parse(byGeo.meta.stops_generated) + DAY);
const STALE_AREA = new Date(Date.parse(byGeo.meta.stops_generated) + 40 * DAY);
const UNION = [39.7527, -105.0003];          // passes the screen when known
const PLACE = Object.keys(byGeo.geographies)
  .find((g) => byGeo.geographies[g].share_within_radius_confirmed > 0.3 && !byGeo.geographies[g].unavailableReason);
const published = Object.assign({}, mapStatus, { status: 'published', zones_file: 'data/policy/thiz-zones.geojson' });
const brokenZones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] };

// What an unknown must never look like.
const FORBIDDEN = [
  [/[<>]?\d+(\.\d+)?\s?%/, 'a share'],
  [/\bOutside the \d/, '"Outside the N-mile screen"'],
  [/Outside every/, 'an official "outside" designation'],
  [/\bpass(es)? the \d+-mile screen/i, 'a screen result'],
  [/No part of|No site (here )?passes/, 'a proven "none"'],
  [/Soft Funding Stack|may be eligible|Possible (funding )?source/, 'a credit pointer'],
  [/official_(in|out)/, 'an official designation'],
];
// A bare "No" or "Outside" (any case) next to "Unavailable" reads as a
// negative answer — "Unavailable. No, this place is outside the transit
// zone." is the shape this rule exists to catch (#1977). The rule is about
// meaning, not wording: "no" is allowed only when what follows is a thing
// that is missing (an input, a figure, a date, a map) rather than the
// answer, and "outside" only as "outside Colorado", the reason the screen
// does not apply. Rewording a reason keeps it green; turning it into an
// answer ("No, …", "No transit here", "Outside the zone") fails.
const MISSING = [
  String.raw`(?:transit zone\s+)?figures?`,                    // the data has no figures / "no figure" placeholder
  String.raw`jurisdiction\b(?=[^.]*\b(?:selected|chosen|picked)\b)`, // no input chosen
  String.raw`area to screen`,                                   // no input to screen
  String.raw`build date`,                                       // the stop file cannot be dated
  String.raw`zones to check`,                                   // the official map is empty
  String.raw`designation\b(?=\s*(?::|\(|—|,?\s*because\b))`,  // only with the reason attached
];
const ALLOWED_NO_OUTSIDE = [
  [new RegExp(String.raw`\bno\s+(?:${MISSING.join('|')})`, 'gi'), 'says what is missing, not what the answer is'],
  [/\boutside Colorado\b/gi, 'the site is not in Colorado, so the screen does not apply'],
];
function unavailableClean(text, where) {
  let rest = String(text);
  for (const [re] of ALLOWED_NO_OUTSIDE) rest = rest.replace(re, ' ');
  for (const [re, what] of [[/\bNo\b/i, 'a bare "No"'], [/\bOutside\b/i, 'a bare "Outside"']]) {
    const m = rest.match(new RegExp(`[^.]*${re.source}[^.]*`, 'i'));
    assert.ok(!m, `${where}: an unknown rendered ${what}: "${m && m[0].trim()}"`);
  }
}
function clean(text, where) {
  for (const [re, what] of FORBIDDEN) assert.doesNotMatch(String(text), re, `${where}: an unknown rendered ${what}`);
  unavailableClean(text, where);
}
// The rule must bite: the mutation from the #1977 review, and each allowed
// phrase with a bare negative beside it, fail; the allowed phrases alone pass.
for (const bad of ['Unavailable. No, this place is outside the transit zone.', 'Unavailable. Outside.',
  'Unavailable. NO transit here.', 'Unavailable. The site is outside Colorado. No.',
  'Unavailable. No designation.', 'Unavailable. No transit zone.', 'Unavailable. No jurisdiction is in the zone.',
  'Unavailable. No area of this place qualifies.', 'Unavailable. No zones overlap this site.', 'Unavailable. Outside the zone.']) {
  assert.throws(() => clean(bad, 'self-test'), /bare/, `the bare No/Outside rule let through: ${bad}`);
}
clean('Unavailable. The site location is outside Colorado (or its coordinates are missing or swapped). ' +
  'No designation: the site location could not be placed in Colorado. No transit zone figures for this geography. ' +
  'No jurisdiction is selected, so there is no area to screen. no figure', 'self-test');
// Rewordings of the same reasons stay green — the rule pins meaning, not copy.
clean('Unavailable. No jurisdiction has been chosen yet, so there is no area to screen. ' +
  'The stop file has no build date. The official map has no zones to check against. ' +
  'No figures for this place. No designation, because the site could not be placed in Colorado.', 'self-test');

let failures = 0;
let passed = 0;
const covered = {};       // surface -> conditions checked
async function check(surface, condition, fn) {
  // A case that never settles must fail by name. Without the limit, node exits
  // on the unsettled await with code 13 and no word about which case hung.
  let limit;
  try {
    await Promise.race([fn(), new Promise((_, reject) => {
      limit = setTimeout(() => reject(new Error('did not finish within 10 s: something it waits on never answers')), 10000);
    })]);
    (covered[surface] = covered[surface] || []).push(condition);
    passed += 1;
    console.log(`  ✓ ${surface}: ${condition}`);
  } catch (e) {
    failures += 1;
    console.log(`  ✗ ${surface}: ${condition} — ${e.message}`);
  } finally {
    clearTimeout(limit);
  }
}

console.log('transit-zone-absence (#1937)');

// ── js/transit-zone.js ─────────────────────────────────────────────────────
const SITE = 'js/transit-zone.js';
for (const [condition, opts, lat, lon] of [
  ['stop data missing', { stops: null, mapStatus, now: FRESH }, ...UNION],
  ['stop data empty', { stops: { type: 'FeatureCollection', features: [], meta: stops.meta }, mapStatus, now: FRESH }, ...UNION],
  ['stop data stale', { stops, mapStatus, now: STALE }, ...UNION],
  ['site outside Colorado', { stops, mapStatus, now: FRESH }, 38.58, -121.5],
  ['site coordinates unreadable', { stops, mapStatus, now: FRESH }, null, NaN],
  ['null-island site', { stops, mapStatus, now: FRESH }, 0, 0],
]) {
  await check(SITE, condition, () => {
    const r = TZ.create(opts).status(lat, lon);
    assert.equal(r.status, 'unavailable');
    assert.ok(r.unavailableReason && r.unavailableReason.length > 10, 'no reason given');
    assert.equal(r.confirmedOnly, null);
    assert.notEqual(r.designation, 'official_out');
    assert.equal(TZ.fundingPath(r), null);
  });
}
await check(SITE, 'OEDIT zone file unreadable', () => {
  const r = TZ.create({ stops, mapStatus: published, zones: brokenZones, now: FRESH }).status(38.82, -102.35);
  assert.equal(r.designation, 'provisional', 'an unreadable official map produced an official answer');
  assert.equal(TZ.fundingPath(r), null);
});
for (const [condition, args] of [
  ['area data not loaded', [null, PLACE, mapStatus, FRESH_AREA]],
  ['area data stale', [byGeo, PLACE, mapStatus, STALE_AREA]],
  ['geography not covered', [byGeo, '08999', mapStatus, FRESH_AREA]],
  ['no geography', [byGeo, null, mapStatus, FRESH_AREA]],
]) {
  await check(SITE, condition, () => {
    const s = TZ.areaSummary(...args);
    assert.equal(s.status, 'unavailable');
    assert.ok(s.unavailableReason);
    assert.equal(s.shareLabel, undefined, 'an unavailable summary carried a share');
  });
}

// ── js/market-analysis.js — the PMA site gate ──────────────────────────────
const GATE = 'js/market-analysis.js';
const gateSrc = (read(GATE).match(/  var _tzMapStatus = null[\s\S]*?\n  function _renderTransitZoneGate[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(gateSrc, 'the PMA transit gate is gone — this sweep is checking nothing');
function runGate(lat, lon, o = {}) {
  const dom = new JSDOM('<!doctype html><div id="pmaTransitZoneGate" hidden></div>');
  const dc = { calls: [] };
  const ctx = {
    window: { TransitZone: o.noHelper ? undefined
                : { create: (x) => TZ.create(Object.assign({ now: o.now || FRESH }, x)), fundingPath: TZ.fundingPath },
              __DealCalc: { setTransitZoneContext: (r) => dc.calls.push(r) } },
    document: dom.window.document,
    el: (id) => dom.window.document.getElementById(id),
    _rawLayerData: { transitStops: o.noStops ? undefined : stops },
    siteLatLng: null, _requestTodStops: () => {}, fetch: () => new Promise(() => {}),
  };
  vm.createContext(ctx);
  vm.runInContext(gateSrc + `
    _tzMapStatus = ${JSON.stringify(o.mapStatus === undefined ? mapStatus : o.mapStatus)};
    _tzMapStatusState = ${JSON.stringify(o.state || 'ok')};
    _tzStopsFailed = ${!!o.stopsFailed};
    _tzZones = ${JSON.stringify(o.zones || null)};
    _tzZonesState = ${JSON.stringify(o.zonesState || 'idle')};
    var __r = _renderTransitZoneGate(${lat}, ${lon});`, ctx);
  return { r: ctx.__r, box: dom.window.document.getElementById('pmaTransitZoneGate'), dc };
}
for (const [condition, o, lat, lon] of [
  ['stop data failed to load', { noStops: true, stopsFailed: true }, ...UNION],
  ['zone-map status failed to load', { state: 'failed' }, ...UNION],
  ['zone helper missing', { noHelper: true }, ...UNION],
  ['stop data stale', { now: STALE }, ...UNION],
  ['site outside Colorado', {}, 38.58, -121.5],
  ['OEDIT zone file failed to load', { mapStatus: published, zonesState: 'failed' }, 38.82, -102.35],
]) {
  await check(GATE, condition, () => {
    const { box, dc } = runGate(lat, lon, o);
    const state = box.getAttribute('data-tz-state');
    if (condition === 'OEDIT zone file failed to load') {
      // The stop screen still answers; the official map must not.
      assert.equal(box.querySelector('[data-tz-designation]').getAttribute('data-tz-designation'), 'provisional');
      assert.doesNotMatch(box.textContent, /Soft Funding Stack|Outside every|official_/);
      return;
    }
    assert.equal(state, 'unavailable', `gate state ${state}`);
    const program = box.querySelector('[data-thiz-qualified]');
    if (program) assert.equal(program.dataset.thizQualified, 'null');
    else assert.match(box.textContent, /unknown|unavailable/i);
    clean(box.textContent, GATE);
    assert.ok(dc.calls.length && dc.calls.every((r) => TZ.fundingPath(r) === null), 'the deal calculator was offered the credit');
  });
}

// Still loading: nothing is known yet, so the gate says it is checking and
// offers the calculator nothing.
for (const [condition, o, lat, lon] of [
  ['loading: stop data not arrived yet', { noStops: true }, ...UNION],
  ['loading: zone-map status in flight', { state: 'loading' }, ...UNION],
  ['loading: OEDIT zone file in flight', { mapStatus: published, zonesState: 'loading' }, 38.82, -102.35],
]) {
  await check(GATE, condition, () => {
    const { box, dc } = runGate(lat, lon, o);
    assert.equal(box.getAttribute('data-tz-state'), 'loading');
    assert.match(box.textContent, /checking/);
    clean(box.textContent, GATE);
    assert.ok(dc.calls.length && dc.calls.every((r) => r === null || r.program.qualified === null), 'a loading gate handed the deal calculator a result');
  });
}

// ── js/deal-calculator.js — the funding line ───────────────────────────────
const DEAL = 'js/deal-calculator.js';
const dealDom = new JSDOM('<!doctype html><div id="dc-tz-note" hidden></div>', { runScripts: 'outside-only' });
dealDom.window.fetch = () => Promise.reject(new Error('offline'));
dealDom.window.eval(read('js/transit-zone.js'));
dealDom.window.eval(read(DEAL));
const note = dealDom.window.document.getElementById('dc-tz-note');
for (const [condition, r] of [
  ['no result', null],
  ['unavailable result', TZ.create({ stops, mapStatus, now: STALE }).status(...UNION)],
  ['out-of-state result', TZ.create({ stops, mapStatus, now: FRESH }).status(38.58, -121.5)],
]) {
  await check(DEAL, condition, () => {
    // Open the line first, so "stays open" cannot pass as "hidden".
    // Synthetic supported result to prove the line closes (the live map is unavailable).
    dealDom.window.__DealCalc.setTransitZoneContext({ program: { qualified: true, siteSource: 'site',
      siteLat: UNION[0], siteLon: UNION[1], facilityId: 'test-only',
      determinationMethod: 'point_in_official_polygon', programRule: 'Synthetic test evidence' } });
    assert.equal(note.hidden, false, 'fixture: the line did not open for a passing site');
    dealDom.window.__DealCalc.setTransitZoneContext(r);
    assert.equal(note.hidden, true);
    assert.equal(note.textContent, '');
  });
}
await check(DEAL, 'helper script missing', () => {
  const dom = new JSDOM('<!doctype html><div id="dc-tz-note" hidden></div>', { runScripts: 'outside-only' });
  dom.window.fetch = () => Promise.reject(new Error('offline'));
  dom.window.eval(read(DEAL));
  const n = dom.window.document.getElementById('dc-tz-note');
  dom.window.__DealCalc.setTransitZoneContext(TZ.create({ stops, mapStatus, now: FRESH }).status(...UNION));
  assert.equal(n.hidden, true, 'without js/transit-zone.js the calculator guessed a funding path');
});

// ── js/hna/hna-renderers.js — the needs assessment panel ───────────────────
// ── js/hna/hna-export.js — its PDF / Excel / CSV rows ──────────────────────
const PANEL = 'js/hna/hna-renderers.js';
const EXPORT = 'js/hna/hna-export.js';
function hnaPage(fetchImpl, { noHelper } = {}) {
  // The CSV writer's download clicks a blob: link, which jsdom cannot
  // navigate to; that notice is expected, anything else is reported.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (!/navigation/.test(e.message)) console.error(e); });
  const dom = new JSDOM('<!doctype html><select id="geoSelect"></select><div id="hnaTransitZoneContent"></div>',
    { runScripts: 'outside-only', virtualConsole });
  const w = dom.window;
  w.fetch = fetchImpl;
  w.HNAState = { state: {} };
  w.HNAUtils = {};
  if (!noHelper) w.eval(read('js/transit-zone.js'));
  w.eval(read(PANEL));
  w.eval(read(EXPORT));
  return w;
}
// The real CSV writer (window.__HNA_exportCsv, building its report from the
// page as the Export button does), not only the row hook: returns the rows of
// its transit section as [label, value].
async function csvTransitRows(w, geoid) {
  const sel = w.document.getElementById('geoSelect');
  sel.innerHTML = `<option value="${geoid}" selected>x</option>`;
  const blobs = [];
  w.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:csv'; };
  w.URL.revokeObjectURL = () => {};
  w.__HNA_exportCsv();
  assert.equal(blobs.length, 1, 'the CSV writer produced no file');
  const lines = (await blobs[0].text()).split(/\r?\n/);
  const start = lines.findIndex((l) => /^"SECTION","Potential location: transit zone/.test(l));
  assert.ok(start !== -1, 'the CSV lost its transit section');
  const rows = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)"$/);
    if (!m || m[1] === '') break;
    rows.push([m[1], m[2].replace(/""/g, '"')]);
  }
  assert.equal(rows.length, 4, `the CSV transit section has ${rows.length} rows`);
  return rows;
}
async function checkCsv(w, geoid, where) {
  for (const [label, value] of await csvTransitRows(w, geoid)) {
    assert.match(value, /^Unavailable \u2014 .{10,}/, `${label}: ${value}`);
    clean(value, where);
  }
}
function files(overrides = {}) {
  return (url) => {
    if (overrides[url] === 'fail') return Promise.reject(new Error('offline'));
    const body = url in overrides ? overrides[url] : JSON.parse(read(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
}
const withoutReason = Object.assign({}, byGeo, { geographies: { [PLACE]: Object.assign({}, byGeo.geographies[PLACE], { share_within_half_mile_confirmed: null }) } });
for (const [condition, fetchImpl, geoid, now, o] of [
  ['area data failed to load', files({ 'data/hna/transit-zone-by-geography.json': 'fail' }), PLACE, FRESH_AREA],
  ['zone-map status failed to load, area data stale', files({ 'data/policy/thiz-map-status.json': 'fail' }), PLACE, STALE_AREA],
  ['area data stale', files(), PLACE, STALE_AREA],
  ['geography not covered', files(), '08', FRESH_AREA],
  ['figures incomplete', files({ 'data/hna/transit-zone-by-geography.json': withoutReason }), PLACE, FRESH_AREA],
  ['helper script missing', files(), PLACE, FRESH_AREA, { noHelper: true }],
]) {
  const w = hnaPage(fetchImpl, o);
  await w.HNARenderers.renderTransitZonePanel(geoid, now);
  const mount = w.document.getElementById('hnaTransitZoneContent');
  await check(PANEL, condition, () => {
    assert.equal(mount.getAttribute('data-tz-state'), 'unavailable');
    assert.match(mount.textContent, /^\s*Unavailable\./);
    clean(mount.textContent, PANEL);
  });
  await check(EXPORT, condition, () => {
    const rows = w.__HNA_transitZoneRows(geoid);
    assert.equal(rows.length, 4, 'the export dropped transit rows');
    for (const r of rows) {
      assert.equal(r.display, 'Unavailable', `${r.label}: ${r.display}`);
      assert.ok(r.reason && r.reason.length > 10, `${r.label}: no reason`);
      clean(r.display + ' ' + r.reason, EXPORT);
    }
  });
  await check(EXPORT, `CSV writer: ${condition}`, () => checkCsv(w, geoid, `${EXPORT} CSV`));
}
{
  // The panel for one place, the export for another; and mid-load.
  const w = hnaPage(files());
  await w.HNARenderers.renderTransitZonePanel(PLACE, FRESH_AREA);
  assert.equal(w.document.getElementById('hnaTransitZoneContent').getAttribute('data-tz-state'), 'ok', 'fixture: the panel did not render');
  await check(EXPORT, 'panel is for another geography', async () => {
    for (const r of w.__HNA_transitZoneRows('08017')) {
      assert.equal(r.display, 'Unavailable');
      clean(r.display + ' ' + r.reason, EXPORT);
    }
    await checkCsv(w, '08017', `${EXPORT} CSV`);
  });
  await check(EXPORT, 'CSV writer: fixture — a loaded panel does export figures', async () => {
    // Without this the CSV checks would pass on a writer that never exports
    // the transit section's figures at all.
    const rows = await csvTransitRows(w, PLACE);
    assert.match(rows[0][1], /\d+%/, `share row: ${rows[0][1]}`);
  });
  const pending = w.HNARenderers.renderTransitZonePanel('08017', FRESH_AREA);
  await check(PANEL, 'still loading', () => {
    const mount = w.document.getElementById('hnaTransitZoneContent');
    assert.equal(mount.getAttribute('data-tz-state'), 'loading');
    clean(mount.textContent, PANEL);
  });
  await check(EXPORT, 'panel still loading', async () => {
    assert.equal(w.document.getElementById('hnaTransitZoneContent').getAttribute('data-tz-state'), 'loading',
      'fixture: the panel finished loading before the export ran');
    for (const r of w.__HNA_transitZoneRows('08017')) {
      assert.equal(r.display, 'Unavailable');
      assert.match(r.reason, /loading/);
    }
    // The writer runs synchronously inside csvTransitRows, before any await,
    // so it sees the panel mid-load.
    for (const [label, value] of await csvTransitRows(w, '08017')) {
      assert.match(value, /^Unavailable \u2014 .*loading/, `${label}: ${value}`);
      clean(value, `${EXPORT} CSV`);
    }
  });
  await pending;
}

// ── js/project-market-study/study-transit-zone.js ──────────────────────────
const STUDY = 'js/project-market-study/study-transit-zone.js';
for (const [condition, args] of [
  ['example study, no jurisdiction', [null, byGeo, mapStatus, FRESH_AREA, TZ]],
  ['area data not loaded', [PLACE, null, mapStatus, FRESH_AREA, TZ]],
  ['area data stale', [PLACE, byGeo, mapStatus, STALE_AREA, TZ]],
  ['geography not covered', ['08999', byGeo, mapStatus, FRESH_AREA, TZ]],
  ['helper script missing', [PLACE, byGeo, mapStatus, FRESH_AREA, null]],
]) {
  await check(STUDY, condition, () => {
    const out = STZ.summarize(...args);
    assert.equal(out.state, 'unavailable');
    const text = new JSDOM(out.html).window.document.body.textContent;
    assert.match(text, /^Unavailable\./);
    clean(text, STUDY);
  });
}

// The page wrapper, render(): it fetches both files itself, so a failed or
// 404 fetch — not a null this test passes in — is what gets checked.
async function renderStudy(geoid, now, { fail = {}, noHelper } = {}) {
  const dom = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = (url) => {
    if (fail[url] === 'hang') return new Promise(() => {});
    if (fail[url] === 'reject') return Promise.reject(new Error('offline'));
    if (fail[url] === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json(url)) });
  };
  if (!noHelper) w.eval(read('js/transit-zone.js'));
  w.eval(read(STUDY));
  w.StudyTransitZone.timeoutMs = 30;   // a hung fetch gives up in 30 ms, not 20 s
  const mount = w.document.getElementById('m');
  const out = await w.StudyTransitZone.render(mount, geoid, now);
  return { out, mount };
}
const AREA = 'data/hna/transit-zone-by-geography.json';
const STATUS = 'data/policy/thiz-map-status.json';
for (const [condition, geoid, now, o] of [
  ['render: area data fetch failed', PLACE, FRESH_AREA, { fail: { [AREA]: 'reject' } }],
  ['render: area data 404', PLACE, FRESH_AREA, { fail: { [AREA]: 404 } }],
  ['render: map-status fetch failed, area data stale', PLACE, STALE_AREA, { fail: { [STATUS]: 'reject' } }],
  ['render: both fetches failed', PLACE, FRESH_AREA, { fail: { [AREA]: 'reject', [STATUS]: 'reject' } }],
  ['render: area data fetch never answers', PLACE, FRESH_AREA, { fail: { [AREA]: 'hang' } }],
  ['render: both fetches never answer', PLACE, FRESH_AREA, { fail: { [AREA]: 'hang', [STATUS]: 'hang' } }],
  ['render: helper script missing', PLACE, FRESH_AREA, { noHelper: true }],
  ['render: example study, no jurisdiction', null, FRESH_AREA, {}],
]) {
  await check(STUDY, condition, async () => {
    const { mount } = await renderStudy(geoid, now, o);
    assert.equal(mount.getAttribute('data-tz-state'), 'unavailable');
    assert.match(mount.textContent, /^Unavailable\./);
    clean(mount.textContent, STUDY);
  });
}
await check(STUDY, 'render: map-status fetch failed (area data fresh)', async () => {
  // The share is still known; the official designation is not, so the note
  // must stay provisional and name nothing official.
  for (const how of ['reject', 404]) {
    const { mount } = await renderStudy(PLACE, FRESH_AREA, { fail: { [STATUS]: how } });
    assert.equal(mount.getAttribute('data-tz-state'), 'ok', 'fixture: fresh area data did not render');
    const des = mount.querySelector('[data-tz-designation]');
    assert.equal(des.getAttribute('data-tz-designation'), 'provisional');
    assert.match(des.textContent, /could not be read/);
    unavailableClean(des.textContent, `${STUDY} designation note`);
    assert.doesNotMatch(mount.textContent, /Outside every|Inside a Transit|official_|Soft Funding Stack|may be eligible/);
  }
});

// The page's own mount (the inline loader in for-sale-market-study.html),
// with either transit script missing or the screen throwing (#1973). The
// section's initial text is the "Checking…" placeholder; the page must
// replace it with "Unavailable." and a reason, never leave it waiting.
const FSMS = 'for-sale-market-study.html';
async function runStudyPage({ noHelper, noStudy, study, area, hangJurisdiction, hangData, timeoutMs = 30 } = {}) {
  const dom = new JSDOM(read(FSMS), { runScripts: 'outside-only', url: 'http://127.0.0.1/for-sale-market-study.html' });
  const w = dom.window;
  w.fetch = (url) => {
    const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (hangData && (rel === AREA || rel === STATUS)) return new Promise(() => {});
    if (rel === AREA && area) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(area) });
    if (!fs.existsSync(path.join(ROOT, rel))) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json(rel)) });
  };
  w.JurisdictionUrlContext = { resolve: () => (hangJurisdiction ? new Promise(() => {}) : Promise.resolve({ geoid: PLACE })) };
  w.StudyGeography = { resolve: () => ({ geoid: PLACE }) };
  w.marketStudyLandModelsReady = new Promise(() => {});   // the study body is not under test
  if (!noHelper) w.eval(read('js/transit-zone.js'));
  if (study) w.StudyTransitZone = study;
  else if (!noStudy) w.eval(read(STUDY));
  if (w.StudyTransitZone && !study) w.StudyTransitZone.timeoutMs = timeoutMs;   // hung calls give up fast in tests
  const mount = w.document.getElementById('msTransitZoneContent');
  assert.match(mount.textContent, /Checking/, 'fixture: the page lost its "Checking…" placeholder — update this sweep');
  const loader = [...w.document.querySelectorAll('script:not([src])')]
    .map((el) => el.textContent).filter((s) => s.includes('msTransitZoneContent'));
  assert.equal(loader.length, 1, `${FSMS} no longer has one inline loader that mounts the transit section — update this sweep`);
  // An error the loader lets escape is a failure of this case, not a crash
  // of the whole sweep.
  const escaped = [];
  const onEscape = (e) => escaped.push(e);
  process.on('unhandledRejection', onEscape);
  try {
    w.eval(loader[0]);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const started = Date.now();
    for (let i = 0; i < 600 && !mount.getAttribute('data-tz-state'); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    mount.elapsedMs = Date.now() - started;
    await new Promise((r) => setTimeout(r, 5));
  } finally {
    process.off('unhandledRejection', onEscape);
  }
  assert.deepEqual(escaped.map((e) => String(e && e.message || e)), [], 'the page loader let an error escape');
  return mount;
}
for (const [condition, opts] of [
  ['page: study-transit-zone.js missing', { noStudy: true }],
  ['page: both transit scripts missing', { noStudy: true, noHelper: true }],
  ['page: js/transit-zone.js missing', { noHelper: true }],
  ['page: the screen throws', { study: { render: () => { throw new Error('boom'); } } }],
  ['page: the screen rejects', { study: { render: () => Promise.reject(new Error('boom')) } }],
  ['page: the transit data never answers', { hangData: true }],
  ['page: the jurisdiction lookup and the data never answer', { hangJurisdiction: true, hangData: true }],
]) {
  await check(STUDY, condition, async () => {
    const mount = await runStudyPage(opts);
    assert.equal(mount.getAttribute('data-tz-state'), 'unavailable', `still showing: ${mount.textContent}`);
    assert.doesNotMatch(mount.textContent, /Checking/);
    assert.match(mount.textContent, /^Unavailable\. .{10,}/);
    clean(mount.textContent, `${FSMS} mount`);
  });
}
await check(STUDY, 'page: fixture — both scripts and fresh data do answer', async () => {
  // Without this the cases above would pass on a page that never answers.
  const fresh = Object.assign({}, byGeo, { meta: Object.assign({}, byGeo.meta, { stops_generated: new Date(Date.now() - DAY).toISOString() }) });
  const mount = await runStudyPage({ area: fresh });
  assert.equal(mount.getAttribute('data-tz-state'), 'ok', `did not answer: ${mount.textContent}`);
  assert.match(mount.querySelector('[data-tz="share"]').textContent, /\d+%/);
});
await check(STUDY, 'page: one time limit covers the lookup and the data together', async () => {
  // With both stalled, the waits must overlap: about one limit, not two back
  // to back (the #1987 review). 500 ms each way leaves room for a slow runner.
  const mount = await runStudyPage({ hangJurisdiction: true, hangData: true, timeoutMs: 500 });
  assert.equal(mount.getAttribute('data-tz-state'), 'unavailable', `still showing: ${mount.textContent}`);
  assert.ok(mount.elapsedMs < 900, `the section waited ${mount.elapsedMs} ms: the lookup and data limits ran one after the other`);
});
await check(STUDY, 'page: a jurisdiction lookup that never answers does not hold the section', async () => {
  // The screen goes ahead with the geography the URL names once its time
  // limit passes, and still answers from fresh data.
  const fresh = Object.assign({}, byGeo, { meta: Object.assign({}, byGeo.meta, { stops_generated: new Date(Date.now() - DAY).toISOString() }) });
  const mount = await runStudyPage({ area: fresh, hangJurisdiction: true });
  assert.equal(mount.getAttribute('data-tz-state'), 'ok', `did not answer: ${mount.textContent}`);
});

// ── recommendation.html + js/workflow/recommendation-contract.js ───────────
const REC = 'recommendation.html';
const recDigest = json(`data/hna/jurisdiction-metrics-digest/${PLACE}.json`);
for (const [condition, transitZone] of [
  ['transit files not loaded', null],
  ['area data stale', TZ.areaSummary(byGeo, PLACE, mapStatus, STALE_AREA)],
  ['summary for another jurisdiction', TZ.areaSummary(byGeo, '08017', mapStatus, FRESH_AREA)],
]) {
  await check(REC, condition, () => {
    for (const project of [null, { deal: { completedAt: '2026-09-20T00:00:00Z', dealMode: 'rental' } }]) {
      const contract = Contract.build({ digest: recDigest, project, generatedAt: 'x', transitZone });
      const t = contract.conclusions.find((c) => c.id === 'transit');
      assert.equal(t.state, Contract.INSUFFICIENT);
      const dom = new JSDOM('<div id="m"></div>');
      Page.render(dom.window.document.getElementById('m'), contract);
      const section = dom.window.document.querySelector('[data-conclusion="transit"]');
      assert.match(section.textContent, /Not answered/);
      clean(section.textContent, REC);
      const lines = [];
      Page.exportPdf(contract, function () {
        return { internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
          setFontSize() {}, setFont() {}, setTextColor() {}, addPage() {},
          splitTextToSize: (s) => [String(s)], text: (s) => lines.push(String(s)) };
      });
      // The whole transit section: from its question to the next heading
      // (it is the last conclusion, so "What the reader recorded").
      const start = lines.findIndex((l) => l === t.question);
      const end = lines.indexOf('What the reader recorded', start);
      assert.ok(start !== -1 && end > start, 'the PDF lost the transit section');
      const pdfSection = lines.slice(start, end);
      assert.ok(t.blocking.every((b) => pdfSection.some((l) => l.includes(b))), 'the scanned PDF section misses a blocking line');
      clean(pdfSection.join('\n'), `${REC} PDF`);
    }
  });
}

// The page's own loader (the inline script in recommendation.html), driven
// with the transit files failing or stale — not a summary this test builds,
// so a change to how the page fetches, falls back or dates the data is what
// gets checked.
async function runRecommendationPage({ transitFiles, noHelper }) {
  const html = read(REC);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1/recommendation.html' });
  const w = dom.window;
  w.fetch = (url) => {
    const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (rel in transitFiles) {
      const v = transitFiles[rel];
      if (v === 'reject') return Promise.reject(new Error('offline'));
      if (v === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(v) });
    }
    if (!fs.existsSync(path.join(ROOT, rel))) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json(rel)) });
  };
  w.JurisdictionUrlContext = { resolve: () => Promise.resolve({ geoid: PLACE }) };
  w.WorkflowState = { getActiveProject: () => null };
  if (!noHelper) w.eval(read('js/transit-zone.js'));
  w.eval(read('js/workflow/recommendation-contract.js'));
  w.eval(read('js/workflow/recommendation-page.js'));
  const inline = [...w.document.querySelectorAll('script:not([src])')].map((el) => el.textContent);
  assert.equal(inline.length, 1, 'recommendation.html no longer has one inline loader — update this sweep');
  w.eval(inline[0]);
  const mount = w.document.getElementById('recommendationMount');
  for (let i = 0; i < 200 && !mount.querySelector('[data-conclusion="transit"]'); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const section = mount.querySelector('[data-conclusion="transit"]');
  assert.ok(section, 'the page never rendered the transit conclusion');
  return section;
}
const staleFile = Object.assign({}, byGeo, { meta: Object.assign({}, byGeo.meta,
  { stops_generated: new Date(Date.now() - 40 * DAY).toISOString() }) });
for (const [condition, opts] of [
  ['page: transit file 404', { transitFiles: { 'data/hna/transit-zone-by-geography.json': 404 } }],
  ['page: both transit files rejected', { transitFiles: { 'data/hna/transit-zone-by-geography.json': 'reject', 'data/policy/thiz-map-status.json': 'reject' } }],
  ['page: transit data stale on today\'s clock', { transitFiles: { 'data/hna/transit-zone-by-geography.json': staleFile } }],
  ['page: js/transit-zone.js missing', { transitFiles: {}, noHelper: true }],
]) {
  await check(REC, condition, async () => {
    const section = await runRecommendationPage(opts);
    assert.equal(section.getAttribute('data-state'), 'insufficient');
    assert.match(section.textContent, /Not answered/);
    clean(section.textContent, REC);
  });
}
await check(REC, 'page: fixture — fresh files do answer', async () => {
  // Without this the four cases above would pass on a page that never
  // answers at all.
  const fresh = Object.assign({}, byGeo, { meta: Object.assign({}, byGeo.meta, { stops_generated: new Date(Date.now() - DAY).toISOString() }) });
  const section = await runRecommendationPage({ transitFiles: { 'data/hna/transit-zone-by-geography.json': fresh } });
  assert.equal(section.getAttribute('data-state'), 'provisional');
  assert.match(section.textContent, /\d+%/);
});

// ── Every surface that shows the zone answer, and that it was swept ────────
// The surfaces, and how each takes its answer from js/transit-zone.js (an
// area summary, a site status, or the shared funding rule) rather than
// computing its own. A new surface is added here, with its absence cases
// above; a surface that stops using js/transit-zone.js fails here.
const SURFACES = [
  ['js/hna/hna-renderers.js', /TZ\.areaSummary\(/, 'needs assessment panel'],
  ['js/hna/hna-export.js', /transitZone:\s*_transitZoneFromPanel\(/, 'HNA PDF / Excel / CSV'],
  ['recommendation.html', /areaSummary\(/, 'recommendation page'],
  ['js/project-market-study/study-transit-zone.js', /tz\.areaSummary\(/, 'for-sale study'],
  ['js/market-analysis.js', /TransitZone\.create\(/, 'PMA site gate'],
  ['js/deal-calculator.js', /fundingPath\(/, 'deal calculator funding line'],
];
try {
  const own = SURFACES.filter(([file, re]) => !re.test(read(file))).map(([file, , what]) => `${what} (${file})`);
  assert.deepEqual(own, [], 'these surfaces no longer take their answer from js/transit-zone.js');
  const missed = SURFACES.map(([file]) => file).filter((f) => !(covered[f] && covered[f].length >= 3));
  assert.deepEqual(missed, [], 'surfaces this sweep did not check against at least three unknown conditions');
  passed += 1;
  console.log(`  ✓ every surface takes its answer from js/transit-zone.js and was swept (${SURFACES.length} surfaces, ${passed - 1} checks)`);
} catch (e) {
  failures += 1;
  console.log(`  ✗ coverage — ${e.message}`);
}

console.log(`transit-zone-absence: ${passed} passed${failures ? `, ${failures} failed` : ''}`);
process.exit(failures ? 1 : 0);
