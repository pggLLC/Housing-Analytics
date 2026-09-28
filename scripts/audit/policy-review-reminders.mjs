#!/usr/bin/env node
// Opens a GitHub issue when hand-verified policy or homebuyer-program records
// come due for review (#2009).
//
// Each record in the files below carries last_verified and review_by. Pages
// warn readers once a date passes (js/components/review-status.js); this makes
// sure a person is asked to re-check BEFORE that happens. Every record due
// within LEAD_DAYS (or already overdue) is reminded exactly once per review
// date: each listed record carries its own hidden marker (file, id, review_by),
// and a run lists only records no earlier issue has marked. Records that
// enter the window on later days get their own issue even while earlier ones
// are still open; once a record is re-verified and its review_by moves
// forward, its next due date gets a new marker.
//
// The re-check itself cannot be automated honestly: program amounts,
// eligibility and bill status have to be read from the official source by a
// person. The issue says exactly what to check and how to record it.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { denverDate, githubRequest } from '../coho/open-reminders.mjs';

export const LEAD_DAYS = 7;
export const LABEL = 'policy-review';
export const FILES = [
  { file: 'data/policy/homeownership-programs.json', key: 'programs', title: 'Homebuyer programs', page: 'help-for-homebuyers.html', name: (r) => r.name },
  { file: 'data/policy/tax-credit-legislation.json', key: 'entries', title: 'Tax-credit policy watchlist', page: 'housing-legislation-2026.html', name: (r) => r.title },
];

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);

export function markersFromIssues(issues) {
  return new Set(issues.flatMap(({ body }) =>
    [...(body || '').matchAll(/<!-- policy-review:[^\r\n]*? -->/g)].map(([m]) => m)));
}

export function recordMarker(file, record) {
  return `<!-- policy-review:${file}#${record.id}@${isoDay(record.review_by) || 'undated'} -->`;
}

/** Pure: which review issues are due today. No clock, filesystem or network. */
export function dueReviews(docs, todayDenver, existingMarkers = new Set(), leadDays = LEAD_DAYS) {
  const horizon = addDays(todayDenver, leadDays);
  const issues = [];
  for (const spec of FILES) {
    const doc = docs[spec.file];
    if (!doc || !Array.isArray(doc[spec.key])) throw new Error(`${spec.file}: no ${spec.key} array`);
    const records = doc[spec.key];
    const due = records
      .filter((r) => { const by = isoDay(r.review_by); return !by || by <= horizon; })
      .filter((r) => !existingMarkers.has(recordMarker(spec.file, r)));
    if (!due.length) continue;
    due.sort((a, b) => String(a.review_by || '').localeCompare(String(b.review_by || '')));
    const first = isoDay(due[0].review_by) || 'undated';
    const overdue = due.filter((r) => { const by = isoDay(r.review_by); return by && by < todayDenver; }).length;
    const rows = due.map((r) => `- [ ] **${spec.name(r)}** (\`${r.id}\`) — status \`${r.status || 'unset'}\`, ` +
      `last checked ${isoDay(r.last_verified) || 'never'}, review by ${isoDay(r.review_by) || '**not set**'}` +
      (r.source_url ? ` — [official source](${r.source_url})` : ' — **no source URL**') +
      ` ${recordMarker(spec.file, r)}`);
    const body = [
      `${due.length} record${due.length === 1 ? '' : 's'} in \`${spec.file}\` ${overdue ? `(${overdue} already past review) ` : ''}${due.length === 1 ? 'is' : 'are'} due for re-checking by ${horizon}.`,
      `Readers of \`${spec.page}\` see a "review due" or "review overdue" warning on each until it is re-checked.`,
      '',
      '### Records to re-check',
      ...rows,
      '',
      '### How to re-check a record',
      '1. Open its official source and confirm status, amounts, eligibility, dates and deadlines.',
      '2. Update any field that changed. Do not carry forward a figure the source no longer states — use `null` with a `source_note` saying why.',
      '3. Set `last_verified` to the day you checked and `review_by` to the next check (about 90 days on; sooner if a deadline or vote is near).',
      '4. If the source cannot be reached, keep the last verified values and dates, and say so in `source_note`. The page keeps showing the overdue warning, which is correct.',
      '5. Update `meta.last_verified` / `meta.review_by` in the file, then open one PR for the batch.',
      '',
      'Opened by `scripts/audit/policy-review-reminders.mjs` (daily). Each record is reminded once per review date.',
    ].join('\n');
    issues.push({ markers: due.map((r) => recordMarker(spec.file, r)),
      title: `Review due: ${spec.title} (${due.length} record${due.length === 1 ? '' : 's'}, from ${first})`, body });
  }
  return issues;
}

/** Read the committed files (HEAD), ignoring local edits. */
export function readDocs(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return Object.fromEntries(FILES.map(({ file }) => [file, JSON.parse(git('show', `HEAD:${file}`))]));
}

export async function openReviewIssues({ docs, todayDenver, api, dryRun,
  repo = 'pggLLC/Housing-Analytics', log = console.log }) {
  const base = `/repos/${repo}`;
  const existing = [];
  for (let page = 1; ; page++) {
    const items = await api(`${base}/issues?state=all&labels=${LABEL}&per_page=100&page=${page}`);
    existing.push(...items.filter((item) => !item.pull_request));
    if (items.length < 100) break;
  }
  const pending = dueReviews(docs, todayDenver, markersFromIssues(existing));
  log(`${todayDenver} America/Denver: ${pending.length} review issue(s) ${dryRun ? 'would open' : 'to open'}.`);
  if (dryRun) {
    for (const issue of pending) log(`DRY RUN: ${issue.title}\n${issue.body}\n`);
    return pending;
  }
  try {
    await api(`${base}/labels/${LABEL}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await api(`${base}/labels`, { method: 'POST', body: {
      name: LABEL, color: 'b60205', description: 'Hand-verified policy/program data due for re-check',
    } });
  }
  for (const issue of pending) {
    const created = await api(`${base}/issues`, { method: 'POST', body: {
      title: issue.title, body: issue.body, labels: [LABEL], assignees: ['paulglasow'],
    } });
    log(`Opened ${created.html_url}`);
  }
  return pending;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const offline = args.includes('--offline');
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run' || args[i] === '--offline') continue;
    if (args[i] === '--repo-root' && args[i + 1]) root = resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const todayDenver = denverDate();
  const docs = readDocs(root);
  if (offline) {
    // Local preview: no GitHub access, no existing-issue check.
    for (const issue of dueReviews(docs, todayDenver)) console.log(`${issue.title}\n${issue.body}\n`);
    return;
  }
  if (!dryRun && process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Real issue creation is allowed only from the main workflow; use --dry-run.');
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to check existing review issues.');
  await openReviewIssues({ docs, todayDenver, dryRun, api: (path, options) => githubRequest(token, path, options) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
