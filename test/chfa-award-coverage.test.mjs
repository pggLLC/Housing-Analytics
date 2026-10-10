// CHFA LIHTC freshness: "fetched this week" is not "current".
//
// On 2026-10-10 Historical Trends said Mesa County's most recent LIHTC
// allocation was 2024. The weekly fetch had run six days earlier; CHFA's own
// feed simply had no 2026 award yet, and the page ignored the 2026 Round One
// bridge file that did list one (Crawford Commons, Clifton). This pins:
//   1. every round bridge award carries the county its coordinates fall in,
//      by the same point-in-polygon the ranking index uses;
//   2. the daily freshness check measures the newest award the repo knows
//      (feed + bridges), not the fetch date, and goes stale without a new one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCountyIndex, countyForPoint } from '../scripts/lib/county-boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AWARDS_DIR = 'data/affordable-housing/chfa-awards';
const bridges = fs.readdirSync(path.join(ROOT, AWARDS_DIR)).filter((n) => n.endsWith('.json'));

test('every round bridge award carries the county its coordinates fall in', async () => {
  assert.ok(bridges.length > 0, 'no bridge files to check');
  const idx = await loadCountyIndex(ROOT);
  let checked = 0;
  for (const n of bridges) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, AWARDS_DIR, n), 'utf8'));
    for (const a of d.awards || []) {
      const fips = countyForPoint(idx, Number(a.lon), Number(a.lat));
      assert.ok(fips, `${n}: ${a.name} has no coordinates inside a Colorado county`);
      assert.equal(a.county_fips, fips, `${n}: ${a.name} county_fips disagrees with its coordinates`);
      assert.equal(a.county, idx.find((c) => c.geoid === fips).name.replace(/ County$/, ''), `${n}: ${a.name} county name`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'no bridge awards were checked');
});

function freshnessRows({ asOf, dropBridges = false }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chfa-fresh-'));
  for (const f of ['scripts/audit/data-freshness-check.mjs', 'js/data-source-inventory.js', 'data/chfa-lihtc.json']) {
    fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(cwd, f));
  }
  fs.mkdirSync(path.join(cwd, AWARDS_DIR), { recursive: true });
  if (!dropBridges) for (const n of bridges) fs.copyFileSync(path.join(ROOT, AWARDS_DIR, n), path.join(cwd, AWARDS_DIR, n));
  const r = spawnSync(process.execPath, ['scripts/audit/data-freshness-check.mjs', '--json', `--as-of=${asOf}`], { cwd, encoding: 'utf8' });
  fs.rmSync(cwd, { recursive: true, force: true });
  assert.ok(r.stdout, r.stderr || 'freshness check did not run');
  const rows = JSON.parse(r.stdout).results.filter((x) => x.file === 'data/chfa-lihtc.json');
  const coverage = rows.find((x) => x.label && /round bridge/.test(x.label));
  const feedLag = rows.find((x) => x.label && /own property feed/.test(x.label));
  const fetch = rows.find((x) => !x.label);
  assert.ok(coverage && feedLag && fetch, 'missing one of the three CHFA freshness rows');
  return { coverage, feedLag, fetch };
}

const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chfa-lihtc.json'), 'utf8'));
const newestFeed = feed.features.map((f) => f.properties.AwardDate).filter(Boolean).sort().pop();
const newestBridge = bridges.map((n) => JSON.parse(fs.readFileSync(path.join(ROOT, AWARDS_DIR, n), 'utf8')).metadata.announcement_date).sort().pop();
const day = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

test('award coverage is dated by the newest award in the feed or a bridge, not the fetch', () => {
  const newest = [newestFeed, newestBridge].sort().pop();
  const { coverage, feedLag, fetch } = freshnessRows({ asOf: day(newest, 10) });
  assert.equal(coverage.asOf.slice(0, 10), newest, 'coverage row reads the newest award date');
  assert.equal(coverage.stale, false);
  assert.equal(feedLag.asOf.slice(0, 10), newestFeed, 'feed-lag row reads the feed alone');
  assert.equal(feedLag.warnOnly, true, 'the feed lag is upstream: warn, do not block');
  assert.equal(fetch.source, 'fetchedAt', 'the fetch row still checks that the weekly fetch ran');
  assert.equal(freshnessRows({ asOf: day(newest, coverage.slaDays + 1) }).coverage.stale, true,
    'no award newer than the SLA anywhere must go stale');
});

test('without the bridge files, coverage falls back to the feed and goes stale with it', () => {
  if (!(newestBridge > newestFeed)) return; // feed has caught up; nothing bridged
  const asOf = day(newestBridge, 10);
  const withBridge = freshnessRows({ asOf });
  const without = freshnessRows({ asOf, dropBridges: true });
  assert.equal(without.coverage.asOf.slice(0, 10), newestFeed);
  assert.ok(without.coverage.ageDays > withBridge.coverage.ageDays, 'removing the bridge must age the coverage row');
});
