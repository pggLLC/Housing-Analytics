#!/usr/bin/env node
/**
 * discover_agenda_urls.mjs  (F169a, 2026-06-04)
 *
 * Probes likely council-agenda URL patterns (Civic Plus / Granicus /
 * custom) for every curated jurisdiction in data/hna/local-resources.json
 * that still lacks a `council_agenda_url`. For each candidate URL it
 * issues a HEAD request (with GET fallback), follows redirects, and
 * accepts 200 / 301 / 302 as a "match".
 *
 * Output:
 *   - data/agenda-url-discovery-report.json   (machine-readable)
 *   - Markdown summary table written to stdout / step summary
 *
 * Companion to:
 *   - scripts/discover-local-resources.mjs   (probes top-level city sites)
 *   - .github/workflows/discover-agenda-urls.yml
 *
 * The OUTPUT is candidate URLs for human review — never auto-merged into
 * local-resources.json. Maintainer reviews + PRs.
 *
 * CLI:
 *   node scripts/discover_agenda_urls.mjs           # write report
 *   node scripts/discover_agenda_urls.mjs --dry     # don't write report file
 *   node scripts/discover_agenda_urls.mjs --limit 20
 *
 * Exit codes:
 *   0 — completed (regardless of how many matches found)
 *   2 — script-level failure
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_RESOURCES = path.join(ROOT, 'data', 'hna', 'local-resources.json');
const CENTROIDS = path.join(ROOT, 'data', 'co-place-centroids.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'agenda-url-discovery-report.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;          // Be polite to .gov sites
const USER_AGENT =
  'CohoAgendaDiscoveryBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

/* ── Slug helpers ─────────────────────────────────────────────────── */

function slugify(name) {
  return (name || '')
    .replace(/\s+(city|town|village|cdp)\b/i, '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
}

function candidateUrls(name) {
  const slug = slugify(name);
  if (!slug) return [];
  const noSpace = slug.replace(/[\s-]+/g, '');
  const hyphen  = slug.replace(/\s+/g, '-');
  const set = new Set([
    // Civic Plus AgendaCenter (most common in CO)
    `https://www.${noSpace}.org/AgendaCenter`,
    `https://www.${noSpace}.gov/AgendaCenter`,
    `https://www.${noSpace}.co.us/AgendaCenter`,
    // Granicus (Legistar-style hosted)
    `https://${noSpace}.granicus.com/ViewPublisher.php?view_id=1`,
    // Custom city-site agenda paths
    `https://www.${noSpace}.com/government`,
    `https://www.${noSpace}.gov/meetings`,
    `https://www.${noSpace}.org/meetings`,
    `https://www.cityof${noSpace}.com/agendas`,
  ]);
  if (hyphen !== noSpace) {
    set.add(`https://www.${hyphen}.org/AgendaCenter`);
    set.add(`https://www.${hyphen}.gov/AgendaCenter`);
  }
  return [...set];
}

/* ── Probe ────────────────────────────────────────────────────────── */

async function probe(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.status === 405 || res.status === 403) throw new Error('retry-get');
    } catch (_) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Range: 'bytes=0-2000',
        },
      });
    }
    clearTimeout(t);
    const ok = [200, 301, 302].includes(res.status);
    return { url, status: res.status, ok, finalUrl: res.url || url };
  } catch (err) {
    clearTimeout(t);
    return { url, status: null, ok: false, finalUrl: null, error: String(err).slice(0, 80) };
  }
}

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

  // Curated place keys missing council_agenda_url
  const targets = [];
  for (const [key, val] of Object.entries(lr)) {
    if (!key.startsWith('place:')) continue;
    if (!val || typeof val !== 'object') continue;
    if (val.council_agenda_url) continue;
    const geoid = key.split(':')[1];
    const name = byGeoid[geoid]?.name || null;
    if (!name) continue;             // Skip places we can't name-resolve
    targets.push({ key, geoid, name });
    if (targets.length >= LIMIT) break;
  }

  console.log(`[discover-agenda] ${targets.length} curated places missing council_agenda_url`);

  // Build (target, url) work items so we can pool across all candidates.
  const work = [];
  for (const t of targets) {
    for (const url of candidateUrls(t.name)) {
      work.push({ t, url });
    }
  }
  console.log(`[discover-agenda] probing ${work.length} candidate URLs at concurrency=${CONCURRENCY}`);

  const probed = await pool(work, CONCURRENCY, async (w) => ({
    ...w,
    result: await probe(w.url),
  }));

  // Aggregate per target — take the first OK match.
  const perTarget = new Map();
  for (const w of probed) {
    if (!perTarget.has(w.t.key)) {
      perTarget.set(w.t.key, { ...w.t, candidates: [], match: null });
    }
    const entry = perTarget.get(w.t.key);
    entry.candidates.push({
      url: w.url,
      status: w.result.status,
      ok: w.result.ok,
      finalUrl: w.result.finalUrl,
      error: w.result.error,
    });
    if (w.result.ok && !entry.match) entry.match = w.result.finalUrl || w.url;
  }

  const jurisdictions = [...perTarget.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const matchedCount = jurisdictions.filter((j) => j.match).length;

  const report = {
    generatedAt: NOW,
    source: 'scripts/discover_agenda_urls.mjs',
    totalsChecked: jurisdictions.length,
    matched: matchedCount,
    missing: jurisdictions.length - matchedCount,
    concurrency: CONCURRENCY,
    jurisdictions,
  };

  if (!DRY_RUN) {
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`[discover-agenda] wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  } else {
    console.log('[discover-agenda] --dry — no file written');
  }

  // Markdown summary
  const md = [];
  md.push(`# Council Agenda URL Discovery — ${NOW.slice(0, 10)}`);
  md.push('');
  md.push(`- Curated places probed: **${jurisdictions.length}**`);
  md.push(`- Matched (URL returned 200/301/302): **${matchedCount}**`);
  md.push(`- Still missing: **${jurisdictions.length - matchedCount}**`);
  md.push('');
  md.push('| Geoid | Place | Match? | Candidate URL |');
  md.push('|---|---|---|---|');
  for (const j of jurisdictions) {
    md.push(`| \`${j.geoid}\` | ${j.name} | ${j.match ? 'MATCH' : 'NONE'} | ${j.match || '—'} |`);
  }
  const mdStr = md.join('\n') + '\n';
  console.log('\n' + mdStr);

  // Emit to GITHUB_STEP_SUMMARY if available
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, mdStr, 'utf8');
  }
}

main().catch((err) => {
  console.error('[discover-agenda] fatal:', err);
  process.exit(2);
});
