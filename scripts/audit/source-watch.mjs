#!/usr/bin/env node
// Source watch (report-only): checks the official sources behind the research
// and policy records and reports which ones actually say something new.
//
// Why: the policy, legislation, incentive and program records are verified by
// hand and carry a review_by date (policy-review-reminders.mjs). Nothing told
// us when a source changed between those dates, and nothing told us a source
// had NOT changed, so every record came due on the calendar whether or not
// there was anything to re-check. paul asked (2026-11-01) that sources be
// checked often and that a pull request be made only when a source is new.
//
// This first stage only reports. It writes a JSON report and a Markdown
// summary for the workflow run. It opens no issue, makes no commit and edits
// no record, so a week of runs shows how noisy the check is before anything
// acts on it.
//
// What it watches: every record source in the policy review files
// (policy-review-reminders.mjs FILES, the same list that raises "review due"),
// plus the research publishers on research-brief.html. Pages the daily
// funding watch already reads (data/audit/funding-watch.json) are skipped.
//
// How a change is told apart from noise, cheapest step first:
//   1. Headers. A page is fetched with If-None-Match / If-Modified-Since from
//      the last run; a 304 means unchanged. A document (PDF, Word, Excel) is
//      only ever asked for its headers (HEAD), never downloaded (paul's rule,
//      2026-10-16: no daily document downloads); a changed ETag, Last-Modified
//      or length is reported as a document change.
//   2. Text hash. SHA-256 of the page's readable text, with scripts, styles,
//      navigation and "last updated" stamps stripped. Same hash: unchanged.
//   3. Key lines. A new hash counts as a change only when a line carrying a
//      date, a dollar amount, a bill or program status word, or an edition or
//      version changed. Anything else is reported as cosmetic.
//
// How often: bills (leg.colorado.gov) daily from January 1 to May 15 and
// weekly the rest of the year; everything else weekly; any record whose
// review_by or a deadline, hearing or vote date falls within the next 14 days
// daily. The workflow runs daily and each run checks only the sources due.
//
// Usage:
//   node scripts/audit/source-watch.mjs --repo-root . --state state.json \
//        --report report.json [--summary-md summary.md] [--now ISO] [--all]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILES, sourceOf, checkedOf } from './policy-review-reminders.mjs';

