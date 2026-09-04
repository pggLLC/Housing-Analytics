const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'economic-dashboard.html'), 'utf8');
const fredFetcher = fs.readFileSync(path.join(repoRoot, 'scripts/fetch_fred_data.py'), 'utf8');

assert.ok(
  html.includes('id:"COUR"'),
  'Economic dashboard should use the valid Colorado unemployment FRED series COUR.'
);

assert.ok(
  !html.includes('LAUST080000000000003'),
  'Economic dashboard should not reference the invalid LAUST Colorado unemployment series.'
);

assert.ok(
  fredFetcher.includes('"COUR": ("CO Unemployment Rate (Colorado, SA)", None)'),
  'FRED fetcher should request the valid COUR Colorado unemployment series.'
);

assert.ok(
  !fredFetcher.includes('LAUST080000000000003'),
  'FRED fetcher should not request the invalid LAUST Colorado unemployment series.'
);

console.log('Economic dashboard Colorado unemployment series guard passed.');
