'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HOSTILE = '<tag data-note="quoted">A & B</tag>';
// DOM serialization keeps quotes literal in text nodes, while preserving the
// security-significant escaping of tag delimiters and ampersands.
const ESCAPED_TEXT = '&lt;tag data-note="quoted"&gt;A &amp; B&lt;/tag&gt;';

function loadComponent(relativePath, body) {
  const dom = new JSDOM(body, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/data-quality.html'
  });
  dom.window.eval(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
  return dom;
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

(async function run() {
  const dqsDom = loadComponent(
    'js/components/data-quality-summary.js',
    '<div id="quality"></div>'
  );
  dqsDom.window.DataQualitySummary.render('quality', {
    sources: [{ name: 'Normal source', status: 'primary', vintage: HOSTILE }],
    limitations: HOSTILE,
    lastUpdated: HOSTILE
  });
  const dqsHtml = dqsDom.window.document.getElementById('quality').innerHTML;
  assert(dqsHtml.includes(ESCAPED_TEXT), 'data-quality text and vintage must be HTML-escaped');
  assert(!dqsHtml.includes('<tag'), 'data-quality hostile text must not become markup');
  assert(dqsHtml.includes('Normal source'), 'normal source text must render unchanged');

  const contextDom = loadComponent(
    'js/components/page-context.js',
    '<div id="context"></div>'
  );
  contextDom.window.PageContext.render('context', {
    what: HOSTILE,
    why: HOSTILE,
    not: HOSTILE,
    nextSteps: [{ label: HOSTILE, href: 'compare.html', desc: HOSTILE }]
  });
  const contextHtml = contextDom.window.document.getElementById('context').innerHTML;
  assert.strictEqual(
    contextHtml.split(ESCAPED_TEXT).length - 1,
    5,
    'all page-context narrative and related-step text must be HTML-escaped'
  );
  assert(!contextHtml.includes('<tag'), 'page-context hostile text must not become markup');
  assert(contextHtml.includes('href="compare.html"'), 'existing safe link rendering must remain unchanged');

  contextDom.window.PageContext.render('context', {
    what: 'Normal summary',
    why: 'Normal explanation',
    not: 'Normal limitation'
  });
  assert.strictEqual(
    contextDom.window.document.getElementById('context').innerHTML,
    '<details class="pctx-panel" open=""><summary class="pctx-summary">About this page</summary>' +
      '<div class="pctx-body"><div class="pctx-section"><div class="pctx-label">What this page does</div>' +
      '<p class="pctx-text">Normal summary</p></div><div class="pctx-section"><div class="pctx-label">Why it matters</div>' +
      '<p class="pctx-text">Normal explanation</p></div><div class="pctx-section pctx-not">' +
      '<div class="pctx-label">What this page does NOT do</div><p class="pctx-text">Normal limitation</p></div></div></details>',
    'normal page-context markup must render byte-identically'
  );

  const dashboard = fs.readFileSync(path.join(ROOT, 'dashboard-data-quality.html'), 'utf8');
  const dashboardDocument = new JSDOM(dashboard).window.document;
  const inlineScripts = [...dashboardDocument.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent)
    .filter((source) => source.trim());
  assert.strictEqual(inlineScripts.length, 1, 'dashboard exposes one inline application script');

  const dashboardDom = new JSDOM(
    '<div id="pipelineLog"></div><div id="apiKeyForm"></div>' +
      '<div id="qaLayerGrid"></div><div id="qaStatusMeta"></div>',
    { runScripts: 'outside-only', url: 'http://127.0.0.1/dashboard-data-quality.html' }
  );
  dashboardDom.window.localStorage.setItem('coho_api_CENSUS_API_KEY', 'a<&"zz-secret');
  dashboardDom.window.fetch = function () { return Promise.reject(new Error(HOSTILE)); };
  dashboardDom.window.eval(inlineScripts[0]);
  dashboardDom.window.document.dispatchEvent(new dashboardDom.window.Event('DOMContentLoaded'));
  await flushPromises();

  const formHtml = dashboardDom.window.document.getElementById('apiKeyForm').innerHTML;
  const censusInput = dashboardDom.window.document.getElementById('keyInput_CENSUS_API_KEY');
  assert(formHtml.includes('a<&amp;&quot;zz••••••••'), 'stored-key preview must escape ampersand and quote in markup');
  assert.strictEqual(censusInput.placeholder, 'a<&"zz••••••••', 'escaped preview must retain its normal displayed text');
  assert(!censusInput.hasAttribute('zz••••••••'), 'stored-key preview must not break out of its attribute');

  const qaHtml = dashboardDom.window.document.getElementById('qaLayerGrid').innerHTML;
  assert(qaHtml.includes(ESCAPED_TEXT), 'QA fetch errors must be HTML-escaped');
  assert(!qaHtml.includes('<tag'), 'QA fetch errors must not become markup');
  assert(qaHtml.includes('QA status not available'), 'normal QA fallback text must remain unchanged');

  console.log('xss-data-quality: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
