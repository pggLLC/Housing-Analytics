'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const county = json('data/co_ami_gap_by_county.json');
const place = json('data/co_ami_gap_by_place.json');
const field = 'gap_units_minus_households_le_ami_pct';
function checkRecord(record, bands, sign) {
  assert(['units_minus_households', 'households_minus_units'].includes(sign));
  for (const band of bands) {
    const hh = record.households_le_ami_pct[band], units = record.units_priced_affordable_le_ami_pct[band];
    const expected = hh == null || units == null ? null : sign === 'units_minus_households' ? units - hh : hh - units;
    assert.equal(record[field][band], expected, `${record.fips} ≤${band}: ${sign}`);
  }
}
// Read the payload dictionaries with Python's AST, not a loose textual match
// that could accidentally find a comment or an unused constant.
const builder = JSON.parse(execFileSync('python3', ['-c', `
import ast,json
tree=ast.parse(open('scripts/hna/build_place_ami_gap.py').read())
result={}
for func in tree.body:
 if isinstance(func,ast.FunctionDef) and func.name in ['build_place_file','build_county_file']:
  for node in ast.walk(func):
   if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='payload' for t in node.targets):
    meta=next(v for k,v in zip(node.value.keys,node.value.values) if ast.literal_eval(k)=='meta')
    result[func.name]=next(ast.literal_eval(v) for k,v in zip(meta.keys,meta.values) if ast.literal_eval(k)=='gap_sign')
print(json.dumps(result))
`], { encoding: 'utf8' }));
assert.equal(county.counties.length, 64);
assert(place.statewide === undefined);
assert(county.statewide, 'statewide record must also be scanned');
assert(Object.keys(place.places).length > 400, 'place scan is not empty or truncated');
let records = 0, bands = 0;
for (const [payload, rows] of [[county, [...county.counties, county.statewide]], [place, Object.values(place.places)]]) {
  assert(payload.bands.length > 0);
  for (const row of rows) {
    const keys = [...new Set([...payload.bands.map(String), ...Object.keys(row[field]),
      ...Object.keys(row.households_le_ami_pct), ...Object.keys(row.units_priced_affordable_le_ami_pct)])];
    checkRecord(row, keys, payload.meta.gap_sign); records++; bands += keys.length;
  }
}
assert.equal(records, 64 + 1 + Object.keys(place.places).length);
assert(bands > 0);
assert.equal(builder.build_county_file, county.meta.gap_sign);
assert.equal(builder.build_place_file, place.meta.gap_sign);

for (const sign of ['units_minus_households', 'households_minus_units']) {
  for (const [hh, units] of [[null, 10], [10, null], [null, null]]) {
    const fixture = { fips: 'null fixture', households_le_ami_pct: {30: hh}, units_priced_affordable_le_ami_pct: {30: units}, [field]: {30: null} };
    checkRecord(fixture, ['30'], sign);
    fixture[field]['30'] = 0;
    assert.throws(() => checkRecord(fixture, ['30'], sign), 'null components must reject a coerced zero');
  }
}
console.log(`PASS declared signs: ${records} records, ${bands} bands, builder literals and null components`);

