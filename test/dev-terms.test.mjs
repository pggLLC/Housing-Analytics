// The developer site's own words (signal, ripeness, IOI, tiers) carry a plain
// definition as a tooltip at first use (paul, 2026-10-21: "terms such as signal
// and ripening need definitions"). Every term a developer page or script marks
// must have a definition, or the mark silently shows nothing.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DEV = require('../js/whitepaper/dev-terms.js');
let n = 0;
function ok(c, msg) { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } n++; }

const glossary = readFileSync('js/components/inline-glossary.js', 'utf8');
const files = ['developer.html', 'developer-pipeline.html', 'developer-where.html', 'developer-brief.html',
  'js/whitepaper/place-card.js', 'js/whitepaper/ripeness.js'];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const marks = [...src.matchAll(/data-glossary="([^"']+)"/g)].map((m) => m[1]);
  for (const t of marks) ok(DEV[t] || DEV[t.toLowerCase()] || glossary.includes(`'${t}':`), `${f} marks "${t}", which has a definition`);
  if (f.endsWith('.html')) ok(src.indexOf('js/whitepaper/dev-terms.js') > src.indexOf('js/components/inline-glossary.js') && src.includes('js/components/inline-glossary.js'),
    `${f} loads dev-terms.js after the glossary`);
}
// Each ripeness label the cards print is defined.
const LABEL = { ripe: 'Ripe', ripening: 'Ripening', on_file: 'Site on file', not_yet: 'Not yet', all_taken: 'No open site', none: 'No site on file' };
for (const v of Object.values(LABEL)) ok(DEV[v], `the "${v}" badge has a definition`);
for (const f of ['js/whitepaper/place-card.js', 'js/whitepaper/ripeness.js']) ok(readFileSync(f, 'utf8').includes("var LABEL = { ripe: 'Ripe', ripening: 'Ripening', on_file: 'Site on file', not_yet: 'Not yet', all_taken: 'No open site', none: 'No site on file' };"), `${f} prints the labels defined here`);
// Signal strength definitions follow the Pipeline method's rules.
ok(/60 days/.test(DEV['strong signal']) && /30 to 90 days/.test(DEV['moderate signal']), 'signal strengths match the Pipeline method');
ok(/seven questions/.test(DEV.ripeness), 'ripeness names the seven readiness questions');
// A tap opens a term on a phone, and the bubble stays on screen there.
ok(glossary.includes("el.addEventListener('click', function () { el.focus(); });") && glossary.includes('@media (max-width: 600px)'), 'tooltips open on tap and stay on a phone screen');
ok(!readFileSync('js/whitepaper/dev-terms.js', 'utf8').includes('.decorate(root.document)'), 'dev-terms decorates its marks only, not a second automatic scan');
console.log(`dev-terms: ${n} checks passed`);
