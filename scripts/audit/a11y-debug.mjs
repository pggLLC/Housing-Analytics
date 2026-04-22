#!/usr/bin/env node
/**
 * One-off detail dumper for color-contrast violations — writes axe's computed
 * fgColor/bgColor/contrastRatio/expectedContrastRatio per node. Use this when
 * axe flags something the naive token math says should pass (e.g., an
 * inherited background from a parent overrides the token).
 *
 * Not wired into CI — run ad-hoc when investigating a remaining violation.
 *   node scripts/audit/a11y-debug.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const PAGES = [
  'economic-dashboard.html',
  'dashboard.html',
  'about.html',
];

const playwright = await import('playwright');
const browser = await playwright.chromium.launch();
const axePath = path.join(ROOT, 'node_modules', 'axe-core', 'axe.js');

for (const p of PAGES) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/*', r => r.continue({ headers: { ...r.request().headers(), 'Cache-Control': 'no-cache, no-store, must-revalidate' } }));
  const page = await ctx.newPage();
  page.on('pageerror', () => {}); page.on('console', () => {});
  await page.goto(pathToFileURL(path.join(ROOT, p)).href + '?audit=' + Date.now(), { waitUntil: 'load', timeout: 15_000 });
  await page.addScriptTag({ path: axePath });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } });
    return res.violations.filter(v => v.id === 'color-contrast').map(v => ({
      help: v.help,
      nodes: v.nodes.map(n => ({
        target: n.target,
        html: (n.html || '').slice(0, 200),
        failureSummary: n.failureSummary,
        any: n.any.map(a => ({ id: a.id, message: a.message, data: a.data })),
      }))
    }));
  });
  console.log(`\n=== ${p} ===`);
  console.log(JSON.stringify(r, null, 2));
  await ctx.close();
}
await browser.close();
