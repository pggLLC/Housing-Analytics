/**
 * Insights Risk Indicators and Rates & Deadlines: every figure from a file.
 *
 * Until 2026-10 the Risk Indicators card typed Denver vacancy as "7.6% · AAMD
 * Q4 2025" and foreclosure as "LOW · ~56% of pre-pandemic", and showed an
 * unweighted mean of 2025 annual county unemployment rates while
 * data/fred-data.json, refreshed daily, held Colorado's statewide monthly rate.
 * Rates and CHFA deadlines, which the repo also refreshes, were not shown.
 *
 * This guard renders insights.html against the committed data and asserts what
 * it shows equals values recomputed here from the files, not taken from the
 * renderer:
 *   - unemployment is FRED COUR's latest observation, with its month;
 *   - vacancy is the AAMD file's metro stabilized rate, with its quarter;
 *   - foreclosure is the FHFA file's latest foreclosure-process share;
 *   - each rate is its FRED series' latest value, date and 1-year change;
 *   - the deadlines are the calendar's next deadline-type events by date.
 * It also checks that a missing value renders as unavailable, never as 0%,
 * that a past date the file still marks "upcoming" is not listed, and that no
 * typed percentage comes back in the card's markup.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const BASE = 'https://pggllc.github.io/Housing-Analytics/';
const FRED = json('data/fred-data.json').series;
const VAC = json('data/market/aamd-denver-vacancy.json');
const FC = json('data/market/colorado-foreclosure-performance.json');
const CAL = json('data/chfa-qap-calendar.json');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lastObs(id) {
  const obs = FRED[id].observations.filter((o) => o.value !== '.' && o.value !== '' && o.value != null);
  return obs[obs.length - 1];
}

function render({ override = {} } = {}) {
  const dom = new JSDOM(read('insights.html'), {
    runScripts: 'dangerously', url: BASE + 'insights.html', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        const p = new URL(String(url), BASE).pathname;
        const rel = p.slice(p.indexOf('data/'));
        if (rel in override) return Promise.resolve({ ok: true, json: () => Promise.resolve(override[rel]) });
        if (rel.startsWith('data/') && fs.existsSync(path.join(ROOT, rel))) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(json(rel)) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      };
      window.console.warn = () => {};
      window.console.error = () => {};
      window.Chart = function () {};
      window.eval(read('js/components/equity-pricing.js'));
      window.eval(read('js/components/market-pulse.js'));
    },
  });
  return dom.window.document;
}
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };
const text = (doc, id) => doc.getElementById(id).textContent.trim();
const ready = (doc) => until(() => doc.querySelector('#insightsRatesRows [data-rate]'));

test('Risk Indicators come from FRED, the AAMD file and the FHFA file', async () => {
  const doc = render();
  await ready(doc);

  const cour = lastObs('COUR');
  assert.equal(text(doc, 'insightsRiskUnemp'), Number(cour.value).toFixed(1) + '%');
  const [y, m] = cour.date.split('-').map(Number);
  assert.match(text(doc, 'insightsRiskUnempBasis'), new RegExp('^' + MONTHS[m - 1] + ' ' + y + ', Colorado statewide'));

  assert.equal(text(doc, 'insightsRiskVacancy'), VAC.metro.stabilized_vacancy_pct.toFixed(1) + '%');
  assert.match(text(doc, 'insightsRiskVacancyBasis'), new RegExp('^' + VAC.meta.vintage.replace('-', ' ')));
  assert.equal(doc.getElementById('insightsRiskVacancySource').getAttribute('href'), VAC.meta.source_url);

  assert.equal(text(doc, 'insightsRiskForeclosure'), FC.summary.latest_foreclosure_process_pct.toFixed(1) + '%');
  assert.match(text(doc, 'insightsRiskForeclosureBasis'), new RegExp(FC.summary.latest_period.replace(/Q/, ' Q')));
});

test('rates are each series latest value, its date and the 1-year change', async () => {
  const doc = render();
  await ready(doc);
  const rows = [...doc.querySelectorAll('#insightsRatesRows [data-rate]')];
  assert.deepEqual(rows.map((r) => r.dataset.rate), ['DGS10', 'SOFR', 'MORTGAGE30US']);
  for (const row of rows) {
    const id = row.dataset.rate;
    const now = lastObs(id);
    const cutoff = Date.parse(now.date + 'T00:00:00Z') - 365 * 86400000;
    const then = FRED[id].observations.filter((o) => Date.parse(o.date + 'T00:00:00Z') <= cutoff && o.value !== '.').pop();
    const cells = [...row.cells].map((c) => c.textContent.trim());
    assert.equal(cells[1], Number(now.value).toFixed(2) + '%', `${id} value`);
    const bp = Math.round((Number(now.value) - Number(then.value)) * 100);
    assert.equal(cells[2], (bp > 0 ? '+' : bp < 0 ? '−' : '') + Math.abs(bp) + ' bp', `${id} 1-yr change`);
    const [y, m, d] = now.date.split('-').map(Number);
    assert.equal(cells[3], `${MONTHS[m - 1]} ${d}, ${y}`, `${id} date`);
  }
});

test('deadlines are the next deadline-type events on or after today, by date', async () => {
  const doc = render();
  await ready(doc);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const expected = CAL.events
    .filter((e) => /deadline|loi|comment/.test(e.category || '') && Date.parse(e.date + 'T00:00:00Z') >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)
    .map((e) => e.id);
  assert.ok(expected.length > 0, 'the calendar has an upcoming deadline to check');
  assert.deepEqual([...doc.querySelectorAll('#insightsDeadlines [data-deadline]')].map((li) => li.dataset.deadline), expected);
});

test('a past date still marked upcoming is not listed', async () => {
  const stale = { ...CAL, events: [{ id: 'stale', name: 'Old', date: '2020-01-01', category: '9pct-r1-deadline', status: 'upcoming' }, ...CAL.events] };
  const doc = render({ override: { 'data/chfa-qap-calendar.json': stale } });
  await ready(doc);
  assert.equal(doc.querySelector('[data-deadline="stale"]'), null);
});

test('a missing value renders as unavailable, never 0%', async () => {
  const noMetro = { meta: VAC.meta };
  const noSeries = { series: { ...FRED, COUR: { observations: [{ date: '2026-08-01', value: '.' }] } } };
  const doc = render({ override: { 'data/market/aamd-denver-vacancy.json': noMetro, 'data/fred-data.json': noSeries } });
  await ready(doc);
  assert.equal(text(doc, 'insightsRiskVacancy'), 'Value unavailable');
  assert.equal(text(doc, 'insightsRiskUnemp'), 'Value unavailable');
});

test('the card markup types no percentages and the pricing labels are not estimates', () => {
  const html = read('insights.html');
  const card = html.slice(html.indexOf('<h3 class="chart-title">Risk Indicators</h3>'), html.indexOf('id="insightsRatesCard"'));
  assert.ok(card.length > 500, 'found the Risk Indicators card');
  assert.doesNotMatch(card, /<strong[^>]*>\s*[\d.]+%/, 'no typed percentage');
  assert.doesNotMatch(card, /\b(LOW|HIGH)<\/strong>/, 'no typed directional call');
  assert.doesNotMatch(html, /COHO estimate from public Novogradac/, 'pricing is Novogradac data, not a COHO estimate');
});
