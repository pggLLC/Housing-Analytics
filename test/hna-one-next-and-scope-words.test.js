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
  assert.ok(/county_proportional: 'Apportioned/.test(js), 'apportioned jobs figures are not called apportioned');
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
  assert.ok(/' county-wide \(' \+ countyScope \+ '\)'/.test(js), 'the QCT row no longer says county-wide');
});

console.log(failures === 0 ? '  hna-one-next-and-scope-words: PASS' : '  hna-one-next-and-scope-words: FAIL (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
