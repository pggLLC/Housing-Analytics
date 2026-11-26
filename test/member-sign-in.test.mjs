// Member sign in (paul, 26 Nov 2026): the Cloudflare sign-in page gives a non-member no way back,
// so on the public site every link to the member site first opens member-sign-in.html, which offers
// "Use the free site" and "Sign in as a member". js/path-resolver.js does the routing (the deploy
// writes js/config.js afresh, so it cannot live there); this runs it in a small fake page and checks
// each case, then runs the chooser's own script.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolver = fs.readFileSync(path.join(ROOT, 'js/path-resolver.js'), 'utf8');
const MARK = '// ── Member sign in';
assert.ok(resolver.includes(MARK), 'js/path-resolver.js carries the member sign-in router');
const src = resolver.slice(resolver.indexOf(MARK));
const page = fs.readFileSync(path.join(ROOT, 'member-sign-in.html'), 'utf8');
const MEMBER = 'https://coho-backend.communityplanner.workers.dev/';

function run({ host = 'cohoanalytics.com', pathname = '/places/0840377.html', stored = null } = {}) {
  let handler = null;
  const store = new Map(stored ? [['coho_member_signin_direct', stored]] : []);
  const location = { hostname: host, pathname, href: `https://${host}${pathname}` };
  const ctx = {
    URL, Date, Number, String, encodeURIComponent,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    location,
    document: {
      currentScript: { src: `https://${host}/js/path-resolver.js` },
      addEventListener: (t, fn) => { if (t === 'click') handler = fn; }
    }
  };
  ctx.window = { location: ctx.location, localStorage: ctx.localStorage };
  vm.runInNewContext(src, ctx);
  return {
    click(href, extra = {}) {
      let prevented = false;
      const a = { href };
      const e = { defaultPrevented: false, button: 0, target: { closest: () => a }, preventDefault() { prevented = true; }, ...extra };
      location.href = `https://${host}${pathname}`;
      if (handler) handler(e);
      return { prevented, to: location.href };
    },
    hasHandler: () => !!handler
  };
}

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('a member link on a public page opens the chooser, carrying the member address in the fragment', () => {
  const r = run().click(MEMBER + 'developer-commuters.html?geoid=0840377');
  assert.equal(r.prevented, true);
  assert.equal(r.to, 'https://cohoanalytics.com/member-sign-in.html#to=' + encodeURIComponent(MEMBER + 'developer-commuters.html?geoid=0840377'));
});
ok('a calculator deal in the fragment stays in the fragment (never sent to a server)', () => {
  const r = run().click(MEMBER + 'deal-calculator.html#v=1&units=48');
  assert.ok(r.to.startsWith('https://cohoanalytics.com/member-sign-in.html#to='));
  assert.ok(!r.to.includes('?'));
});
ok('other links are left alone', () => {
  const p = run();
  assert.equal(p.click('https://cohoanalytics.com/index.html').prevented, false);
  assert.equal(p.click(['https:', '', 'other.example.org', 'coho-backend.communityplanner.workers.dev', ''].join('/')).prevented, false);
});
ok('new-tab and modified clicks keep the browser default', () => {
  const p = run();
  assert.equal(p.click(MEMBER, { metaKey: true }).prevented, false);
  assert.equal(p.click(MEMBER, { button: 1 }).prevented, false);
  assert.equal(p.click(MEMBER, { defaultPrevented: true }).prevented, false);
});
ok('a visitor who chose "Sign in as a member" in the last 30 days goes straight through', () => {
  assert.equal(run({ stored: String(Date.now() - 86400000) }).click(MEMBER).prevented, false);
  assert.equal(run({ stored: String(Date.now() - 31 * 86400000) }).click(MEMBER).prevented, true);
});
ok('on the member site itself nothing is routed', () => {
  assert.equal(run({ host: 'coho-backend.communityplanner.workers.dev' }).hasHandler(), false);
});
ok('the chooser page does not route its own sign-in button', () => {
  assert.equal(run({ pathname: '/member-sign-in.html' }).click(MEMBER).prevented, false);
});
// The chooser: its two choices by destination (not wording), and its origin rule run for real.
const tag = (id) => (page.match(new RegExp('<a\\b[^>]*\\bid="' + id + '"[^>]*>')) || [''])[0];
const hrefOf = (id) => (tag(id).match(/\bhref="([^"]*)"/) || [])[1];
function chooser(hash) {
  const go = { href: hrefOf('msi-go'), addEventListener() {} };
  const script = page.match(/<script>\s*([\s\S]*?MEMBER_ORIGIN[\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { URL, decodeURIComponent, String, Date,
    location: { hash }, localStorage: { setItem() {} },
    document: { getElementById: (id) => (id === 'msi-go' ? go : null) } });
  return go.href;
}
ok('the chooser is not indexed and offers the free site and the member site', () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.equal(hrefOf('msi-free-link'), 'index.html');
  assert.equal(hrefOf('msi-go'), MEMBER);
});
ok('the chooser follows a member-site address and nothing else', () => {
  const deal = MEMBER + 'deal-calculator.html#v=1&units=48';
  assert.equal(chooser('#to=' + encodeURIComponent(deal)), deal);
  assert.equal(chooser('#to=' + encodeURIComponent('https://other.example.org/x')), MEMBER);
  assert.equal(chooser('#to=' + encodeURIComponent(['https:', '', 'coho-backend.communityplanner.workers.dev.other.example.org', ''].join('/'))), MEMBER);
  assert.equal(chooser('#to=%E0%A4%A'), MEMBER);
  assert.equal(chooser(''), MEMBER);
});
console.log(`member-sign-in: PASS (${n} checks)`);
