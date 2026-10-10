#!/usr/bin/env node
// Monthly issue that keeps the Local Housing Incentives page growing and its
// Prop 123 column honest (local-incentives.html).
//
// Two things on that page cannot refresh themselves:
//   1. Coverage. Each incentive record is read by a person from a jurisdiction's
//      own code, fee schedule or program page; nothing scrapes it. Without a
//      queue, research stops wherever the last session stopped. This lists the
//      next batch of jurisdictions with a scope nobody has checked, in priority
//      order: Prop 123 fast-track filers, then other Prop 123 filers, then
//      everyone else, largest population first within each group.
//   2. The Prop 123 filing list. DOLA's commitment-filings page refuses
//      automated reads (CloudFront 403), so data/policy/prop123_jurisdictions.json
//      is refreshed by hand. The issue says how old it is and, past
//      PROP123_MAX_DAYS, asks for the refresh.
//
// Re-checking records that come due is a separate, daily job
// (policy-review-reminders.mjs). This one opens at most one issue per month.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { denverDate, githubRequest } from '../coho/open-reminders.mjs';

const require = createRequire(import.meta.url);
const D = require('../../js/local-incentives-data.js');

export const LABEL = 'local-incentives';
export const BATCH_SIZE = 15;
export const PROP123_MAX_DAYS = 120;
export const FILES = {
  geoConfig: 'data/hna/geo-config.json',
  fees: 'data/policy/fee-reductions.json',
  funds: 'data/policy/local-housing-funds.json',
  coverage: 'data/policy/incentive-coverage.json',
  prop123: 'data/policy/prop123_jurisdictions.json',
  alternatives: 'data/policy/incentive-alternatives.json',
  // Population only, to order the queue. Read, never written.
  ranking: 'data/hna/ranking-index.json',
};

const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function marker(todayDenver) {
  return `<!-- local-incentives-watch:${todayDenver.slice(0, 7)} -->`;
}

/** Pure: the queue, in priority order. Counties and municipalities only. */
export function queue(docs, size = BATCH_SIZE) {
  const model = D.build(docs);
  const population = new Map(((docs.ranking && docs.ranking.rankings) || [])
    .map((r) => [r.geoid, r.metrics && typeof r.metrics.population === 'number' ? r.metrics.population : null]));
  const seen = new Set();
  const rows = [];
  model.geo.forEach((g) => {
    if (g.kind === 'cdp') return;
    const canon = D.canonicalGeoid(g.geoid);
    if (seen.has(canon)) return;
    seen.add(canon);
    const p = model.profile(canon);
    const open = D.SCOPES.filter((s) => p.states[s] === 'not_checked');
    if (!open.length) return;
    const f = p.prop123;
    const tier = f && f.fast_track === true ? 0 : f ? 1 : 2;
    rows.push({ geoid: canon, name: p.name, open, tier, population: population.get(canon) ?? population.get(g.geoid) ?? null });
  });
  rows.sort((a, b) => (a.tier - b.tier) || ((b.population ?? -1) - (a.population ?? -1)) || a.name.localeCompare(b.name));
  return { model, rows: rows.slice(0, size), remaining: rows.length };
}

/** Pure: the month's issue, or null if this month's already exists. */
export function monthlyIssue(docs, todayDenver, existingBodies = []) {
  const mark = marker(todayDenver);
  if (existingBodies.some((b) => (b || '').includes(mark))) return null;
  const { model, rows, remaining } = queue(docs);
  const summary = model.coverageSummary();
  const updated = isoDay(docs.prop123 && docs.prop123.updated);
  const age = updated ? days(updated, todayDenver) : null;
  const stale = age == null || age > PROP123_MAX_DAYS;
  const tierText = ['Prop 123 fast-track filer', 'Prop 123 filer', 'no Prop 123 filing on record'];
  const lines = [
    `Local Housing Incentives coverage: **${summary.any_records}** of ${summary.jurisdictions} counties and municipalities have at least one verified record; **${remaining}** still have a scope nobody has checked.`,
    '',
    '### Prop 123 filing list',
    updated
      ? `\`${FILES.prop123}\` was last updated ${updated} (${age} days ago).`
      : `\`${FILES.prop123}\` carries no \`updated\` date.`,
    stale
      ? `**Refresh it by hand.** DOLA's https://cdola.colorado.gov/commitment-filings refuses automated reads. Open it in a browser, update each jurisdiction's status, filing date and fast-track flag, set \`updated\`, and re-check that every name is a real county or municipality (${model.prop123.unmatched.length} name${model.prop123.unmatched.length === 1 ? ' does' : 's do'} not match one: ${model.prop123.unmatched.join(', ') || 'none'}).`
      : `Within ${PROP123_MAX_DAYS} days; no refresh needed this month.`,
    '',
    `### Next ${rows.length} jurisdictions to research`,
    ...rows.map((r) => `- [ ] **${r.name}** (\`${r.geoid}\`, ${tierText[r.tier]}${r.population ? `, population ${r.population.toLocaleString('en-US')}` : ''}) — not yet checked: ${r.open.join(', ')}`),
    '',
    '### How to add a jurisdiction',
    '1. Read its fee schedule, municipal code (inclusionary, density, fee waiver sections), housing page and any voter-approved housing tax. Save what you read.',
    '2. Fee relief and land-use incentives go in `data/policy/fee-reductions.json`; funds, taxes, linkage fees, land and ownership tools in `data/policy/local-housing-funds.json`. Every figure must appear in a quoted line of the source; a figure the source does not publish is `null`.',
    '3. Where you read the official source and found nothing, or could not read it, add a row to `data/policy/incentive-coverage.json` so the page says so instead of "not yet checked".',
    '4. Set `last_verified` to the day you checked and `review_by` to the next check.',
    '',
    `Opened by \`scripts/audit/local-incentives-watch.mjs\` (monthly). ${mark}`,
  ];
  return { title: `Local incentives: next ${rows.length} jurisdictions to research${stale ? ', and refresh the Prop 123 list' : ''} (${todayDenver.slice(0, 7)})`, body: lines.join('\n') };
}

export function readDocs(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return Object.fromEntries(Object.entries(FILES).map(([k, file]) => [k, JSON.parse(git('show', `HEAD:${file}`))]));
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
  const docs = readDocs(root);
  const repo = 'pggLLC/Housing-Analytics';
  const token = process.env.GITHUB_TOKEN;
  let bodies = [];
  if (token) {
    const items = await githubRequest(token, `/repos/${repo}/issues?state=all&labels=${LABEL}&per_page=100`);
    bodies = items.filter((i) => !i.pull_request).map((i) => i.body);
  }
  const issue = monthlyIssue(docs, todayDenver, bodies);
  if (!issue) { console.log(`${todayDenver}: this month's issue already exists.`); return; }
  if (dryRun || !token) { console.log(`DRY RUN: ${issue.title}\n${issue.body}`); return; }
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Real issue creation is allowed only from main; use --dry-run.');
  try {
    await githubRequest(token, `/repos/${repo}/labels/${LABEL}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await githubRequest(token, `/repos/${repo}/labels`, { method: 'POST', body: {
      name: LABEL, color: '0e8a16', description: 'Local Housing Incentives research queue',
    } });
  }
  const created = await githubRequest(token, `/repos/${repo}/issues`, { method: 'POST', body: {
    title: issue.title, body: issue.body, labels: [LABEL], assignees: ['paulglasow'],
  } });
  console.log(`Opened ${created.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
