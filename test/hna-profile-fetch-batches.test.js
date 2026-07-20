'use strict';

const assert = require('assert');
const { JSDOM } = require('jsdom');

console.log('\nHNA ACS profile fetch batching tests');
console.log('='.repeat(46));

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'http://127.0.0.1/housing-needs-assessment.html'
});

global.window = dom.window;
global.document = dom.window.document;
global.CustomEvent = dom.window.CustomEvent;
global.AbortController = dom.window.AbortController;
Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
const realAddEventListener = document.addEventListener.bind(document);
document.addEventListener = function (type, listener, options) {
  if (type === 'DOMContentLoaded') return;
  return realAddEventListener(type, listener, options);
};

window.HNAUtils = {
  STATE_FIPS_CO: '08',
  ACS_YEAR_PRIMARY: 2024,
  ACS_YEAR_FALLBACK: 2023,
  ACS_VINTAGES: [2024, 2023, 2022],
  DEBUG_HNA: false,
  censusKey: () => null,
  redactKey: (url) => url
};

window.HNARenderers = new Proxy({}, {
  get(target, prop) {
    if (!target[prop]) target[prop] = function () {};
    return target[prop];
  }
});

const requestedUrls = [];
window.fetchWithTimeout = async function (url) {
  requestedUrls.push(url);
  const parsed = new URL(url);
  const vars = decodeURIComponent(parsed.searchParams.get('get') || '').split(',').filter(Boolean);
  assert(vars.length <= 50, 'single Census get= request must stay at or below 50 variables including NAME');
  return {
    ok: true,
    json: async () => [
      vars,
      vars.map((v) => {
        if (v === 'NAME') return 'Denver County, Colorado';
        if (v === 'DP05_0001E') return '715522';
        if (v === 'DP04_0134E') return '1802';
        if (v === 'DP04_0046E') return '142000';
        return '1';
      })
    ]
  };
};

require('../js/hna/hna-controller.js');

(async function run() {
  assert.strictEqual(typeof window.__HNA_fetchAcsProfileForTest, 'function', 'fetchAcsProfile test hook is exposed');
  requestedUrls.length = 0;
  const profile = await window.__HNA_fetchAcsProfileForTest('county', '08031');

  assert.strictEqual(requestedUrls.length, 2, 'mocked ACS1 profile path uses two batched requests');
  requestedUrls.forEach((url) => {
    const vars = decodeURIComponent(new URL(url).searchParams.get('get')).split(',').filter(Boolean);
    assert(vars.includes('NAME'), 'each batch includes NAME for Census row shape');
    assert(vars.length <= 50, 'batch URL carries <=50 get= variables');
  });

  assert.strictEqual(profile.DP05_0001E, '715522', 'DP05 value from batch 1 is merged into profile');
  assert.strictEqual(profile.DP04_0134E, '1802', 'DP04 value from batch 2 is merged into profile');
  assert.strictEqual(profile.DP04_0046E, '142000', 'second-batch tenure value is available to downstream stat/render parsing');
  assert.strictEqual(profile.NAME, 'Denver County, Colorado', 'merged profile retains NAME');
  assert.strictEqual(profile._acsYear, 2024, 'merged profile keeps selected vintage metadata');
  assert.strictEqual(profile._acsSeries, 'acs1', 'merged profile keeps selected ACS series metadata');

  console.log('HNA ACS profile fetch batching tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
