#!/usr/bin/env node

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sectionFor } from '../scripts/generate-brief-metric-digest-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
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

console.log('Jurisdiction brief metric-digest sections');

test('suppressed housing-gap rates produce fallback prose instead of throwing', () => {
  const brief = readJson('data/jurisdiction-briefs/0818310.json');
  const digest = readJson('data/hna/jurisdiction-metrics-digest/0818310.json');
  const section = sectionFor(brief, digest);
  const text = section.paragraphs[0].text;

  assert.ok(text.includes('The deep-affordability gap rate is suppressed because only 14 <=30% AMI households are observed'));
  assert.ok(text.includes("below the digest's 50-household reporting floor."));
  assert.ok(text.includes('53.8% of renter households are cost burdened'));
});

test('available housing-gap rates still render the percent narrative', () => {
  const brief = readJson('data/jurisdiction-briefs/0870195.json');
  const digest = readJson('data/hna/jurisdiction-metrics-digest/0870195.json');
  const section = sectionFor(brief, digest);

  assert.ok(section.paragraphs[0].text.includes('equal to 81.7% of <=30% AMI households.'));
});
