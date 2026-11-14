'use strict';
// The hub's Housing news (hub/policy.js, #/news) and the old news page (policy-briefs.html) put the same local
// line under each story that names a Colorado place: that place's rent-burdened renter share, median gross
// rent and units short at 30% AMI, graded by RecommendationContract.evidence(), with the ACS vintage.
// This runs both pages' own line builders on every place the news list names and requires the same words.
// The markup may differ (class names; the old page links housing-needs-assessment.html, the hub #/place/).
// Usage: node test/news-local-line-matches-old-page.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// The text of one top-level `function name(` or `var name =` statement, by brace matching.
function grab(src, head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error('not found: ' + head);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1) + (head.startsWith('var ') ? ';' : '');
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function builder(src, names) {
  const box = { window: {}, escapeHtml: esc, esc };
  vm.runInNewContext(read('js/workflow/recommendation-contract.js'), box);
  box.global = box.window;
  vm.runInNewContext(names.map(n => grab(src, n)).join('\n'), box);
  return box;
}
const oldPage = builder(read('policy-briefs.html'), ['var LEVEL =', 'function graded(', 'function localLine(']);
const hub = builder(read('hub/policy.js'), ['var NEWS_LEVEL =', 'function newsGraded(', 'function newsLocalLine(']);
// Compared with only the class names and link targets taken out, so words, tags and order must all agree.
const words = html => html.replace(/ (class|href)="[^"]*"/g, '');

const fails = []; let n = 0, lines = 0;
const check = (ok, msg) => { n++; if (!ok) fails.push(msg); };
check(typeof oldPage.window.RecommendationContract.evidence === 'function', 'RecommendationContract.evidence is missing');
const news = JSON.parse(read('data/policy_briefs.json'));
const seen = new Set();
news.stories.forEach(s => {
  const p = s.places && s.places[0];
  if (!p || !p.geoid || seen.has(p.geoid)) return;
  seen.add(p.geoid);
  const f = path.join(root, 'data/hna/jurisdiction-metrics-digest', p.geoid + '.json');
  const doc = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const a = oldPage.localLine(doc, p), b = hub.newsLocalLine(doc, p);
  if (/% of renter households|median gross rent|units short/.test(a)) lines++;
  check(words(a) === words(b), p.name + ' (' + p.geoid + '): old page "' + a + '" but hub "' + b + '"');
  check(b.indexOf('href="#/place/' + encodeURIComponent(p.geoid) + '"') > -1, p.name + ': the hub line does not link to its needs assessment');
});
// No digest: both fall back to the needs-assessment link alone.
const none = { geoid: '0899999', name: 'Nowhere', type: 'place' };
check(words(oldPage.localLine(null, none)) === words(hub.newsLocalLine(null, none)), 'a place with no digest reads differently on the two pages');
// A county figure standing in for a town is left out on both pages (the line is about this place or says nothing).
const town = { geoid: '0899998', name: 'Testville', type: 'place' };
const lent = { geography: { name: 'Testville (town)' }, metrics: {
  gross_rent_median: { value: 1500, geography_level: 'county', confidence: 'high', source_id: 'acs-profile', as_of: 'ACS 2020-2024 5-year' },
  housing_gap_units: { value: 40, geography_level: 'place', confidence: 'high', source_id: 'chas', as_of: 'CHAS 2018-2022' } } };
const lentOld = oldPage.localLine(lent, town), lentHub = hub.newsLocalLine(lent, town);
check(words(lentOld) === words(lentHub), 'a borrowed county figure reads differently: old "' + lentOld + '" hub "' + lentHub + '"');
check(!/\$1,500/.test(lentHub) && /40 units short/.test(lentHub), 'the hub line shows a county figure for a town, or drops the town\'s own figure: ' + lentHub);
check(seen.size > 20 && lines > 20, 'too few places with numbers to compare (' + seen.size + ' places, ' + lines + ' with figures)');
// The hub reads the same per-place digest the old page reads.
check(/data\/hna\/jurisdiction-metrics-digest\//.test(grab(read('hub/policy.js'), 'function newsDigest(')), 'the hub news view no longer reads the HNA digest');

if (fails.length) { console.error('news local line: FAIL\n  ' + fails.slice(0, 20).join('\n  ')); process.exit(1); }
console.log('news local line: PASS (' + n + ' checks, ' + seen.size + ' places, ' + lines + ' with figures)');
