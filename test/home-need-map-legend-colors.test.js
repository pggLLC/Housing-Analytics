// Regression test: the homepage need-severity map (js/components/home-need-map.js)
// and its legend (index.html's .home-need-legend) must render the SAME four
// colors for the SAME four labels.
//
// The bug: the legend used `style="background:var(--good,#16a34a)"` etc. —
// intending the literal hex as a fallback — but --good/--accent/--warn/--bad
// ARE defined elsewhere in css/site-theme.css and css/dark-mode.css as the
// site's general-purpose UI colors (e.g. --accent is teal, #096e65/#0fd4cf,
// not the #1d4ed8 blue the map uses for "Moderate"). Since the variables are
// defined, the browser uses their real values, not the fallback, so the
// legend swatches rendered entirely different colors than the map's own
// polygon fills for the identical severity bands.
//
// This test extracts both color sets from source and asserts they match
// exactly, label for label — it would have caught the original bug (legend
// colors far from the map's) and catches any future edit that updates one
// side without the other.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mapSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'components', 'home-need-map.js'),
  'utf8'
);
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Parse BANDS from home-need-map.js: { min: N, color: '#hex', label: 'X' }
const bandRe = /\{\s*min:\s*[^,]+,\s*color:\s*'(#[0-9a-fA-F]{6})',\s*label:\s*'([^']+)'\s*\}/g;
const mapColors = {};
let bm;
while ((bm = bandRe.exec(mapSrc))) {
  mapColors[bm[2]] = bm[1].toLowerCase();
}
assert(
  Object.keys(mapColors).length === 4,
  'expected 4 BANDS entries in home-need-map.js, found ' + Object.keys(mapColors).length
);

// Parse the legend block in index.html.
const legendBlockMatch = indexSrc.match(
  /<div class="home-need-legend"[^>]*>([\s\S]*?)<\/div>/
);
assert(legendBlockMatch, 'could not find .home-need-legend block in index.html');
const legendBlock = legendBlockMatch[1];

const itemRe = /<span class="home-need-legend__swatch" style="background:([^"]+)"><\/span>([A-Za-z]+)/g;
const legendColors = {};
let lm;
while ((lm = itemRe.exec(legendBlock))) {
  legendColors[lm[2]] = lm[1].toLowerCase();
}
assert(
  Object.keys(legendColors).length === 4,
  'expected 4 legend swatches in index.html, found ' + Object.keys(legendColors).length
);

// Every legend swatch must be a literal hex color, not a var() reference —
// a var() would only be guaranteed equal to the map's literal hex if that
// custom property were reserved solely for this palette, which --good /
// --accent / --warn / --bad are not.
for (const [label, value] of Object.entries(legendColors)) {
  assert(
    /^#[0-9a-f]{6}$/.test(value),
    'legend swatch for "' + label + '" is ' + JSON.stringify(value) +
      ' — must be a literal hex color, not a var() reference, or it can silently ' +
      'diverge from the map colors again if that custom property is redefined elsewhere'
  );
}

assert.deepStrictEqual(
  legendColors,
  mapColors,
  'home-need-map.js BANDS colors and index.html .home-need-legend swatch colors have drifted apart:\n' +
    '  map:    ' + JSON.stringify(mapColors) + '\n' +
    '  legend: ' + JSON.stringify(legendColors)
);

console.log('home-need-map-legend-colors: PASS — legend swatches match the map\'s BANDS colors exactly, label for label');
