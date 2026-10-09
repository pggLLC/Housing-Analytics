#!/usr/bin/env node
// Keeps data/market/novogradac-equity-pricing.json honest between hand updates.
//
// Novogradac publishes LIHTC equity pricing behind a bot wall (Cloudflare
// answers every scripted request with a challenge page), so the benchmark is
// entered by hand from a saved copy of its pages. Two things can go wrong with
// a hand-entered file, and this script opens an issue for each:
//
//   1. Reminder. The file states when Novogradac's next quarter is expected
//      (meta.next_expected_update). From LEAD_DAYS before that date, one issue
//      per vintage asks a person to capture the new figures.
//   2. Cross-check. CohnReznick's Tax Credit Advisor publishes a monthly
//      Housing Tax Credit Monitor as a public PDF, with a surveyed median net
//      equity price. It is one blended national number (no 9%/4% split, no
//      regions), so it cannot replace Novogradac, but it can say the file has
//      drifted: when the monitor's median sits more than DRIFT_TOLERANCE
//      outside the file's national 9%–4% range, one issue per monitor edition.
//
// Tax Credit Advisor answers GitHub-hosted runners with HTTP 403, so the
// script also tries the monitor's predictable upload URLs; when nothing can be
// read it opens a "not checked this month" issue instead of passing.
//
// Commits nothing. The monitor's median is a different measure (closed-deal
// median vs Novogradac's average letter-of-intent bid), so a gap is a prompt
// to re-check, not a correction to apply.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { denverDate, githubRequest } from '../coho/open-reminders.mjs';

export const LEAD_DAYS = 7;
export const DRIFT_TOLERANCE = 0.02;
export const LABEL = 'equity-pricing';
export const BENCHMARK = 'data/market/novogradac-equity-pricing.json';
export const MONITOR_INDEX = 'https://www.taxcreditadvisor.com/';
const UA = 'Mozilla/5.0 (compatible; COHO-equity-pricing-watch; +https://cohoanalytics.com)';

const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);
const money = (v) => '$' + v.toFixed(3).replace(/0$/, '');

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function markersFromIssues(issues) {
  return new Set(issues.flatMap(({ body }) =>
    [...(body || '').matchAll(/<!-- equity-pricing:[^\r\n]*? -->/g)].map(([m]) => m)));
}

/** Pure: the reminder issue due today for the benchmark's next vintage, or null. */
export function dueReminder(bench, todayDenver, markers = new Set(), leadDays = LEAD_DAYS) {
  const meta = (bench && bench.meta) || {};
  const next = isoDay(meta.next_expected_update);
  if (next && addDays(todayDenver, leadDays) < next) return null;
  const marker = `<!-- equity-pricing:reminder@${meta.vintage || 'unknown'} -->`;
  if (markers.has(marker)) return null;
  const pages = (meta.capture_pages || []).map((p) => `   - [${p.title}](${p.url})`);
  return {
    marker,
    title: `Capture new LIHTC equity pricing (after ${meta.vintage || 'unknown vintage'})`,
    body: [
      `The equity-pricing benchmark in \`${BENCHMARK}\` is vintage **${meta.vintage || 'unknown'}** ` +
        `(as of ${meta.as_of || 'unknown'}). Its next update was expected ${next ? `by **${next}**` : '— no date is set'}.`,
      '',
      '### What to capture',
      '1. In a browser (Novogradac blocks scripted requests), open and save as PDF:',
      ...(pages.length ? pages : ['   - Novogradac LIHTC equity pricing pages (see `meta.source_url`)']),
      '2. Attach the PDFs to a Claude thread, or enter the figures yourself:',
      '   - `pricing.national_avg` — the latest quarter\'s national 9% and 4% averages;',
      '   - `pricing.by_region` and `pricing.by_state` — the regional and state medians, exactly as published;',
      '   - append the quarter to `data/market/lihtc-equity-pricing-history.json` at the same national prices;',
      '   - set `meta.vintage`, `meta.as_of`, `meta.captured`, `meta.next_expected_update` and `validation_check.last_verified`.',
      '3. A figure the pages no longer state is `null`, never carried forward.',
      '',
      `Opened by \`scripts/audit/equity-pricing-watch.mjs\` (monthly). ${marker}`,
    ].join('\n'),
  };
}

/** Pure: the newest monitor PDF linked from the Tax Credit Advisor home page. */
export function findMonitorUrl(html) {
  const urls = [...String(html || '').matchAll(/href="(https:\/\/(?:www\.)?taxcreditadvisor\.com\/wp-content\/uploads\/[^"]*Housing-Tax-Credit-Monitor[^"]*\.pdf)"/gi)]
    .map((m) => m[1]);
  return urls[0] || null;
}

