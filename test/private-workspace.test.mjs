// The developer's private working files (network contacts, pipeline, signal log,
// anti-targets, outreach templates) are read at run time on the gated site and
// shown on the working screens only. This pins:
//   1. reading: a 404 page is "unreachable", never an empty pipeline; the notes
//      rows at the foot of the network file are not contacts;
//   2. an unreadable file counts as null, never 0;
//   3. per-place lookup, related places, the 30-day list and the kanban columns;
//   4. privacy agreement: the folder the module reads is the folder the public
//      build excludes, the public-artifact guard blocks and git ignores, and the
//      report module never touches it;
//   5. every gated page that uses the module loads it and keeps it out of print.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PW = require(path.join(ROOT, 'js/components/private-workspace.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

// Synthetic files in the private schema. No real contact appears here.
const NETWORK = [
  'jurisdiction,geoid,name,role,org,email,phone,last_talked,relationship_tier,notes',
  'Gunnison,0833640,Test Person,Planning Director,City of Gunnison,t@example.org,970-555-0100,2026-09-01,2,"Met at, the forum"',
  'Gunnison,0833640,Second Person,City Manager,City of Gunnison,,,never,3,',
  'Gunnison County,08051,County Person,County Manager,Gunnison County,,,never,3,',
  ',,,,,,,,,',
  'INSTRUCTIONS:,Populate with real contacts only.,,,,,,,,relationship_tier: 1=strong'
].join('\n');
const PIPELINE = [
  'jurisdiction,geoid,stage,ioi_score,confidence,classification,product_type,last_update,next_action,next_action_due,notes',
  'Gunnison,0833640,Outreach,71,medium,B,9% LIHTC,2026-10-01,Call the planning director,2026-10-10,',
  'Salida,0867280,Monitor,64,low,C,,2026-09-01,Check council agenda,2026-12-01,',
  'Durango,0822035,Weird,60,low,C,,2026-09-01,,,'
].join('\n');
const SIGNALS = [
  'date,jurisdiction,geoid,source,source_url,signal_type,summary,strength,opportunity_implication,follow_up_action,contact_name,contact_role,contact_path,outreach_template,talking_point,next_review_date,evidence_status,status',
  '2026-10-05,Gunnison,0833640,Council,https://example.org/a,Land,Council discussed land,strong,,Ask about the parcel,,,,,,2026-10-20,,open',
  '2026-06-01,Gunnison,0833640,News,https://example.org/b,Funding,Old item,strong,,,,,,,,,,open'
].join('\n');
const ANTI = 'jurisdiction,geoid,date_dropped,reason,revisit_date,notes\nParker,0857630,2026-05-01,No land,2026-10-25,';
const TEMPLATES = 'template_name,use_case,recipient_role,subject,body,notes_for_personalization\nIntro,First contact,Planning Director,Hello,Body text,Name the plan';
const FILES = { '01-signal-log.csv': SIGNALS, '02-pipeline.csv': PIPELINE, '03-anti-targets.csv': ANTI, '04-network.csv': NETWORK, '05-outreach-templates.csv': TEMPLATES };
const fromMap = (map) => (url) => Promise.resolve(Object.prototype.hasOwnProperty.call(map, url.slice(PW.BASE.length)) ? map[url.slice(PW.BASE.length)] : null);
const TODAY = new Date(2026, 9, 15);

// 1. Reading.
ok(PW.toObjects('<!doctype html><html><body>Not found</body></html>', 'relationship_tier') === null, 'an HTML page served in place of a file reads as unreachable');
const net = PW.toObjects(NETWORK, 'relationship_tier');
ok(net.length === 3 && net.every((r) => /^08\d{3}(\d{2})?$/.test(r.geoid)), 'the blank and instruction rows at the foot of the network file are not contacts');
ok(net[0].notes === 'Met at, the forum', 'a quoted field with a comma survives');
ok(PW.toObjects(NETWORK.replace(/\n,,,,,,,,,/, '\nX,0833640x,,,,,,,,'), 'relationship_tier').length === 3, 'sabotage: a malformed GEOID is dropped too');

const ws = await PW.load(fromMap(FILES));
ok(ws.reachable && Object.values(ws.files).every((v) => Array.isArray(v)), 'all five files load');
const none = await PW.load(() => Promise.resolve('<!doctype html><title>404</title>'));
ok(!none.reachable && Object.values(none.files).every((v) => v === null), 'a site without the files reads every file as unreachable');
const thrown = await PW.load(() => Promise.reject(new Error('offline')));
ok(!thrown.reachable, 'a failed fetch reads as unreachable, not as an error');

// 2. Null, never 0.
const noStats = PW.stats(none, [], TODAY);
ok(Object.values(noStats).every((v) => v === null), 'with no files every count is null, never 0');
const someStats = PW.stats(ws, PW.mergedPipeline(ws, null), TODAY);
ok(someStats.pipeline === 3 && someStats.contacts === 3 && someStats.strong30 === 1 && someStats.anti === 1 && someStats.inConversation === 1, 'counts come from the files');
const partial = await PW.load(fromMap({ '02-pipeline.csv': PIPELINE }));
ok(PW.stats(partial, PW.mergedPipeline(partial, null), TODAY).contacts === null, 'a missing network file counts null while the pipeline still counts');

