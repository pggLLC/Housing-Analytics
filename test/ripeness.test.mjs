// "Ready to build" on the gated pipeline page (js/whitepaper/ripeness.js). Pins:
//   1. every pipeline place stays in the communities list, ordered by its best
//      site's reading and then the pipeline score, each with a one-line reason;
//   2. a site's reading comes only from a dossier card; others are "on file";
//   3. "My order": pinned rows first, moved rows keep their place, new rows
//      follow in suggested order, "selected only" filters;
//   4. privacy: the data file is built by the private backend and never lives
//      here; the module sits in a folder the public build leaves out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, 'js/whitepaper/ripeness.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// Synthetic data in the shape scripts/build-ripeness.mjs writes.
const card = (reading) => ({
  dossier: 'test-dossier', reading, checked: '2026-10-16', trigger: 'A zoning letter.', next: { date: '2026-12-31', what: 'Land closing' },
  dossier_href: null,
  answers: R.QUESTIONS.map(([q]) => ({ q, status: 'partly', line: 'Line for ' + q + '.', section: 'risks' }))
});
const DATA = {
  generated: '2026-10-18',
  places: { '0800001': { prop123: 'Committed', prop123_units: 30, fast_track: true } },
  sites: [
    { id: 's-a', geoid: '0800001', place: 'Alpha', name: 'Alpha Site', homes: 40, stage: 'not_funded', year: 2026, program: 'Housing tax credit 9% application', agency: 'CHFA', source_url: 'https://example.org/a', card: null },
    { id: 's-b', geoid: '0800002', place: 'Bravo', name: 'Bravo Site', homes: 50, stage: 'land_funded', year: 2025, program: 'Prop 123 Land Banking', agency: 'OEDIT / CHFA', source_url: 'https://example.org/b', card: card('ripening') },
    { id: 's-a2', geoid: '0800001', place: 'Alpha', name: 'Alpha Small', homes: 10, stage: 'land_funded', year: 2024, program: 'Prop 123 Land Banking', agency: 'OEDIT / CHFA', source_url: 'https://example.org/a2', card: null },
    { id: 'dossier-x', geoid: '0800009', place: 'Xray', name: 'Xray Parcel', homes: 20, stage: 'dossier', source_url: null, card: card('ripe') }
  ]
};
const PIPELINE = [
  { jurisdiction: 'Alpha', geoid: '0800001', stage: 'Signal', ioi_score: '60', classification: 'A', confidence: 'high', notes: 'note' },
  { jurisdiction: 'Bravo', geoid: '0800002', stage: 'Screen', ioi_score: '50' },
  { jurisdiction: 'Charlie', geoid: '0800003', stage: 'Outreach', ioi_score: '90' },
  { jurisdiction: 'Delta', geoid: '0800004', stage: 'Monitor', ioi_score: '70' },
  { jurisdiction: 'Gone', geoid: '0800005', stage: 'Anti', ioi_score: '99' }
];
const SIGNALS = [
  { geoid: '0800001', date: '2026-05-01', signal_type: 'HNA', strength: 'weak' },
  { geoid: '0800001', date: '2026-06-01', signal_type: 'RFP', strength: 'strong' }
];

// ---- 1 and 2. Both lists, in suggested order.
const L = R.build(DATA, PIPELINE, SIGNALS);
ok(L.communities.length === 4, 'every pipeline place stays (set-aside rows aside)');
ok(L.communities.map((c) => c.name).join() === 'Bravo,Alpha,Charlie,Delta', 'ripening site first, then a site on file, then no site by score: ' + L.communities.map((c) => c.name));
const alpha = L.communities.find((c) => c.name === 'Alpha');
ok(alpha.reading === 'on_file' && alpha.sites[0].name === 'Alpha Site', 'a place reads as its best site; the bigger site leads among equals');
ok(/Pipeline score 60, class A, high confidence/.test(alpha.why), 'the reason gives the pipeline score: ' + alpha.why);
ok(/Prop 123: committed \(30 homes\), fast track/.test(alpha.why), 'the reason gives Prop 123 standing');
ok(/Best site: Alpha Site \(40 homes\), site on file; 1 more on file/.test(alpha.why), 'the reason names the best site');
ok(/Latest signal: RFP, strong, 2026-06-01/.test(alpha.why), 'the reason gives the newest signal');
const charlie = L.communities.find((c) => c.name === 'Charlie');
ok(charlie.reading === 'none' && /No site on file/.test(charlie.why), 'a place with no site says so instead of a blank');
ok(L.sites.map((s) => s.key).join() === 'dossier-x,s-b,s-a,s-a2', 'sites: ripe, ripening, then on file by place score and size: ' + L.sites.map((s) => s.key));
ok(L.sites.find((s) => s.key === 's-a').reading === 'on_file' && /No readiness sheet yet/.test(L.sites.find((s) => s.key === 's-a').why), 'no card means on file, never a guessed reading');
ok(/What would change it: A zoning letter\. Next date: 2026-12-31, Land closing/.test(L.sites.find((s) => s.key === 's-b').why), 'a card gives its trigger and next date');
ok(R.build(null, PIPELINE, []).communities.length === 4, 'no data still keeps the pipeline');

