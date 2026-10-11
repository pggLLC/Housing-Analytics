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
const DENIED_CANDIDATE_HOSTS = new Set([
  // #1194: wrong-state/squatter domain that recurred for Greenwood Village.
  // Official city site is https://www.greenwoodvillage.com/.
  'townofgreenwood.org',
  'www.townofgreenwood.org',
]);

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

export function isDeniedCandidateUrl(url) {
  try {
    return DENIED_CANDIDATE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

/* ── Junk-host and Colorado filters (#2125) ───────────────────────────
   The 2026-10-09 digest listed a tour-booking page on geo.org as Las
   Animas's city site (a guessed domain redirected there, and the page
   mentions "colorado" in its query string), and ten "Unconfirmed"
   candidates that were wrong-state cities, a domain-for-sale page and
   unrelated organisations. A municipal website is never one of these, so
   such candidates are now dropped instead of listed for review. */

// Hosts that are never a municipality's own site: tour/booking sites,
// domain marketplaces and parking services, and listing aggregators.
// Matched against the host the probe ended on (after redirects), and
// against any subdomain of it.
const NON_MUNICIPAL_HOSTS = [
  'geo.org',
  'tripadvisor.com', 'viator.com', 'expedia.com', 'booking.com', 'yelp.com',
  'epik.com', 'sedo.com', 'dan.com', 'afternic.com', 'hugedomains.com',
  'godaddy.com', 'bodis.com', 'parkingcrew.net', 'above.com',
];

// Titles of parked or for-sale domains, which sit on the guessed host
// itself (cityofglendale.org -> "contact with domain owner | Epik.com").
const PARKED_TITLE = /\b(domain\s+(is\s+)?for\s+sale|buy\s+this\s+domain|contact\s+with\s+domain\s+owner|this\s+domain\s+may\s+be\s+for\s+sale|parked\s+(free|domain))\b|\bepik\.com\b/i;

export function isNonMunicipalHost(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return false; }
  return NON_MUNICIPAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Positive evidence the page is about Colorado: the word "Colorado", or
// "CO" in an address context — a Colorado ZIP (80xxx/81xxx) after "CO",
// or a "Name, CO" title. "CO" is matched case-sensitively so "co-op" and
// "Co." do not count.
export function looksLikeColorado(body, title) {
  const b = body || '';
  const t = title || '';
  return /\bColorado\b/i.test(b) ||
    /\bColorado\b/i.test(t) ||
    /\bCO\.?,?\s+8[01]\d{3}\b/.test(b) ||
    /,\s*CO\b/.test(t);
}

/**
 * Should a probed base URL be kept as a candidate city website?
 * Returns { keep, reason }. Dropped candidates never reach the digest.
 */
export function classifyBaseCandidate({ url, finalUrl, title, body }) {
  const landed = finalUrl || url;
  if (isDeniedCandidateUrl(landed) || isNonMunicipalHost(landed)) return { keep: false, reason: 'non-municipal-host' };
  if (PARKED_TITLE.test(title || '')) return { keep: false, reason: 'parked-domain' };
  if (!looksLikeColorado(body, title)) return { keep: false, reason: 'no-colorado-mention' };
  return { keep: true, reason: 'colorado-confirmed' };
}

export function urlVariants(slug) {
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
  return [...variants].filter((url) => !isDeniedCandidateUrl(url));
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

// Returns { finalUrl, title, hasHousingKeyword, looksLikeColorado } from page
// body. finalUrl is where this GET landed; a host can answer HEAD and GET
// differently, so it, not the HEAD probe's URL, is the page the metadata
// describes.
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
    const finalUrl = res.url || url;
    if (!res.ok) return { finalUrl, title: null, body: '', hasHousingKeyword: false, looksLikeColorado: false };
    const body = await res.text();
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 100) : null;
    const housingKeywords = /\b(affordable\s+housing|housing\s+authority|inclusionary|housing\s+plan|comprehensive\s+plan|prop\s*123|housing\s+trust)\b/i;
    return { finalUrl, title, body, hasHousingKeyword: housingKeywords.test(body), looksLikeColorado: looksLikeColorado(body, title) };
  } catch (_) {
    clearTimeout(timeout);
    return { finalUrl: null, title: null, body: '', hasHousingKeyword: false, looksLikeColorado: false };
  }
}

/* ── Per-place discovery ──────────────────────────────────────────── */

