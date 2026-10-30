#!/usr/bin/env node
'use strict';
// The market call line on the Housing Needs Assessment (js/hna/hna-market-call.js)
// must agree with what it is drawn from, for every county and place in the file:
//
//   - the call it names is the file's call, in the words the Deep Dive tab uses
//     for it (js/market-direction.js CALLS);
//   - a call with too little data says so with the file's own reason;
//   - this year's permits are the file's figures, and a missing count is said
//     with the file's reason, never shown as a number;
//   - a town's line names its county and that county's call;
//   - the link opens the tab that exists on colorado-deep-dive.html;
//   - the line is on the page that carries the market section, and stays hidden
//     for a combined view, which covers several places.
// The second half applies mutations to the script, proves each changed it, and
// proves a broken claim fails while a rewording stays green.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MD = JSON.parse(read('data/market/market-direction.json'));
const SRC = read('js/hna/hna-market-call.js');

// The tab's own call names.
const tabDom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
tabDom.window.eval(read('js/market-direction.js'));
const TAB_CALLS = tabDom.window.MarketDirection._calls;
assert.ok(TAB_CALLS && TAB_CALLS.steady, 'the tab script exposes its call names');

// The page wiring.
for (const page of ['housing-needs-assessment.html', 'hna-where-its-heading.html']) {
  const html = read(page);
  const sec = html.match(/<section id="co-market-conditions"[\s\S]*?<\/section>/);
  assert.ok(sec, `${page}: the market section is on the page`);
  assert.match(sec[0], /<h2>[^<]*<\/h2>\s*<!--[^>]*-->\s*<p id="hnaMarketCall"[^>]*data-market-call[^>]*hidden><\/p>/, `${page}: the call line opens the market section`);
  assert.match(html, /<script defer src="js\/hna\/hna-market-call\.js"><\/script>/, `${page}: loads the call script`);
}
const tabTarget = (SRC.match(/var TAB = '([^']+)'/) || [])[1] || '';
const [tabPage, tabHash] = tabTarget.split('#');
assert.ok(tabHash && new RegExp(`role="tabpanel" id="${tabHash}"`).test(read(tabPage)), `the link opens a tab that exists: ${tabTarget}`);

function load(src) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(src);
  return dom.window.HnaMarketCall;
}
// The visible text, as a browser reads it; one parser reused for every line.
const textHost = new JSDOM('<!doctype html><body><p></p></body>').window.document.querySelector('p');
const text = (html) => { textHost.innerHTML = html; return textHost.textContent; };
const fmt = (n) => n.toLocaleString('en-US');

function checks(api) {
  const fails = [];
  const fail = (m) => { if (fails.length < 20) fails.push(m); };
  const seen = { called: 0, noData: 0, permits: 0, noPermits: 0, town: 0 };
  const all = [
    ...Object.entries(MD.counties).map(([g, r]) => [{ kind: 'county', geoid: g }, r]),
    ...Object.entries(MD.places).map(([g, r]) => [{ kind: 'place', geoid: g }, r]),
  ];
  for (const [t, r] of all) {
    const html = api._lineFor(MD, t);
    if (!html) { fail(`${r.name}: no line`); continue; }
    const s = text(html);
    if (r.call === 'not_enough_data') {
      seen.noData++;
      if (!/not enough data/i.test(s) || !s.includes(r.call_basis)) fail(`${r.name}: no-data line lacks the file's reason: ${s}`);
    } else {
      seen.called++;
      const want = TAB_CALLS[r.call] && TAB_CALLS[r.call].label;
      if (!want || !s.includes(want)) fail(`${r.name}: line does not name the call as the tab does (${want}): ${s}`);
      for (const k of Object.keys(TAB_CALLS)) if (k !== r.call && k !== 'not_enough_data' && s.startsWith(`Market direction: ${TAB_CALLS[k].label}.`)) fail(`${r.name}: line names ${k}, the file ${r.call}`);
    }
    const p = r.permits_ytd;
    if (p && p.ytd && p.prior_ytd) {
      seen.permits++;
      if (!s.includes(`${fmt(p.ytd.total)} homes`) || !s.includes(fmt(p.prior_ytd.total))) fail(`${r.name}: permits differ from the file ${p.ytd.total} / ${p.prior_ytd.total}: ${s}`);
    } else {
      seen.noPermits++;
      if (!/no permit reading/.test(s) || !s.includes(p.unavailable_reason)) fail(`${r.name}: missing permits not said with the file's reason: ${s}`);
      if (/\b0 homes\b/.test(s)) fail(`${r.name}: a missing permit count shows as 0`);
    }
    if (t.kind === 'place') {
      const c = MD.counties[r.county_fips];
      if (c) {
        seen.town++;
        if (!s.includes(c.name) || !s.toLowerCase().includes(`is ${TAB_CALLS[c.call].label.toLowerCase()}`)) fail(`${r.name}: county call differs from ${c.name} ${c.call}: ${s}`);
      }
    }
    if (!html.includes(`href="${tabTarget}"`)) fail(`${r.name}: the link does not open ${tabTarget}`);
  }
  // Non-vacuity: every branch is exercised by the committed file.
  for (const [k, n] of Object.entries(seen)) if (!n) fail(`no record exercised "${k}": that branch is unchecked`);
  return fails;
}

