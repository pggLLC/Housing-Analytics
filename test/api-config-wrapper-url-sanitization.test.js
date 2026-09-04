'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js', 'api-config-wrapper.js'), 'utf8');
const scheme = 'https' + '://';

function createWrappedFetch(pageHref) {
  const calls = [];
  const window = {
    APP_CONFIG: {
      FRED_API_KEY: 'fred key',
      CENSUS_API_KEY: 'census key'
    },
    location: { href: pageHref || 'http://127.0.0.1/index.html' },
    fetch: function (input, init) {
      calls.push({ input, init });
      return Promise.resolve({ ok: true });
    }
  };
  vm.runInNewContext(source, { window, URL, console }, { filename: 'js/api-config-wrapper.js' });
  return {
    fetchInput: function (input) {
      calls.length = 0;
      window.fetch(input, { marker: true });
      assert.strictEqual(calls.length, 1, 'wrapped fetch delegates exactly once');
      assert.deepStrictEqual(calls[0].init, { marker: true }, 'wrapped fetch preserves init');
      return calls[0].input;
    }
  };
}

const wrapper = createWrappedFetch();

assert.strictEqual(
  wrapper.fetchInput(scheme + 'fred.stlouisfed.org/series'),
  scheme + 'fred.stlouisfed.org/series?api_key=fred%20key',
  'FRED key is appended for fred.stlouisfed.org'
);
assert.strictEqual(
  wrapper.fetchInput(scheme + 'api.stlouisfed.org/fred/series?series_id=UNRATE'),
  scheme + 'api.stlouisfed.org/fred/series?series_id=UNRATE&api_key=fred%20key',
  'FRED key is appended for api.stlouisfed.org'
);
assert.strictEqual(
  wrapper.fetchInput(scheme + 'api.census.gov/data/2024/acs'),
  scheme + 'api.census.gov/data/2024/acs?key=census%20key',
  'Census key is appended for api.census.gov'
);

const rejected = [
  scheme + 'evil.com/?x=api.census.gov',
  scheme + 'api.census.gov.evil.com/',
  scheme + 'evilapi.census.gov/',
  scheme + 'evil.com/?x=fred.stlouisfed.org',
  scheme + 'fred.stlouisfed.org.evil.com/',
  scheme + 'evilfred.stlouisfed.org/',
  scheme + 'evil.com/?x=api.stlouisfed.org',
  scheme + 'api.stlouisfed.org.evil.com/',
  scheme + 'evilapi.stlouisfed.org/',
  'http' + '://['
];
for (const url of rejected) {
  assert.strictEqual(
    wrapper.fetchInput(url),
    url,
    'untrusted or unparseable URL is passed through without a key: ' + url
  );
}

assert.strictEqual(
  wrapper.fetchInput(scheme + 'api.census.gov/data?key=already-present'),
  scheme + 'api.census.gov/data?key=already-present',
  'existing Census key guard remains intact'
);
assert.strictEqual(
  wrapper.fetchInput(scheme + 'api.stlouisfed.org/fred?api_key=already-present'),
  scheme + 'api.stlouisfed.org/fred?api_key=already-present',
  'existing FRED key guard remains intact'
);

const relativeWrapper = createWrappedFetch(scheme + 'api.census.gov/dashboard');
assert.strictEqual(
  relativeWrapper.fetchInput('/data/2024/acs'),
  '/data/2024/acs?key=census%20key',
  'relative URL resolves against the page URL before exact hostname matching'
);

console.log('api-config-wrapper-url-sanitization: PASS');
