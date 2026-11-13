// Regression test: the county need map on Home and its legend must use the SAME colors for the SAME bands.
//
// The bug this was written for (old homepage, js/components/home-need-map.js): the legend swatches were written
// as `var(--good,#16a34a)` and so on, meaning the hex as a fallback, but --good/--accent/--warn/--bad are the
// site's general UI colors, so the swatches drew different colors from the map's own polygon fills.
//
// Home was rebuilt on 13 Nov 2026 (index.html now draws hub/home.js; the map is hub/county-need.js). The map
// fills and the legend swatches are both written as one of the map ramp's own custom properties (--map-1 to
// --map-5, hub/palette.css), which nothing else uses. This reads both from the page as drawn and fails if a
// swatch names a color no county is filled with, if a county is filled with a color the legend does not show,
// or if either side stops using the ramp.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderHome } = require('./helpers/render-home');

(async () => {
  const html = await renderHome();
  const figure = (/<figure class="need-map county-need"[\s\S]*?<\/figure>/.exec(html) || [])[0];
  assert(figure, 'Home no longer draws the county need map (figure.need-map.county-need)');

  const fills = [...figure.matchAll(/<a [^>]*data-county="(\d{5})"[^>]*><path [^>]*\bfill="([^"]+)"/g)].map((m) => m[2]);
  assert(fills.length === 64, 'expected 64 county shapes on the map, found ' + fills.length);
  const key = (/<ul class="need-key cn-key">([\s\S]*?)<\/ul>/.exec(figure) || [])[1] || '';
  const swatches = [...key.matchAll(/<span class="need-swatch" style="background:([^"]+)"[^>]*><\/span>([^<]+)/g)].map((m) => ({ color: m[1], label: m[2].trim() }));
  assert(swatches.length >= 3, 'expected the legend to list its bands, found ' + swatches.length);

  // Both sides use the map ramp and nothing else. A general-purpose property (--good, --accent, --warn, --bad)
  // or a literal that the other side does not share is how the two drifted apart before.
  const RAMP = /^var\(--map-[1-5]\)$/;
  const NO_DATA = /^var\(--map-(none|na|missing)\)$/;
  for (const s of swatches) assert(RAMP.test(s.color) || NO_DATA.test(s.color), 'legend swatch "' + s.label + '" is ' + s.color + ', not a color of the map ramp');
  for (const f of new Set(fills)) assert(RAMP.test(f) || NO_DATA.test(f), 'a county is filled with ' + f + ', not a color of the map ramp');

  const shown = new Set(swatches.map((s) => s.color));
  const used = new Set(fills);
  const unexplained = [...used].filter((c) => !shown.has(c));
  assert.deepStrictEqual(unexplained, [], 'counties are filled with colors the legend does not show: ' + unexplained.join(', '));
  assert(new Set(swatches.map((s) => s.color)).size === swatches.length, 'two legend bands share one color');
  assert(new Set(swatches.map((s) => s.label)).size === swatches.length, 'two legend bands share one label');

  // The ramp is defined, for light and dark, in the sheet the page loads; an undefined property draws nothing.
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(/href="hub\/palette\.css"/.test(page), 'index.html no longer loads hub/palette.css, where the map ramp is defined');
  const palette = fs.readFileSync(path.join(__dirname, '..', 'hub', 'palette.css'), 'utf8');
  for (const c of new Set([...shown, ...used])) {
    const name = c.slice(4, -1);
    assert(palette.split(/[;{}\n]/).some((d) => d.trim().split(':')[0].trim() === name), name + ' is used on the map but hub/palette.css does not define it');
  }

  console.log('home-need-map-legend-colors: PASS — ' + swatches.length + ' legend bands and ' + used.size + ' fill colors, all from the map ramp, every fill in the legend');
})().catch((e) => { console.error(e); process.exit(1); });
