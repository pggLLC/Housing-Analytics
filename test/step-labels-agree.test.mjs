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

// 1. footers. The HNA chapter pages are views generated from the canonical
//    HNA page, so they resolve to the same rail step as it does.
const hnaViews = JSON.parse(read('data/hna/hna-views.json')).views.map((v) => v.slug);
const isHnaFamily = (f) => f === 'housing-needs-assessment.html' || hnaViews.includes(f);
const railStepFor = (f) => steps.find((s) => s.href === f) ||
  (isHnaFamily(f) ? steps.find((s) => isHnaFamily(s.href)) : undefined);
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let footers = 0;
for (const f of pages) {
  const html = read(f);
  const m = html.match(/<strong>Step (\d+) complete\?<\/strong>/);
  if (!m) continue;
  footers++;
  // What the visitor sees: the rail item marked as the current step (its
  // data-step and its printed number), plus the analytics step tag.
  const doc = new JSDOM(html).window.document;
  const active = doc.querySelector('.wf-step--active, .wf-step[aria-current="step"]');
  assert(active, `${f} has a "Step ${m[1]} complete?" footer but no active rail step`);
  const shown = active.querySelector('.wf-step__num');
  const own = [active.getAttribute('data-step'), shown && shown.textContent.trim(),
    (doc.querySelector('script[data-step]') || active).getAttribute('data-step')];
  for (const n of own) {
    assert.equal(Number(m[1]), Number(n), `${f}: footer says Step ${m[1]}, the page's rail/step tags say ${own.join('/')}`);
  }
  const canonical = railStepFor(f);
  assert(canonical, `${f} has a step footer but resolves to no rail step`);
  assert.equal(Number(m[1]), canonical.num, `${f}: shows step ${m[1]} but the canonical rail (workflow-progress.js) makes it step ${canonical.num}`);
}
assert(footers >= 3, `the scan found step footers to check (${footers})`);

// 2. the scenario question vs the scenario page's controls
const scenarioStep = steps.find((s) => s.key === 'scenario');
const question = w.GuidedRouteMap.ANSWERS.scenario.toLowerCase();
const page = new JSDOM(read(scenarioStep.href)).window.document;
const controls = [...page.querySelectorAll('.sb-slider-label span:first-child, input[type=range][aria-label]')]
  .map((e) => (e.getAttribute('aria-label') || e.textContent).toLowerCase()).join(' | ');
assert(controls.length > 0, 'the scan found the Scenario Builder controls');
// Every word of the question that is not framing (what the page answers:
// how ... change the homes needed) must name a control on the page, so any
// added input such as "zoning" or "rents" fails unless the page offers it.
const FRAMING = new Set(['how', 'could', 'would', 'might', 'does', 'do', 'will', 'can', 'change', 'changes',
  'affect', 'the', 'a', 'an', 'and', 'or', 'of', 'in', 'to', 'people', 'homes', 'housing', 'needed', 'need']);
const stem = (word) => word.replace(/(es|s)$/, '').slice(0, 5);
const controlStems = new Set(controls.split(/[^a-z]+/).filter(Boolean).map(stem));
const named = question.split(/[^a-z]+/).filter((t) => t && !FRAMING.has(t));
assert(named.length > 0, `the scenario question names at least one input ("${question}")`);
for (const t of named) {
  assert(controlStems.has(stem(t)),
    `the scenario question names "${t}" but the Scenario Builder has no such control (${controls})`);
}

console.log(`step-labels-agree: PASS (${footers} footers, scenario question names ${named.join(', ')})`);
