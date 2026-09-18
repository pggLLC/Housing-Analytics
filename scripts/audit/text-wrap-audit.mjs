#!/usr/bin/env node
/**
 * text-wrap-audit.mjs — find text that wraps when it did not need to.
 *
 * ADVISORY. Always exits 0. It reports; it does not gate.
 *
 * That is deliberate and it is a risk. A check nobody can fail is a check
 * people stop reading — this repo spent a day proving that, when a flaky axe
 * gate trained everyone (me included) to merge past a red check. So this
 * prints a short, ranked, specific report rather than a wall, and records a
 * baseline count so the number moving is visible.
 *
 * WHAT IT LOOKS FOR
 *
 *   mid-word breaks   a single word split across two line boxes. Always a
 *                     defect: `overflow-wrap: anywhere` is meant for long
 *                     unbreakable strings in narrow containers, and applied
 *                     to a data table it converts a column-sizing problem
 *                     into a silent height problem.
 *
 *   gratuitous wraps  short text on 2+ lines while its own box has room to
 *                     spare. The text is not too long; the box is wrong.
 *
 * The real example this was built from, on housing-needs-assessment.html:
 *
 *   Mechanism                716px wide   5 lines
 *   Downturn (-2% annually)   67px wide   5 lines
 *   Moderate (3% annually)    67px wide   5 lines
 *   High (6% annually)        67px wide   5 lines
 *
 * A one-word header took 716px; three long ones got 67px each and shattered
 * mid-word. One row, 123px tall instead of ~40px, entirely from column sizing.
 *
 * Usage:
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/text-wrap-audit.mjs
 *   ... --json    machine-readable
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080';
const JSON_ONLY = process.argv.includes('--json');

/**
 * Pages and widths.
 *
 * The first list held five pages and none of them was the homepage — the page
 * every visitor sees, and the one a wrap was reported on. A smoke check that
 * skips the front door is not small, it is pointed the wrong way.
 *
 * These are the pages of the guided path plus the two entry points, which is
 * what a reader actually walks through.
 */
const PAGES = [
  '/',
  '/select-jurisdiction.html',
  '/lihtc-opportunity-finder.html',
  '/housing-needs-assessment.html?geoid=0867280&geoType=place&auto=1',
  '/hna-what-housing-exists.html?geoid=0867280&geoType=place&auto=1',
  '/market-analysis.html',
  '/hna-scenario-builder.html',
  '/deal-calculator.html',
  '/recommendation.html?fips=0820000&geoType=place',
  '/for-sale-market-study.html?fips=0828745&geoType=place',
  '/hna-comparative-analysis.html',
];
// 1024 is where the site's own breakpoints stop helping and columns get tight.
const WIDTHS = [1280, 1024, 768];

/**
 * Runs in the page. Uses Range rects per word: a word whose own range spans
 * two client rects was broken across lines, which no correct layout does.
 */
