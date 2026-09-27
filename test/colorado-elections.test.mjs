/** R5/R6-0: rendered claims agree with source data and fixture election states. */
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

async function page(t, { ballots = BALLOTS, candidates = CANDIDATES, watch = WATCH, geo = GEO,
  now = '2026-09-27T12:00:00Z', fail = '', malformed = '', base = 'https://pggllc.github.io/Housing-Analytics/' } = {}) {
  const dom = new JSDOM(HTML, { url: base + 'colorado-elections.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const RealDate = window.Date;
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new RealDate(now).getTime(); }
  };
  const ballotPaths = ['data/policy/ballot-2026/statewide.json', ...geo.counties.map((c) => `data/policy/ballot-2026/counties/${c.geoid}.json`)];
  const payloads = new Map(ballotPaths.map((name, i) => [name, ballots[i]]));
  payloads.set('data/hna/geo-config.json', geo);
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

// R6-0 scenarios use synthetic data only, with no live results or network calls.
function electionFixtures() {
  const source = { url: 'https://example.com/ballot', retrieved: '2026-09-27' };
  const coverage = (geoid, coverage_state) => ({
    geoid, name: 'Fixture jurisdiction', coverage_state, reviewed_source: source.url,
    checked: source.retrieved, entry_ids: [], limitations: []
  });
  const ballot = {
    id: 'fixture-measure', election: { date: '2026-11-03' },
    jurisdiction: { name: 'Fixture state', level: 'state', geoid: '08' },
    status: 'on_ballot', neutral_title: 'Fixture housing measure', detail: 'Original ballot description.',
    sources: { certification: source, ballot_notice: source, official_text: null, resolution: null },
    evidence: [{ section: 'Question', quote: 'Original ballot question.' }],
    verification: { level: 'primary', against: 'official ballot', checked: source.retrieved },
    limitations: [], result: null, archived: false
  };
  const identity = { candidate: 'Fixture candidate', party: 'Fixture label' };
  return {
    geo: { counties: [{ geoid: '08001', label: 'Fixture county' }] },
    ballots: [
      { schema: 'ballot/v1', coverage: [coverage('08', 'verified_measure_found')], entries: [ballot] },
      { schema: 'ballot/v1', coverage: [coverage('08001', 'official_ballot_reviewed_none_found'),
        coverage('0800100', 'not_researched')], entries: [] }
    ],
    candidates: {
      schema: 'candidate-platforms/v1',
      races: [{ office: 'Governor/Lieutenant Governor', election_date: ballot.election.date,
        certified_candidates: [identity], coverage_state: 'complete', archived: false,
        candidates_source: 'https://example.com/candidate-list', roster_checked: source.retrieved }],
      candidates: [{ ...identity, office: 'Governor/Lieutenant Governor',
        coverage_state: 'verified_platform_found', archived: false,
        neutral_summary: 'A stated housing position.', quote: 'Original campaign wording.',
        campaign_source: source, verification: ballot.verification, proposed_appointments: [] }]
    },
    watch: { schema: 'policy-watch/v1', entries: [] }
  };
}

function fixtureResult(outcome = 'passed', stage = 'unofficial') {
  const date = stage === 'certified' ? '2026-12-01' : '2026-11-04';
  return { outcome, stage, as_of: date, source: { url: 'https://example.com/results', retrieved: date } };
}

test('R6-0: each result line agrees with its outcome, stage, date and evidence URL', async (t) => {
  for (const outcome of ['passed', 'failed']) for (const stage of ['unofficial', 'certified']) {
    const fixtures = electionFixtures();
    const entry = fixtures.ballots[0].entries[0];
    entry.status = outcome;
    entry.result = fixtureResult(outcome, stage);
    const { doc } = await page(t, { ...fixtures, now: '2026-12-02T12:00:00Z' });
    const card = doc.querySelector('#election-result-records [data-ballot-id]');
    assert.ok(card, 'a terminal result must remain reachable');
    const lines = card.querySelectorAll('.election-result');
    assert.equal(lines.length, 1, 'replace the R5 line instead of adding a second result');
    const line = lines[0];
    assert.match(line.textContent, new RegExp(`^${outcome}\\b`, 'i'));
    assert.ok(line.textContent.includes(entry.result.as_of));
    assert.ok(line.textContent.includes(stage));
    assert.equal(line.querySelector('a').href, entry.result.source.url);
    assert.doesNotMatch(card.textContent, /Result:|Election result source|%|\\b(?:winner|loser|margin)\\b/i);
    if (stage === 'unofficial') assert.match(line.textContent, /unofficial, may change/);
    else assert.doesNotMatch(line.textContent, /unofficial|may change/);
  }
});

test('R6-0: litigation shows its limitation without an outcome, including in the archive', async (t) => {
  for (const archived of [false, true]) for (const result of [null, fixtureResult()]) {
    const fixtures = electionFixtures();
    const entry = fixtures.ballots[0].entries[0];
    Object.assign(entry, { status: 'litigated', result, archived,
      limitations: ['Court review is unresolved.', 'Additional research note.'] });
    const { doc } = await page(t, { ...fixtures, now: '2026-11-04T12:00:00Z' });
    const cards = doc.querySelectorAll(`[data-ballot-id="${entry.id}"]`);
    assert.equal(cards.length, 1);
    const card = cards[0];
    assert.ok(card.closest(archived ? '#past-election-records' : '#election-result-records'));
    assert.match(card.querySelector('.election-result').textContent, /^Result pending:/);
    assert.ok(card.querySelector('.election-result').textContent.includes(entry.limitations[0]));
    assert.doesNotMatch(card.textContent, /\\b(?:passed|failed|winner|loser)\\b/i);
    assert.equal(doc.querySelector('#on-ballot-records [data-ballot-id]'), null);
  }
});

test('R6-0: malformed result outcomes cannot produce a settled outcome or disappear', async (t) => {
  // Recount is not a valid stored outcome in the merged schema. Exercise it as
  // untrusted input without adding a new schema value or writing result data.
  for (const outcome of ['recount', 'unknown']) for (const status of ['on_ballot', 'passed']) {
    const fixtures = electionFixtures();
    const entry = fixtures.ballots[0].entries[0];
    Object.assign(entry, { status, result: fixtureResult(outcome) });
    const { doc } = await page(t, { ...fixtures, now: '2026-11-04T12:00:00Z' });
    const cards = doc.querySelectorAll(`[data-ballot-id="${entry.id}"]`);
    assert.equal(cards.length, 1);
    assert.ok(cards[0].closest('#election-result-records'));
    assert.match(cards[0].querySelector('.election-result').textContent, /Result pending: .+/);
    assert.doesNotMatch(cards[0].textContent, /\\b(?:passed|failed|undefined)\\b/i);
  }
});

test('R6-0: fixed Denver midnight switches the headings and preserves coverage counts', async (t) => {
  for (const [now, after] of [
    ['2026-11-03T06:59:59Z', false], ['2026-11-03T07:00:00Z', false],
    ['2026-11-04T06:59:59Z', false], ['2026-11-04T07:00:00Z', true],
    ['2026-11-05T12:00:00Z', true]
  ]) {
    const fixtures = electionFixtures();
    const { doc } = await page(t, { ...fixtures, now });
    const ballotHeading = doc.getElementById('ballot-heading').textContent;
    const candidateHeading = doc.getElementById('candidate-heading').textContent;
    const coverage = doc.getElementById('ballot-coverage-summary').textContent;
    assertCoverage(doc, fixtures.ballots);
    if (after) {
      const electionDate = fixtures.ballots[0].entries[0].election.date;
      const humanDate = new Date(electionDate + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric'
      });
      assert.ok(ballotHeading.includes(humanDate), 'the heading must name the fixture election date');
      assert.match(coverage, /checked before the election/);
      assert.match(candidateHeading, /housing positions before the election/i);
    } else {
      assert.match(ballotHeading, /on the ballot/i);
      assert.doesNotMatch(coverage + candidateHeading, /before the election/);
    }
  }
});

