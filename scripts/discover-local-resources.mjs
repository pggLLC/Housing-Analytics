#!/usr/bin/env node
/**
 * discover-local-resources.mjs  (F15b, 2026-05-27)
 *
 * Active-discovery half of the freshness loop. Companion to:
 *   - scripts/audit/url-health-sweep.mjs (URL monitoring)
 *   - js/components/report-stale-link.js (user reporting)
 *
 * For each Colorado incorporated place that has NOT yet been added to
 * data/hna/local-resources.json, this script:
 *
 *   1. Ranks the place by HHs ≤100% AMI (proxy for renter scale).
 *   2. Generates standard city-website URL patterns from the place name.
 *   3. Probes each candidate URL (HEAD with GET fallback).
 *   4. For URLs that respond 200, fetches the home page and extracts
 *      the <title> + scans for housing-related keywords.
 *   5. Probes sub-paths likely to contain housing-plan, housing-
 *      authority, IZ ordinance, comp plan, etc.
 *   6. Writes data/hna/local-resources-candidates.json with the result.
 *
 * The OUTPUT is candidate URLs for human review — never auto-merged
 * into local-resources.json. Maintainer reviews + PRs.
 *
 * Why heuristic: we don't have a registry of "every CO city's official
 * .gov domain". Some are city-of-{name}.com, some are {name}.gov, some
 * use weird subdomains. This script just tries the common patterns and
 * surfaces what actually exists.
 *
 * CLI:
 *   node scripts/discover-local-resources.mjs              # discover top 30 places
 *   node scripts/discover-local-resources.mjs --limit 50   # discover top 50
 *   node scripts/discover-local-resources.mjs --dry-run    # don't write output file
 *
 * Exit codes:
 *   0 — completed (regardless of how many candidates found)
 *   2 — script-level failure
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'hna', 'local-resources-candidates.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;       // Be polite — these are .gov sites
const LIMIT_DEFAULT = 30;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) || LIMIT_DEFAULT : LIMIT_DEFAULT;
})();

/* ── Place name → URL-slug heuristic ──────────────────────────────── */

function slugify(name) {
  // "Cañon City city" → "canoncity" (and also "canon-city" as alt)
  return name
    .replace(/\s+(city|town|village|cdp)\b/i, '')   // strip suffix
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-z0-9\s-]/g, '')                       // strip punct
    .trim();
}

function urlVariants(slug) {
  // Try a handful of common .gov / .org / .com patterns CO cities use
  const noSpace = slug.replace(/[\s-]+/g, '');
  const hyphen = slug.replace(/\s+/g, '-');
  const variants = new Set([
    `https://www.${noSpace}.gov/`,
    `https://www.${noSpace}.org/`,
    `https://www.${noSpace}co.gov/`,
    `https://www.cityof${noSpace}.com/`,
    `https://www.cityof${noSpace}.org/`,
    `https://www.townof${noSpace}.com/`,
    `https://www.townof${noSpace}.org/`,
    `https://www.${noSpace}gov.org/`,
  ]);
  // Add hyphenated forms for multi-word names
  if (hyphen !== noSpace) {
    variants.add(`https://www.${hyphen}.gov/`);
    variants.add(`https://www.${hyphen}.org/`);
    variants.add(`https://www.cityof${hyphen}.com/`);
  }
  return [...variants];
}

// Sub-paths to probe once we find a working base
const HOUSING_SUBPATHS = [
  'housing',
  'affordable-housing',
  'housing-authority',
  'community-development',
  'community-services',
  'comprehensive-plan',
  'inclusionary-zoning',
  'planning/housing',
  'departments/housing',
  'government/departments/housing',
  'departments/community-development',
  'economic-development/housing',
];

/* ── Probe ────────────────────────────────────────────────────────── */

