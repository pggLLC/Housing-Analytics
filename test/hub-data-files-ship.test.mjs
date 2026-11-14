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

// Paths the hub scripts read: quoted strings under data/ or assets/ that name a file.
const hubDir = path.join(ROOT, 'hub');
const reads = new Map();
for (const f of fs.readdirSync(hubDir).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(hubDir, f), 'utf8');
  for (const m of src.matchAll(/['"]((?:data|assets)\/[A-Za-z0-9_./-]+\.(?:json|geojson|csv|html))['"]/g)) {
    if (!reads.has(m[1])) reads.set(m[1], f);
  }
}
check(reads.size > 20, 'found ' + reads.size + ' data files the hub scripts read');

const stopped = [...reads].filter(([p]) => isBlocked(p));
check(stopped.length === 0, 'no hub data file is on the public build\'s blocked list' +
  (stopped.length ? ': ' + stopped.map(([p, f]) => p + ' (read by hub/' + f + ')').join(', ') : ''));

// The case that broke: the county costs page's statewide construction pay file.
check(reads.has('data/co-housing-costs/qcew_construction_state.json'), 'hub/county-costs.js still reads the statewide construction pay file');
check(!isBlocked('data/co-housing-costs/qcew_construction_state.json'), 'the statewide construction pay file ships publicly');

// The public-artifact guard must not flag a file the build ships for a hub page.
const guard = fs.readFileSync(path.join(ROOT, 'scripts/audit/public-artifact-guard.mjs'), 'utf8');
check(!guard.includes("'data/co-housing-costs/qcew_construction_state.json'"), 'the public-artifact guard does not forbid the construction pay file');

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All hub data file checks passed');