const onlyNet = await PW.load(fromMap({ '04-network.csv': NETWORK }));
const draftOnly = { merge: () => [{ jurisdiction: 'Ouray', geoid: '0856145', stage: 'Screen', _isDraft: true }] };
const dst = PW.stats(onlyNet, PW.mergedPipeline(onlyNet, draftOnly), TODAY);
ok(dst.pipeline === null && dst.inConversation === null && dst.contacts === 3, 'a site draft does not turn an unreadable pipeline file into a count');

// 3. Per place, related places, due list, columns.
const pipe = PW.mergedPipeline(ws, null);
const g = PW.forPlace(ws, pipe, '0833640', ['08051']);
ok(g.own.network.length === 2 && g.own.pipeline.stage === 'Outreach' && g.own.signals[0].date === '2026-10-05', 'a town gets its own contacts, pipeline record and newest signal first');
ok(g.related.length === 1 && g.related[0].name === 'Gunnison County' && g.related[0].network.length === 1, 'its county\'s contacts come labelled as the county\'s');
ok(PW.forPlace(ws, pipe, '0833640', []).related.length === 0, 'sabotage: with no related GEOIDs nothing is borrowed');
ok(PW.forPlace(ws, pipe, '0857630', []).own.anti.reason === 'No land', 'a set-aside place shows why');

const due = PW.dueWithin(ws, pipe, TODAY, 30);
ok(due[0].geoid === '0833640' && due[0].days === -5 && due[0].kind === 'Pipeline', 'a late action comes first, with its days late');
ok(due.some((d) => d.kind === 'Signal review') && due.some((d) => d.kind === 'Revisit'), 'signal reviews and set-aside revisits are on the list');
ok(!due.some((d) => d.geoid === '0867280'), 'an action more than 30 days out is not');

const cols = PW.columns(pipe);
ok(cols.find((c) => c.key === 'Screen').rows.some((r) => r.geoid === '0867280'), 'Monitor folds into Screen');
ok(cols.some((c) => c.key === 'Weird' && c.rows.length === 1), 'an unknown stage gets its own column instead of vanishing');
ok(cols.reduce((n, c) => n + c.rows.length, 0) === pipe.length, 'every pipeline row lands in exactly one column');

// The site's drafts and edits merge over the file.
const store = {
  merge(canon) {
    return canon.map((r) => (r.geoid === '0822035' ? Object.assign({}, r, { _queuedForDelete: true }) : r))
      .concat([{ jurisdiction: 'Ouray', geoid: '0856145', stage: 'Signal', _isDraft: true }]);
  }
};
const merged = PW.mergedPipeline(ws, store);
ok(merged.some((r) => r.geoid === '0856145' && r._isDraft) && !merged.some((r) => r.geoid === '0822035'), 'a place added on the site appears and one queued for deletion does not');

// 4. Privacy agreement: one folder, excluded everywhere it must be.
const folder = PW.BASE.replace(/\/$/, '');
ok(read('scripts/build-public-site.mjs').includes(`'${folder}'`), 'the public build excludes the folder the module reads');
ok(read('scripts/audit/public-artifact-guard.mjs').includes(`'${folder}/'`), 'the public-artifact guard blocks it');
for (const f of ['scripts/build-public-site.mjs', 'scripts/audit/public-artifact-guard.mjs']) {
  ok(read(f).includes("'js/components/private-workspace.js'"), `${f} keeps the module itself off the public site`);
}
ok(read('.gitignore').split('\n').includes(folder + '/'), 'git ignores it, so the files cannot be committed by accident');
for (const f of ['js/whitepaper/jurisdiction-whitepaper.js', 'scripts/whitepaper/build-whitepaper.mjs']) {
  const src = read(f);
  ok(!src.includes(folder) && !src.includes('PrivateWorkspace') && !src.includes('private-workspace'), `${f} never reads the private files, so the report and its PDF cannot carry them`);
}

// 5. Pages: load the module before using it; the brief keeps the panel out of the report and out of print.
for (const page of ['developer.html', 'developer-pipeline.html', 'developer-brief.html']) {
  const html = read(page);
  const at = html.indexOf('js/components/private-workspace.js');
  const use = html.indexOf('window.PrivateWorkspace');
  ok(at !== -1 && use > at, `${page} loads private-workspace.js before it uses it`);
}
const brief = read('developer-brief.html');
ok(/@media print[\s\S]*?\.ib-private\s*\{\s*display:none/.test(brief), 'the brief hides the private panel in print');
ok(/html = WP\.renderHtml\(model\);/.test(brief) && /frame\.srcdoc = html;/.test(brief) && !/buildModel\([^)]*WS/.test(brief), 'the report frame and download are built from the report model alone');
ok(brief.indexOf('privateSection(name, geoid, related)') < brief.indexOf('<iframe id="reportFrame"'), 'your notes sit above the report, outside its frame');
const home = read('developer.html');
ok(/n === null \? '—'/.test(home), 'Home shows a dash for an unreadable count, never 0');

console.log(`private-workspace: PASS (${checks} checks)`);
