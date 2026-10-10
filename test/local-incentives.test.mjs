#!/usr/bin/env node
/**
 * Local Housing Incentives page (local-incentives.html).
 *
 * The page's one promise: a jurisdiction with no record is never shown as
 * having no program. These checks render the page from the committed data in
 * a real DOM and assert, against values recomputed here from the data files
 * (not taken from the renderer):
 *   1. every verified record for a jurisdiction is on its deep dive, and a
 *      scope with no record says which of "checked, none found", "could not
 *      be read" or "not yet checked" applies — never a bare blank;
 *   2. an unincorporated community shows its county's tools, labelled so;
 *   3. the statewide toolkit counts equal the records' own counts;
 *   4. suggestions never include a tool the jurisdiction already has, and
 *      tools Colorado law rules out are never suggested;
 *   5. an overdue record shows its review warning;
 *   6. every Prop 123 filing name resolves to a real county or municipality,
 *      except names listed here with the reason;
 *   7. the monthly watch issue orders its queue and flags a stale Prop 123 list.
 * Non-vacuity is asserted on each scan.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { monthlyIssue, queue, marker, BATCH_SIZE } from '../scripts/audit/local-incentives-watch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const D = require('../js/local-incentives-data.js');

const docs = {
  geoConfig: json('data/hna/geo-config.json'),
  fees: json('data/policy/fee-reductions.json'),
  funds: json('data/policy/local-housing-funds.json'),
  coverage: json('data/policy/incentive-coverage.json'),
  prop123: json('data/policy/prop123_jurisdictions.json'),
  alternatives: json('data/policy/incentive-alternatives.json'),
};
const CONSOLIDATED = { '08031': '0820000', '08014': '0809280' };
const canon = (g) => CONSOLIDATED[g] || g;

// ── Independent tally of the records, by canonical geoid and scope ─────────
const tally = new Map();
function note(geoid, scope, rec) {
  const g = canon(geoid);
  if (!tally.has(g)) tally.set(g, { fees: [], land_use: [], funds: [] });
  tally.get(g)[scope].push(rec);
}
docs.fees.entries.filter((e) => (e.state || 'CO') === 'CO').forEach((e) => note(e.geoid, 'fees', e));
docs.fees.land_use.filter((e) => (e.state || 'CO') === 'CO').forEach((e) => note(e.geoid, 'land_use', e));
docs.funds.entries.forEach((e) => note(e.geoid, 'funds', e));
assert(tally.size >= 40, `only ${tally.size} jurisdictions have records; the scan is vacuous`);

// ── Render harness ─────────────────────────────────────────────────────────
function page() {
  const dom = new JSDOM('<!DOCTYPE html><div data-local-incentives><div data-li-summary></div><select data-li-select></select><div data-li-jurisdiction></div><div data-li-toolkit></div><div data-li-catalog></div></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  for (const f of ['js/components/review-status.js', 'js/local-incentives-data.js', 'js/local-incentives.js']) w.eval(read(f));
  return w;
}
const w = page();
const model = w.LocalIncentivesData.build(JSON.parse(JSON.stringify(docs)));
const panel = w.document.querySelector('[data-li-jurisdiction]');
const textOf = (el) => el.textContent.replace(/\s+/g, ' ');

// 1. Every record of a jurisdiction is on its deep dive; empty scopes say why.
const ledger = new Map(docs.coverage.jurisdictions.map((r) => [canon(r.geoid), r]));
const STATE_TEXT = { none_found: 'Checked, none found', unreadable: 'Official source could not be read', not_checked: 'Not yet checked' };
let rendered = 0;
let emptyScopes = 0;
for (const [geoid, scopes] of tally) {
  w.LocalIncentivesPage.renderJurisdiction(model, geoid, panel);
  const text = textOf(panel);
  for (const r of scopes.fees) { rendered++; assert(text.includes(r.summary.replace(/\s+/g, ' ')), `${geoid}: fee record ${r.id} is not on the page`); }
  for (const r of scopes.land_use) { rendered++; assert(text.includes(r.detail.replace(/\s+/g, ' ')), `${geoid}: land-use record ${r.id} is not on the page`); }
  for (const r of scopes.funds) { rendered++; assert(text.includes(r.summary.replace(/\s+/g, ' ')), `${geoid}: fund record ${r.id} is not on the page`); }
  for (const scope of ['land_use', 'funds']) {
    if (scopes[scope].length) continue;
    emptyScopes++;
    const result = ledger.get(geoid)?.result_by_scope?.[scope];
    const expected = STATE_TEXT[result === 'none_found' || result === 'unreadable' ? result : 'not_checked'];
    assert(text.includes(expected), `${geoid}: empty ${scope} must say "${expected}"`);
  }
}
assert(rendered >= 150 && emptyScopes > 0, `rendered ${rendered} records, ${emptyScopes} empty scopes`);

// A jurisdiction nobody has checked says so for every scope, and never "none found".
const unchecked = [...model.geo.values()].find((g) => g.kind === 'place' && !tally.has(canon(g.geoid)) && !ledger.has(canon(g.geoid)));
assert(unchecked, 'expected at least one place not yet checked');
w.LocalIncentivesPage.renderJurisdiction(model, unchecked.geoid, panel);
{
  const text = textOf(panel);
  assert.equal((text.match(/Not yet checked/g) || []).length >= 3, true, `${unchecked.name}: every scope should say "Not yet checked"`);
  assert(!/Checked, none found|No relief found/.test(text), `${unchecked.name}: an unchecked place must not read as "none found"`);
}

// 2. A CDP shows its county's tools.
const cdp = [...model.geo.values()].find((g) => g.kind === 'cdp' && tally.has(canon(g.county)));
if (cdp) {
  w.LocalIncentivesPage.renderJurisdiction(model, cdp.geoid, panel);
  const county = model.geo.get(cdp.county).name;
  assert(textOf(panel).includes(`tools shown are ${county}'s`), `${cdp.name} should say it shows ${county}'s tools`);
}

// 3. Toolkit counts equal the records' own counts.
const toolkit = w.document.querySelector('[data-li-toolkit]');
w.LocalIncentivesPage.renderToolkit(model, toolkit);
const keyOf = (scope, r) => scope === 'fees' ? `fee:${r.measure}` : scope === 'land_use' ? `land_use:${r.measure}` : `funds:${r.tool}`;
const live = (scope, r) => scope === 'fees' ? r.kind !== 'repealed' : scope === 'land_use' ? r.status !== 'repealed' : r.status === 'adopted';
let toolsCounted = 0;
for (const tool of docs.alternatives.tools) {
  const m = tool.maps_to || {};
  const keys = [...(m.fee_measure || []).map((x) => `fee:${x}`), ...(m.land_use_measure || []).map((x) => `land_use:${x}`), ...(m.funds_tool || []).map((x) => `funds:${x}`)];
  let expected = 0;
  for (const scopes of tally.values()) {
    const has = ['fees', 'land_use', 'funds'].some((s) => scopes[s].some((r) => live(s, r) && keys.includes(keyOf(s, r)) &&
      !(s === 'fees' && m.fee_category && !m.fee_category.includes(r.fee_category))));
    if (has) expected++;
  }
  const row = [...toolkit.querySelectorAll('tr')].find((tr) => tr.querySelector('th')?.textContent === tool.label);
  assert(row, `toolkit has no row for ${tool.label}`);
  assert.equal(Number(row.querySelectorAll('td')[0].textContent), expected, `${tool.label}: toolkit count`);
  if (expected) toolsCounted++;
}
assert(toolsCounted >= 6, `only ${toolsCounted} tools have adopters; the count check is vacuous`);

// 4. Suggestions exclude what a jurisdiction has, and anything Colorado law rules out.
let suggestionsChecked = 0;
for (const geoid of tally.keys()) {
  const alt = model.alternatives(geoid);
  for (const s of alt.suggestions) {
    suggestionsChecked++;
    assert(!['prohibited_for_new', 'not_usable_for_housing'].includes(s.tool.colorado_status), `${geoid}: ${s.tool.id} must not be suggested`);
    assert(!alt.profile.items.some((i) => D.inUse(i) && D.itemMatchesTool(i, s.tool)), `${geoid}: suggests ${s.tool.id}, which it already has`);
  }
}
assert(suggestionsChecked > 100, 'suggestion scan is vacuous');
assert(docs.alternatives.tools.some((t) => ['prohibited_for_new', 'not_usable_for_housing'].includes(t.colorado_status)),
  'the catalog should carry at least one tool Colorado law rules out, with its reason');

// 5. An overdue record shows its warning.
{
  const copy = JSON.parse(JSON.stringify(docs));
  const target = copy.funds.entries[0];
  target.review_by = '2020-01-01';
  const m2 = w.LocalIncentivesData.build(copy);
  w.LocalIncentivesPage.renderJurisdiction(m2, canon(target.geoid), panel);
  assert(textOf(panel).includes('Review overdue'), 'an overdue fund record must show "Review overdue"');
  assert(docs.funds.entries[0].review_by !== '2020-01-01', 'the mutation must not leak into the real data');
}

// 6. Prop 123 names resolve. Names that are not a Colorado county or
// municipality are listed with the reason; a new unmatched name fails here.
const NOT_A_MUNICIPALITY = {
  'City of Highlands Ranch': 'Highlands Ranch is an unincorporated CDP governed by a metropolitan district, not a city',
  'Town of Gilman': 'Gilman is an abandoned mining town in Eagle County, not an incorporated town',
};
const p123 = D.prop123Index(docs.prop123, D.geographies(docs.geoConfig));
assert.deepEqual([...p123.unmatched].sort(), Object.keys(NOT_A_MUNICIPALITY).sort(), 'Prop 123 names that resolve to no county or municipality');
assert(p123.byGeoid.size >= 200, `only ${p123.byGeoid.size} filings resolved`);
assert.equal(p123.byGeoid.get('0820000')?.name, 'City and County of Denver');

// 7. The watch issue.
{
  const ranking = { rankings: [{ geoid: '0804000', metrics: { population: 400000 } }, { geoid: '0877290', metrics: { population: 140000 } }] };
  const all = { ...docs, ranking };
  const q = queue(all);
  assert.equal(q.rows.length, BATCH_SIZE);
  for (let i = 1; i < q.rows.length; i++) assert(q.rows[i - 1].tier <= q.rows[i].tier, 'queue must list fast-track filers first');
  assert(q.rows.every((r) => !tally.has(r.geoid) || r.open.length), 'queued jurisdictions must have an unchecked scope');
  const stale = monthlyIssue({ ...all, prop123: { ...docs.prop123, updated: '2026-01-15' } }, '2026-10-10');
  assert(/Refresh it by hand/.test(stale.body) && /refresh the Prop 123 list/.test(stale.title), 'a 268-day-old Prop 123 list must be flagged');
  const fresh = monthlyIssue({ ...all, prop123: { ...docs.prop123, updated: '2026-09-01' } }, '2026-10-10');
  assert(!/Refresh it by hand/.test(fresh.body), 'a recent Prop 123 list is not flagged');
  assert.equal(monthlyIssue(all, '2026-10-20', [`x ${marker('2026-10-10')}`]), null, 'one issue a month');
}

console.log(`Local incentives: PASS (${rendered} records rendered across ${tally.size} jurisdictions; ${toolsCounted} tools with adopters; ${suggestionsChecked} suggestions checked)`);
