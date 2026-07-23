#!/usr/bin/env node
// test/metric-trust-map-metadata.test.js
//
// Package C: guard map legend truthfulness and generated metadata provenance.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const opportunityFinderSrc = read('js/lihtc-opportunity-finder.js');
assert(
  opportunityFinderSrc.includes('Opportunity Zones (2018)') &&
    opportunityFinderSrc.includes('<strong>OZ tract</strong>'),
  'LIHTC Opportunity Finder legend includes an Opportunity Zone / OZ tract row'
);
assert(
  /lof-legend-sw[^']*background:#5eead4/.test(opportunityFinderSrc),
  'OZ legend row uses the teal #5eead4 swatch in a lof-legend context'
);

const properties = JSON.parse(read('data/affordable-housing/properties.json'));
const notes = (properties.metadata && Array.isArray(properties.metadata.notes))
  ? properties.metadata.notes.join(' ')
  : '';
assert(/dedupl?icat/i.test(notes), 'properties metadata describes deduplication');
assert(/\bname\b/i.test(notes) && /\bcity\b/i.test(notes), 'properties metadata names the name + city dedupe key');
assert(!notes.includes('keeps all records'), 'properties metadata no longer claims the build keeps all records');

const builderSrc = read('scripts/build-affordable-housing-properties.js');
assert(!builderSrc.includes('keeps all records'), 'properties builder no longer contains the stale keeps-all-records note');

console.log('metric-trust-map-metadata: PASS');
