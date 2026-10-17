const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function formatMillions(value) {
  assert.equal(value % 1_000_000, 0, 'allocation authority is expressed in whole millions');
  return `$${value / 1_000_000}M`;
}

const guide = read('lihtc-guide-for-stakeholders.html');

assert(guide.includes('HB 24-1434'), 'guide names HB 24-1434 for the Colorado state LIHTC');
assert(guide.includes('https://leg.colorado.gov/bills/hb24-1434'), 'guide links to HB24-1434');
assert(!guide.includes('HB 24-1007'), 'guide does not name HB 24-1007 for the Colorado state LIHTC');
assert(!guide.includes('hb24-1007'), 'guide does not link to HB24-1007');

assert(!guide.includes('newly enacted for 2025'), 'guide does not imply Colorado AHTC was newly enacted for 2025');
assert(!guide.includes('Colorado enacted a state LIHTC effective for 2025'), 'guide describes acceleration/expansion, not creation');

assert(!guide.includes('$10M of state credits annually'), 'guide does not retain the stale $10M annual cap');
assert(guide.includes('Annual authority:'), 'guide labels the state credit figure as annual authority');
assert(guide.includes('set by HB 24-1434'), 'annual-authority line references HB 24-1434');

const equityFactors = readJson('data/market/colorado-equity-pricing-factors.json');
const authorityByYear = equityFactors.factors.state_affordable_housing_tax_credit.allocation_authority_by_year;
const expected2026Authority = formatMillions(authorityByYear['2026']);
const annualAuthorityLine = guide.match(/<li><strong>Annual authority:<\/strong>[^<]+<\/li>/);
assert(annualAuthorityLine, 'guide has an annual-authority list item');
assert(
  annualAuthorityLine[0].includes(expected2026Authority),
  `annual-authority line contains repo 2026 authority (${expected2026Authority})`,
);

assert(!guide.includes('$2.75 per capita'), 'guide no longer contains stale federal $2.75 per-capita figure');
// The ceiling sentence must agree with the 2026 ceiling the legislation
// tracker records: the same per-capita amount and small-state minimum, and the
// "greater of" rule (a sum of the two overstates every state's ceiling).
const ceilingEntry = readJson('data/policy/tax-credit-legislation.json').entries
  .find((e) => e.ceiling_2026 && e.ceiling_2026.year === 2026);
const ceiling = ceilingEntry && ceilingEntry.ceiling_2026;
assert(ceiling, 'tax-credit-legislation.json records a 2026 federal ceiling');
assert(guide.includes(`$${ceiling.per_capita} per person`), `guide states the 2026 per-capita amount ($${ceiling.per_capita})`);
assert(guide.includes('$' + ceiling.small_state_minimum.toLocaleString('en-US')), 'guide states the 2026 small-state minimum');
assert(/greater of a per-capita amount/.test(guide), 'guide states the ceiling as the greater of the two amounts');
assert(!guide.includes('per-capita multiplier plus a small-state minimum'), 'guide does not add the per-capita amount and the minimum');

// Typed market figures that disagreed with the equity-pricing data file
// (#2010 removed the same figures from the CRA page).
for (const stale of ['$0.87 (down from $0.94 in 2024)', '$0.85 (stable)', '$0.90-$0.93 expected', 'Potential expansion pending', 'Typical award threshold: 90+', 'Source: CHFA 2026 QAP']) {
  assert(!guide.includes(stale), `guide no longer carries "${stale}"`);
}
// Per $1M of basis the credit is 9% or 4% a year, ten years.
assert(guide.includes('~$90K/yr × 10 = $900K'), '9% credit per $1M basis is $90K a year');
assert(guide.includes('~$40K/yr × 10 = $400K'), '4% credit per $1M basis is $40K a year');
// Colorado state-credit pricing has no citable source in the data file, so
// the guide must not type a price range for it.
const statePricing = equityFactors.factors.state_affordable_housing_tax_credit.state_credit_pricing;
if (statePricing.price_low == null) {
  assert(!/State credits typically priced/.test(guide), 'guide does not type a state-credit price the data file leaves null');
}

console.log(`lihtc-guide-accuracy: PASS (${expected2026Authority} 2026 Colorado AHTC authority)`);

// The 10-year Treasury in the market table must come from data/fred-data.json
// and, when the feed fails, read "not published" rather than leave the static
// rate on screen as if it were current.
(async () => {
  const { JSDOM } = require('jsdom');
  const start = guide.indexOf('/* The 10-year Treasury');
  assert(start > 0, 'guide has the Treasury binder');
  const code = guide.slice(guide.lastIndexOf('<script>', start) + 8, guide.indexOf('</script>', start));
  async function run(fetchImpl) {
    const dom = new JSDOM('<span id="lihtcGuideDgs10">5.10%</span><span id="lihtcGuideDgs10Date">2026-10-15</span>', { runScripts: 'outside-only' });
    dom.window.fetch = fetchImpl;
    dom.window.eval(code);
    await new Promise((r) => setTimeout(r, 20));
    return dom.window.document.getElementById('lihtcGuideDgs10').textContent;
  }
  const fred = readJson('data/fred-data.json');
  const obs = fred.series.DGS10.observations.filter((o) => Number(o.value) > 0);
  const latest = Number(obs[obs.length - 1].value).toFixed(2) + '%';
  assert.equal(await run(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fred) })), latest, 'shows the latest DGS10 value');
  assert.equal(await run(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })), 'not published', 'HTTP failure clears the rate');
  assert.equal(await run(() => Promise.reject(new Error('offline'))), 'not published', 'network failure clears the rate');
  assert.equal(await run(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ series: {} }) })), 'not published', 'missing series clears the rate');
  console.log('lihtc-guide-accuracy: Treasury binder PASS');
})().catch((e) => { console.error(e); process.exit(1); });