// Execute both producer handlers with fixture HTTP responses. The only source
// adaptation is exposing the ES-module default export to the isolated VM.
async function serverlessEndpoints() {
  const fixtures = county.counties.map((row, index) => ({
    fips_code: row.fips + '99999', county_name: row.county_name,
    ami: row.ami_4person, rentBinCount: index % 2 ? 100 : 10,
  }));
  for (const file of ['serverless/vercel/api/co-ami-gap.js', 'serverless/cloudflare-worker/co-ami-gap-worker.js']) {
    const requests = [];
    const fetchFixture = async input => {
      const url = new URL(input); requests.push(url);
      let data;
      if (url.hostname === 'www.huduser.gov') {
        if (url.pathname.endsWith('/listCounties/CO')) data = {data: fixtures};
        else {
          const match = fixtures.find(row => url.pathname.endsWith('/il/data/' + row.fips_code));
          assert(match, 'known HUD fixture: ' + url.pathname);
          data = {data: {median_income: match.ami}};
        }
      } else {
        assert.equal(url.hostname, 'api.census.gov', 'no live or unexpected fetch');
        const fips = '08' + url.searchParams.get('for').split(':')[1];
        const fixture = fixtures.find(row => row.fips_code.startsWith(fips));
        assert(fixture, 'known Census fixture county');
        const variables = url.searchParams.get('get').split(',');
        data = [variables, variables.map(v => {
          if (v === 'B25118_014E') return '1100';
          if (v === 'B19001_001E') return '1600';
          if (v.startsWith('B25063')) return String(fixture.rentBinCount);
          return '100';
        })];
      }
      return {ok: true, json: async () => data};
    };
    const env = {HUD_USER_TOKEN: 'fixture', CENSUS_API_KEY: 'fixture'};
    const sandbox = {fetch: fetchFixture, process: {env}, URL, Request, Response,
      caches: {default: {match: async () => null, put: async () => {}}}};
    const src = read(file);
    assert.equal(src.split('export default ').length, 2, 'one handler export');
    vm.runInNewContext(src.replace('export default ', 'globalThis.endpoint = '), sandbox, {filename: file});
    let payload;
    if (file.includes('/vercel/')) {
      let status;
      await sandbox.endpoint({query: {}}, {setHeader() {}, status(code) {status = code; return this;}, json(value) {payload = value;}});
      assert.equal(status, 200, file);
    } else {
      const pending = [];
      const response = await sandbox.endpoint.fetch(new Request('https://fixture.local/co-ami-gap'), env,
        {waitUntil(promise) {pending.push(promise);}});
      await Promise.all(pending);
      assert.equal(response.status, 200, file);
      payload = await response.json();
    }
    assert.equal(payload.meta.gap_sign, county.meta.gap_sign, file + ': live sign equals committed county sign');
    assert.equal(payload.counties.length, fixtures.length, 'every fixture county was computed');
    assert.equal(requests.length, 1 + fixtures.length * 4, 'both HUD and all three Census tables were read');
    assert.equal(payload.bands.length, county.bands.length);
    let checked = 0;
    for (const row of [...payload.counties, payload.statewide]) {
      checkRecord(row, payload.bands, payload.meta.gap_sign);
      checked += payload.bands.length;
    }
    assert.equal(checked, 65 * county.bands.length, 'all county and statewide bands checked');
    const gaps = payload.counties.flatMap(row => Object.values(row[field]));
    assert(gaps.some(gap => gap < 0) && gaps.some(gap => gap > 0), 'fixtures exercise both signs');
    await endpoint(payload, true);
    console.log('PASS ' + file + ': handler metadata, ' + checked + ' computed bands, and front-end acceptance');
  }
}

async function endpoint(payload, available) {
  const w = new JSDOM(read('colorado-deep-dive.html'), { runScripts: 'outside-only', url: 'https://example.org/colorado-deep-dive.html' }).window;
  let charts = 0;
  w.Chart = class { constructor() { charts++; } destroy() {} };
  w.fetch = async () => ({ ok: true, json: async () => payload });
  try {
    w.eval(read('js/co-ami-gap.js'));
    await w.CoAmiGap.init(); await new Promise(setImmediate);
    const d = w.document;
    if (available) {
      assert(d.querySelectorAll('#amiGapTableBody tr').length > 0);
      assert(charts > 0, 'accepted county data actually renders charts');
    } else {
      assert.equal(d.getElementById('amiGapModule').dataset.unavailableReason, 'gap_sign_unsupported');
      assert.match(d.getElementById('amiGapError').textContent, /unavailable/i);
      assert.equal(d.getElementById('amiGapError').style.display, 'block');
      assert.equal(d.querySelectorAll('#amiGapTableBody tr').length, 0);
      assert.equal(charts, 0, 'opposite or untagged signs never receive colours');
      assert(d.getElementById('amiGapExportBtn').disabled);
    }
  } finally { w.close(); }
}

