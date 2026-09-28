#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const END_DATE = '2027-01-31';
export const R2_BATCHES = [
  '08001 08003 08005 08007 08009 08011 08013 08014',
  '08015 08017 08019 08021 08023 08025 08027 08029',
  '08031 08033 08035 08037 08039 08041 08043 08045',
  '08047 08049 08051 08053 08055 08057 08059 08061',
  '08063 08065 08067 08069 08071 08073 08075 08077',
  '08079 08081 08083 08085 08087 08089 08091 08093',
  '08095 08097 08099 08101 08103 08105 08107 08109',
  '08111 08113 08115 08117 08119 08121 08123 08125',
].map((line) => line.split(' '));

export function denverDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function markersFromIssues(issues) {
  return new Set(issues.flatMap(({ body }) =>
    [...(body || '').matchAll(/<!-- coho-reminder:[^\r\n]*? -->/g)].map(([marker]) => marker)));
}

function unavailable(repoState, geoids) {
  return geoids.flatMap((geoid) => {
    const file = `data/policy/ballot-2026/counties/${geoid}.json`;
    const ballot = repoState.ballots[file];
    if (!ballot) throw new Error(`Missing committed county file: ${file}`);
    return ballot.coverage.filter((row) => row.coverage_state === 'official_notice_unavailable')
      .map((row) => ({ file, name: row.name }));
  });
}

/** Pure decision/rendering core: no clock, filesystem, network, or mutations. */
export function due(schedule, todayDenver, existingMarkers, repoState) {
  if (todayDenver > END_DATE) return [];
  const seen = new Set(existingMarkers);
  const issues = [];
  for (const reminder of schedule) {
    if (reminder.open_on > todayDenver) continue;
    let variants = [{ batch: '', geoids: [], rows: [] }];
    switch (reminder.condition) {
      case undefined: break;
      case 'adams_notice_unavailable':
        if (!unavailable(repoState, ['08001']).length) continue;
        break;
      case 'r2_notice_unavailable':
        variants = R2_BATCHES.map((geoids, i) => ({
          batch: `R2-B${i + 1}-P2`, geoids, rows: unavailable(repoState, geoids),
        })).filter(({ rows }) => rows.length);
        break;
      case 'unarchived_election_records':
        if (![...Object.values(repoState.ballots).flatMap((ballot) => ballot.entries),
          ...repoState.candidates.candidates].some((record) => record.archived !== true)) continue;
        break;
      default: throw new Error(`Unknown reminder condition: ${reminder.condition}`);
    }
    for (const { batch, geoids, rows } of variants) {
      const marker = `<!-- coho-reminder:${reminder.id}${batch ? ':' + batch : ''} -->`;
      if (seen.has(marker)) continue;
      const template = repoState.bodies[reminder.body];
      if (typeof template !== 'string') throw new Error(`Missing body: ${reminder.body}`);
      const replacements = {
        '<batch>': batch, '<BLOCK>': batch, '<GEOIDS>': geoids.join(' '),
        '<COUNT>': String(rows.length),
        '<ROWS>': rows.map(({ file, name }) => `- \`${file}\` — ${name}`).join('\n'),
      };
      const body = template.replace(/<batch>|<BLOCK>|<GEOIDS>|<COUNT>|<ROWS>/g,
        (token) => replacements[token]);
      if (body.split('\n')[0] !== marker) throw new Error(`Wrong body marker: ${reminder.id}`);
      issues.push({ marker, title: reminder.title.replace('R2-Bn-P2', batch), body });
      seen.add(marker);
    }
  }
  return issues;
}

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/coho-reminders');

export function loadSchedule() {
  return JSON.parse(readFileSync(resolve(TEMPLATE_DIR, 'schedule.json'), 'utf8'));
}

/** Read HEAD blobs, ignoring local edits/untracked duplicates in the data checkout. */
export function readRepoState(root, schedule) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const paths = git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'data/policy/ballot-2026/')
    .trim().split('\n').filter((path) => path.endsWith('.json'));
  if (!paths.includes('data/policy/ballot-2026/statewide.json')) throw new Error('Missing statewide ballot');
  const read = (path) => JSON.parse(git('show', `HEAD:${path}`));
  return {
    ballots: Object.fromEntries(paths.map((path) => [path, read(path)])),
    candidates: read('data/policy/candidate-platforms-2026.json'),
    bodies: Object.fromEntries(schedule.map(({ body }) => [body, readFileSync(resolve(TEMPLATE_DIR, body), 'utf8')])),
  };
}

export async function githubRequest(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    const error = new Error(`GitHub ${response.status}: ${await response.text()}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function openReminders({ schedule, todayDenver, repoState, api, dryRun,
  repo = 'pggLLC/Housing-Analytics', log = console.log }) {
  if (todayDenver > END_DATE) {
    log(`COHO reminders expired after ${END_DATE}; nothing to do (${todayDenver} America/Denver).`);
    return [];
  }
  const base = `/repos/${repo}`;
  const existing = [];
  // No search API cap: page through ALL open and closed labelled issues.
  for (let page = 1; ; page++) {
    const items = await api(`${base}/issues?state=all&labels=coho-reminder&per_page=100&page=${page}`);
    existing.push(...items.filter((item) => !item.pull_request));
    if (items.length < 100) break;
  }
  const pending = due(schedule, todayDenver, markersFromIssues(existing), repoState);
  log(`${todayDenver} America/Denver: ${pending.length} reminder issue(s) ${dryRun ? 'would open' : 'to open'}.`);
  if (dryRun) {
    for (const issue of pending) log(`DRY RUN: ${issue.title}\n${issue.body}`);
    return pending;
  }
  try {
    await api(`${base}/labels/coho-reminder`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await api(`${base}/labels`, { method: 'POST', body: {
      name: 'coho-reminder', color: '096e65', description: 'Dated 2026 election follow-ups',
    } });
  }
  for (const issue of pending) {
    const created = await api(`${base}/issues`, { method: 'POST', body: {
      title: issue.title, body: issue.body, labels: ['coho-reminder'], assignees: ['paulglasow'],
    } });
    log(`Opened ${created.html_url}`);
  }
  return pending;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') continue;
    if (args[i] === '--repo-root' && args[i + 1]) root = resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const todayDenver = denverDate();
  if (todayDenver > END_DATE) {
    console.log(`COHO reminders expired after ${END_DATE}; nothing to do (${todayDenver} America/Denver).`);
    return;
  }
  if (!dryRun && process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Real reminder creation is allowed only from the main workflow; use --dry-run.');
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to check existing reminder markers.');
  const schedule = loadSchedule();
  await openReminders({ schedule, todayDenver, repoState: readRepoState(root, schedule), dryRun,
    api: (path, options) => githubRequest(token, path, options) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