// The rendered page: the line fills for a town and hides for a combined view.
async function rendered(src, current) {
  const dom = new JSDOM('<!doctype html><body><p id="hnaMarketCall" data-market-call hidden></p></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.HNAState = { state: { current } };
  w.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(MD)) });
  w.eval(src);
  for (let i = 0; i < 50 && w.document.getElementById('hnaMarketCall').hidden && current.geoType !== 'combined'; i++) await new Promise((r) => setTimeout(r, 10));
  const el = w.document.getElementById('hnaMarketCall');
  return { hidden: el.hidden, text: el.textContent };
}

(async () => {
  const fails = checks(load(SRC));
  assert.deepEqual(fails, [], fails.join('\n'));
  const town = Object.entries(MD.places).find(([, p]) => p.type === 'town' && p.call !== 'not_enough_data');
  const shown = await rendered(SRC, { geoType: 'place', geoid: town[0], label: town[1].name });
  assert.equal(shown.hidden, false, `the line shows for ${town[1].name}`);
  assert.ok(shown.text.includes(TAB_CALLS[town[1].call].label), `the rendered line names ${town[1].name}'s call`);
  const combined = await rendered(SRC, { geoType: 'combined', geoid: 'x', label: 'Several places' });
  assert.equal(combined.hidden, true, 'a combined view, which covers several places, shows no single call');
  console.log(`hna-market-call: PASS (${Object.keys(MD.counties).length} counties and ${Object.keys(MD.places).length} places agree with the file and the tab)`);

  const REWORD = [
    ['the lead reworded', "'Market direction: <strong>' + esc(label(rec.call))", "'This market reads as <strong>' + esc(label(rec.call))"],
    ['the county clause reworded', "'Its county, ' + esc(county.name) + ', is '", "'Its county (' + esc(county.name) + ') is '"],
  ];
  for (const [name, from, to] of REWORD) {
    assert.ok(SRC.includes(from), `reword "${name}": target found`);
    const ok = SRC.replace(from, to);
    assert.notEqual(ok, SRC, `reword "${name}" changed the script`);
    const f = checks(load(ok));
    assert.deepEqual(f, [], `reword "${name}" kept the meaning but failed: ${f.join(' / ')}`);
    console.log(`  reword stays green: ${name}`);
  }
  const SABOTAGE = [
    ['every call shown as Steady', "esc(label(rec.call)) + '</strong>. '", "esc(label('steady')) + '</strong>. '", /does not name the call|names steady/],
    ['a call name that differs from the tab', "falling_demand: 'Falling demand',", "falling_demand: 'Declining',", /does not name the call/],
    ['the no-data reason dropped', "esc(rec.call_basis || 'no reason given')", "'unknown'", /lacks the file's reason/],
    ['last year’s permits shown as zero', "', against ' + fmtInt(p.prior_ytd.total)", "', against ' + fmtInt(0)", /permits differ/],
    ['a missing permit count shown as zero', "if (!p || !p.ytd || !p.prior_ytd || !isNum(p.ytd.total) || !isNum(p.prior_ytd.total)) {", "if (false) {", /missing permits|crash|no line/],
    ['the county call taken from the town', "esc(label(county.call).toLowerCase())", "esc(label(rec.call).toLowerCase())", /county call differs/],
    ['the link pointed at the wrong tab', "var TAB = 'colorado-deep-dive.html#tab-direction';", "var TAB = 'colorado-deep-dive.html#tab-signals';", /does not open/],
  ];
  for (const [name, from, to, expect] of SABOTAGE) {
    assert.ok(SRC.includes(from), `sabotage "${name}": target found`);
    const bad = SRC.replace(from, to);
    assert.notEqual(bad, SRC, `sabotage "${name}" changed the script`);
    let f;
    try { f = checks(load(bad)); } catch (e) { f = [`crash: ${e.message}`]; }
    assert.ok(f.some((m) => expect.test(m)), `sabotage "${name}" was not caught: ${f.join(' / ') || 'no failures'}`);
    console.log(`  sabotage caught: ${name}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
