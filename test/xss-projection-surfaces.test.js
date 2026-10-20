'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HOSTILE = '<tag data-note="quoted">A & B</tag>';
const ESCAPED_HTML = '&lt;tag data-note=&quot;quoted&quot;&gt;A &amp; B&lt;/tag&gt;';
const ESCAPED_DOM = '&lt;tag data-note="quoted"&gt;A &amp; B&lt;/tag&gt;';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function outsideDom(body, page) {
  return new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/' + page
  });
}

function testHousingNeedProjector() {
  const dom = outsideDom('<div id="projection"></div>', 'housing-needs-assessment.html');
  dom.window.fetch = undefined;
  dom.window.eval(read('js/housing-need-projector.js'));

  const countyData = {
    households: 1000,
    vacancy_rate: 5,
    cost_burdened_pct: 40,
    severely_burdened_pct: 20
  };
  dom.window.HousingNeedProjector.renderProjectionSection(
    'projection', '08077', countyData, { countyName: HOSTILE }
  );
  const container = dom.window.document.getElementById('projection');
  assert(container.innerHTML.includes(ESCAPED_DOM), 'projection county name is escaped');
  assert.strictEqual(container.querySelector('tag'), null, 'projection county name does not become markup');

  dom.window.HousingNeedProjector.renderProjectionSection(
    'projection', '08077', countyData, { countyName: 'Mesa County' }
  );
  assert.strictEqual(
    container.querySelector('p').outerHTML,
    '<p style="font-size:1.133rem;margin-bottom:16px;">Homes needed in <strong>Mesa County</strong> over the next 20 years to house projected new households, from household growth at the rate shown in the methodology.</p>',
    'normal projection intro renders byte-identically'
  );
  dom.window.close();
}

function scenario(id, name, migration) {
  return {
    id,
    name,
    parameters: {
      fertility_multiplier: 1,
      net_migration_annual: migration,
      mortality_multiplier: 1
    }
  };
}

function testScenarioBuilder() {
  const dom = outsideDom('<div id="sbSavedScenarios"></div>', 'scenario-builder.html');
  let saved = [scenario('hostile', 'Hostile scenario', HOSTILE)];
  dom.window.ScenarioPresets = { list: [] };
  dom.window.ScenarioStorage = {
    list: function () { return saved; },
    get: function () { return null; },
    delete: function () {},
    save: function (value) { return value; },
    exportAll: function () { return new dom.window.Blob(); }
  };
  dom.window.eval(read('js/projections/cohort-component-model.js'));
  dom.window.eval(read('js/projections/scenario-builder.js'));
  dom.window.ScenarioBuilder.init();

  const container = dom.window.document.getElementById('sbSavedScenarios');
  assert.strictEqual(container.querySelector('tag'), null, 'saved migration input does not become markup');
  assert(container.textContent.includes('Saved with the earlier model: births ×1.00 | deaths ×1.00'),
    'non-numeric migration is coerced and dropped instead of interpreted as HTML');
  assert(!container.textContent.includes('A & B'), 'the hostile migration text is not shown');

  saved = [scenario('normal', 'Normal scenario', 500)];
  dom.window.ScenarioBuilder.init();
  assert.strictEqual(
    container.querySelector('.sb-saved-item').outerHTML,
    '<div class="sb-saved-item" data-id="normal">\n' +
      '        <div class="sb-saved-name">Normal scenario</div>\n' +
      '        <div class="sb-saved-meta">Saved with the earlier model: births ×1.00 | deaths ×1.00 | 500 people moving in a year</div>\n' +
      '        <div class="sb-saved-actions">\n' +
      '          <button class="btn btn-sm sb-load-btn" data-id="normal" type="button">Load</button>\n' +
      '          <button class="btn btn-sm btn-danger sb-delete-btn" data-id="normal" type="button">Delete</button>\n' +
      '        </div>\n' +
      '      </div>',
    'normal saved scenario renders byte-identically'
  );

  // A scenario saved as percentages of SDO's forecast, with hostile values.
  saved = [{ id: 'pct', name: HOSTILE, parameters: { births_pct: HOSTILE, deaths_pct: 95, migration_pct: 50 } }];
  dom.window.ScenarioBuilder.init();
  assert.strictEqual(container.querySelector('tag'), null, 'a hostile name or percentage does not become markup');
  assert(container.querySelector('.sb-saved-name').textContent === HOSTILE, 'the name shows as text');
  // The line shows the settings the scenario loads with: a hostile births
  // value is not a number, so it loads (and reads) as SDO's 100%.
  const loads = dom.window.CohortComponentModel.paramsFromSaved(saved[0].parameters);
  assert.strictEqual(container.querySelector('.sb-saved-meta').textContent,
    `Births ${loads.births_pct}% | Deaths ${loads.deaths_pct}% | Moving in (net) ${loads.migration_pct}% of SDO's forecast`,
    'percentages are coerced to the numbers the scenario loads with');
  assert.deepStrictEqual([loads.births_pct, loads.deaths_pct, loads.migration_pct], [100, 95, 50], 'the hostile value is dropped, the others kept');

  // A setting the record never had reads as what loads, never as 0.
  saved = [
    { id: 'partial', name: 'Partial', parameters: { births_pct: null, deaths_pct: 95, migration_pct: 50 } },
    { id: 'legacy-partial', name: 'Legacy partial', parameters: { fertility_multiplier: null, mortality_multiplier: 1.1, net_migration_annual: null } },
  ];
  dom.window.ScenarioBuilder.init();
  const metas = [...container.querySelectorAll('.sb-saved-meta')].map((n) => n.textContent);
  assert.strictEqual(metas[0], "Births 100% | Deaths 95% | Moving in (net) 50% of SDO's forecast", 'a missing percentage reads as the 100% it loads with');
  assert.strictEqual(metas[1], 'Saved with the earlier model: births ×1.00 | deaths ×1.10', 'a missing multiplier or migrant count is not shown as 0');
  dom.window.close();
}

function assertSourceGuards() {
  const projector = read('js/housing-need-projector.js');
  const scenarios = read('js/projections/scenario-builder.js');
  assert(projector.includes("'<strong>' + _escHtml(countyName) + '</strong>"), 'projector keeps county-name escape');
  assert(scenarios.includes('const q = window.CohortComponentModel.paramsFromSaved(p);') && scenarios.includes('Births ${q.births_pct}%') &&
    scenarios.includes("const given = (v) => (v == null || v === '' ? NaN : Number(v));") && scenarios.includes('const mig = given(p && p.net_migration_annual)'),
    'scenario builder keeps numeric coercion');
  assert(scenarios.includes('${_escHtml(_paramsText(s.parameters || {}))}'), 'scenario builder escapes the saved-parameter line');
}

testHousingNeedProjector();
testScenarioBuilder();
assertSourceGuards();
console.log('xss-projection-surfaces: PASS');
