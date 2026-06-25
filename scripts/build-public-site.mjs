#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.COHO_PUBLIC_DIST
  ? path.resolve(process.env.COHO_PUBLIC_DIST)
  : path.join(ROOT, 'dist');
const BUILD_LOCK = `${DIST}.lock`;

const PRIVATE_ROOT_HTML = new Set([
  'developer.html',
  'developer-where.html',
  'developer-pipeline.html',
  'developer-brief.html',
  'indibuild.html',
  'indibuild-where.html',
  'indibuild-pipeline.html',
  'indibuild-brief.html'
]);

const PUBLIC_ROOT_FILES = new Set([
  'CNAME',
  'robots.txt',
  'sitemap.xml',
  'sitemap.html',
  '_headers',
  'LICENSE',
  'favicon.svg'
]);

const PUBLIC_DIRECTORIES = new Set([
  'assets',
  'css',
  'data',
  'docs',
  'js',
  'lib',
  'maps',
  'places',
  'schemas'
]);

const PUBLIC_DOCS = new Set([
  'docs/AFFORDABILITY-METHODOLOGY.md',
  'docs/alerts-pipeline.md',
  'docs/CHART_FIX_USAGE.md',
  'docs/CONTRIBUTING.md',
  'docs/DATA-SOURCES.md',
  'docs/DATA_QUALITY.md',
  'docs/DESIGN-SYSTEM.md',
  'docs/LIHTC_FEASIBILITY_CALCULATOR.md',
  'docs/LIHTC-METHODOLOGY.md',
  'docs/MARKET_ANALYSIS_METHOD.md',
  'docs/MARKET_TRENDS_UPDATE_PROTOCOL.md',
  'docs/METHODOLOGY-GAPS-2026-05-21.md',
  'docs/PMA_CONFIDENCE_NOTES.md',
  'docs/PMA_DATA_ENHANCEMENTS.md',
  'docs/PMA_SCORING.md',
  'docs/PMA_SITE_SELECTION.md',
  'docs/PROJECTION-METHODOLOGY.md',
  'docs/SCORECARD-V2.md',
  'docs/SITE_SELECTION_SCORING.md',
  'docs/SITE_STATE_USAGE.md'
]);

const REQUIRED_PUBLIC_FILES = new Set([
  'data/core/educational-content.json',
  'data/hna/ranking-index.json'
]);

const BLOCKED_PATHS = [
  '.git',
  '.github',
  '.agents',
  '.codex',
  '.claude',
  '.pytest_cache',
  '.cache',
  'node_modules',
  'scripts',
  'test',
  'tests',
  'tools',
  'serverless',
  'cloudflare-worker',
  'work',
  'out',
  'audit-report',
  'monitoring-reports',
  'accessibility-audit-results',
  'archive',
  'private',
  '__MACOSX',
  'docs/indibuild-pipeline-prototype',
  'docs/developer-pipeline-prototype',
  'docs/security',
  'docs/qa',
  'data/reports',
  'data/discovery-reports',
  'data/audit',
  'data/jurisdiction-briefs',
  'data/hna/source',
  'data/zillow',
  'data/url-health.json',
  'data/co-housing-costs/acs_county_latest.parquet',
  'data/co-housing-costs/bls_series.parquet',
  'data/co-housing-costs/fhfa_hpi_county_raw.parquet',
  'data/co-housing-costs/permits_county.parquet',
  'data/co-housing-costs/qcew_construction_county.parquet',
  'data/co-housing-costs/drivers_ranking.csv',
  'data/co-housing-costs/README.md',
  'js/indibuild-gate.js',
  'js/developer-gate.js',
  'js/components/jurisdiction-brief.js',
  'js/components/pipeline-add-button.js',
  'js/components/pipeline-store.js'
];

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function isBlocked(relPath) {
  const posix = toPosix(relPath);
  if (posix.split('/').some((part) => /(^\._| 2($|\.))/.test(part))) return true;
  return BLOCKED_PATHS.some((blocked) => posix === blocked || posix.startsWith(`${blocked}/`));
}

