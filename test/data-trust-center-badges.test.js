#!/usr/bin/env node
// test/data-trust-center-badges.test.js
//
// Issue #1228 PR 3: the Data Trust Center monitoring badge must be populated
// from committed freshness artifacts, not hardcoded placeholder dashes.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const hubHtml = read('data-review-hub.html');
const handlerJs = read('js/discovery-ui-handler.js');
const discoveryJs = read('js/data-source-discovery.js');
const freshnessJs = read('js/data-freshness-monitor.js');
const manifest = JSON.parse(read('data/manifest.json'));

assert.ok(Date.parse(manifest.generated), 'data/manifest.json exposes an ISO generated timestamp');

const badgeStart = hubHtml.indexOf('id="drhMonitorBadge"');
assert.notEqual(badgeStart, -1, 'Data Trust Center includes the monitoring badge');
const badgeHtml = hubHtml.slice(badgeStart, hubHtml.indexOf('</div>', badgeStart));
assert.doesNotMatch(badgeHtml, /<strong>—<\/strong>/, 'static badge HTML never renders placeholder dashes');
assert.match(badgeHtml, /drhLastScanBadge/, 'badge exposes a last-scan target for runtime hydration');
assert.match(badgeHtml, /drhPendingBadge/, 'badge exposes a pending-count target for runtime hydration');

assert.match(handlerJs, /data\/manifest\.json/, 'runtime badge reads the generated data manifest');
assert.doesNotMatch(handlerJs, /data\/audit\/quarantine-candidates\.json/, 'runtime badge does not fetch private quarantine candidates');
assert.match(discoveryJs, /var MANIFEST_PATH = 'data\/manifest\.json'/, 'browser discovery uses the public manifest');
assert.doesNotMatch(discoveryJs, /DATA-MANIFEST\.json|data-discovery-config\.json|CONFIG_PATH/, 'browser discovery avoids private maintainer artifacts');
assert.match(freshnessJs, /var MANIFEST_PATH\s+= 'data\/manifest\.json'/, 'freshness monitor uses the public manifest');
assert.doesNotMatch(freshnessJs, /var MANIFEST_PATH\s+= 'DATA-MANIFEST\.json'/, 'freshness monitor no longer fetches the private root manifest');
assert.doesNotMatch(hubHtml, /href="DATA-MANIFEST\.json"|href="config\/data-discovery-config\.json"/, 'public hub does not link stripped maintainer-only artifacts');

async function runRenderedBadgeCheck() {
  const dom = new JSDOM(
    '<div id="drhLiveRegion"></div>' +
    '<div id="drhMonitorBadge" aria-label="Monitoring status" role="status"></div>' +
    '<span id="drhPendingCount"></span>' +
    '<div id="drhPendingList"></div>',
    {
      url: 'https://cohoanalytics.com/data-review-hub.html',
      runScripts: 'outside-only'
    }
  );

  const { window } = dom;
  const fetched = [];
  window.requestAnimationFrame = (cb) => cb();
  window.resolveAssetUrl = (assetPath) => assetPath;
  window.fetch = (assetPath) => {
    fetched.push(String(assetPath));
    if (assetPath === 'data/manifest.json') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ generated: '2026-07-17T09:11:02.408815Z' })
      });
    }
    return Promise.reject(new Error(`Unexpected fetch in badge test: ${assetPath}`));
  };

  window.eval(handlerJs);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  const badgeText = window.document.getElementById('drhMonitorBadge').textContent.replace(/\s+/g, ' ').trim();
  assert.ok(fetched.includes('data/manifest.json'), 'render path fetched data/manifest.json');
  assert.ok(
    !fetched.includes('data/audit/quarantine-candidates.json'),
    'render path never fetched private quarantine candidates'
  );
  assert.match(badgeText, /Last inventory:/, 'manifest-backed badge labels the generated inventory timestamp');
  assert.match(badgeText, /(Jul|2026)/, 'rendered badge includes a real date from the manifest timestamp');
  assert.match(badgeText, /Pending:\s*(?:Loading…|n\/a)/, 'rendered badge degrades pending count without a private artifact fetch');
  assert.ok(!badgeText.includes('—'), 'rendered badge never includes the placeholder dash');
}

runRenderedBadgeCheck()
  .then(() => {
    console.log('Data Trust Center hub badges: PASS');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