async function probeUrl(url) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // HEAD first
    let res;
    try {
      res = await fetch(url, {
        method: 'HEAD', redirect: 'follow', signal: ac.signal,
        headers: { 'User-Agent': 'CohoLocalResourcesBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)' }
      });
      if (res.status === 405 || res.status === 403) throw new Error('retry-get');
    } catch (_) {
      res = await fetch(url, {
        method: 'GET', redirect: 'follow', signal: ac.signal,
        headers: {
          'User-Agent': 'CohoLocalResourcesBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)',
          Range: 'bytes=0-50000'
        }
      });
    }
    clearTimeout(timeout);
    const finalUrl = res.url || url;
    if (!res.ok) {
      return { url, status: res.status, ok: false, finalUrl };
    }
    return { url, status: res.status, ok: true, finalUrl };
  } catch (err) {
    clearTimeout(timeout);
    return { url, status: null, ok: false, finalUrl: null, error: String(err).slice(0, 80) };
  }
}

// Returns { title, hasHousingKeyword, looksLikeColorado } from page body.
// looksLikeColorado is the critical false-positive guard — many CO city
// names collide with cities elsewhere (Westminster WA, Englewood NJ,
// Centennial Conference). We need positive evidence the site is the CO
// place we think it is.
async function extractMetadata(url) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET', redirect: 'follow', signal: ac.signal,
      headers: {
        'User-Agent': 'CohoLocalResourcesBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)',
        Range: 'bytes=0-30000'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return { title: null, hasHousingKeyword: false, looksLikeColorado: false };
    const body = await res.text();
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 100) : null;
    const housingKeywords = /\b(affordable\s+housing|housing\s+authority|inclusionary|housing\s+plan|comprehensive\s+plan|prop\s*123|housing\s+trust)\b/i;
    // Colorado-mention check — body OR title must reference Colorado or
    // a CO-specific landmark. Ordered most-specific first to reduce false
    // positives (just "CO" matches "co-founder" etc., so we anchor it).
    const coMention =
      /\bColorado\b/i.test(body) ||
      /\bColorado\b/i.test(title || '') ||
      /\b(Denver|Boulder|Front\s+Range|Western\s+Slope|Eagle\s+County|Routt\s+County|Mesa\s+County)\b/i.test(body);
    return { title, hasHousingKeyword: housingKeywords.test(body), looksLikeColorado: coMention };
  } catch (_) {
    clearTimeout(timeout);
    return { title: null, hasHousingKeyword: false, looksLikeColorado: false };
  }
}

/* ── Per-place discovery ──────────────────────────────────────────── */

async function discoverForPlace(place) {
  const slug = slugify(place.name);
  if (!slug || slug.length < 3) {
    return { ...place, slug, candidateUrls: [], note: 'slug-too-short' };
  }
  const baseVariants = urlVariants(slug);
  const candidates = [];

  // 1. Probe base URLs to find which exists. We try ALL variants but keep
  // the FIRST one that looks like Colorado — many CO city names collide
  // with cities in other states, so we don't stop at the first 200.
  let bestBase = null;
  for (const base of baseVariants) {
    const probe = await probeUrl(base);
    if (!probe.ok) continue;
    const meta = await extractMetadata(probe.finalUrl);
    const candidate = {
      url: probe.finalUrl,
      type: 'base',
      status: probe.status,
      title: meta.title,
      hasHousingKeyword: meta.hasHousingKeyword,
      looksLikeColorado: meta.looksLikeColorado
    };
    if (meta.looksLikeColorado) {
      bestBase = candidate;
      candidates.push(candidate);
      break;   // Found a CO-confirmed base — stop trying other variants
    }
    // Keep the non-CO match around in case nothing better surfaces — useful
    // for manual review (e.g., "Castle Rock" chamber-of-commerce site that
    // might link to the actual government site).
    if (!bestBase) bestBase = candidate;
  }
  // If we never found a CO-confirmed base, fall back to the first 200 we
  // saw — flag it as `looksLikeColorado: false` so reviewer knows.
  if (!bestBase || !candidates.length) {
    if (bestBase) candidates.push(bestBase);
  }
  // 2. For the FIRST candidate (the chosen base), probe housing sub-paths.
  if (candidates.length) {
    const baseUrl = candidates[0].url.replace(/\/$/, '');
    for (const sub of HOUSING_SUBPATHS) {
      const subUrl = baseUrl + '/' + sub;
      const subProbe = await probeUrl(subUrl);
      if (subProbe.ok) {
        const subMeta = await extractMetadata(subProbe.finalUrl);
        candidates.push({
          url: subProbe.finalUrl,
          type: 'subpath',
          subpath: sub,
          status: subProbe.status,
          title: subMeta.title,
          hasHousingKeyword: subMeta.hasHousingKeyword,
          looksLikeColorado: subMeta.looksLikeColorado
        });
      }
    }
  }

  return {
    ...place,
    slug,
    candidateUrls: candidates,
    triedVariants: baseVariants.length
  };
}

