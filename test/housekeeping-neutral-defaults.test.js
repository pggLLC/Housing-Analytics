'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

async function loadClimateDataService(localData, fetcher, config) {
  global.window = global;
  global.safeFetchJSON = () => Promise.resolve(localData);
  global.fetchWithTimeout = fetcher;
  global.APP_CONFIG = config || {};
  const modulePath = require.resolve('../js/data-service-portable.js');
  delete require.cache[modulePath];
  delete global.DataService;
  require(modulePath);
  return global.DataService;
}

async function main() {
  const amiSource = fs.readFileSync(path.join(ROOT, 'js/co-ami-gap.js'), 'utf8');
  const originalMethodology = [
    'Renter households are counted from ACS 5-year estimates',
    'Affordable units are renter-occupied housing units',
    'Gap = affordable units − eligible households',
    'Coverage = affordable units ÷ eligible households',
    'AMI thresholds use HUD FY 2025 Income Limits'
  ];
  originalMethodology.forEach((line) => assert(amiSource.includes(line), `existing methodology remains: ${line}`));
  assert(amiSource.includes('not necessarily vacant or available'), 'methodology discloses occupied units are not necessarily available');
  assert(amiSource.includes('positive gap does not establish that housing is obtainable'), 'methodology explains the limit on a positive gap');

  const Transit = require('../js/pma-transit.js');
  const priorWindow = global.window;
  global.window = {};
  const missingTransit = await Transit.fetchEPASmartLocation({});
  assert.equal(missingTransit.transitAccessibility, null);
  assert.equal(missingTransit.walkScore, null);
  assert.notEqual(missingTransit.transitAccessibility, 50);
  assert.match(missingTransit.unavailableReason, /unavailable/i);
  global.window = { DataService: { fetchEPASmartLocation: () => Promise.resolve({ transitAccessibility: 67, walkScore: 74, _dataSource: 'epa-live' }) } };
  const measuredTransit = await Transit.fetchEPASmartLocation({});
  assert.equal(measuredTransit.transitAccessibility, 67);
  assert.equal(measuredTransit.walkScore, 74);
  global.window = priorWindow;

  const emptyClimate = { hazard_summary: {}, eji_tracts: [] };
  const failedService = await loadClimateDataService(
    emptyClimate,
    () => Promise.reject(new Error('simulated NOAA failure')),
    { NOAA_CDO_TOKEN: 'test-token' }
  );
  const unavailableClimate = await failedService.fetchNOAAClimateData({ lat: 39.7, lon: -104.9 }, 'all');
  assert.equal(unavailableClimate.resilienceScore, null);
  assert.equal(unavailableClimate._stub, true);
  assert.match(unavailableClimate.unavailableReason, /could not be loaded/i);

  const normalsService = await loadClimateDataService(
    emptyClimate,
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ value: 12.3 }] }) }),
    { NOAA_CDO_TOKEN: 'test-token' }
  );
  const normalsOnly = await normalsService.fetchNOAAClimateData({ lat: 39.7, lon: -104.9 }, 'all');
  assert.equal(normalsOnly._dataSource, 'noaa-cdo-live');
  assert.equal(normalsOnly.resilienceScore, null, 'retrieved normals do not become an invented resilience score');
  assert.deepEqual(normalsOnly.normals.results, [{ value: 12.3 }], 'successful NOAA response remains available as normals data');
  assert.match(normalsOnly.unavailableReason, /no supported method derives/i);

  const healthyService = await loadClimateDataService(
    { hazard_summary: { drought: { level: 'moderate' } }, eji_tracts: [] },
    () => Promise.reject(new Error('live fetch should not run')),
    {}
  );
  const healthyClimate = await healthyService.fetchNOAAClimateData({ lat: 39.7, lon: -104.9 }, 'all');
  assert.equal(healthyClimate.resilienceScore, 70);
  assert.equal(healthyClimate._stub, false);

  global.window = global;
  delete require.cache[require.resolve('../js/pma-infrastructure.js')];
  require('../js/pma-infrastructure.js');
  const card = global.PMAInfrastructure.buildInfrastructureScorecard({}, unavailableClimate, {}, {});
  assert.equal(card.climateResilienceScore, null);
  assert.equal(card.climateUnavailableReason, unavailableClimate.unavailableReason);
  const healthyCard = global.PMAInfrastructure.buildInfrastructureScorecard({}, healthyClimate, {}, {});
  assert.equal(healthyCard.climateResilienceScore, 70);
  assert.equal(healthyCard.climateUnavailableReason, null);

  const rendered = { innerHTML: '' };
  global.document = { getElementById: (id) => id === 'maInfrastructureContent' ? rendered : null };
  delete require.cache[require.resolve('../js/market-analysis/market-report-renderers.js')];
  require('../js/market-analysis/market-report-renderers.js');
  global.MARenderers.renderInfrastructure({
    score: 62,
    justification: {
      floodRiskPercent: 0.1,
      climateResilienceScore: null,
      climateUnavailableReason: 'Unavailable <source> "quoted" & pending',
      sewerCapacityAdequate: true,
      foodAccessScore: 71
    }
  });
  assert(rendered.innerHTML.includes('Unavailable &lt;source&gt; &quot;quoted&quot; &amp; pending'), 'HTML meta-characters in the carried reason are escaped');
  assert(!rendered.innerHTML.includes('<source>'), 'carried reason cannot inject markup');
  assert(rendered.innerHTML.includes('FEMA NFHL'), 'existing FEMA NFHL literal renders unchanged');

  global.MARenderers.renderInfrastructure({
    score: 62,
    justification: {
      floodRiskPercent: 0.1,
      climateResilienceScore: null,
      climateUnavailableReason: 'Climate score unavailable',
      sewerCapacityAdequate: true,
      foodAccessScore: 71
    }
  });
  assert(rendered.innerHTML.includes('Climate score unavailable'), 'normal carried reason renders unchanged');

  global.MARenderers.renderInfrastructure({
    score: 62,
    justification: {
      floodRiskPercent: 0.1,
      climateResilienceScore: 70,
      sewerCapacityAdequate: true,
      foodAccessScore: 71
    }
  });
  assert(rendered.innerHTML.includes('(NOAA)'), 'existing NOAA literal renders unchanged');

  console.log('✅ housekeeping absence-semantics guards pass');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
