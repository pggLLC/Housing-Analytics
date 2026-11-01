// Economic dashboard accuracy guards (2026-11-01).
// 1. Inflation is computed once, by the page's own date-matched year-ago
//    lookup. js/fred-cards.js counted 13 rows back, which lands on August
//    2025 because October 2025 CPI was never published, and could overwrite
//    the correct figure depending on load order.
// 2. The headline tiles read a daily saved copy of FRED, so they must not
//    call themselves "LIVE".
// 3. The Yardi Matrix panel showed COHO estimates as Yardi figures and had
//    not been updated since June 2026; it stays removed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'economic-dashboard.html'), 'utf8');

assert.ok(!html.includes('js/fred-cards.js'), 'economic dashboard must not load the duplicate CPI script');
assert.ok(!fs.existsSync(path.join(root, 'js/fred-cards.js')), 'js/fred-cards.js stays deleted');
assert.match(html, /function yearAgoIndex\(/, 'headline CPI uses the date-matched year-ago lookup');
assert.match(html, /els\.statCpi\.textContent = isFinite\(yoy\)/, 'headline CPI is written by the page script');

assert.doesNotMatch(html, />LIVE</, 'no tile calls a daily saved copy "LIVE"');
const strip = html.slice(html.indexOf('aria-label="Key economic indicators"'), html.indexOf('Indicator source:'));
const tags = strip.match(/<div class="kpi-source"><span>Daily copy<\/span>/g) || [];
assert.equal(tags.length, 8, 'each of the 8 headline tiles starts as "Daily copy"');
assert.match(html, /tag\.textContent = 'Latest ' \+ obs\[0\]\.date/, 'tiles replace the tag with the date of the latest figure');

assert.ok(!html.includes('yardi-matrix-national-multifamily.json'), 'Yardi estimates are not shown');
assert.ok(!/id="yardi/.test(html), 'Yardi panel stays removed');
assert.match(html, /href="colorado-deep-dive\.html"/, 'rent pointer links to the Colorado Deep Dive');

// The year-ago lookup must skip the missing October 2025 CPI month.
const fred = JSON.parse(fs.readFileSync(path.join(root, 'data/fred-data.json'), 'utf8'));
const cpi = fred.series.CPIAUCSL.observations.filter(o => o.value !== '.' && o.value != null);
const last = cpi[cpi.length - 1];
const target = new Date(last.date); target.setUTCFullYear(target.getUTCFullYear() - 1);
const yearAgo = cpi.filter(o => new Date(o.date) <= target).pop();
assert.equal(yearAgo.date.slice(5, 7), last.date.slice(5, 7), 'year-ago CPI is the same calendar month');

console.log('Economic dashboard accuracy guards passed.');
