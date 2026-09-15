#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

execFileSync(process.execPath, ['scripts/build-public-site.mjs'], { stdio: 'inherit' });

// The deploy guard rejects the whole artifact if a forbidden file reaches dist,
// and deploy.yml runs on PUSH ONLY — never on pull_request. So a file that trips
// it cannot be caught before merge, and the failure surfaces as every deploy
// failing while main keeps moving and the live site quietly goes stale. That
// happened on 2026-09-15: #1680 added a sixth parquet to a five-entry
// exclusion list. Run the real guard here, where PRs do see it.
execFileSync(process.execPath, ['scripts/audit/public-artifact-guard.mjs', 'dist'], { stdio: 'inherit' });

function jsonLdBlocks(html) {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => JSON.parse(match[1]));
}

function hasSchemaType(blocks, type) {
  return blocks.some((block) => {
    if (block['@type'] === type) return true;
    return Array.isArray(block['@graph']) && block['@graph'].some((node) => node['@type'] === type);
  });
}

const sitemap = await readFile('dist/sitemap.xml', 'utf8');
const sitemapUrls = sitemap.match(/<loc>https:\/\/[^<]+<\/loc>/g) || [];
const placeUrls = sitemap.match(/<loc>https:\/\/[^<]+\/places\/\d{7}\.html<\/loc>/g) || [];
assert(placeUrls.length >= 480, `expected at least 480 place URLs, found ${placeUrls.length}`);
assert(sitemapUrls.length >= 500, `expected sitemap to include public tool pages plus places, found ${sitemapUrls.length}`);
assert(!sitemap.includes('developer-brief'), 'private developer pages must not enter the sitemap');
assert(!sitemap.includes('_template.html'), 'templates must not enter the sitemap');
assert(!sitemap.includes('404.html'), '404 page must not enter the sitemap');

const index = await readFile('dist/index.html', 'utf8');
const indexJsonLd = jsonLdBlocks(index);
assert(hasSchemaType(indexJsonLd, 'Organization'), 'index must include Organization JSON-LD');
assert(hasSchemaType(indexJsonLd, 'WebSite'), 'index must include WebSite JSON-LD');

const silt = await readFile('dist/places/0870195.html', 'utf8');
const siltJsonLd = jsonLdBlocks(silt);
assert(hasSchemaType(siltJsonLd, 'Place'), 'place pages must include Place JSON-LD');
assert(hasSchemaType(siltJsonLd, 'Dataset'), 'place pages must include Dataset JSON-LD');
assert(JSON.stringify(siltJsonLd).includes('"identifier":"0870195"'), 'place JSON-LD must include its GEOID');

console.log(`Public build metadata: PASS (${sitemapUrls.length} URLs, ${placeUrls.length} place URLs)`);