const PROBE = `(() => {
  const midWord = [], gratuitous = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el || !el.offsetParent) continue;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) continue;

    // mid-word breaks — check each word's own rects
    let i = 0;
    for (const word of raw.split(/(\\s+)/)) {
      const start = i; i += word.length;
      if (!word.trim() || word.length < 4) continue;
      // A break at a hyphen, slash or dash is a legal break opportunity and
      // correct CSS behaviour — "2026-04-30" and "auto-selected" splitting
      // after the hyphen is not a defect. Only an unbroken run of letters
      // splitting mid-way is. Reporting the legal ones is how an advisory
      // report fills with noise and stops being read.
      if (/[-\u2010-\u2015\/_\u00ad]/.test(word)) continue;
      const range = document.createRange();
      try { range.setStart(node, start); range.setEnd(node, start + word.length); } catch { continue; }
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      if (rects.length > 1) {
        // Two rects on the SAME line (e.g. around an inline child) are fine;
        // a real break means different vertical positions.
        //
        // Compared with a tolerance, not by rounding. Rounding tops to whole
        // pixels invents a difference whenever sub-pixel layout puts two rects
        // of one line at 870.4 and 870.6 — they round to 870 and 871 and read
        // as a break. That is what produced 43 "mid-word breaks" on words that
        // sit on a single line when you go and measure them: Model, Household,
        // Downturn, professional, available, every one of them intact on screen.
        //
        // Half a line-height is the right tolerance: anything less is
        // sub-pixel noise, anything more would swallow a real break.
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        const tol = Number.isFinite(lh) ? lh / 2 : 6;
        const lo = Math.min(...rects.map(r => r.top));
        const hi = Math.max(...rects.map(r => r.top));
        if (hi - lo > tol) {
          midWord.push({ word: word.slice(0, 28), tag, cls: String(el.className || '').slice(0, 24) });
        }
      }
    }

    // gratuitous wraps — text that FITS its own content box and wraps anyway.
    //
    // Three things had to change for this to see anything.
    //
    // 1. Own box, not leaf. An inline <span> inside a paragraph wraps because
    //    the PARAGRAPH wrapped, which is correct, and "room to spare" measured
    //    against the paragraph's width is meaningless. Restricting to elements
    //    with their own box (block/flex/grid/inline-block/table-cell) is what
    //    separates a stat label from a sentence fragment. Leaf-only did not:
    //    it excluded every heading containing a <span> while still admitting
    //    every fragment of body copy.
    //
    // 2. Subtract padding. The available width is the CONTENT box. Measuring
    //    against the border box says a 21-character nav pill "fits in 125px"
    //    when 22px of that is padding and the text needs 123px — it does not
    //    fit, it wraps correctly, and reporting it is a false positive.
    //
    // 3. No slack floor. The old 40px threshold excluded every real finding on
    //    the homepage: the two that exist have 14px and 8px of room. A floor
    //    that large only admits text that missed fitting by a wide margin,
    //    which is not how gratuitous wrapping presents.
    //
    // What is deliberately NOT reported: text too long for its container.
    // A 269px note in a 149px column wraps because that is what wrapping is
    // for. Flagging it would rebuild the wall of noise the 1,091-finding first
    // version produced.
    const OWN_BOX = /^(block|flex|grid|inline-block|inline-flex|table-cell|list-item)$/;
    const kids = [...el.childNodes];
    const ownBoxChild = kids.some(n => n.nodeType === 1 && OWN_BOX.test(getComputedStyle(n).display));
    const cs0 = getComputedStyle(el);
    if (!ownBoxChild && OWN_BOX.test(cs0.display)
        && cs0.whiteSpace !== 'nowrap' && cs0.whiteSpace !== 'pre') {
      // \\s, not \s: this whole probe is a template literal, where \s is not a
      // recognised escape and collapses to a bare s. The first run of this
      // rewrite reported 'Need  A e ment' for 'Needs Assessment' — the regex
      // had become /s+/g and was replacing runs of the letter s.
      const whole = el.textContent.trim().replace(/\\s+/g, ' ');
      // Long enough to be text, short enough that one line was plausible.
      if (whole.length >= 3 && whole.length <= 60) {
        // Count REAL line boxes: distinct rect tops over the element's range.
        //
        // The first version divided box height by line-height, which counts the
        // BOX, not the text. Any leaf with extra height — a flex-aligned stat
        // value, an explicit height — reported two lines while showing one, and
        // the run produced 1,091 "findings" that were mostly arithmetic.
        const tr = document.createRange();
        let lines = 1;
        try {
          tr.selectNodeContents(el);
          lines = Math.max(1, new Set([...tr.getClientRects()].map(x => Math.round(x.top))).size);
        } catch { lines = 1; }
        if (lines >= 2) {
          // Clone the element, do not rebuild it from its text.
          //
          // A synthesized span carrying only the font shorthand mismeasures
          // anything with nested inline markup: <code>… AMI<sub>4-person</sub>
          // …</code> came back as "needs 425px, has 912px", a 487px slack that
          // no real gratuitous wrap has. The clone keeps the class, so the
          // page's own CSS applies to it and to its children.
          const probe = el.cloneNode(true);
          probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;'
            + 'width:auto;max-width:none;padding:0;border:0;';
          el.parentElement.appendChild(probe);
          const natural = Math.ceil(probe.getBoundingClientRect().width);
          probe.remove();
          const r0 = el.getBoundingClientRect();
          const avail = Math.floor(r0.width
            - parseFloat(cs0.paddingLeft || 0) - parseFloat(cs0.paddingRight || 0));
          if (avail >= natural) {
            gratuitous.push({ text: whole.slice(0, 38), tag,
              cls: String(el.className || '').slice(0, 26), lines, avail, natural,
              slack: avail - natural });
          }
        }
      }
    }
  }
  const key = (o) => (o.word || o.text) + '|' + o.tag + '|' + o.cls;
  const dedupe = (arr) => { const m = new Map(); for (const o of arr) if (!m.has(key(o))) m.set(key(o), o); return [...m.values()]; };
  return { midWord: dedupe(midWord), gratuitous: dedupe(gratuitous) };
})()`;

