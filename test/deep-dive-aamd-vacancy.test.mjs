/**
 * Colorado Deep Dive: Metro Denver vacancy and concessions come from the
 * AAMD data file (data/market/aamd-denver-vacancy.json), the same file the
 * Insights Risk Indicators read.
 *
 * Until 2026-10 the page typed AAMD Q4 2025 figures (7.6% vacancy, $169
 * concession) in three places three quarters after AAMD had published newer
 * ones. This guard renders the page against the committed file and asserts
 * each figure equals the value recomputed here from the file, with its
 * quarter, and that no typed vacancy or concession figure comes back.
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
const VAC = json('data/market/aamd-denver-vacancy.json');
const M = VAC.metro;
const Q = VAC.meta.vintage.replace('-', ' ');

function render(override = {}) {
  const dom = new JSDOM(read('colorado-deep-dive.html'), {
    runScripts: 'dangerously', url: BASE + 'colorado-deep-dive.html', pretendToBeVisual: true,
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
      const anyDepth = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (t[k] = anyDepth())) });
      window.Chart = function () { return { destroy() {}, update() {} }; };
      window.Chart.defaults = anyDepth();
    },
  });
  return dom.window.document;
}
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };
const text = (doc, id) => doc.getElementById(id).textContent.trim();

test('vacancy and concession figures come from the AAMD file, with its quarter', async () => {
  const doc = render();
  await until(() => text(doc, 'cddAamdVacancy') !== '—');
  const vac = M.stabilized_vacancy_pct.toFixed(1) + '%';
  assert.equal(text(doc, 'cddAamdVacancy'), vac);
  assert.equal(text(doc, 'cddAamdVacancyStrip'), vac);
  assert.equal(text(doc, 'cddAamdConcession'), '$' + M.average_concession.toLocaleString('en-US'));
  assert.equal(text(doc, 'cddAamdConcessionPct'), M.concession_pct_of_gross_rent.toFixed(1) + '%');
  assert.match(text(doc, 'cddAamdVacancyCompare'), new RegExp(M.stabilized_vacancy_prior_quarter_pct.toFixed(1) + '% last quarter'));
  const tags = [...doc.querySelectorAll('[data-aamd-vintage]')];
  assert.ok(tags.length >= 3, 'every figure carries its quarter');
  for (const t of tags) assert.equal(t.textContent, '(' + Q + ')');
  for (const a of doc.querySelectorAll('[data-aamd-source]')) assert.equal(a.getAttribute('href'), VAC.meta.source_url);
  const nar = text(doc, 'cddAamdNarrative');
  assert.ok(nar.includes(vac + ' in ' + Q), 'narrative states the file vacancy and quarter');
  assert.ok(nar.includes('$' + M.average_concession), 'narrative states the file concession');
});

test('a missing value stays a dash, never 0', async () => {
  const doc = render({ 'data/market/aamd-denver-vacancy.json': { meta: VAC.meta, metro: { stabilized_vacancy_pct: null } } });
  await until(() => doc.querySelector('[data-aamd-vintage]').textContent !== '');
  assert.equal(text(doc, 'cddAamdVacancy'), '—');
  assert.equal(text(doc, 'cddAamdConcession'), '—');
});

test('no typed vacancy or concession figure is left in the KPI cells or the callout', () => {
  const html = read('colorado-deep-dive.html');
  for (const id of ['cddAamdVacancy', 'cddAamdVacancyStrip', 'cddAamdConcession']) {
    assert.match(html, new RegExp('id="' + id + '">—<'), id + ' starts empty');
  }
  assert.doesNotMatch(html, /Metro Denver reached 7\.6% vacancy/);
  assert.doesNotMatch(html, /Denver Vacancy Rate \(Q4 2025\)/);
});
