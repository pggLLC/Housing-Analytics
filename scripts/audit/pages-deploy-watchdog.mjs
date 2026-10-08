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
const ACTIVE_STATUSES = ['queued', 'in_progress', 'waiting'];

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
  activeRuns = runs,
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
  const staleActiveRuns = (Array.isArray(activeRuns) ? activeRuns : []).filter((run) => (
    ACTIVE_STATUSES.includes(run.status) && runAgeMinutes(run, now) > staleActiveMinutes
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

  const activeRun = matchingRuns.find((run) => ACTIVE_STATUSES.includes(run.status));
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

/** Query the head directly; the branch listing is only a consistency check. */
export async function checkDeployCoverage({
  repoSlug, token, headSha, headCommitDate,
  apiUrl = 'https://api.github.com', branchName = DEFAULT_BRANCH,
  workflowId = DEFAULT_WORKFLOW_ID, now = new Date(),
  graceMinutes = DEFAULT_GRACE_MINUTES, staleActiveMinutes = DEFAULT_STALE_ACTIVE_MINUTES,
  request = fetchJson, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  retryDelayMs = 1000,
}) {
  const endpoint = `${apiUrl}/repos/${repoSlug}/actions/workflows/${workflowId}/runs`;
  async function readRuns(filters, paginate = true) {
    const runs = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ ...filters, per_page: '100', page: String(page) });
      const data = await request(`${endpoint}?${query}`, token);
      if (!Array.isArray(data.workflow_runs)) throw new Error('GitHub returned no workflow_runs array');
      const batch = data.workflow_runs;
      if (filters.head_sha && batch.some(run => run.head_sha !== headSha)) throw new Error('Head-SHA query returned a different SHA');
      if (filters.status && batch.some(run => run.status !== filters.status)) throw new Error('Active-run query returned another status');
      runs.push(...batch);
      if (!paginate || runs.length >= data.total_count || batch.length < 100) {
        if (paginate && runs.length < data.total_count) throw new Error('Incomplete workflow-run pagination');
        return runs;
      }
    }
  }
  const signature = runs => runs.filter(run => run.head_sha === headSha)
    .map(run => `${run.id}:${run.status}:${run.conclusion}`).sort().join('|');
  const coversHead = runs => runs.some(run => run.head_sha === headSha &&
    ((run.status === 'completed' && run.conclusion === 'success') || ACTIVE_STATUSES.includes(run.status)));
  const unverifiable = message => ({ ok: true, reason: 'unverifiable', messages: [`::warning::Pages deploy coverage unverifiable: ${message}`] });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const responses = await Promise.allSettled([
        readRuns({ head_sha: headSha }),
        readRuns({ branch: branchName }, false),
        ...ACTIVE_STATUSES.map(status => readRuns({ branch: branchName, status })),
      ]);
      const activeRuns = responses.slice(2).filter(r => r.status === 'fulfilled').flatMap(r => r.value);
      const failed = responses.find(r => r.status === 'rejected');
      if (failed) {
        const known = evaluateDeployCoverage({ headSha, headCommitDate, runs: [], activeRuns,
          now, workflowId, graceMinutes, staleActiveMinutes });
        if (known.reason === 'stale-active-run') return known;
        throw failed.reason;
      }
      const [headRuns, branchRuns] = responses.map(r => r.value);
      const newest = Math.max(0, ...branchRuns.map(run => Date.parse(run.created_at) || 0));
      const inconsistent = signature(headRuns) !== signature(branchRuns) || newest < Date.parse(headCommitDate);
      if (inconsistent && attempt === 0) { await wait(retryDelayMs); continue; }
      const result = evaluateDeployCoverage({ headSha, headCommitDate, runs: headRuns, activeRuns,
        now, workflowId, graceMinutes, staleActiveMinutes });
      if (result.reason === 'stale-active-run') return result;
      if (!result.ok && (coversHead(branchRuns) || coversHead(activeRuns))) {
        return unverifiable('the head-SHA and other run queries still disagree after retry; no missing-deploy claim can be made.');
      }
      // A successful direct result remains authoritative even if the branch
      // listing stays stale. Repeated empty/failed direct results still fail.
      if (inconsistent && result.ok) result.messages.push('Branch run listing is stale or inconsistent; coverage was checked by head SHA.');
      return result;
    } catch (error) {
      if (attempt === 0) { await wait(retryDelayMs); continue; }
      return unverifiable(`${error.message}; retried once, no deployment failure established.`);
    }
  }
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
  const result = await checkDeployCoverage({
    repoSlug, token, apiUrl, branchName, headSha, headCommitDate: commitDate,
    workflowId, graceMinutes, staleActiveMinutes,
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