const browser = await playwright.chromium.launch();
const findings = [];
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const p of PAGES) {
    const page = await context.newPage();
    page.on('pageerror', () => {});
    page.on('console', () => {});
    try {
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(4000);
      const r = await page.evaluate(PROBE);
      findings.push({ page: p.split('?')[0], width, ...r });
    } catch (e) {
      findings.push({ page: p.split('?')[0], width, error: String(e.message).split('\n')[0].slice(0, 120), midWord: [], gratuitous: [] });
    }
    await page.close();
  }
  await context.close();
}
await browser.close();

const totals = findings.reduce((a, f) => {
  a.midWord += f.midWord.length; a.gratuitous += f.gratuitous.length; return a;
}, { midWord: 0, gratuitous: 0 });

// audit-report/, not data/reports/: this matches the console audit it runs
// beside, and keeps an advisory report out of the tracked data manifest. The
// first version wrote into data/ and the manifest coverage guard caught it —
// correctly. An advisory check should not add churn to a tracked artifact, and
// the workflow already uploads this directory.
const out = path.join(ROOT, 'audit-report', 'text-wrap', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), totals, findings }, null, 2));

if (JSON_ONLY) {
  console.log(JSON.stringify({ totals, findings }, null, 2));
} else {
  // Tight findings first. Slack is the confidence signal: a label that missed
  // fitting by 3px is a layout bug, while one reported with 400px to spare is
  // almost certainly a measurement artefact — nested inline markup, a late
  // font swap, an element the clone cannot reproduce. Sorting by slack puts
  // the credible findings where they are read and the doubtful ones last,
  // instead of mixing them and letting the reader distrust all of them.
  const TIGHT = 24;
  for (const f of findings) {
    if (f.gratuitous) f.gratuitous.sort((a, b) => (a.slack ?? 0) - (b.slack ?? 0));
  }
  const tight = findings.reduce((n, f) =>
    n + (f.gratuitous || []).filter((g) => (g.slack ?? 0) <= TIGHT).length, 0);

  console.log(`\ntext-wrap audit — ADVISORY, never fails the build\n`);
  console.log(`  mid-word breaks   ${totals.midWord}   (a word split across two lines — always wrong)`);
  console.log(`  gratuitous wraps  ${totals.gratuitous}   (short text on 2+ lines with room to spare)`);
  console.log(`                    ${tight} of them missed fitting by ${TIGHT}px or less — start there.`);
  console.log(`                    Findings with a lot of slack are more likely to be`);
  console.log(`                    mismeasured than badly laid out; they sort last.\n`);
  for (const f of findings) {
    if (!f.midWord.length && !f.gratuitous.length) continue;
    console.log(`  ${f.page} @ ${f.width}px`);
    for (const m of f.midWord.slice(0, 4)) console.log(`      broken mid-word: "${m.word}" in <${m.tag.toLowerCase()}>`);
    for (const g of f.gratuitous.slice(0, 4)) {
      console.log(`      ${g.lines} lines for "${g.text}" — needs ${g.natural}px, has ${g.avail}px`);
    }
  }
  console.log(`\n  Report: ${path.relative(ROOT, out)}`);
  console.log(`  Advisory: this exits 0 by design. If the numbers above stop`);
  console.log(`  moving, that is the signal to make it a gate.\n`);
}
