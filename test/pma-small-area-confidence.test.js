#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const confidence = read('js/pma-confidence.js');
assert(confidence.includes('effectiveBufferTracts'), 'confidence compute accepts effectiveBufferTracts');
assert(
  /scoreBufferDepth\(\s*[\s\S]{0,80}effectiveBufferTracts/.test(confidence),
  'scoreBufferDepth is fed effectiveBufferTracts when available'
);
assert(confidence.includes('Buffer coverage:'), 'confidence tooltip labels the factor as Buffer coverage');
assert(!confidence.includes('Buffer depth:'), 'confidence tooltip no longer labels the factor as Buffer depth');

const market = read('js/market-analysis.js');
assert(market.includes('effectiveBufferTracts'), 'market analysis passes effectiveBufferTracts to confidence');
assert(
  /_effectiveBufferTracts\s*=\s*bufTracts\.reduce\([\s\S]{0,220}_bufferShare/.test(market),
  'market analysis computes effective tract coverage from _bufferShare'
);
assert(
  /CONF\.compute\(\{[\s\S]{0,320}effectiveBufferTracts\s*:/.test(market),
  'CONF.compute call includes effectiveBufferTracts parameter'
);
assert(
  /setSum\('pmaSumUnits'[\s\S]{0,120}≈[\s\S]{0,120}households/.test(market),
  'pmaSumUnits renders the household count with an approximate estimate marker'
);

const html = read('market-analysis.html');
assert(html.includes('Households in buffer (area-apportioned est.)'), 'PMA summary label names households as area-apportioned estimate');
assert(html.includes('area inside the buffer'), 'PMA summary label includes the area-apportionment disclosure');
assert(!html.includes('Housing units in buffer'), 'PMA summary no longer labels households as housing units');

console.log('pma-small-area-confidence: PASS');
