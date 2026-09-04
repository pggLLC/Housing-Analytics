'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
const printCss = fs.readFileSync(path.join(ROOT, 'css', 'print.css'), 'utf8');
const exportSource = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-export.js'), 'utf8');
const legacyExportSource = fs.readFileSync(path.join(ROOT, 'js', 'hna-export.js'), 'utf8');

async function main() {
  assert(
    /<link[^>]+href="css\/print\.css"[^>]+media="print"/.test(page),
    'HNA must load the shared print stylesheet'
  );
  assert(page.includes('id="hnaMap"'), 'HNA must retain its map container');
  assert(page.includes('<canvas'), 'HNA must retain printable chart canvases');
  assert(/\.leaflet-container\s*\{/.test(printCss), 'print CSS must handle Leaflet map containers');
  assert(/canvas\s*\{[^}]*break-inside:\s*avoid/s.test(printCss), 'print CSS must keep chart canvases together');
  assert(/break-inside:\s*avoid/.test(printCss), 'print CSS must contain page-break protection');

  const dom = new JSDOM(
    '<!doctype html><html><body><main><h1>Housing Needs Assessment</h1><p>Selected-place report content</p></main><button id="btnPdf">Print</button></body></html>',
    { url: 'http://127.0.0.1/housing-needs-assessment.html' }
  );
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = async () => ({ ok: false, json: async () => null });
  window.fetch = global.fetch;

  const canvasRequests = [];
  window.html2canvas = async function (_node, options) {
    canvasRequests.push(options || {});
    throw new Error('HNA print export must not request a raster canvas');
  };
  window.jspdf = { jsPDF: function () { throw new Error('HNA print export must not construct jsPDF'); } };

  let printedDocument = '';
  let printCalls = 0;
  window.print = function () {
    printCalls += 1;
    printedDocument = dom.serialize();
  };

  const modulePath = path.join(ROOT, 'js', 'hna', 'hna-export.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);

  assert.equal(typeof window.__HNA_exportPdf, 'function', 'HNA must expose its PDF action');
  assert.equal(window.__HNA_exportPdfScreenshot, undefined, 'unbounded screenshot export must not remain public');
  await window.__HNA_exportPdf('ignored-by-browser-print.pdf');

  assert.equal(printCalls, 1, 'PDF action must hand the report to the browser print dialog');
  assert(printedDocument.includes('Housing Needs Assessment'), 'the document handed to print must contain the report');
  assert(printedDocument.includes('Selected-place report content'), 'the document handed to print must contain selected report content');
  assert.equal(canvasRequests.length, 0, 'PDF action must never request a full-page raster canvas');
  assert(canvasRequests.every((request) => !(request.height > 32767)), 'PDF action must never request a canvas taller than 32,767px');
  assert(!page.includes('html2canvas.min.js'), 'HNA must not load html2canvas for PDF export');
  assert(!page.includes('jspdf.umd.min.js'), 'HNA must not load jsPDF for PDF export');
  assert(exportSource.includes('window.__HNA_exportPdf       = exportPdf'), 'public PDF action must use browser printing');
  assert(!legacyExportSource.includes('html2canvas'), 'legacy HNA export API must not retain the full-page screenshot path');
  assert(!legacyExportSource.includes('jspdf'), 'legacy HNA export API must not retain the raster PDF path');

  console.log('HNA print export tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
