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
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'monitoring', 'workflow-outcome-monitor.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'workflow-outcome-monitor.yml');
// Package 1B lives here rather than in its own npm script so that a single
// suite owns "CI reports states nobody verified". 1C covered workflow runs
// that finish in an unexamined state; 1B covers PRs that never produce a run
// at all, and gates that quietly stop blocking. Same defect, two surfaces.
const GATE = path.join(ROOT, 'scripts', 'monitoring', 'merge-ref-gate.mjs');
const GATE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'merge-ref-gate.yml');
const CI_CHECKS = path.join(ROOT, '.github', 'workflows', 'ci-checks.yml');

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
    // `workflow_dispatch` by itself is an event name and is now used to query
    // the latest eligible run. The dispatch REST path/call below is capability.
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

  if (!/^\s{4}branches:\s*\[main\]\s*$/m.test(wfCode)) {
    fail('workflow_run is not restricted to main — feature-branch dispatches could mutate production trackers');
  } else {
    ok('workflow_run observes completed runs from main only');
  }
}

/* ── 3b. a placeholder must not pretend to be a staleness monitor ──────── */
{
  if (/^\s{2}schedule:\s*$/m.test(wfCode)) {
    fail('the monitor is scheduled even though staleness mode queries no runs — a green placeholder '
       + 'would falsely imply silent workflows were checked');
  } else if (!/staleness alerting is not active/.test(src)) {
    fail('manual staleness mode does not disclose that it performs no check');
  } else {
    ok('unfinished staleness detection is manual-only and explicitly reports that it is inactive');
  }
}

