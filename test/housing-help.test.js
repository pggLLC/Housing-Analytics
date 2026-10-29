'use strict';
// test/housing-help.test.js
// "If You Need Housing Now" (housing-help.html) and the site-wide Español
// link (js/navigation.js spanishLink).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The page: an English and a Spanish section, official links only, sourced.
const page = new JSDOM(read('housing-help.html')).window.document;
const en = page.getElementById('en');
const es = page.getElementById('es');
assert.equal(en.getAttribute('lang'), 'en');
assert.equal(es.getAttribute('lang'), 'es');
assert.match(page.querySelector('h1').textContent, /If You Need Housing Now/);
// Both languages carry the same help lines and the same official links.
for (const s of ['2-1-1', '1-844-926-6632', '(303) 838-1200', '303-864-7810']) {
  assert.ok(en.textContent.includes(s), 'English has ' + s);
  assert.ok(es.textContent.includes(s), 'Spanish has ' + s);
}
const hrefs = sec => [...sec.querySelectorAll('a[href^="http"]')].map(a => a.href).sort();
assert.deepEqual(hrefs(es), hrefs(en), 'the Spanish section links the same programs');
const OFFICIAL = /^https:\/\/(www\.)?(211colorado\.org|coloradohousingconnects\.org|doh\.colorado\.gov|leg\.colorado\.gov|coloradohousingsearch\.com|chfainfo\.com|www\.chfainfo\.com|denvergov\.org|www\.denvergov\.org|coloradolegalservices\.org|copovertylawproject\.org|cedproject\.org)\//;
for (const a of page.querySelectorAll('a[href^="http"]')) {
  assert.match(a.href, OFFICIAL, a.href + ' is an official or state-listed program');
  assert.equal(a.getAttribute('rel'), 'noopener');
}
// Every program linked in the help sections appears in Sources, or is listed
// by a Sources page.
const sources = [...page.querySelectorAll('.hh-sources a')].map(a => a.href);
for (const u of ['https://doh.colorado.gov/emergency-rental-assistance', 'https://doh.colorado.gov/housing-vouchers',
  'https://leg.colorado.gov/bills/hb24-1098', 'https://doh.colorado.gov/foreclosures-evictions-and-legal-help']) {
  assert.ok(sources.includes(u), 'Sources cites ' + u);
}

// The Español link.
function nav(url) {
  const dom = new JSDOM('<main id="main-content"></main><footer id="site-footer"></footer>', { runScripts: 'outside-only', url });
  dom.window.eval(read('js/navigation.js'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom.window.document;
}
let d = nav('https://cohoanalytics.com/deal-calculator.html?geoid=08077&tdc=25000000&units=60#results');
const links = d.querySelectorAll('a[data-lang-link]');
assert.ok(links.length >= 2, 'Español is in the header or drawer and the footer');
for (const a of links) {
  assert.ok(a.textContent === 'Español' || (a.textContent === 'ES' && a.getAttribute('aria-label') === 'Español'));
  assert.equal(a.getAttribute('lang'), 'es');
  const u = new URL(a.href);
  assert.equal(u.hostname, 'translate.google.com');
  const target = new URL(u.searchParams.get('u'));
  assert.equal(target.pathname, '/deal-calculator.html');
  assert.equal(target.searchParams.get('geoid'), '08077', 'the place travels');
  assert.equal(target.searchParams.get('tdc'), null, 'deal inputs never go to Google');
  assert.equal(target.searchParams.get('units'), null);
  assert.equal(target.hash, '');
}
// The renter page jumps to its own Spanish instead.
d = nav('https://cohoanalytics.com/housing-help.html');
for (const a of d.querySelectorAll('a[data-lang-link]')) {
  assert.equal(a.getAttribute('href'), '#es');
  assert.equal(a.getAttribute('target'), null);
}
// The member site is never sent to Google.
d = nav('https://coho-backend.communityplanner.workers.dev/deal-calculator.html');
assert.equal(d.querySelectorAll('a[data-lang-link]').length, 0);
// The menu lists the page under its h1.
assert.match(read('js/navigation.js'), /label: "If You Need Housing Now",\s*href: "housing-help\.html"/);
console.log('housing-help: all checks passed');
