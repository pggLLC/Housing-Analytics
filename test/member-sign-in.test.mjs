// Member sign in (paul, 26 Nov 2026): the Cloudflare sign-in page gives a non-member no way back,
// so on the public site every link to the member site first opens member-sign-in.html, which offers
// "Use the free site" and "Sign in as a member". js/config.js does the routing; this runs it in a
// small fake page and checks each case.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'member-sign-in.html'), 'utf8');
const MEMBER = 'https://coho-backend.communityplanner.workers.dev/';

function run({ host = 'cohoanalytics.com', pathname = '/places/0840377.html', stored = null } = {}) {
  let handler = null;
  const store = new Map(stored ? [['coho_member_signin_direct', stored]] : []);
  const location = { hostname: host, pathname, href: `https://${host}${pathname}` };
  const ctx = {
    window: {}, URL, Date, Number, String, encodeURIComponent,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    location,
    document: {
      currentScript: { src: `https://${host}/js/config.js` },
      addEventListener: (t, fn) => { if (t === 'click') handler = fn; }
    }
  };
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
  assert.equal(p.click('https://evil.example/coho-backend.communityplanner.workers.dev/').prevented, false);
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
ok('the chooser offers both ways, is not indexed, and follows only member-site addresses', () => {
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /id="msi-free-link" href="index.html">Use the free site</);
  assert.match(page, /id="msi-go" href="https:\/\/coho-backend\.communityplanner\.workers\.dev\/">Sign in as a member</);
  assert.match(page, /u\.origin === MEMBER_ORIGIN/);
});
console.log(`member-sign-in: PASS (${n} checks)`);
