#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const component = require('../js/components/jurisdiction-select-search.js');

function tick(window) {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function testProgressiveEnhancement() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <label for="county">County</label>
    <select id="county" data-jurisdiction-search>
      <option value="">Loading…</option>
    </select>
  </body></html>`, { url: 'http://127.0.0.1/search-test' });
  const { document, Event, KeyboardEvent } = dom.window;
  const select = document.getElementById('county');
  const instance = component.enhance(select, {
    document,
    label: 'Search counties',
    typeLabel: 'County'
  });

  assert(instance, 'enhancement initializes when the shared matcher is available');
  assert.equal(instance.input.parentElement.hidden, true,
    'search stays hidden until the page supplies usable options');
  assert.equal(select.hidden, false,
    'native select remains visible while data is loading or unavailable');

  select.innerHTML = '<option value="">All counties</option>' +
    '<option value="08031">Denver County</option>' +
    '<option value="08035">Douglas County</option>' +
    '<option value="08041">El Paso County</option>';
  await tick(dom.window);

  assert.equal(instance.input.parentElement.hidden, false,
    'search appears after options are populated asynchronously');
  assert.equal(select.hidden, true,
    'native select is hidden only after successful enhancement');
  assert.equal(instance.input.getAttribute('role'), 'combobox');
  assert.equal(instance.input.getAttribute('aria-autocomplete'), 'list');
  assert.equal(instance.input.getAttribute('aria-controls'), instance.list.id);

  let changes = 0;
  let bubbled = 0;
  select.addEventListener('change', () => { changes += 1; });
  document.body.addEventListener('change', (event) => {
    if (event.target === select) bubbled += 1;
  });

  instance.input.value = 'den';
  instance.input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(instance.input.getAttribute('aria-expanded'), 'true');
  assert.equal(instance.list.querySelectorAll('[role="option"]').length, 1);
  assert.equal(instance.list.textContent.includes('Denver County'), true);

  instance.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(instance.input.getAttribute('aria-activedescendant'), 'countySearchOption0',
    'arrow navigation exposes the active result');
  instance.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(select.value, '08031');
  assert.equal(changes, 1, 'keyboard selection dispatches exactly one change event');
  assert.equal(bubbled, 1, 'selection change bubbles to existing page handlers');
  assert.equal(instance.input.value, 'Denver County');
  assert.equal(instance.selected.textContent, 'Selected: Denver County');

  instance.input.value = 'doug';
  instance.input.dispatchEvent(new Event('input', { bubbles: true }));
  instance.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(instance.list.hidden, true, 'Escape closes the result list');
  assert.equal(instance.input.hasAttribute('aria-activedescendant'), false,
    'Escape clears the active descendant');

  instance.input.value = '';
  instance.input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(select.value, '', 'clearing search restores the native default option');
  assert.equal(changes, 2, 'clearing a committed selection dispatches change');
}

async function testSafeTextAndRankingReuse() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="geo">
      <option value="">Choose</option>
      <option value="1">Boulder &amp; County</option>
      <option value="2">North &lt;script&gt;alert(1)&lt;/script&gt;</option>
      <option value="3">Boulder Junction</option>
    </select>
  </body></html>`, { url: 'http://127.0.0.1/safe-text-test' });
  const { document, Event } = dom.window;
  const instance = component.enhance(document.getElementById('geo'), {
    document,
    typeLabel: 'County'
  });

  instance.input.value = 'boulder';
  instance.input.dispatchEvent(new Event('input', { bubbles: true }));
  const names = Array.from(instance.list.querySelectorAll('[role="option"] span:first-child'))
    .map((node) => node.textContent);
  assert.deepEqual(names, ['Boulder & County', 'Boulder Junction'],
    'shared matcher keeps prefix results ordered by shorter, closer name');

  instance.input.value = 'script';
  instance.input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(instance.list.querySelector('script'), null,
    'option text containing markup characters never becomes markup');
  assert(instance.list.textContent.includes('North <script>alert(1)</script>'));
}

function testMissingDependencyFallback() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="fallback" data-jurisdiction-search>
      <option value="">All counties</option>
      <option value="08031">Denver County</option>
    </select>
  </body></html>`, {
    url: 'http://127.0.0.1/fallback-test',
    runScripts: 'outside-only'
  });
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'components', 'jurisdiction-select-search.js'),
    'utf8'
  );
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const select = dom.window.document.getElementById('fallback');
  assert.equal(select.hidden, false,
    'missing shared matcher leaves the native select usable');
  assert.equal(dom.window.document.querySelector('.jurisdiction-select-search'), null,
    'failed enhancement does not insert a partial control');
}

function testEightPageWiring() {
  const targets = {
    'historical-trends.html': ['benchCounty'],
    'chfa-portfolio.html': ['filterCounty'],
    'lihtc-opportunity-finder.html': ['lofCounty'],
    'preservation.html': ['presFilterCounty'],
    'market-intelligence.html': ['countySelect'],
    'colorado-deep-dive.html': ['countyGeoSelect', 'amiGapCountySelect'],
    'policy-briefs.html': ['regionFilter'],
    'hna-scenario-builder.html': ['sbGeoSelect']
  };
  let enhancedCount = 0;

  Object.entries(targets).forEach(([file, ids]) => {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const homePos = html.indexOf('js/home-jurisdiction-search.js');
    const componentPos = html.indexOf('js/components/jurisdiction-select-search.js');
    assert(homePos >= 0, `${file} loads the shared matcher`);
    assert(componentPos > homePos, `${file} loads the enhancer after its matcher`);
    ids.forEach((id) => {
      const pattern = new RegExp(`<select[^>]*id=["']${id}["'][^>]*data-jurisdiction-search`, 's');
      assert(pattern.test(html), `${file} enhances ${id} declaratively`);
      enhancedCount += 1;
    });
  });
  assert.equal(enhancedCount, 9, 'all nine selectors across the eight pages are covered');

  const finder = fs.readFileSync(path.join(__dirname, '..', 'lihtc-opportunity-finder.html'), 'utf8');
  assert(finder.includes('id="lofSearch"'),
    'Opportunity Finder retains its existing jurisdiction-name table search');

  const scenario = fs.readFileSync(path.join(__dirname, '..', 'hna-scenario-builder.html'), 'utf8');
  assert(!scenario.includes('function mountCombobox('),
    'scenario builder no longer carries a second combobox implementation');
  assert(!scenario.includes('id="sbGeoSearch"'),
    'scenario builder delegates search markup to the shared component');
  assert(!/<select[^>]*id="sbGeoSelect"[^>]*(?:left:-9999|aria-hidden="true"|tabindex="-1")/s.test(scenario),
    'scenario native select is a usable fallback before enhancement');

  const preservation = fs.readFileSync(path.join(__dirname, '..', 'js', 'preservation.js'), 'utf8');
  assert(preservation.includes("el.addEventListener('change', refresh)"),
    'preservation county select responds to the shared change event');

  const componentSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'components', 'jurisdiction-select-search.js'),
    'utf8'
  );
  assert(componentSource.includes('HomeJurisdictionSearch.searchJurisdictions(entries, q, limit)'),
    'component calls the established pure matching function');
  assert(componentSource.includes(':focus-visible'), 'component defines a visible keyboard focus state');
}

(async function run() {
  await testProgressiveEnhancement();
  await testSafeTextAndRankingReuse();
  testMissingDependencyFallback();
  testEightPageWiring();
  console.log('✓ jurisdiction select search progressively enhances all eight pages');
  console.log('✓ keyboard selection drives the native select with one bubbling change');
  console.log('✓ missing dependencies and unavailable options preserve the native fallback');
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
