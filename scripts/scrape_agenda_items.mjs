#!/usr/bin/env node
/**
 * scrape_agenda_items.mjs  (F169b, 2026-06-04)
 *
 * For each curated jurisdiction in data/hna/local-resources.json that
 * HAS a `council_agenda_url`, fetches the page and extracts recent
 * housing-related agenda items. No DOM library — plain fetch + regex.
 *
 * Civic Plus AgendaCenter pages emit a visible HTML table with rows
 * containing date + title + a link to the packet/agenda PDF. Granicus
 * pages expose ViewPublisher.php which we parse the same way; the JSON
 * archive endpoint exists but isn't documented and varies per tenant,
 * so we stick with the public HTML.
 *
 * Output:
 *   data/town-agendas.json — { jurisdictions: [{ key, geoid, name,
 *     source_url, platform, fetched_at, recent_items: [{date,title,url}] }] }
 *
 * CLI:
 *   node scripts/scrape_agenda_items.mjs           # write file
 *   node scripts/scrape_agenda_items.mjs --dry     # don't write
 *   node scripts/scrape_agenda_items.mjs --limit 5
 *
 * Exit codes:
 *   0 — completed
 *   2 — script-level failure
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_RESOURCES = path.join(ROOT, 'data', 'hna', 'local-resources.json');
const CENTROIDS = path.join(ROOT, 'data', 'co-place-centroids.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'town-agendas.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const MAX_ITEMS_PER_JURISDICTION = 12;
const USER_AGENT =
  'CohoAgendaScraperBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

/* ── Keywords ─────────────────────────────────────────────────────── */

const HOUSING_KEYWORDS = [
  'affordable',
  'workforce',
  'attainable',
  'housing',
  'adu',
  'inclusionary',
  'zoning',
  'rezone',
  'comp plan',
  'comprehensive plan',
  'linkage fee',
];

const KEYWORD_RE = new RegExp(
  '\\b(' + HOUSING_KEYWORDS.map((k) => k.replace(/ /g, '\\s+')).join('|') + ')\\b',
  'i'
);

/* ── Helpers ──────────────────────────────────────────────────────── */

function detectPlatform(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('granicus.com') || u.includes('legistar.com')) return 'granicus';
  if (u.includes('/agendacenter')) return 'civicplus';
  return 'custom';
}

function absolutize(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch (_) {
    return null;
  }
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

// Match common date formats inside the snippet around a row. We don't
// try to be exhaustive — we just want SOMETHING resolvable. Returns
// ISO date (YYYY-MM-DD) or null.
function extractDate(snippet) {
  if (!snippet) return null;

  // ISO
  let m = snippet.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (m) {
    const yyyy = m[1];
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // M/D/YYYY or MM/DD/YYYY
  m = snippet.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  if (m) {
    return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }

  // "Month DD, YYYY"
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07',
    aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
  };
  m = snippet.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  );
  if (m) {
    const mm = months[m[1].toLowerCase()] || '01';
    return `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`;
  }

  return null;
}

/* ── Fetch ────────────────────────────────────────────────────────── */

async function fetchPage(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status, body: null, finalUrl: res.url || url };
    const body = await res.text();
    return { ok: true, status: res.status, body, finalUrl: res.url || url };
  } catch (err) {
    clearTimeout(t);
    return { ok: false, status: null, body: null, finalUrl: null, error: String(err).slice(0, 120) };
  }
}

/* ── Parse: extract anchor candidates from HTML, filter to housing ──
 * We scan ALL <a href> tags in the body. For each, capture a small
 * "context window" of surrounding HTML to pull a date from. We then
 * decode the link text + context, check the keyword regex, and if it
 * matches, emit { date, title, url }.
 *
 * This works for Civic Plus AgendaCenter (whose rows are tables of
 * <a> + adjacent date cells) and Granicus ViewPublisher (mostly
 * the same structure but inside <tr> instead of CivicPlus's <div>).
 *
 * Custom sites are hit-or-miss; we still try, and if we get zero
 * matches that's fine — the script records 0 items, the maintainer
 * sees that and can hand-curate.
 * ───────────────────────────────────────────────────────────────── */