export async function discoverForPlace(place) {
  const slug = slugify(place.name);
  if (!slug || slug.length < 3) {
    return { ...place, slug, candidateUrls: [], note: 'slug-too-short' };
  }
  const baseVariants = urlVariants(slug);
  const candidates = [];

  // 1. Probe base URLs and keep the FIRST one that passes
  // classifyBaseCandidate(): not a junk/parked host, and the homepage
  // mentions Colorado. Many CO city names collide with cities in other
  // states, so we don't stop at the first 200. A base that fails is
  // dropped — it is not listed for review (#2125).
  for (const base of baseVariants) {
    const probe = await probeUrl(base);
    if (!probe.ok) continue;
    const meta = await extractMetadata(probe.finalUrl);
    // Classify the page the metadata came from: the GET can redirect where
    // the HEAD probe did not.
    const landed = meta.finalUrl || probe.finalUrl;
    if (isNonMunicipalHost(probe.finalUrl)) continue;
    const verdict = classifyBaseCandidate({ url: base, finalUrl: landed, title: meta.title, body: meta.body });
    if (!verdict.keep) continue;
    candidates.push({
      url: landed,
      type: 'base',
      status: probe.status,
      title: meta.title,
      hasHousingKeyword: meta.hasHousingKeyword,
      looksLikeColorado: true
    });
    break;   // Found a CO-confirmed base — stop trying other variants
  }
  // 2. For the FIRST candidate (the chosen base), probe housing sub-paths.
  if (candidates.length) {
    const baseUrl = candidates[0].url.replace(/\/$/, '');
    for (const sub of HOUSING_SUBPATHS) {
      const subUrl = baseUrl + '/' + sub;
      const subProbe = await probeUrl(subUrl);
      if (subProbe.ok && !isNonMunicipalHost(subProbe.finalUrl)) {
        const subMeta = await extractMetadata(subProbe.finalUrl);
        const subLanded = subMeta.finalUrl || subProbe.finalUrl;
        if (isNonMunicipalHost(subLanded)) continue;
        candidates.push({
          url: subLanded,
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

/**
 * GEOIDs of every Census-Designated Place, from the authoritative list in
 * `data/hna/geo-config.json`.
 *
 * A CDP is unincorporated: it has no municipal government, so no official city
 * website can exist for it. Probing URL patterns for one can only ever surface
 * an unrelated organisation that happens to own the domain.
 *
 * @param {object|null} geoConfig
 * @returns {Set<string>}
 */
export function cdpGeoids(geoConfig) {
  return new Set(((geoConfig && geoConfig.cdps) || []).map((c) => c.geoid).filter(Boolean));
}

function rankUnincludedPlaces(lr, ami, limit, geoConfig) {
  const haveGeoids = new Set(
    Object.keys(lr).filter((k) => k.startsWith('place:')).map((k) => k.replace('place:', ''))
  );
  // Identify CDPs by GEOID, not by a "(CDP)" suffix on the name.
  // `data/co_ami_gap_by_place.json` carries bare names ("Clifton", "Ken Caryl"),
  // so the old `/\bCDP\b/.test(place_name)` check matched none of them and every
  // CDP passed the filter. On the 2026-08-31 run that was 7 of 20 candidates,
  // which is how an HOA (kencaryl.org) and an international center
  // (meridian.org) were surfaced as candidate city websites.
  const cdps = cdpGeoids(geoConfig);
  return Object.values(ami.places || {})
    .map((p) => {
      const totalHH = (p.households_le_ami_pct && p.households_le_ami_pct['100']) || 0;
      return {
        geoid: p.fips,
        name: p.place_name,
        county_fips: p.containing_county_fips,
        households: totalHH,
        isCdp: cdps.has(p.fips) || /\bCDP\b/.test(p.place_name || '')
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
  const { lr, ami, geoConfig } = await loadInputs();
  if (!geoConfig || !Array.isArray(geoConfig.cdps) || geoConfig.cdps.length === 0) {
    // Fail loudly rather than silently probing 200+ CDPs that cannot have a
    // municipal website. loadInputs() swallows a read error into null.
    console.error('[discover] FATAL: geo-config.json missing or has no `cdps` list; cannot filter CDPs.');
    process.exit(1);
  }
  const targets = rankUnincludedPlaces(lr, ami, LIMIT, geoConfig);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[discover] FATAL:', err);
    process.exit(2);
  });
}
