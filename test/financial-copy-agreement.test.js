'use strict';
// #2120: prose agrees with the rent module, live file tree and stored QAP.
// All numeric fixtures below are invented; no client/project records are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(f => f && fs.existsSync(path.join(ROOT, f)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const mode = process.argv[2];
function plain(source, html) {
  if (!html) return source.replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const dom = new JSDOM(source);
  const doc = dom.window.document;
  const comments = [];
  const walker = doc.createTreeWalker(doc, dom.window.NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode.data);
  const text = doc.documentElement.textContent + ' ' + comments.join(' ');
  dom.window.close();
  return text.replace(/\s+/g, ' ');
}
function falseRentClaims(text) {
  // Detect the claim, not a prescribed replacement sentence. Negated claims
  // ("FMR does not set...") and comparisons between distinct measures are valid.
  const predicates = [
    /\b(?:FMR|Fair Market Rents?)\s+(?:(?:directly|also)\s+)?(?:sets?|caps?|determines?|establishes?|controls?|defines?|limits?)\b[^.!?]{0,90}\bLIHTC\b/gi,
    /\b(?:FMR|Fair Market Rents?)\s+(?:is|are)\s+(?:the\s+)?LIHTC\s+(?:gross\s+)?rent\s+(?:cap|limit|ceiling)/gi,
    /\bLIHTC\s+(?:gross\s+)?rent\s+(?:caps?|limits?|ceilings?)\s+(?:(?:is|are)\s+)?(?:set|capped|determined|established|based)\s+(?:by|at|on|from)\s+(?:HUD\s+)?(?:FMR|Fair Market Rents?)\b/gi,
    /\bLIHTC\s+(?:gross\s+)?rents?\s+(?:(?:is|are)\s+)?(?:set|capped|limited|determined)\s+(?:by|at|to)\s+(?:HUD\s+)?(?:FMR|Fair Market Rents?)\b/gi,
    /\b(?:over[- ]FMR\s+rent|FMR[- ]adjusted\s+rent|FMR\s+caps?[^.!?]{0,50}LIHTC)\b/gi,
    /\b(?:below|at or below)\s+(?:HUD\s+)?FMR[^.!?]{0,65}LIHTC\s+rent\s+cap\s+(?:doesn't|does not)\s+bind/gi,
  ];
  return predicates.flatMap(re => [...text.matchAll(re)].map(m => m[0]));
}
if (!mode || mode === '--rent') {
  const limits = require('../js/chfa-rent-limits.js');
  const table = { meta: { fiscal_year: 2090 }, counties: [{ fips: '08999',
    regular_tiers: { '60': { max_rents: { '0br': 801, '1br': 987, '2br': 1357 } } } }] };
  const gross = limits.maxGrossRent(table, '08999', 60, '2BR');
  assert.equal(gross.grossRent, 1357, 'copy authority: js/chfa-rent-limits.js reads the published table, not FMR');
  assert.equal(gross.familySize, 3);
  assert.equal(limits.maxGrossRent(table, '08999', 60, 'efficiency').familySize, 1);
  assert.equal(limits.maxContractRent({ grossRent: gross.grossRent, utilityAllowance: 123, fees: 17 }).contractRent, 1217);
  // Invented wording variants demonstrate semantic coverage across markup/lines.
  for (const claim of ['FMR sets the LIHTC rent cap.', 'HUD FMR caps LIHTC rents.',
    'LIHTC rent limits are based on FMR.', 'LIHTC rents are capped by HUD FMR.', '<p>Fair Market Rent <b>determines</b> LIHTC rents.</p>']) {
    assert(falseRentClaims(plain(claim, true)).length, claim);
  }
  for (const wording of ['FMR is a voucher comparison, not a LIHTC limit.',
    'FMR does not set LIHTC rents. CHFA publishes the income-based limits.']) {
    assert.equal(falseRentClaims(wording).length, 0);
  }
  const scanned = files.filter(f => /\.(html|md)$/.test(f));
  assert(scanned.filter(f => f.endsWith('.html')).length >= 50);
  assert(scanned.filter(f => f.endsWith('.md')).length >= 500);
  const bad = scanned.flatMap(f => falseRentClaims(plain(read(f), f.endsWith('.html'))).map(claim => `${f}: ${claim}`));
  assert.deepEqual(bad, [], 'Rent claims must agree with js/chfa-rent-limits.js:\n' + bad.join('\n'));
  console.log(`rent copy: ${scanned.length} HTML/docs checked against js/chfa-rent-limits.js`);
}
if (!mode || mode === '--links') {
  const docs = files.filter(f => /\.(md|mdx)$/.test(f));
  assert(docs.length >= 500);
  let checked = 0;
  const broken = [];
  for (const f of docs) {
    const source = read(f);
    // Inline links, reference-link definitions, autolinks, and HTML hrefs.
    const targets = [...source.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?|<((?:\.?\.?\/)?(?:js|test|tests|scripts)\/[^>]+)>|href=["']([^"']+)["']/gm)]
      .map(m => m[1] || m[2] || m[3] || m[4]);
    for (const target of targets) {
      if (/^[a-z][\w+.-]*:/i.test(target)) continue;
      const local = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!/\.(js|mjs|cjs|py)$/.test(local)) continue;
      checked++;
      const resolved = local.startsWith('/') ? path.join(ROOT, local) : path.resolve(ROOT, path.dirname(f), local);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) broken.push(`${f} -> ${target}`);
    }
  }
  assert(checked > 20, 'non-empty live module/test link scan');
  assert.deepEqual(broken, [], 'Documentation code links must resolve:\n' + broken.join('\n'));
  console.log(`doc links: ${docs.length} docs scanned, ${checked} module/test links resolved`);
}
if (!mode || mode === '--qap') {
  const stored = JSON.parse(read('data/audit/chfa-qap-watch.json'));
  // Citation-to-heading agreement, with the QAP edition explicitly named.
  // New citations must declare the heading they mean; an existing number such
  // as 6.C (a fee) cannot stand in for an invented geographic-award rule.
  const citations = {
    '3.B.2': { title: '2027-28 QAP - Third Draft (PDF)', section: '3.B.2', heading: 'Application Dates and Available Credit' },
    '3.L': { title: '2027-28 QAP - Third Draft (PDF)', section: '3.L', heading: 'Maximum Credit Award' },
    '5.B.2.b': { title: '2025-26 QAP Second Amendment (PDF)', section: '5.B', heading: 'Secondary Selection Criteria',
      subheading: '2. Project Location', paragraph: 'b.', subject: 'TOD' },
  };
  const clients = files.filter(f => f.startsWith('js/') && f.endsWith('.js') && !f.startsWith('js/vendor/'));
  assert(clients.length >= 250);
  let checked = 0;
  const errors = [];
  for (const f of clients) {
    const src = read(f);
    for (const m of src.matchAll(/\bQAP\b[^;\n]{0,110}?§\s*(\d+(?:\.[a-zA-Z0-9]+)*)/g)) {
      checked++;
      const key = Object.keys(citations).find(k => k.toLowerCase() === m[1].toLowerCase()) || m[1];
      const expected = citations[key];
      if (!expected) { errors.push(`${f}: QAP §${key} has no verified section-heading binding`); continue; }
      const document = stored.documents.find(d => d.title === expected.title);
      assert(document && document.text && document.text.length > 10000, 'stored full QAP must exist');
      const escaped = expected.section.replace(/\./g, '\\.');
      const match = document.text.match(new RegExp('^' + escaped + '\\s*\\n([^\\n]+)([\\s\\S]*?)(?=^\\d+\\.[A-Z]\\s*$|$(?![\\s\\S]))', 'm'));
      if (!match || match[1].trim() !== expected.heading) {
        errors.push(`${f}: QAP §${key} heading disagrees with ${expected.title}`); continue;
      }
      if (expected.subheading) {
        const sectionText = (match[1] + match[2]).replace(/\s+/g, ' ');
        const start = sectionText.indexOf(expected.subheading);
        const end = sectionText.indexOf('3. Project Characteristics', start);
        const subsection = start < 0 || end < 0 ? '' : sectionText.slice(start, end);
        assert(subsection.includes(expected.paragraph) && subsection.includes(expected.subject), `${f}: nested citation not present under ${expected.subheading}`);
      }
    }
  }
  assert(checked >= 3, 'existing client citations must be checked, not an empty scan');
  assert.deepEqual(errors, [], 'QAP citations must agree with stored headings:\n' + errors.join('\n'));
  console.log(`QAP citations: ${clients.length} client scripts scanned, ${checked} citations checked against stored QAP text`);
}
