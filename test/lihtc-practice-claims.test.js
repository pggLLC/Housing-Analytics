/**
 * The LIHTC guide's practice claims (9% round odds, inspections, investor exit,
 * QAP priorities) and the AHCIA page's homes figure must each carry their source
 * and agree with it. Until 2026-10-17 the guide said "~1 in 3 applications
 * funded" (CHFA's own reports show about half), "annual state inspections, REAC
 * every 3 years" (CHFA inspects at least every three years; REAC is gone), and
 * listed QAP priorities the QAP does not name.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const guide = read('lihtc-guide-for-stakeholders.html');
const QAP = 'https://www.chfainfo.com/getattachment/7535845e-c0fa-4061-9bcb-60d7158ea294/2025-2026-QAP-Second-Amendment.pdf';

// 9% round: the word used for the odds must agree with the counts it quotes.
const cell = guide.match(/<td>Competitive annual QAP round at CHFA;[^\n]*<\/td>/);
assert(cell, 'guide has the 9% allocation-process cell');
assert(cell[0].includes('https://www.chfainfo.com/rental-housing/housing-credit/awards'), '9% odds link CHFA award reports');
const rounds = [...cell[0].matchAll(/(\d+) of (\d+) in (20\d\d)/g)];
assert(rounds.length >= 3, `scan found ${rounds.length} rounds`);
const ratios = rounds.map((m) => Number(m[1]) / Number(m[2]));
const word = /\bhalf\b/.test(cell[0]) ? [0.4, 0.65] : /\b(1 in 3|a third)\b/.test(cell[0]) ? [0.25, 0.4] : null;
assert(word, 'the cell states the odds in words');
ratios.forEach((r, i) => assert(r >= word[0] && r <= word[1], `${rounds[i][3]}: ${rounds[i][0]} does not fit the stated odds`));

// Inspections, exit and priorities each cite the current QAP section they paraphrase.
const li = (label) => {
  const m = guide.match(new RegExp(`<li><strong>${label}:</strong>[\\s\\S]*?</li>`));
  assert(m, `guide has the ${label} item`);
  return m[0];
};
const insp = li('Physical Inspections');
assert(insp.includes(QAP) && insp.includes('§11.C'), 'inspection cadence cites QAP §11.C');
assert(/at least once every three years/.test(insp), 'states the QAP cadence');
assert(!/Annual state inspections|REAC every/.test(insp), 'no annual-inspection or REAC claim');
const exit = li('Investor exit');
assert(exit.includes(QAP) && exit.includes('§10'), 'qualified-contract claim cites QAP §10');
const prio = li('Priority populations');
assert(prio.includes(QAP) && prio.includes('§2.A'), 'priorities cite QAP §2.A');
assert(!/veterans|resort/i.test(prio), 'no priority the QAP does not name');

// AHCIA homes figure: dated source, and it says the estimate predates the enacted part.
const ahcia = read('lihtc-enhancement-ahcia.html');
const stat = ahcia.match(/<p class="num">([^<]+)<\/p>\s*<p class="lbl">([\s\S]*?)<\/p>/g).find((s) => /homes/.test(s));
assert(stat, 'AHCIA page has the homes stat');
assert(stat.includes('rentalhousingaction.org/wp-content/uploads/2026/10/'), 'homes figure links the dated ACTION fact sheet');
const law = JSON.parse(read('data/policy/tax-credit-legislation.json'));
assert(JSON.stringify(law).includes('119-21') && stat.includes('Public Law 119-21'), 'caveat names the law the watch file records as enacted');
console.log(`lihtc-practice-claims: PASS (${rounds.length} rounds checked)`);
