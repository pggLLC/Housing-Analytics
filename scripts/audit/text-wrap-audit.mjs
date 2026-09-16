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

/** Pages and widths. Kept small: this is a smoke check, not a full sweep. */
const PAGES = [
  '/housing-needs-assessment.html?geoid=0867280&geoType=place&auto=1',
  '/hna-what-housing-exists.html?geoid=0867280&geoType=place&auto=1',
  '/deal-calculator.html',
  '/market-analysis.html',
  '/hna-comparative-analysis.html',
];
const WIDTHS = [1280, 768];

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
      const rects = range.getClientRects();
      if (rects.length > 1) {
        // Two rects on the SAME line (e.g. around an inline child) are fine;
        // a real break means different vertical positions.
        const tops = new Set([...rects].map(r => Math.round(r.top)));
        if (tops.size > 1) {
          midWord.push({ word: word.slice(0, 28), tag, cls: String(el.className || '').slice(0, 24) });
        }
      }
    }

    // gratuitous wraps — leaf elements only, short text, room to spare
    if (el.children.length === 0 && raw.trim().length <= 48) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Count REAL line boxes: distinct rect tops over the text's own range.
      //
      // The first version divided box height by line-height, which counts the
      // BOX, not the text. Any leaf with extra height — a flex-aligned stat
      // value, an explicit height — reported two lines while showing one, and
      // the run produced 1,091 "findings" that were mostly arithmetic. An
      // advisory report full of false positives is one nobody reads, which is
      // the exact failure this tool is supposed to avoid.
      const tr = document.createRange();
      let lines = 1;
      try {
        tr.selectNodeContents(node);
        const tops = new Set([...tr.getClientRects()].map(x => Math.round(x.top)));
        lines = Math.max(1, tops.size);
      } catch { lines = 1; }
      if (lines >= 2) {
        const probe = el.cloneNode(true);
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:auto;padding:0;';
        document.body.appendChild(probe);
        const natural = Math.ceil(probe.getBoundingClientRect().width);
        probe.remove();
        const avail = Math.floor(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
        if (avail - natural > 40) {
          gratuitous.push({ text: raw.trim().slice(0, 34), tag, cls: String(el.className || '').slice(0, 24), lines, avail, natural });
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
  console.log(`\ntext-wrap audit — ADVISORY, never fails the build\n`);
  console.log(`  mid-word breaks   ${totals.midWord}   (a word split across two lines — always wrong)`);
  console.log(`  gratuitous wraps  ${totals.gratuitous}   (short text on 2+ lines with room to spare)\n`);
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
