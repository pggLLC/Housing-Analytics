/** R5: rendered claims agree with independent source files, not frozen wording. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, 'colorado-elections.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'js/colorado-elections.js'), 'utf8');
const GEO = read('data/hna/geo-config.json');
const BALLOT_PATHS = ['data/policy/ballot-2026/statewide.json', ...GEO.counties.map((c) => `data/policy/ballot-2026/counties/${c.geoid}.json`)];
const BALLOTS = BALLOT_PATHS.map(read);
const CANDIDATES = read('data/policy/candidate-platforms-2026.json');
const WATCH = read('data/policy/policy-watch.json');
const allEntries = (files) => files.flatMap((file) => file.entries);
const normalized = (text) => text.replace(/\s+/g, ' ').trim();

async function page(t, { ballots = BALLOTS, candidates = CANDIDATES, watch = WATCH,
  now = '2026-09-27T12:00:00Z', fail = '', malformed = '', base = 'https://pggllc.github.io/Housing-Analytics/' } = {}) {
  const dom = new JSDOM(HTML, { url: base + 'colorado-elections.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const RealDate = window.Date;
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new RealDate(now).getTime(); }
  };
  const payloads = new Map(BALLOT_PATHS.map((name, i) => [name, ballots[i]]));
  payloads.set('data/hna/geo-config.json', GEO);
  payloads.set('data/policy/candidate-platforms-2026.json', candidates);
  payloads.set('data/policy/policy-watch.json', watch);
  const requests = [];
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location).pathname;
    const name = pathname.slice(pathname.indexOf('data/'));
    requests.push(new URL(url, window.location).href);
    if (name === fail) return { ok: false, status: 503 };
    assert.ok(payloads.has(name), `unexpected request: ${name}`);
    return { ok: true, json: async () => name === malformed ? {} : structuredClone(payloads.get(name)) };
  };
  window.eval(fs.readFileSync(path.join(ROOT, 'js/path-resolver.js'), 'utf8'));
  const scripts = [...window.document.querySelectorAll('script[src]')].map((el) => el.getAttribute('src'));
  assert.ok(scripts.includes('js/colorado-elections.js'), 'page must actually load its renderer');
  window.eval(SCRIPT);
  for (let i = 0; i < 100 && window.document.getElementById('election-data').dataset.loadState !== 'ready'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(window.document.getElementById('election-data').dataset.loadState, 'ready');
  return { doc: window.document, window, requests };
}

function assertCoverage(doc, files) {
  // Recompute from disk data; never import the renderer's arithmetic.
  const local = files.slice(1).flatMap((file) => file.coverage);
  const expected = {
    checked: local.filter((row) => row.coverage_state !== 'not_researched').length,
    total: local.length,
    'not-researched': local.filter((row) => row.coverage_state === 'not_researched').length,
  };
  assert.ok(local.length > 0, 'coverage scan must inspect real rows');
  for (const [key, value] of Object.entries(expected)) {
    const node = doc.querySelector(`#ballot-coverage-summary [data-count="${key}"]`);
    assert.ok(node && !node.closest('[hidden]'), `${key} must be displayed`);
    assert.equal(Number(node.textContent), value, `${key} must agree with local coverage files`);
  }
}

function forbiddenTerms(doc) {
  const root = doc.querySelector('main').cloneNode(true);
  root.querySelectorAll('script, style, .election-quote').forEach((el) => el.remove());
  // These two source-note contexts are not political praise/advice: BEST is
  // the school-construction grant's name; the committee phrase quotes a ballot.
  root.querySelectorAll('#coverage-rows .research-notes').forEach((el) => {
    el.textContent = el.textContent.replace(/\bBEST grant\b/g, 'school-construction grant')
      .replace('independent citizen advisory committee recommendations', 'independent citizen advisory committee input');
  });
  // Only the two required non-endorsement statements and verbatim source quotes
  // are exempt. The rest of the explainer and every rendered record are scanned.
  const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; retain element boundaries as spaces.
  const parts = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent);
  const text = normalized(parts.join(' '))
    .replace('It does not endorse any candidate, political party, or ballot measure.', '')
    .replace('COHO does not endorse or rate candidates', '');
  assert.ok(text.length > 1000, 'neutrality scan must inspect rendered content');
  return text.match(/\b(?:endors(?:e|es|ed|ing|ement|ements)|recommend\w*|best|ratings?)\b|\b(?:pro|anti)[-‐‑–—]/gi) || [];
}

function candidateRace(doc, office, past = false) {
  return [...doc.querySelectorAll(`${past ? '#past-election-records' : '#candidate-records'} .candidate-race`)]
    .find((el) => el.dataset.race === office);
}

test('live ballot entries are eligible, grouped, and retain their questions, sources and check dates', async (t) => {
  const { doc, requests } = await page(t);
  const expected = allEntries(BALLOTS).filter((e) => ['certified', 'on_ballot'].includes(e.status) && !e.archived);
  const cards = [...doc.querySelectorAll('#on-ballot-records [data-ballot-id]')];
  assert.ok(expected.length > 0);
  assert.deepEqual(cards.map((c) => c.dataset.ballotId).sort(), expected.map((e) => e.id).sort());
  for (const entry of expected) {
    const card = cards.find((c) => c.dataset.ballotId === entry.id);
    assert.ok(card.textContent.includes(entry.neutral_title));
    assert.ok(card.textContent.includes(entry.jurisdiction.name));
    const group = { state: 'Statewide', county: 'County', municipal: 'Municipal' }[entry.jurisdiction.level];
    assert.equal(card.parentElement.querySelector('h3').textContent, group);
    for (const evidence of entry.evidence) assert.ok(card.querySelector('details').textContent.includes(evidence.quote));
    assert.ok(card.textContent.includes(entry.verification.checked));
    const source = entry.sources.certification || entry.sources.ballot_notice;
    assert.ok([...card.querySelectorAll('a')].some((a) => a.href === source.url));
  }
  assert.equal(requests.filter((r) => r.includes('/ballot-2026/counties/')).length, GEO.counties.length);
  assert.ok(requests.every((r) => r.startsWith('https://pggllc.github.io/Housing-Analytics/data/')));
});

test('every non-ballot status is excluded; certified and on_ballot work at every jurisdiction level', async (t) => {
  const ballots = structuredClone(BALLOTS);
  ballots.forEach((b) => { b.entries = []; });
  const template = allEntries(BALLOTS)[0];
  const statuses = read('schemas/ballot-2026.schema.json').properties.entries.items.properties.status.enum;
  for (const status of statuses) for (const level of ['state', 'county', 'municipal']) {
    ballots[0].entries.push({ ...structuredClone(template), id: `${status}-${level}`, status, jurisdiction: { ...template.jurisdiction, level } });
  }
  const { doc } = await page(t, { ballots });
  const ids = [...doc.querySelectorAll('#on-ballot-records [data-ballot-id]')].map((c) => c.dataset.ballotId).sort();
  assert.deepEqual(ids, ['certified', 'on_ballot'].flatMap((s) => ['state', 'county', 'municipal'].map((l) => `${s}-${l}`)).sort());
});

test('live coverage figures and every table row agree with files; county filter retains every state', async (t) => {
  const { doc, window } = await page(t);
  assertCoverage(doc, BALLOTS);
  const sourceRows = BALLOTS.flatMap((b) => b.coverage);
  const shown = [...doc.querySelectorAll('#coverage-rows tr')];
  assert.equal(shown.length, sourceRows.length);
  for (const row of sourceRows) {
    const rendered = shown.find((r) => r.dataset.geoid === row.geoid);
    assert.ok(rendered && !rendered.hidden);
    assert.equal(rendered.dataset.coverageState, row.coverage_state);
    assert.ok(rendered.textContent.includes(row.name));
    assert.ok(rendered.cells[2].textContent.length > 0);
  }
  const filter = doc.querySelector('#coverage-county');
  assert.equal(filter.options.length, GEO.counties.length + 2);
  for (const [i, county] of GEO.counties.entries()) {
    filter.value = county.geoid;
    filter.dispatchEvent(new window.Event('change'));
    assert.deepEqual(shown.filter((r) => !r.hidden).map((r) => r.dataset.geoid), BALLOTS[i + 1].coverage.map((r) => r.geoid));
  }
  filter.value = '';
  filter.dispatchEvent(new window.Event('change'));
  assert.equal(shown.filter((r) => !r.hidden).length, sourceRows.length);
  const link = doc.querySelector('#ballot-coverage-summary a');
  assert.ok(doc.querySelector(new URL(link.href).hash));
});

test('mostly unresearched data shows unknowns, never a claim that no measures exist', async (t) => {
  const ballots = structuredClone(BALLOTS);
  ballots.forEach((file) => {
    file.entries = [];
    file.coverage.forEach((row) => Object.assign(row, { coverage_state: 'not_researched', reviewed_source: null, checked: null, entry_ids: [], limitations: [] }));
  });
  const { doc } = await page(t, { ballots });
  assertCoverage(doc, ballots);
  assert.equal(doc.querySelectorAll('#coverage-rows [hidden]').length, 0);
  assert.equal(doc.querySelectorAll('#on-ballot-records [data-ballot-id]').length, 0);
  assert.ok(doc.querySelector('#on-ballot-records').textContent.includes('coverage'));
});

test('candidate roster order is independent of input record order and supplemental reporting', async (t) => {
  const candidates = structuredClone(CANDIDATES);
  candidates.candidates.reverse();
  const { doc } = await page(t, { candidates });
  for (const race of candidates.races) {
    const rendered = candidateRace(doc, race.office);
    assert.deepEqual([...rendered.querySelectorAll('[data-candidate]')].map((el) => el.dataset.candidate), race.certified_candidates.map((c) => c.candidate));
    assert.deepEqual([...rendered.querySelectorAll('[data-candidate]')].map((el) => el.querySelector(':scope > .election-check').textContent), race.certified_candidates.map((c) => `Ballot label: ${c.party}`));
  }
});

test('one unresearched or missing campaign suppresses all race summaries, quotes, appointments and reports', async (t) => {
  for (const missing of [false, true]) {
    const candidates = structuredClone(CANDIDATES);
    const race = candidates.races[0];
    const index = candidates.candidates.findIndex((c) => c.office === race.office);
    if (missing) candidates.candidates.splice(index, 1);
    else candidates.candidates[index].coverage_state = 'not_researched';
    // Race-level metadata deliberately remains complete: the gate must inspect records.
    const { doc } = await page(t, { candidates });
    const rendered = candidateRace(doc, race.office);
    assert.ok(rendered.querySelector('.race-incomplete'));
    assert.equal(rendered.querySelectorAll('.candidate-summary, .campaign-claim, .candidate-report, .election-quote').length, 0);
    for (const c of candidates.candidates.filter((c) => c.office === race.office && c.neutral_summary)) assert.ok(!rendered.textContent.includes(c.neutral_summary));
  }
});

test('live absence labels preserve the checked date; proposed appointments and reports retain their attribution', async (t) => {
  const { doc } = await page(t);
  for (const record of CANDIDATES.candidates) {
    const race = candidateRace(doc, record.office);
    const card = [...race.querySelectorAll('[data-candidate]')].find((c) => c.dataset.candidate === record.candidate);
    if (record.coverage_state === 'official_material_reviewed_no_housing_position_found') {
      // This label is explicitly required to agree with the absence state + check date.
      assert.ok(card.textContent.includes(`No housing position found in published campaign material (checked ${record.verification.checked})`));
    }
    if (record.verification?.level === 'reported') {
      const report = card.querySelector('.candidate-report');
      assert.ok(report && report.textContent.includes(record.verification.by));
      assert.ok(report.textContent.includes(record.neutral_summary));
      assert.equal(race.querySelector('.race-incomplete'), null, 'reported not_researched is supplemental and cannot block campaign coverage');
      assert.ok(report.querySelector('a').href === record.campaign_source.url);
    }
    for (const claim of record.proposed_appointments) {
      assert.ok([...card.querySelectorAll('.campaign-claim')].some((el) => el.textContent.includes('Campaign claim') && el.textContent.includes(claim.role)));
    }
  }
  assert.ok(candidateRace(doc, 'Secretary of State').querySelector('.race-incomplete'));
});

test('people section renders only official people entries and preserves role/source/check information', async (t) => {
  const { doc } = await page(t);
  const people = WATCH.entries.filter((e) => e.section === 'people');
  const cards = [...doc.querySelectorAll('#people-records [data-person-id]')];
  assert.ok(people.length > 0);
  assert.deepEqual(cards.map((c) => c.dataset.personId).sort(), people.map((p) => p.id).sort());
  for (const person of people) {
    const card = cards.find((c) => c.dataset.personId === person.id);
    for (const value of [person.title, person.role, person.agency, person.verification.checked]) assert.ok(card.textContent.includes(value));
    assert.equal(card.querySelector('a').href, person.source.url);
  }
});

test('archive boundary is day 45, and all past groups are collapsed initially', async (t) => {
  for (const [now, past] of [['2026-12-17T23:59:59Z', false], ['2026-12-18T00:00:00Z', true]]) {
    const { doc } = await page(t, { now });
    assert.equal(doc.querySelectorAll('#on-ballot-records [data-ballot-id]').length, past ? 0 : allEntries(BALLOTS).filter((e) => ['certified', 'on_ballot'].includes(e.status)).length);
    assert.equal(doc.querySelectorAll('#candidate-records .candidate-race').length, past ? 0 : CANDIDATES.races.length);
    if (past) {
      assert.equal(doc.querySelectorAll('#past-election-records [data-ballot-id]').length, allEntries(BALLOTS).length);
      assert.equal(doc.querySelectorAll('#past-election-records .candidate-race').length, CANDIDATES.races.length);
      assert.equal(doc.querySelector('#past-elections').hidden, false);
      assert.equal(doc.querySelector('#past-elections').open, false);
    }
    assert.equal(doc.querySelectorAll('#people-records [data-person-id]').length, WATCH.entries.filter((e) => e.section === 'people').length, 'role dates are not election dates');
  }
});

test('explicit archives move individual ballots, candidates, reported items and people out of current sections', async (t) => {
  const ballots = structuredClone(BALLOTS), candidates = structuredClone(CANDIDATES), watch = structuredClone(WATCH);
  const ballot = allEntries(ballots)[0]; ballot.archived = true;
  const campaign = candidates.candidates[0]; campaign.archived = true;
  const report = candidates.candidates.find((c) => c.verification?.level === 'reported'); report.archived = true;
  const person = watch.entries.find((e) => e.section === 'people'); person.archived = true;
  const { doc } = await page(t, { ballots, candidates, watch });
  for (const [selector, value] of [['data-ballot-id', ballot.id], ['data-candidate', campaign.candidate], ['data-person-id', person.id]]) {
    assert.ok(doc.querySelector(`#past-election-records [${selector}="${value}"]`));
    assert.equal(doc.querySelector(`#on-ballot-records [${selector}="${value}"], #candidate-records [${selector}="${value}"], #people-records [${selector}="${value}"]`), null);
  }
  assert.ok(doc.querySelector('#past-election-records .candidate-report').textContent.includes(report.verification.by));
  assert.equal(doc.querySelector('#candidate-records .candidate-report'), null);
});

test('forbidden-term scan checks rendered text with narrowly scoped source/disclaimer exceptions', async (t) => {
  const { doc } = await page(t);
  assert.deepEqual(forbiddenTerms(doc), []);
  const target = doc.querySelector('.candidate-summary');
  assert.ok(target);
  for (const term of ['endorse', 'recommend', 'best', 'pro-housing', 'anti-housing', 'rating']) {
    const original = target.textContent;
    target.textContent = term;
    assert.ok(forbiddenTerms(doc).length, `scan must catch ${term}`);
    target.textContent = original;
  }
});

test('escaping fixtures remain text on every surface and unsafe source URLs never become links', async (t) => {
  const injection = '<img src=x onerror="window.r5Injected=true"> & <script>window.r5Injected=true</script>';
  const ballots = structuredClone(BALLOTS), candidates = structuredClone(CANDIDATES), watch = structuredClone(WATCH);
  const ballot = allEntries(ballots)[0];
  ballot.neutral_title = injection; ballot.evidence[0].quote = injection;
  const sources = Object.values(ballot.sources).filter(Boolean); sources.forEach((s) => { s.url = 'javascript:alert(1)'; });
  ballots[0].coverage[0].name = injection;
  candidates.candidates[0].neutral_summary = injection;
  watch.entries.find((e) => e.section === 'people').title = injection;
  const { doc, window } = await page(t, { ballots, candidates, watch });
  for (const selector of ['#on-ballot-records', '#coverage-rows', '#candidate-records', '#people-records']) {
    assert.ok(doc.querySelector(selector).textContent.includes(injection));
    assert.equal(doc.querySelector(`${selector} img, ${selector} script`), null);
  }
  assert.equal(doc.querySelector('#election-data a[href^="javascript:"]'), null);
  assert.equal(window.r5Injected, undefined);
});

test('failed or malformed county data produces no partial coverage count; unrelated sections still work', async (t) => {
  for (const options of [{ fail: BALLOT_PATHS[1] }, { malformed: BALLOT_PATHS[1] }]) {
    const { doc } = await page(t, options);
    assert.equal(doc.querySelector('#ballot-coverage-summary [data-count]'), null);
    assert.equal(doc.querySelector('#coverage-county').disabled, true);
    assert.ok(doc.querySelector('#on-ballot-records').textContent.includes('could not be loaded'));
    assert.ok(doc.querySelector('#candidate-records [data-candidate]'));
    assert.ok(doc.querySelector('#people-records [data-person-id]'));
  }
});

test('candidate and people outages are disclosed without suppressing ballots', async (t) => {
  for (const [fail, selector] of [['data/policy/candidate-platforms-2026.json', '#candidate-records'], ['data/policy/policy-watch.json', '#people-records']]) {
    const { doc } = await page(t, { fail });
    assert.equal(doc.querySelector(selector).dataset.loadState, 'unavailable');
    assertCoverage(doc, BALLOTS);
  }
});

test('Housing News has one elections link in Policy watch which resolves to this existing page', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'policy-briefs.html'), 'utf8'), { url: 'https://pggllc.github.io/Housing-Analytics/policy-briefs.html' });
  try {
    const links = [...dom.window.document.querySelectorAll('#policyWatchPanel a')].filter((a) => new URL(a.href).pathname.endsWith('/colorado-elections.html'));
    assert.equal(links.length, 1);
    const destination = new URL(links[0].href);
    assert.equal(destination.pathname, '/Housing-Analytics/colorado-elections.html');
    assert.ok(fs.existsSync(path.join(ROOT, path.basename(destination.pathname))));
    assert.equal(dom.window.document.querySelector('script[src="js/colorado-elections.js"]'), null);
    assert.equal(dom.window.document.querySelector('#candidate-records, #on-ballot-records'), null);
  } finally { dom.window.close(); }
});

test('both R5 and deferred H1 tests are reachable from ci:part-7', () => {
  const scripts = read('package.json').scripts;
  const commands = scripts['ci:part-7'].split('&&').map((s) => s.trim());
  assert.ok(scripts['test:ci'].split('&&').map((s) => s.trim()).includes('npm run ci:part-7'));
  for (const [name, file] of [['colorado-elections', 'colorado-elections.test.mjs'], ['research-brief', 'research-brief.test.mjs']]) {
    assert.ok(commands.includes(`npm run test:${name}`));
    assert.equal(scripts[`test:${name}`], `node --test test/${file}`);
  }
});
