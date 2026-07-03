import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATTRIBUTION,
  buildCountyReport,
  coverageSummary,
  parseCountyRows,
  parseNumber,
} from '../scripts/fetch-car-showingtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(ROOT, 'test', 'fixtures', 'car-showingtime');

function readFixture(file) {
  return fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('\nCAR ShowingTime county ingest');

test('parseNumber handles money, percents, and suppressed values', () => {
  assert.equal(parseNumber('$542,500', { money: true }), 542500);
  assert.equal(parseNumber('<span>$542,500</span>', { money: true }), 542500);
  assert.equal(parseNumber('+ 12.0%', { pct: true }), 12);
  assert.equal(parseNumber('- 17.5%', { pct: true }), -17.5);
  assert.equal(parseNumber('--', { pct: true }), null);
  assert.equal(parseNumber('$0', { money: true }), null);
});

test('county-name decoding does not double-unescape encoded entities', () => {
  const countyMap = new Map([
    ['fish &lt;script&gt; county', { name: 'Fish &lt;script&gt; County', fips: '08999' }],
  ]);
  const html = `
    <table><tr>
      <td><span>Fish &amp;lt;script&amp;gt; County</span></td>
      <td>1</td><td>0.0%</td><td>2</td><td>0.0%</td><td>$300,000</td><td>0.0%</td><td>3</td><td>0.0%</td>
    </tr></table>
  `;
  const rows = parseCountyRows(html, countyMap);
  assert.equal(rows['08999'].name, 'Fish &lt;script&gt; County');
  assert.equal(rows['08999'].median_sale_price, 300000);
});

test('parseCountyRows extracts county rows from ShowingTime-shaped HTML', () => {
  const rows = parseCountyRows(readFixture('202605-0SF.htm'));
  assert.equal(rows['08001'].name, 'Adams County');
  assert.equal(rows['08001'].closed_sales, 624);
  assert.equal(rows['08001'].closed_sales_yoy_pct, -17.5);
  assert.equal(rows['08001'].new_listings, 787);
  assert.equal(rows['08001'].median_sale_price, 542500);
  assert.equal(rows['08001'].active_listings, 1347);
  assert.equal(rows['08013'].median_sale_price_yoy_pct, 3.1);
  assert.equal(rows['08111'].median_sale_price, null);
  assert.equal(rows['08111'].closed_sales, 0);
});

test('buildCountyReport returns 64 FIPS-keyed counties with both property types', () => {
  const report = buildCountyReport(readFixture('202605-0SF.htm'), readFixture('202605-0TC.htm'));
  const summary = coverageSummary(report);
  assert.equal(Object.keys(report).length, 64);
  assert.equal(report['08001'].single_family.median_sale_price, 542500);
  assert.equal(report['08001'].townhouse_condo.median_sale_price, 355000);
  assert.equal(report['08125'].single_family.median_sale_price, 70000);
  assert.equal(report['08125'].townhouse_condo.median_sale_price, null);
  assert.equal(report['08001'].single_family.months_of_supply, null);
  assert.equal(summary.county_count, 64);
});

test('CLI writes real county data from fixtures with CAR attribution', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'car-showingtime-'));
  fs.writeFileSync(path.join(tmp, 'car-market-report-2026-05.json'), JSON.stringify({
    month: '2026-05',
    generated_at: '2026-05-01T00:00:00.000Z',
    source: 'Colorado Association of REALTORS (CAR)',
    source_url: 'https://coloradorealtors.com/market-trends/',
    version: '1.0',
    statewide: { median_sale_price: 583794 },
    metro_areas: {},
    notes: 'placeholder',
  }, null, 2));
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'fetch-car-showingtime.mjs'),
    '--month', '2026-05',
    '--fixture-dir', FIXTURE_DIR,
    '--out-dir', tmp,
    '--min-populated', '4',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(tmp, 'car-market-report-2026-05.json'), 'utf8'));
  assert.equal(report.source, ATTRIBUTION);
  assert.equal(report.counties['08001'].single_family.closed_sales, 624);
  assert.equal(report.counties['08001'].townhouse_condo.closed_sales, 51);
  assert.equal(report.statewide.median_sale_price, 583794);
});

test('CLI exits 0 and keeps last-good data when fetch/fixture load fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'car-showingtime-fail-'));
  const existing = {
    month: '2026-05',
    source: 'last-good',
    counties: { '08001': { name: 'Adams County' } },
  };
  fs.writeFileSync(path.join(tmp, 'car-market-report-2026-05.json'), JSON.stringify(existing, null, 2));
  const missingDir = path.join(tmp, 'missing-fixtures');
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'fetch-car-showingtime.mjs'),
    '--month', '2026-05',
    '--fixture-dir', missingDir,
    '--out-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'car-market-report-2026-05.json'), 'utf8'));
  assert.deepEqual(after, existing);
});

console.log('Done.');
