#!/usr/bin/env node
/**
 * Contract for scripts/market/build_project_teams.py, which reads CHFA application
 * narratives and credits architects and general contractors with funded / decided
 * applications for the gated dossiers. Runs the builder's pure functions on made-up
 * narrative text (no network):
 *   - a narrative splits into one application per "Project Name:" with its address and city;
 *   - firms are found by name, short initials match case only, and an EXCLUDE pair drops a
 *     mention that is not the project team;
 *   - an application matches the applicant report by street address before name, and an
 *     unmatched one is counted, never printed;
 *   - only 9% Round One and 2023-2025 Round Two applications with an outcome are decided;
 *   - every EXCLUDE firm is a known firm, and no firm pattern matches an empty string.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const py = String.raw`
import json, re, sys
sys.path.insert(0, 'scripts/market')
import build_project_teams as b
text = """cover page
Project Name: Sample Flats
Project Address: 120 West Pine Street, Example Town, CO 81000
Executive Summary: The architect, Shopworks Architecture, and the general contractor, Deneuve Construction,
bring LIHTC experience. A ratio of costs was reviewed. Kci built nothing here.
Project Name: Park Avenue Apartments
Project Address: 1 Park Avenue, Denver, CO 80205
Executive Summary: a University of Denver TID study with Shopworks Architecture. KTGY is the architect.
"""
apps = b.split_applications(text)
pool = [{'name': 'Sample Flats Apartments', 'address': '120 W. Pine St'}, {'name': 'Other', 'address': '9 Elm'}]
out = {
  'n': len(apps),
  'names': [a[0] for a in apps],
  'city': apps[0][2],
  'arch0': b.find_firms(b.ARCHITECTS, apps[0][3]),
  'gc0': b.find_firms(b.CONTRACTORS, apps[0][3]),
  'arch1': b.find_firms(b.ARCHITECTS, apps[1][3]),
  'match_addr': (b.match('Totally Different Name', '120 West Pine Street, Example Town, CO', pool) or {}).get('name'),
  'match_none': b.match('Nothing Alike', '5 Oak Road', pool),
  'decided': [b.decided(x) for x in [
     {'outcome': 'awarded', 'round': 1, 'credit_type': '9%', 'year': 2026},
     {'outcome': 'not_awarded', 'round': 2, 'credit_type': '4%', 'year': 2025},
     {'outcome': 'pending', 'round': 2, 'credit_type': '4%', 'year': 2026},
     {'outcome': 'awarded', 'round': 2, 'credit_type': '4%', 'year': 2026},
     {'outcome': 'awarded', 'round': None, 'credit_type': '4%', 'year': 2025}]],
  'excl_known': all(f in b.ARCHITECTS or f in b.CONTRACTORS for _, f in b.EXCLUDE),
  'empty_match': [k for t in (b.ARCHITECTS, b.CONTRACTORS) for k, p in t.items() if re.search(p, '')],
  'case_known': sorted(p for p in b.CASE_SENSITIVE if p not in set(b.ARCHITECTS.values()) | set(b.CONTRACTORS.values())),
  'min': b.MIN_TO_RANK,
  'rounds': sorted({(y, r) for y, r, _, _ in b.NARRATIVES}),
}
print(json.dumps(out))
`;
const r = JSON.parse(execFileSync('python3', ['-c', py], { cwd: ROOT, encoding: 'utf8' }));

ok(r.n === 2 && r.names[0] === 'Sample Flats', 'one application per Project Name');
ok(r.city === 'Example Town', 'the city comes from the project address');
ok(r.arch0.includes('Shopworks Architecture'), 'architect found by name');
ok(r.gc0.includes('Deneuve Construction Services'), 'contractor found by name');
ok(!r.arch0.includes('RATIO'), 'the word "ratio" is not the firm RATIO');
ok(!r.gc0.includes('Krische Construction (KCI)'), '"Kci" in running text is not KCI');
ok(r.arch1.includes('KTGY') && r.arch1.includes('Shopworks Architecture'), 'raw finder sees both firms');
ok(r.match_addr === 'Sample Flats Apartments', 'the street address matches before the name ("West" = "W.")');
ok(r.match_none === null, 'no match below the threshold');
assert.deepEqual(r.decided, [true, true, false, false, false]); checks++;
ok(r.excl_known, 'every EXCLUDE firm is a known firm');
assert.deepEqual(r.empty_match, []); checks++;
assert.deepEqual(r.case_known, []); checks++;
ok(r.min === 3, 'firms need 3 decided applications to be ranked');
assert.deepEqual(r.rounds, [[2023, 1], [2023, 2], [2024, 1], [2024, 2], [2025, 1], [2025, 2], [2026, 1]]); checks++;

const src = readFileSync(join(ROOT, 'scripts/market/build_project_teams.py'), 'utf8');
ok(/Park Avenue', 'Shopworks Architecture'/.test(src), 'the design-study mention is excluded');
ok(/unmatched\.append\(label\)/.test(src), 'an unmatched narrative is counted by round, not by name');
ok(/keep\(name, city\)/.test(src) && /keep\(a\['name'\]/.test(src), 'private projects are dropped before and after matching');
ok(!/'unmatched':/.test(src), 'unmatched names are not written to the output');

console.log(`project-teams: ${checks} checks passed`);
