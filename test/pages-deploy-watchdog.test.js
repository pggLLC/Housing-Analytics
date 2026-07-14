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
  const { evaluateDeployCoverage } = await import('../scripts/audit/pages-deploy-watchdog.mjs');
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
})();
