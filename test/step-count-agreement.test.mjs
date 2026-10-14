#!/usr/bin/env node
/**
 * Every page that numbers the guided path must agree with the step rail.
 *
 * On 2026-10-14 a persona walk of the live site found four different answers
 * to "how many steps are there?": the menu called the Opportunity Finder
 * "Step 1" and Select Jurisdiction "Step 2"; the rail has seven steps with
 * Jurisdiction first; LIHTC Basics and the comparison page said "the 5-step
 * workflow"; and the Opportunity Finder banner pointed at an "8-step
 * methodology" (the Pipeline page, a different, longer sequence). A first-time
 * walker meets all four in the first few minutes.
 *
 * The rail (js/components/workflow-progress.js STEPS) is the source of truth.
 * This test asserts agreement with it, not any particular wording:
 *   1. every "Step N" in the menu names the page the rail puts at step N;
 *   2. any "<count>-step workflow / guided path" claim equals the rail length;
 *   3. the Pipeline is described in stages, so nothing calls it "N-step".
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── The rail ───────────────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><main></main>', {
  url: 'https://cohoanalytics.com/select-jurisdiction.html', runScripts: 'outside-only',
});
dom.window.eval(read('js/components/workflow-progress.js'));
const WP = dom.window.WorkflowProgress;
assert.ok(WP && Array.isArray(WP.STEPS) && WP.STEPS.length > 0, 'WorkflowProgress.STEPS not exposed');
const RAIL = WP.STEPS;
const N = RAIL.length;
const byNum = new Map(RAIL.map((s) => [s.num, s.href]));

// The Needs Assessment step may open any of its parts or the full report.
const HNA_PAGES = new Set(['housing-needs-assessment.html', 'hna-what-housing-exists.html']);
const sameStep = (a, b) => a === b || (HNA_PAGES.has(a) && HNA_PAGES.has(b));

// ── 1. Menu "Step N" labels ────────────────────────────────────────────────
const nav = read('js/navigation.js');
const navSteps = [...nav.matchAll(/href:\s*"([^"]+)"[^}]*desc:\s*"Step (\d+)\b/g)]
  .map((m) => ({ href: m[1].split('#')[0].split('?')[0], num: Number(m[2]) }));
assert.ok(navSteps.length >= N, `expected the menu to number at least ${N} steps, found ${navSteps.length}`);
for (const { href, num } of navSteps) {
  assert.ok(byNum.has(num), `menu says Step ${num} for ${href}; the rail has only ${N} steps`);
  assert.ok(sameStep(byNum.get(num), href),
    `menu calls ${href} "Step ${num}", but the rail puts ${byNum.get(num)} at step ${num}`);
}

// ── 2 and 3. Step-count claims across pages ────────────────────────────────
const WORDS = { five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f))
  .concat(['js/components/workflow-progress.js', 'data/pipeline/content.json']);

let claims = 0;
const bad = [];
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(/\b(\d|five|six|seven|eight|nine)-step\s+(workflow|guided path|path|methodology|framework|public)/gi)) {
    claims++;
    const n = /\d/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
    const kind = m[2].toLowerCase();
    if (kind === 'methodology' || kind === 'framework' || kind === 'public') {
      bad.push(`${f}: "${m[0]}" (the Pipeline has stages, not steps; call it "${m[1]}-stage")`);
    } else if (n !== N) {
      bad.push(`${f}: "${m[0]}" (the rail has ${N} steps)`);
    }
  }
}
assert.ok(claims > 0, 'scan found no step-count claims at all; the pattern has stopped matching');
assert.deepStrictEqual(bad, [], 'step counts disagree with the rail:\n  ' + bad.join('\n  '));

console.log(`step-count-agreement: ${navSteps.length} menu labels and ${claims} count claims agree with the ${N}-step rail`);
