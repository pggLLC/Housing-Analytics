#!/usr/bin/env node
/**
 * A percentile shown next to a rank must be the percentile OF that rank.
 *
 * ── What was wrong ──
 *
 * `percentileRank` was `pct_gap_count` — the percentile of
 * `housing_gap_units`, computed WITHIN geo type. `rank` is global and ordered
 * by `overall_need_score`. Two divergences at once: a different metric and a
 * different pool.
 *
 * Nothing in the output said so, and the surfaces present them as one claim:
 *
 *     hna-comparison.js      "#50 of 546 · 29.9th pctile"   one sentence
 *     hna-ranking-index.js   a bar labelled "Overall need intensity",
 *                            filled from the gap
 *
 * Telluride ranked 50 of 546 and showed 29.9. Foxfield ranked 52 and showed
 * 8.1. Craig ranked WORSE than Snowmass Village and showed a percentile four
 * times higher — the one pair where a reader could see the contradiction
 * without leaving the page.
 *
 * ── The rule ──
 *
 * Assert MONOTONICITY against rank, not a computed value. A place ranked
 * better than another must never show a lower percentile. That is exact even
 * where scores tie — tied geographies share a percentile but take distinct
 * ranks, so an equality check would fail on correct data, and a tolerance
 * would have to be picked. Monotonicity needs no tolerance and would have
 * caught the original defect on its first row.
 *
 * `gapPercentile` keeps the old meaning under a name that says which metric
 * it describes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/ranking-index.json'), 'utf8'));
const rows = index.rankings;

test('the scan has something to check', () => {
  assert.ok(rows.length > 500, `expected the full state, got ${rows.length}`);
  assert.ok(rows.every((r) => typeof r.rank === 'number'), 'every row needs a rank');
  assert.ok(rows.every((r) => typeof r.percentileRank === 'number'),
    'every row needs a percentileRank');
});

test('a better rank never shows a lower percentile', () => {
  // The whole defect, as one property. No tolerance, no recomputation.
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const inversions = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const better = sorted[i - 1];
    const worse = sorted[i];
    if (better.percentileRank < worse.percentileRank) {
      inversions.push(
        `${better.name} (rank ${better.rank}, ${better.percentileRank}th) ranks better than `
        + `${worse.name} (rank ${worse.rank}, ${worse.percentileRank}th) but shows a lower percentile`);
    }
  }
  assert.deepEqual(inversions.slice(0, 5), [],
    `${inversions.length} rank/percentile inversions — the percentile is not describing the rank`);
});

test('the endpoints line up', () => {
  const n = rows.length;
  const first = rows.find((r) => r.rank === 1);
  const last = rows.find((r) => r.rank === n);
  assert.ok(first && last, 'expected a rank 1 and a rank n');
  assert.ok(first.percentileRank >= 99.5,
    `the most-in-need geography shows ${first.percentileRank}th percentile`);
  assert.ok(last.percentileRank <= 0.5,
    `the least-in-need geography shows ${last.percentileRank}th percentile`);
});

test('gapPercentile is published and is genuinely a different measure', () => {
  const withBoth = rows.filter((r) => typeof r.gapPercentile === 'number');
  assert.ok(withBoth.length > 500, `only ${withBoth.length} rows carry gapPercentile`);
  // If these two were the same thing, the rename would have been cosmetic and
  // the original bug would still be live under a new name.
  const differing = withBoth.filter((r) => Math.abs(r.gapPercentile - r.percentileRank) > 5);
  assert.ok(differing.length > 100,
    `only ${differing.length} rows differ between gapPercentile and percentileRank — `
    + 'if they agree everywhere, one of them is not measuring what its name says');
});

test('both percentiles stay in range', () => {
  for (const r of rows) {
    for (const k of ['percentileRank', 'gapPercentile']) {
      const v = r[k];
      if (v === undefined || v === null) continue;
      assert.ok(v >= 0 && v <= 100, `${r.name}: ${k} is ${v}, outside 0-100`);
    }
  }
});

test('no surface pairs a rank with a percentile of something else', () => {
  // A source-level check, because the data can be right while a page picks
  // the wrong field. Any file that renders `rank` beside a percentile must
  // read percentileRank, not gapPercentile.
  const surfaces = ['js/hna/hna-comparison.js', 'js/hna/hna-ranking-index.js', 'developer-brief.html'];
  for (const rel of surfaces) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/pctile|percentile/i.test(line)) return;
      if (!/\brank\b/i.test(line)) return;
      assert.ok(!/gapPercentile/.test(line),
        `${rel}:${i + 1} renders a rank beside gapPercentile — that pairing is the original defect`);
    });
  }
});
