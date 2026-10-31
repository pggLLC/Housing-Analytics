#!/usr/bin/env node
/**
 * One "next" per HNA part, and exports that say what each figure covers.
 *
 * Walkthrough of Fruita part 1 (2026-10-30) found four forward links on one
 * page: the banner and the closing panel said "Continue to Market Analysis",
 * the part's handoff said "Next: Who lives here", and the step block said
 * "Step 4, Market Analysis". A reader taking the first one skipped parts 2-5.
 *
 * The same review found the downloads printing codes ("county_proportional",
 * "county_value_used_directly") and a QCT count with no scope, so a county
 * fallback count read as the town's own.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VIEWS = JSON.parse(read('data/hna/hna-views.json')).views;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('hna-one-next-and-scope-words');

const panel = (src) => {
  const i = src.indexOf('<section class="hna-continue-panel"');
  return i < 0 ? '' : src.slice(i, src.indexOf('</section>', i));
};

test('the closing panel saves and no longer jumps to Market Analysis', () => {
  for (const f of ['housing-needs-assessment.html'].concat(VIEWS.map((v) => v.slug))) {
    const p = panel(read(f));
    assert.ok(p.includes('hnaSaveProjectBtn'), f + ': the Save button is gone');
    assert.ok(!/market-analysis\.html/.test(p), f + ': the closing panel links to Market Analysis again');
  }
});

test('only the last part leads to Market Analysis, and it carries the place', () => {
  for (const v of VIEWS) {
    const src = read(v.slug);
    const i = src.indexOf('id="hnaChapterHandoff"');
    const block = src.slice(i, src.indexOf('</section>', i));
    const market = /href="market-analysis\.html"/.test(block);
    assert.strictEqual(market, !v.handoff.next, v.slug + ': Market link in the handoff does not match whether this is the last part');
    if (market) assert.ok(/href="market-analysis\.html" data-carry-place/.test(block), v.slug + ': the Market link does not carry the place');
  }
});

// Agreement, not wording (AGENTS.md): render the banner on each generated
// part and compare where it goes with where the part's own handoff goes.
const { JSDOM } = require('jsdom');
const BANNER = read('js/components/workflow-next-action.js');
function partDom(slug, completedSteps) {
  const src = read(slug);
  const i = src.indexOf('<section class="hna-handoff"');
  const handoff = src.slice(i, src.indexOf('</section>', i) + '</section>'.length);
  const dom = new JSDOM('<!doctype html><main><div class="hna-jurisdiction-banner"></div>' + handoff + '</main>',
    { url: 'https://cohoanalytics.com/' + slug, runScripts: 'outside-only' });
  dom.window.WorkflowState = { getProgress: () => ({ completedSteps }) };
  dom.window.NextActionCTA = { getActiveJurisdiction: () => ({ fips: '0828745', geoType: 'place' }) };
  dom.window.eval(BANNER);
  dom.window.WorkflowNextAction.render();
  const doc = dom.window.document;
  return {
    dom,
    banner: doc.querySelector('#workflowNextAction .wf-next-action__cta'),
    handoff: doc.querySelector('#hnaChapterHandoff .hna-handoff__actions a'),
  };
}

test('the banner on each part goes where the part\'s handoff goes', () => {
  let checked = 0;
  for (const v of VIEWS) {
    for (const done of [['opportunity', 'jurisdiction'], ['opportunity', 'jurisdiction', 'hsa']]) {
      const { banner, handoff } = partDom(v.slug, done);
      assert.ok(banner && handoff, v.slug + ': banner or handoff link missing');
      assert.strictEqual(banner.getAttribute('href'), handoff.getAttribute('href'),
        v.slug + ' (' + done.join(',') + '): banner opens ' + banner.getAttribute('href') + ' but the handoff opens ' + handoff.getAttribute('href'));
      // The banner names the same destination the handoff names.
      const dest = handoff.textContent.replace(/^\s*(Next:|Continue to)\s*/, '').replace(/\s*\u2192\s*$/, '').trim();
      assert.ok(banner.textContent.includes(dest), v.slug + ': the banner does not name "' + dest + '"');
      checked += 1;
    }
  }
  assert.ok(checked >= 10, 'the scan checked only ' + checked + ' banners');
});

test('following a Market link opens Market Analysis on the selected place', () => {
  const last = VIEWS.find((v) => !v.handoff.next);
  const { dom, banner, handoff } = partDom(last.slug, ['opportunity', 'jurisdiction', 'hsa']);
  for (const a of [banner, handoff]) {
    a.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    const u = new URL(a.getAttribute('href'), 'https://cohoanalytics.com/');
    assert.strictEqual(u.pathname, '/market-analysis.html');
    assert.strictEqual(u.searchParams.get('fips'), '0828745', 'the place was not carried: ' + a.getAttribute('href'));
    assert.strictEqual(u.searchParams.get('geoType'), 'place');
  }
});

test('the handoff keeps the card\'s scope note', () => {
  const js = read('js/hna/hna-chapter-handoff.js');
  assert.ok(/function quoteScope/.test(js) && /quoteScope\(li, src\)/.test(js), 'the scope note is not quoted');
  assert.ok(/county\|\^in\\s/.test(js), 'the scope filter changed');
});