test('R6-0: candidate result fields never render before, after or in Past elections', async (t) => {
  for (const archived of [false, true]) for (const now of [
    '2026-11-03T12:00:00Z', '2026-11-04T12:00:00Z', '2026-12-18T07:00:00Z'
  ]) {
    const fixtures = electionFixtures();
    const race = fixtures.candidates.races[0];
    const candidate = fixtures.candidates.candidates[0];
    const forbidden = 'CANDIDATE_RESULT_FIXTURE winner elected 99.9%';
    for (const record of [race, candidate, race.certified_candidates[0]]) {
      record.result = { outcome: forbidden, source: { url: 'https://example.com/candidate-result' } };
      record.winner = forbidden;
    }
    candidate.archived = archived;
    const { doc } = await page(t, { ...fixtures, now });
    const cards = doc.querySelectorAll('[data-candidate]');
    assert.equal(cards.length, 1, 'the check must inspect a rendered candidate');
    assert.ok(cards[0].textContent.includes(candidate.neutral_summary));
    assert.doesNotMatch(doc.querySelector('main').textContent, /CANDIDATE_RESULT_FIXTURE|99\.9%/);
    assert.equal(doc.querySelector('a[href="https://example.com/candidate-result"]'), null);
    assert.equal(doc.querySelector('#candidate-records .election-result, #past-election-records .candidate-race .election-result'), null);
  }
});