async function copyRecursive(srcRel, destRel = srcRel) {
  if (isBlocked(srcRel)) return;
  if (toPosix(srcRel).startsWith('docs/') && !PUBLIC_DOCS.has(toPosix(srcRel)) && !toPosix(srcRel).startsWith('docs/methodology/')) {
    return;
  }

  const src = path.join(ROOT, srcRel);
  const dest = path.join(DIST, destRel);
  const info = await stat(src);

  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    for (const entry of entries) {
      await copyRecursive(path.join(srcRel, entry), path.join(destRel, entry));
    }
    return;
  }

  if (info.isFile()) {
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { force: true });
  }
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const rootEntries = await readdir(ROOT, { withFileTypes: true });
  for (const entry of rootEntries) {
    const name = entry.name;
    if (name === 'dist' || isBlocked(name)) continue;

    if (entry.isFile()) {
      if (PRIVATE_ROOT_HTML.has(name)) continue;
      if (name.endsWith('.html') || PUBLIC_ROOT_FILES.has(name)) {
        await copyRecursive(name);
      }
      continue;
    }

    if (entry.isDirectory() && PUBLIC_DIRECTORIES.has(name)) {
      await copyRecursive(name);
    }
  }

  for (const relPath of REQUIRED_PUBLIC_FILES) {
    if (!isBlocked(relPath)) {
      await copyRecursive(relPath);
    }
  }

  await filterPublicManifests();
  await generateSearchIndex();
  await injectStructuredData();
  await generateSitemap();

  console.log(`Built public site artifact at ${path.relative(ROOT, DIST)}/`);
}

async function publicDomain() {
  try {
    return (await readFile(path.join(ROOT, 'CNAME'), 'utf8')).trim();
  } catch (_) {
    return 'cohoanalytics.com';
  }
}

function jsonLdScript(value) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  return `  <script type="application/ld+json">${json}</script>\n`;
}

