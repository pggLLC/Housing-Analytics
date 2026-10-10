'use strict';

/**
 * Probe and classify the homepage's outbound links for the daily audit.
 *
 * Kept out of daily-audit-system.js, which runs main() on require, so the
 * classification can be tested against a stubbed fetch.
 *
 * Two rules come from scripts/audit/url-health-policy.mjs, so the daily
 * audit and the weekly sweeps agree about what a broken link is:
 *
 *  - Ask the way a reader asks: a browser User-Agent and Accept, HEAD first,
 *    then GET when HEAD is refused. The audit used to send a bare HEAD and
 *    stop there, so commonsenseinstituteco.org (405 to HEAD, fine to GET)
 *    was reported broken every day.
 *  - A 401, 403 or 429 is a live host declining an anonymous datacenter
 *    client, not link rot. novoco.com and jchs.harvard.edu answer every
 *    runner request with 403 and were reported broken every day while
 *    resolving fine for readers. They are counted as "declined" and named in
 *    the check's details, never silently passed and never called broken.
 */

const DECLINED_STATUSES = new Set([401, 403, 429]);

/**
 * @param {Function} fetchImpl - fetch-compatible function
 * @param {string} url
 * @param {object} opts
 * @param {object} opts.headers - browser-shaped request headers
 * @param {number} opts.timeoutMs
 * @param {number} opts.slowMs
 * @returns {Promise<object>}
 */
async function probeLink(fetchImpl, url, { headers = {}, timeoutMs = 12000, slowMs = 3000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
        let res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers });
        if (!res.ok) {
            // Many hosts refuse HEAD (405) or answer it differently from GET.
            // A one-byte range keeps the GET cheap.
            res = await fetchImpl(url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: { ...headers, Range: 'bytes=0-0' },
            });
        }
        const responseTime = Date.now() - start;
        return {
            url,
            status: res.status,
            ok: res.ok,
            responseTime,
            redirected: res.redirected || false,
            finalUrl: res.redirected ? (res.url || null) : null,
            slow: responseTime > slowMs,
        };
    } catch (err) {
        return {
            url,
            status: null,
            ok: false,
            responseTime: Date.now() - start,
            redirected: false,
            finalUrl: null,
            slow: false,
            error: err && err.message ? err.message : String(err),
        };
    } finally {
        clearTimeout(timer);
    }
}

/** True when the host answered but declined an anonymous client. */
function isDeclined(result) {
    return !result.ok && DECLINED_STATUSES.has(result.status);
}

/**
 * Splits probe results into the buckets the audit reports.
 * @param {Array<object>} results
 */
function classifyLinkResults(results) {
    return {
        broken:     results.filter(r => !r.ok && !isDeclined(r)),
        declined:   results.filter(isDeclined),
        slow:       results.filter(r => r.ok && r.slow),
        redirected: results.filter(r => r.ok && r.redirected),
    };
}

module.exports = { probeLink, classifyLinkResults, isDeclined, DECLINED_STATUSES };
