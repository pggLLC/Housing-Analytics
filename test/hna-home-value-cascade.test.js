#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const fruita = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/0828745.json'), 'utf8')).acsProfile;

assert.equal(fruita.median_home_value.source, 'zhvi', 'Fruita should use Zillow ZHVI as the display home value');
assert(fruita.median_home_value.value > fruita.DP04_0089E, 'Fruita ZHVI should be higher than stale ACS raw value');
assert(fruita.median_home_value.value > 450000 && fruita.median_home_value.value < 525000, 'Fruita ZHVI spot check should be around $486k');

const flags = cascade.review_flags && cascade.review_flags.zhvi_over_acs_ratio_gt_3 || [];
assert(flags.some((row) => row.geoid === '0803620' && row.ratio > 3), 'Aspen should be flagged as ZHVI/ACS > 3x');
assert.equal(cascade.meta.counts.total, 482, 'home-value cascade should cover all Colorado places in the public HNA set');

console.log('hna-home-value-cascade: ok');
