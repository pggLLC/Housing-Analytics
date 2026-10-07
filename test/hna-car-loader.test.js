'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

function loadCarHelpers() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'housing-needs-assessment.html'), 'utf8');
  const start = html.indexOf('(function () {\n  function fmtK');
  assert.notEqual(start, -1, 'expected to find the HNA market-data inline script start');
  const end = html.indexOf('\n}());', start);
  assert.notEqual(end, -1, 'expected to find the HNA market-data inline script end');

  const listeners = {};
  const document = {
    addEventListener: (event, fn) => { listeners[event] = fn; },
    getElementById: () => null,
    querySelector: () => null
  };
  const window = {
    HNAState: {
      state: {
        current: { geoType: 'county', geoid: '08031', contextCounty: '08031' }
      }
    }
  };

  const script = html.slice(start, end + '\n}());'.length);
  new Function('window', 'document', 'fetch', script)(window, document, () => Promise.reject(new Error('unexpected fetch')));
  assert.ok(window.__HNA_CAR_TEST__, 'expected HNA CAR test helpers to be exposed');
  return window.__HNA_CAR_TEST__;
}

function response(data) {
  if (data === undefined) return Promise.resolve({ ok: false, json: async () => null });
  return Promise.resolve({ ok: true, json: async () => data });
}

async function run(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name + '\n    ' + err.message);
    process.exitCode = 1;
  }
}

console.log('HNA CAR fallback loader');

(async function main() {
  await run('lists only indexed reports, newest first, within the look-back', () => {
    const helpers = loadCarHelpers();
    const index = { months: ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', 'not-a-month'] };
    assert.deepEqual(helpers.carReportUrls(index, 4), [
      'data/car-market-report-2026-08.json',
      'data/car-market-report-2026-07.json',
      'data/car-market-report-2026-06.json',
      'data/car-market-report-2026-05.json'
    ]);
    assert.deepEqual(helpers.carReportUrls(null, 4), [], 'no index, no guessed filenames');
  });

  await run('reads the index first and requests nothing it does not list (#2053)', async () => {
    const helpers = loadCarHelpers();
    const requested = [];
    const rendered = [];
    const report = { month: '2026-09', statewide: {}, counties: { '08031': { name: 'Denver County' } } };
    const ok = await helpers.tryLoadCARFallback({
      fetcher: (url) => {
        requested.push(url);
        if (url === helpers.CAR_INDEX_URL) return response({ months: ['2026-09', '2026-08'] });
        return response(url === 'data/car-market-report-2026-09.json' ? report : undefined);
      },
      render: (car) => rendered.push(car)
    });
    assert.equal(ok, true);
    assert.deepEqual(requested, [helpers.CAR_INDEX_URL, 'data/car-market-report-2026-09.json']);
    assert.equal(rendered[0].month, '2026-09');
  });

  await run('an unreadable index offers no report rather than a guessed one', async () => {
    const helpers = loadCarHelpers();
    const requested = [];
    const ok = await helpers.tryLoadCARFallback({
      fetcher: (url) => { requested.push(url); return response(undefined); },
      render: () => { throw new Error('nothing should render'); }
    });
    assert.equal(ok, false);
    assert.deepEqual(requested, [helpers.CAR_INDEX_URL]);
  });

  await run('uses older county report when newest report is statewide-only', async () => {
    const helpers = loadCarHelpers();
    const rendered = [];
    const countyReport = {
      month: '2026-05',
      statewide: { median_sale_price: 600000 },
      counties: { '08031': { name: 'Denver County' } }
    };
    const statewideOnly = {
      month: '2026-07',
      statewide: { median_sale_price: 625000 },
      counties: {}
    };
    const byUrl = {
      'data/car-market-report-2026-07.json': statewideOnly,
      'data/car-market-report-2026-05.json': countyReport
    };

    const ok = await helpers.tryLoadCARFallback({
      urls: [
        'data/car-market-report-2026-07.json',
        'data/car-market-report-2026-06.json',
        'data/car-market-report-2026-05.json'
      ],
      fetcher: (url) => response(byUrl[url]),
      render: (car) => rendered.push(car)
    });

    assert.equal(ok, true);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].month, '2026-05');
  });

  await run('prefers newest report once it has the selected county', async () => {
    const helpers = loadCarHelpers();
    const rendered = [];
    const countyReport = {
      month: '2026-05',
      statewide: { median_sale_price: 600000 },
      counties: { '08031': { name: 'Denver County' } }
    };
    const newestCountyReport = {
      month: '2026-07',
      statewide: { median_sale_price: 625000 },
      counties: { '08031': { name: 'Denver County' } }
    };
    const byUrl = {
      'data/car-market-report-2026-07.json': newestCountyReport,
      'data/car-market-report-2026-05.json': countyReport
    };

    const ok = await helpers.tryLoadCARFallback({
      urls: [
        'data/car-market-report-2026-07.json',
        'data/car-market-report-2026-06.json',
        'data/car-market-report-2026-05.json'
      ],
      fetcher: (url) => response(byUrl[url]),
      render: (car) => rendered.push(car)
    });

    assert.equal(ok, true);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].month, '2026-07');
  });
}()).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
