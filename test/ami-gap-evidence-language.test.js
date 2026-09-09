#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
const MODULE = fs.readFileSync(path.join(ROOT, 'js/co-ami-gap.js'), 'utf8');
const PAYLOAD = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_county.json'), 'utf8'));
const CAVEAT = 'Renter-occupied units with gross rent at or below the affordability threshold (30% of income) for each AMI band (ACS B25063). Not necessarily vacant or available.';

class ChartStub {
  constructor(element, config) {
    this.element = element;
    this.config = config;
  }
  destroy() {}
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

async function loadPage(options = {}) {
  const dom = new JSDOM(PAGE, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/colorado-deep-dive.html'
  });
  const warnings = [];
  dom.window.Chart = ChartStub;
  dom.window.fetch = async () => ({
    ok: true,
    json: async () => PAYLOAD
  });
  dom.window.console.warn = (...args) => warnings.push(args.join(' '));

  if (options.removeTarget) {
    dom.window.document.getElementById(options.removeTarget).remove();
  }

  dom.window.eval(MODULE);
  await dom.window.CoAmiGap.init();
  const select = dom.window.document.getElementById('amiGapCountySelect');
  await waitFor(() => select.options.length > 1, 'real AMI-gap county options did not render');

  const county = PAYLOAD.counties[0];
  select.value = county.fips;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await waitFor(
    () => dom.window.document.getElementById('amiGapGeoTitle').textContent === county.county_name,
    'selected geography did not render'
  );

  return { dom, warnings, county };
}

(async () => {
  const { dom, warnings, county } = await loadPage();
  const document = dom.window.document;
  const module = document.getElementById('amiGapModule');

  assert.equal(warnings.length, 0, 'complete production markup has every tooltip and caveat target');
  assert.equal(module.querySelector('h2').textContent.trim(), 'Colorado AMI Households vs Priced-Affordable Units');
  assert.equal(module.getAttribute('aria-label'), 'Colorado AMI Households vs Priced-Affordable Units');

  for (const id of ['ami-need-chart', 'amiGapComparisonChart', 'amiGapChart']) {
    const label = document.getElementById(id).getAttribute('aria-label');
    assert(!/\bavailable\b/i.test(label), `${id} accessible name must not describe occupied units as available`);
  }

  const unitHeader = [...module.querySelectorAll('thead th')]
    .find((th) => /priced-affordable units/i.test(th.textContent));
  assert(unitHeader, 'results table labels the series Priced-Affordable Units');
  assert.equal(module.querySelector('#amiGapUnits100 + .sr-only').id, 'tip-amiGapUnits100');

  const caveat = document.getElementById('amiGapAvailabilityCaveat');
  assert.equal(caveat.textContent, CAVEAT, 'the exact established caveat is visible in the loaded page');
  const pageText = document.body.innerText || document.body.textContent;
  assert(pageText.includes(CAVEAT), 'the exact caveat is reachable in page text after selecting a geography');

  const describedElements = [
    ...module.querySelectorAll('[aria-describedby]'),
    document.getElementById('ami-need-chart')
  ];
  assert(describedElements.length > 4, 'charts, module, and KPI figures carry accessible descriptions');
  for (const element of describedElements) {
    for (const id of element.getAttribute('aria-describedby').trim().split(/\s+/)) {
      assert(document.getElementById(id), `${element.id || element.tagName} must not point at missing #${id}`);
    }
  }
  assert(module.querySelectorAll('[id^="tip-"]').length >= 4, 'tooltip descriptions are present in the DOM');

  const firstBand = String(PAYLOAD.bands[0]);
  const firstRow = module.querySelector('#amiGapTableBody tr').textContent;
  assert(firstRow.includes(Math.round(county.households_le_ami_pct[firstBand]).toLocaleString()), 'selected county household value is unchanged');
  assert(firstRow.includes(Math.round(county.units_priced_affordable_le_ami_pct[firstBand]).toLocaleString()), 'selected county unit value is unchanged');

  const missing = await loadPage({ removeTarget: 'amiGapCoverage100' });
  assert(
    missing.warnings.some((message) => message.includes('Tooltip target not found: #amiGapCoverage100')),
    'a missing tooltip target is reported instead of failing silently'
  );

  console.log('AMI gap evidence language and accessible caveat: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
