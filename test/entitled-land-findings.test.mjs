// data/entitled-land/findings.json is the public summary of the members-only entitled land
// list, read by the daily audit email. It carries counts by region and one-line findings only:
// no site, address, person, phone or email. Run: node test/entitled-land-findings.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../data/entitled-land/findings.json', import.meta.url), 'utf8');
const d = JSON.parse(raw);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REGIONS = ['Front Range', 'Western Slope', 'Mountains', 'Southwest', 'San Luis Valley', 'Eastern Plains'];
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

ok(DATE.test(d.checked), 'summary has a checked date');
ok(/^https:\/\//.test(d.member_page), 'summary links the members page');
ok(JSON.stringify(d.regions.map((r) => r.region)) === JSON.stringify(REGIONS), 'counts cover the six COHO regions in order');
for (const r of d.regions) ok(['tier1', 'tier2', 'tier3'].every((k) => Number.isInteger(r[k]) && r[k] >= 0), `${r.region}: tier counts are whole numbers`);
const ids = new Set();
for (const f of d.findings) {
  ok(f.id && !ids.has(f.id), `unique finding id: ${f.id}`); ids.add(f.id);
  ok(DATE.test(f.first_seen), `${f.id}: first seen date`);
  ok(typeof f.significant === 'boolean', `${f.id}: significant flag`);
  ok(String(f.finding).length > 20, `${f.id}: one plain sentence`);
}
// Member value stays on the member site: nothing that names or reaches a site or a person.
ok(!/\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|[\w.+-]+@[\w-]+\.\w/.test(raw), 'no phone numbers or emails');
ok(!/\b\d{2,5} [NSEW]?\.? ?[A-Z][a-z]+ (St|Ave|Dr|Rd|Ln|Blvd|Way|Ct)\b/.test(raw), 'no street addresses');
ok(!/indibuild|pardoe|fruita/i.test(raw), 'no private-only material');
console.log(`entitled-land-findings: ${checks} checks passed`);
