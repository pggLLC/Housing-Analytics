#!/usr/bin/env node
'use strict';
// A CDP deep link (?fips=0815165&geoType=cdp&auto=1, the shape the comparison
// table's "HNA →" link builds) must select that CDP in the HNA's own
// selectors. Until 2026-10-17 the pages' auto-select routine wrote 'cdp'
// straight into #geoType, which only offers state / county / place, so both
// selects went blank and the page said "data for  is shown".
//
// The routine is run as it ships in the canonical page and all five generated
// views, against the page's own #geoType options and the CDP list in
// geo-config, so it agrees with the selector rather than with fixed copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cfg = JSON.parse(read('data/hna/geo-config.json'));
const PAGES = ['housing-needs-assessment.html', 'hna-who-lives-here.html', 'hna-what-housing-exists.html',
  'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html'];

// The link that produces this URL shape uses the record's own type.
assert(/hna-what-housing-exists\.html\?fips='[^;]*&geoType='\s*\+\s*encodeURIComponent\(geoType\)/.test(read('js/hna/hna-comparison.js')),
  'the comparison table links to the HNA with the record\'s geoType');

function extractFn(html, name) {
  const start = html.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' found');
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}

function geoTypeOptions(html) {
  const sel = html.match(/<select[^>]*id="geoType"[^>]*>([\s\S]*?)<\/select>/);
  assert(sel, '#geoType select found');
  return [...sel[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

const cdps = [cfg.cdps.find((c) => c.geoid === '0815165'), cfg.cdps[0], cfg.cdps.at(-1)].filter(Boolean);
assert(cdps.length >= 2 && cdps[0].geoid === '0815165', 'Clifton and other CDPs come from geo-config');
const town = cfg.places[0];

async function run(page, target, priorType) {
  const html = read(page);
  const types = geoTypeOptions(html);
  const dom = new JSDOM('<!doctype html><body>' +
    '<select id="geoType">' + types.map((t) => `<option value="${t}">${t}</option>`).join('') + '</select>' +
    '<select id="geoSelect"></select></body>', { runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  const gt = d.getElementById('geoType'), gs = d.getElementById('geoSelect');
  gt.value = priorType;
  // Model the controller: changing #geoType rebuilds #geoSelect. 'place' is the
  // combined incorporated-place + CDP list, each CDP marked data-subtype="cdp".
  const rebuild = () => {
    gs.innerHTML = '';
    const items = gt.value === 'place'
      ? cfg.places.map((p) => [p.geoid, 'place']).concat(cfg.cdps.map((c) => [c.geoid, 'cdp']))
      : gt.value === 'county' ? cfg.counties.map((c) => [c.geoid, 'county']) : [['08', 'state']];
    for (const [v, sub] of items) {
      const o = d.createElement('option'); o.value = v; o.setAttribute('data-subtype', sub); gs.appendChild(o);
    }
  };
  rebuild();
  gt.addEventListener('change', rebuild);
  w.eval(extractFn(html, '_tryAutoSelect') + ';window._tryAutoSelect=_tryAutoSelect;');
  w._tryAutoSelect(target);
  await new Promise((r) => setTimeout(r, 1300));
  const opt = gs.options[gs.selectedIndex];
  return { types, geoType: gt.value, geoid: gs.value, subtype: opt && opt.getAttribute('data-subtype') };
}

(async () => {
  let checks = 0;
  for (const page of PAGES) {
    for (const cdp of cdps) {
      for (const prior of ['state', 'county']) {
        const r = await run(page, { fips: cdp.geoid, geoType: 'cdp' }, prior);
        assert(r.types.includes(r.geoType), `${page}: #geoType holds one of its own options (got "${r.geoType}")`);
        assert.equal(r.geoid, cdp.geoid, `${page}: ${cdp.label} deep link selects ${cdp.geoid} (from ${prior})`);
        assert.equal(r.subtype, 'cdp', `${page}: the selected option keeps the CDP subtype`);
        checks++;
      }
    }
    // A place and a county link still work, and the switch back from a CDP.
    const p = await run(page, { fips: town.geoid, geoType: 'place' }, 'state');
    assert.equal(p.geoid, town.geoid, `${page}: place link still selects the place`);
    const c = await run(page, { fips: cfg.counties[0].geoid, geoType: 'county' }, 'place');
    assert.equal(c.geoid, cfg.counties[0].geoid, `${page}: county link still selects the county`);
    checks += 2;
  }
  console.log(`hna-cdp-deep-link: PASS (${checks} selections across ${PAGES.length} pages)`);
})().catch((e) => { console.error(e); process.exit(1); });
