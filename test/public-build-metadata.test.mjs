#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

execFileSync(process.execPath, ['scripts/build-public-site.mjs'], { stdio: 'inherit' });

const sitemap = await readFile('dist/sitemap.xml', 'utf8');
const placeUrls = sitemap.match(/<loc>https:\/\/[^<]+\/places\/\d{7}\.html<\/loc>/g) || [];
assert(placeUrls.length >= 480, `expected at least 480 place URLs, found ${placeUrls.length}`);
assert(!sitemap.includes('developer-brief'), 'private developer pages must not enter the sitemap');
assert(!sitemap.includes('_template.html'), 'templates must not enter the sitemap');

const index = await readFile('dist/index.html', 'utf8');
assert(index.includes('"@type":"Organization"'), 'index must include Organization JSON-LD');
assert(index.includes('"@type":"WebSite"'), 'index must include WebSite JSON-LD');

const silt = await readFile('dist/places/0870195.html', 'utf8');
assert(silt.includes('"@type":"Dataset"'), 'place pages must include Dataset JSON-LD');
assert(silt.includes('"identifier":"0870195"'), 'place JSON-LD must include its GEOID');

console.log(`Public build metadata: PASS (${placeUrls.length} place URLs)`);
