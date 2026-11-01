'use strict';
// Colorado deep dive: each label must agree with what it labels (AGENTS.md "pin the agreement, not the copy").
//   - the policy simulator's per-capita starting point = the per-capita amount the page itself shows from IRS Rev. Proc. 2025-32;
//   - the Pipeline pressure label names the unit js/market-intelligence.js computes;
//   - the unemployment labels describe how the page's script averages the county rates;
//   - the concession chart's subtitle, canvas metadata and source line name the same source and URL.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function problems(page, sim, mi) {
  const out = [];
  // 1. Per-capita: the page's own figure ("$3.416 per resident"), rounded to cents, is the simulator's starting point.
  const shown = [...page.matchAll(/\$(\d+\.\d+) per resident/g)].map(m => +m[1]);
  if (!shown.length) out.push('no "$x per resident" figure found on the page to compare with');
  const desc = (sim.match(/id: 'perCapita'[\s\S]*?description: '([^']*)'/) || [])[1];
  if (!desc) out.push('policy simulator perCapita scenario not found');
  else {
    const from = (desc.match(/from [^$]*\$(\d+\.\d+)/) || [])[1];
    if (!from || shown.some(v => Math.abs(v - +from) > 0.005)) out.push('simulator per-capita start ($' + from + ') does not match the page figure ($' + shown.join(', $') + ')');
    if (!/Rev\. Proc\. 2025-32/.test(desc) || !/Rev\. Proc\. 2025-32/.test(page)) out.push('simulator per-capita start does not name the same IRS source as the page');
  }
  // 2. Pipeline pressure: the label's unit is the unit the script writes.
  const unit = (mi.match(/pipelineRate \+ ' ([^']+)'/) || [])[1];
  const label = (page.match(/Pipeline Pressure<\/div>[\s\S]*?id="riskPipeline"[\s\S]*?<div[^>]*>([^<]*)<\/div>/) || [])[1];
  if (!unit || !label) out.push('Pipeline pressure value or label not found');
  else if (unit === 'projects/1k HH' ? !/projects per 1,000 households/i.test(label) : true) out.push('Pipeline pressure label "' + label + '" does not match the computed unit "' + unit + '"');
  // 3. Unemployment: if the script takes a simple mean of county rates, no label may call it a statewide rate.
  const simpleMean = /\.map\(function \(c\) \{ return c\.unemployment_rate; \}\)[\s\S]{0,200}\/ vals\.length/.test(page);
  const labels = ['Inline', 'Stat'].map(k => { const i = page.indexOf('id="cddUnemployment' + k + '"'); return i < 0 ? null : page.slice(i, i + 400).split('</div>').slice(0, k === 'Stat' ? 2 : 1).join(' '); }).filter(Boolean);
  if (!labels.length) out.push('unemployment figures not found');
  if (simpleMean && labels.some(l => /statewide/i.test(l) || !/average of county rates/i.test(l))) out.push('unemployment is a simple average of county rates but a label says otherwise');
  // 4. Concession chart: subtitle, canvas data-source and source caption agree.
  const block = (page.match(/<p class="chart-subtitle">Average monthly concession value[\s\S]*?<p class="chart-source">[\s\S]*?<\/p>/) || [])[0];
  if (!block) out.push('concession chart not found');
  else {
    const sub = (block.match(/<p class="chart-subtitle">[\s\S]*?<a href="([^"]+)"[^>]*>([^<]+)<\/a>/) || []).slice(1);
    const cv = [(block.match(/data-source-url="([^"]+)"/) || [])[1], (block.match(/data-source="([^"]+)"/) || [])[1]];
    const cap = (block.match(/<p class="chart-source">[\s\S]*?<a href="([^"]+)"[^>]*>([^<]+)<\/a>/) || []).slice(1);
    if (!(sub[1] && sub[1] === cv[1] && cv[1] === cap[1] && sub[0] === cv[0] && cv[0] === cap[0])) out.push('concession chart names different sources: subtitle "' + sub[1] + '", data-source "' + cv[1] + '", caption "' + cap[1] + '"');
  }
  return out;
}

const page = read('colorado-deep-dive.html'), sim = read('js/policy-simulator.js'), mi = read('js/market-intelligence.js');
const found = problems(page, sim, mi);
assert.deepStrictEqual(found, [], found.join('\n'));

// Sabotage both ways, with every mutation built from the current source text (no live label is pinned here).
// Each mutation must change the text; a broken claim fails, a coordinated rewording passes.
const mut = (s, a, b) => { const t = s.split(a).join(b); assert.notStrictEqual(t, s, 'mutation did not apply: ' + a); return t; };
const once = (s, a, b) => { const i = s.indexOf(a); assert(i > -1, 'mutation did not apply: ' + a); return s.slice(0, i) + b + s.slice(i + a.length); };
const fail = (p, s, m, what) => assert(problems(p, s, m).length > 0, 'guard missed: ' + what);
const pass = (p, s, m, what) => assert.deepStrictEqual(problems(p, s, m), [], 'guard blocked a harmless edit: ' + what);
const block = page.match(/<p class="chart-subtitle">Average monthly concession value[\s\S]*?<p class="chart-source">[\s\S]*?<\/p>/)[0];
const srcName = block.match(/data-source="([^"]+)"/)[1];
fail(once(page, 'data-source="' + srcName + '"', 'data-source="' + srcName + ' (other)"'), sim, mi, 'concession data-source changed alone');
pass(mut(page, srcName, srcName + ' (renamed)'), sim, mi, 'concession source renamed everywhere');
const desc = sim.match(/id: 'perCapita'[\s\S]*?description: '([^']*)'/)[1];
const fromFig = desc.match(/from [^$]*(\$\d+\.\d+)/)[1];
fail(page, once(sim, fromFig, '$2.75'), mi, 'stale per-capita start');
const unit = mi.match(/pipelineRate \+ ' ([^']+)'/)[1];
fail(page, sim, once(mi, "' " + unit + "'", "' permits/1k units'"), 'pipeline unit changed without its label');
const unLabel = page.match(/average of county rates/i)[0];
fail(once(page, unLabel, 'statewide rate'), sim, mi, 'unemployment called statewide');
console.log('deep dive label accuracy: PASS (4 agreements, 5 sabotage checks)');
