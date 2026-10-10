const assert = require('assert');

function run(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name + '\n    ' + err.message);
    process.exitCode = 1;
  }
}

function runFixture(overrides = {}) {
  return {
    head_sha: overrides.head_sha || 'abc123',
    status: overrides.status || 'completed',
    conclusion: overrides.conclusion === undefined ? 'success' : overrides.conclusion,
    created_at: overrides.created_at || '2026-07-14T10:00:00Z',
    run_started_at: overrides.run_started_at || overrides.created_at || '2026-07-14T10:00:00Z',
    updated_at: overrides.updated_at || overrides.created_at || '2026-07-14T10:00:00Z',
    html_url: overrides.html_url || 'http://127.0.0.1/actions/runs/1',
  };
}

(async () => {
  const { evaluateDeployCoverage, checkDeployCoverage } = await import('../scripts/audit/pages-deploy-watchdog.mjs');
  const now = new Date('2026-07-14T13:00:00Z');

  console.log('Pages deploy watchdog');

  run('passes when latest main has a successful deploy run', () => {
    const result = evaluateDeployCoverage({
      headSha: 'abc123',
      headCommitDate: '2026-07-14T10:00:00Z',
      runs: [runFixture()],
      now,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, 'successful-run');
  });

  run('allows a fresh active deploy for latest main', () => {
    const result = evaluateDeployCoverage({
      headSha: 'abc123',
      headCommitDate: '2026-07-14T12:20:00Z',
      runs: [runFixture({
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-07-14T12:10:00Z',
      })],
      now,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, 'fresh-active-run');
  });

  run('fails on a stale active deploy run even when it is not latest main', () => {
    const result = evaluateDeployCoverage({
      headSha: 'newsha',
      headCommitDate: '2026-07-14T12:00:00Z',
      runs: [runFixture({
        head_sha: 'oldsha',
        status: 'waiting',
        conclusion: null,
        created_at: '2026-07-14T09:00:00Z',
      })],
      now,
      staleActiveMinutes: 120,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'stale-active-run');
    assert(result.messages.join('\n').includes('waiting'), 'failure explains the stuck waiting run');
  });

  run('fails when latest main is old enough and has only canceled deploys', () => {
    const result = evaluateDeployCoverage({
      headSha: 'abc123',
      headCommitDate: '2026-07-14T10:00:00Z',
      runs: [runFixture({
        status: 'completed',
        conclusion: 'cancelled',
      })],
      now,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'missing-successful-run');
  });

  run('allows a short trigger grace period before any run appears', () => {
    const result = evaluateDeployCoverage({
      headSha: 'abc123',
      headCommitDate: '2026-07-14T12:50:00Z',
      runs: [],
      now,
      graceMinutes: 20,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, 'trigger-grace-period');
  });

  async function check(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (err) { console.error('  ✗ ' + name + '\n    ' + err.stack); process.exitCode = 1; }
  }
  async function probe({ head = [], branch = [], active = {}, failHead = false, failAll = false } = {}) {
    const calls = [], waits = [];
    const result = await checkDeployCoverage({
      repoSlug: 'fixture/repo', headSha: '97b5f78a', headCommitDate: '2026-10-07T19:30:00Z',
      now: new Date('2026-10-07T22:11:00Z'),
      wait: async ms => waits.push(ms),
      request: async url => {
        const q = new URL(url).searchParams; calls.push(q);
        if (failAll) throw new Error('HTTP 403');
        if (q.has('head_sha')) {
          if (failHead) throw new Error('HTTP 503');
          return { workflow_runs: head, total_count: head.length };
        }
        if (q.has('status')) {
          const all = active[q.get('status')] || [];
          const offset = (Number(q.get('page')) - 1) * 100;
          return { workflow_runs: all.slice(offset, offset + 100), total_count: all.length };
        }
        return { workflow_runs: branch, total_count: branch.length };
      },
    });
    return { result, calls, waits };
  }
  const current = runFixture({ id: 37675164429, head_sha: '97b5f78a', created_at: '2026-10-07T19:31:00Z' });
  current.id = 37675164429;
  const staleListing = [Object.assign(runFixture({ head_sha: 'oldsha', created_at: '2026-05-01T10:00:00Z' }), { id: 24091969294 })];
  await check('10-07 stale branch listing cannot hide a successful head-SHA deploy', async () => {
    const { result, calls, waits } = await probe({ head: [current], branch: staleListing });
    assert.equal(result.ok, true); assert.equal(result.reason, 'successful-run');
    assert.equal(calls.filter(q => q.get('head_sha') === '97b5f78a').length, 2, 'head SHA queried again after inconsistent listing');
    assert.equal(waits.length, 1);
    for (const status of ['requested', 'pending', 'queued', 'in_progress', 'waiting']) assert(calls.some(q => q.get('status') === status));
  });
  for (const status of ['requested', 'pending']) {
    await check(`a ${status} head run at 45 minutes is fresh-active-run`, async () => {
      const waiting = { ...current, status, conclusion: null,
        created_at: '2026-10-07T21:26:00Z', run_started_at: null };
      const { result, calls } = await probe({ head: [waiting], branch: [waiting], active: { [status]: [waiting] } });
      assert.equal(result.ok, true); assert.equal(result.reason, 'fresh-active-run');
      assert(calls.some(q => q.get('status') === status), `${status} runs are queried directly`);
    });
  }
  await check('direct active queries find a stale run beyond the first page', async () => {
    const fresh = Array.from({ length: 100 }, (_, i) => ({ ...runFixture({ head_sha: 'other', status: 'queued', conclusion: null, created_at: '2026-10-07T22:00:00Z' }), id: i }));
    const stale = { ...runFixture({ head_sha: 'old', status: 'queued', conclusion: null, created_at: '2026-10-07T18:00:00Z' }), id: 101 };
    const { result, calls } = await probe({ head: [current], branch: [current], active: { queued: [...fresh, stale] } });
    assert.equal(result.ok, false); assert.equal(result.reason, 'stale-active-run');
    assert(calls.some(q => q.get('status') === 'queued' && q.get('page') === '2'));
  });
  await check('genuinely missing or cancelled head deploys still fail after a stale listing retry', async () => {
    for (const head of [[], [{ ...current, conclusion: 'cancelled' }]]) {
      const { result, waits } = await probe({ head, branch: staleListing });
      assert.equal(result.ok, false); assert.equal(result.reason, 'missing-successful-run');
      assert.equal(waits.length, 1);
    }
  });
  await check('an API failure fails as unverifiable after one retry', async () => {
    const { result, waits } = await probe({ failHead: true });
    assert.equal(result.reason, 'unverifiable'); assert.equal(result.ok, false); assert.equal(waits.length, 1);
  });
  await check('every API request throwing fails as unverifiable after one retry', async () => {
    const { result, calls, waits } = await probe({ failAll: true });
    assert.equal(result.ok, false); assert.equal(result.reason, 'unverifiable');
    assert.equal(waits.length, 1);
    assert.equal(calls.filter(q => q.has('head_sha')).length, 2);
  });
  await check('a failed head lookup cannot hide a confirmed stale active deploy', async () => {
    const stale = runFixture({ head_sha: 'old', status: 'waiting', conclusion: null, created_at: '2026-10-07T18:00:00Z' });
    const { result } = await probe({ failHead: true, active: { waiting: [stale] } });
    assert.equal(result.ok, false); assert.equal(result.reason, 'stale-active-run');
  });
  await check('contradictory positive branch or active evidence stays unverifiable after retry', async () => {
    const pending = { ...current, status: 'pending', conclusion: null, created_at: '2026-10-07T21:26:00Z', run_started_at: null };
    for (const evidence of [{ branch: [current] }, { active: { pending: [pending] } }]) {
      const { result, waits } = await probe({ head: [], ...evidence });
      assert.equal(result.reason, 'unverifiable'); assert.equal(result.ok, true); assert.equal(waits.length, 1);
    }
  });
})();
