'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'data', 'policy', 'homeownership-programs.json');
const componentPath = path.join(root, 'js', 'components', 'homeownership-programs.js');
const pagePath = path.join(root, 'help-for-homebuyers.html');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const componentSrc = fs.readFileSync(componentPath, 'utf8');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function waitForRender() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderPage(overrides = {}) {
  const html = fs.readFileSync(pagePath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/help-for-homebuyers.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const payload = overrides.programsDoc || clone(data);
  dom.window.resolveAssetUrl = (url) => url;
  dom.window.fetch = (url) => {
    const key = String(url).replace(/^http:\/\/127\.0\.0\.1\//, '');
    if (key !== 'data/policy/homeownership-programs.json') {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => clone(payload) });
  };
  dom.window.eval(componentSrc);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await waitForRender();
  await waitForRender();
  return dom;
}

console.log('\nHomeownership programs tests');
console.log('='.repeat(38));

(async () => {
  assert.strictEqual(data.schema, 'homeownership-programs/v1', 'schema is versioned');
  assert(Array.isArray(data.programs), 'programs array exists');
  assert(data.programs.length >= 10, 'program list is non-vacuous');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.meta.review_by), 'meta review_by is ISO');

  const required = [
    'chfa-dpa-grant',
    'chfa-dpa-second-mortgage',
    'chfa-firstgeneration',
    'chfa-program-loans',
    'chfa-mcc-current-holders',
    'metro-dpa',
    'chac-dpa-loans',
    'colorado-homestead-exemption',
    'federal-25c-energy-efficient-home-improvement',
    'federal-25d-residential-clean-energy',
    'neighborhood-homes-investment-act'
  ];
  const ids = new Set(data.programs.map((program) => program.id));
  required.forEach((id) => assert(ids.has(id), `required program present: ${id}`));

  const allowedLevels = new Set(['federal', 'colorado', 'metro']);
  const allowedKinds = new Set(['tax-credit', 'grant', 'dpa-loan', 'property-tax-relief']);
  const allowedStatuses = new Set(['active', 'expired', 'proposed']);
  const allowedHosts = /^(www\.)?(chfainfo\.com|metro-dpa\.com|chaconline\.org|irs\.gov|congress\.gov|dpt\.colorado\.gov)$/;

  data.programs.forEach((program) => {
    assert(program.id && program.name, `${program.id || 'program'} has id and name`);
    assert(allowedLevels.has(program.level), `${program.id} level is allowed`);
    assert(allowedKinds.has(program.kind), `${program.id} kind is allowed`);
    assert(allowedStatuses.has(program.status), `${program.id} status is allowed`);
    assert(wordCount(program.plain_summary) <= 60, `${program.id} plain_summary stays novice-short`);
    assert(program.how_to_start && program.how_to_start.length < 180, `${program.id} has concise how_to_start`);
    assert(/^https:\/\//.test(program.source_url), `${program.id} source_url uses https`);
    const host = new URL(program.source_url).hostname;
    assert(allowedHosts.test(host), `${program.id} source host is an official/program administrator host: ${host}`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(program.review_by), `${program.id} review_by is ISO`);
    if (program.what_its_worth && /^VERIFY/.test(program.what_its_worth)) {
      assert.strictEqual(program.benefit_amount, null, `${program.id} VERIFY amount remains null`);
    }
  });

  const freshnessSrc = fs.readFileSync(path.join(root, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
  assert(freshnessSrc.includes('data/policy/homeownership-programs.json'), 'freshness audit includes homeownership programs');
  assert(freshnessSrc.includes('programs[].review_by'), 'freshness audit checks program review_by dates');

  const dom = await renderPage();
  const doc = dom.window.document;
  const text = doc.body.textContent.replace(/\s+/g, ' ');
  assert.strictEqual(doc.querySelector('h1').textContent.trim(), 'Help for Homebuyers', 'page heading is present');
  assert(doc.querySelector('[data-homeownership-programs]'), 'page has program mount');
  assert(!text.includes('Owner copy review requested'), 'internal owner-review flag must not ship in public page copy');
  assert(text.includes('DPA means down-payment assistance'), 'page defines DPA');
  assert(text.includes('AMI means area median income'), 'page defines AMI');
  assert(text.toLowerCase().includes('tax credit reduces tax owed dollar-for-dollar'), 'page explains credit versus deduction');
  required.forEach((id) => {
    assert(doc.querySelector(`[data-homeownership-program-id="${id}"]`), `rendered card present: ${id}`);
  });
  assert(text.includes('Up to the lesser of $25,000 or 3%'), 'CHFA grant amount renders from data');
  assert(text.includes('CHFA says it has not issued new Mortgage Credit Certificates since 2018'), 'MCC expired-new-issuance copy renders');
  assert(text.includes('Expired'), 'expired status pill renders');
  assert(text.includes('Proposed'), 'proposed status pill renders');

  const emptyDoc = clone(data);
  emptyDoc.programs = [];
  const emptyDom = await renderPage({ programsDoc: emptyDoc });
  assert.strictEqual(
    emptyDom.window.document.querySelectorAll('[data-homeownership-program-id]').length,
    0,
    'non-vacuous proof: empty program JSON removes all cards'
  );

  const insightsHtml = fs.readFileSync(path.join(root, 'insights.html'), 'utf8');
  assert(insightsHtml.includes('help-for-homebuyers.html'), 'insights links the homebuyer page');
  assert(insightsHtml.includes('Help for Homebuyers'), 'insights card uses the page title');

  console.log('All Homeownership Programs tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