/* ── 4. P1 must not hold a permission it does not use ──────────────────── */
{
  // P1-P3 held no write permission because they opened nothing. P4 grants
  // issues: write alongside the first workflow this monitor actually alerts for.
  // The invariant is not "never hold it" — it is "hold it only while something
  // is being alerted for", so an unused write permission cannot linger.
  const watched = [...wfCode.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const alertsForSomething = watched.length > 1;   // beyond the P1 observation-only target
  if (/issues:\s*write/.test(wfCode)) {
    if (!alertsForSomething) {
      fail('the monitor grants issues: write but watches only its original observation-only '
         + 'target — a write permission with nothing to write about should not be held');
    } else {
      ok(`issues: write is held, and ${watched.length} workflows are watched for alerting`);
    }
  } else if (alertsForSomething) {
    fail('the monitor watches workflows for alerting but has no issues: write — it cannot open '
       + 'or close a tracker, which is the alert.js defect (#1619) in a new place');
  }
  if (!/actions:\s*read/.test(wfCode)) {
    fail('the monitor needs actions: read to inspect run outcomes');
  }
}

/* ── 4b. a watched workflow must NOT also notify in-job ────────────────── */
{
  // The single biggest risk in this migration: a workflow on the monitor's
  // watch list that ALSO still carries its own notifier alerts twice for one
  // failure. Every package migrates a workflow by removing its in-job step in
  // the same commit that adds it here — this asserts nobody undoes half of that.
  const watched = [...wfCode.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const wfDir = path.join(ROOT, '.github', 'workflows');

  // Map display name -> file, so the watch list (which uses `name:`) can be
  // resolved to the workflow it refers to.
  const byName = {};
  for (const f of fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
    const src = fs.readFileSync(path.join(wfDir, f), 'utf8');
    const nm = (src.match(/^name:\s*(.+)$/m) || [])[1];
    if (nm) byName[nm.trim()] = { file: f, src };
  }

  let unresolved = 0;
  for (const name of watched) {
    const hit = byName[name];
    if (!hit) { unresolved++; continue; }
    if (hit.file === 'workflow-outcome-monitor.yml') continue;
    const code = hit.src.replace(/^\s*#.*$/gm, '');
    if (/notify-workflow-outcome/.test(code)) {
      fail(`${hit.file} is watched by the monitor AND still uses notify-workflow-outcome in-job — `
         + `one failure would alert twice. Remove the in-job step in the same change that adds `
         + `the workflow to the watch list.`);
    }
    if (/monitoring\/alert/.test(code)) {
      fail(`${hit.file} is watched by the monitor AND still calls scripts/monitoring/alert.js. `
         + `alert.js never fires (no token), so this is not currently a double alert — but it `
         + `becomes one the moment alert.js is repaired. Remove it with the migration.`);
    }
  }
  if (unresolved === watched.length) {
    fail('none of the watched workflow names resolved to a file — the name-matching has drifted '
       + 'and this guard would pass vacuously');
  } else {
    ok(`all ${watched.length - unresolved} watched workflow(s) have no in-job notifier`);
  }
}

/* ── 4d. push-triggered runs must not alert ────────────────────────────── */
{
  // contrast-audit runs on every push as well as on a schedule. A tracker
  // opened per failing push is the noise that gets a monitor muted, and a muted
  // monitor is indistinguishable from the alert.js situation this replaced.
  //
  // The gate is asserted only when it is actually needed — if no watched
  // workflow has a push trigger, requiring it would be cargo cult.
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const byName = {};
  for (const f of fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
    const src2 = fs.readFileSync(path.join(wfDir, f), 'utf8');
    const nm = (src2.match(/^name:\s*(.+)$/m) || [])[1];
    if (nm) byName[nm.trim()] = src2;
  }
  const watched = [...wfCode.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const pushTriggered = watched.filter((n) => byName[n] && /^\s*push:/m.test(byName[n].replace(/^\s*#.*$/gm, '')));

  if (pushTriggered.length) {
    const gated = /workflow_run\.event\s*==\s*'schedule'/.test(wfCode)
               && /workflow_run\.event\s*==\s*'workflow_dispatch'/.test(wfCode);
    if (!gated) {
      fail(`${pushTriggered.length} watched workflow(s) also run on push (${pushTriggered.join(', ')}), `
         + `but the monitor does not restrict itself to schedule/workflow_dispatch runs. It would `
         + `open a tracker for every failing push — which is how a monitor gets muted.`);
    } else {
      ok(`push-triggered workflow(s) watched (${pushTriggered.length}), and only scheduled/dispatched runs alert`);
    }
  }
}

/* ── 4c. alert.js is retired and must not return ───────────────────────── */
{
  // scripts/monitoring/alert.js opened a GitHub issue only when GITHUB_TOKEN was
  // in the environment. Fifteen workflows called it, none supplied one, and it
  // never opened a single issue in this repository's history — the environment
  // was never going to have it, because actions/github-script exposes a token on
  // its client object rather than exporting one.
  //
  // It is deleted. A notifier that reports success while doing nothing is worse
  // than no notifier, because it occupies the slot where a real one would go.
  if (fs.existsSync(path.join(ROOT, 'scripts', 'monitoring', 'alert.js'))) {
    fail('scripts/monitoring/alert.js is back. It cannot authenticate from inside '
       + 'actions/github-script and never opened an issue in fifteen workflows over months. '
       + 'Failures are reported by .github/workflows/workflow-outcome-monitor.yml.');
  } else {
    ok('scripts/monitoring/alert.js stays retired');
  }

  // And no workflow may call it, whether or not the file exists.
  const wfDir = path.join(ROOT, '.github', 'workflows');
  const callers = [];
  for (const f of fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
    const code = fs.readFileSync(path.join(wfDir, f), 'utf8').replace(/^\s*#.*$/gm, '');
    if (/monitoring\/alert/.test(code)) callers.push(f);
  }
  if (callers.length) {
    fail(`${callers.length} workflow(s) still call alert.js (${callers.join(', ')}) — it is deleted, `
       + `so the step would fail at runtime, and it never worked when it existed`);
  } else {
    ok('no workflow calls alert.js');
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
      // cancelled with NO step information: cause undeterminable, so STOPPED
      // rather than never_ran. never_ran means "verified benign"; claiming it
      // without evidence would suppress a real outage.
      ['cancelled', m.OUTCOME.STOPPED],
      ['skipped',   m.OUTCOME.IGNORED],
      [undefined,   m.OUTCOME.IGNORED],
    ];
    for (const [conclusion, expected] of cases) {
      const got = m.classify({ conclusion });
      if (got !== expected) fail(`classify(${JSON.stringify(conclusion)}) = ${got}, expected ${expected}`);
    }
    ok('classify() maps success/failure/cancelled/skipped as expected');

    if (m.classify({ conclusion: 'cancelled', stepsRun: 0 }, 120) !== m.OUTCOME.NEVER_RAN) {
      fail('a cancelled run with a KNOWN zero step count should be never_ran (queue eviction)');
    }
    if (m.classify({ conclusion: 'cancelled' }, 120) === m.OUTCOME.NEVER_RAN) {
      fail('a cancelled run with UNKNOWN step count is being reported as never_ran — that asserts '
         + 'benign without evidence and would silently swallow a real outage');
    }
    ok('unknown step count is distinguished from a known zero');

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

    /* ── P2: timeout inference, calibrated on REAL cancelled runs ─────── */
    const fx = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'test', 'fixtures', 'workflow-cancelled-runs.json'), 'utf8'));

    if (fx.runs.length < 10) {
      fail(`only ${fx.runs.length} cancelled-run fixtures — these are every cancelled run this `
         + `repo has produced; a shrinking set means the calibration data was trimmed`);
    }

    const mk = (r) => ({
      conclusion: 'cancelled',
      stepsRun: r.stepsRun,
      run_started_at: new Date(0).toISOString(),
      updated_at: new Date(r.durationMinutes * 60000).toISOString(),
    });

    let wrong = 0;
    for (const r of fx.runs) {
      const got = m.classify(mk(r), r.ceilingMinutes);
      if (got !== r.expect) {
        fail(`${r.workflow} ${r.durationMinutes}m/${r.ceilingMinutes}m steps=${r.stepsRun} → `
           + `${got}, expected ${r.expect} (${r.why})`);
        wrong++;
      }
    }
    if (!wrong) ok(`all ${fx.runs.length} real cancelled runs classify correctly`);

    const alerts = fx.runs.filter((r) => m.shouldAlert(m.classify(mk(r), r.ceilingMinutes)));
    if (alerts.length !== 5) {
      fail(`${alerts.length} of ${fx.runs.length} fixtures would alert; expected exactly the 5 `
         + `genuine timeouts. Alerting on more means noise; on fewer means a missed outage.`);
    } else {
      ok('exactly the 5 genuine timeouts would alert; the other 5 stay silent');
    }

    // The specific case that breaks duration-only inference. Guarded by name so
    // nobody "simplifies" the rule back to a single factor.
    const brief = fx.runs.find((r) => r.workflow === 'weekly_housing_brief');
    if (!brief) {
      fail('the weekly_housing_brief fixture is missing — it is the only run that exceeds its '
         + 'ceiling while executing nothing, and it is what proves duration alone is insufficient');
    } else {
      if (!(brief.durationMinutes > brief.ceilingMinutes && brief.stepsRun === 0)) {
        fail('the weekly_housing_brief fixture no longer has the property it exists to test '
           + '(over ceiling, zero steps)');
      }
      if (m.classify(mk(brief), brief.ceilingMinutes) === m.OUTCOME.TIMED_OUT) {
        fail('a run that exceeded its ceiling WITHOUT executing a step is classified as a timeout — '
           + 'that is duration-only inference and it alerts falsely on queue evictions');
      } else {
        ok('a run over its ceiling with zero steps is not called a timeout');
      }
    }

    // A run that genuinely worked and died at the ceiling must still alert.
    if (!m.shouldAlert(m.classify({ conclusion: 'cancelled', stepsRun: 9,
        run_started_at: new Date(0).toISOString(),
        updated_at: new Date(120 * 60000).toISOString() }, 120))) {
      fail('a run that executed steps and died at its ceiling does not alert — that is #1556');
    }

    /* ── P3: staleness, judged against each workflow's own cadence ────── */

    const cadences = [
      ['hourly',    '35 * * * *',    1],
      ['every 2h',  '15 */2 * * *',  2],
      ['every 6h',  '17 */6 * * *',  6],
      ['daily',     '23 6 * * *',   24],
      ['weekly',    '23 7 * * 6',  168],
      ['monthly',   '47 4 1 * *',  720],
      ['quarterly', '41 7 1 */3 *', 2160],
      ['annual',    '29 7 15 10 *', 8760],
    ];
    let cadenceBad = 0;
    for (const [label, expr, want] of cadences) {
      const got = m.cronIntervalHours(expr);
      if (got !== want) { fail(`cronIntervalHours(${expr}) [${label}] = ${got}, expected ${want}`); cadenceBad++; }
    }
    if (!cadenceBad) ok(`cron cadence derived for all ${cadences.length} shapes this repo declares`);

    // THE FOUNDING CASE. #1556 was build-hna-data — a WEEKLY workflow — silent
    // for fifteen days, found by hand. An earlier tolerance of 2.5x gave weekly
    // jobs 17.5 days of slack, so this rule would have stayed quiet through the
    // exact outage it exists for. Guarded by name and number so it cannot be
    // loosened back without the test objecting.
    const sinceFifteenDays = m.assessStaleness({ cron: '23 7 * * 6', hoursSinceLastCompletedRun: 15 * 24 });
    if (!sinceFifteenDays) {
      fail('a WEEKLY workflow silent for 15 days is not called stale — that is #1556 exactly, '
         + `and STALENESS_TOLERANCE (${m.STALENESS_TOLERANCE}) is too loose to catch it`);
    } else {
      ok('#1556 reproduced: weekly workflow silent 15 days is flagged stale');
    }

    // Scheduler jitter must not alert. GitHub delays scheduled runs under load
    // and hourly crons feel it most; the first live run of this rule flagged
    // pages-deploy-watchdog after ~4 hours, which is normal.
    if (m.assessStaleness({ cron: '35 * * * *', hoursSinceLastCompletedRun: 4 })) {
      fail('an hourly workflow silent for 4 hours is called stale — that is scheduler jitter, '
         + `and STALENESS_FLOOR_HOURS (${m.STALENESS_FLOOR_HOURS}) is not protecting against it`);
    } else {
      ok('hourly workflow silent 4 hours stays quiet (scheduler jitter)');
    }

    // Infrequent workflows must not be permanently stale. The quarterly
    // backfills have been silent 75 days by design.
    if (m.assessStaleness({ cron: '41 7 1 */3 *', hoursSinceLastCompletedRun: 75 * 24 })) {
      fail('a quarterly workflow silent 75 days is called stale — a fixed threshold would flag '
         + 'every infrequent job in the repo, which is how a monitor gets muted');
    } else {
      ok('quarterly workflow silent 75 days stays quiet (within its cadence)');
    }

    // Unknown last-run time must not be asserted either way.
    if (m.assessStaleness({ cron: '23 6 * * *', hoursSinceLastCompletedRun: null })) {
      fail('an unknown last-run time is being reported as stale — unknown is not evidence');
    }

  }).then(() => import(GATE)).then(async (g) => {

    /* ── 6. the merge-ref gate (1B) ───────────────────────────────────── */

    // `mergeable: null` is GitHub still computing. It is neither state, and
    // collapsing it either way breaks the gate: called mergeable, a real
    // conflict gets a green status; called conflicting, every freshly opened
    // PR fails for a few seconds.
    if (g.classifyMergeability({ mergeable: null }) !== g.MERGEABILITY.UNKNOWN) {
      fail('an uncomputed mergeable flag is being classified as a definite state');
    } else {
      ok('uncomputed mergeability stays unknown, not assumed');
    }
    if (g.decideStatus(g.MERGEABILITY.UNKNOWN) !== null) {
      fail('an unknown mergeability posts a status — success there is the unearned '
         + 'green this gate exists to prevent');
    } else {
      ok('unknown mergeability posts no status at all');
    }
    if (g.classifyMergeability({ mergeable: false }) !== g.MERGEABILITY.CONFLICTING) {
      fail('a conflicting PR is not classified as conflicting');
    } else {
      ok('a conflicting PR is classified as conflicting');
    }
    const st = g.decideStatus(g.MERGEABILITY.CONFLICTING);
    if (!st || st.state !== 'failure') {
      fail('a conflicting PR does not produce a failure status — it would still look ready');
    } else {
      ok('a conflicting PR produces a failure commit status');
    }

    // A PR with no head SHA has nothing to attach a status to; it must be
    // dropped rather than crashing the whole pass and leaving every other
    // PR unstatused.
    const planned = g.planStatuses([
      { number: 1, mergeable: false, head: { sha: 'aaa' } },
      { number: 2, mergeable: null,  head: { sha: 'bbb' } },
      { number: 3, mergeable: true,  head: null }
    ]);
    if (planned.length !== 1 || planned[0].number !== 1) {
      fail(`planStatuses returned ${JSON.stringify(planned.map((x) => x.number))}; `
         + 'expected only the conflicting PR that has a head SHA');
    } else {
      ok('planStatuses skips uncomputed PRs and PRs with no head SHA');
    }

    /* ── 7. blocking gates must stay blocking ─────────────────────────── */

    const gateWf = fs.readFileSync(GATE_WORKFLOW, 'utf8');
    // A pull_request trigger here would be self-defeating: a conflicting PR
    // produces no merge ref, so pull_request workflows never fire on it.
    if (/^on:[\s\S]*?\n\s{2}pull_request:/m.test(gateWf)) {
      fail('merge-ref-gate.yml triggers on pull_request — the very event a conflicting '
         + 'PR cannot produce, so the gate would never run on the PRs it targets');
    } else {
      ok('merge-ref gate runs outside pull_request, where it can actually observe conflicts');
    }
    if (!/statuses:\s*write/.test(gateWf)) {
      fail('merge-ref-gate.yml lacks statuses: write — it cannot post the status it exists to post');
    } else {
      ok('merge-ref gate has permission to write commit statuses');
    }

    // The schema gate was advisory for a long time. The backlog it was
    // waiting on is empty, so it is blocking now; this keeps it that way.
    const ciWf = fs.readFileSync(CI_CHECKS, 'utf8');
    const schemaStepRaw = ciWf.match(/- name: Validate JSON schemas[\s\S]*?(?=\n      - name: )/);
    // Strip comment lines before matching. The step's own comment explains
    // why pipefail is load-bearing, and matching the raw text let that prose
    // satisfy the check — the guard passed while the actual shell line was
    // gone. Same mistake the rest of this suite exists to catch.
    const schemaStep = schemaStepRaw ? [schemaStepRaw[0].replace(/^\s*#.*$/gm, '')] : null;
    if (!schemaStep) {
      fail('could not locate the schema validation step in ci-checks.yml');
    } else {
      if (/continue-on-error:\s*true/.test(schemaStep[0])) {
        fail('schema validation is continue-on-error again — an invalid schema can be '
           + 'published while the run still shows green');
      } else {
        ok('schema validation is blocking');
      }
      // Without pipefail the recorded status is tee's, which is always 0.
      if (!/set -o pipefail/.test(schemaStep[0])) {
        fail('the schema step pipes into tee without `set -o pipefail`, so a validator '
           + 'failure is masked by tee exiting 0');
      } else {
        ok('the schema step propagates the validator exit code through the pipe');
      }
    }

    /* ── P4: the monitor actually opens and closes trackers ──────────────── */
    {
      const M = await import(`file://${SCRIPT}`);

      // The marker is the contract with the EIGHT trackers that already exist
      // (#1627, #1613, #1566, #1425, #1371, #1035, #937, #914). Derived from the
      // workflow FILE's basename, because the display name differs: the issues
      // read [workflow-fail:build-hna-data] while the name is "Build HNA Data
      // Cache". Get this wrong and the monitor opens a parallel history beside
      // the real one instead of adopting it.
      const realTitle = '⚠️ [workflow-fail:build-hna-data] build-hna-data workflow failing';
      if (M.trackerTitle('build-hna-data') !== realTitle) {
        fail(`tracker title drifted from the existing issues.\n  ours: ${M.trackerTitle('build-hna-data')}\n  real: ${realTitle}`);
      } else {
        ok('tracker title is byte-identical to the trackers already in this repo');
      }

      if (M.workflowIdFromPath('.github/workflows/build-hna-data.yml') !== 'build-hna-data'
          || M.workflowIdFromPath('.github/workflows/x.yaml') !== 'x'
          || M.workflowIdFromPath(null) !== null
          || M.workflowIdFromPath('') !== null) {
        fail('workflowIdFromPath must yield the basename, and null when there is no path');
      } else {
        ok('the workflow id comes from the file path, and is null when unknown');
      }

      // A human renaming the issue must not orphan the tracker, and a CLOSED
      // one must not suppress a new alert.
      const issues = [
        { number: 1, state: 'closed', title: realTitle, user: { login: 'github-actions[bot]' } },
        { number: 2, state: 'open', title: 'unrelated', user: { login: 'github-actions[bot]' } },
        { number: 3, state: 'open', title: '⚠️ [workflow-fail:build-hna-data] renamed by a human',
          user: { login: 'github-actions[bot]' } },
      ];
      const found = M.findTracker(issues, 'build-hna-data');
      if (!found || found.number !== 3) {
        fail(`findTracker must match the open issue on its MARKER, not its title; got ${JSON.stringify(found)}`);
      } else if (M.findTracker(issues, 'fetch-fred-data') !== null) {
        fail("findTracker matched another workflow's tracker");
      } else {
        ok('an open tracker is found by marker, renamed or not, and never another workflow\'s');
      }

      // GET /issues returns PULL REQUESTS too — 12 items for 9 open issues on
      // this repo. A PR fixing a tracker tends to quote its title, so without
      // this filter the monitor would comment on and close that PR.
      const withPr = [
        { number: 7, state: 'open', title: realTitle, pull_request: { url: 'x' },
          user: { login: 'github-actions[bot]' } },
        { number: 8, state: 'open', title: realTitle, user: { login: 'github-actions[bot]' } },
      ];
      const picked = M.findTracker(withPr, 'build-hna-data');
      if (!picked || picked.number !== 8) {
        fail(`findTracker matched a pull request (${JSON.stringify(picked)}); `
           + 'GET /issues includes PRs, and closing one as a tracker would be wrong');
      } else {
        ok('a pull request carrying the marker is never mistaken for the tracker');
      }

      // The marker is public and predictable. A user-created issue with that
      // title must not be adopted, commented on, or auto-closed.
      const spoofed = [
        { number: 41, state: 'open', title: realTitle, user: { login: 'outside-user' } },
        { number: 42, state: 'open', title: realTitle, user: { login: 'github-actions[bot]' } },
      ];
      const trusted = M.findTracker(spoofed, 'build-hna-data');
      if (!trusted || trusted.number !== 42) {
        fail(`findTracker adopted an untrusted marker issue (${JSON.stringify(trusted)})`);
      } else if (M.findTracker(spoofed.slice(0, 1), 'build-hna-data') !== null) {
        fail('findTracker trusts a user-created look-alike tracker');
      } else {
        ok('only a tracker authored by github-actions[bot] is trusted');
      }

      // One per_page=100 request looks fine at 9 open issues and breaks silently
      // past 100: the tracker lands on page 2, findTracker returns null, and
      // every failure opens ANOTHER tracker while the monitor looks healthy.
      {
        const pages = [
          Array.from({ length: 100 }, (_, i) => ({ number: i + 1, state: 'open', title: 'filler' })),
          [{ number: 999, state: 'open', title: realTitle,
            user: { login: 'github-actions[bot]' } }],
        ];
        let seen = 0;
        const fakeFetch = async (url) => {
          const page = Number(new URL(url).searchParams.get('page')) || 1;
          seen = Math.max(seen, page);
          const body = pages[page - 1] || [];
          return { ok: true, status: 200, text: async () => JSON.stringify(body) };
        };
        const all = await M.listOpenIssues('o/r', { token: 't', fetchImpl: fakeFetch });
        const found = M.findTracker(all, 'build-hna-data');
        if (seen < 2) {
          fail('listOpenIssues stopped after one page — a tracker past the first 100 open '
             + 'issues would be invisible and every failure would open a duplicate');
        } else if (!found || found.number !== 999) {
          fail(`a tracker on page 2 was not found (${JSON.stringify(found)})`);
        } else {
          ok('open issues are paginated, so a tracker past the first 100 is still found');
        }
      }

      /* GitHub REST errors: retry reads, never blindly replay ambiguous writes. */
      {
        const response = (status, payload, headers = {}) => ({
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
          text: async () => JSON.stringify(payload),
        });

        let getCalls = 0;
        const getSleeps = [];
        const got = await M.ghRequest('/read-retry', {
          token: 't',
          fetchImpl: async () => {
            getCalls++;
            return getCalls < 3
              ? response(500, { message: 'temporary' })
              : response(200, { ok: true });
          },
          sleepImpl: async (ms) => { getSleeps.push(ms); },
        });
        if (!got || !got.ok || getCalls !== 3 || getSleeps.join(',') !== '1000,2000') {
          fail(`GET 5xx retry policy drifted: calls=${getCalls} sleeps=${getSleeps.join(',')}`);
        } else {
          ok('GET 5xx responses retry with a bounded backoff and then succeed');
        }

        let limitedCalls = 0;
        const limitedSleeps = [];
        await M.ghRequest('/rate-limit', {
          token: 't',
          fetchImpl: async () => {
            limitedCalls++;
            return limitedCalls === 1
              ? response(429, { message: 'rate limited' }, { 'retry-after': '2' })
              : response(200, { ok: true });
          },
          sleepImpl: async (ms) => { limitedSleeps.push(ms); },
        });
        if (limitedCalls !== 2 || limitedSleeps.join(',') !== '2000') {
          fail(`429 Retry-After was not honored: calls=${limitedCalls} sleeps=${limitedSleeps.join(',')}`);
        } else {
          ok('429 honors Retry-After before one bounded retry');
        }

        let primaryLimitCalls = 0;
        const primaryLimitSleeps = [];
        await M.ghRequest('/primary-rate-limit', {
          token: 't',
          fetchImpl: async () => {
            primaryLimitCalls++;
            return primaryLimitCalls === 1
              ? response(403, { message: 'API rate limit exceeded' }, {
                  'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '12' })
              : response(200, { ok: true });
          },
          nowImpl: () => 10000,
          sleepImpl: async (ms) => { primaryLimitSleeps.push(ms); },
        });
        if (primaryLimitCalls !== 2 || primaryLimitSleeps.join(',') !== '3000') {
          fail(`403 rate-limit reset was not honored: calls=${primaryLimitCalls} sleeps=${primaryLimitSleeps.join(',')}`);
        } else {
          ok('403 primary-rate limit honors the reset time before retrying');
        }

        let networkCalls = 0;
        const networkSleeps = [];
        const networkRead = await M.ghRequest('/network-read', {
          token: 't',
          fetchImpl: async () => {
            networkCalls++;
            if (networkCalls < 3) throw new Error('socket closed');
            return response(200, { ok: true });
          },
          sleepImpl: async (ms) => { networkSleeps.push(ms); },
        });
        if (!networkRead.ok || networkCalls !== 3 || networkSleeps.join(',') !== '1000,2000') {
          fail(`GET network failures did not retry safely: calls=${networkCalls} sleeps=${networkSleeps.join(',')}`);
        } else {
          ok('GET network failures retry safely within the bounded budget');
        }

        let writeCalls = 0;
        let writeRejected = false;
        try {
          await M.ghRequest('/write-ambiguous', {
            token: 't', method: 'POST', body: { x: 1 },
            fetchImpl: async () => { writeCalls++; return response(500, { message: 'server error' }); },
            sleepImpl: async () => { throw new Error('a mutation must not sleep for blind retry'); },
          });
        } catch (err) {
          writeRejected = err instanceof M.GitHubApiError && err.status === 500;
        }
        if (!writeRejected || writeCalls !== 1) {
          fail(`a POST 5xx was retried or did not fail loudly (calls=${writeCalls})`);
        } else {
          ok('a mutation 5xx fails once; its ambiguous outcome is never blindly replayed');
        }

        let networkWriteCalls = 0;
        try {
          await M.ghRequest('/write-network', {
            token: 't', method: 'PATCH', body: { state: 'closed' },
            fetchImpl: async () => { networkWriteCalls++; throw new Error('connection reset'); },
            sleepImpl: async () => { throw new Error('an ambiguous mutation must not retry'); },
          });
          fail('a mutation network failure returned as success');
        } catch (err) {
          if (!(err instanceof M.GitHubApiError) || networkWriteCalls !== 1
              || !/write outcome unknown/.test(err.message)) {
            fail(`a mutation network failure was retried or hidden (calls=${networkWriteCalls})`);
          } else {
            ok('a mutation network failure is surfaced once as an unknown write outcome');
          }
        }

        let forbiddenCalls = 0;
        try {
          await M.ghRequest('/forbidden', {
            token: 't',
            fetchImpl: async () => { forbiddenCalls++; return response(403, { message: 'forbidden' }); },
            sleepImpl: async () => { throw new Error('permanent 403 must not retry'); },
          });
          fail('a permanent 403 returned as success');
        } catch (err) {
          if (!(err instanceof M.GitHubApiError) || forbiddenCalls !== 1) {
            fail(`a permanent 403 was retried or misclassified (calls=${forbiddenCalls})`);
          } else {
            ok('a non-rate-limit 403 fails immediately');
          }
        }
      }

      // REGRESSION GUARD, and it RUNS main() rather than inspecting the pure
      // helpers. The first version of main() pre-checked decideAction with a
      // hard-coded `hasOpenTracker: false` to save an API call when the answer
      // was "none". For `recovered` that IS none — so it returned before ever
      // looking, no recovery closed a tracker, and trackers would accumulate
      // forever while the monitor looked healthy.
      //
      // An earlier version of THIS guard asserted on decideAction directly and
      // passed with the bug reinstated, because the bug lives at the call site
      // and the helper it calls stays correct. Only driving the CLI catches it.
      const stub = path.join(os.tmpdir(), `monitor-stub-${process.pid}.mjs`);
      fs.writeFileSync(stub, `
        globalThis.fetch = async (url, opts = {}) => {
          const method = opts.method || 'GET';
          if (url.includes('/actions/workflows/')) return { ok: true, status: 200,
            text: async () => JSON.stringify({ workflow_runs: [
              { id: 777, run_number: 12, run_attempt: 1, event: 'workflow_dispatch' }
            ] }) };
          if (method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify(
            [{ number: 999, state: 'open', title: ${JSON.stringify(realTitle)},
              user: { login: 'github-actions[bot]' } }]) };
          return { ok: true, status: 200, text: async () => JSON.stringify({ number: 999 }) };
        };
      `);
      const baseDriveEnv = {
        GITHUB_TOKEN: 'stub', GITHUB_REPOSITORY: 'o/r',
        MONITOR_WORKFLOW_NAME: 'Build HNA Data Cache',
        MONITOR_WORKFLOW_PATH: '.github/workflows/build-hna-data.yml',
        MONITOR_RUN_ID: '777', MONITOR_RUN_NUMBER: '12', MONITOR_RUN_ATTEMPT: '1',
        MONITOR_RUN_EVENT: 'workflow_dispatch', MONITOR_HEAD_BRANCH: 'main',
        MONITOR_DEFAULT_BRANCH: 'main', MONITOR_MODE: '',
      };
      const drive = (conclusion, overrides = {}) => execFileSync(process.execPath,
        ['--import', `file://${stub}`, SCRIPT],
        { encoding: 'utf8', env: { ...process.env, ...baseDriveEnv,
          MONITOR_CONCLUSION: conclusion, ...overrides } });
      try {
        const recovered = drive('success');
        const failed = drive('failure');
        if (!/tracker: closed #999/.test(recovered)) {
          fail('a green run did NOT close the open tracker — main() decided before looking it up.\n'
             + `    got: ${recovered.trim().split('\n').pop()}`);
        } else if (!/tracker: commented on #999/.test(failed)) {
          fail(`a failure with a tracker already open must comment, not re-open.\n    got: ${failed.trim().split('\n').pop()}`);
        } else {
          ok('driving the CLI: a green run closes the open tracker, a failure comments on it');
        }
      } finally {
        fs.unlinkSync(stub);
      }

      // End-to-end CREATE path. The original stub always returned an existing
      // tracker, so a monitor unable to open an issue still passed every test.
      const createStub = path.join(os.tmpdir(), `monitor-create-stub-${process.pid}.mjs`);
      fs.writeFileSync(createStub, `
        globalThis.fetch = async (url, opts = {}) => {
          const method = opts.method || 'GET';
          if (url.includes('/actions/workflows/')) return { ok: true, status: 200,
            text: async () => JSON.stringify({ workflow_runs: [
              { id: 777, run_number: 12, run_attempt: 1, event: 'schedule' }
            ] }) };
          if (method === 'GET') return { ok: true, status: 200, text: async () => '[]' };
          const body = JSON.parse(opts.body || '{}');
          if (method !== 'POST' || !body.title || !body.title.includes('[workflow-fail:build-hna-data]')) {
            return { ok: false, status: 422, text: async () => JSON.stringify({ message: 'bad create body' }) };
          }
          return { ok: true, status: 201, text: async () => JSON.stringify({ number: 1234 }) };
        };
      `);
      try {
        const created = execFileSync(process.execPath, ['--import', `file://${createStub}`, SCRIPT], {
          encoding: 'utf8', env: { ...process.env, ...baseDriveEnv,
            MONITOR_CONCLUSION: 'failure', MONITOR_RUN_EVENT: 'schedule' },
        });
        if (!/tracker: opened #1234/.test(created)) {
          fail(`the CLI did not exercise and complete issue creation: ${created.trim().split('\n').pop()}`);
        } else {
          ok('driving the CLI: a failure with no trusted tracker opens a new issue');
        }
      } finally {
        fs.unlinkSync(createStub);
      }

      // Feature-branch QA runs must never mutate production trackers. The stub
      // throws if ANY API call occurs, proving this is a call-site guard rather
      // than only a workflow-trigger assertion.
      const noFetchStub = path.join(os.tmpdir(), `monitor-no-fetch-stub-${process.pid}.mjs`);
      fs.writeFileSync(noFetchStub, `globalThis.fetch = async () => { throw new Error('API must not be called'); };`);
      try {
        const skipped = execFileSync(process.execPath, ['--import', `file://${noFetchStub}`, SCRIPT], {
          encoding: 'utf8', env: { ...process.env, ...baseDriveEnv,
            MONITOR_CONCLUSION: 'failure', MONITOR_HEAD_BRANCH: 'feature/test' },
        });
        if (!/is not the repository default branch/.test(skipped)) {
          fail('a feature-branch run was not explicitly skipped by the CLI');
        } else {
          ok('driving the CLI: a feature-branch run makes no GitHub API call');
        }
      } finally {
        fs.unlinkSync(noFetchStub);
      }

      // queue:max prevents displacement but not reordering. An older queued
      // event must not overwrite the state established by a newer completed run.
      const staleStub = path.join(os.tmpdir(), `monitor-stale-stub-${process.pid}.mjs`);
      fs.writeFileSync(staleStub, `
        globalThis.fetch = async (url, opts = {}) => {
          if (!url.includes('/actions/workflows/') || (opts.method || 'GET') !== 'GET') {
            throw new Error('stale run reached tracker API');
          }
          return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: [
            { id: 888, run_number: 13, run_attempt: 1, event: 'schedule' }
          ] }) };
        };
      `);
      try {
        const stale = execFileSync(process.execPath, ['--import', `file://${staleStub}`, SCRIPT], {
          encoding: 'utf8', env: { ...process.env, ...baseDriveEnv, MONITOR_CONCLUSION: 'failure' },
        });
        if (!/no action — stale run 12\.1/.test(stale)) {
          fail('an older queued event was not rejected before tracker mutation');
        } else {
          ok('driving the CLI: an older event cannot overwrite a newer completed outcome');
        }
      } finally {
        fs.unlinkSync(staleStub);
      }

      // A rejected tracker write must make the monitor red. The former broad
      // catch printed a warning and exited 0, silently dropping the alert.
      const failedWriteStub = path.join(os.tmpdir(), `monitor-failed-write-stub-${process.pid}.mjs`);
      fs.writeFileSync(failedWriteStub, `
        globalThis.fetch = async (url, opts = {}) => {
          const method = opts.method || 'GET';
          if (url.includes('/actions/workflows/')) return { ok: true, status: 200,
            text: async () => JSON.stringify({ workflow_runs: [
              { id: 777, run_number: 12, run_attempt: 1, event: 'schedule' }
            ] }) };
          if (method === 'GET') return { ok: true, status: 200, text: async () => '[]' };
          return { ok: false, status: 403, text: async () => JSON.stringify({ message: 'forbidden' }) };
        };
      `);
      try {
        let status = 0;
        let output = '';
        try {
          output = execFileSync(process.execPath, ['--import', `file://${failedWriteStub}`, SCRIPT], {
            encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...baseDriveEnv,
              MONITOR_CONCLUSION: 'failure', MONITOR_RUN_EVENT: 'schedule' },
          });
        } catch (err) {
          status = err.status;
          output = `${err.stdout || ''}${err.stderr || ''}`;
        }
        if (!status || !/::error::\[monitor\] tracker: FAILED/.test(output)) {
          fail(`a rejected issue write did not fail the job visibly (status=${status})`);
        } else {
          ok('a rejected tracker write is visible and exits nonzero');
        }
      } finally {
        fs.unlinkSync(failedWriteStub);
      }
    }

    /* ── P4: monitor runs for one workflow must not race each other ──────── */
    {
      // Keyed on workflow_run.id the group is unique per run, so two failing
      // runs of the same workflow both look up the tracker, both find none, and
      // both open one. Two trackers for one outage, and a noisy alerter is one
      // that gets muted.
      const m = wfCode.match(/^concurrency:\s*\n\s*group:\s*(.+)$/m);
      if (!m) {
        fail('no concurrency group on the monitor — runs for one workflow could race');
      } else if (/workflow_run\.id/.test(m[1])) {
        fail(`the concurrency group is keyed on workflow_run.id (${m[1].trim()}), which is `
           + 'unique per run — two failures of the same workflow would open two trackers');
      } else if (!/workflow_run\.(path|name)/.test(m[1])) {
        fail(`the concurrency group must key on the watched workflow (got ${m[1].trim()})`);
      } else {
        ok('monitor runs serialize per watched workflow, so one outage opens one tracker');
      }
      if (!/^\s{2}queue:\s*max\s*$/m.test(wfCode)) {
        fail('monitor concurrency keeps GitHub\'s one-pending default — a newer event can silently displace an older one');
      } else {
        ok('monitor concurrency retains queued outcomes instead of silently displacing one pending event');
      }
    }

    /* ── P4: the workflow supplies what the marker needs ─────────────────── */
    {
      if (!/MONITOR_WORKFLOW_PATH:\s*\$\{\{\s*github\.event\.workflow_run\.path\s*\}\}/.test(wfCode)) {
        fail('the monitor step must pass MONITOR_WORKFLOW_PATH, or no tracker marker can be derived');
      } else {
        ok('the workflow passes the run path, so the marker matches the existing trackers');
      }
      const identityVars = [
        'MONITOR_RUN_ID', 'MONITOR_RUN_NUMBER', 'MONITOR_RUN_ATTEMPT',
        'MONITOR_RUN_EVENT', 'MONITOR_HEAD_BRANCH', 'MONITOR_DEFAULT_BRANCH',
      ];
      const missing = identityVars.filter((name) => !new RegExp(`^\\s+${name}:`, 'm').test(wfCode));
      if (missing.length) {
        fail(`the workflow omits ordering/branch identity: ${missing.join(', ')}`);
      } else {
        ok('the workflow passes branch and run identity for defense-in-depth ordering guards');
      }
    }

    if (failures) { console.error(`\nworkflow-outcome-monitor: FAIL (${failures})`); process.exit(1); }
    console.log('workflow-outcome-monitor: PASS');
  });
}
