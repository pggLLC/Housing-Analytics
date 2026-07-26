const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const html = read('housing-needs-assessment.html');
const narratives = read('js/hna/hna-narratives.js');
const takeaways = read('js/hna/hna-section-takeaways.js');
const renderers = read('js/hna/hna-renderers.js');
const sourceBadge = read('js/components/source-badge.js');

assert(
  html.includes('<h3 style="margin:0;">Rental Affordability Gap by AMI Tier</h3>'),
  'A1: rental gap heading should be renamed'
);
assert(
  !html.includes('<h3 style="margin:0;">Affordability Gap by AMI Tier</h3>'),
  'A1: bare affordability gap heading should be gone'
);
assert(
  html.includes('>Rental Affordability Gap by AMI Tier</a> panel above'),
  'A1: in-page reference link should use the rental-specific title'
);

const chartAffordTag = html.match(/<div class="chart-box"[^>]*>\s*<canvas id="chartAfford"/s);
assert(chartAffordTag, 'A2/B1: chartAfford chart-box should exist');
assert(
  !chartAffordTag[0].includes('ACS 5-Year DP04 (home value)'),
  'A2: chartAfford source should not claim ACS DP04 is the home-value input'
);
assert(
  chartAffordTag[0].includes('Home value: Zillow ZHVI cascade (headline)'),
  'A2: chartAfford should disclose the ZHVI cascade headline source'
);
assert(
  /data-source-url="[^"]+"/.test(chartAffordTag[0]),
  'B1: chartAfford should have a clickable source URL'
);

const chartHomeValueTag = html.match(/<div class="chart-box"[^>]*>\s*<canvas id="chartHomeValue"/s);
assert(chartHomeValueTag, 'B1: chartHomeValue chart-box should exist');
assert(
  chartHomeValueTag[0].includes('data-source-url="https://data.census.gov/table/ACSDP5Y2024.DP04"'),
  'B1: chartHomeValue should link to ACS DP04'
);
assert(
  html.includes('The headline median home value is Zillow ZHVI (current typical value, all homes); the distribution below is the ACS 2020–2024 owner-reported value'),
  'A5: home-value section should reconcile ZHVI headline vs ACS distribution'
);

assert(
  !narratives.includes('above the ACS figure'),
  'A3: FHFA caveat should no longer say the headline is above the ACS figure'
);
assert(
  narratives.includes('the ACS home-value distribution shown below reflects 2020–2024 and sits below this current-market figure'),
  'A3: FHFA caveat should reference the ACS distribution and vintage'
);
assert(
  takeaways.includes('medianHomeValueInfo.sourceText'),
  'A4: Home value takeaway should append the resolved home-value source label'
);

assert(
  /live:\s*'Live data'/.test(sourceBadge),
  'B2: source badge should map live source type'
);

assert(
  renderers.includes('HUD CHAS 2018–2022 — ${sourceLabel}.'),
  'B4: CHAS county fallback footer should include vintage'
);
assert(
  renderers.includes('Census BPS 2020–2024'),
  'B3: ownership source pills should add vintage to Census BPS'
);
assert(
  renderers.includes('HUD CHAS 2018–2022'),
  'B3/B4: ownership/CHAS sources should include vintage'
);

const tenureTableBlock = renderers.match(/aria-label="Tenure strategy indicators"[\s\S]*?<\/table>/);
assert(tenureTableBlock, 'A6: tenure strategy indicator table should be rendered');
assert(
  !tenureTableBlock[0].includes('Existing rental gap'),
  'A6: Existing rental gap should not appear as a bare ownership-table metric'
);
assert(
  renderers.includes('Rental supply context (not an ownership metric)'),
  'A6: rental gap context should be retitled when kept near ownership indicators'
);

assert(
  renderers.includes('data-hna-chart-scope-note'),
  'B5: DOLA charts should have per-chart scope notes'
);
assert(
  renderers.includes('County data shown for this place: DOLA single-year-of-age projections are county-level'),
  'B5: DOLA age charts should disclose county data for place selections'
);
assert(
  renderers.includes('County data shown for this place: DOLA household projections are county-level'),
  'B5: DOLA household/demand charts should disclose county data for place selections'
);

console.log('HNA provenance disclosure tests passed');
