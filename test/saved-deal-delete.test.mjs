// Submittal review: delete a saved version, or a whole saved deal, for good.
//
// paul 2026-10-25 asked whether saved deals could be deleted; until now a version
// could only be hidden. Runs the real page markup and script in jsdom with the
// device store (the save service is not reachable in a test), and the server store
// against a stand-in fetch for the deleteDeal rounds. Invented deals only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SR = require(path.join(ROOT, 'js/whitepaper/submittal-review.js'));
const rules = JSON.parse(read('data/policy/chfa-2027-r1-scoring.json'));
const prop123 = JSON.parse(read('data/policy/prop123_jurisdictions.json'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const tick = () => new Promise((r) => setTimeout(r, 20));

async function page(answer) {
  const dom = new JSDOM(read('developer-submittal-review.html'), { url: 'http://127.0.0.1/developer-submittal-review.html' });
  const w = dom.window, d = w.document;
  const asked = [];
  w.confirm = (q) => { asked.push(q); return answer(q); };
  const f = SR.formHtml(rules);
  d.getElementById('srClaims').innerHTML = f.claims;
  d.getElementById('srThresholds').innerHTML = f.thresholds;
  const mem = {};
  const store = SR.makeStore(() => Promise.reject(new Error('offline')), { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
  // Two invented deals, saved before the page opens.
  const a1 = await store.save({ name: 'Invented Site A', label: 'first', data: { deal: { mix: { 60: 10 } } } });
  const a2 = await store.save({ deal: a1.deal, name: 'Invented Site A', label: 'second', data: { deal: { mix: { 60: 20 } } } });
  const a3 = await store.save({ deal: a1.deal, name: 'Invented Site A', label: 'third', data: { deal: { mix: { 60: 30 } } } });
  const b1 = await store.save({ name: 'Invented Site B', label: 'only', data: { deal: { mix: { 50: 5 } } } });
  SR.mount(d, rules, prop123, store);
  await tick();
  const $ = (id) => d.getElementById(id);
  const pick = async (id) => { $('sr-deal').value = id; $('sr-deal').dispatchEvent(new w.Event('change')); await tick(); await tick(); };
  const btn = (act, v) => $('srVersions').querySelector('[data-act="' + act + '"][data-v="' + v + '"]');
  return { w, d, $, store, pick, btn, asked, ids: { a1, a2, a3, b1 } };
}

// ── One version ──────────────────────────────────────────────────────────
{
  let yes = false;
  const p = await page(() => yes);
  const { $, store, pick, btn, asked, ids } = p;
  ok($('sr-delete-deal').hidden, 'no deal picked: no Delete this deal button');
  await pick(ids.a1.deal);
  ok(!$('sr-delete-deal').hidden, 'a picked deal shows Delete this deal');
  ok(btn('purge', ids.a2.v) && btn('purge', ids.a2.v).textContent === 'Delete', 'every version row has Delete');
  ok(btn('purge', ids.a2.v).getAttribute('aria-label') === 'Delete v2 for good', 'the button names the version for a screen reader');

  btn('purge', ids.a2.v).click(); await tick();
  ok(asked.length === 1 && /v2 · second/.test(asked[0]) && /cannot be brought back/.test(asked[0]) && /Hide/.test(asked[0]), 'it asks first, naming the version and offering Hide: ' + asked[0]);
  ok((await store.versions(ids.a1.deal)).versions.length === 3, 'a no keeps the version');

  yes = true;
  btn('purge', ids.a2.v).click(); await tick(); await tick();
  const left = (await store.versions(ids.a1.deal)).versions.map((x) => x.v);
  ok(left.length === 2 && !left.includes(ids.a2.v), 'a yes deletes that version and only that one');
  ok(!btn('purge', ids.a2.v) && btn('purge', ids.a3.v), 'it is off the version list');
  ok(/Deleted v2 · second/.test($('srFlash').textContent), 'the page says what it deleted: ' + $('srFlash').textContent);
  ok(/\(2 versions\)/.test($('sr-deal').selectedOptions[0].textContent), 'the deal picker shows the new count: ' + $('sr-deal').selectedOptions[0].textContent);
  ok($('sr-deal').value === ids.a1.deal, 'the deal stays picked');

  // Deleting the baseline clears it, so nothing points at a version that is gone.
  await store.meta(ids.a1.deal, 'baseline', ids.a3.v);
  await store.meta(ids.a1.deal, 'hide', ids.a3.v);
  await store.meta(ids.a1.deal, 'purge', ids.a3.v);
  const after = await store.versions(ids.a1.deal);
  ok(after.baseline === '' && !after.hidden.includes(ids.a3.v), 'a deleted version is no longer the baseline or hidden');
}

// ── A whole deal ─────────────────────────────────────────────────────────
{
  let yes = false;
  const p = await page(() => yes);
  const { $, store, pick, asked, ids } = p;
  await pick(ids.a1.deal);
  $('sr-delete-deal').click(); await tick();
  ok(asked.length === 1 && /"Invented Site A"/.test(asked[0]) && /all 3 versions/.test(asked[0]) && /market research/.test(asked[0]), 'it asks first, naming the deal, its version count and its research: ' + asked[0]);
  ok((await store.deals()).length === 2, 'a no keeps the deal');

  yes = true;
  $('sr-delete-deal').click(); await tick(); await tick(); await tick();
  const deals = await store.deals();
  ok(deals.length === 1 && deals[0].id === ids.b1.deal, 'a yes deletes that deal and leaves the other');
  ok($('sr-deal').value === '' && ![...$('sr-deal').options].some((o) => o.value === ids.a1.deal), 'the picker is back on New deal, without it');
  ok($('sr-name').value === '' && $('sr-delete-deal').hidden, 'the form is cleared and the button hides');
  ok(/Deleted "Invented Site A"/.test($('srFlash').textContent), 'the page says what it deleted');
  ok(!$('srVersions').querySelector('tr, [data-act]'), 'no version rows or buttons of it are left on screen');
}

// Codex review on 050a5f5: a delete that finishes after another deal was picked leaves that deal picked,
// and a comparison drawn across the deleted version is renumbered with the list.
{
  const p = await page(() => true);
  const { $, store, pick, btn, ids } = p;
  await pick(ids.a1.deal);
  const real = store.meta.bind(store); let release;
  store.meta = (deal, action, v) => (action === 'purge' ? new Promise((r) => { release = () => r(real(deal, action, v)); }) : real(deal, action, v));
  btn('purge', ids.a2.v).click(); await tick();
  await pick(ids.b1.deal);
  ok($('sr-name').value === 'Invented Site B', 'non-vacuous: deal B is open while the delete is pending');
  release(); await tick(); await tick(); await tick();
  ok($('sr-deal').value === ids.b1.deal && $('sr-name').value === 'Invented Site B', 'the picker still shows the deal on screen, not the one the delete came from');
  ok(btn('purge', ids.b1.v) && !btn('purge', ids.a3.v), 'and the version list is still deal B\'s');
  ok((await store.versions(ids.a1.deal)).versions.length === 2, 'the delete itself went through');
  store.meta = real;

  const q = await page(() => true);
  await q.pick(q.ids.a1.deal);
  [q.ids.a1.v, q.ids.a3.v].forEach((v) => { const box = q.$('srVersions').querySelector('.sr-pick[data-v="' + v + '"]'); box.checked = true; box.dispatchEvent(new q.w.Event('click', { bubbles: true })); });
  await tick(); await tick();
  const heads = () => [...q.$('srCompare').querySelectorAll('th')].map((th) => th.textContent).join(' | ');
  ok(/\bv3\b/.test(heads()), 'non-vacuous: the comparison names v3 before the delete: ' + heads());
  q.btn('purge', q.ids.a2.v).click(); await tick(); await tick(); await tick(); await tick();
  ok(q.btn('purge', q.ids.a3.v).getAttribute('aria-label') === 'Delete v2 for good', 'non-vacuous: the list renumbers the third version to v2');
  ok(/\bv2\b/.test(heads()) && !/\bv3\b/.test(heads()), 'the comparison renumbers it too: ' + heads());
}

// A browser that blocks dialogs deletes nothing.
{
  const p = await page(() => { throw new Error('blocked'); });
  await p.pick(p.ids.b1.deal);
  p.$('sr-delete-deal').click(); await tick();
  ok((await p.store.deals()).length === 2, 'a blocked dialog is a no');
}

// ── Server store: a large deal is deleted in rounds ──────────────────────
{
  const bodies = []; let rounds = 2;
  const fetchFn = (url, opts) => {
    if (!opts || opts.method !== 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ deals: [] }) });
    bodies.push(JSON.parse(opts.body));
    const more = --rounds > 0;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, deleted: 400, more }) });
  };
  const st = SR.makeStore(fetchFn, { getItem: () => null, setItem: () => {} });
  await st.removeDeal('invented-deal-abcdef');
  ok(st.mode() === 'server' && bodies.length === 2 && bodies.every((b) => b.deleteDeal === 'invented-deal-abcdef'), 'it repeats deleteDeal while the server says more');
  const failing = SR.makeStore((u, o) => Promise.resolve(o && o.method === 'POST' ? { ok: false, status: 500 } : { ok: true, json: () => Promise.resolve({ deals: [] }) }), { getItem: () => null, setItem: () => {} });
  await assert.rejects(failing.removeDeal('invented-deal-abcdef'), /500/); checks++;
}

console.log(`saved-deal-delete: ${checks} checks passed`);
