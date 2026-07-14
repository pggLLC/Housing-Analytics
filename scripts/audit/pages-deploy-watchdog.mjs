#!/usr/bin/env node
/**
 * Detect GitHub Pages deploys that are missing, failed, or stuck behind a
 * stale active run. The pure evaluator is unit-tested; the CLI uses the
 * GitHub Actions token available to the scheduled workflow.
 */

const DEFAULT_BRANCH = 'main';
const DEFAULT_WORKFLOW_ID = 'deploy.yml';
const DEFAULT_GRACE_MINUTES = 20;
const DEFAULT_STALE_ACTIVE_MINUTES = 120;

function minutesBetween(now, then) {
  const thenDate = then instanceof Date ? then : new Date(then);
  return (now.getTime() - thenDate.getTime()) / 60000;
}

function runAgeMinutes(run, now) {
  return minutesBetween(now, run.run_started_at || run.created_at || run.updated_at || now);
}

function runLabel(run) {
  const sha = String(run.head_sha || 'unknown').slice(0, 8);
  return `${sha} ${run.status}/${run.conclusion || 'pending'} ${run.html_url || '(no URL)'}`;
}

export function evaluateDeployCoverage({
  headSha,
  headCommitDate,
  runs,
  now = new Date(),
  workflowId = DEFAULT_WORKFLOW_ID,
  graceMinutes = DEFAULT_GRACE_MINUTES,
  staleActiveMinutes = DEFAULT_STALE_ACTIVE_MINUTES,
} = {}) {
  if (!headSha) {
    return { ok: false, reason: 'missing-head-sha', messages: ['Could not resolve latest main SHA.'] };
  }

  const commitAgeMinutes = minutesBetween(now, headCommitDate || now);
  const deployRuns = Array.isArray(runs) ? runs : [];
  const staleActiveRuns = deployRuns.filter((run) => (
    run.status !== 'completed' && runAgeMinutes(run, now) > staleActiveMinutes
  ));

  if (staleActiveRuns.length) {
    return {
      ok: false,
      reason: 'stale-active-run',
      messages: [
        `Stale active ${workflowId} run(s) exceed ${staleActiveMinutes} minutes.`,
        'A run stuck in queued/in_progress/waiting can freeze GitHub Pages deploys behind it.',
        ...staleActiveRuns.slice(0, 5).map((run) => `- ${runLabel(run)} age=${runAgeMinutes(run, now).toFixed(1)}m`),
      ],
    };
  }

  const matchingRuns = deployRuns.filter((run) => run.head_sha === headSha);
  const successfulRun = matchingRuns.find((run) => (
    run.status === 'completed' && run.conclusion === 'success'
  ));

  if (successfulRun) {
    return {
      ok: true,
      reason: 'successful-run',
      messages: [`Latest main ${headSha} has successful Pages deploy coverage: ${runLabel(successfulRun)}.`],
    };
  }

  const activeRun = matchingRuns.find((run) => run.status !== 'completed');
  if (activeRun) {
    return {
      ok: true,
      reason: 'fresh-active-run',
      messages: [
        `Latest main ${headSha} has an active Pages deploy within ${staleActiveMinutes} minutes: ${runLabel(activeRun)} age=${runAgeMinutes(activeRun, now).toFixed(1)}m.`,
      ],
    };
  }

  if (commitAgeMinutes < graceMinutes) {
    return {
      ok: true,
      reason: 'trigger-grace-period',
      messages: [`Latest main ${headSha} is ${commitAgeMinutes.toFixed(1)} minutes old; allowing deploy trigger grace period.`],
    };
  }

  const recent = deployRuns
    .slice(0, 5)
    .map((run) => `- ${runLabel(run)}`);

  return {
    ok: false,
    reason: 'missing-successful-run',
    messages: [
      `No successful or fresh active ${workflowId} run found for latest main ${headSha}.`,
      'This usually means the Pages workflow did not trigger, failed, or was superseded before deploying current HEAD.',
      'Recent deploy runs:',
      recent.join('\n') || '(none)',
    ],
  };
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${url}`);
  }
  return res.json();
}

async function runCli() {
  const repoSlug = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  const branchName = process.env.WATCHDOG_BRANCH || DEFAULT_BRANCH;
  const workflowId = process.env.WATCHDOG_WORKFLOW_ID || DEFAULT_WORKFLOW_ID;
  const graceMinutes = Number(process.env.WATCHDOG_GRACE_MINUTES || DEFAULT_GRACE_MINUTES);
  const staleActiveMinutes = Number(process.env.WATCHDOG_STALE_ACTIVE_MINUTES || DEFAULT_STALE_ACTIVE_MINUTES);

  if (!repoSlug || !token) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  }

  const [owner, repo] = repoSlug.split('/');
  const branch = await fetchJson(`${apiUrl}/repos/${owner}/${repo}/branches/${branchName}`, token);
  const headSha = branch.commit.sha;
  const commit = await fetchJson(`${apiUrl}/repos/${owner}/${repo}/commits/${headSha}`, token);
  const commitDate = commit.commit?.committer?.date || commit.commit?.author?.date;
  const runs = await fetchJson(
    `${apiUrl}/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?branch=${branchName}&per_page=50`,
    token
  );

  const result = evaluateDeployCoverage({
    headSha,
    headCommitDate: commitDate,
    runs: runs.workflow_runs || [],
    workflowId,
    graceMinutes,
    staleActiveMinutes,
  });

  for (const message of result.messages) {
    console.log(message);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}
