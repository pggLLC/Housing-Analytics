#!/usr/bin/env node
// test/hna-ami-chas-disclosure.test.js
//
// Issue #1180: disclosure-only guard for the ACS AMI demand headline vs.
// HUD CHAS tier-table count differences on the HNA page.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
const explainer = fs.readFileSync(path.join(ROOT, 'js', 'methodology-explainer.js'), 'utf8');

const SHARED_KEY = 'ami-chas-acs-difference';
const CHAS_NOTE = 'Counts here use HUD CHAS 2018–2022 with size-adjusted income limits (HAMFI); they run below the ACS-based demand headline, especially in student-heavy markets. See methodology.';
const ACS_NOTE = 'ACS 2020–2024 households under the unadjusted county 30% AMI cutoff; the CHAS tier table below uses HUD\'s size-adjusted limits and an older window, so its counts run lower. See methodology.';

assert(html.includes(CHAS_NOTE), 'CHAS AMI-tier panel must disclose why CHAS counts can run below ACS demand headline');
assert(html.includes(ACS_NOTE), 'ACS AMI demand headline must disclose why it can differ from the CHAS tier table');

const keyUses = html.match(new RegExp(`data-methodology-key="${SHARED_KEY}"`, 'g')) || [];
assert.equal(keyUses.length, 2, 'both disclosure notes must wire to the same shared methodology key');

assert(explainer.includes(`'${SHARED_KEY}'`), 'methodology explainer must define the shared ACS-vs-CHAS methodology entry');
for (const phrase of [
  'ACS 2020-2024 renter income brackets',
  'HUD CHAS 2018-2022 household counts',
  'household-size-adjusted income standard',
  'vintage, income standard, and estimation path'
]) {
  assert(explainer.includes(phrase), `shared methodology entry must explain: ${phrase}`);
}

console.log('HNA ACS-vs-CHAS AMI disclosure (#1180): PASS');
