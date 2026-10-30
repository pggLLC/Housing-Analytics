'use strict';
/**
 * Downloaded reports must read as sentences.
 *
 * The page wraps glossary terms in an <abbr> that carries the definition in a
 * hidden pop-up. Read with textContent, the HNA PDF printed "≤30%
 * AMIArea Median IncomeThe midpoint of the income distribution…" in its
 * summary, and the built-in PDF font printed ≤ and ≥ as "d" and "e". The
 * Market Analysis report copied the same pop-ups into its HTML and lost the
 * page's colour variables, so its score badges printed white on nothing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createJsPdfMock } = require('./helpers/jspdf-mock.cjs');

const ROOT = path.resolve(__dirname, '..');
const POPUP = '<abbr class="gl-tooltip-trigger" data-glossary-term="AMI">AMI<span class="gl-tooltip-popup" aria-hidden="true"><strong>Area Median Income</strong>The midpoint of the income distribution…</span></abbr>';

(async () => {
  const dom = new JSDOM(`<!doctype html><body><main>
    <div id="execNarrative">98% of renter households earning ≤30% ${POPUP} are cost-burdened; severe burden (paying ≥50% of income) is 24.6%.</div>
  </main></body>`, { runScripts: 'outside-only', url: 'http://localhost/housing-needs-assessment.html' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-export.js'), 'utf8'));

  const data = w.HNAExport.buildReportData();
  assert.ok(/98% of renter households/.test(data.narrative), 'non-vacuous: the summary is read');
  assert.ok(!/Area Median Income|midpoint/.test(data.narrative), 'the glossary definition is not pasted into the summary: ' + data.narrative);
  console.log('PASS the HNA summary leaves out glossary pop-up text');

  const pdf = createJsPdfMock({ wrapText: true });
  w.jspdf = { jsPDF: pdf.jsPDF };
  await w.HNAExport.exportPdf('t.pdf');
  pdf.assertSupported();
  assert.ok(pdf.saved, 'non-vacuous: the PDF was written');
  const all = pdf.text.join('\n');
  assert.ok(/98% of renter households earning <=30% AMI/.test(all), 'non-vacuous: the summary reached the PDF with <= in place of the symbol');
  assert.ok(!/[≤≥]/.test(all), 'no ≤ or ≥ reaches the PDF font, which has no glyph for them');
  console.log('PASS the HNA PDF prints <= and >= instead of the missing glyphs');

  // Market report: the copied sections need the page's colours, and the pop-ups stay hidden.
  const ren = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis', 'market-report-renderers.js'), 'utf8');
  const style = ren.slice(ren.indexOf("'<title>PMA Site Analysis Report</title>'"), ren.indexOf("'</style></head><body>'"));
  for (const v of ['--good', '--warn', '--bad', '--muted', '--border']) {
    assert.ok(new RegExp(v + ':\\s*#?[\\w(]').test(style), 'the report window defines ' + v);
  }
  assert.ok(/\.gl-tooltip-popup\s*\{\s*display:\s*none/.test(style), 'the report hides glossary pop-ups');
  console.log('PASS the Market report carries the colours its badges use and hides glossary pop-ups');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
