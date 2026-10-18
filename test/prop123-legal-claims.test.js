// test/prop123-legal-claims.test.js
//
// The HNA's Prop 123 section states the law: who must file, by when, what the
// goal is, and what fast-track review requires. Each claim on the page must
// agree with the rule the code computes, and the code with the statute
// (C.R.S. §§ 29-32-101 to -106 as amended by HB26-1313; legal check of
// 2026-10-18). So this pins agreement, not wording:
//
//   - the fast-track days the page states = PROP123_FAST_TRACK_DAYS, the
//     value calculateFastTrackTimeline returns;
//   - the deadline the page states = the deadline both the checklist module
//     and the tracker badge compute;
//   - the goal the charts plot = calculateGrowthTarget, simple and capped at
//     the 2024–2026 cycle;
//   - no population threshold in code or copy; a CDP project is covered by
//     its county;
//   - every HNA page that renders the filing card loads the module that
//     loads DOLA's list (hna-what-to-do.html once pruned it with Leaflet and
//     showed "Source unavailable" for every jurisdiction);
//   - HB22-1093, a bingo-and-raffles bill, is cited nowhere.
//
// Usage: node test/prop123-legal-claims.test.js

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ ' + msg); failures++; }
}

function load(rel) {
  const ctx = { console, URLSearchParams, location: { search: '' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(rel), ctx, { filename: rel });
  return ctx;
}

const U  = load('js/hna/hna-utils.js').HNAUtils;
const T  = load('js/prop123-historical-tracker.js').Prop123Tracker;
const CC = require(path.join(ROOT, 'js', 'compliance-checklist.js'));

const CANONICAL = 'housing-needs-assessment.html';
const VIEWS = JSON.parse(read('data/hna/hna-views.json')).views.map((v) => v.slug.endsWith('.html') ? v.slug : v.slug + '.html');
const PAGES = [CANONICAL].concat(VIEWS);

function section(html) {
  const m = html.match(/<section id="prop123-section"[\s\S]*?<\/section>/);
  return m ? m[0] : null;
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const withSection = PAGES.filter((p) => section(read(p)));
// Non-vacuity: the scan must find the section somewhere, or nothing below is checked.
ok(withSection.length >= 2, `the Prop 123 section is found on ${withSection.length} HNA pages (canonical + view)`);

console.log('\n[fast-track decision window]');
const days = U.PROP123_FAST_TRACK_DAYS;
ok(U.calculateFastTrackTimeline(20, 10, 'place').fastTrackDays === days,
  `calculateFastTrackTimeline returns PROP123_FAST_TRACK_DAYS (${days})`);
withSection.forEach((p) => {
  const t = text(section(read(p)));
  const decision = [...t.matchAll(/(?:within|decision within|decided within) (\d+) calendar days/g)].map((m) => Number(m[1]));
  ok(decision.length > 0, `${p}: states a fast-track decision window`);
  ok(decision.every((n) => n === days), `${p}: every stated decision window is ${days} days (${decision.join(', ')})`);
});

console.log('\n[fast-track: who qualifies]');
ok(U.calculateFastTrackTimeline(20, 10, 'place').eligible === true, 'half the homes affordable qualifies');
ok(U.calculateFastTrackTimeline(20, 9, 'place').eligible === false, 'under half does not');
ok(U.calculateFastTrackTimeline(20, 10, 'cdp').eligible === true, 'a CDP project is not excluded (its county reviews it)');
ok(U.checkFastTrackEligibility(1, 'place').threshold === null && U.checkFastTrackEligibility(1, 'place').eligible === true,
  'no population threshold: a town of 1 is covered');
ok(!/PROP123_(MUNICIPALITY|COUNTY)_THRESHOLD/.test(read('js/hna/hna-utils.js')), 'no population-threshold constants in hna-utils.js');
withSection.forEach((p) => {
  const t = text(section(read(p)));
  ok(!/[≥>]=?\s*[\d,]+\s*(population|\(municipalities\)|\(counties\))/i.test(t) && !/population threshold of/i.test(t),
    `${p}: copy states no population threshold`);
});

console.log('\n[commitment deadline]');
const probe = new Date(2026, 9, 18);
const cc = CC._nextDolaDeadline(probe);
const tr = T.getDolaFilingDeadlines(probe).nextDeadline;
ok(cc.getMonth() === U.PROP123_COMMITMENT_DEADLINE_MONTH && cc.getDate() === U.PROP123_COMMITMENT_DEADLINE_DAY,
  'checklist deadline = hna-utils PROP123_COMMITMENT_DEADLINE_*');
ok(Number(tr.slice(5, 7)) === cc.getMonth() + 1 && Number(tr.slice(8)) === cc.getDate(),
  `tracker badge deadline (${tr}) = checklist deadline`);
const deadlineWords = cc.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
withSection.forEach((p) => {
  const t = text(section(read(p)));
  const months = [...t.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b/g)]
    .map((m) => m[1] + ' ' + m[2]).filter((d) => d !== 'January 1' && d !== 'December 31');
  ok(months.includes(deadlineWords), `${p}: states the deadline the code computes (${deadlineWords})`);
  ok(months.every((d) => d === deadlineWords), `${p}: states no other filing deadline (${[...new Set(months)].join(', ')})`);
});

console.log('\n[2024–2026 unit goal]');
ok(U.calculateGrowthTarget(1000, 2) === 1060, 'goal is 3% of baseline per year, simple (1060, not compound 1061)');
ok(U.calculateGrowthTarget(1000, 5) === U.calculateGrowthTarget(1000, 3), 'no goal projected past the 2024–2026 cycle');
ok(T.calculateComplianceTrajectory(1000, [1000], 2028).targets.length === 4, 'tracker targets stop at 2026');
const rend = read('js/hna/hna-renderers.js');
ok(!/Math\.pow\(1\.03/.test(rend), 'renderers plot calculateGrowthTarget, not a compounding 1.03^n');

console.log('\n[DOLA list reaches every filing card]');
const relPages = PAGES.filter((p) => read(p).includes('id="prop123Relationship"'));
ok(relPages.length >= 2, `${relPages.length} pages render the Prop 123 filing card`);
ok(/window\.Prop123Jurisdictions\s*=/.test(read('js/prop123-map.js')), 'js/prop123-map.js defines window.Prop123Jurisdictions');
relPages.forEach((p) => {
  ok(/<script[^>]+src="js\/prop123-map\.js"/.test(read(p)), `${p}: loads js/prop123-map.js, so DOLA's list can load`);
});

console.log('\n[citation]');
const served = PAGES.concat(['js/hna/hna-utils.js', 'js/hna/hna-renderers.js', 'js/hna/hna-dev-context.js',
  'js/compliance-checklist.js', 'js/prop123-historical-tracker.js']);
served.forEach((p) => ok(!/22-1093/.test(read(p)), `${p}: does not cite HB22-1093 (a bingo-and-raffles bill)`));
withSection.forEach((p) => ok(section(read(p)).includes('29-32'), `${p}: cites C.R.S. 29-32`));

if (failures) {
  console.error(`\nprop123-legal-claims: FAIL (${failures})`);
  process.exit(1);
}
console.log('\nprop123-legal-claims: PASS');
