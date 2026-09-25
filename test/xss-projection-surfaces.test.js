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
    '<p style="font-size:1.133rem;margin-bottom:16px;">Based on current housing gaps and low/baseline/high growth assumptions for <strong>Mesa County</strong>, the following projections estimate unmet housing demand over the next 20 years.</p>',
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
  dom.window.eval(read('js/projections/scenario-builder.js'));
  dom.window.ScenarioBuilder.init();

  const container = dom.window.document.getElementById('sbSavedScenarios');
  assert.strictEqual(container.querySelector('tag'), null, 'saved migration input does not become markup');
  assert(container.textContent.includes('Moving in (net) NaN/yr'), 'non-numeric migration is coerced instead of interpreted as HTML');

  saved = [scenario('normal', 'Normal scenario', 500)];
  dom.window.ScenarioBuilder.init();
  assert.strictEqual(
    container.querySelector('.sb-saved-item').outerHTML,
    '<div class="sb-saved-item" data-id="normal">\n' +
      '        <div class="sb-saved-name">Normal scenario</div>\n' +
      '        <div class="sb-saved-meta">\n' +
      '          Births ×1.00 |\n' +
      '          Moving in (net) 500/yr |\n' +
      '          Deaths ×1.00\n' +
      '        </div>\n' +
      '        <div class="sb-saved-actions">\n' +
      '          <button class="btn btn-sm sb-load-btn" data-id="normal" type="button">Load</button>\n' +
      '          <button class="btn btn-sm btn-danger sb-delete-btn" data-id="normal" type="button">Delete</button>\n' +
      '        </div>\n' +
      '      </div>',
    'normal saved scenario renders byte-identically'
  );
  dom.window.close();
}

function assertSourceGuards() {
  const projector = read('js/housing-need-projector.js');
  const scenarios = read('js/projections/scenario-builder.js');
  assert(projector.includes("'<strong>' + _escHtml(countyName) + '</strong>"), 'projector keeps county-name escape');
  assert(scenarios.includes('${Number(s.parameters.net_migration_annual)}/yr'), 'scenario builder keeps numeric coercion');
}

testHousingNeedProjector();
testScenarioBuilder();
assertSourceGuards();
console.log('xss-projection-surfaces: PASS');
