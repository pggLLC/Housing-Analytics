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
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const AWARDS = 'https://www.chfainfo.com/rental-housing/housing-credit/awards';
const QAP = 'https://www.chfainfo.com/getattachment/7535845e-c0fa-4061-9bcb-60d7158ea294/2025-2026-QAP-Second-Amendment.pdf';

// 9% round: the word used for the odds must agree with the counts it quotes.
const cell = guide.match(/<td>Competitive annual QAP round at CHFA;[^\n]*<\/td>/);
assert(cell, 'guide has the 9% allocation-process cell');
assert(hrefs(cell[0]).some((h) => h === AWARDS), '9% odds link CHFA award reports');
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
assert(hrefs(insp).some((h) => h === QAP) && insp.includes('§11.C'), 'inspection cadence cites QAP §11.C');
assert(/at least once every three years/.test(insp), 'states the QAP cadence');
assert(!/Annual state inspections|REAC every/.test(insp), 'no annual-inspection or REAC claim');
const exit = li('Investor exit');
assert(hrefs(exit).some((h) => h === QAP) && exit.includes('§10'), 'qualified-contract claim cites QAP §10');
const prio = li('Priority populations');
assert(hrefs(prio).some((h) => h === QAP) && prio.includes('§2.A'), 'priorities cite QAP §2.A');
assert(!/veterans|resort/i.test(prio), 'no priority the QAP does not name');

// AHCIA homes figure: dated source, and it says the estimate predates the enacted part.
const ahcia = read('lihtc-enhancement-ahcia.html');
const stat = ahcia.match(/<p class="num">([^<]+)<\/p>\s*<p class="lbl">([\s\S]*?)<\/p>/g).find((s) => /homes/.test(s));
assert(stat, 'AHCIA page has the homes stat');
// The source fact lives here, outside the page, so changing the page alone
// cannot make it agree: ACTION Campaign national fact sheet, updated October
// 2026: "Up to 1,589,100 additional affordable homes could be financed".
const ACTION = {
  url: 'https://rentalhousingaction.org/wp-content/uploads/2026/10/ACTION-NATIONAL-OCT-2026.pdf',
  homes: 1589100,
};
assert(hrefs(stat).some((h) => h === ACTION.url), 'homes figure links the dated ACTION fact sheet');
const shownNum = stat.match(/<p class="num"[^>]*>[^<\d]*([\d,]+)/);
assert(shownNum, 'homes stat shows a number');
assert.equal(Number(shownNum[1].replace(/,/g, '')), ACTION.homes, `homes figure ${shownNum[1]} is the ACTION fact sheet's total`);
const law = JSON.parse(read('data/policy/tax-credit-legislation.json'));
assert(JSON.stringify(law).includes('119-21') && stat.includes('Public Law 119-21'), 'caveat names the law the watch file records as enacted');
// CRA: being inside a bank's assessment area is about place, not whether the
// investment qualifies. Until 2026-10-22 the deal team page said an investment
// there "counts without argument". What every claim must agree with is the
// definition the section's own source line quotes from 12 CFR 228.12(t): a
// qualified investment has community development as its primary purpose. So
// each sentence saying an investment counts or qualifies (quoted rule text
// aside) must carry that purpose and a condition, however it is worded.
const team = read('affordable-deal-team.html');
const craSection = team.match(/<section id="dt-cra"[\s\S]*?<\/section>/);
assert(craSection, 'deal team page has the CRA section');
const craText = craSection[0].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const definition = craText.match(/228\.12\(t\)[^.]*"as its primary purpose (community development)"/);
assert(definition, 'the CRA section quotes the 228.12(t) qualified-investment definition');
const claims = craText.split(/(?<=[.;?!]"?)\s+/)
  .map((sentence) => sentence.replace(/"[^"]*"/g, '""'))
  .filter((sentence) => !sentence.endsWith('?'))
  .filter((sentence) => /\b(investments?|projects?)\b[^.;]*\b(counts?|qualif(y|ies|ied|ying))\b/i.test(sentence)
    || /\b(investments?|projects?)\b[^.;]*\b(earns?|gets?|receives?|wins?|is given)\b[^.;]*\bcredit\b/i.test(sentence));
assert(claims.length >= 3, `scan found ${claims.length} CRA credit claims`);
// The definition ties community development to the primary purpose, so each
// claim must state that relationship, not just name the category.
const primaryPurpose = new RegExp(`primary purpose\\b[^.;,]{0,20}\\b${definition[1]}`, 'i');
claims.forEach((claim) => {
  assert(primaryPurpose.test(claim), `CRA claim requires community development as the primary purpose: ${claim}`);
  assert(/\b(if|whether|depends|unless|when|provided|as long as|so long as)\b/i.test(claim), `CRA claim states its condition: ${claim}`);
});
console.log(`lihtc-practice-claims: PASS (${rounds.length} rounds checked)`);
