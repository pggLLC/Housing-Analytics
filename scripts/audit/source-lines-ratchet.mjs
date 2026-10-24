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
 * backlog is worked down. A page, card or section missing from the baseline has
 * a baseline of 0 and no slack. Pages are read after network idle so cards
 * that load late are counted the same way on every run.
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

// The 480-odd place profiles come from one generator
// (scripts/hna/build_place_pages.py), so a large city and a small town stand
// for all of them: a template change that drops a source shows up on both.
const PLACE_SAMPLES = ['places/0820000.html', 'places/0800320.html'];

function publicPages() {
  const top = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !SKIP.has(f) && !f.startsWith('developer'))
    .filter((f) => !/http-equiv=["']refresh["']/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    .sort();
  return [...top, ...PLACE_SAMPLES.filter((f) => fs.existsSync(path.join(ROOT, f)))];
}

function scanPage() {
  // $ amounts, percentages, thousands, and plain counts of housing things
  // ("60 units", "384 households"). A bare small number is not counted on its
  // own: step numbers, list markers and ages would swamp the check.
  const FIG = /(\$\s?\d[\d,]*(\.\d+)?\s?(K|M|B|million|billion)?|\b\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b|\b\d+\s+(?:affordable\s+|rental\s+|new\s+)?(?:units?|homes?|households?|projects?|developments?|properties|renters?|owners?|residents?|people|jobs|beds?|bedrooms?|vouchers?|applications?|awards?)\b)/gi;
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
  // `from` is the box the figure sits in. Once the climb leaves it, a link
  // counts only if it is not inside a sibling card: a source line written for
  // the whole section counts, a neighbouring card's own source does not.
  const linksAt = (b, from) => {
    const next = b.nextElementSibling;
    const all = [...b.querySelectorAll('a[href]'), ...(isSourceLine(next) ? next.querySelectorAll('a[href]') : [])].filter(isSrc);
    if (!from || from === b) return all;
    return all.filter((a) => {
      // A source line is not a card of its own (`.chart-source` matches BOX).
      let c = a.closest(BOX);
      while (c && isSourceLine(c)) c = c.parentElement && c.parentElement.closest(BOX);
      return !c || c.contains(from) || !b.contains(c);
    });
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
    const own = el.closest(BOX) || document.body;
    // `b` is the box the figure is filed under: its own card, or the
    // container whose source line it uses.
    let b = own;
    let links = linksAt(b);
    let dated = links.length > 0 && isDated(links);
    let cur = own;
    for (let i = 0; i < 2 && !dated; i++) {
      const up = parentBox(cur);
      if (!up || /^(BODY|MAIN)$/.test(up.tagName)) break;
      cur = up;
      const upLinks = linksAt(up, own);
      if (upLinks.length) { b = up; links = upLinks; dated = isDated(upLinks); }
    }
    return { b, links, dated };
  };
  // Area key: the box's id, else its heading's id, else the nearest id
  // above it plus the box's tag and classes, numbered among boxes of the same
  // kind under that id. Inserting a different kind of box, or renaming a
  // heading, leaves every key as it was; only a same-kind box inserted ahead
  // of an id-less one renumbers it (give the area an id to pin it).
  const kind = (n) => [n.tagName.toLowerCase(), ...[...n.classList].sort()].join('.');
  const areaPath = (el) => {
    if (el.id) return `#${el.id}`;
    const h = el.querySelector('h1,h2,h3,h4,h5,h6,caption');
    if (h && h.id && h.closest(BOX) === el) return `#${h.id}`;
    let anchor = el.parentElement;
    while (anchor && anchor !== document.body && !anchor.id) anchor = anchor.parentElement;
    const root = anchor || document.body;
    const k = kind(el);
    const same = [...root.querySelectorAll(el.tagName)].filter((x) => kind(x) === k);
    return `${anchor && anchor.id ? `#${anchor.id}` : 'body'}>${k}:${same.indexOf(el) + 1}`;
  };
  let figures = 0; let unsourced = 0; let undated = 0;
  const where = {};
  const labels = {};
  // Every text node counts, so `<p>$1,000<br>$2,000</p>` is two figures; the
  // source lookup is cached per element because siblings share the answer.
  const lookup = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || el.closest(SKIP_SEL)) continue;
    const m = (walker.currentNode.textContent || '').match(FIG);
    if (!m) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
    figures += m.length;
    if (!lookup.has(el)) lookup.set(el, sourceLinks(el));
    const { b, links, dated } = lookup.get(el);
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
      // A page that keeps a request open (map tiles, a slow outside feed) may
      // never go network-idle; scan it once it has loaded rather than failing.
      await page.goto(`${BASE_URL}/${p}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(async (e) => {
        if (e.name !== 'TimeoutError') throw e;
        await page.waitForLoadState('load', { timeout: 30000 });
      });
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
    // The slack covers late-loading figures in a page or area that already
    // has misses. A new page, or a card or section not in the baseline, gets
    // none: new content arrives sourced.
    const b = baseline.pages[p];
    const pageSlack = b ? SLACK : 0;
    const base = b || { unsourced: 0, undated: 0 };
    const grew = [];
    if (r.unsourced > base.unsourced + pageSlack) grew.push(`unsourced ${base.unsourced} -> ${r.unsourced}`);
    if (r.undated > base.undated + pageSlack) grew.push(`undated ${base.undated} -> ${r.undated}`);
    // Checked card by card as well, so a fix elsewhere on the page cannot
    // offset a new unsourced card.
    const baseAreas = base.areas || {};
    for (const [area, n] of Object.entries(r.areas)) {
      const allowed = area in baseAreas ? baseAreas[area] + SLACK : 0;
      if (n > allowed) grew.push(`${area}: ${baseAreas[area] || 0} -> ${n}`);
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
    console.error('Add a dated source link next to each new figure, or mark definitions, inputs and labelled estimates with data-no-source. If an area only moved (same misses, new key), give it an id and run with --update.');
    process.exit(1);
  }
  console.log('source-lines: PASS (no page got worse than its baseline)');
}

main().catch((e) => { console.error(e); process.exit(1); });
