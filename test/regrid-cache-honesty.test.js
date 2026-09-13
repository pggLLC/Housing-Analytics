'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CONNECTOR = path.join(ROOT, 'js/data-connectors/regrid-parcels.js');
const WORKFLOW = path.join(ROOT, '.github/workflows/fetch-parcel-zoning-data.yml');
const COMMITTED_CACHE = path.join(ROOT, 'data/affordable-housing/regrid-parcels-by-place.json');

let failures = 0;
async function run(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function feature(id) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-105.9, 38.5] },
    properties: { parcelId: id, owner: 'Test Owner' }
  };
}

function activeFixture(generated) {
  return {
    meta: {
      availability: 'active',
      is_current_coverage: true,
      generated,
      radius_miles: 3,
      total_parcels: 2,
      api_calls: 1
    },
    byGeoid: {
      '0867280': {
        jurisdiction: 'Salida',
        centroid: { lat: 38.529909, lng: -105.998018 },
        parcel_count: 2,
        parcels: [feature('a'), feature('b')]
      }
    }
  };
}

function loadConnector(payload, rejection) {
  global.window = global;
  global.APP_CONFIG = {};
  delete global.DataService;
  delete global.fetchWithTimeout;
  delete global.RegridParcels;
  global.fetch = rejection
    ? () => Promise.reject(rejection)
    : () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  delete require.cache[require.resolve(CONNECTOR)];
  require(CONNECTOR);
  return global.RegridParcels;
}

