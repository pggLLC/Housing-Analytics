'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HOSTILE = '<tag data-note="quoted">A & B</tag>';
const ESCAPED = '&lt;tag data-note="quoted"&gt;A &amp; B&lt;/tag&gt;';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outsideDom(body, url) {
  return new JSDOM('<!doctype html><html><head></head><body>' + body + '</body></html>', {
    runScripts: 'outside-only',
    url
  });
}

async function testComparativePage() {
  const sourceDocument = new JSDOM(read('hna-comparative-analysis.html')).window.document;
  const inlineScripts = [...sourceDocument.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent)
    .filter((source) => source.includes('injectSelectionCard'));
  assert.strictEqual(inlineScripts.length, 1, 'comparative page exposes one selection-card script');

  const dom = outsideDom(
    '<table><tbody><tr class="hca-tr highlighted" data-geoid="12345"></tr></tbody></table>' +
      '<div id="hcaDetailPanel"></div>',
    'http://127.0.0.1/hna-comparative-analysis.html'
  );
  dom.window.fetch = function () {
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ counties: [{ geoid: '12345', label: HOSTILE }] }); }
    });
  };
  const testableSource = inlineScripts[0].replace(
    /  document\.addEventListener\('DOMContentLoaded',[\s\S]*?\n  \}\);\n}\(\)\);\s*$/,
    '  window.__hcaComparisonPageTest = { injectSelectionCard: injectSelectionCard };\n}());'
  );
  assert(testableSource.includes('__hcaComparisonPageTest'), 'comparative page test hook is injected');
  dom.window.eval(testableSource);

  const panel = dom.window.document.getElementById('hcaDetailPanel');
  const title = dom.window.document.createElement('h2');
  title.className = 'hca-detail-title';
  title.textContent = HOSTILE;
  panel.appendChild(title);
  dom.window.__hcaComparisonPageTest.injectSelectionCard(panel);

  const card = dom.window.document.getElementById('hcaSelectJurisdictionCard');
  assert(card, 'selection card renders');
  assert(card.innerHTML.includes(ESCAPED), 'comparative-page jurisdiction name is escaped');
  assert.strictEqual(card.querySelector('tag'), null, 'comparative-page hostile name does not become markup');

  card.querySelector('button').click();
  await wait(0);
  const confirmation = card.querySelector('.hca-select-jurisdiction__confirm');
  assert(confirmation.innerHTML.includes(ESCAPED), 'canonical confirmation name is escaped');
  assert.strictEqual(confirmation.querySelector('tag'), null, 'confirmation hostile name does not become markup');

  title.textContent = 'Mesa County';
  card.remove();
  dom.window.__hcaComparisonPageTest.injectSelectionCard(panel);
  assert(
    panel.querySelector('.hca-select-jurisdiction__text').innerHTML.includes('<strong>Use Mesa County as your working jurisdiction?</strong>'),
    'normal comparative-page text renders byte-identically'
  );
  dom.window.close();
}

function dealSnapshot(creditType) {
  return {
    creditType,
    tdc: 1000000,
    units: 40,
    basisPct: 90,
    equityPrice: 0.9,
    noi: 100000,
    dcr: 1.2,
    interestRate: 6,
    loanTerm: 30,
    outputs: { eligibleBasis: 900000, annualCredits: 90000, creditEquity: 810000, annualRents: 200000, firstMortgage: 700000, gap: 100000 },
    unitMix: { 30: { enabled: true, units: 10 } }
  };
}

