export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export const CONFIRMED_FAILURE_SWEEPS = 2;

/**
 * 'auth' and 'ratelimit' are recorded, surfaced on the dashboard and kept in
 * the cache — they are simply not treated as link rot, because in both cases
 * the server answered. A 401/403 is a live host declining an anonymous
 * datacenter client, and a 429 is a live host asking us to slow down; neither
 * means the page is gone.
 *
 * This also aligns the weekly sweep with repo-link-audit.mjs, which has always
 * excluded 'auth' from its failure set (see its `failures` filter). The two
 * audits previously disagreed about whether a 403 was a broken link, and the
 * weekly one filed issues for URLs the other considered fine — every one of
 * the five URLs in #1591 was verified live while being reported broken.
 */
const HEALTHY_STATUSES = new Set(['ok', 'allow', 'skip', 'auth', 'ratelimit']);

export function diffConfirmedSweeps(prev, next) {
  const newlyBroken = [];
  const stillBroken = [];
  const unconfirmed = [];
  const recovered = [];

  for (const url of Object.keys(next.byUrl)) {
    const before = prev.byUrl[url] || {};
    const after = next.byUrl[url];
    const wasHealthy = before.status === undefined || HEALTHY_STATUSES.has(before.status);
    const isHealthy = HEALTHY_STATUSES.has(after.status);

    if (!isHealthy) {
      const failure = {
        url,
        status: after.status,
        httpStatus: after.httpStatus,
        consecutiveFailures: after.consecutiveFailures
      };

      if (after.consecutiveFailures === CONFIRMED_FAILURE_SWEEPS) {
        // A first failure is intentionally held for confirmation. Promote the
        // same URL exactly once when its next weekly sweep also fails, even
        // though it is no longer a transition from a healthy cache entry.
        newlyBroken.push(failure);
      } else if (after.consecutiveFailures < CONFIRMED_FAILURE_SWEEPS) {
        unconfirmed.push(failure);
      } else if (!wasHealthy) {
        stillBroken.push(failure);
      }
    } else if (!wasHealthy) {
      recovered.push({ url, httpStatus: after.httpStatus });
    }
  }

  return { newlyBroken, stillBroken, unconfirmed, recovered };
}

/**
 * The weekly sweep probes ~1,080 live external URLs from a GitHub Actions
 * runner and, unlike its sibling source-url-sweep.mjs, had no retry at all:
 * a single dropped connection or slow response was recorded as a failure.
 *
 * Retry exactly the outcomes that cannot distinguish "gone" from "blinked" —
 * a timeout, a 5XX, a network-level error with no HTTP response, and a 429.
 * A 404 is never retried: a missing page does not un-miss itself.
 */
const RETRY_DELAY_MS = Number(process.env.SWEEP_RETRY_DELAY_MS ?? 1_500);

export function isTransient(result) {
  if (!result) return false;
  if (result.status === 'timeout') return true;
  if (result.status === 'ratelimit') return true;
  if (result.status === 'broken' && result.httpStatus === null) return true;
  if (result.status === 'broken' && result.httpStatus >= 500) return true;
  return false;
}

export async function checkUrl(url, probe) {
  const first = await probe(url);
  if (!isTransient(first)) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  const second = await probe(url);
  if (isTransient(second)) {
    return { ...second, message: `${second.message} (confirmed on retry)` };
  }
  return second;
}
