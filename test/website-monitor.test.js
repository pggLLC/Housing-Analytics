'use strict';

/**
 * Basic unit tests for website-monitor-utils.js
 *
 * Run with: node test/website-monitor.test.js
 */

const { withRetry, runWithConcurrency, ResultCache, computeStats, shouldIgnore, sleep } = require('./website-monitor-utils');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

async function test(name, fn) {
    console.log(`\n[test] ${name}`);
    try {
        await fn();
    } catch (err) {
        console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
        failed++;
    }
}

async function runTests() {
    // ---------------------------------------------------------------------------
    // sleep
    // ---------------------------------------------------------------------------
    await test('sleep resolves after at least the given delay', async () => {
        const start = Date.now();
        await sleep(50);
        assert(Date.now() - start >= 45, 'elapsed >= 45ms');
    });

    // ---------------------------------------------------------------------------
    // computeStats
    // ---------------------------------------------------------------------------
    await test('computeStats returns correct min/max/avg', async () => {
        const s = computeStats([100, 200, 300]);
        assert(s.min === 100, `min === 100 (got ${s.min})`);
        assert(s.max === 300, `max === 300 (got ${s.max})`);
        assert(s.avg === 200, `avg === 200 (got ${s.avg})`);
    });

    await test('computeStats handles empty array', async () => {
        const s = computeStats([]);
        assert(s.min === 0 && s.max === 0 && s.avg === 0, 'all zeros for empty array');
    });

    // ---------------------------------------------------------------------------
    // shouldIgnore
    // ---------------------------------------------------------------------------
    await test('shouldIgnore returns true when URL contains a pattern', async () => {
        assert(shouldIgnore('mailto:user@example.com', ['mailto:']), 'mailto: is ignored');
        assert(shouldIgnore('https://localhost/foo', ['localhost']), 'localhost is ignored');
    });

    await test('shouldIgnore returns false when URL matches no pattern', async () => {
        assert(!shouldIgnore('https://example.com/page', ['mailto:', 'tel:']), 'https URL not ignored');
    });

    await test('shouldIgnore returns false for empty patterns array', async () => {
        assert(!shouldIgnore('https://example.com', []), 'empty patterns — not ignored');
    });

    // ---------------------------------------------------------------------------
    // ResultCache
    // ---------------------------------------------------------------------------
    await test('ResultCache stores and retrieves values within TTL', async () => {
        const cache = new ResultCache(5000);
        cache.set('https://a.com', { ok: true });
        const hit = cache.get('https://a.com');
        assert(hit !== null && hit.ok === true, 'cache hit returns stored value');
    });

    await test('ResultCache returns null for missing key', async () => {
        const cache = new ResultCache(5000);
        assert(cache.get('https://missing.com') === null, 'returns null for unknown key');
    });

    await test('ResultCache expires entries after TTL', async () => {
        const cache = new ResultCache(50);   // 50ms TTL
        cache.set('https://b.com', { ok: true });
        await sleep(80);
        assert(cache.get('https://b.com') === null, 'expired entry returns null');
    });

    await test('ResultCache.size reflects number of live entries', async () => {
        const cache = new ResultCache(5000);
        cache.set('k1', 1);
        cache.set('k2', 2);
        assert(cache.size === 2, `size === 2 (got ${cache.size})`);
        cache.clear();
        assert(cache.size === 0, 'size === 0 after clear');
    });

    // ---------------------------------------------------------------------------
    // withRetry
    // ---------------------------------------------------------------------------
    await test('withRetry returns success on first attempt', async () => {
        let calls = 0;
        const result = await withRetry(() => { calls++; return Promise.resolve({ ok: true, status: 200 }); }, 3, 10);
        assert(result.ok === true, 'result is ok');
        assert(calls === 1, `called once (called ${calls} times)`);
    });

    await test('withRetry retries transient failures and eventually succeeds', async () => {
        let calls = 0;
        const result = await withRetry(() => {
            calls++;
            if (calls < 3) return Promise.resolve({ ok: false, status: null, error: 'timeout' });
            return Promise.resolve({ ok: true, status: 200 });
        }, 3, 10);
        assert(result.ok === true, 'eventually succeeds');
        assert(calls === 3, `called 3 times (called ${calls} times)`);
    });

    await test('withRetry does NOT retry permanent 4xx failures', async () => {
        let calls = 0;
        const result = await withRetry(() => {
            calls++;
            return Promise.resolve({ ok: false, status: 404 });
        }, 3, 10);
        assert(result.status === 404, '404 returned immediately');
        assert(calls === 1, `called once, not retried (called ${calls} times)`);
    });

    await test('withRetry returns last failure after exhausting retries', async () => {
        let calls = 0;
        const result = await withRetry(() => {
            calls++;
            return Promise.resolve({ ok: false, status: 503 });
        }, 2, 10);
        assert(!result.ok, 'result is not ok');
        assert(calls === 3, `called maxRetries+1=3 times (called ${calls} times)`);
    });

    // ---------------------------------------------------------------------------
    // runWithConcurrency
    // ---------------------------------------------------------------------------
    await test('runWithConcurrency runs all tasks and returns results in order', async () => {
        const tasks = [1, 2, 3, 4, 5].map(n => async () => n * 10);
        const results = await runWithConcurrency(tasks, 2);
        assert(JSON.stringify(results) === JSON.stringify([10, 20, 30, 40, 50]), `results in order: ${JSON.stringify(results)}`);
    });

    await test('runWithConcurrency handles empty task array', async () => {
        const results = await runWithConcurrency([], 3);
        assert(Array.isArray(results) && results.length === 0, 'returns empty array');
    });

    await test('runWithConcurrency limits concurrency', async () => {
        let maxConcurrent = 0;
        let current = 0;
        const tasks = Array.from({ length: 10 }, () => async () => {
            current++;
            if (current > maxConcurrent) maxConcurrent = current;
            await sleep(20);
            current--;
        });
        await runWithConcurrency(tasks, 3);
        assert(maxConcurrent <= 3, `max concurrency was ${maxConcurrent} (limit 3)`);
    });

    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Unexpected error running tests:', err);
    process.exit(1);
});

