/**
 * source-lines-ratchet.mjs
 * Rendered check for the standing rule "every figure carries a linked, dated
 * public source".
 *
 * Each public page is loaded in Chromium. For every visible figure ($ amount,
 * percentage, or number with thousands separators) the check looks for a
 * source link -- an outside URL, or the site's own /data or /docs copy -- in
 * the same card, section or table wrapper (or the line right after it), and
 * for a date in that link's text. A figure with no such link counts as "unsourced"; a figure with a link
 * but no date counts as "undated".
 *
 * Today's misses are recorded per page in source-lines-baseline.json. The
 * check fails only when a page, or any card or section on it, shows MORE
 * unsourced or undated figures than its baseline, so new pages and cards must arrive sourced while the existing
 * backlog is worked down. A page missing from the baseline has a baseline of 0.
 *
 * Exemptions: put data-no-source="definition|input|estimate" on an element
 * (or an ancestor) whose numbers are definitions ("30% of income"), form
 * inputs, or the site's own labelled estimates.
 *
 * Usage:
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/source-lines-ratchet.mjs
 *   ... --update     rewrite the baseline from this run (after a fix lowers it)
 *   ... page.html    check only the named pages
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'source-lines-baseline.json');
const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SETTLE_MS = Number.parseInt(process.env.SETTLE_MS || '3500', 10);
// Late-loading cards can shift a count by a figure or two between runs.
const SLACK = Number.parseInt(process.env.SOURCE_LINES_SLACK || '2', 10);

// Pages not served on the public site, or that are not content pages.
const SKIP = new Set(['404.html', 'og-card.html', 'privacy-policy.html', 'sitemap.html', 'search.html']);

function publicPages() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f) && !f.startsWith('developer'))
    .filter((f) => !/http-equiv=["']refresh["']/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    .sort();
}

function scanPage() {
  const FIG = /(\$\s?\d[\d,]*(\.\d+)?\s?(K|M|B|million|billion)?|\b\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b)/g;
  const DATE = /(?<!\d)(19|20)\d{2}(?!\d)|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\bQ[1-4]\b/;
  const SKIP_SEL = 'script,style,noscript,nav,header,footer,.site-nav,.site-footer,svg,[aria-hidden="true"],.leaflet-control-attribution,[data-no-source]';
  const BOX = 'section,article,figure,table,aside,[class*="card"],[class*="panel"],[class*="kpi"],[class*="stat"],[class*="chart"],[class*="box"],[class*="callout"]';
  const isSrc = (a) => {
    const h = a.getAttribute('href') || '';
    return /^https?:/.test(h) || /(^|\/)(data|docs)\//.test(h);
  };
  // Links inside the box, or in the source line right after it (where the
  // table-export and source-badge lines sit under a table wrapper).
  // Only a line that reads as a source line counts, not any next sibling.
  const isSourceLine = (n) => !!n && (/source/i.test(n.className || '') || /^\s*Sources?\b/i.test(n.textContent || ''));
  const linksAt = (b) => {
    const next = b.nextElementSibling;
    return [...b.querySelectorAll('a[href]'), ...(isSourceLine(next) ? next.querySelectorAll('a[href]') : [])].filter(isSrc);
  };
  const isDated = (links) => DATE.test(links.map((a) => (a.closest('p,li,div,small,figcaption,td') || a).textContent).join(' '));
  // The next container up: a plain wrapper around this box alone (a table's
  // scroll wrapper), else the enclosing card or section. A layout grid that
  // also holds sibling cards is skipped, so an unsourced card cannot borrow a
  // sibling card's source through the grid they share.
  const parentBox = (b) => {
    const p = b.parentElement;
    if (!p) return null;
    const onlyThis = [...p.querySelectorAll(BOX)].every((x) => x === b || b.contains(x));
    return onlyThis ? p : p.closest(BOX);
  };
  // Climb at most two containers until a dated source is found, so a table
  // whose rows carry their own links still finds the dated line under it.
  const sourceLinks = (el) => {
    let b = el.closest(BOX) || document.body;
    let links = linksAt(b);
    let dated = links.length > 0 && isDated(links);
    for (let i = 0; i < 2 && !dated; i++) {
      const up = parentBox(b);
      if (!up || /^(BODY|MAIN)$/.test(up.tagName)) break;
      const upLinks = linksAt(up);
      if (!links.length) b = up;
      if (upLinks.length) { b = up; links = upLinks; dated = isDated(upLinks); }
    }
    return { b, links, dated };
  };
  // Nearest id, then tag:nth-of-type steps down to the box.
  const areaPath = (el) => {
    const steps = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.id) { steps.unshift(`#${n.id}`); break; }
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [n];
      steps.unshift(`${n.tagName.toLowerCase()}:${same.indexOf(n) + 1}`);
    }
    return steps.join('>');
  };
  let figures = 0; let unsourced = 0; let undated = 0;
  const where = {};
  const labels = {};
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || seen.has(el) || el.closest(SKIP_SEL)) continue;
    const m = (walker.currentNode.textContent || '').match(FIG);
    if (!m) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
    seen.add(el);
    figures += m.length;
    const { b, links, dated } = sourceLinks(el);
    let miss = null;
    if (!links.length) { unsourced += m.length; miss = 'unsourced'; } else if (!dated) { undated += m.length; miss = 'undated'; }
    if (miss) {
      // Areas are keyed by element id or structural path, so a copy edit to a
      // heading does not look like a new card; the heading is kept for the
      // failure message only.
      const key = `${miss}: ${areaPath(b)}`;
      where[key] = (where[key] || 0) + m.length;
      if (!labels[key]) {
        const h = b.querySelector('h1,h2,h3,h4,caption,.card-title');
        labels[key] = ((h && h.textContent) || b.className || b.tagName).trim().replace(/\s+/g, ' ').slice(0, 70);
      }
    }
  }
  const top = Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [`${k} "${labels[k]}"`, v]);
  return { figures, unsourced, undated, top, areas: where };
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const only = args.filter((a) => a.endsWith('.html'));
  const pages = only.length ? only : publicPages();
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { pages: {} };

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const results = {};
  for (const p of pages) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE_URL}/${p}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(SETTLE_MS);
      results[p] = await page.evaluate(scanPage);
    } catch (e) {
      results[p] = { error: String(e).slice(0, 160) };
    }
    await page.close();
  }
  await browser.close();

  let totalF = 0; let totalU = 0; let totalD = 0;
  const failures = [];
  for (const p of pages) {
    const r = results[p];
    if (r.error) { failures.push(`${p}: could not load (${r.error})`); continue; }
    totalF += r.figures; totalU += r.unsourced; totalD += r.undated;
    const b = baseline.pages[p] || { unsourced: 0, undated: 0 };
    const grew = [];
    if (r.unsourced > b.unsourced + SLACK) grew.push(`unsourced ${b.unsourced} -> ${r.unsourced}`);
    if (r.undated > b.undated + SLACK) grew.push(`undated ${b.undated} -> ${r.undated}`);
    // Checked card by card as well, so a fix elsewhere on the page cannot
    // offset a new unsourced card. The slack covers late-loading figures.
    const baseAreas = b.areas || {};
    for (const [area, n] of Object.entries(r.areas)) {
      if (n > (baseAreas[area] || 0) + SLACK) grew.push(`${area}: ${baseAreas[area] || 0} -> ${n}`);
    }
    if (grew.length) failures.push(`${p}: ${grew.join(', ')}\n      ${r.top.map(([k, v]) => `${k} (${v})`).join('\n      ')}`);
  }
  const pct = (n) => (totalF ? Math.round((100 * n) / totalF) : 0);
  console.log(`source-lines: ${pages.length} pages, ${totalF} figures, ${pct(totalF - totalU)}% with a source link, ${pct(totalF - totalU - totalD)}% with a dated one`);

  if (update) {
    const next = { note: 'Per-page counts of figures with no nearby source link (unsourced) or a source link without a date (undated). Lower these as pages are fixed; never raise them to pass a PR.', pages: {} };
    for (const p of Object.keys(results).sort()) {
      const r = results[p];
      if (!r.error) next.pages[p] = { unsourced: r.unsourced, undated: r.undated, areas: r.areas };
    }
    if (only.length) next.pages = { ...baseline.pages, ...next.pages };
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`source-lines: baseline written (${Object.keys(next.pages).length} pages)`);
    return;
  }
  if (failures.length) {
    console.error(`source-lines: FAIL - ${failures.length} page(s) show more unsourced or undated figures than the baseline:\n  ${failures.join('\n  ')}`);
    console.error('Add a dated source link next to each new figure, or mark definitions, inputs and labelled estimates with data-no-source.');
    process.exit(1);
  }
  console.log('source-lines: PASS (no page got worse than its baseline)');
}

main().catch((e) => { console.error(e); process.exit(1); });