function stepBlock(source, name) {
  const marker = '      - name: ' + name;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'workflow step missing: ' + name);
  const end = source.indexOf('\n      - name:', start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

const deferred = JSON.parse(fs.readFileSync(COMMITTED_CACHE, 'utf8'));

(async () => {
  console.log('regrid-cache-honesty');

  await run('deferred cache is unavailable and carries its reason', async () => {
    const api = loadConnector(deferred);
    assert.equal(await api.fetchPipelineCached('0867280'), null);
    const status = await api.getPipelineCacheStatus();
    assert.equal(status.availability, 'deferred');
    assert.equal(status.isCurrent, false);
    assert.match(status.unavailableReason, /not funded/i);
    assert.match(status.unavailableReason, /#1612/);
  });

  await run('current active cache remains usable after reactivation', async () => {
    const api = loadConnector(activeFixture(new Date().toISOString()));
    const cached = await api.fetchPipelineCached('0867280');
    assert.equal(cached.features.length, 2);
    assert.equal(cached.source, 'cache');
    assert.ok(cached.generated);
    assert.equal(await api.isPipelineCacheAvailable(), true);
  });

  await run('active cache older than fourteen days is rejected as stale', async () => {
    const generated = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
    const api = loadConnector(activeFixture(generated));
    assert.equal(await api.fetchPipelineCached('0867280'), null);
    assert.equal((await api.getPipelineCacheStatus()).stale, true);
  });

  await run('the data current-coverage flag wins over parcel presence', async () => {
    const fixture = activeFixture(new Date().toISOString());
    fixture.meta.is_current_coverage = false;
    fixture.meta.availability = 'failed';
    fixture.meta.unavailableReason = 'The scan did not establish current coverage';
    const api = loadConnector(fixture);
    assert.equal(await api.fetchPipelineCached('0867280'), null);
  });

  await run('an error-bearing empty active record is not served', async () => {
    const fixture = activeFixture(new Date().toISOString());
    fixture.byGeoid['0867280'].parcel_count = null;
    fixture.byGeoid['0867280'].parcels = [];
    fixture.byGeoid['0867280'].error = 'request failed';
    const api = loadConnector(fixture);
    assert.equal(await api.fetchPipelineCached('0867280'), null);
  });

  await run('cache-load failure resolves to an explicit unavailable status', async () => {
    const api = loadConnector(null, new Error('fixture fetch failed'));
    assert.equal(await api.fetchPipelineCached('0867280'), null);
    const status = await api.getPipelineCacheStatus();
    assert.equal(status.isCurrent, false);
    assert.ok(status.unavailableReason);
  });

  await run('committed cache is a ten-jurisdiction deferred artifact with null counts', async () => {
    const meta = deferred.meta;
    assert.equal(meta.availability, 'deferred');
    assert.equal(meta.is_current_coverage, false);
    assert.equal(meta.total_parcels, null);
    assert.equal(meta.api_calls, 0);
    assert.match(meta.unavailableReason, /not funded/i);
    assert.match(meta.unavailableReason, /#1612/);
    assert.match(meta.unavailableReason, /not a technical failure/i);
    assert.doesNotMatch(meta.next_refresh, /Sunday|scheduled run/i);
    assert.equal(Object.keys(deferred.byGeoid).length, 10);
    Object.values(deferred.byGeoid).forEach((record) => {
      assert.equal(record.parcel_count, null);
      assert.deepEqual(record.parcels, []);
    });
  });

  await run('workflow makes Regrid opt-in, pipe-safe, and secret-scoped', async () => {
    const source = fs.readFileSync(WORKFLOW, 'utf8');
    assert.match(source, /workflow_dispatch:\s*[\s\S]*?regrid_enabled:\s*[\s\S]*?default:\s*false/);
    const envLine = source.split('\n').find((line) => line.includes('REGRID_ENABLED:')) || '';
    assert.match(envLine, /vars\.REGRID_ENABLED/);
    assert.match(envLine, /inputs\.regrid_enabled/);

    const regridStep = stepBlock(source, 'Fetch Regrid parcels for pipeline jurisdictions');
    assert.match(regridStep, /if:\s*env\.REGRID_ENABLED == 'true'/);
    assert.match(regridStep, /set -o pipefail/);
    assert.match(regridStep, /REGRID_API_KEY:\s*\$\{\{ secrets\.REGRID_API_KEY \}\}/);

    const assessorStep = stepBlock(source, 'Fetch parcel aggregates (DOLA + county assessors)');
    assert.doesNotMatch(assessorStep, /REGRID_API_KEY/);
    const secretLines = source.split('\n').filter((line) =>
      !line.trim().startsWith('#') && line.includes('secrets.REGRID_API_KEY'));
    assert.equal(secretLines.length, 1);
    assert.ok(source.indexOf(secretLines[0]) > source.indexOf('Fetch Regrid parcels for pipeline jurisdictions'));

    const deferredStep = stepBlock(source, 'Regrid pipeline scan — deferred (no request made)');
    assert.match(deferredStep, /if:\s*env\.REGRID_ENABLED != 'true'/);
    assert.match(deferredStep, /not funded/i);
    assert.match(deferredStep, /#1612/);
    const commitDirectiveLines = source.split('\n').filter((line) =>
      !line.trim().startsWith('#') && line.includes('[skip ci]'));
    assert.equal(commitDirectiveLines.length, 1,
      'the existing bot-commit directive must remain confined to the commit command');
  });

  await run('user-facing Regrid copy describes deferral without retired free-tier claims', async () => {
    const paths = [
      'js/components/map-layer-status.js',
      'developer-brief.html',
      'dashboard-data-quality.html'
    ];
    paths.forEach((relative) => {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      assert.match(source, /not funded/i, relative + ' must state why access is unavailable');
      assert.match(source, /#1612/, relative + ' must link the owner decision');
      assert.doesNotMatch(source, /free tier|free-tier/i, relative + ' must not advertise a retired tier');
    });
    const brief = fs.readFileSync(path.join(ROOT, 'developer-brief.html'), 'utf8');
    assert.doesNotMatch(brief, /Add <code>REGRID_API_KEY<\/code> to\s*<code>js\/config\.js/i);
    const status = fs.readFileSync(path.join(ROOT, 'js/components/map-layer-status.js'), 'utf8');
    assert.doesNotMatch(status, /comes from free county/i);
    const market = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
    assert.doesNotMatch(market, /OSM \+ Regrid/i);
  });

  await run('connector remains clean under the absence-as-value source guard', async () => {
    const guardUrl = pathToFileURL(path.join(ROOT, 'scripts/audit/absence-confident-value-guard.mjs')).href;
    const guard = await import(guardUrl);
    const source = fs.readFileSync(CONNECTOR, 'utf8');
    assert.deepEqual(guard.scanSource('js/data-connectors/regrid-parcels.js', source), []);
  });

  if (failures) {
    console.error('regrid-cache-honesty: FAIL');
    process.exitCode = 1;
  } else {
    console.log('regrid-cache-honesty: PASS');
  }
})();
