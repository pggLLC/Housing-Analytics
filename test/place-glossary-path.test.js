#!/usr/bin/env node
/* Verify nested generated place pages load the shared glossary from site root. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const glossarySrc = fs.readFileSync(path.join(ROOT, 'js', 'glossary.js'), 'utf8');

async function run() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><nav class="site-nav"></nav><main>AMI LIHTC CHAS</main></body></html>', {
    url: 'https://cohoanalytics.com/places/0824950.html',
    runScripts: 'outside-only',
  });

  const requested = [];
  dom.window.fetch = async (url) => {
    requested.push(String(url));
    return {
      ok: true,
      json: async () => ({ terms: [] }),
    };
  };
  dom.window.APP_BASE_PATH = '/';

  dom.window.eval(glossarySrc);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));

  await new Promise(resolve => setTimeout(resolve, 0));

  assert(
    requested.includes('/data/glossary.json'),
    `expected glossary fetch from /data/glossary.json, got ${requested.join(', ') || '(none)'}`
  );
  assert(
    !requested.includes('data/glossary.json'),
    'nested place pages must not fetch relative data/glossary.json'
  );
  assert(
    !requested.some(url => url.includes('/places/data/glossary.json')),
    'nested place pages must not fetch /places/data/glossary.json'
  );

  console.log('Place glossary path: PASS');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
