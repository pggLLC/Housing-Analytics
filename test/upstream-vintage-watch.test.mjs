import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { watchHudChas, buildWatchPayload } from '../scripts/audit/upstream-vintage-watch.mjs';

const current = fs.readFileSync(new URL('../scripts/fetch_chas.py', import.meta.url), 'utf8')
  .match(/^VINTAGE\s*=\s*['"]([\d-]+)['"]/m)[1];
const zip = () => new Response(new Uint8Array([80, 75, 3, 4]), {
  status: 200, headers: { 'content-type': 'application/zip' },
});
const statusResponse = status => () => new Response(null, { status });
function stub(responses) {
  const calls = [];
  return {
    calls,
    fetch: async url => {
      calls.push(url);
      assert.ok(responses.length, 'unexpected extra probe');
      return responses.shift()();
    },
  };
}
function assertUnverifiable(result) {
  assert.equal(result.status, 'unverifiable');
  assert.equal(result.latest_vintage, null);
  assert.equal(result.is_outdated, null);
  assert.equal(buildWatchPayload([result]).summary.errors, 1);
  assert.ok(result.notes.length > 0);
  assert.doesNotMatch(result.notes, /No newer/i, 'blocked probes cannot claim absence');
}

test('a 202 current-vintage control is unverifiable, never evidence of absence', async () => {
  // HUD returns the same challenge for published and nonexistent archives.
  const mock = { calls: [], fetch: async url => {
    mock.calls.push(url);
    return new Response(null, { status: 202 });
  } };
  assertUnverifiable(await watchHudChas(mock.fetch));
  assert.equal(mock.calls.length, 1, 'do not trust candidates when the known archive is blocked');
  assert.ok(mock.calls[0].endsWith(`/${current.replace('-', 'thru')}-140-csv.zip`));
});

test('only a verified current ZIP and candidate 404s establish no newer vintage', async () => {
  const mock = stub([zip, statusResponse(404), statusResponse(404), statusResponse(404)]);
  const result = await watchHudChas(mock.fetch);
  assert.equal(result.status, 'verified');
  assert.equal(result.is_outdated, false);
  assert.deepEqual(buildWatchPayload([result]).summary, { checked: 1, outdated: 0, errors: 0 });
  assert.equal(mock.calls.length, 4);
});

test('verified control and candidate ZIP identify a newer published vintage', async () => {
  const mock = stub([zip, zip]);
  const result = await watchHudChas(mock.fetch);
  assert.equal(result.status, 'verified');
  assert.equal(result.is_outdated, true);
  assert.equal(result.latest_vintage, current.split('-').map(y => +y + 1).join('-'));
  assert.deepEqual(buildWatchPayload([result]).summary, { checked: 1, outdated: 1, errors: 0 });
});

const ambiguous = [
  ['202', statusResponse(202)], ['403', statusResponse(403)], ['503', statusResponse(503)],
  ['HTML content type', () => new Response('PK fake archive', { headers: { 'content-type': 'text/html' } })],
  ['HTML body', () => new Response('<html>challenge</html>')],
  ['empty 200', statusResponse(200)],
  ['network failure', () => { throw new Error('network unavailable'); }],
];
for (const [name, response] of ambiguous) {
  for (const atControl of [true, false]) {
    test(`${name} at ${atControl ? 'control' : 'candidate'} is unverifiable`, async () => {
      const mock = stub(atControl ? [response] : [zip, response]);
      assertUnverifiable(await watchHudChas(mock.fetch));
      assert.equal(mock.calls.length, atControl ? 1 : 2);
    });
  }
}
test('even a 404 at the known published control is unverifiable', async () => {
  assertUnverifiable(await watchHudChas(stub([statusResponse(404)]).fetch));
});
test('the probe cancels after the signature instead of downloading the archive', async () => {
  let cancelled = 0;
  const streamingZip = () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([80])); controller.enqueue(new Uint8Array([75])); },
    cancel() { cancelled++; },
  }));
  const result = await watchHudChas(stub([streamingZip, streamingZip]).fetch);
  assert.equal(result.is_outdated, true);
  assert.equal(cancelled, 2);
});

// Execute the workflow's actual issue-management code with a fake GitHub client.
const workflow = fs.readFileSync(new URL('../.github/workflows/upstream-vintage-watch.yml', import.meta.url), 'utf8');
const issueScript = workflow.match(/          script: \|\n([\s\S]*?)\n      - name: Commit/)[1]
  .split('\n').map(line => line.replace(/^            /, '')).join('\n');
