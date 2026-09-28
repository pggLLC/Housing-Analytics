import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { END_DATE, R2_BATCHES, denverDate, due, markersFromIssues, loadSchedule,
  openReminders, readRepoState } from '../scripts/coho/open-reminders.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, '.github/coho-reminders');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const schedule = loadSchedule();
const bodies = Object.fromEntries(schedule.map(({ body }) => [body, readFileSync(resolve(DIR, body), 'utf8')]));
const one = (id) => schedule.filter((row) => row.id === id);
const marker = (id) => `<!-- coho-reminder:${id} -->`;
const county = (geoid) => `data/policy/ballot-2026/counties/${geoid}.json`;
function state() {
  return {
    ballots: Object.fromEntries(R2_BATCHES.flat().map((geoid) => [county(geoid), { coverage: [], entries: [] }])),
    candidates: { candidates: [], races: [] }, bodies,
  };
}
function addRow(data, geoid, name, coverage_state = 'official_notice_unavailable') {
  data.ballots[county(geoid)].coverage.push({ name, coverage_state });
}

test('six unique reminders have real, ordered dates and marked bodies outside docs', () => {
  assert.equal(schedule.length, 6);
  assert.equal(new Set(schedule.map((row) => row.id)).size, schedule.length);
  assert.deepEqual(schedule.map((row) => row.open_on), schedule.map((row) => row.open_on).sort());
  for (const row of schedule) {
    assert.match(row.open_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(row.open_on).toISOString().slice(0, 10), row.open_on);
    assert.match(row.body, /^[a-z0-9-]+\.md$/);
    const firstLine = bodies[row.body].split('\n')[0];
    assert.equal(firstLine, marker(row.id + (row.condition === 'r2_notice_unavailable' ? ':<batch>' : '')));
    assert.match(bodies[row.body].split('\n')[1], /^Owner decision: 2026-09-27/);
    assert.ok(bodies[row.body].includes('## Ground rules'));
  }
});

test('archive deadlines agree with the Python currency test and validator boundary', () => {
  // Read its actual parametrization/date and run the validator's current() function.
  // No copied 45-day constant or expected December date in this guard.
  const expected = execFileSync('python3', ['-c', `
import ast, json
from datetime import date, timedelta
from pathlib import Path
tree = ast.parse(Path('tests/test_policy_foundation.py').read_text())
test = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'test_policy_election_currency')
params = next(ast.literal_eval(d.args[1]) for d in test.decorator_list if ast.literal_eval(d.args[0]) == 'days,archived,passes')
days = min(d for d, archived, passes in params if not archived and not passes)
call = next(n for n in ast.walk(test) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'date')
election = date(*(ast.literal_eval(a) for a in call.args))
validator = ast.parse(Path('tests/policy_schema.py').read_text())
current = next(n for n in validator.body if isinstance(n, ast.FunctionDef) and n.name == 'current')
namespace = {'date': date}
exec(compile(ast.Module(body=[current], type_ignores=[]), '<currency>', 'exec'), namespace)
for offset, archived, passes in params:
    try:
        namespace['current']({'archived': archived}, election.isoformat(), election + timedelta(days=offset))
        actual = True
    except AssertionError:
        actual = False
    assert actual == passes, (offset, archived, passes, actual)
print(json.dumps({'deadline': (election + timedelta(days=days)).isoformat(), 'election': election.isoformat()}))
`], { cwd: ROOT, encoding: 'utf8' });
  const { deadline, election } = JSON.parse(expected);
  for (const id of ['r6b-certified', 'currency-warning']) {
    const body = bodies[one(id)[0].body];
    assert.equal(body.match(/Archive deadline:\s*\*\*(\d{4}-\d{2}-\d{2})\*\*/)?.[1], deadline);
    assert.ok(body.includes(election));
    // Check the legacy task's stated deadline as well as the leading correction.
    const legacy = body.match(/before ([A-Z][a-z]+ \d{1,2}, \d{4}), when the/);
    assert.ok(legacy);
    assert.equal(new Date(legacy[1] + ' UTC').toISOString().slice(0, 10), deadline);
  }
  assert.ok(one('r6b-certified')[0].title.includes(deadline));
  const warningDate = one('currency-warning')[0].open_on;
  const leadDays = Number(one('currency-warning')[0].title.match(/(\d+) days/)[1]);
  assert.equal((Date.parse(deadline) - Date.parse(warningDate)) / 86400000, leadDays);
});

