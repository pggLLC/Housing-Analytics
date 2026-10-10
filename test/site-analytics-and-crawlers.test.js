'use strict';
/**
 * Site analytics + crawler policy guard.
 *
 * Pins agreement, not copy:
 *   - the analytics host js/navigation.js loads must be allowed by the CSP in
 *     the security-headers runbook (and the inert _headers), or the beacon is
 *     silently blocked the day Cloudflare is put in front of Pages;
 *   - the privacy policy must name the provider navigation.js actually loads;
 *   - every gated /developer* page must be excluded from measurement;
 *   - robots.txt blocks AI training crawlers without catching a search engine
 *     or an AI search bot, and keeps the public crawl open.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}

const nav = read('js/navigation.js');
const fnMatch = nav.match(/var CF_ANALYTICS_TOKEN = '[^']*';\n\s*function loadAnalytics\(\) \{[\s\S]*?\n  \}\n/);

function runLoader(token, hostname, pathname) {
  const appended = [];
  const el = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const ctx = {
    location: { hostname, pathname },
    document: {
      getElementById: () => null,
      createElement: el,
      head: { appendChild: (n) => appended.push(n) },
    },
    JSON,
  };
  const src = fnMatch[0].replace(/var CF_ANALYTICS_TOKEN = '[^']*';/, 'var CF_ANALYTICS_TOKEN = ' + JSON.stringify(token) + ';');
  vm.runInNewContext(src + '\nloadAnalytics();', ctx);
  return appended;
}

test('navigation.js defines the analytics loader and calls it from boot()', () => {
  assert(fnMatch, 'loadAnalytics() block not found in js/navigation.js');
  assert(/function boot\(\)[^\n]*loadAnalytics\(\)/.test(nav), 'boot() does not call loadAnalytics()');
});

const beaconSrc = (() => {
  const out = runLoader('t0ken', 'cohoanalytics.com', '/index.html');
  return out.length ? out[0].src : null;
})();

test('loader injects one beacon on a public page, carrying the token', () => {
  const out = runLoader('t0ken', 'cohoanalytics.com', '/index.html');
  assert.strictEqual(out.length, 1);
  assert(/^https:\/\//.test(out[0].src), 'beacon src is not https');
  assert.deepStrictEqual(JSON.parse(out[0].attrs['data-cf-beacon']), { token: 't0ken' });
});

test('loader is a no-op with an empty token and off the production host', () => {
  assert.strictEqual(runLoader('', 'cohoanalytics.com', '/index.html').length, 0);
  assert.strictEqual(runLoader('t0ken', 'localhost', '/index.html').length, 0);
});

test('every gated developer page is excluded from measurement', () => {
  const gated = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && read(f).includes('js/developer-gate.js'));
  assert(gated.length > 0, 'found no pages loading js/developer-gate.js');
  for (const f of gated) {
    assert.strictEqual(runLoader('t0ken', 'cohoanalytics.com', '/' + f).length, 0, f + ' would be measured');
  }
});

function cspDirective(csp, name) {
  const m = csp.match(new RegExp('(?:^|;)\\s*' + name + '\\s+([^;]*)'));
  return m ? m[1].split(/\s+/) : [];
}

test('runbook and _headers CSP allow the beacon script and its report endpoint', () => {
  assert(beaconSrc, 'no beacon src to check');
  const scriptOrigin = new URL(beaconSrc).origin;
  const runbook = read('docs/SECURITY-HEADERS-RUNBOOK.md');
  const policies = [
    ['runbook', (runbook.match(/^default-src[^\n]*$/m) || [])[0]],
    ['_headers', (read('_headers').match(/Content-Security-Policy:\s*([^\n]*)/) || [])[1]],
  ];
  for (const [where, csp] of policies) {
    assert(csp, where + ': CSP line not found');
    assert(cspDirective(csp, 'script-src').includes(scriptOrigin), where + ' script-src lacks ' + scriptOrigin);
    assert(cspDirective(csp, 'connect-src').includes('https://cloudflareinsights.com'), where + ' connect-src lacks https://cloudflareinsights.com');
  }
});

test('privacy policy names the provider navigation.js loads', () => {
  const policy = read('privacy-policy.html');
  assert(/static\.cloudflareinsights\.com/.test(beaconSrc || ''), 'beacon is no longer Cloudflare; update the privacy policy and this test');
  assert(policy.includes('Cloudflare Web Analytics'), 'privacy policy does not name Cloudflare Web Analytics');
  assert(!/does not currently use third-party analytics/.test(policy), 'privacy policy still says there is no analytics');
});

test('robots.txt: AI training crawlers blocked, search engines and AI search bots untouched', () => {
  const groups = [];
  let cur = null;
  for (const raw of read('robots.txt').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (cur) cur.rules.push(key + ':' + val);
    }
  }
  const blockAll = groups.filter((g) => g.rules.includes('disallow:/'));
  const blocked = new Set(blockAll.flatMap((g) => g.agents));
  assert(blocked.size >= 5, 'expected a group of AI training crawlers with Disallow: /');
  for (const ua of ['gptbot', 'claudebot', 'ccbot', 'google-extended']) assert(blocked.has(ua), ua + ' not blocked');
  for (const ua of ['*', 'googlebot', 'bingbot', 'oai-searchbot', 'chatgpt-user', 'perplexitybot', 'claude-searchbot', 'claude-user', 'applebot', 'duckduckbot']) {
    assert(!blocked.has(ua), ua + ' is blocked from the whole site');
  }
  const star = groups.find((g) => g.agents.includes('*'));
  assert(star && star.rules.includes('allow:/'), 'the * group no longer allows the public crawl');
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('site-analytics-and-crawlers: all passed');
