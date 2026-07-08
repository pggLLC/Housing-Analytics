#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SCORE_FACTORS,
  EXPECTED_SCORE_TARGETS,
  extractOpportunityFinderConfig,
} from '../scripts/audit/verify-opportunity-finder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'js/lihtc-opportunity-finder.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const config = extractOpportunityFinderConfig(source);

assert.deepEqual(Object.keys(config.scoreWeights).sort(), EXPECTED_SCORE_TARGETS.slice().sort(), 'verifier should extract all production score targets');
for (const target of EXPECTED_SCORE_TARGETS) {
  assert.deepEqual(Object.keys(config.scoreWeights[target]).sort(), EXPECTED_SCORE_FACTORS.slice().sort(), `${target} should have all score factors`);
  const sum = EXPECTED_SCORE_FACTORS.reduce((acc, factor) => acc + config.scoreWeights[target][factor], 0);
  assert(Math.abs(sum - 1.0) < 1e-9, `${target} weights should sum to 1.0; got ${sum}`);
}

assert.deepEqual(config.scoreWeights['4pct'], {
  need: 0.30,
  recency: 0.17,
  basis: 0.15,
  pop: 0.20,
  civic: 0.18,
}, '4pct verifier weights should come from the F254b production row');
assert.equal(config.cdpPenalty, -8, 'verifier should extract production CDP penalty');
assert.deepEqual(config.cdpPenaltyTargets.sort(), ['4pct', '9pct', 'any', 'workforce_resort'].sort(), 'verifier should extract production CDP penalty targets');

const mutatedSource = source.replace(
  "'4pct':              { need: 0.30, recency: 0.17, basis: 0.15, pop: 0.20, civic: 0.18 }",
  "'4pct':              { need: 0.31, recency: 0.16, basis: 0.15, pop: 0.20, civic: 0.18 }",
);
assert.notEqual(mutatedSource, source, 'mutation fixture should alter the production source string');
const mutatedConfig = extractOpportunityFinderConfig(mutatedSource);
assert.equal(mutatedConfig.scoreWeights['4pct'].need, 0.31, 'extractor should observe a production-source weight edit');
assert.notDeepEqual(mutatedConfig.scoreWeights['4pct'], config.scoreWeights['4pct'], 'guard should catch production/verifier weight drift');

console.log('opportunity-finder-verifier-source: ok');
