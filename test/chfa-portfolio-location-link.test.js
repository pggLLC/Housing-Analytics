'use strict';
/**
 * chfa-portfolio-location-link — the Location column on chfa-portfolio.html.
 *
 * CHFA's feed carries no property website, so each row links to Google Maps
 * at the point CHFA geocoded the property to. The guards below pin that link
 * to the data it is built from, not to its wording: every link's query must
 * equal the record's own geometry, a record without coordinates must fall
 * back to its address, and a record with neither must show a dash — never a
 * link to 0,0, which is what Number(null) would produce.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'chfa-portfolio.html'), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('chfa-portfolio-location-link');

// Lift esc(), coord() and mapLinkFor() out of the page and make them callable.
function loadMapLinkFor() {
  const start = html.indexOf('function esc(s)');
  const end = html.indexOf('function setStatus(', start);
  assert.ok(start !== -1 && end !== -1,
    'could not find esc()/mapLinkFor() in chfa-portfolio.html — if they were ' +
    'renamed, update this test rather than deleting it');
  // eslint-disable-next-line no-new-func
  return new Function(html.slice(start, end) + '\n return mapLinkFor;')();
}

function queryOf(out) {
  const m = /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=([^"]*)"/.exec(out);
  return m ? decodeURIComponent(m[1]) : null;
}

let mapLinkFor = null;
run('the Location link builder is present and extractable', () => {
  mapLinkFor = loadMapLinkFor();
  assert.equal(typeof mapLinkFor, 'function');
});

function withFn(name, fn) {
  run(name, () => {
    assert.ok(mapLinkFor, 'skipped: mapLinkFor could not be extracted (see above)');
    fn();
  });
}

withFn('every real CHFA record links to its own geometry', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'));
  const features = data.features || [];
  assert.ok(features.length > 0, 'precondition: the portfolio file has records');
  let checked = 0;
  for (const f of features) {
    const [lng, lat] = (f.geometry && f.geometry.coordinates) || [null, null];
    if (lat == null || lng == null) continue;
    const out = mapLinkFor(Object.assign({}, f.properties, { _lat: lat, _lng: lng }));
    assert.equal(queryOf(out), lat + ',' + lng,
      (f.properties.PROJECT || '?') + ' links somewhere other than its CHFA coordinates');
    checked += 1;
  }
  assert.ok(checked > 0, 'no record with coordinates was checked');
});

withFn('the page carries each feature\'s geometry into its row', () => {
  // The builder reads _lat/_lng; the loader must be what puts them there, in
  // GeoJSON [lng, lat] order. Swap them and every link lands in Antarctica.
  assert.match(html, /_lng: c\[0\], _lat: c\[1\]/,
    'loadData() must copy geometry.coordinates [lng, lat] onto the row as _lng/_lat');
});

withFn('no coordinates falls back to the street address', () => {
  const out = mapLinkFor({ PROJECT: 'X', PROJ_ADD: '1612 Carson Avenue', PROJ_CTY: 'La Junta', PROJ_ST: 'CO', _lat: null, _lng: null });
  assert.equal(queryOf(out), '1612 Carson Avenue, La Junta, CO');
});

withFn('absent location is a dash, never a link to 0,0', () => {
  for (const r of [{}, { _lat: null, _lng: null }, { _lat: 0, _lng: 0 }, { _lat: '', _lng: '' }, { PROJ_CTY: 'Denver' }]) {
    const out = mapLinkFor(r);
    assert.equal(queryOf(out), null, 'rendered a map link for ' + JSON.stringify(r) + ': ' + out);
    assert.match(out, /—/);
  }
});

withFn('a property name cannot break out of the link attribute', () => {
  const out = mapLinkFor({ PROJECT: '"><SCRIPT>x</SCRIPT><img src=x>', _lat: 39.7, _lng: -105 });
  // The only markup allowed is the link itself: one opening <a ...> and one
  // </a>. Any other '<' or unescaped quote means the name escaped its attribute.
  const opening = /^<a [^<>]*>/.exec(out);
  assert.ok(opening, 'output does not start with a single <a> tag: ' + out);
  const rest = out.slice(opening[0].length);
  assert.equal(rest, 'Map ↗</a>', 'markup leaked outside the link: ' + out);
  const attrs = opening[0].slice(3, -1).replace(/[a-z-]+="[^"]*"/g, '').trim();
  assert.equal(attrs, '', 'an attribute was broken by the name: ' + opening[0]);
  assert.ok(opening[0].includes('&quot;&gt;&lt;SCRIPT&gt;'), 'the name must appear in escaped form');
});

withFn('the link meets the 44 x 44 px touch-target minimum (copilot-instructions Rule 14)', () => {
  const out = mapLinkFor({ PROJECT: 'X', _lat: 39.7, _lng: -105 });
  const cls = /class="([^"]*)"/.exec(out);
  assert.ok(cls, 'the Map link has no class, so nothing sizes it: ' + out);
  for (const c of cls[1].split(/\s+/)) {
    const rule = new RegExp('\\.' + c + '\\s*\\{([^}]*)\\}').exec(html);
    if (!rule) continue;
    const px = (prop) => {
      const m = new RegExp(prop + ':\\s*(\\d+)px').exec(rule[1]);
      return m ? Number(m[1]) : 0;
    };
    if (px('min-height') >= 44 && px('min-width') >= 44) return;
  }
  assert.fail('no class on the Map link (' + cls[1] + ') sets min-height and min-width of at least 44px');
});

run('header and row column counts agree', () => {
  const thead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  const headers = (thead.match(/<th[\s>]/g) || []).length;
  const rowTpl = html.slice(html.indexOf('return `<tr>'), html.indexOf('</tr>`', html.indexOf('return `<tr>')));
  const cells = (rowTpl.match(/<td[\s>]/g) || []).length;
  assert.ok(headers > 0, 'no headers found');
  assert.equal(cells, headers, 'row template has ' + cells + ' cells for ' + headers + ' headers');
  for (const m of html.matchAll(/portfolioBody[\s\S]{0,400}?colspan="(\d+)"|colspan="(\d+)"/g)) {
    assert.equal(Number(m[1] || m[2]), headers, 'a placeholder row spans the wrong number of columns');
  }
});

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