function testDealComparison() {
  const dom = outsideDom(
    '<div id="dcComparisonBar"></div><div id="dcComparisonPanel"></div>',
    'http://127.0.0.1/deal-calculator.html'
  );
  const snapshots = [dealSnapshot(HOSTILE), dealSnapshot('4%')];
  const names = [HOSTILE, 'Normal Deal'];
  dom.window.readDealState = function () { return snapshots.shift(); };
  dom.window.prompt = function () { return names.shift(); };
  dom.window.WorkflowState = {
    getActiveProject: function () { return { jurisdiction: { fips: '12345' } }; }
  };
  dom.window.HNARanking = {
    _get: function () {
      return { allEntries: [{ geoid: '12345', name: HOSTILE, metrics: { ami_gap_30pct: 20, ami_gap_50pct: 30, ami_gap_60pct: 35 } }] };
    }
  };
  dom.window.eval(read('js/deal-comparison.js'));
  dom.window.DealComparison.init();
  assert(dom.window.DealComparison.saveA(), 'deal A saves');
  assert(dom.window.DealComparison.saveB(), 'deal B saves');

  const bar = dom.window.document.getElementById('dcComparisonBar');
  const panel = dom.window.document.getElementById('dcComparisonPanel');
  assert.strictEqual(bar.querySelector('tag'), null, 'hostile deal name does not become setup-bar markup');
  assert.strictEqual(panel.querySelector('tag'), null, 'hostile deal/community text does not become panel markup');
  assert(panel.innerHTML.includes(ESCAPED), 'deal comparison escapes hostile names, types, and community text');
  assert.strictEqual(
    panel.querySelector('.dc-cp-names__b').outerHTML,
    '<div class="dc-cp-names__b">Normal Deal</div>',
    'normal deal name renders byte-identically'
  );
  dom.window.close();
}

