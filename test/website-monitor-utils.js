'use strict';

const config = require('./website-monitor-config');

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential back-off.
 * Permanent HTTP errors (4xx) are not retried.
 *
 * @param {() => Promise<object>} fn  - Async function to retry; must return an object with { status }
 * @param {number} [maxRetries]
 * @param {number} [baseDelay]
 * @returns {Promise<object>}
 */
async function withRetry(fn, maxRetries = config.maxRetries, baseDelay = config.retryDelay) {
    let lastResult;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastResult = await fn();
        // Success
        if (lastResult.ok) return lastResult;
        // Permanent failure — do not retry 4xx errors
        if (lastResult.status !== null && lastResult.status >= 400 && lastResult.status < 500) {
            return lastResult;
        }
        // Transient failure — wait before retrying
        if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt);
            if (config.debugMode) {
                console.debug(`[retry] attempt ${attempt + 1}/${maxRetries} failed for url, retrying in ${delay}ms`);
            }
            await sleep(delay);
        }
    }
    return lastResult;
}

/**
 * Run async tasks with a bounded concurrency pool.
 *
 * @param {Array<() => Promise<*>>} tasks  - Array of zero-argument async functions
 * @param {number} [concurrency]
 * @returns {Promise<Array<*>>}
 */
async function runWithConcurrency(tasks, concurrency = config.concurrency) {
    const results = new Array(tasks.length);
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const current = index++;
            results[current] = await tasks[current]();
            if (config.rateLimitDelay > 0) {
                await sleep(config.rateLimitDelay);
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Simple in-memory cache with TTL.
 */
class ResultCache {
    constructor(ttlMs = config.cacheTtlMs) {
        this._cache = new Map();
        this._ttlMs = ttlMs;
    }

    get(key) {
        const entry = this._cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this._ttlMs) {
            this._cache.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value) {
        this._cache.set(key, { value, timestamp: Date.now() });
    }

    clear() {
        this._cache.clear();
    }

    get size() {
        return this._cache.size;
    }
}

/**
 * Compute basic statistics for an array of numbers.
 * @param {number[]} values
 * @returns {{ min: number, max: number, avg: number }}
 */
function computeStats(values) {
    if (!values || values.length === 0) return { min: 0, max: 0, avg: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    return { min, max, avg };
}

/**
 * Determine whether a URL should be ignored based on configured patterns.
 * @param {string} url
 * @param {string[]} [patterns]
 * @returns {boolean}
 */
function shouldIgnore(url, patterns = config.ignorePatterns) {
    return patterns.some(p => url.includes(p));
}

module.exports = { sleep, withRetry, runWithConcurrency, ResultCache, computeStats, shouldIgnore };