test('R6-A correction precedes legacy task and agrees with merged schema', () => {
  const body = bodies['r6a-unofficial.md'];
  const correction = body.split('## R6-A')[0];
  const props = JSON.parse(read('schemas/ballot-2026.schema.json')).properties.entries.items.properties;
  const result = props.result.anyOf.find((variant) => variant.type === 'object').properties;
  const allowed = correction.match(/`([a-z]+(?:\|[a-z]+)+)`/);
  assert.ok(allowed, 'correction must name allowed outcomes');
  assert.deepEqual(allowed[1].split('|').sort(), [...result.outcome.enum].sort());
  const excluded = correction.match(/no `([a-z]+)` outcome/);
  assert.ok(excluded, 'correction must exclude the legacy recount outcome');
  assert.ok(!result.outcome.enum.includes(excluded[1]));
  const contested = correction.match(/status:\s*"([a-z]+)"/);
  assert.ok(contested);
  assert.ok(props.status.enum.includes(contested[1]));
  assert.equal(contested[1], 'litigated'); // Contested measures have this schema meaning.
  assert.match(correction, /do not add a result/);
  assert.ok(correction.includes('result.source.url'));
  assert.ok(result.source.properties.url);
  assert.ok(body.indexOf('Schema correction') >= 0);
  assert.ok(body.indexOf('Schema correction') < body.indexOf('Repo pggLLC/'));
});

test('batch definitions cover main county files once and match the owner template', () => {
  const counties = readdirSync(resolve(ROOT, 'data/policy/ballot-2026/counties')).filter((x) => /^\d{5}\.json$/.test(x));
  assert.equal(counties.length, 64);
  assert.equal(new Set(R2_BATCHES.flat()).size, counties.length);
  assert.deepEqual(R2_BATCHES.flat().sort(), counties.map((x) => x.slice(0, 5)).sort());
  R2_BATCHES.forEach((geoids, i) => {
    assert.equal(geoids.length, 8);
    assert.ok(bodies['r2-second-pass.md'].includes(`R2-B${i + 1}: ${geoids.join(' ')}`));
  });
});

test('nothing before the date; opens on it and catches up after it', () => {
  const data = state();
  addRow(data, '08001', 'Awaiting sample ballot');
  assert.equal(due(schedule, '2026-09-30', [], data).length, 0);
  assert.deepEqual(due(schedule, '2026-10-01', [], data).map((x) => x.marker), [marker('adams-sample-ballot')]);
  assert.equal(due(one('adams-sample-ballot'), '2026-10-02', [], data).length, 1);
  data.ballots[county('08001')].coverage = [];
  assert.equal(due(one('adams-sample-ballot'), '2026-10-01', [], data).length, 0);
});

test('Denver day boundaries in daylight and standard time', () => {
  const data = state(); addRow(data, '08001', 'Adams row');
  assert.equal(denverDate(new Date('2026-10-01T05:59:59Z')), '2026-09-30');
  assert.equal(denverDate(new Date('2026-10-01T06:00:00Z')), '2026-10-01');
  assert.equal(due(schedule, denverDate(new Date('2026-10-01T00:30:00Z')), [], data).length, 0);
  assert.equal(denverDate(new Date('2026-12-01T06:59:59Z')), '2026-11-30');
  assert.equal(denverDate(new Date('2026-12-01T07:00:00Z')), '2026-12-01');
});

test('markers on closed issues prevent duplicates, including repeat same-day runs', () => {
  const data = state(); addRow(data, '08001', 'Adams row');
  const pending = due(schedule, '2026-10-01', [], data);
  const closed = pending.map((issue) => ({ body: issue.body, state: 'closed' }));
  assert.equal(due(schedule, '2026-10-01', markersFromIssues(closed), data).length, 0);
});

