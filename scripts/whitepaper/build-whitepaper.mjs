#!/usr/bin/env node
/**
 * build-whitepaper.mjs — write the white paper for one jurisdiction.
 *
 *   node scripts/whitepaper/build-whitepaper.mjs <geoid|name> [--out dir] [--pdf] [--today YYYY-MM-DD]
 *   node scripts/whitepaper/build-whitepaper.mjs --all [--out dir]
 *
 * --all writes every jurisdiction in the ranking index (546) plus index.html, a list
 * of them with the date built, so the gated site can carry a ready-made report for
 * every town and county. It is rebuilt from the current data on each deploy.
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
const MixCheck = require(join(ROOT, 'js/mix-check.js'));
const TownQuestions = require(join(ROOT, 'js/whitepaper/town-questions.js'));
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

export function build(query, { today, src = loadSources() } = {}) {
  let geoid = String(query);
  if (!/^\d{5}$|^\d{7}$/.test(geoid)) {
    const row = WP.findByName(src.rankingIndex, geoid);
    if (!row) throw new Error(`no jurisdiction matches "${query}"`);
    geoid = row.geoid;
  }
  const model = WP.buildModel(src, geoid, {
    today,
    FundingFit,
    MixCheck,
    TownQuestions,
    isSensitive,
    brief: readJson(WP.briefPath(geoid), true),
    contacts: readJson(WP.contactsPath(geoid), true),
    landscape: readJson(WP.landscapePath(geoid), true),
    relatedContacts: WP.relatedGeoids(src, geoid).map((g) => readJson(WP.contactsPath(g), true)),
    relatedLandscape: WP.relatedGeoids(src, geoid).map((g) => readJson(WP.landscapePath(g), true)),
    localResources: readJson('data/hna/local-resources.json', true),
    summary: readJson(WP.summaryPath(geoid), true),
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
  const all = args.includes('--all');
  if (all) return buildAll(out, today);
  const queries = args.filter((a) => a !== '--pdf');
  if (!queries.length) {
    console.error('usage: build-whitepaper.mjs <geoid|name> [...] [--out dir] [--pdf] [--today YYYY-MM-DD]');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  let browser = null;
  for (const q of queries) {
    const { model, html } = build(q, { today });
    const base = join(out, `${model.geoid}-${slugOf(model.name)}`);
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

function slugOf(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Every jurisdiction, one sources load. A report the private-text guard refuses is
// listed as not built, with no file, rather than stopping the run.
export function buildAll(out, today) {
  const src = loadSources();
  mkdirSync(out, { recursive: true });
  const rows = src.rankingIndex.rankings.slice().sort((a, b) => a.name.localeCompare(b.name));
  const county = {};
  rows.forEach((r) => { if (r.type === 'county') county[r.geoid] = r.name; });
  const listed = [];
  let built = 0;
  for (const r of rows) {
    try {
      const { model, html } = build(r.geoid, { today, src });
      const file = `${model.geoid}-${slugOf(model.name)}.html`;
      writeFileSync(join(out, file), html);
      listed.push({ r, file, date: model.generated });
      built++;
    } catch (e) {
      listed.push({ r, file: null, why: e.message });
    }
  }
  const day = today || new Date().toISOString().slice(0, 10);
  const items = listed.map(({ r, file, why }) => {
    const label = escHtml(r.type === 'county' ? r.name : `${r.name}, ${county[r.containingCounty] || 'Colorado'}`);
    return file ? `<li><a href="${escHtml(file)}">${label}</a></li>` : `<li>${label} <em>(not built: ${escHtml(why)})</em></li>`;
  }).join('\n');
  writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Jurisdiction reports</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px}li{margin:.2em 0}em{color:#555}</style></head><body>
<h1>Jurisdiction reports</h1><p>${built} of ${rows.length} Colorado towns and counties, built ${escHtml(day)} from the data in the repository. Each report is also built live, from the current data, on the Jurisdiction Report page.</p>
<ul>
${items}
</ul></body></html>
`);
  console.log(`wrote ${built} of ${rows.length} reports and index.html to ${out}`);
  if (built < rows.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
