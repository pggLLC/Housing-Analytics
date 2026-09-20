#!/usr/bin/env node
/**
 * Does the page scroll sideways on a phone?
 *
 * ── Why this exists (#1745) ──
 *
 * test/mobile-overflow-containment.test.js had 25 assertions, read two
 * stylesheets, and contained zero references to playwright, getBoundingClientRect,
 * scrollWidth or offsetWidth. Every assertion was of this shape:
 *
 *     assert(themeCss.includes('min-width: 0;'), 'badge can shrink ...');
 *
 * It asserted that CSS SOURCE TEXT contains rules whose purpose is to prevent
 * overflow. It never measured whether anything overflowed. So it could not see
 * a rule overridden later in the cascade, an element not on the page at all,
 * overflow caused by some other rule or container, or overflow on any page it
 * did not name. Its name — "mobile-overflow-containment" — read as "mobile
 * overflow is contained" while it meant "four declarations are present in two
 * files". That file is now named for what it checks; this is the part with eyes.
 *
 * ── What it measures ──
 *
 * One question, in the user's terms: at phone width, can you scroll the page
 * sideways? `document.documentElement.scrollWidth > clientWidth` is exactly
 * that, and it is deterministic — unlike a line-wrap heuristic, there is no
 * judgement in it, so this gates rather than advises.
 *
 * A wide table or code block is NOT a defect when it scrolls inside its own
 * container; that is the intended pattern. It becomes a defect only when it
 * pushes the document itself. So the page-level question is the assertion, and
 * the per-element list exists to make a failure actionable rather than to be
 * asserted on directly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import playwright from 'playwright';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080';

/**
 * The guided path plus the entry points — the same list text-wrap-audit.mjs
 * walks, for the same reason recorded there: an earlier list held five pages
 * and none of them was the homepage, the page every visitor sees.
 */
const PAGES = [
  '/',
  '/select-jurisdiction.html',
  '/housing-needs-assessment.html?geoid=0867280&geoType=place&auto=1',
  '/hna-what-housing-exists.html?geoid=0867280&geoType=place&auto=1',
  '/hna-scenario-builder.html',
  '/market-analysis.html',
  '/deal-calculator.html',
  '/recommendation.html?fips=0820000&geoType=place',
  '/for-sale-market-study.html?fips=0828745&geoType=place',
  '/hna-comparative-analysis.html',
  '/lihtc-opportunity-finder.html',
  '/policy-briefs.html',
  '/working-paper.html',
];

// 375 is the iPhone SE / 13 mini viewport and the narrowest mainstream phone.
// A page that holds at 375 holds at everything wider that the site supports.
const WIDTH = 375;

/**
 * A 1px allowance absorbs sub-pixel rounding at fractional device ratios,
 * which is not overflow anyone can see or scroll to. Anything above it is a
 * real sideways scroll.
 */
const TOLERANCE_PX = 1;

const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const overflowBy = de.scrollWidth - vw;

  // Culprits: elements whose box extends past the viewport AND which are not
  // inside something that scrolls them on purpose. Reported to make a failure
  // actionable; the assertion is on the document, not on this list.
  const culprits = [];
  if (overflowBy > 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1) continue;
      let scrollableAncestor = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') { scrollableAncestor = true; break; }
        if (p === document.body) break;
      }
      if (scrollableAncestor) continue;
      culprits.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) || null,
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || null,
      });
    }
  }
  // Keep the outermost offenders: a wide parent drags every child past the
  // edge, and listing all of them buries the one worth fixing.
  const outermost = culprits.filter((c, _i, all) => !all.some((o) =>
    o !== c && o.right >= c.right && o.width > c.width));
  return { viewport: vw, scrollWidth: de.scrollWidth, overflowBy, culprits: outermost.slice(0, 8) };
})()`;

const browser = await playwright.chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const results = [];
for (const p of PAGES) {
  const page = await context.newPage();
  page.on('pageerror', () => {});
  page.on('console', () => {});
  try {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(PROBE);
    results.push({ page: p, ...r });
  } catch (e) {
    results.push({ page: p, error: String(e.message).split('\n')[0].slice(0, 140) });
  }
  await page.close();
}
await context.close();
await browser.close();

const errored = results.filter((r) => r.error);
const overflowing = results.filter((r) => !r.error && r.overflowBy > TOLERANCE_PX);

console.log(`\nMobile overflow — ${WIDTH}px — ${BASE}\n`);
for (const r of results) {
  if (r.error) { console.log(`  ?  ${r.page}\n       could not load: ${r.error}`); continue; }
  const ok = r.overflowBy <= TOLERANCE_PX;
  console.log(`  ${ok ? '✓' : '✗'}  ${r.page}`);
  if (!ok) {
    console.log(`       scrolls ${r.overflowBy}px past a ${r.viewport}px viewport`);
    for (const c of r.culprits) {
      console.log(`       ${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls.split(/\s+/)[0] : ''}`
        + ` w=${c.width} right=${c.right}${c.text ? '  "' + c.text + '"' : ''}`);
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// audit-report/, not data/: an audit artifact must not add churn to a tracked
// data manifest. text-wrap-audit records the same decision and the reason.
const out = path.join(ROOT, 'audit-report', 'mobile-overflow', `${stamp}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ base: BASE, width: WIDTH, results }, null, 2));

console.log(`\n  ${results.length - overflowing.length - errored.length} clean · ${overflowing.length} overflowing · ${errored.length} unreachable`);
console.log(`  report: ${path.relative(ROOT, out)}\n`);

// An unreachable page is not a pass. Silence about a page nobody could load is
// how a green check stops meaning anything.
if (errored.length) {
  console.error(`FAIL: ${errored.length} page(s) could not be loaded — a page that did not render was not checked.`);
  process.exit(1);
}
if (overflowing.length) {
  console.error(`FAIL: ${overflowing.length} page(s) scroll sideways at ${WIDTH}px.`);
  process.exit(1);
}
console.log('PASS: no page scrolls sideways at ' + WIDTH + 'px.');
