#!/usr/bin/env node
/**
 * Step 7's sixth conclusion: could a site here be in a Transit Zone?
 * (HB26-1065, #1937 Phase 5.)
 *
 * What it must agree with, rather than pinned copy:
 *   - data/hna/transit-zone-by-geography.json — every one of the 546
 *     jurisdictions shows the share that file holds, rounded by the rule the
 *     needs assessment panel uses (a measured share never prints as 0% or
 *     100%). test/hna-export-matches-screen.test.js holds the panel, the PDF,
 *     the CSV and the workbook to the same figure (PC-1).
 *   - data/policy/thiz-map-status.json — the designation note the conclusion
 *     carries is TransitZone.designation() for that file, word for word, on
 *     the page and in the PDF.
 *   - the recorded deal mode — an ownership project is never told the credit
 *     is a source for it (PC-2), and nobody is shown an amount.
 *
 * And absence: a file that did not load, is stale, or is about another place
 * makes the conclusion insufficient with the reason. It never reads "No site
 * passes", which is a finding, not an unknown (PC-3, #1937 T4).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const Contract = require('../js/workflow/recommendation-contract.js');
const Page = require('../js/workflow/recommendation-page.js');
const TZ = require('../js/transit-zone.js');

const byGeo = json('data/hna/transit-zone-by-geography.json');
const mapStatus = json('data/policy/thiz-map-status.json');
const FRESH = new Date(Date.parse(byGeo.meta.stops_generated) + 86400e3);
const DIGEST_DIR = 'data/hna/jurisdiction-metrics-digest';
const digest = (geoid) => json(`${DIGEST_DIR}/${geoid}.json`);

let passed = 0;
let failures = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

// How a share must print: TransitZone.shareLabel, the one rounding rule the
// needs assessment panel uses, plus the edge-strip rule (a sampled zero the
// builder did not prove is "<1%", not none). The rule itself is held below by
// fixtures chosen as "a measured share plain rounding would print as 0% or
// 100%", not by the helper's own cut-offs.
function expectedLabel(g) {
  const v = g.share_within_radius_confirmed;
  if (v === 0 && g.zero_is_exact === false) return '<1%';
  return TZ.shareLabel(v);
}
function transitFor(geoid, opts = {}) {
  const summary = 'transitZone' in opts ? opts.transitZone : TZ.areaSummary(byGeo, geoid, mapStatus, opts.now || FRESH);
  const contract = Contract.build({ digest: digest(geoid), project: opts.project || null, generatedAt: 'x', transitZone: summary });
  return { contract, t: contract.conclusions.find((c) => c.id === 'transit') };
}
const ownership = { deal: { completedAt: '2026-09-20T00:00:00Z', dealMode: 'ownership' } };
const rental = { deal: { completedAt: '2026-09-20T00:00:00Z', dealMode: 'rental' } };
const note = TZ.designation(mapStatus, FRESH).note;

console.log('recommendation-transit-zone');

test('every jurisdiction shows the share the per-geography file holds', () => {
  const digests = fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => /^\d+\.json$/.test(f));
  let checked = 0;
  const wrong = [];
  for (const f of digests) {
    const geoid = f.replace('.json', '');
    const g = byGeo.geographies[geoid];
    if (!g || g.unavailableReason) continue;
    const { t } = transitFor(geoid);
    checked += 1;
    if (t.evidence[0].value !== expectedLabel(g)) wrong.push(`${geoid}: ${t.evidence[0].value} vs ${expectedLabel(g)}`);
    if (t.state !== Contract.PROVISIONAL) wrong.push(`${geoid}: state ${t.state}`);
    if (!t.plain.endsWith(note)) wrong.push(`${geoid}: no designation note`);
    const proven = g.share_within_radius_confirmed === 0 && g.zero_is_exact === true;
    if (/^No site passes/.test(t.verdict) !== proven) wrong.push(`${geoid}: verdict "${t.verdict}" for share ${g.share_within_radius_confirmed}`);
  }
  assert.ok(checked >= 500, `only ${checked} jurisdictions had transit figures to check`);
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} disagreements`);
});

test('a measured share that plain rounding would print as 0% or 100% never does', () => {
  const measured = Object.entries(byGeo.geographies).filter(([, g]) => {
    const v = g.share_within_radius_confirmed;
    return typeof v === 'number' && v > 0 && v < 1 && [0, 100].includes(Math.round(v * 100));
  });
  // The real file has such shares today; if it ever stops having them, a
  // synthetic pair keeps both ends of the rule exercised.
  const fixtures = measured.length ? measured : [
    ['08097', Object.assign({}, byGeo.geographies['08097'], { share_within_radius_confirmed: 0.004, zero_is_exact: null })],
    ['08097', Object.assign({}, byGeo.geographies['08097'], { share_within_radius_confirmed: 0.996, zero_is_exact: null })],
  ];
  for (const [geoid, g] of fixtures) {
    const summary = TZ.areaSummary(Object.assign({}, byGeo, { geographies: { [geoid]: g } }), geoid, mapStatus, FRESH);
    const { t } = transitFor(geoid, { transitZone: summary });
    assert.doesNotMatch(t.evidence[0].value, /^(0|100)%$/, `${geoid}: measured share ${g.share_within_radius_confirmed} printed as ${t.evidence[0].value}`);
    assert.doesNotMatch(t.verdict || '', /^(0|100)% of/, `${geoid}: verdict ${t.verdict}`);
  }
});

test('an area figure is never "established": it is a screen until a site is checked', () => {
  // Even once OEDIT publishes, the area share stays the stop-based screen.
  const published = Object.assign({}, mapStatus, { status: 'published', zones_file: 'data/policy/thiz-zones.geojson' });
  const { t } = transitFor('08097', { transitZone: TZ.areaSummary(byGeo, '08097', published, FRESH) });
  assert.equal(t.state, Contract.PROVISIONAL);
  assert.ok(t.plain.endsWith(TZ.designation(published, FRESH).note));
});

for (const [label, opts, re] of [
  ['the files did not load', { transitZone: null }, /not loaded/],
  ['the stop data is stale', { now: new Date(Date.parse(byGeo.meta.stops_generated) + 40 * 86400e3) }, /days old/],
  ['the summary is for another jurisdiction', { transitZone: TZ.areaSummary(byGeo, '08017', mapStatus, FRESH) }, /different jurisdiction/],
]) {
  test(`${label} → insufficient with the reason, never "No site passes"`, () => {
    const { t, contract } = transitFor('08097', opts);
    assert.equal(t.state, Contract.INSUFFICIENT);
    assert.equal(t.verdict, null);
    assert.ok(t.blocking.length && t.blocking.every((line) => re.test(line)), t.blocking.join(' | '));
    assert.doesNotMatch(JSON.stringify(t), /No site passes|0%/);
    // The other five conclusions are unaffected by a transit failure.
    assert.deepEqual(contract.conclusions.map((c) => c.id), Contract.CONCLUSION_IDS);
  });
}

test('PC-2: an ownership project is not offered the credit as a source; a rental one is; nobody gets an amount', () => {
  const pass = Object.entries(byGeo.geographies).find(([, g]) => g.share_within_radius_confirmed > 0.2)[0];
  const own = transitFor(pass, { project: ownership }).t;
  const rent = transitFor(pass, { project: rental }).t;
  const none = transitFor(pass).t;
  assert.match(own.plain, /rental component/);
  assert.doesNotMatch(own.plain, /may be eligible/);
  assert.match(rent.plain, /may be eligible for the Transit Zone state credit/);
  assert.equal(none.plain, rent.plain, 'with no deal recorded the rental wording applies');
  for (const t of [own, rent, none]) assert.doesNotMatch(JSON.stringify(t), /\$\s?\d|million/i);
});

test('a place with no stop inside the radius gets no credit sentence at all', () => {
  const zero = Object.entries(byGeo.geographies).find(([, g]) => g.share_within_radius_confirmed === 0 && g.zero_is_exact === true)[0];
  for (const project of [null, rental, ownership]) {
    const { t } = transitFor(zero, { project });
    assert.doesNotMatch(t.plain, /credit/i, t.plain);
  }
});

test('the page and the PDF carry the transit verdict, its standing and the designation note', () => {
  const { contract, t } = transitFor('08097');
  const dom = new JSDOM('<div id="m"></div>');
  const mount = dom.window.document.getElementById('m');
  Page.render(mount, contract);
  const section = mount.querySelector('[data-conclusion="transit"]');
  assert.ok(section, 'no transit section on the page');
  assert.equal(section.getAttribute('data-state'), 'provisional');
  assert.ok(section.textContent.includes(t.verdict));
  assert.ok(section.textContent.includes(note));
  assert.equal(section.querySelector('.rec-source-link a').getAttribute('href'), 'hna-what-to-do.html#hnaTransitZonePanel');

  const lines = [];
  const stub = function () {
    return {
      internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
      setFontSize() {}, setFont() {}, setTextColor() {}, addPage() {},
      splitTextToSize: (s) => [String(s)],
      text: (s) => lines.push(Array.isArray(s) ? s.join(' ') : String(s)),
    };
  };
  Page.exportPdf(contract, stub);
  const body = lines.join('\n');
  assert.ok(body.includes(t.verdict + '  [Provisional]'), 'the PDF omits the transit verdict or its standing');
  assert.ok(body.includes(note), 'the PDF omits the designation note');
  assert.ok(body.includes('transit-stops-statewide-co'), 'the PDF sources omit the stop file');
});

// #1961: the half-mile evidence row carries the shared straight-line /
// walking disclosure, which is TransitZone.qapTodDistance's for the status
// file — so it follows the data, and every jurisdiction carries it.
const tod = TZ.qapTodDistance(mapStatus);
const halfItem = (t) => t.evidence.find((e) => e.key === 'transit_share_within_half_mile_confirmed');

test('every jurisdiction\'s half-mile share carries the shared disclosure and the data\'s distance', () => {
  assert.ok(tod, 'thiz-map-status.json has no readable qap_tod_distance');
  const digests = new Set(fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => /^\d+\.json$/.test(f)).map((f) => f.replace('.json', '')));
  let n = 0;
  for (const [geoid, g] of Object.entries(byGeo.geographies)) {
    if (g.unavailableReason || !digests.has(geoid)) continue;
    const h = halfItem(transitFor(geoid).t);
    assert.ok(h && h.value !== null, `${geoid}: no half-mile share`);
    assert.ok(h.why.includes(tod.disclosure), `${geoid}: the half-mile row drops the disclosure: ${h.why}`);
    assert.ok(h.label.includes(`within ${tod.label} of`), `${geoid}: the label does not name the data's distance: ${h.label}`);
    n++;
  }
  assert.ok(n >= 500, `only ${n} jurisdictions checked`);
});

test('the disclosure follows the status file\'s method, on the page too', () => {
  const walked = JSON.parse(JSON.stringify(mapStatus));
  walked.qap_tod_distance.method = 'walking';
  const after = TZ.qapTodDistance(walked);
  assert.notEqual(after.disclosure, tod.disclosure, 'fixture: the method change did not change the disclosure');
  const { contract, t } = transitFor('08097', { transitZone: TZ.areaSummary(byGeo, '08097', walked, FRESH) });
  assert.ok(halfItem(t).why.includes(after.disclosure));
  assert.ok(!halfItem(t).why.includes(tod.disclosure), 'the old disclosure survived a method change');
  const dom = new JSDOM('<div id="m"></div>');
  const mount = dom.window.document.getElementById('m');
  Page.render(mount, contract);
  const row = [...mount.querySelectorAll('[data-conclusion="transit"] tr')].find((tr) => tr.textContent.includes(halfItem(t).label));
  assert.ok(row, 'the page has no half-mile evidence row');
  assert.ok(row.textContent.includes(after.disclosure), 'the page\'s half-mile evidence row drops the disclosure');
});

test('no readable TOD distance: the half-mile row is insufficient with the reason; the zone answer stands', () => {
  const gone = JSON.parse(JSON.stringify(mapStatus));
  delete gone.qap_tod_distance;
  const { t } = transitFor('08097', { transitZone: TZ.areaSummary(byGeo, '08097', gone, FRESH) });
  const h = halfItem(t);
  assert.equal(h.value, null);
  assert.equal(h.state, Contract.INSUFFICIENT);
  assert.match(h.why, /could not be read/);
  assert.doesNotMatch(h.label, /\d/, `an unknown distance was given a number: ${h.label}`);
  assert.equal(t.state, Contract.PROVISIONAL, 'a missing half-mile distance withdrew the zone-radius answer');
  assert.ok(t.verdict);
  assert.equal(t.evidenceCount, 2);
});

test('the recommendation page reads the same two files the needs assessment panel reads', () => {
  const page = read('recommendation.html');
  const panel = read('js/hna/hna-renderers.js');
  const files = ['data/hna/transit-zone-by-geography.json', 'data/policy/thiz-map-status.json'];
  for (const f of files) {
    assert.ok(panel.includes(`'${f}'`), `fixture: the HNA panel no longer reads ${f}`);
    assert.ok(page.includes(`'${f}'`), `recommendation.html does not read ${f}`);
  }
  const tzAt = page.indexOf('src="js/transit-zone.js"');
  assert.ok(tzAt !== -1 && tzAt < page.indexOf('src="js/workflow/recommendation-contract.js"'),
    'recommendation.html must load js/transit-zone.js before the contract');
  assert.match(page, /transitZone:\s*parts\[1\]/, 'recommendation.html does not pass the transit summary to the contract');
  assert.match(page, /areaSummary\(parts\[0\], geoid, parts\[1\]/, 'the summary is not for the page\'s own geography');
});

console.log(`recommendation-transit-zone: ${passed} passed${failures ? `, ${failures} failed` : ''}`);
process.exit(failures ? 1 : 0);