test('exports print scope words, not codes', () => {
  const js = read('js/hna/hna-export.js');
  assert.ok(/sub: l\.qctScope \|\|/.test(js), 'the QCT row lost the card\'s scope');
  assert.ok(/qctScope:\s+_cardSub\('statQctCount'\)/.test(js), 'the QCT scope is not read from the card');
  assert.ok(/'CHAS Data Source',\s+chas\.sourceLabel/.test(js), 'the CSV prints the CHAS code');
  assert.ok(/'LEHD Source',\s+emp\.sourceLabel/.test(js), 'the CSV prints the LEHD code');
  assert.ok(/drawNarrative\(_pdfPlain\('CHAS data source: ' \+ \(data\.chasCostBurden\.sourceLabel/.test(js)
    && /drawNarrative\(_pdfPlain\('LEHD source: ' \+ \(data\.employment\.sourceLabel/.test(js),
    'the PDF prints the codes, or puts the long wording in a table cell that cuts it off');
  assert.ok(!/'Approximation Basis'/.test(js), 'the misleading approximation-basis code is printed again');
  // Agreement with the producer, not a pinned word: when the build scales the
  // county inflow by population share, the export must say it was scaled.
  const py = read('scripts/hna/build_ranking_index.py');
  const pIdx = py.indexOf('lehd_source = "county_proportional"');
  assert.ok(pIdx > 0, 'the build no longer sets county_proportional; recheck the LEHD wording');
  const scaled = /in_commuters = int\(raw_inflow \* share\)/.test(py.slice(Math.max(0, pIdx - 400), pIdx));
  const lehd = new Function(js.slice(js.indexOf('  var LEHD_SOURCE_WORDS'), js.indexOf('  function _sourceWords')) + '; return LEHD_SOURCE_WORDS;')();
  const cp = lehd.county_proportional;
  if (scaled) {
    assert.ok(/share|scaled|proportion/i.test(cp) && !/unchanged|as (it|they) (is|are)|directly/i.test(cp),
      'the build scales county inflow by population share, but the export says: ' + cp);
  } else {
    assert.ok(!/share|scaled|proportion/i.test(cp), 'the build no longer scales county inflow, but the export still says: ' + cp);
  }
  // A county's own CHAS record also carries the code 'county'; only a place
  // using it is a fallback.
  const f = js.slice(js.indexOf('  var CHAS_SOURCE_WORDS'), js.indexOf('  /* The ranking index flags'));
  const words = new Function(f.replace(/  var LEHD_SOURCE_WORDS[\s\S]*?\};\n/, '') + '; return _chasSourceWords;')();
  assert.ok(!/stand in|used:/i.test(words('county', 'county')), 'a county\'s own CHAS is described as a fallback: ' + words('county', 'county'));
  assert.ok(/county/i.test(words('county', 'place')) && words('county', 'place') !== words('county', 'county'),
    'a place using county CHAS rates is not told so');
});

// Agreement with the build: every field build_ranking_index.py can flag as
// approximated must have its own method sentence in the export, so a new
// flagged field cannot fall through to a generic (or wrong) description.
test('every field the ranking index can flag has its own method in the export', () => {
  const py = read('scripts/hna/build_ranking_index.py');
  const a = py.indexOf('approximated_fields: list[str] = []');
  const block = py.slice(a, py.indexOf('opportunity_aggregated_fields = ', a));
  const flagged = [...new Set((block.match(/"([a-z0-9_]+)"/g) || []).map((x) => x.slice(1, -1))
    .filter((f) => !/^(county|place|place_acs_direct|county_active_market_small_renter_base)$/.test(f)))];
  assert.ok(flagged.length >= 10, 'the scan found only ' + flagged.length + ' flagged fields');
  const js = read('js/hna/hna-export.js');
  const m = js.slice(js.indexOf('  var APPROX_METHODS'), js.indexOf('  function _approximationWords'));
  const APPROX_METHODS = new Function(m + '; return APPROX_METHODS;')();
  const uncovered = flagged.filter((f) => !APPROX_METHODS.some((x) => x.test.test(f)));
  assert.deepStrictEqual(uncovered, [], 'flagged by the build with no method sentence in the export: ' + uncovered.join(', '));
});

test('each download says what it leaves out', () => {
  const js = read('js/hna/hna-export.js');
  assert.ok(/notInThisFile: NOT_IN_FILE\.csv/.test(js), 'the JSON does not carry the coverage note');
  assert.ok(/\['Not in this file',\s+d\.notInThisFile/.test(js), 'the CSV does not carry the coverage note');
  assert.ok(/NOT_IN_FILE\.pdf/.test(js), 'the PDF does not carry its own coverage note');
  assert.ok(/\['Not in this file', NOT_IN_FILE\.xlsx\]/.test(js), 'the Excel About sheet does not carry its own coverage note');
});

test('the IC summary names the county when the QCT count is county-wide', () => {
  const js = read('js/ic-summary.js');
  assert.ok(/isPlace \? countyName : ''/.test(js), 'the town summary no longer passes the county');
  // Agreement with the HNA card: the IC row must use the same scope word the
  // card uses for a county-wide count, so the two surfaces read the same.
  const card = read('js/hna/hna-renderers.js').match(/features\.length \+ ' ([a-z-]+)'/);
  assert.ok(card, 'the HNA card no longer labels its county-wide count; recheck the IC summary');
  assert.ok(new RegExp("' " + card[1] + " \\(' \\+ countyScope").test(js),
    'the HNA card calls the count "' + card[1] + '" but the IC summary does not');
});

console.log(failures === 0 ? '  hna-one-next-and-scope-words: PASS' : '  hna-one-next-and-scope-words: FAIL (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
