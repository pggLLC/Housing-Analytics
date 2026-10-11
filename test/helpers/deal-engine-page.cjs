'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sources = require('../fixtures/deal-engine/invented-sources.cjs');
const root = path.resolve(__dirname, '../..');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
async function routeInvented(page) {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://example.org') return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1));
    if (Object.hasOwn(sources, rel)) return route.fulfill({ json: sources[rel] });
    if (rel.startsWith('data/')) return route.fulfill({ status: 404, json: { unavailableReason: 'not_in_invented_fixture' } });
    // The baseline also captured hidden explanation text initialized at mount.
    // Make the invented CHFA source ready before the deferred calculator runs,
    // rather than letting response timing choose that initial source-date text.
    if (rel === 'js/deal-calculator.js' && new URL(page.url()).pathname === '/deal-calculator.html') {
      await page.waitForFunction(() => window.__DealCalcChfaTablePromise);
      await page.evaluate(() => window.__DealCalcChfaTablePromise);
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
}
module.exports = { routeInvented };
