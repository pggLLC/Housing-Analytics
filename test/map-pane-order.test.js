const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function countPane(src, paneName) {
  const matches = src.match(new RegExp("(?:pane\\s*:\\s*|\\.pane\\s*=\\s*)['\"]" + paneName + "['\"]", 'g'));
  return matches ? matches.length : 0;
}

function paneZIndex(src, paneName) {
  const re = new RegExp("name\\s*:\\s*['\"]" + paneName + "['\"][\\s\\S]{0,120}?zIndex\\s*:\\s*(\\d+)");
  const match = src.match(re);
  assert(match, paneName + ' zIndex is declared in js/map-panes.js');
  return Number(match[1]);
}

function assertScriptBefore(pageSrc, paneScript, mapScript, pageName) {
  const paneIdx = pageSrc.indexOf(paneScript);
  const mapIdx = pageSrc.indexOf(mapScript);
  assert(paneIdx >= 0, pageName + ' includes ' + paneScript);
  assert(mapIdx >= 0, pageName + ' includes ' + mapScript);
  assert(paneIdx < mapIdx, pageName + ' loads map panes before the map implementation');
}

const mapPanesPath = path.join(root, 'js/map-panes.js');
assert(fs.existsSync(mapPanesPath), 'js/map-panes.js exists');

const panes = read('js/map-panes.js');
const fillsZ = paneZIndex(panes, 'fillsPane');
const pointsZ = paneZIndex(panes, 'pointsPane');
assert(fillsZ < pointsZ, 'fillsPane remains below pointsPane');
assert(pointsZ < 600, 'pointsPane remains below Leaflet markerPane');

const lofPage = read('lihtc-opportunity-finder.html');
const pmaPage = read('market-analysis.html');
assertScriptBefore(lofPage, 'js/map-panes.js', 'js/lihtc-opportunity-finder.js', 'lihtc-opportunity-finder.html');
assertScriptBefore(pmaPage, 'js/map-panes.js', 'js/market-analysis.js', 'market-analysis.html');

const lof = read('js/lihtc-opportunity-finder.js');
const pma = read('js/market-analysis.js');

assert(lof.includes('MapPanes.ensureStack('), 'LOF initializes the shared pane stack');
assert(pma.includes('MapPanes.ensureStack('), 'PMA initializes the shared pane stack');
assert(lof.includes('fillsPane') && lof.includes('pointsPane'), 'LOF references both custom panes');
assert(pma.includes('fillsPane') && pma.includes('pointsPane'), 'PMA references both custom panes');

assert(countPane(lof, 'fillsPane') >= 4, 'LOF assigns polygon fills to fillsPane');
assert(countPane(lof, 'pointsPane') >= 2, 'LOF assigns circle markers to pointsPane');
assert(countPane(pma, 'fillsPane') >= 6, 'PMA assigns polygon/vector fills to fillsPane');
assert(countPane(pma, 'pointsPane') >= 6, 'PMA assigns circle markers to pointsPane');

console.log('map-pane-order: shared Leaflet pane stack is wired for LOF and PMA');
