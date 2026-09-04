'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'hmda-lookup.js'), 'utf8');
const context = { window: {}, fetch: function () {} };
vm.runInNewContext(source, context, { filename: 'js/hmda-lookup.js' });

const comparison = {
  county: {
    year: '2024',
    originations: 1234,
    denial_rate: 0.25,
    mean_loan_amount_usd: 350000,
    multifamily: { originations: 12 }
  },
  state: { denial_rate: 0.20 },
  delta: { denial_rate_pp: 5, mean_loan_pct: 16.7 }
};

const normal = context.window.HmdaLookup.formatCountyCallout(comparison, 'Mesa County');
assert.strictEqual(
  normal,
  '<strong>Mortgage credit (2024):</strong> Mesa County had 1,234 originations ' +
    'at a 25.0% denial rate (5.0pp higher than CO statewide 20.0%). ' +
    'Mean loan: $350,000 (17% higher than state). Multifamily originations: 12 (LIHTC-adjacent).',
  'normal HMDA callout renders byte-identically'
);

const hostileName = '<tag data-note="quoted">A & B</tag>';
const hostile = context.window.HmdaLookup.formatCountyCallout(comparison, hostileName);
assert(
  hostile.includes('&lt;tag data-note=&quot;quoted&quot;&gt;A &amp; B&lt;/tag&gt;'),
  'county name is escaped before entering the HTML fragment'
);
assert(!hostile.includes('<tag'), 'hostile county name does not become markup');
assert(
  hostile.startsWith('<strong>Mortgage credit (2024):</strong> '),
  'the helper preserves its intentional strong-element markup'
);

console.log('xss-hmda-lookup: PASS');
