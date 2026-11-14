// Every data file a hub page reads must ship in the public build.
//
// The hub pages (hub/*.js) fetch their data by relative path. If that path is on
// scripts/build-public-site.mjs's BLOCKED_PATHS list, the file is left out of
// cohoanalytics.com and of the member bundle built from it, and the page shows
// "The data did not load". That happened to Places > Housing costs by county
// (#/places/county-costs), which reads data/co-housing-costs/qcew_construction_state.json.
//
// Run: node test/hub-data-files-ship.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

function stringList(src, name) {
  const start = src.indexOf('const ' + name + ' = [');
  if (start < 0) throw new Error(name + ' not found');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const build = fs.readFileSync(path.join(ROOT, 'scripts/build-public-site.mjs'), 'utf8');
const blocked = stringList(build, 'BLOCKED_PATHS');
check(blocked.length > 10, 'read ' + blocked.length + ' blocked paths from the public build');

const isBlocked = (p) => blocked.some((b) => p === b || p.startsWith(b + '/'));

// Paths the hub scripts read:
// 1. quoted strings under data/ or assets/ that name a file;
// 2. a file joined to a folder held in a variable (var SNAP = 'assets/x/'; SNAP + 'y.csv');
// 3. folders a script builds file names under at run time ('data/hna/' + geoid + '.json'):
//    the folder itself must not be blocked.
const FILE = /\.(?:json|geojson|csv|html)$/;
const hubDir = path.join(ROOT, 'hub');
const reads = new Map();
const folders = new Map();
for (const f of fs.readdirSync(hubDir).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(hubDir, f), 'utf8');
  for (const m of src.matchAll(/['"]((?:data|assets)\/[A-Za-z0-9_./-]+\.(?:json|geojson|csv|html))['"]/g)) {
    if (!reads.has(m[1])) reads.set(m[1], f);
  }
  const prefixes = {};
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]((?:data|assets)\/[A-Za-z0-9_./-]*\/)['"]/g)) {
    prefixes[m[1]] = m[2];
    if (!folders.has(m[2])) folders.set(m[2], f);
  }
  for (const [name, dir] of Object.entries(prefixes)) {
    const join = new RegExp('\\b' + name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '\\s*\\+\\s*[\'"]([A-Za-z0-9_./-]+)[\'"]', 'g');
    for (const m of src.matchAll(join)) {
      if (FILE.test(m[1]) && !reads.has(dir + m[1])) reads.set(dir + m[1], f);
    }
  }
  for (const m of src.matchAll(/['"]((?:data|assets)\/[A-Za-z0-9_./-]*\/)['"]\s*\+/g)) {
    if (!folders.has(m[1])) folders.set(m[1], f);
  }
}
check(reads.size > 20, 'found ' + reads.size + ' data files the hub scripts read');
check(folders.size > 0, 'found ' + folders.size + ' data folders the hub scripts build file names under');

const stopped = [...reads].filter(([p]) => isBlocked(p));
check(stopped.length === 0, 'no hub data file is on the public build\'s blocked list' +
  (stopped.length ? ': ' + stopped.map(([p, f]) => p + ' (read by hub/' + f + ')').join(', ') : ''));

const stoppedDirs = [...folders].filter(([d]) => isBlocked(d.replace(/\/$/, '')));
check(stoppedDirs.length === 0, 'no folder a hub script reads from is on the blocked list' +
  (stoppedDirs.length ? ': ' + stoppedDirs.map(([d, f]) => d + ' (read by hub/' + f + ')').join(', ') : ''));

// The public-artifact guard fails the build on any path on its FORBIDDEN_PATHS list, so that
// list must not name a file or folder a hub page reads either.
const guard = fs.readFileSync(path.join(ROOT, 'scripts/audit/public-artifact-guard.mjs'), 'utf8');
const guarded = stringList(guard, 'FORBIDDEN_PATHS').map((g) => g.replace(/\/$/, ''));
check(guarded.length > 10, 'read ' + guarded.length + ' paths from the public-artifact guard\'s forbidden list');
const hits = (p) => guarded.some((g) => p === g || p.startsWith(g + '/'));
const flagged = [...reads.keys(), ...[...folders.keys()].map((d) => d.replace(/\/$/, ''))].filter(hits);
check(flagged.length === 0, 'the public-artifact guard forbids no file or folder a hub page reads' +
  (flagged.length ? ': ' + flagged.join(', ') : ''));

// A folder a hub script builds names under at run time ('data/hna/summary/' + geoid + '.json')
// can ask for any file in it, so neither list may hold out a file or folder beneath it.
const runFolders = [...folders.keys()];
const beneath = (p) => runFolders.filter((d) => p.startsWith(d) && p.length > d.length);
const heldOut = [...blocked.map((b) => ['the public build', b]), ...guarded.map((g) => ['the public-artifact guard', g])]
  .flatMap(([list, p]) => beneath(p).map((d) => p + ' (on ' + list + '; hub/' + folders.get(d) + ' reads ' + d + ')'));
check(heldOut.length === 0, 'nothing beneath a folder a hub script reads at run time is held out of the build' +
  (heldOut.length ? ': ' + heldOut.join(', ') : ''));

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All hub data file checks passed');