// ---- 3. My order.
const items = L.communities;
const keys = (xs) => xs.map((x) => x.key).join();
let saved = { order: [], pinned: [], selected: [] };
ok(keys(R.arrange(items, saved, 'mine')) === keys(items), 'an empty saved order equals the suggested order');
saved = R.move(saved, items.map((x) => x.key), '0800004', 0);
ok(keys(R.arrange(items, saved, 'mine')).startsWith('0800004,'), 'a moved row goes where it was put');
ok(keys(R.arrange(items, saved, 'suggested')) === keys(items), 'the suggested view ignores moves');
const grown = items.concat([{ key: '0800006', name: 'New' }]);
ok(keys(R.arrange(grown, saved, 'mine')).split(',')[0] === '0800004' && keys(R.arrange(grown, saved, 'mine')).endsWith('0800006'), 'a new place joins after the rows already placed');
saved = { ...saved, pinned: ['0800003'] };
ok(keys(R.arrange(items, saved, 'suggested')).startsWith('0800003,') && keys(R.arrange(items, saved, 'mine')).startsWith('0800003,0800004'), 'a pinned row tops both views');
saved = { ...saved, selected: ['0800001', '0800002'] };
ok(keys(R.arrange(items, saved, 'mine', true)) === '0800002,0800001', 'selected only shows the selected rows, in order');
ok(R.toggle(['a', 'b'], 'a').join() === 'b' && R.toggle(['b'], 'a').join() === 'b,a', 'toggle adds and removes');
ok(JSON.stringify(R.cleanState({ sites: { order: [1] } })) === JSON.stringify({ communities: { order: [], pinned: [], selected: [] }, sites: { order: ['1'], pinned: [], selected: [] } }), 'a saved order is cleaned before use');

// Moving a row while only selected rows show leaves the hidden rows in place.
{
  const st = { order: [], pinned: [], selected: ['b', 'd'] };
  const after = R.move(st, ['b', 'd'], 'b', 1, ['a', 'b', 'c', 'd']);
  ok(after.order.join() === 'a,d,c,b', 'a filtered move swaps only the shown rows; hidden rows keep their places');
}

// An order the site did not take wins at the next load and is sent again.
{
  const mem = {}; const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const mine = R.cleanState({ communities: { order: ['x', 'y'] } });
  const down = () => Promise.resolve({ ok: false });
  const up = (u, o) => Promise.resolve(o && o.method === 'POST' ? { ok: true } : { ok: true, json: () => Promise.resolve(R.cleanState(null)) });
  ok(await R.saveState(down, storage, mine) === false, 'a save the site refuses reports false');
  const back = await R.loadState(up, storage);
  ok(back.unsent && back.state.communities.order.join() === 'x,y', 'the unsent browser order beats the site copy at the next load');
  const other = R.cleanState({ communities: { order: ['z'] } });
  const fresh = (u, o) => Promise.resolve(o && o.method === 'POST' ? { ok: true } : { ok: true, json: () => Promise.resolve(other) });
  await R.saveState(up, storage, back.state);
  await R.loadState(fresh, storage);
  ok((await R.loadState(() => Promise.reject(new Error('offline')), storage)).state.communities.order.join() === 'z', 'a loaded site order is kept in the browser, so a later failed load shows the newest order');
  ok(await R.saveState(up, storage, back.state) === true && !(await R.loadState(up, storage)).unsent, 'once the site takes it, the site copy is used again');
}

// ---- 4. Privacy and wiring.
ok(/role="tabpanel" id="rdPanel" aria-labelledby="rdTab-/.test(read('js/whitepaper/ripeness.js')) && /aria-controls="rdPanel"/.test(read('js/whitepaper/ripeness.js')), 'each tab is tied to the list it shows');
ok(/refocus\('data-rd-pin', a\)/.test(read('js/whitepaper/ripeness.js')) && /refocus\('data-rd-select', a\)/.test(read('js/whitepaper/ripeness.js')), 'focus returns to the pin or checkbox after a redraw');
ok(!fs.existsSync(path.join(ROOT, 'data/ripeness.json')), 'the readiness data is never in the public repo');
const build = read('scripts/build-public-site.mjs');
ok(build.includes("'js/whitepaper'") && read('scripts/audit/public-artifact-guard.mjs').includes("'js/whitepaper'"), 'the public build and its guard leave js/whitepaper out');
const page = read('developer-pipeline.html');
ok(page.includes('<script src="js/whitepaper/ripeness.js"></script>') && page.includes("Ripeness.mount($('ready')"), 'the pipeline page loads the lists');
const src = read('js/whitepaper/ripeness.js');
ok(!/min-(width|height):2\.4rem/.test(src) && (src.match(/min-height:44px/g) || []).length >= 4, 'buttons, checkboxes and toggles are at least 44px to touch');
ok(/if \(saving\) \{ keepLocal\(storage, state\); again = true; return; \}/.test(src), 'order saves go one at a time, so the latest order lands last, and a queued change is kept in the browser at once');
ok(/developer site, which builds them/.test(read('js/whitepaper/ripeness.js')), 'without the data the section says where the lists live');

console.log(`ripeness: ${checks} checks passed`);