async function injectStructuredData() {
  const domain = await publicDomain();
  const siteUrl = `https://${domain}/`;
  const indexPath = path.join(DIST, 'index.html');

  try {
    let html = await readFile(indexPath, 'utf8');
    if (!html.includes('application/ld+json')) {
      const graph = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': `${siteUrl}#organization`,
            name: 'COHO Analytics',
            url: siteUrl
          },
          {
            '@type': 'WebSite',
            '@id': `${siteUrl}#website`,
            url: siteUrl,
            name: 'COHO Analytics',
            publisher: { '@id': `${siteUrl}#organization` },
            potentialAction: {
              '@type': 'SearchAction',
              target: `${siteUrl}search.html?q={search_term_string}`,
              'query-input': 'required name=search_term_string'
            }
          }
        ]
      };
      html = html.replace('</head>', `${jsonLdScript(graph)}</head>`);
      await writeFile(indexPath, html);
    }
  } catch (err) {
    console.warn(`index structured data skipped: ${err.message}`);
  }

  const placesDir = path.join(DIST, 'places');
  try {
    const entries = await readdir(placesDir);
    let count = 0;
    for (const name of entries) {
      if (!/^\d{7}\.html$/.test(name)) continue;
      const filePath = path.join(placesDir, name);
      let html = await readFile(filePath, 'utf8');
      if (html.includes('application/ld+json')) continue;
      const dataMatch = html.match(/<script id="place-data" type="application\/json">\s*([\s\S]*?)\s*<\/script>/i);
      if (!dataMatch) continue;
      const data = JSON.parse(dataMatch[1]);
      const geoid = name.slice(0, -5);
      const url = `${siteUrl}places/${name}`;
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: `${data.name || geoid} Housing Profile`,
        description: `Housing needs and affordability profile for ${data.name || geoid}, Colorado.`,
        url,
        creator: { '@id': `${siteUrl}#organization` },
        spatialCoverage: {
          '@type': 'Place',
          name: `${data.name || geoid}, Colorado`,
          identifier: geoid,
          containedInPlace: data.county_name && data.county_name !== 'Unknown'
            ? { '@type': 'AdministrativeArea', name: `${data.county_name} County, Colorado` }
            : undefined
        },
        isBasedOn: [
          'https://www.huduser.gov/portal/datasets/cp.html',
          'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html'
        ]
      };
      html = html.replace('</head>', `${jsonLdScript(schema)}</head>`);
      await writeFile(filePath, html);
      count++;
    }
    console.log(`Injected structured data into ${count} place profiles.`);
  } catch (err) {
    console.warn(`place structured data skipped: ${err.message}`);
  }
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateSitemap() {
  const domain = await publicDomain();
  const base = `https://${domain}/`;
  const skip = new Set(['404.html', 'places/_template.html']);
  const urls = [];

  async function walk(rel = '') {
    const entries = await readdir(path.join(DIST, rel || '.'), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
        continue;
      }
      if (!entry.name.endsWith('.html') || skip.has(toPosix(childRel))) continue;
      const html = await readFile(path.join(DIST, childRel), 'utf8');
      if (/<meta[^>]+http-equiv=["']?refresh/i.test(html)) continue;
      const info = await stat(path.join(ROOT, childRel)).catch(() => null);
      const urlPath = childRel === 'index.html' ? '' : toPosix(childRel);
      urls.push({
        loc: `${base}${urlPath}`,
        lastmod: (info?.mtime || new Date()).toISOString().slice(0, 10)
      });
    }
  }

  await walk();
  urls.sort((a, b) => a.loc.localeCompare(b.loc));
  const body = urls.map(({ loc, lastmod }) =>
    `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
  ).join('\n');
  await writeFile(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
  console.log(`Generated sitemap.xml (${urls.length} URLs).`);
}

async function generateSearchIndex() {
  // Build search-index.json from every public page's title/description/headings so search.html
  // can match places, dashboards, guides, and topics. Non-fatal by design: a failure here logs
  // and continues — the search index must never break the deploy (see deploy-gate lessons).
  try {
    const SKIP_FILES = new Set(['_template.html', '404.html']);
    const records = [];
    async function walk(rel) {
      const entries = await readdir(path.join(DIST, rel || '.'), { withFileTypes: true });
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walk(childRel); continue; }
        if (!entry.name.endsWith('.html') || SKIP_FILES.has(entry.name)) continue;
        const html = await readFile(path.join(DIST, childRel), 'utf8');
        if (/<meta[^>]+http-equiv=["']?refresh/i.test(html)) continue; // redirect stub
        const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
        const title = (titleM ? titleM[1] : '').replace(/\s+/g, ' ').trim();
        if (!title) continue;
        const descM = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
        const desc = (descM ? descM[1] : '').replace(/\s+/g, ' ').trim();
        const headings = (html.match(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi) || [])
          .map((h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
          .filter(Boolean).slice(0, 10).join(' · ');
        records.push({ t: title, u: toPosix(childRel), d: desc, k: headings });
      }
    }
    await walk('');
    records.sort((a, b) => a.u.localeCompare(b.u));
    await writeFile(path.join(DIST, 'search-index.json'), JSON.stringify(records));
    console.log(`Generated search-index.json (${records.length} pages).`);
  } catch (err) {
    console.warn(`search-index generation skipped: ${err.message}`);
  }
}

async function existsInDist(relPath) {
  try {
    const info = await stat(path.join(DIST, relPath));
    return info.isFile();
  } catch (_) {
    return false;
  }
}

async function filterPublicManifests() {
  const manifestPath = path.join(DIST, 'data', 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest && manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files)) {
      const filtered = {};
      for (const [relPath, meta] of Object.entries(manifest.files)) {
        if (!isBlocked(relPath) && await existsInDist(relPath)) {
          filtered[relPath] = meta;
        }
      }
      manifest.files = filtered;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } catch (_) {
    // Optional legacy manifest; ignore if absent or malformed.
  }

  const explorerManifestPath = path.join(DIST, 'data', '_manifest.json');
  try {
    const manifest = JSON.parse(await readFile(explorerManifestPath, 'utf8'));
    if (manifest && Array.isArray(manifest.files)) {
      const filtered = [];
      for (const entry of manifest.files) {
        const relPath = entry && entry.path ? `data/${entry.path}` : null;
        if (relPath && !isBlocked(relPath) && await existsInDist(relPath)) {
          filtered.push(entry);
        }
      }
      manifest.files = filtered;
      if (manifest.meta) {
        manifest.meta.file_count = filtered.length;
        manifest.meta.total_size_bytes = filtered.reduce((sum, entry) => sum + (Number(entry.size_bytes) || 0), 0);
      }
      await writeFile(explorerManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } catch (_) {
    // Optional data-explorer manifest; ignore if absent or malformed.
  }
}

async function acquireBuildLock() {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      await mkdir(BUILD_LOCK);
      await writeFile(path.join(BUILD_LOCK, 'owner'), `${process.pid}\n`);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await stat(BUILD_LOCK).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 5 * 60 * 1000) {
        await rm(BUILD_LOCK, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Timed out waiting for another public build to finish.');
}

async function run() {
  await acquireBuildLock();
  try {
    await main();
  } finally {
    await rm(BUILD_LOCK, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