async function testCompareController() {
  const ids = ['cmpEmpty', 'cmpTableWrap', 'cmpControls', 'cmpStatus', 'cmpVerdict'];
  const body = ids.map((id) => '<div id="' + id + '"></div>').join('') +
    '<div id="cmpSoftFundingPanel"></div>' +
    '<table><thead><tr id="cmpHeadRow"></tr></thead><tbody id="cmpBody"></tbody></table>' +
    '<select id="cmpAddSel"></select><button id="cmpAddBtn"></button><button id="cmpClearBtn"></button>' +
    '<select id="cmpTargetSel"><option value="9pct">9%</option></select>';
  const dom = outsideDom(body, 'http://127.0.0.1/compare.html?jurisdictions=1234567,7654321');
  const memberships = {
    '1234567': { name: 'First Place', tracts: [] },
    '7654321': { name: 'Second Place', tracts: [] }
  };
  const geoConfig = {
    counties: [{ geoid: '12345', label: 'Normal County' }],
    places: [
      { geoid: '1234567', label: 'First Place', containingCounty: '12345', type: 'place' },
      { geoid: '7654321', label: 'Second Place', containingCounty: '12345', type: 'place' }
    ],
    featured: [], cdps: []
  };
  const responses = {
    'data/qct-colorado.json': { features: [] },
    'data/dda-colorado.json': { features: [] },
    'data/chfa-lihtc.json': { features: [] },
    'data/hna/chas_affordability_gap.json': { counties: {} },
    'data/hna/place-tract-membership.json': { places: memberships },
    'data/co_ami_gap_by_place.json': { places: {} },
    'data/hna/geo-config.json': geoConfig,
    'data/policy/housing-policy-scorecard.json': { scores: {} },
    'data/affordable-housing/properties.json': { properties: [] },
    'data/policy/pab-allocations.json': { allocations: {} },
    'data/hna/place-chas.json': { places: {} },
    'data/hna/place-od-flows.json': { places: {} },
    'data/affordable-housing/chfa-awards/2026-round-one.json': { awards: [] },
    'data/policy/chfa-watchlist.json': {
      entries: [
        { place_geoid: '1234567', signal: HOSTILE },
        { place_geoid: '7654321', signal: 'high' }
      ]
    },
    'data/policy/soft-funding-status.json': {
      programs: {
        hostile: { name: 'Hostile Program', competitiveness: HOSTILE },
        normal: { name: 'Normal Program', competitiveness: 'moderate' }
      }, meta: {}
    }
  };
  dom.window.DataService = {
    getJSON: function (url) { return Promise.resolve(responses[url]); }
  };
  dom.window.eval(read('js/compare.js'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await wait(20);

  const soft = dom.window.document.getElementById('cmpSoftFundingPanel');
  const tableBody = dom.window.document.getElementById('cmpBody');
  assert.strictEqual(soft.querySelector('tag'), null, 'hostile funding status does not become markup');
  assert.strictEqual(tableBody.querySelector('tag'), null, 'hostile watchlist signal does not become markup');
  assert(soft.innerHTML.includes(ESCAPED), 'funding competitiveness is escaped');
  assert(tableBody.innerHTML.includes(ESCAPED), 'watchlist signal is escaped');
  assert(soft.innerHTML.includes('>moderate</span>'), 'normal funding status renders byte-identically');
  assert(tableBody.innerHTML.includes('>high</span>'), 'normal watchlist status renders byte-identically');

  const infoCell = tableBody.querySelector('.cmp-dim-label--clickable');
  infoCell.setAttribute('data-info', HOSTILE);
  infoCell.click();
  let infoRow = tableBody.querySelector('.cmp-info-row');
  assert.strictEqual(infoRow.querySelector('tag'), null, 'hostile popover text does not become markup');
  assert(infoRow.innerHTML.includes(ESCAPED), 'popover text is escaped at its innerHTML sink');
  infoCell.click();
  infoCell.setAttribute('data-info', 'Normal definition');
  infoCell.click();
  infoRow = tableBody.querySelector('.cmp-info-row');
  assert.strictEqual(
    infoRow.innerHTML,
    '<td colspan="3" class="cmp-info-cell">💡 Normal definition</td>',
    'normal popover markup renders byte-identically'
  );
  dom.window.close();
}

function comparisonEntry(geoid, name, type, region) {
  return {
    geoid, name, type, region,
    rank: 1,
    percentileRank: 99,
    dataQuality: {},
    metrics: {
      ami_gap_30pct: 10,
      ami_gap_50pct: 15,
      ami_gap_60pct: 20,
      missing_ami_tiers: [HOSTILE]
    }
  };
}

async function testHnaComparison() {
  const dom = outsideDom(
    '<div id="hcaComparisonBar"></div><div id="hcaComparisonPanel"></div><div id="hcaLiveRegion"></div>' +
      '<table><thead id="hcaTableHead"><tr><th>Action</th></tr></thead><tbody id="hcaTableBody"></tbody></table>',
    'http://127.0.0.1/hna-comparative-analysis.html'
  );
  const tbody = dom.window.document.getElementById('hcaTableBody');
  const hostileRow = dom.window.document.createElement('tr');
  hostileRow.className = 'hca-tr';
  hostileRow.dataset.geoid = '1234567';
  hostileRow.dataset.geoType = 'place&mode="quoted"';
  const nameCell = dom.window.document.createElement('td');
  nameCell.className = 'hca-td-name';
  nameCell.textContent = HOSTILE;
  hostileRow.appendChild(nameCell);
  hostileRow.appendChild(dom.window.document.createElement('td'));
  tbody.appendChild(hostileRow);

  const entryA = comparisonEntry('1234567', HOSTILE, 'county', HOSTILE);
  const entryB = comparisonEntry('7654321', 'Normal Place', 'place', 'Normal Region');
  const allEntries = [entryA, entryB];
  dom.window.HNARanking = {
    _get: function () { return { allEntries }; },
    getScorecardData: function () { return {}; }
  };
  dom.window.safeFetchJSON = function () { return Promise.resolve({ featured: [] }); };
  dom.window.eval(read('js/hna/hna-comparison.js'));
  dom.window.HNAComparison.init();
  await wait(10);

  const link = hostileRow.querySelector('.hca-hna-link');
  assert(link, 'HNA link is injected');
  assert.strictEqual(link.querySelector('tag'), null, 'hostile HNA-link title does not become markup');
  assert.strictEqual(link.title, 'Open HNA for ' + HOSTILE, 'escaped title preserves its displayed text');
  assert(link.href.includes('geoType=place%26mode%3D%22quoted%22'), 'data-derived query value is URL-encoded');

  dom.window.HNAComparison.setA({ geoid: entryA.geoid });
  dom.window.HNAComparison.setB({ geoid: entryB.geoid });
  await wait(0);
  const panel = dom.window.document.getElementById('hcaComparisonPanel');
  const setup = dom.window.document.getElementById('hcaComparisonBar');
  assert.strictEqual(panel.querySelector('tag'), null, 'hostile entry and missing-tier text do not become panel markup');
  assert.strictEqual(setup.querySelector('tag'), null, 'hostile county/name/region text does not become selector markup');
  assert(panel.innerHTML.includes(ESCAPED), 'HNA comparison panel escapes data-derived text');
  assert(setup.innerHTML.includes(ESCAPED), 'HNA selectors escape data-derived labels');
  assert.strictEqual(
    dom.window.HNAComparison._scopeBadge('county'),
    '<span class="hca-cp-scope-badge" style="display:inline-block;font-size:.66rem;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--info-dim, #dbeafe);color:var(--info, #2563eb);margin-left:.5rem;letter-spacing:.02em;text-transform:uppercase;vertical-align:middle;" title="Geography type: County">County</span>',
    'normal scope badge renders byte-identically'
  );
  const hostileBadge = dom.window.HNAComparison._scopeBadge(HOSTILE);
  assert(
    hostileBadge.includes('&lt;tag data-note=&quot;quoted&quot;&gt;A &amp; B&lt;/tag&gt;'),
    'fallback scope-badge label is escaped'
  );
  assert.strictEqual(new JSDOM(hostileBadge).window.document.querySelector('tag'), null, 'scope-badge hostile type does not become markup');
  dom.window.close();
}

function assertEscapeCallGuards() {
  const guards = {
    'hna-comparative-analysis.html': [
      "escHtml(geoName || 'this jurisdiction')",
      'escHtml(canonical.name || geoName)'
    ],
    'js/deal-comparison.js': [
      "escHtml(_dealA.name || _dealA.creditType + ' deal')",
      "escHtml(_dealB.name || _dealB.creditType + ' deal')",
      "escHtml(v || '\u2014')",
      'escHtml(nameA)',
      'escHtml(nameB)',
      'escHtml(_communityNeed.name)'
    ],
    'js/compare.js': [
      { needle: 'escHtml(v)', count: 2 },
      'escHtml(r.competitiveness)',
      'escHtml(info)'
    ],
    'js/hna/hna-comparison.js': [
      '_esc(fips)',
      '_esc(_countyNames[fips])',
      '_esc(e.geoid)',
      "_esc(e.name + ' (' + typeLabel + regionLabel + ')')",
      '_esc(name)',
      'var safeLabel = _esc(label)',
      '_esc(labelA)',
      '_esc(labelB)',
      '_esc(entryA.name)',
      '_esc(entryB.name)',
      { needle: '_esc(side.entry.name)', count: 2 },
      '_esc(tier)'
    ]
  };
  Object.entries(guards).forEach(([file, needles]) => {
    const source = read(file);
    needles.forEach((guard) => {
      const needle = typeof guard === 'string' ? guard : guard.needle;
      const expectedCount = typeof guard === 'string' ? 1 : guard.count;
      const actualCount = source.split(needle).length - 1;
      assert.strictEqual(actualCount, expectedCount, file + ' keeps every escape guard: ' + needle);
    });
  });
}

(async function run() {
  assertEscapeCallGuards();
  await testComparativePage();
  testDealComparison();
  await testCompareController();
  await testHnaComparison();
  console.log('xss-comparison-surfaces: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