/** Pure: the surveyed median, deal count and period from the monitor's text. */
// Expects `pdftotext -layout` output: the text column is on the left and the
// trend chart's axis labels sit to its right, on the same lines or on lines
// of their own. Lines that start far right, and everything after a wide gap,
// are dropped before the sentence is read.
export function parseMonitor(text) {
  const flat = String(text || '').split('\n')
    .filter((line) => !/^\s{40,}/.test(line))
    .map((line) => line.replace(/(\S)\s{3,}\S.*$/, '$1'))
    .join(' ').replace(/\s+/g, ' ');
  const m = flat.match(/median housing credit net equity price [^$]{0,60}?\$(0\.\d{2,3}) across (\d+) surveyed properties for the period ([A-Z][a-z]+ \d{4}) [–-] ([A-Z][a-z]+ \d{4})/);
  if (!m) return null;
  const median = Number(m[1]);
  if (!(median > 0)) return null;
  return { median, properties: Number(m[2]), period: `${m[3]} – ${m[4]}` };
}

/** Pure: a drift issue when the monitor sits outside the benchmark's national range, or null. */
export function driftFinding(bench, monitor, url, markers = new Set(), tolerance = DRIFT_TOLERANCE) {
  const nat = bench && bench.pricing && bench.pricing.national_avg;
  const prices = [nat && nat.credit_9pct, nat && nat.credit_4pct].filter((v) => typeof v === 'number' && v > 0);
  if (!monitor || !prices.length) return null;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const gap = monitor.median < low ? low - monitor.median : monitor.median > high ? monitor.median - high : 0;
  if (gap <= tolerance + 1e-9) return null;
  const marker = `<!-- equity-pricing:drift@${monitor.period} -->`;
  if (markers.has(marker)) return null;
  const meta = bench.meta || {};
  return {
    marker,
    title: `Equity pricing check: CohnReznick median ${money(monitor.median)} vs benchmark ${money(low)}–${money(high)}`,
    body: [
      `CohnReznick's [Housing Tax Credit Monitor](${url}) reports a median net equity price of ` +
        `**${money(monitor.median)}** across ${monitor.properties} properties for ${monitor.period}.`,
      `The site's benchmark (\`${BENCHMARK}\`, vintage ${meta.vintage || 'unknown'}, as of ${meta.as_of || 'unknown'}) ` +
        `prices national credits at **${money(low)}–${money(high)}**: ${Math.round(gap * 1000) / 10}¢ apart, ` +
        `beyond the ${Math.round(tolerance * 100)}¢ tolerance.`,
      '',
      'The two are different measures (closed-deal median vs Novogradac\'s average letter-of-intent bid), so this is a ' +
        'prompt to re-check Novogradac, not a figure to copy in. If Novogradac has published a newer quarter, capture it; ' +
        'if it has not, note the gap in the file\'s `validation_check` and close this issue.',
      '',
      `Opened by \`scripts/audit/equity-pricing-watch.mjs\` (monthly). ${marker}`,
    ].join('\n'),
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/**
 * Pure: likely monitor URLs around a date, newest first. Each edition is named
 * for a month and uploaded in the month before (the October 2026 monitor sits
 * under uploads/2026/09/). Used when the home page cannot be read: Tax Credit
 * Advisor answers GitHub-hosted runners with HTTP 403.
 */
export function candidateMonitorUrls(todayIso) {
  const [y, m] = todayIso.split('-').map(Number);
  const urls = [];
  for (let offset = 1; offset >= -1; offset--) {
    const k = y * 12 + (m - 1) + offset; // the edition's month
    const up = k - 1; // its upload folder
    urls.push(`https://www.taxcreditadvisor.com/wp-content/uploads/${Math.floor(up / 12)}/${String(up % 12 + 1).padStart(2, '0')}/` +
      `TCA-Housing-Tax-Credit-Monitor_${MONTH_NAMES[k % 12]}_${Math.floor(k / 12)}.pdf`);
  }
  return urls;
}

async function fetchMonitor(todayIso, log) {
  const tried = [];
  let urls = [];
  try {
    const index = await fetch(MONITOR_INDEX, { headers: { 'User-Agent': UA } });
    if (!index.ok) throw new Error(`HTTP ${index.status}`);
    const found = findMonitorUrl(await index.text());
    if (found) urls.push(found);
    else tried.push(`${MONITOR_INDEX}: no monitor PDF linked`);
  } catch (error) {
    tried.push(`${MONITOR_INDEX}: ${error.message}`);
  }
  for (const u of candidateMonitorUrls(todayIso)) if (!urls.includes(u)) urls.push(u);
  for (const url of urls) {
    const pdf = await fetch(url, { headers: { 'User-Agent': UA } }).catch((e) => ({ ok: false, status: e.message }));
    const type = pdf.headers && pdf.headers.get('content-type');
    if (!pdf.ok || !/pdf/i.test(type || '')) { tried.push(`${url}: HTTP ${pdf.status}`); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tca-monitor-'));
    const file = path.join(dir, 'monitor.pdf');
    fs.writeFileSync(file, Buffer.from(await pdf.arrayBuffer()));
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    const monitor = parseMonitor(text);
    if (!monitor) { tried.push(`${url}: surveyed median not found in the PDF text (wording may have changed)`); continue; }
    log(`Monitor ${url}: median ${money(monitor.median)} across ${monitor.properties} properties, ${monitor.period}.`);
    return { url, monitor };
  }
  const error = new Error(`Could not read a CohnReznick Housing Tax Credit Monitor:\n  - ${tried.join('\n  - ')}`);
  error.tried = tried;
  throw error;
}

/** Pure: the issue that says the cross-check could not run this month, or null if already open. */
export function unreachableIssue(todayIso, tried, markers = new Set()) {
  const marker = `<!-- equity-pricing:monitor-unreachable@${todayIso.slice(0, 7)} -->`;
  if (markers.has(marker)) return null;
  return {
    marker,
    title: `Equity pricing cross-check could not read the CohnReznick monitor (${todayIso.slice(0, 7)})`,
    body: [
      'The monthly cross-check could not read CohnReznick\'s Housing Tax Credit Monitor, so the equity-pricing benchmark was **not** checked this month. This is not a pass.',
      '',
      ...tried.map((t) => `- ${t}`),
      '',
      'Open https://www.taxcreditadvisor.com/ in a browser, read the surveyed median net equity price from the latest monitor, and compare it with `pricing.national_avg` in `' + BENCHMARK + '`. If they are more than 2 cents apart, re-check Novogradac.',
      '',
      `Opened by \`scripts/audit/equity-pricing-watch.mjs\` (monthly). ${marker}`,
    ].join('\n'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') continue;
    if (args[i] === '--repo-root' && args[i + 1]) root = path.resolve(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const bench = JSON.parse(fs.readFileSync(path.join(root, BENCHMARK), 'utf8'));
  const todayDenver = denverDate();
  const repo = process.env.GITHUB_REPOSITORY || 'pggLLC/Housing-Analytics';
  const token = process.env.GITHUB_TOKEN;
  const api = token ? (p, o) => githubRequest(token, p, o) : null;
  if (!dryRun && process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Real issue creation is allowed only from the main workflow; use --dry-run.');
  }
  if (!dryRun && !api) throw new Error('GITHUB_TOKEN is required to open issues.');

  const existing = [];
  if (api) {
    for (let page = 1; ; page++) {
      const items = await api(`/repos/${repo}/issues?state=all&labels=${LABEL}&per_page=100&page=${page}`);
      existing.push(...items.filter((item) => !item.pull_request));
      if (items.length < 100) break;
    }
  }
  const markers = markersFromIssues(existing);

  const issues = [];
  const reminder = dueReminder(bench, todayDenver, markers);
  if (reminder) issues.push(reminder);
  else console.log(`${todayDenver}: no capture reminder due (next update ${bench.meta && bench.meta.next_expected_update}).`);

  // An unreadable monitor is reported as its own issue, never treated as "no drift".
  try {
    const { url, monitor } = await fetchMonitor(todayDenver, console.log);
    const drift = driftFinding(bench, monitor, url, markers);
    if (drift) issues.push(drift);
    else console.log('Monitor median is within tolerance of the benchmark (or already reported).');
  } catch (error) {
    console.log(`::warning::${error.message.split('\n')[0]}`);
    console.log(error.message);
    const unreachable = unreachableIssue(todayDenver, error.tried || [error.message], markers);
    if (unreachable) issues.push(unreachable);
  }

  if (dryRun) {
    for (const issue of issues) console.log(`DRY RUN: ${issue.title}\n${issue.body}\n`);
  } else if (issues.length) {
    try {
      await api(`/repos/${repo}/labels/${LABEL}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      await api(`/repos/${repo}/labels`, { method: 'POST', body: {
        name: LABEL, color: '0e8a16', description: 'LIHTC equity pricing benchmark due for capture or re-check',
      } });
    }
    for (const issue of issues) {
      const created = await api(`/repos/${repo}/issues`, { method: 'POST', body: {
        title: issue.title, body: issue.body, labels: [LABEL], assignees: ['paulglasow'],
      } });
      console.log(`Opened ${created.html_url}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