function extractItems(html, baseUrl) {
  if (!html) return [];
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const items = [];
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (!text || text.length < 4 || text.length > 250) continue;

    // Skip nav junk
    if (/^(home|next|previous|prev|menu|skip|login|sign\s+in|search)$/i.test(text)) continue;

    // Pull a small context window (200 chars on each side of the link)
    const start = Math.max(0, m.index - 240);
    const end = Math.min(html.length, m.index + m[0].length + 240);
    const context = stripTags(html.slice(start, end));

    const haystack = (text + ' ' + context).toLowerCase();
    if (!KEYWORD_RE.test(haystack)) continue;

    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const date = extractDate(context) || extractDate(text);
    items.push({ date, title: text, url: abs });
  }
  // De-dup by title too (CivicPlus often links the same row 2x)
  const byTitle = new Map();
  for (const it of items) {
    const k = it.title.toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, it);
  }
  // Sort by date desc, undated last
  const sorted = [...byTitle.values()].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return 0;
  });
  return sorted.slice(0, MAX_ITEMS_PER_JURISDICTION);
}

/* ── Pool ─────────────────────────────────────────────────────────── */

async function pool(items, n, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/* ── Main ─────────────────────────────────────────────────────────── */

async function main() {
  const [lrRaw, centRaw] = await Promise.all([
    fs.readFile(LOCAL_RESOURCES, 'utf8'),
    fs.readFile(CENTROIDS, 'utf8'),
  ]);
  const lr = JSON.parse(lrRaw);
  const cent = JSON.parse(centRaw);
  const byGeoid = cent.byGeoid || {};

  const targets = [];
  for (const [key, val] of Object.entries(lr)) {
    if (!val || typeof val !== 'object') continue;
    const agenda = val.council_agenda_url;
    if (!agenda) continue;
    const [scope, geoid] = key.split(':');
    let name = null;
    if (scope === 'place') name = byGeoid[geoid]?.name || null;
    else name = key;                     // counties / states fall back to key
    targets.push({
      key, geoid, name: name || key,
      source_url: agenda,
      platform: detectPlatform(agenda),
    });
    if (targets.length >= LIMIT) break;
  }

  console.log(`[scrape-agendas] ${targets.length} jurisdictions with council_agenda_url`);

  const results = await pool(targets, CONCURRENCY, async (t) => {
    const fetched = await fetchPage(t.source_url);
    if (!fetched.ok) {
      return {
        ...t,
        fetched_at: NOW,
        fetch_status: fetched.status,
        fetch_error: fetched.error || null,
        recent_items: [],
      };
    }
    const items = extractItems(fetched.body, fetched.finalUrl || t.source_url);
    return {
      ...t,
      fetched_at: NOW,
      fetch_status: fetched.status,
      recent_items: items,
    };
  });

  const totalItems = results.reduce((s, r) => s + (r.recent_items?.length || 0), 0);
  const withItems  = results.filter((r) => (r.recent_items?.length || 0) > 0).length;

  const out = {
    generatedAt: NOW,
    source: 'scripts/scrape_agenda_items.mjs',
    keywords: HOUSING_KEYWORDS,
    jurisdictionsScraped: results.length,
    jurisdictionsWithItems: withItems,
    totalHousingItems: totalItems,
    jurisdictions: results,
  };

  if (!DRY_RUN) {
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`[scrape-agendas] wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  } else {
    console.log('[scrape-agendas] --dry — no file written');
  }

  // Per-jurisdiction summary line
  for (const r of results) {
    const n = r.recent_items?.length || 0;
    console.log(`  ${r.platform.padEnd(9)}  ${r.name.padEnd(28)}  ${n} item(s)  ${r.source_url}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `# Agenda Item Scrape — ${NOW.slice(0, 10)}`,
      '',
      `- Jurisdictions scraped: **${results.length}**`,
      `- Jurisdictions with housing-related items: **${withItems}**`,
      `- Total housing-related items: **${totalItems}**`,
      '',
      '| Platform | Place | # Items | Source |',
      '|---|---|---:|---|',
      ...results.map((r) => `| ${r.platform} | ${r.name} | ${r.recent_items?.length || 0} | ${r.source_url} |`),
      '',
    ].join('\n');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }
}

main().catch((err) => {
  console.error('[scrape-agendas] fatal:', err);
  process.exit(2);
});