function combinedExport() {
  const w = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'https://example.org/housing-needs-assessment.html' }).window;
  w.setTimeout = () => 0;
  const downloads = [];
  w.Blob = function(parts) { downloads.push(parts.join('')); };
  w.URL.createObjectURL = () => 'blob:test'; w.HTMLAnchorElement.prototype.click = () => {};
  try {
    w.eval(read('js/hna/combined-geo.js')); w.eval(read('js/hna/hna-export.js'));
    w.eval(read('js/hna/hna-ownership-need.js'));
    const datasets = { amiGapCounty: county, amiGapPlace: place,
      placeChas: json('data/hna/place-chas.json'), countyChas: json('data/hna/chas_affordability_gap.json'),
      placeCountyLookup: json('data/hna/derived/place_county_lookup.json'),
      crossCountyPlaces: json('data/hna/cross-county-places.json'), aliases: json('data/hna/place-phantom-aliases.json') };
    const members = [{geoType: 'place', geoid: '0828745'}, {geoType: 'place', geoid: '0886310'}];
    const result = w.HNACombinedGeo.aggregate(members, datasets);
    assert(result.valid, JSON.stringify(result.errors)); assert(result.availability.amiGap.available);
    assert.equal(result.amiGapEntry[field], undefined, 'the ambiguous combined field is retired');
    assert.equal(result.amiGapEntry.gap_sign, 'households_minus_units');
    const expected = {}; let previousHh = 0, previousUnits = 0, shortfall = 0;
    for (const band of place.bands) {
      const hh = members.reduce((n,m) => n + place.places[m.geoid].households_le_ami_pct[band], 0);
      const units = members.reduce((n,m) => n + place.places[m.geoid].units_priced_affordable_le_ami_pct[band], 0);
      shortfall += Math.max(0, (hh - previousHh) - (units - previousUnits));
      expected[band] = shortfall; previousHh = hh; previousUnits = units;
    }
    assert(shortfall > 0, 'fixture must distinguish sign and missing-field regressions');
    w.HNAState = { state: { current: {geoType: 'combined', members, combinedResult: result} } };
    const report = w.__HNA_buildReportData();
    assert.equal(report.amiGap.gapSign, 'households_minus_units');
    assert.match(report.amiGap.note, /sum of max\(0, band households minus band priced-affordable units\)/);
    for (const band of ['30', '50', '60', '80']) assert.equal(report.amiGap[`gap${band}pctUnits`], expected[band]);
    assert.equal(report.amiGap.housingGapUnits, expected['100']);
    const gap = result.amiGapEntry;
    assert.notEqual(expected['80'], Math.max(0, gap.households_le_ami_pct['80'] - gap.units_priced_affordable_le_ami_pct['80']),
      'fixture must distinguish cumulative positive-band shortfalls from cumulative net difference');
    const ownership = w.HNAOwnershipNeed.computeOwnershipNeed({
      chasEntry: result.pseudoChasRecord, geoLevel: 'combined', amiGapEntry: gap,
    });
    assert.equal(w.HNAOwnershipNeed.rentalGap(gap), expected['80']);
    assert.equal(ownership.existingRentalGap, report.amiGap.gap80pctUnits,
      'ownership panel and export use the same documented shortfall through 80%');
    w.__HNA_exportJson(report); w.__HNA_exportCsv(report);
    assert.deepEqual(JSON.parse(downloads[0]).amiGap, JSON.parse(JSON.stringify(report.amiGap)));
    assert(downloads[1].includes(report.amiGap.note));
    assert.match(downloads[1], /Cumulative shortfall through ≤100% AMI/);
    assert.match(downloads[1], /Cumulative shortfall through ≤80% AMI/);
    for (const missing of [null, '', undefined]) {
      gap.shortfall_households_minus_units_le_ami_pct['80'] = missing;
      assert.equal(w.HNAOwnershipNeed.rentalGap(gap), null, 'missing combined shortfall cannot silently switch definitions');
      assert.equal(w.__HNA_buildReportData().amiGap.gap80pctUnits, null, 'missing export shortfall stays unavailable');
    }
    console.log('PASS combined export and ownership: matching positive marginal-band shortfalls, explicit labels and formula note');
  } finally { w.close(); }
}
(async () => {
  await serverlessEndpoints();
  await endpoint(county, true);
  await endpoint({...county, meta: {...county.meta, gap_sign: 'households_minus_units'}}, false);
  await endpoint(place, false);
  await endpoint({...county, meta: {...county.meta, gap_sign: undefined}}, false);
  console.log('PASS county endpoint accepts only the declared units-minus-households convention');
  combinedExport();
})().catch(e => { console.error(e); process.exitCode = 1; });
