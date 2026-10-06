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
  const warnings = [], creates = [], updates = [];
  const api = {
    listForRepo() { throw new Error('must paginate the tracker search'); },
    async create(args) { creates.push(args); issues.push({ ...args, state: 'open', number: 102 }); },
    async update(args) { updates.push(args); Object.assign(issues.find(i => i.number === args.issue_number), args); },
    async createComment() {},
  };
  return {
    issues, warnings, creates, updates,
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
