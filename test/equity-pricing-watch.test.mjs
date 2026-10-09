/**
 * The equity-pricing watch (scripts/audit/equity-pricing-watch.mjs): the
 * quarterly capture reminder and the CohnReznick cross-check. Pure functions
 * only — no clock, network or GitHub.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  candidateMonitorUrls, dueReminder, driftFinding, findMonitorUrl, markersFromIssues, parseMonitor, unreachableIssue, BENCHMARK,
} from '../scripts/audit/equity-pricing-watch.mjs';

// Built from a prefix so the source-URL sweep does not fetch guessed and
// fixture URLs as if they were citations.
const UPLOADS = 'https://www.taxcreditadvisor.com' + '/wp-content/uploads';

const BENCH = JSON.parse(fs.readFileSync(BENCHMARK, 'utf8'));

// The monitor as `pdftotext -layout` lays it out: the sentence wraps in the
// left column while the trend chart's axis labels sit to its right, on the
// same lines or on lines of their own.
const MONITOR_TEXT = [
  '  Housing credit pricing remains depressed as supply                       Surveyed Median Housing Tax Credit Pricing Trend',
  '',
  '• The median housing credit net equity price decreased to $0.823 across              $0.91',
  '                                                                                     $0.90',
  '  93 surveyed properties for the period June 2026 – July 2026. The June –           $0.89',
  '  July median is the lowest surveyed result in recent years and continues a          $0.88',
].join('\n');

test('reads the surveyed median, deal count and period, ignoring the chart axis', () => {
  assert.deepEqual(parseMonitor(MONITOR_TEXT), { median: 0.823, properties: 93, period: 'June 2026 – July 2026' });
});

test('an unreadable monitor is null, never a price', () => {
  assert.equal(parseMonitor(''), null);
  assert.equal(parseMonitor('The median housing credit net equity price is not reported this month.'), null);
});

test('finds the newest monitor PDF linked from the home page', () => {
  const html = '<a href="https://www.taxcreditadvisor.com/about/">About</a>' +
    '<a href="https://www.taxcreditadvisor.com/wp-content/uploads/2026/09/TCA-Housing-Tax-Credit-Monitor_October_2026.pdf">Monitor</a>';
  assert.equal(findMonitorUrl(html),
    `${UPLOADS}/2026/09/TCA-Housing-Tax-Credit-Monitor_October_2026.pdf`);
  assert.equal(findMonitorUrl('<a href="https://example.com/x.pdf">x</a>'), null);
});

test('guesses the monitor URLs around today, each edition in the previous month\'s upload folder', () => {
  const urls = candidateMonitorUrls('2026-10-09');
  assert.deepEqual(urls, [
    `${UPLOADS}/2026/10/TCA-Housing-Tax-Credit-Monitor_November_2026.pdf`,
    `${UPLOADS}/2026/09/TCA-Housing-Tax-Credit-Monitor_October_2026.pdf`,
    `${UPLOADS}/2026/08/TCA-Housing-Tax-Credit-Monitor_September_2026.pdf`,
  ]);
  assert.match(candidateMonitorUrls('2026-12-20')[0], /uploads\/2026\/12\/TCA-Housing-Tax-Credit-Monitor_January_2027\.pdf$/, 'wraps the year');
  assert.match(candidateMonitorUrls('2027-01-05')[2], /uploads\/2026\/11\/TCA-Housing-Tax-Credit-Monitor_December_2026\.pdf$/, 'wraps back');
});

test('an unreachable monitor opens one "not checked" issue a month, never a silent pass', () => {
  const issue = unreachableIssue('2026-11-10', ['https://www.taxcreditadvisor.com' + '/: HTTP 403']);
  assert.match(issue.title, /could not read the CohnReznick monitor \(2026-11\)/);
  assert.match(issue.body, /This is not a pass/);
  assert.match(issue.body, /HTTP 403/);
  assert.equal(unreachableIssue('2026-11-24', [], markersFromIssues([{ body: issue.body }])), null, 'once per month');
  assert.ok(unreachableIssue('2026-12-10', [], markersFromIssues([{ body: issue.body }])), 'next month is a new issue');
});

const bench = (nine, four, extra = {}) => ({
  meta: { vintage: '2026-Q2', as_of: '2026-06-30', next_expected_update: '2027-01-08', ...extra },
  pricing: { national_avg: { credit_9pct: nine, credit_4pct: four } },
});
const monitor = (median) => ({ median, properties: 93, period: 'June 2026 – July 2026' });

test('a monitor median within 2 cents of the national 9%–4% range is not drift', () => {
  assert.equal(driftFinding(bench(0.82, 0.83), monitor(0.823), 'u'), null, 'inside the range');
  assert.equal(driftFinding(bench(0.82, 0.83), monitor(0.80), 'u'), null, 'exactly 2 cents below');
  assert.equal(driftFinding(bench(0.82, 0.83), monitor(0.85), 'u'), null, 'exactly 2 cents above');
});

test('a monitor median beyond the tolerance opens one issue per monitor edition', () => {
  const finding = driftFinding(bench(0.86, 0.84), monitor(0.80), 'https://example.com/m.pdf');
  assert.ok(finding, '4 cents below the range is drift');
  assert.match(finding.title, /\$0\.80 vs benchmark \$0\.84–\$0\.86/);
  assert.match(finding.body, /https:\/\/example\.com\/m\.pdf/);
  const markers = markersFromIssues([{ body: finding.body }]);
  assert.equal(driftFinding(bench(0.86, 0.84), monitor(0.80), 'https://example.com/m.pdf', markers), null, 'already reported');
});

test('a benchmark without national prices is never compared against', () => {
  assert.equal(driftFinding(bench(null, null), monitor(0.70), 'u'), null);
});

test('the capture reminder opens a week before the next expected update, once per vintage', () => {
  assert.equal(dueReminder(bench(0.82, 0.83), '2026-12-31'), null, '8 days out');
  const due = dueReminder(bench(0.82, 0.83), '2027-01-01');
  assert.ok(due, '7 days out');
  assert.match(due.title, /after 2026-Q2/);
  assert.ok(dueReminder(bench(0.82, 0.83), '2027-03-01'), 'overdue stays due');
  assert.equal(dueReminder(bench(0.82, 0.83), '2027-03-01', markersFromIssues([{ body: due.body }])), null, 'already reminded');
  assert.ok(dueReminder(bench(0.82, 0.83, { next_expected_update: null }), '2026-10-09'), 'no date set is due now');
});

// The committed file has what the reminder and the cross-check read.
test('the committed benchmark carries what the watch needs', () => {
  const { meta, pricing } = BENCH;
  assert.ok(Array.isArray(meta.capture_pages) && meta.capture_pages.length >= 2, 'capture pages listed');
  for (const p of meta.capture_pages) assert.match(p.url, /^https:\/\/www\.novoco\.com\//);
  assert.match(meta.next_expected_update, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(meta.next_expected_update > meta.as_of, 'next update is after the snapshot');
  assert.ok(pricing.national_avg.credit_9pct > 0 && pricing.national_avg.credit_4pct > 0);
  const reminder = dueReminder(BENCH, meta.next_expected_update);
  for (const p of meta.capture_pages) assert.ok(reminder.body.includes(p.url), `reminder links ${p.title}`);
});
