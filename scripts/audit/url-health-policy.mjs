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

/* ── Extraction hygiene ───────────────────────────────────────────────
 *
 * URLs are scraped out of prose, HTML attributes and documented header
 * values, so the raw match is often not the URL itself. Three faults put
 * ten permanently-unreachable strings into the `stillBroken` bucket
 * (#1552):
 *
 *   1. Content-Security-Policy values documented in markdown. The bare-URL
 *      regex captures the `;` that separates directives
 *      (host `cdnjs.cloudflare.com;`) and the `*` of a wildcard host
 *      (host `*.tile.openstreetmap.org`). CSP source-expressions are
 *      origins a browser may *load from*, not documents that resolve — so
 *      they are dropped at collection time, not merely de-punctuated.
 *   2. Markdown emphasis markers glued to the URL, so a bolded link keeps
 *      a trailing `**` in its path.
 *   3. HTML entities left encoded in `href` attributes, which corrupts the
 *      query string (`?a=1&amp;b=2`).
 *
 * These helpers are pure so the policy test can exercise them directly;
 * url-health-sweep.mjs runs a live sweep on import and must never be
 * imported from a test.
 */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sol: '/', equals: '='
};

/** Decode the HTML entities that survive attribute extraction. */
export function decodeHtmlEntities(value) {
  if (typeof value !== 'string' || !value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch (_) { return match; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

// Punctuation that can only have come from the surrounding prose, markdown
// emphasis, or a CSP directive separator. Two deliberate exclusions:
//   - `)` and `]` occur inside legitimate URLs (Wikipedia article titles), and
//     the markdown bare-URL regex already refuses to match them.
//   - a trailing `...` is a documented placeholder that isSkippableUrl
//     recognizes, so only a *single* trailing period is treated as prose.
const TRAILING_PUNCTUATION_RX = /(?:(?<!\.)\.|[,;:!?*"'`>\\|])$/;

/**
 * Turn a raw extraction into the URL it was meant to be, or null when
 * nothing probe-worthy survives.
 */
export function sanitizeExtractedUrl(raw) {
  if (typeof raw !== 'string') return null;
  let url = decodeHtmlEntities(raw.trim());
  let previous;
  do {
    previous = url;
    url = url.replace(TRAILING_PUNCTUATION_RX, '');
  } while (url !== previous);
  if (!/^https?:\/\/[^/?#\s]/i.test(url)) return null;
  return url;
}

// A directive name followed by something that is actually a CSP source
// expression -- a quoted keyword, a scheme, a wildcard, or a dotted host.
// Requiring that shape keeps prose that merely names a directive ("add the
// host to connect-src in the runbook") from being read as a policy value.
const CSP_VALUE_RX = new RegExp(
  '\\b(?:default|script|style|img|font|connect|media|object|child|frame|worker|manifest|prefetch)-src\\s+' +
  "(?:'(?:self|none|unsafe-[a-z-]+|strict-dynamic|report-sample)'" +
  '|https?:|data:|blob:|filesystem:|mediastream:|\\*' +
  '|[a-z0-9-]+(?:\\.[a-z0-9-]+)+)',
  'i'
);

/**
 * True when a line of documentation is a Content-Security-Policy *value*.
 * Every URL on such a line is a source-expression, not a fetchable document.
 */
export function looksLikeCspValue(line) {
  return typeof line === 'string' && CSP_VALUE_RX.test(line);
}

// URLs we should NEVER probe because they are intentionally not real
// external targets — development artifacts, template placeholders in docs,
// or test fixtures. Without filtering, these pollute the broken-URL count
// in the dashboard. The sweep tags them as 'skip' so they're visible in
// the cache for debugging but not counted as failures.
export function isSkippableUrl(url) {
  // Local dev origins scraped from HTML by mistake
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)) return 'localhost (development artifact)';
  // URL-template placeholders that crawled their way in. Leaflet tile
  // templates (host `{s}.basemaps.cartocdn.com`, path `/{z}/{x}/{y}.png`) and
  // CSP wildcard source-expressions (host `*.tile.openstreetmap.org`) are both
  // host patterns, never addresses a probe can resolve.
  if (url.includes('{') || url.includes('}')) return 'template placeholder (literal curly braces)';
  if (/^https?:\/\/[^/?#]*\*/.test(url)) return 'wildcard host pattern (not a resolvable address)';
  if (url.includes('%7B') || url.includes('%7D')) return 'template placeholder (URL-encoded braces)';
  if (url.includes('%E2%80%A6')) return 'template placeholder (URL-encoded ellipsis)';
  // An ellipsis is a placeholder wherever it sits, not only as the host. This
  // previously matched a bare `...` host alone, so documented URL shapes such
  // as `data.census.gov/...` and `huduser.gov/...` were probed forever and
  // could never return 200.
  if (/(^|\/)\.\.\.(\/|$)/.test(url)) return 'template placeholder (ellipsis)';
  // Example/test domains
  if (/\bexample\.(com|net|org)\b/i.test(url)) return 'test/example domain';
  // FRED/Census API GET URLs with no parameters — these are API endpoints
  // referenced from docs as the SHAPE of the URL, not literal targets.
  // FRED is api.stlouisfed.ORG; the original `.gov`-only pattern never
  // matched it, so every documented FRED endpoint was probed and reported.
  if (/^https?:\/\/api\.(?:stlouisfed\.org|census\.gov)\/[^?]*$/i.test(url)) {
    return 'API endpoint reference (no parameters)';
  }
  // The same endpoints are also documented *with* a placeholder credential.
  // A request carrying YOUR_KEY is rejected by definition, so it can never
  // return 200 no matter how often it is retried.
  if (/[?&][a-z_]*key=(?:YOUR|MY|<|%3C|xxx|abcdef)/i.test(url)) {
    return 'documented example with a placeholder API key';
  }
  return null;
}