const runIssueStep = new (Object.getPrototypeOf(async function () {}).constructor)(
  'require', 'github', 'context', 'core', issueScript,
);
function issueHarness() {
  const issues = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, body: 'unrelated', state: 'open' }));
  const warnings = [], creates = [], updates = [], comments = [], labelsMade = [], labelled = [];
  const repoLabels = new Set(['bug']);
  const api = {
    listForRepo() { throw new Error('must paginate the tracker search'); },
    async create(args) {
      // GitHub rejects an issue whose labels do not exist; the step must not pass any.
      assert.equal(args.labels, undefined, 'labels are added after creation, never at creation');
      creates.push(args); issues.push({ ...args, state: 'open', number: 102 });
      return { data: { number: 102 } };
    },
    async update(args) { updates.push(args); Object.assign(issues.find(i => i.number === args.issue_number), args); },
    async createComment(args) { comments.push(args); },
    async createLabel({ name }) {
      if (repoLabels.has(name)) { const e = new Error('already_exists'); e.status = 422; throw e; }
      repoLabels.add(name); labelsMade.push(name);
    },
    async addLabels({ labels }) {
      for (const name of labels) assert(repoLabels.has(name), `label ${name} added before it exists`);
      labelled.push(...labels);
    },
  };
  return {
    issues, warnings, creates, updates, comments, labelsMade, labelled, repoLabels,
    async run(sources) {
      await runIssueStep(() => ({ readFileSync: () => JSON.stringify(buildWatchPayload(sources)) }), {
        rest: { issues: api },
        async paginate(method, args) {
          assert.equal(method, api.listForRepo);
          assert.equal(args.state, 'open');
          return issues.filter(i => i.state === 'open');
        },
      }, { repo: { owner: 'fixture', repo: 'fixture' } }, { warning: message => warnings.push(message) });
    },
  };
}
test('unverifiable CHAS warns and creates/updates one tracker, even beyond page one', async () => {
  const h = issueHarness();
  const result = await watchHudChas(stub([statusResponse(202)]).fetch);
  await h.run([result]);
  await h.run([result]);
  assert.equal(h.warnings.length, 2);
  assert.equal(h.creates.length, 1);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].issue_number, 102);
  assert.equal(h.issues[101].state, 'open');
  assert.match(h.issues[101].body, /https:\/\/www\.huduser\.gov\/portal\/datasets\/cp\.html/);
  assert.match(h.issues[101].body, /manual/i);
  // The tracker opens even though neither label existed, and gets both.
  assert.deepEqual(h.labelsMade, ['data-pipeline', 'upstream-vintage']);
  assert.deepEqual(h.labelled, ['data-pipeline', 'upstream-vintage']);
  // HUD blocks indefinitely: an unchanged weekly result must not comment.
  assert.equal(h.comments.length, 0, 'an unchanged status must not add a comment');
  const verified = await watchHudChas(stub([zip, statusResponse(404), statusResponse(404), statusResponse(404)]).fetch);
  await h.run([verified]);
  assert.equal(h.issues[101].state, 'closed');
});
test('CHAS remains dispatch-only and uses the fetcher; completion monitors still cover dispatches', () => {
  const read = file => fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const fetchWorkflow = read('fetch-chas-data.yml');
  assert.match(fetchWorkflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(fetchWorkflow, /^  schedule:/m);
  assert.match(fetchWorkflow, /run: python3 scripts\/fetch_chas.py/);
  assert.doesNotMatch(fetchWorkflow, /\b(?:curl|wget)\b/);
  assert.match(read('workflow-outcome-monitor.yml'), /Fetch HUD CHAS Affordability Data/);
  assert.match(read('workflow-outcome-monitor.yml'), /workflow_dispatch/);
});

test('the tracker comments only when its status rows change', async () => {
  const h = issueHarness();
  const blocked = await watchHudChas(stub([statusResponse(202)]).fetch);
  await h.run([blocked]);
  for (let week = 0; week < 3; week++) await h.run([blocked]);
  assert.equal(h.comments.length, 0, 'three identical weeks, no comments');
  assert.equal(h.updates.length, 3, 'the body is still refreshed each week');
  const forbidden = await watchHudChas(stub([statusResponse(403)]).fetch);
  await h.run([forbidden]);
  assert.equal(h.comments.length, 1, 'a changed status comments once');
  assert.match(h.comments[0].body, /changed/i);
  await h.run([forbidden]);
  assert.equal(h.comments.length, 1);
});

// ── CHFA tax credit rounds ─────────────────────────────────────────
// A round CHFA has published must be in the repo (feed or bridge file); a
// 404 is "not yet published"; anything else cannot establish absence.
import os from 'node:os';
import path from 'node:path';
import { watchChfaRounds, chfaRoundUrl, chfaBridgeRel } from '../scripts/audit/upstream-vintage-watch.mjs';

function chfaRoot({ feedYears = {}, bridges = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chfa-rounds-'));
  const features = [];
  for (const [year, credits] of Object.entries(feedYears)) {
    for (const CREDIT of credits) features.push({ properties: { AwardYear: Number(year), CREDIT } });
  }
  fs.mkdirSync(path.join(root, 'data', 'affordable-housing', 'chfa-awards'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'chfa-lihtc.json'), JSON.stringify({ features }));
  for (const [y, n] of bridges) fs.writeFileSync(path.join(root, chfaBridgeRel(y, n)), '{}');
  return root;
}
const page = (body) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const listed = page('<p>Crawford Commons, Clifton</p><p>Sponsor: Housing Resources</p>');
function byUrl(map) {
  const calls = [];
  return { calls, fetch: async (url) => { calls.push(url); assert.ok(map[url], `unexpected probe ${url}`); return map[url](); } };
}
const OCT_2026 = new Date('2026-10-10T00:00:00Z');
const ALL_2025_2026 = (r2026two) => ({
  [chfaRoundUrl(2025, 'one')]: listed, [chfaRoundUrl(2025, 'two')]: listed,
  [chfaRoundUrl(2026, 'one')]: listed, [chfaRoundUrl(2026, 'two')]: r2026two,
});

test('CHFA: a published round in neither the feed nor a bridge file is outdated', async () => {
  const root = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'] } });
  const result = await watchChfaRounds(byUrl(ALL_2025_2026(statusResponse(404))).fetch, OCT_2026, root);
  assert.equal(result.status, 'verified');
  assert.equal(result.is_outdated, true);
  assert.equal(result.latest_vintage, '2026 Round One');
  assert.match(result.notes, /2026 Round One/);
});

test('CHFA: feed or bridge coverage of every published round is current; 404 is not yet published', async () => {
  const root = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'] }, bridges: [[2026, 'one']] });
  const result = await watchChfaRounds(byUrl(ALL_2025_2026(statusResponse(404))).fetch, OCT_2026, root);
  assert.equal(result.status, 'verified');
  assert.equal(result.is_outdated, false);
  assert.equal(result.current_vintage, '2026 Round One (bridge)');
});

test('CHFA: a later round needs its own coverage; one round of the year does not cover the other', async () => {
  const root = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'] }, bridges: [[2026, 'one']] });
  const result = await watchChfaRounds(byUrl(ALL_2025_2026(listed)).fetch, OCT_2026, root);
  assert.equal(result.is_outdated, true);
  assert.equal(result.latest_vintage, '2026 Round Two');
});

test('CHFA: a blocked or empty page is unverifiable, never "every round is in the repo"', async () => {
  const root = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'] }, bridges: [[2026, 'one']] });
  for (const bad of [statusResponse(403), page('<html>challenge</html>')]) {
    const result = await watchChfaRounds(byUrl(ALL_2025_2026(bad)).fetch, OCT_2026, root);
    assert.equal(result.status, 'unverifiable');
    assert.equal(result.is_outdated, null);
    assert.equal(buildWatchPayload([result]).summary.errors, 1);
    assert.doesNotMatch(result.notes, /Every published/);
  }
});

test('CHFA: one same-year award between rounds does not cover a whole published round', async () => {
  // Round Two lists three developments; the feed has one 4% and State award from that year.
  const three = page('<p>Sponsor: A</p><p>Sponsor: B</p><p>Sponsor: C</p>');
  const root = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'], 2026: ['4% and State'] }, bridges: [[2026, 'one']] });
  const result = await watchChfaRounds(byUrl(ALL_2025_2026(three)).fetch, OCT_2026, root);
  assert.equal(result.is_outdated, true);
  assert.equal(result.latest_vintage, '2026 Round Two');
  const covered = chfaRoot({ feedYears: { 2025: ['9% and State', '4% and State'], 2026: ['4% and State', '4% and State', '4% and State'] }, bridges: [[2026, 'one']] });
  const ok = await watchChfaRounds(byUrl(ALL_2025_2026(three)).fetch, OCT_2026, covered);
  assert.equal(ok.is_outdated, false, 'as many feed awards as listed developments counts as covered');
});
