// The place profiles (places/<geoid>.html) wear the new format: the hub's header, menu, footer and look, at the
// same addresses, with every card and link they had (paul, 13 Nov 2026: profiles stay, no link lost, no
// function lost). The pages are generated from places/_template.html by scripts/hna/build_place_pages.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
function test(name, fn) { try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); } }

const tpl = read('places/_template.html');
const pages = fs.readdirSync(path.join(ROOT, 'places')).filter((f) => /^\d{7}\.html$/.test(f));
const sample = ['0828745.html', pages[0], pages[pages.length - 1]];

console.log('Place profiles in the new format');

test('the template loads the hub look and the hub menu, from one folder down', () => {
  ['palette.css', 'shell.css', 'templates.css', 'look.css', 'profile.css'].forEach((f) => {
    assert.ok(tpl.includes('href="../hub/' + f + '"'), 'the template does not load hub/' + f);
    assert.ok(fs.existsSync(path.join(ROOT, 'hub', f)), 'hub/' + f + ' is missing');
  });
  const order = ["window.LAB_ROOT = '../';", 'src="../hub/lab-config.js"', 'src="../hub/page-chrome.js"', 'src="../hub/nav.js"'].map((s) => tpl.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order.join() === order.slice().sort((a, b) => a - b).join(), 'LAB_ROOT, lab-config.js, page-chrome.js and nav.js must load in that order');
  assert.ok(tpl.indexOf('id="site-nav"') > 0 && tpl.indexOf('id="site-nav"') < order[3], 'the menu holder must be on the page before hub/nav.js runs');
  assert.ok(!/css\/site-theme\.css|src="[^"]*js\/navigation\.js|dark-mode-toggle\.js/.test(tpl), 'the template still loads the old header or styles');
  assert.ok(/window\.LAB_ROOT/.test(read('hub/lab-config.js')) && /ROOT \+ other/.test(read('hub/lab-config.js')), 'hub/lab-config.js no longer points menu links from a folder down');
});

test('nothing a profile had is dropped: every card, figure holder, link and the glossary', () => {
  ['psRenterCb30', 'psRenterCb50', 'psOwnerCb30', 'psRenterTotal', 'psOwnerTotal', 'psTierLte30', 'psTier3150', 'psTier5180', 'psTier81100', 'psTier100p',
    'psPermitsAvg', 'psPermitsSf', 'psPermitsMf', 'psNeedAnnual', 'psNeedRatio', 'psPermitsNote', 'psOwnershipCard', 'psPlayersCard', 'psPlDevs', 'psPlHomes',
    'psPlBondRow', 'psPlPha', 'psPlNp', 'psPlNames', 'psPlLand', 'psPlNote', 'psChasVintage', 'psSource', 'psChasMethod', 'psTracts', 'psCoverage', 'psChasWarning',
    'placeDisclosure', 'place-data'].forEach((id) => assert.ok(tpl.includes('id="' + id + '"'), 'the template lost #' + id));
  assert.ok(tpl.includes('<h2>Who works on housing here</h2>'), 'the "Who works on housing here" card is gone');
  ['../market-analysis.html?fips={{PLACE_GEOID}}&geoType=place&auto=1', '../deal-calculator.html?geoid={{PLACE_GEOID}}',
    '../housing-needs-assessment.html?type={{PLACE_TYPE}}&geoid={{PLACE_GEOID}}', '../about.html', '../methods.html#how-we-check', '../terms-of-use.html',
    '../privacy-policy.html', '../sitemap.html', 'mailto:info@cohoanalytics.com'].forEach((h) => assert.ok(tpl.includes('href="' + h + '"'), 'the template lost the link to ' + h));
  assert.ok(tpl.includes('src="../js/glossary.js"'), 'glossary definitions are no longer loaded on a profile (js/navigation.js used to load them)');
  assert.ok(tpl.includes('lang="es"') && tpl.includes('data-feedback'), 'the Español or feedback link is gone');
});

test('each profile links the full Housing Needs Assessment for its own place', () => {
  assert.ok(tpl.includes('href="../places-hub.html#/place/{{PLACE_GEOID}}"'), 'the template does not link the hub place view');
  assert.ok(/\^#\\\\\/place\\\\\/\\\\d\{5,7\}/.test(read('hub/lab-config.js')), 'places-hub.html no longer draws #/place/<geoid>');
  sample.forEach((f) => assert.ok(read('places/' + f).includes('href="../places-hub.html#/place/' + f.replace('.html', '') + '"'), 'places/' + f + ' does not link its own place'));
});

test('all 482 profiles and their list are built from this template', () => {
  assert.equal(pages.length, 482, 'expected 482 profiles, found ' + pages.length);
  const stale = pages.filter((f) => { const h = read('places/' + f); return !h.includes('../hub/page-chrome.js') || /src="[^"]*js\/navigation\.js/.test(h); });
  assert.equal(stale.length, 0, stale.length + ' profiles are not in the new format, e.g. ' + stale.slice(0, 3).join(', '));
  const index = read('places/index.html');
  assert.ok(index.includes('../hub/page-chrome.js') && !/src="[^"]*js\/navigation\.js/.test(index), 'places/index.html is not in the new format');
  assert.equal((index.match(/<li><a href="\d{7}\.html">/g) || []).length, 482, 'places/index.html does not list all 482 profiles');
});

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
