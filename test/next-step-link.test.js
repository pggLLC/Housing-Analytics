'use strict';
// Walkthrough 2026-10-20 (R1, R4), approved by paul.
// 1. The end-of-page "Next" block is not pinned to the screen, and the step it
//    names is the next step on the canonical 1-7 path (workflow-next-action.js
//    FALLBACK_STEPS), so the two cannot drift apart.
// 2. A town opened in the Deal Calculator says why the header shows its county.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const cta = read('js/components/next-action-cta.js');
assert(!/position:\s*(sticky|fixed)/.test(cta), 'the Next block is not pinned to the screen');

const wna = read('js/components/workflow-next-action.js');
const canon = [...wna.matchAll(/\{ key: '(\w+)',\s*label: '([^']+)',\s*href: '([^']+)' \}/g)].map((m) => ({ key: m[1], label: m[2] }));
assert(canon.length === 7, 'fixture: the canonical path has 7 steps, found ' + canon.length);

const FROM = { of: 'opportunity', hna: 'hsa', pma: 'market', deal: 'deal' };
for (const [fromPage, key] of Object.entries(FROM)) {
  const dom = new JSDOM('<!doctype html><main></main>', { runScripts: 'outside-only' });
  dom.window.eval(cta);
  const html = dom.window.NextActionCTA.render({ fromPage, jurisdiction: null });
  const doc = new JSDOM(html).window.document;
  const next = doc.querySelectorAll('.naca-next');
  assert.equal(next.length, 1, `${fromPage}: exactly one primary next action`);
  const m = /^Next: Step (\d+), (.+?) →$/.exec(next[0].textContent.trim());
  assert(m, `${fromPage}: the link reads "Next: Step N, Label →", got "${next[0].textContent}"`);
  // Optional steps (Opportunity Finder) are never the "next" one.
  let i = canon.findIndex((s) => s.key === key) + 1;
  if (canon[i] && canon[i].key === 'opportunity') i++;
  assert.equal(Number(m[1]), i + 1, `${fromPage}: step number matches the canonical path`);
  assert.equal(m[2], canon[i].label, `${fromPage}: step label matches the canonical path`);
}

const dc = read('deal-calculator.html');
const banner = /function updateJurisdictionBanner\(\)[\s\S]*?\n    \}\n/.exec(dc);
assert(banner, 'deal-calculator.html has the jurisdiction banner');
assert(/cityName\s*\n?\s*\?[^:]*by county, not by town/.test(banner[0]),
  'when a town is open, the banner says limits are set by county, not by town');

console.log('next-step-link: PASS');