export const SCHEMA = 'source-watch/1';
// Bump whenever KEY_LINE_RE, STAMP_RE or keyLines() changes: a page stored under
// another version is re-baselined on its key lines, not reported (the funding
// watch flooded the daily audit on 2026-10-17 when its pattern widened unversioned).
export const KEY_LINES_VERSION = 1;
export const DAY_MS = 86_400_000;
export const SESSION_END = '05-15'; // Colorado's 120-day session ends in early May.
export const NEAR_DAYS = 14;
export const UNREACHABLE_AFTER_DAYS = 3;
const TIMEOUT_MS = 30_000;
const RUN_BUDGET_MS = 15 * 60_000;
const MAX_BYTES = 8_000_000;
const MAX_KEY_LINES = 300;
const KEY_LINE_CHARS = 300;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/128.0 Safari/537.36 (+https://cohoanalytics.com source-watch.mjs)';

// Research publishers shown on research-brief.html and the State of the Nation's
// Housing figures. Not in the review files, so listed here.
export const EXTRA = [
  { file: 'data/policy/research-orgs-housing.json', key: 'orgs', title: 'Research organizations',
    page: 'research-brief.html', kind: 'research', name: (r) => r.name || r.id, source: (r) => r.url },
  { file: 'data/policy/jchs-state-of-nations-housing.json', single: 'meta', title: "State of the Nation's Housing",
    page: 'research-brief.html', kind: 'research', name: (r) => r.title || r.source || 'JCHS', source: (r) => r.source_url },
];

const DOC_RE = /\.(pdf|docx?|xlsx?|xlsm|pptx?|csv|zip)(?:$|[?#])|\/getattachment\/|\/DocumentCenter\/View\/|\/download(?:$|[/?#])|[/_-](pdf|docx?|xlsx?)(?:$|[?#])|\/(api\/)?\w*download\w*\//i;
// A response that is not a web page (a PDF served from an address with no file
// extension) is compared by its headers, like a document, and remembered as one.
const PAGE_TYPE_RE = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

export const KEY_LINE_RE = new RegExp([
  String.raw`\$\s?\d`,
  String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
  String.raw`\b20\d\d-\d{1,2}-\d{1,2}\b`,
  String.raw`\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+(\d{1,2}|20\d\d)\b`,
  // Bill and rule status.
  String.raw`\b(introduced|passed|signed|vetoed|enacted|became law|effective|adopted|amended|repealed|postponed indefinitely|referred|lost|failed|governor|session law|chapter \d+|hearing|vote[ds]?)\b`,
  // Programs and rounds.
  String.raw`\b(rounds?|cycles?|nofas?|nofos?|notice of funding|deadlines?|due|open(s|ed)?|clos(e|ed|es|ing)|accepting|awards?|awarded|allocations?|funding available|application (period|window))\b`,
  // Editions of research and rules.
  String.raw`\b(edition|version|volume|vintage)\b`,
].join('|'), 'i');
const STAMP_RE = /\b(printed|retrieved|accessed|up to date as of|(last|page) (updated|modified|reviewed)|updated (on|as of)|copyright|©|all rights reserved)\b/i;
const STAMP_KEEP_RE = /\$\s?\d|\b(signed|vetoed|enacted|effective|adopted|deadlines?|due|rounds?|cycles?|awards?|edition)\b/i;

const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// A stored source can carry a note after the address ("https://… (redirects to …)").
const cleanUrl = (u) => String(u || '').trim().split(/\s/, 1)[0].split('#', 1)[0];

// Hosts that refuse every scripted read (a JavaScript-only code library, or a
// bot wall). They are never fetched: each run lists them as "check by hand" in
// one line instead of a daily failure per record.
export const HAND_CHECK_HOSTS = {
  'library.municode.com': 'municipal code library loads its text with JavaScript and answers scripts with 403',
  'www.congress.gov': 'answers scripted requests with 403 (bot wall)',
  'www.novoco.com': 'answers scripted requests with 403 (equity-pricing-watch.mjs notes the same)',
};
// A home page churns with news and states nothing record-specific (the funding watch skips them too).
const isBareHomepage = (u) => { try { return ['', '/'].includes(new URL(u).pathname); } catch { return false; } };
// A news outlet in data/alerts/outlet-register.json. A dated story does not change
// when the fact does, so it is listed as needing a primary source, not watched.
export const isNewsHost = (u, domains) => {
  const h = hostOf(u).replace(/^www\./, '');
  return [...domains].some((d) => h === d || h.endsWith(`.${d}`));
};
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

/** The page's main content when it marks one (<main>, else <article>), so rotating
 *  sidebars, related-story lists and menus outside it never read as a change. */
export function mainHtml(html) {
  const s = String(html || '');
  for (const tag of ['main', 'article']) {
    const open = s.search(new RegExp(`<${tag}\\b`, 'i'));
    const close = s.toLowerCase().lastIndexOf(`</${tag}>`);
    if (open >= 0 && close > open) return s.slice(open, close + tag.length + 3);
  }
  return s;
}

/** Readable text of an HTML page, one block per line. */
export function pageText(html) {
  let s = mainHtml(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(head|nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/?(p|div|li|tr|h[1-6]|td|th|section|article|main|dd|dt|ul|ol|table|body))\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // One pass, so "&amp;lt;" becomes "&lt;" and is not decoded twice.
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
      const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
      if (named !== undefined) return named;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n === 160 ? ' ' : (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);
    });
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** The text that is hashed: page text without stamp lines that change on their own. */
export function hashedText(text) {
  return text.split('\n').filter((l) => !(STAMP_RE.test(l) && !STAMP_KEEP_RE.test(l))).join('\n');
}

/** Lines carrying a date, an amount, a status word or an edition, deduplicated. */
export function keyLines(text) {
  const out = []; const seen = new Set();
  for (let ln of text.split('\n')) {
    if (ln.length < 4 || !KEY_LINE_RE.test(ln)) continue;
    if (STAMP_RE.test(ln) && !STAMP_KEEP_RE.test(ln)) continue;
    if (ln.length > KEY_LINE_CHARS) ln = `${ln.slice(0, KEY_LINE_CHARS - 20)} … [${sha256(ln).slice(0, 12)}]`;
    if (!seen.has(ln)) { seen.add(ln); out.push(ln); }
    if (out.length >= MAX_KEY_LINES) break;
  }
  return out;
}

export function lineDiff(oldLines = [], newLines = []) {
  const o = new Set(oldLines); const n = new Set(newLines);
  return { added: newLines.filter((l) => !o.has(l)), removed: oldLines.filter((l) => !n.has(l)) };
}

const recordsOf = (spec, doc) => {
  if (spec.single) return doc && doc[spec.single] ? [{ id: spec.single, ...doc[spec.single] }] : [];
  const rs = doc ? doc[spec.key] : null;
  if (Array.isArray(rs)) return rs;
  return Object.entries(rs || {}).map(([id, r]) => ({ id, ...(r || {}) }));
};

/** Dates within a record that mean "check it sooner": review_by and any deadline, hearing or vote. */
export function urgentDates(record) {
  const out = [];
  const walk = (v, key, depth) => {
    if (depth > 4 || v == null) return;
    if (typeof v === 'string') {
      if (/(review_by|deadline|due|hearing|vote|closes|close_date|open_date|opens)/i.test(key || '') && isoDay(v)) out.push(isoDay(v));
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(record, '', 0);
  return out;
}

/** Every source to watch, one per URL, naming the records it stands for. */
export function buildTargets(docs, { skipUrls = new Set(), specs = [...FILES, ...EXTRA], newsDomains = new Set() } = {}) {
  const byUrl = new Map();
  for (const spec of specs) {
    for (const r of recordsOf(spec, docs[spec.file])) {
      const url = cleanUrl(spec.source ? spec.source(r) : sourceOf(spec, r));
      if (!/^https:\/\//i.test(url) || skipUrls.has(url)) continue;
      const t = byUrl.get(url) || { url, kind: 'agency', document: DOC_RE.test(url), records: [], urgent: [] };
      if (spec.kind === 'research' && !t.records.length) t.kind = 'research';
      if (/^https:\/\/leg\.colorado\.gov\//i.test(url)) t.kind = 'legislation';
      if (isNewsHost(url, newsDomains)) t.kind = 'news';
      t.records.push({ file: spec.file, id: r.id ?? null, name: String(spec.name(r) || '').slice(0, 160), page: spec.page,
        last_checked: isoDay(spec.single ? r.last_verified : checkedOf(spec, r)), review_by: isoDay(r.review_by) });
      t.urgent.push(...urgentDates(r));
      byUrl.set(url, t);
    }
  }
  return [...byUrl.values()].map((t) => ({ ...t, urgent: [...new Set(t.urgent)].sort() }));
}

/** Days between checks for a target on a given Denver date. */
export function intervalDays(target, today) {
  const horizon = new Date(Date.parse(today) + NEAR_DAYS * DAY_MS).toISOString().slice(0, 10);
  if (target.urgent.some((d) => d >= today && d <= horizon)) return 1;
  if (target.kind === 'legislation') {
    const md = today.slice(5);
    return md <= SESSION_END ? 1 : 7;
  }
  return 7;
}

export function isDue(target, prev, now, today) {
  if (!prev || !prev.checked_at) return true;
  if (prev.ok === false) return true; // a failing source is retried every run
  // Two hours of slack, so a run that lands a little earlier than yesterday's still counts.
  return Date.parse(now) - Date.parse(prev.checked_at) >= intervalDays(target, today) * DAY_MS - 2 * 3_600_000;
}

export async function httpFetch(url, { method = 'GET', headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers } });
    const h = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
    let body = '';
    if (method !== 'HEAD' && res.status !== 304) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
      body = buf.toString('utf8');
    }
    return { status: res.status, headers: h, body, url: res.url || url };
  } finally { clearTimeout(timer); }
}

const CHALLENGE_RE = /just a moment|attention required|access denied|are you a robot|captcha|request rejected/i;

/** Check one source. Returns { entry, outcome, detail }. Outcomes: baseline,
 *  unchanged-headers, unchanged-text, cosmetic, changed, failed. */
export async function checkSource(target, prev = {}, fetcher, now) {
  const base = { url: target.url, kind: target.kind, document: target.document, checked_at: now };
  const keep = ['etag', 'last_modified', 'content_length', 'text_sha256', 'key_lines', 'key_lines_version', 'last_changed_at', 'title', 'served_as_document'];
  const carried = Object.fromEntries(keep.filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]]));
  const fail = (error) => {
    const first = (prev.ok === false && prev.first_failed_at) || now;
    const days = Math.floor((Date.parse(now) - Date.parse(first)) / DAY_MS);
    return { entry: { ...base, ...carried, ok: false, error, first_failed_at: first,
      unverifiable: days >= UNREACHABLE_AFTER_DAYS - 1 }, outcome: 'failed', detail: { error } };
  };
  const firstSight = !prev.checked_at || (!prev.text_sha256 && !prev.etag && !prev.last_modified && !prev.content_length);
  let res;
  try {
    if (target.document || prev.served_as_document) {
      res = await fetcher(target.url, { method: 'HEAD' });
      if (res.status === 405 || res.status === 501) return fail(`HEAD not allowed (HTTP ${res.status}); documents are never downloaded`);
    } else {
      const cond = {};
      if (prev.ok !== false && prev.etag) cond['If-None-Match'] = prev.etag;
      if (prev.ok !== false && prev.last_modified) cond['If-Modified-Since'] = prev.last_modified;
      res = await fetcher(target.url, { headers: cond });
    }
  } catch (e) {
    return fail(`${e.name || 'Error'}: ${e.message}`);
  }
  if (res.status >= 400) return fail(`HTTP ${res.status}`);
  // Some servers (CivicPlus DocumentCenter) stamp Last-Modified with the time of the
  // request, so it changes on every read; a stamp within an hour of now is ignored.
  const lm = res.headers['last-modified'] || null;
  const dynamicLm = lm && Math.abs(Date.parse(lm) - Date.parse(now)) < 3_600_000;
  const headerBits = { etag: res.headers.etag || null, last_modified: dynamicLm ? null : lm,
    content_length: res.headers['content-length'] || null };
  const okEntry = (extra) => ({ ...base, ...carried, ok: true, unverifiable: false, http_status: res.status, ...extra });

  if (res.status === 304) {
    return { entry: okEntry({}), outcome: 'unchanged-headers', detail: {} };
  }
  const ctype = res.headers['content-type'] || '';
  const servedAsDocument = !target.document && (prev.served_as_document || (ctype && !PAGE_TYPE_RE.test(ctype)));
  if (target.document || servedAsDocument) {
    if (servedAsDocument) headerBits.served_as_document = true;
    const sig = [headerBits.etag, headerBits.last_modified, headerBits.content_length];
    if (!sig.some(Boolean)) return fail('document answers HEAD with no ETag, Last-Modified or length; check by hand');
    const entry = okEntry(headerBits);
    if (firstSight) return { entry, outcome: 'baseline', detail: {} };
    const before = [prev.etag, prev.last_modified, prev.content_length];
    // Compare only the headers both runs carried: a server that drops ETag one day is not a new document.
    const changed = sig.some((v, i) => v && before[i] && v !== before[i]);
    if (!changed) return { entry, outcome: 'unchanged-headers', detail: {} };
    entry.last_changed_at = now;
    return { entry, outcome: 'changed', detail: { headers: { before: { etag: prev.etag, last_modified: prev.last_modified, content_length: prev.content_length }, after: headerBits } } };
  }

  const title = ((res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (CHALLENGE_RE.test(title)) return fail(`bot challenge page ("${title.slice(0, 80)}")`);
  const text = pageText(res.body);
  if (!text) return fail(`empty page (HTTP ${res.status}, no text)`);
  const hash = sha256(hashedText(text));
  const kl = keyLines(text);
  const entry = okEntry({ ...headerBits, title, text_sha256: hash, key_lines: kl, key_lines_version: KEY_LINES_VERSION });
  if (firstSight || !prev.text_sha256) return { entry, outcome: 'baseline', detail: {} };
  if (prev.text_sha256 === hash) return { entry, outcome: 'unchanged-text', detail: {} };
  if ((prev.key_lines_version || 0) !== KEY_LINES_VERSION) return { entry, outcome: 'baseline', detail: { rebaselined: true } };
  const diff = lineDiff(prev.key_lines || [], kl);
  if (!diff.added.length && !diff.removed.length) return { entry, outcome: 'cosmetic', detail: {} };
  entry.last_changed_at = now;
  return { entry, outcome: 'changed', detail: { key_lines: diff } };
}

export async function run({ docs, state = {}, fetcher = httpFetch, now = new Date().toISOString(),
  skipUrls = new Set(), newsDomains = new Set(), all = false, budgetMs = RUN_BUDGET_MS, log = () => {}, specsOverride = null }) {
  const today = new Date(Date.parse(now) - 7 * 3_600_000).toISOString().slice(0, 10); // Mountain time, close enough for a due date
  const targets = buildTargets(docs, specsOverride ? { skipUrls, newsDomains, specs: specsOverride } : { skipUrls, newsDomains });
  const prevSources = (state && state.sources) || {};
  const sources = {};
  const results = [];
  const started = Date.now();
  // Never-checked sources first, then the longest unchecked, and failing sources
  // last, so failures that eat the run time cannot keep the rest unchecked.
  const rank = (t) => { const p = prevSources[t.url]; return !p || !p.checked_at ? [0, ''] : [p.ok === false ? 2 : 1, p.checked_at]; };
  targets.sort((a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1].localeCompare(y[1]); });
  for (const t of targets) {
    const prev = prevSources[t.url];
    if (t.kind === 'news') { results.push({ url: t.url, outcome: 'hand-check', target: t, detail: { reason: 'news story, not a primary source; a dated story does not change when the fact does' } }); continue; }
    if (isBareHomepage(t.url)) { results.push({ url: t.url, outcome: 'hand-check', target: t, detail: { reason: 'source is a home page, not the page that states the fact' } }); continue; }
    if (HAND_CHECK_HOSTS[hostOf(t.url)]) { results.push({ url: t.url, outcome: 'hand-check', target: t, detail: { reason: HAND_CHECK_HOSTS[hostOf(t.url)] } }); continue; }
    if (!all && !isDue(t, prev, now, today)) { sources[t.url] = prev; continue; }
    if (Date.now() - started > budgetMs) { sources[t.url] = prev; results.push({ url: t.url, outcome: 'skipped-budget', target: t }); continue; }
    const { entry, outcome, detail } = await checkSource(t, prev || {}, fetcher, now);
    sources[t.url] = entry;
    results.push({ url: t.url, outcome, detail, target: t, interval_days: intervalDays(t, today), unverifiable: !!entry.unverifiable });
    log(`${outcome.padEnd(17)} ${t.url}`);
  }
  const counts = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  return {
    state: { schema: SCHEMA, generated_at: now, key_lines_version: KEY_LINES_VERSION, sources },
    report: { schema: `${SCHEMA}-report`, generated_at: now, mode: 'report-only', watched: targets.length,
      checked: results.filter((r) => !['skipped-budget', 'hand-check'].includes(r.outcome)).length, counts,
      changed: results.filter((r) => r.outcome === 'changed'),
      failed: results.filter((r) => r.outcome === 'failed'),
      cosmetic: results.filter((r) => r.outcome === 'cosmetic').map((r) => r.url),
      hand_check: results.filter((r) => r.outcome === 'hand-check').map((r) => ({ url: r.url, reason: r.detail.reason,
        records: r.target.records.map((x) => `${x.file}#${x.id}`) })),
      unverified_after_full_compare: results.filter((r) => r.outcome === 'unchanged-text').length },
  };
}

const md = (s) => String(s ?? '').replace(/[|\\`*_<>[\]]/g, (c) => `\\${c}`);

export function summaryMarkdown(report) {
  const c = report.counts;
  const lines = [
    `# Source watch (report only): ${report.generated_at.slice(0, 16)}Z`, '',
    `${report.watched} sources watched, ${report.checked} checked this run. Nothing was opened, committed or edited.`, '',
    '| Result | Sources |', '|---|---|',
    ...[['changed', 'Changed (a date, amount, status or edition line moved)'], ['cosmetic', 'Cosmetic (text changed, no key line did)'],
      ['unchanged-text', 'Unchanged, full text compared'], ['unchanged-headers', 'Unchanged, headers only'],
      ['baseline', 'First sighting (baseline)'], ['failed', 'Failed to load'], ['hand-check', 'Check by hand (host refuses scripts)'],
      ['skipped-budget', 'Not reached (run time limit)']]
      .map(([k, label]) => `| ${label} | ${c[k] || 0} |`),
    '',
  ];
  if (report.changed.length) {
    lines.push('## Changed', '');
    for (const r of report.changed) {
      const recs = r.target.records.map((x) => `${md(x.name)} (\`${x.file}\`${x.id ? `#${x.id}` : ''})`).join('; ');
      lines.push(`- ${r.url}`, `  - records: ${recs}`);
      const d = r.detail || {};
      if (d.key_lines) {
        for (const l of d.key_lines.added.slice(0, 8)) lines.push(`  - added: ${md(l)}`);
        for (const l of d.key_lines.removed.slice(0, 8)) lines.push(`  - removed: ${md(l)}`);
        const more = d.key_lines.added.length + d.key_lines.removed.length - Math.min(8, d.key_lines.added.length) - Math.min(8, d.key_lines.removed.length);
        if (more > 0) lines.push(`  - and ${more} more lines (see the report artifact)`);
      }
      if (d.headers) lines.push(`  - document headers changed: ${md(JSON.stringify(d.headers.before))} → ${md(JSON.stringify(d.headers.after))}`);
    }
    lines.push('');
  }
  if (report.hand_check && report.hand_check.length) {
    const byReason = {};
    for (const r of report.hand_check) (byReason[r.reason] ||= []).push(r.url);
    lines.push('## Check by hand', '');
    for (const [reason, urls] of Object.entries(byReason)) lines.push(`- ${urls.length} source${urls.length === 1 ? '' : 's'}: ${md(reason)}`);
    lines.push('');
  }
  const unver = report.failed.filter((r) => r.unverifiable);
  if (unver.length) {
    lines.push(`## Failing for ${UNREACHABLE_AFTER_DAYS}+ days (would be flagged for a check by hand)`, '');
    for (const r of unver) lines.push(`- ${r.url}: ${md(r.detail.error)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function readDocs(root) {
  const files = [...new Set([...FILES, ...EXTRA].map((s) => s.file))];
  return Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(resolve(root, f), 'utf8'))]));
}

export function newsDomainsOf(root) {
  const p = resolve(root, 'data/alerts/outlet-register.json');
  if (!existsSync(p)) return new Set();
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return new Set((j.outlets || []).flatMap((o) => o.domains || []).map((d) => String(d).toLowerCase().replace(/^www\./, '')));
}

export function fundingWatchUrls(root) {
  const p = resolve(root, 'data/audit/funding-watch.json');
  if (!existsSync(p)) return new Set();
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return new Set((j.pages || []).map((x) => cleanUrl(x.url)));
}

async function main(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const root = resolve(arg('--repo-root', '.'));
  const statePath = arg('--state');
  const reportPath = arg('--report');
  const summaryPath = arg('--summary-md');
  let state = {};
  if (statePath && existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; }
    if (state.schema !== SCHEMA) state = {};
  }
  const { state: next, report } = await run({ docs: readDocs(root), state, now: arg('--now', new Date().toISOString()),
    skipUrls: fundingWatchUrls(root), newsDomains: newsDomainsOf(root), all: argv.includes('--all'), log: (s) => console.log(s) });
  if (statePath) writeFileSync(statePath, `${JSON.stringify(next)}\n`);
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = summaryMarkdown(report);
  if (summaryPath) writeFileSync(summaryPath, summary);
  console.log(`\n${report.watched} watched, ${report.checked} checked: ${JSON.stringify(report.counts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