test('R6-0: explicit archives retain pre-election text and one linked result only in Past elections', async (t) => {
  const fixtures = electionFixtures();
  const entry = fixtures.ballots[0].entries[0];
  entry.result = fixtureResult();
  const { doc: before } = await page(t, { ...fixtures, now: '2026-11-03T12:00:00Z' });
  const original = before.querySelector('#on-ballot-records [data-ballot-id]');
  assert.ok(original);
  entry.archived = true;
  const { doc: after } = await page(t, { ...fixtures, now: '2026-11-04T12:00:00Z' });
  const cards = after.querySelectorAll(`[data-ballot-id="${entry.id}"]`);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].closest('#past-election-records'));
  assert.equal(cards[0].textContent, original.textContent);
  assert.equal(cards[0].querySelector('.election-result a').href, entry.result.source.url);
  assert.equal(after.getElementById('past-elections').open, false);
});

test('R6-0: result dates and pending limitations escape as text; unsafe result URLs stay inert', async (t) => {
  const injection = '<img src=x onerror="window.r6Injected=true"> & <script>window.r6Injected=true</script>';
  for (const pending of [false, true]) {
    const fixtures = electionFixtures();
    const entry = fixtures.ballots[0].entries[0];
    entry.status = pending ? 'litigated' : 'passed';
    entry.result = fixtureResult();
    entry.result.as_of = injection;
    entry.result.source.url = 'javascript:alert(1)';
    entry.limitations = [injection];
    const { doc, window } = await page(t, { ...fixtures, now: '2026-11-04T12:00:00Z' });
    const line = doc.querySelector('.election-result');
    assert.ok(line.textContent.includes(injection));
    assert.equal(line.querySelector('img, script, a'), null);
    assert.equal(window.r6Injected, undefined);
  }
});

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
  assert.ok(requests.every((r) => new URL(r).origin === new URL(doc.URL).origin
    && new URL(r).pathname.startsWith('/Housing-Analytics/data/')));
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

test('terminal results remain visible before day 45, outside On the ballot, with their own source link', async (t) => {
  for (const status of ['passed', 'failed']) {
    const ballots = structuredClone(BALLOTS);
    const record = allEntries(ballots)[0];
    record.status = status;
    record.result = { outcome: status, stage: 'unofficial', as_of: '2026-11-04',
      source: { url: record.sources.ballot_notice.url + '#election-results', retrieved: '2026-11-04' } };
    for (const [now, archived] of [['2026-11-04T12:00:00Z', false], ['2026-12-18T07:00:00Z', true]]) {
      const { doc } = await page(t, { ballots, now });
      assert.equal(doc.querySelector(`#on-ballot-records [data-ballot-id="${record.id}"]`), null);
      const group = archived ? '#past-election-records' : '#election-result-records';
      const card = doc.querySelector(`${group} [data-ballot-id="${record.id}"]`);
      assert.ok(card, `${status} must remain reachable ${archived ? 'after' : 'before'} archival`);
      assert.ok(card.textContent.includes(status) && card.textContent.includes(record.result.stage));
      assert.ok(card.textContent.includes(record.result.as_of));
      assert.ok([...card.querySelectorAll('a')].some((a) => a.href === record.result.source.url));
      assert.equal(doc.querySelector('#election-results').hidden, archived);
    }
  }
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
  for (const [now, past] of [['2026-12-18T06:59:59Z', false], ['2026-12-18T07:00:00Z', true]]) {
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

test('a no-position record without a check date does not blank the candidates section', async (t) => {
  const candidates = structuredClone(CANDIDATES);
  const record = candidates.candidates.find((c) => c.coverage_state === 'official_material_reviewed_no_housing_position_found');
  assert.ok(record, 'fixture needs a no-position record');
  record.verification = null;
  const { doc } = await page(t, { candidates });
  const host = doc.getElementById('candidate-records');
  assert.doesNotMatch(host.textContent, /could not be loaded/);
  assert.equal(host.querySelectorAll('.candidate-race').length,
    candidates.races.filter((r) => r.certified_candidates.length).length);
  const card = [...host.querySelectorAll('[data-candidate]')].find((el) => el.dataset.candidate === record.candidate);
  assert.match(normalized(card.textContent), /No housing position found in published campaign material(?! \(checked)/);
});