test('R2 opens only qualifying batches with exact county files, row names, and count', () => {
  const data = state();
  addRow(data, '08001', 'First town'); addRow(data, '08014', 'Broomfield');
  addRow(data, '08001', 'Reviewed town', 'official_ballot_reviewed_none_found');
  addRow(data, '08125', 'Last town');
  assert.equal(due(one('r2-second-pass'), '2026-10-05', [], data).length, 0);
  const pending = due(one('r2-second-pass'), '2026-10-06', [], data);
  assert.equal(pending.length, 2);
  assert.ok(pending[0].title.startsWith('COHO [R2-B1-P2]'));
  assert.ok(pending[1].title.startsWith('COHO [R2-B8-P2]'));
  assert.ok(pending[0].body.includes('There are 2 rows'));
  assert.ok(pending[0].body.includes(`- \`${county('08001')}\` — First town`));
  assert.ok(pending[0].body.includes(`- \`${county('08014')}\` — Broomfield`));
  assert.ok(!pending[0].body.includes('Reviewed town'));
  assert.ok(!pending[0].body.includes('Last town'));
  assert.ok(pending[0].body.includes('Batch: counties ' + R2_BATCHES[0].join(' ')));
  assert.ok(pending[0].body.includes('SECOND PASS: re-check ONLY rows'));
  assert.ok(pending[0].body.includes('bash /tmp/coho-gate.sh R2-B1-P2'));
  assert.ok(!/<batch>|<BLOCK>|<GEOIDS>|<COUNT>|<ROWS>/.test(pending[0].body));
  assert.equal(due(one('r2-second-pass'), '2026-10-06', [pending[0].marker], data).length, 1);
});

test('currency condition considers every ballot and candidate, not coverage/race records', () => {
  const data = state();
  data.ballots['data/policy/ballot-2026/statewide.json'] = { coverage: [], entries: [{ archived: true }] };
  data.candidates.candidates = [{ archived: true }];
  data.candidates.races = [{ office: 'Governor/Lieutenant Governor' }];
  const check = () => due(one('currency-warning'), '2026-12-11', [], data).length;
  assert.equal(check(), 0);
  data.candidates.candidates[0].archived = false;
  assert.equal(check(), 1);
  data.candidates.candidates[0].archived = true;
  data.ballots['data/policy/ballot-2026/statewide.json'].entries[0].archived = false;
  assert.equal(check(), 1);
  data.ballots['data/policy/ballot-2026/statewide.json'].entries = [];
  data.ballots[county('08125')].entries.push({ archived: false });
  assert.equal(check(), 1);
});

test('unconditional reminders and expiry boundary', () => {
  const data = state();
  assert.equal(due(one('r6a-unofficial'), '2026-11-03', [], data).length, 0);
  assert.equal(due(one('r6a-unofficial'), '2026-11-04', [], data).length, 1);
  assert.equal(due(one('r6b-certified'), '2026-11-24', [], data).length, 1);
  assert.equal(due(one('governor-appointments'), '2026-12-01', [], data).length, 1);
  assert.equal(due(one('governor-appointments'), END_DATE, [], data).length, 1);
  assert.equal(due(schedule, '2027-02-01', [], data).length, 0);
});

test('API shell paginates closed issues and dry run makes no writes', async () => {
  const data = state(); addRow(data, '08001', 'Adams row');
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('page=1')) return Array.from({ length: 100 }, () => ({ body: '', state: 'closed' }));
    if (path.endsWith('page=2')) return [{ body: marker('adams-sample-ballot'), state: 'closed' }];
    throw new Error('unexpected request');
  };
  const pending = await openReminders({ schedule, todayDenver: '2026-10-01', repoState: data,
    dryRun: true, api, log: () => {} });
  assert.equal(pending.length, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ path, options }) => path.includes('state=all&labels=coho-reminder') && !options));
  const logs = [];
  const preview = await openReminders({ schedule, todayDenver: '2026-10-01', repoState: data,
    dryRun: true, api: async (path, options) => { assert.ok(!options); return []; }, log: (line) => logs.push(line) });
  assert.equal(preview.length, 1);
  assert.ok(logs[1].includes(preview[0].body));
});

