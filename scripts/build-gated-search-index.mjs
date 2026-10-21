#!/usr/bin/env node
// Adds the developer site's own pages to the search index of a coho-backend bundle.
//
//   node scripts/build-gated-search-index.mjs <bundle dir>
//
// The public build leaves the gated pages (developer*.html and the private research pages)
// out of search-index.json, so on the developer site a search for "Where to build" or its
// land banking map found nothing. Every root page in the bundle that the index lacks gets
// its records here. The bundle drops places/, so place profiles link to the public site.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pageRecords, redirectAlias } from './lib/search-index.mjs';

const PUBLIC_SITE = 'https://cohoanalytics.com/';
const SKIP_FILES = new Set(['_template.html', '404.html', 'research-brief.html']);

export async function gatedSearchIndex(bundle) {
  const index = JSON.parse(await readFile(path.join(bundle, 'search-index.json'), 'utf8'));
  const known = new Set(index.map((r) => r.u.replace(/#.*$/, '')));
  const added = [];
  for (const name of (await readdir(bundle)).sort()) {
    if (!name.endsWith('.html') || SKIP_FILES.has(name) || known.has(name)) continue;
    const html = await readFile(path.join(bundle, name), 'utf8');
    if (redirectAlias(name, html) || /<meta[^>]+http-equiv=["']?refresh/i.test(html)) continue;
    added.push(...pageRecords(name, html));
  }
  const placesServed = existsSync(path.join(bundle, 'places'));
  const records = index.concat(added).map((r) =>
    (!placesServed && r.u.startsWith('places/')) ? { ...r, u: PUBLIC_SITE + r.u } : r);
  return { records, added };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bundle = process.argv[2];
  if (!bundle) { console.error('usage: build-gated-search-index.mjs <bundle dir>'); process.exit(2); }
  const { records, added } = await gatedSearchIndex(bundle);
  await writeFile(path.join(bundle, 'search-index.json'), JSON.stringify(records));
  console.log(`search-index.json: added ${added.length} developer-site records (${records.length} total).`);
}
