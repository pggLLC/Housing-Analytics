#!/usr/bin/env node
// Step labels on a page must agree with the step the page is (Codex audit,
// 2026-10-17): the Scenario Builder's footer said "Step 4 complete?" while its
// rail said Step 5, Market Analysis said "Step 3 complete?" as step 4, and the
// route map asked how "rents, mix and growth" change need on a page that has
// no rent or unit-mix control.
//
// 1. Every "Step N complete?" equals the page's own data-step, which must
//    equal workflow-progress.js STEPS for that page.
// 2. The route map's question for the scenario step may name only inputs the
//    Scenario Builder actually offers as controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
w.eval(read('js/components/workflow-progress.js'));
w.eval(read('js/components/guided-route-map.js'));
const progressSrc = read('js/components/workflow-progress.js');
const steps = [...progressSrc.matchAll(/\{\s*num:\s*(\d+),\s*key:\s*'(\w+)'[^}]*href:\s*'([^']+)'/g)]
  .map((m) => ({ num: Number(m[1]), key: m[2], href: m[3] }));
assert(steps.length >= 7, `read the canonical steps (${steps.length})`);

// 1. footers
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let footers = 0;
for (const f of pages) {
  const html = read(f);
  const m = html.match(/<strong>Step (\d+) complete\?<\/strong>/);
  if (!m) continue;
  footers++;
  const own = html.match(/data-step="(\d+)"/);
  assert(own, `${f} declares its step (data-step) next to a "Step ${m[1]} complete?" footer`);
  assert.equal(Number(m[1]), Number(own[1]), `${f}: footer says Step ${m[1]}, page is step ${own[1]}`);
  const canonical = steps.find((s) => s.href === f);
  if (canonical) assert.equal(Number(own[1]), canonical.num, `${f}: data-step ${own[1]} disagrees with the rail's step ${canonical.num}`);
}
assert(footers >= 3, `the scan found step footers to check (${footers})`);

// 2. the scenario question vs the scenario page's controls
const scenarioStep = steps.find((s) => s.key === 'scenario');
const question = w.GuidedRouteMap.ANSWERS.scenario.toLowerCase();
const page = new JSDOM(read(scenarioStep.href)).window.document;
const controls = [...page.querySelectorAll('.sb-slider-label span:first-child, input[type=range][aria-label]')]
  .map((e) => (e.getAttribute('aria-label') || e.textContent).toLowerCase()).join(' | ');
assert(controls.length > 0, 'the scan found the Scenario Builder controls');
const INPUTS = ['rent', 'unit mix', 'mix', 'cost', 'financing', 'birth', 'death', 'moving in', 'migration'];
const named = INPUTS.filter((t) => new RegExp('\\b' + t).test(question));
assert(named.length > 0, `the scenario question names at least one input ("${question}")`);
for (const t of named) {
  assert(new RegExp('\\b' + t).test(controls),
    `the scenario question names "${t}" but the Scenario Builder has no such control (${controls})`);
}

console.log(`step-labels-agree: PASS (${footers} footers, scenario question names ${named.join(', ')})`);
