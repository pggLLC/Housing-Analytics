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
        { number: 1, state: 'closed', title: realTitle },
        { number: 2, state: 'open', title: 'unrelated' },
        { number: 3, state: 'open', title: '⚠️ [workflow-fail:build-hna-data] renamed by a human' },
      ];
      const found = M.findTracker(issues, 'build-hna-data');
      if (!found || found.number !== 3) {
        fail(`findTracker must match the open issue on its MARKER, not its title; got ${JSON.stringify(found)}`);
      } else if (M.findTracker(issues, 'fetch-fred-data') !== null) {
        fail("findTracker matched another workflow's tracker");
      } else {
        ok('an open tracker is found by marker, renamed or not, and never another workflow\'s');
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
          if (method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify(
            [{ number: 999, state: 'open', title: ${JSON.stringify(realTitle)} }]) };
          return { ok: true, status: 200, text: async () => JSON.stringify({ number: 999 }) };
        };
      `);
      const drive = (conclusion) => execFileSync(process.execPath,
        ['--import', `file://${stub}`, SCRIPT],
        { encoding: 'utf8', env: { ...process.env,
          GITHUB_TOKEN: 'stub', GITHUB_REPOSITORY: 'o/r',
          MONITOR_WORKFLOW_NAME: 'Build HNA Data Cache',
          MONITOR_WORKFLOW_PATH: '.github/workflows/build-hna-data.yml',
          MONITOR_CONCLUSION: conclusion, MONITOR_MODE: '' } });
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
    }

    /* ── P4: the workflow supplies what the marker needs ─────────────────── */
    {
      if (!/MONITOR_WORKFLOW_PATH:\s*\$\{\{\s*github\.event\.workflow_run\.path\s*\}\}/.test(wfCode)) {
        fail('the monitor step must pass MONITOR_WORKFLOW_PATH, or no tracker marker can be derived');
      } else {
        ok('the workflow passes the run path, so the marker matches the existing trackers');
      }
    }

    if (failures) { console.error(`\nworkflow-outcome-monitor: FAIL (${failures})`); process.exit(1); }
    console.log('workflow-outcome-monitor: PASS');
  });
}
