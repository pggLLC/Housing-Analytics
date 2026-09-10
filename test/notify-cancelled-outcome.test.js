'use strict';

/**
 * A cancelled data workflow must open a tracking issue.
 *
 * `timeout-minutes` kills a hung job and GitHub records it as `cancelled`,
 * which renders grey rather than as a red X. Nothing alerts, and a scan for red
 * misses it: build-hna-data went 15 days with no completed scheduled run that
 * way (#1556) while every check stayed green.
 *
 * notify-workflow-outcome previously acted only on 'success' and 'failure',
 * documenting 'cancelled' as a deliberate no-op — so the one failure mode that
 * is invisible in the UI was also the one it stayed silent about.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ACTION = path.join(ROOT, '.github', 'actions', 'notify-workflow-outcome', 'action.yml');
const CALLER = path.join(ROOT, '.github', 'workflows', 'build-hna-data.yml');
const action = fs.readFileSync(ACTION, 'utf8');
const caller = fs.readFileSync(CALLER, 'utf8');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

console.log('[test] notify-workflow-outcome reacts to cancelled runs');

// The condition lines that gate issue-opening and Slack.
const conds = action
  .split('\n')
  .filter((l) => /^\s*if:\s*.*inputs\.outcome/.test(l))
  .map((l) => l.trim());

check(conds.length >= 3, 'the action still gates on inputs.outcome in 3 places (found ' + conds.length + ')');

const opensOnCancel = conds.filter((c) => /cancelled/.test(c) && /failure/.test(c));
check(opensOnCancel.length >= 2,
  "'cancelled' is handled alongside 'failure' for both the issue and Slack (found " + opensOnCancel.length + ')');

// Recovery must stay success-only — a cancelled run must NOT close the issue.
const recovery = conds.find((c) => /success/.test(c) && /steps\.find/.test(c));
check(!!recovery, 'a success-gated recovery condition still exists');
check(!!recovery && !/cancelled/.test(recovery),
  'a cancelled run does NOT close the tracking issue — only a green run does');

// 'skipped' must remain a no-op; a skipped job is not an outage.
check(!/inputs\.outcome\s*==\s*'skipped'/.test(action),
  "'skipped' is still a no-op");

// The stale contract must not survive in the docs.
check(!/other values \(cancelled, skipped\) are no-ops/.test(action),
  'the old "cancelled is a no-op" contract is gone from the description');
// Match on the collapsed text so a line wrap in the YAML cannot break this.
const flat = action.replace(/\s+/g, ' ');
check(/cancel/i.test(flat.split('inputs:')[0]),
  'the top-level description says the action reacts to cancellation');
check(/acts on 'success', 'failure' and 'cancelled'/.test(flat),
  'the outcome input documents the three outcomes it acts on');

// Triage needs to know which outcome fired.
check(/\*\*Outcome\*\*/.test(action), 'the issue body reports the outcome that triggered it');
check(/timeout-minutes/.test(action),
  'the issue body tells triage to compare duration against timeout-minutes before assuming a human cancelled it');

// The step only runs on cancellation if the caller uses always().
const callSite = caller.slice(Math.max(0, caller.indexOf('notify-workflow-outcome') - 400),
                              caller.indexOf('notify-workflow-outcome'));
check(/if:\s*always\(\)/.test(callSite),
  'build-hna-data invokes the action with if: always(), so it runs on cancellation');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