test('real API shell creates missing label and assigned issues; a repeat is idempotent', async () => {
  const data = state(); addRow(data, '08001', 'Adams row');
  const issues = []; const writes = []; let label = false;
  const api = async (path, options) => {
    if (options?.method === 'POST') {
      writes.push({ path, body: options.body });
      if (path.endsWith('/labels')) { label = true; return {}; }
      issues.push({ ...options.body, state: 'closed' });
      return { html_url: 'created-issue' };
    }
    if (path.includes('/issues?')) return issues;
    if (!label) { const err = new Error('Not found'); err.status = 404; throw err; }
    return {};
  };
  const args = { schedule, todayDenver: '2026-10-01', repoState: data, dryRun: false, api, log: () => {} };
  assert.equal((await openReminders(args)).length, 1);
  assert.equal((await openReminders(args)).length, 0);
  assert.equal(writes.length, 2);
  assert.deepEqual(issues[0].assignees, ['paulglasow']);
  assert.deepEqual(issues[0].labels, ['coho-reminder']);
});

test('expired shell avoids the API and logs its no-op; list failures fail closed', async () => {
  const logs = [];
  const args = { schedule, todayDenver: '2027-02-01', repoState: state(), dryRun: false,
    api: async () => { throw new Error('API unavailable'); }, log: (s) => logs.push(s) };
  assert.deepEqual(await openReminders(args), []);
  assert.match(logs[0], /expired after 2027-01-31/);
  await assert.rejects(openReminders({ ...args, todayDenver: '2026-10-01' }), /API unavailable/);
});

test('state reader uses committed blobs despite local edits and untracked duplicates', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'coho-reminders-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '-q');
    mkdirSync(resolve(root, 'data/policy/ballot-2026'), { recursive: true });
    const file = resolve(root, 'data/policy/ballot-2026/statewide.json');
    writeFileSync(file, JSON.stringify({ coverage: [], entries: [{ archived: false }] }));
    writeFileSync(resolve(root, 'data/policy/candidate-platforms-2026.json'), '{"candidates":[]}');
    git('add', 'data');
    git('-c', 'user.name=COHO test', '-c', 'user.email=coho-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture');
    writeFileSync(file, '{"entries":[]}');
    writeFileSync(resolve(root, 'data/policy/ballot-2026/statewide 2.json'), 'invalid duplicate');
    const data = readRepoState(root, schedule);
    assert.equal(Object.keys(data.ballots).length, 1);
    assert.equal(data.ballots['data/policy/ballot-2026/statewide.json'].entries[0].archived, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('workflow uses main data, safe branch previews, serialization, and a free cron minute', () => {
  const workflow = read('.github/workflows/coho-election-reminders.yml');
  assert.match(workflow, /cron: '51 9 \* \* \*'/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /permissions: \{ contents: read, issues: write \}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /github\.ref != 'refs\/heads\/main'/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets.GITHUB_TOKEN \}\}/);
  const occupies = (field, minute) => field.split(',').some((part) => {
    const [range, step = '1'] = part.split('/');
    const [start, end] = range === '*' ? [0, 59] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
    return minute >= start && minute <= end && (minute - start) % Number(step) === 0;
  });
  let checked = 0;
  for (const file of readdirSync(resolve(ROOT, '.github/workflows'))) {
    if (!/\.ya?ml$/.test(file) || file === 'coho-election-reminders.yml') continue;
    for (const [, minute] of read(`.github/workflows/${file}`).matchAll(/cron:\s*['"]([^\s'"]+)/g)) {
      checked++;
      assert.ok(!occupies(minute, 51), `${file} already uses minute 51`);
    }
  }
  assert.ok(checked > 0);
});
