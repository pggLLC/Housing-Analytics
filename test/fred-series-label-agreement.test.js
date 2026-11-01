// FRED series labels must agree with the series FRED actually publishes.
//
// data/fred-data.json carries FRED's own title for every series it fetches
// (scripts/fetch_fred_data.py stores it next to our short name). This guard
// compares our labels with that title on the facets that change what a reader
// thinks the number measures, rather than pinning any wording:
//   - a label may not say "multifamily" or "5+ units" for a series whose FRED
//     title does not (COMPUTSA is total completions);
//   - a label may not say "ready-mix" for a series whose FRED title does not
//     (PCU327310327310 is cement manufacturing);
//   - when FRED's title limits the series to production and nonsupervisory
//     employees, the label must say so (CES2000000008).
// Labels checked: the economic dashboard's indicator list, the commodity
// config in js/fred-commodities.js and the names in scripts/fetch_fred_data.py.
// Sabotage cases, built from the current text, prove each facet is enforced in
// both directions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const FACETS = [
  { name: 'multifamily', claim: /multifamily|5\+\s*units/i, title: /multifamily|5 units or more|5\+/i, rule: 'forbid' },
  { name: 'ready-mix', claim: /ready[- ]mix/i, title: /ready[- ]mix/i, rule: 'forbid' },
  { name: 'nonsupervisory', claim: /nonsupervisory/i, title: /production and nonsupervisory/i, rule: 'require' }
];

function labels(src) {
  const out = [];
  for (const m of src.dash.matchAll(/\{section:"[^"]+",\s*id:"([^"]+)",\s*title:"([^"]+)"/g)) out.push(['economic-dashboard.html', m[1], m[2]]);
  for (const m of src.comm.matchAll(/id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)) out.push(['js/fred-commodities.js', m[1], m[2]]);
  for (const m of src.fetch.matchAll(/"([A-Z0-9]+)":\s*\("([^"]+)"/g)) out.push(['scripts/fetch_fred_data.py', m[1], m[2]]);
  return out;
}

function problems(src) {
  const out = [];
  const all = labels(src);
  for (const [file, id, label] of all) {
    const title = src.data.series[id] && src.data.series[id].title;
    if (!title) continue;
    for (const f of FACETS) {
      const claims = f.claim.test(label), inTitle = f.title.test(title);
      if (f.rule === 'forbid' && claims && !inTitle) out.push(`${file}: ${id} "${label}" says ${f.name}, FRED's title is "${title}"`);
      if (f.rule === 'require' && inTitle && !claims) out.push(`${file}: ${id} "${label}" leaves out ${f.name}, FRED's title is "${title}"`);
    }
  }
  return { out, count: all.length };
}

const src = {
  dash: read('economic-dashboard.html'),
  comm: read('js/fred-commodities.js'),
  fetch: read('scripts/fetch_fred_data.py'),
  data: JSON.parse(read('data/fred-data.json'))
};

const live = problems(src);
assert.ok(live.count >= 50, `expected to read the series labels, found only ${live.count}`);
assert.deepEqual(live.out, [], 'FRED labels disagree with FRED titles:\n' + live.out.join('\n'));

// Sabotage: each mutation must apply, and must flip the result the right way.
function mut(text, re, fn) {
  const m = text.match(re);
  assert.ok(m, 'sabotage mutation did not apply: ' + re);
  return text.replace(re, fn);
}
const clone = o => JSON.parse(JSON.stringify(o));
let sabotage = 0;
function expectFail(name, s) { assert.ok(problems(s).out.length > 0, 'sabotage not caught: ' + name); sabotage++; }
function expectPass(name, s) { assert.deepEqual(problems(s).out, [], 'sabotage wrongly failed: ' + name); sabotage++; }

// 1. COMPUTSA relabelled multifamily on the dashboard fails.
expectFail('COMPUTSA called multifamily', { ...src, dash: mut(src.dash, /(id:"COMPUTSA",\s*title:")([^"]+)/, (_, a) => a + 'Multifamily Completions (5+ units)') });
// 2. The same label passes if FRED's title really were multifamily (agreement, not wording).
{
  const data = clone(src.data); data.series.COMPUTSA.title = 'New Privately-Owned Housing Units Completed: Units in Buildings with 5 Units or More';
  expectPass('multifamily title and label agree', { ...src, data, dash: mut(src.dash, /(id:"COMPUTSA",\s*title:")([^"]+)/, (_, a) => a + 'Multifamily Completions (5+ units)') });
}
// 3. The cement series called ready-mix in the commodity config fails.
expectFail('cement called ready-mix', { ...src, comm: mut(src.comm, /(id:\s*'PCU327310327310',\s*name:\s*')([^']+)/, (_, a) => a + 'Ready-Mix Concrete PPI') });
// 4. Dropping "nonsupervisory" from the fetch script's name fails.
expectFail('nonsupervisory dropped', { ...src, fetch: mut(src.fetch, /("CES2000000008":\s*\(")([^"]+)/, (_, a) => a + 'Construction Avg Hourly Earnings') });
// 5. If FRED's title stopped limiting to nonsupervisory, a plain label passes.
{
  const data = clone(src.data); data.series.CES2000000008.title = 'Average Hourly Earnings of All Employees, Construction';
  expectPass('all-employees title, plain label', { ...src, data, fetch: mut(src.fetch, /("CES2000000008":\s*\(")([^"]+)/, (_, a) => a + 'Construction Avg Hourly Earnings'), dash: mut(src.dash, /(id:"CES2000000008",\s*title:")([^"]+)/, (_, a) => a + 'Construction Avg Hourly Earnings') });
}

console.log(`FRED series label agreement: PASS (${live.count} labels, ${sabotage} sabotage checks)`);
