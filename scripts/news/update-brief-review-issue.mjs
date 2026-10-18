#!/usr/bin/env node
// One open issue that says which jurisdiction briefs to review and why,
// rewritten from data/alerts/brief-news-queue.json on every daily news run
// (weekly_housing_brief.yml).
//
// It replaces jurisdiction-briefs-monthly.yml, which opened a PR of two
// snapshot files (_stale.json, _candidates.json) each month. Nobody merges a
// file snapshot: #1369, #1504 and #2061 were all closed unmerged, and the queue
// on main stopped at 2026-09-01. An issue is read where it is, and this one
// names the reason for each brief: the stories that named it, or how long
// since it was reviewed.
//
// The body carries no run date, so a day with nothing new edits nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubRequest } from '../coho/open-reminders.mjs';

export const LABEL = 'brief-review';
export const MARKER = '<!-- brief-review-queue -->';
export const TITLE = 'Jurisdiction briefs to review';
const SITE = 'https://cohoanalytics.com/developer-brief.html?geoid=';
const STORIES_SHOWN = 8;
const MATCH = { place: '', in_county: ' (a town in the county)', county: ' (its county)' };

export const md = (s) => String(s == null ? '' : s).replace(/([\\[\]|*_`<>])/g, '\\$1');

function storyLine(s) {
  const head = s.link ? `[${md(s.title)}](${s.link})` : md(s.title);
  return `- ${s.date} · ${head} — ${md(s.source || 'Unknown publisher')}${MATCH[s.match] || ''}${s.unread ? ' · not read yet: open it by hand, then mark it used or dismissed' : ''}`;
}

function eventLine(e) {
  const when = e.end && e.end !== e.start ? `${e.start} to ${e.end}` : e.start;
  const head = e.url ? `[${md(e.title)}](${e.url})` : md(e.title);
  return `- ${when} · ${head}${e.organizer ? ` — ${md(e.organizer)}` : ''}${e.location ? `, ${md(e.location)}` : ''}`;
}

function briefName(b) {
  return b.published ? `[${md(b.jurisdiction)}](${SITE}${b.geoid})` : md(b.jurisdiction);
}

export function issueBody(queue) {
  const briefs = queue.briefs || [];
  const withNews = briefs.filter((b) => b.stories.length);
  const rest = briefs.filter((b) => !b.stories.length);
  const out = [MARKER, '',
    'Which jurisdiction briefs have something new, and why. Rewritten by the daily news run '
    + '(`weekly_housing_brief.yml`) from `data/alerts/brief-news-queue.json`; the same stories show '
    + 'at the bottom of each brief on the site.', '',
    'Headlines are leads, not sources. A brief claim still needs the article itself and its quote in '
    + '`data/jurisdiction-briefs/_verified/`.', ''];
  out.push(`## News since the last review (${withNews.length})`, '');
  if (withNews.some((b) => b.stories.some((s) => s.unread))) out.push('Stories marked "not read yet" are older leads nobody could read at the last review; they stay here until someone does.', '');
  if (!withNews.length) out.push('No brief has news since its last review.', '');
  for (const b of withNews) {
    out.push(`### ${briefName(b)} · ${b.reasons.join('; ')}`, '');
    out.push(...b.stories.slice(0, STORIES_SHOWN).map(storyLine));
    if (b.stories.length > STORIES_SHOWN) out.push(`- …and ${b.stories.length - STORIES_SHOWN} more on the brief page.`);
    if (b.events.length) out.push('', 'Upcoming here:', ...b.events.map(eventLine));
    out.push('');
  }
  out.push(`## Every other brief (${rest.length})`, '', '| Brief | On the site | Last reviewed | Why |', '|---|---|---|---|');
  for (const b of rest) {
    out.push(`| ${briefName(b)} | ${b.published ? 'yes' : 'draft'} | ${b.last_curated || 'never'} | ${md(b.reasons.join('; ') || 'nothing new')} |`);
  }
  out.push('', '## How a story leaves this list', '',
    '- **Use it.** Ask Claude in the project to update the brief from it. Claude fetches the article, drafts the '
    + 'change with its quote in `_verified/`, and opens a PR for review. Recording the story in '
    + '`data/jurisdiction-briefs/_news-used.json` as `used` is part of that PR.',
    '- **Dismiss it.** Record it in `_news-used.json` as `dismissed`, with a one-line reason.',
    '- **Re-review the brief.** Moving its `last_curated` date forward clears every story before that date.', '');
  const cands = queue.candidates || [];
  if (cands.length) {
    out.push(`<details><summary>Places that should have a brief and do not (${queue.candidate_count}), largest first</summary>`, '');
    out.push(...cands.map((c) => `- ${md(c.name)} (${c.geoid}), population ${Number.isFinite(c.population) ? c.population.toLocaleString('en-US') : 'unknown'}`));
    if (queue.candidate_count > cands.length) out.push(`- …and ${queue.candidate_count - cands.length} more: \`python3 scripts/list-brief-candidates.py\``);
    out.push('', '</details>', '');
  }
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = resolve(args.find((a) => !a.startsWith('--')) || 'data/alerts/brief-news-queue.json');
  const body = issueBody(JSON.parse(readFileSync(file, 'utf8')));
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'pggLLC/Housing-Analytics';
  if (dryRun || !token) { console.log(`DRY RUN: ${TITLE}\n${body}`); return; }
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('The review issue is written only from main; use --dry-run.');
  const open = (await githubRequest(token, `/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`))
    .filter((i) => !i.pull_request && String(i.body || '').startsWith(MARKER));
  if (open.length) {
    const [issue] = open;
    if (issue.body === body) { console.log(`No change to ${issue.html_url}`); return; }
    await githubRequest(token, `/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: { body } });
    console.log(`Updated ${issue.html_url}`);
    return;
  }
  try {
    await githubRequest(token, `/repos/${repo}/labels/${LABEL}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await githubRequest(token, `/repos/${repo}/labels`, { method: 'POST', body: {
      name: LABEL, color: '1d76db', description: 'Jurisdiction briefs with news to review',
    } });
  }
  const created = await githubRequest(token, `/repos/${repo}/issues`, { method: 'POST', body: {
    title: TITLE, body, labels: [LABEL], assignees: ['paulglasow'],
  } });
  console.log(`Opened ${created.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