/* ── Main ─────────────────────────────────────────────────────────── */

async function loadInputs() {
  const [lr, ami, geoConfig] = await Promise.all([
    fs.readFile(path.join(ROOT, 'data', 'hna', 'local-resources.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(ROOT, 'data', 'co_ami_gap_by_place.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(ROOT, 'data', 'hna', 'geo-config.json'), 'utf8').then(JSON.parse)
      .catch(() => null)
  ]);
  return { lr, ami, geoConfig };
}

function rankUnincludedPlaces(lr, ami, limit) {
  const haveGeoids = new Set(
    Object.keys(lr).filter((k) => k.startsWith('place:')).map((k) => k.replace('place:', ''))
  );
  return Object.values(ami.places || {})
    .map((p) => {
      const totalHH = (p.households_le_ami_pct && p.households_le_ami_pct['100']) || 0;
      return {
        geoid: p.fips,
        name: p.place_name,
        county_fips: p.containing_county_fips,
        households: totalHH,
        isCdp: /\bCDP\b/.test(p.place_name || '')
      };
    })
    .filter((p) => p.geoid && !haveGeoids.has(p.geoid) && !p.isCdp && p.households > 0)
    .sort((a, b) => b.households - a.households)
    .slice(0, limit);
}

async function runConcurrent(items, worker) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      console.error(`[discover]  (${idx + 1}/${items.length}) ${items[idx].name} …`);
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return results;
}

async function main() {
  console.error('[discover] Loading inputs…');
  const { lr, ami } = await loadInputs();
  const targets = rankUnincludedPlaces(lr, ami, LIMIT);
  console.error(`[discover] ${targets.length} target places (top ${LIMIT} unincluded by HH count).`);

  const t0 = Date.now();
  const results = await runConcurrent(targets, discoverForPlace);
  const ms = Date.now() - t0;
  console.error(`[discover] Probed ${results.length} places in ${(ms / 1000).toFixed(1)}s.`);

  const found = results.filter((r) => r.candidateUrls.length > 0);
  const notFound = results.filter((r) => r.candidateUrls.length === 0);

  const out = {
    generatedAt: NOW,
    limit: LIMIT,
    placesChecked: targets.length,
    placesWithCandidates: found.length,
    placesWithoutCandidates: notFound.length,
    candidates: {}
  };
  for (const r of found) {
    out.candidates['place:' + r.geoid] = {
      name: r.name,
      county_fips: r.county_fips,
      households: r.households,
      slug: r.slug,
      candidateUrls: r.candidateUrls
    };
  }
  if (notFound.length) {
    out.notFound = notFound.map((r) => ({ geoid: r.geoid, name: r.name, slug: r.slug }));
  }

  if (!DRY_RUN) {
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
    console.error(`[discover] Candidates written to ${path.relative(ROOT, OUTPUT_PATH)}`);
  } else {
    console.error('[discover] --dry-run: candidates NOT written.');
  }

  // Print summary to stdout (machine-readable for GH Actions step)
  console.log(JSON.stringify({
    generatedAt: NOW,
    limit: LIMIT,
    placesChecked: targets.length,
    placesWithCandidates: found.length,
    placesWithoutCandidates: notFound.length,
    topCandidates: found.slice(0, 10).map((r) => ({
      name: r.name,
      households: r.households,
      candidateCount: r.candidateUrls.length,
      bestUrl: r.candidateUrls[0] && r.candidateUrls[0].url
    }))
  }, null, 2));
}

main().catch((err) => {
  console.error('[discover] FATAL:', err);
  process.exit(2);
});
