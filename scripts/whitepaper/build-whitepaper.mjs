#!/usr/bin/env node
/**
 * build-whitepaper.mjs — write the white paper for one jurisdiction.
 *
 *   node scripts/whitepaper/build-whitepaper.mjs <geoid|name> [--out dir] [--pdf] [--today YYYY-MM-DD]
 *
 * Reads the same files the gated page (developer-whitepaper.html) fetches, through
 * js/whitepaper/jurisdiction-whitepaper.js, and writes <geoid>-<slug>.html (and .pdf
 * with --pdf, which needs Playwright). Output defaults to dist-whitepapers/, which is
 * gitignored: the white papers are for sharing, not for the repo or the public site.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
const FundingFit = require(join(ROOT, 'js/funding-fit.js'));
const { isSensitive } = await import(join(ROOT, 'scripts/lib/public-sensitive-patterns.mjs'));

function readJson(rel, optional) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    if (optional) return null;
    throw new Error(`missing ${rel}`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function loadSources() {
  const src = {};
  for (const key of Object.keys(WP.SOURCE_FILES)) src[key] = readJson(WP.sourcePath(key), WP.isOptional(key));
  return src;
}

function countyOf(src, geoid) {
  const row = (src.rankingIndex.rankings || []).find((r) => r.geoid === geoid);
  return row ? row.containingCounty : null;
}

export function build(query, { today } = {}) {
  const src = loadSources();
  let geoid = String(query);
  if (!/^\d{5}$|^\d{7}$/.test(geoid)) {
    const row = WP.findByName(src.rankingIndex, geoid);
    if (!row) throw new Error(`no jurisdiction matches "${query}"`);
    geoid = row.geoid;
  }
  const model = WP.buildModel(src, geoid, {
    today,
    FundingFit,
    isSensitive,
    brief: readJson(WP.briefPath(geoid), true),
    contacts: readJson(WP.contactsPath(geoid), true),
    landscape: readJson(WP.landscapePath(geoid), true) || (geoid.length === 7 ? readJson(WP.landscapePath(countyOf(src, geoid)), true) : null),
    localResources: readJson('data/hna/local-resources.json', true),
  });
  if (model.error) throw new Error(model.error);
  const html = WP.renderHtml(model);
  if (isSensitive(html)) throw new Error(`white paper for ${geoid} matched a pattern in scripts/lib/public-sensitive-patterns.mjs; not written`);
  return { model, html };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = resolve(opt('--out') || join(ROOT, 'dist-whitepapers'));
  const today = opt('--today') || undefined;
  const pdf = args.includes('--pdf');
  const queries = args.filter((a) => a !== '--pdf');
  if (!queries.length) {
    console.error('usage: build-whitepaper.mjs <geoid|name> [...] [--out dir] [--pdf] [--today YYYY-MM-DD]');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  let browser = null;
  for (const q of queries) {
    const { model, html } = build(q, { today });
    const slug = model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = join(out, `${model.geoid}-${slug}`);
    writeFileSync(`${base}.html`, html);
    console.log(`wrote ${base}.html`);
    if (pdf) {
      if (!browser) {
        let pw;
        try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
        // A pinned Playwright may not have its own browser downloaded; fall back to a
        // system Chromium (CHROMIUM_PATH) rather than failing the PDF.
        browser = await pw.chromium.launch().catch(() =>
          pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }));
      }
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({ path: `${base}.pdf`, format: 'Letter', margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' }, printBackground: false });
      await page.close();
      console.log(`wrote ${base}.pdf`);
    }
  }
  if (browser) await browser.close();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
