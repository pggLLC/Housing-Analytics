#!/usr/bin/env node
/**
 * workflow-outcome-monitor — guards for the external monitor (plan package 1C, P1).
 *
 * The defect this monitor exists to fix is #1619: scripts/monitoring/alert.js
 * warns and returns null when GITHUB_TOKEN is absent, fifteen workflows call it,
 * none supplies a token, and it has never opened an issue in this repository's
 * history. A notifier that reports success while doing nothing.
 *
 * So the first assertion here is that the replacement fails loudly instead.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'monitoring', 'workflow-outcome-monitor.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'workflow-outcome-monitor.yml');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\nworkflow-outcome-monitor');

const src = fs.readFileSync(SCRIPT, 'utf8');
const wf = fs.readFileSync(WORKFLOW, 'utf8');
const wfCode = wf.replace(/^\s*#.*$/gm, '');   // strip comments before matching

/* ── 1. missing token must exit nonzero, not warn-and-continue ─────────── */
{
  // This check was itself blind at first. It asserted "exits nonzero AND the
  // output mentions GITHUB_TOKEN" -- both of which a warn-and-continue also
  // satisfies, because it PRINTS the token name and then fails later for an
  // unrelated reason. It passed against a deliberately softened token check.
  //
  // So: supply every other input the script needs, leaving the missing token as
  // the ONLY possible cause of failure, and assert the distinctive failure —
  // not merely that something went wrong.
  const env = { ...process.env, GITHUB_REPOSITORY: 'owner/repo', MONITOR_CONCLUSION: 'success' };
  delete env.GITHUB_TOKEN; delete env.GH_TOKEN;

  let exited = 0, out = '';
  try {
    out = execFileSync(process.execPath, [SCRIPT], { env, stdio: 'pipe' }).toString();
  } catch (err) {
    exited = err.status;
    out = ((err.stdout || '') + (err.stderr || '')).toString();
  }

  if (exited === 0) {
    fail('running without GITHUB_TOKEN exited 0 — that is exactly the alert.js defect (#1619): '
       + 'a notifier that cannot authenticate must fail loudly, not skip silently');
  } else if (/skipping|continuing|ignor/i.test(out)) {
    fail(`the script warned and continued (${JSON.stringify(out.trim().slice(0, 90))}) rather than `
       + `failing on the missing token — alert.js's exact behaviour`);
  } else if (!/GITHUB_TOKEN is not set/.test(out)) {
    fail(`exited ${exited} but not with the missing-token error; got `
       + `${JSON.stringify(out.trim().slice(0, 90))}. With GITHUB_REPOSITORY supplied, the token `
       + `is the only thing that should stop it.`);
  } else if (/\[monitor\] repo=/.test(out)) {
    fail('the script reached its classification output despite the missing token — it continued '
       + 'past the check instead of stopping at it');
  } else {
    ok('no GITHUB_TOKEN → stops at the token check, exits nonzero, and does not continue');
  }

  // Positive control: with a token supplied it must NOT fail for that reason.
  const withTok = { ...process.env, GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'owner/repo', MONITOR_CONCLUSION: 'success' };
  try {
    const good = execFileSync(process.execPath, [SCRIPT], { env: withTok, stdio: 'pipe' }).toString();
    if (!/\[monitor\] repo=/.test(good)) fail('with a token present the script produced no classification output');
    else ok('token present → runs through and classifies');
  } catch (err) {
    fail(`with a token present the script still failed: ${((err.stdout||'')+(err.stderr||'')).toString().trim().slice(0,90)}`);
  }
}

/* ── 2. observation only: no dispatch capability ───────────────────────── */
{
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dispatchy = [
    /gh\s+workflow\s+run/,
    /workflow_dispatch/,
    /\/dispatches\b/,
    /createWorkflowDispatch/,
    /rerunWorkflow|\/rerun\b/,
    /cancelWorkflowRun|\/cancel\b/,
  ].filter((re) => re.test(codeOnly));
  if (dispatchy.length) {
    fail(`the monitor contains dispatch/re-run/cancel capability (${dispatchy.length} match(es)). `
       + `run-all-workflows dispatches children with gh workflow run, so a monitor that can `
       + `dispatch is one edit away from a loop. Observation only.`);
  } else {
    ok('observation only — no dispatch, re-run or cancel capability');
  }
}

/* ── 3. workflow_run must not be able to recurse ───────────────────────── */
{
  const listed = [...wfCode.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  if (!listed.length) {
    fail('could not parse the workflows: list — this guard would pass vacuously');
  } else {
    if (/workflows:\s*\n\s*-\s*["']?\*/.test(wfCode)) {
      fail('workflow_run uses a wildcard workflows list; enumerate them explicitly');
    }
    const selfName = (wf.match(/^name:\s*(.+)$/m) || [])[1];
    if (selfName && listed.includes(selfName.trim())) {
      fail(`the monitor lists itself ("${selfName.trim()}") in its own workflow_run trigger — `
         + `that is a recursion loop`);
    } else {
      ok(`workflow_run enumerates ${listed.length} workflow(s) explicitly and not itself`);
    }
  }
}

/* ── 4. P1 must not hold a permission it does not use ──────────────────── */
{
  if (/issues:\s*write/.test(wfCode)) {
    fail('P1 grants issues: write but opens nothing. Grant it in P4 alongside the first real alert.');
  } else {
    ok('no issues: write in P1 — the package opens nothing');
  }
  if (!/actions:\s*read/.test(wfCode)) {
    fail('the monitor needs actions: read to inspect run outcomes');
  }
}

/* ── 5. classification matches the conclusions GitHub actually emits ───── */
{
  const mod = require('node:module').createRequire(__filename);
  void mod;
  // Load the ESM module's pure functions through a dynamic import.
  return import(SCRIPT).then((m) => {
    const cases = [
      ['success',   m.OUTCOME.RECOVERED],
      ['failure',   m.OUTCOME.FAILED],
      ['cancelled', m.OUTCOME.STOPPED],
      ['skipped',   m.OUTCOME.IGNORED],
      [undefined,   m.OUTCOME.IGNORED],
    ];
    for (const [conclusion, expected] of cases) {
      const got = m.classify({ conclusion });
      if (got !== expected) fail(`classify(${JSON.stringify(conclusion)}) = ${got}, expected ${expected}`);
    }
    ok('classify() maps success/failure/cancelled/skipped as expected');

    // GitHub has never emitted timed_out or startup_failure in this repo; a
    // policy keyed on them would fire never. Assert the module does not pretend
    // otherwise.
    if (m.OBSERVED_CONCLUSIONS.includes('timed_out')) {
      fail('OBSERVED_CONCLUSIONS claims timed_out, which GitHub has never emitted here — '
         + 'timeouts surface as cancelled and must be inferred from duration');
    } else {
      ok('does not claim a timed_out conclusion GitHub never emits here');
    }

    // A cancelled run must NOT be silently treated as fine.
    if (m.classify({ conclusion: 'cancelled' }) === m.OUTCOME.IGNORED) {
      fail('cancelled is classified as ignored — that is how #1556 stayed invisible for 15 days');
    }

    if (failures) { console.error(`\nworkflow-outcome-monitor: FAIL (${failures})`); process.exit(1); }
    console.log('workflow-outcome-monitor: PASS');
  });
}
