export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export const CONFIRMED_FAILURE_SWEEPS = 2;

const HEALTHY_STATUSES = new Set(['ok', 'allow', 'skip']);

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
