// The public repo must never hold the developer gate's private material.
// Housing-Analytics is public: every tracked file, and every file in its git
// history, is readable on github.com even when the Pages build leaves it out.
// Named contacts, pipeline CSVs, dossiers, partnership terms, call sheets,
// saved deals and uploaded drafts live only in the private coho-backend repo.
// This test fails if any of them, or text that only they carry, is tracked here.
// Run: node test/repo-private-data.test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPrivateTerms } from '../scripts/lib/private-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Paths that are private wherever they appear.
const PRIVATE_PATHS = [
  { label: 'named contacts (coho-backend gated/)', re: /^data\/jurisdiction-briefs\/_(contacts|landscape)\// },
  { label: 'named contacts (coho-backend gated/)', re: /^data\/jurisdiction-briefs\/[^/]*contacts[^/]*\.(json|csv)$/i },
  { label: 'contact export (coho-backend gated/)', re: /(^|\/)[^/]*contacts?[^/]*\.(csv|tsv|xlsx|xls|json)$/i },
  { label: 'private pipeline files (coho-backend docs/)', re: /^docs\/(developer|indibuild)-pipeline-prototype\// },
  { label: 'coho-backend folder', re: /(^|\/)(gated|dossiers|ripeness|private|internal)\// },
  { label: 'readiness readings built from dossiers (coho-backend build)', re: /^data\/ripeness\.json$/ },
  { label: 'dossier, partnership terms or call sheet', re: /(^|\/)[^/]*(dossier|partnership-terms|call-sheet|seller-ask|term-sheet)[^/]*\.(md|json|csv|docx|pdf|html|txt)$/i },
  { label: 'saved deal or uploaded draft', re: /(^|\/)(saved-deals|deal-versions|submittal-uploads|uploads)\// },
  { label: 'office document (keep drafts and dossiers in coho-backend)', re: /\.(docx|doc|pptx|xlsm)$/i }
];
// Text that only private material carries.
const PRIVATE_TEXT = [
  { label: 'contact CSV header', re: /^\W*name\W*,[^\n]*\bemail\b[^\n]*\bphone\b/im },
  // A JSON file whose records carry both email and phone keys is a contact
  // list, whatever it is named (public agency lists, if ever added, go in ALLOWED).
  { label: 'JSON contact records (email + phone)', re: /"from_award_lists"\s*:|"email"\s*:[\s\S]*"phone"\s*:|"phone"\s*:[\s\S]*"email"\s*:/, ext: /\.json$/i },
  // The researched place files (_contacts/<geoid>.json, _landscape/<geoid>.json)
  // under any name, even with one contact channel or none.
  { label: 'researched contacts record', re: { test: rootContacts }, ext: /\.json$/i },
  { label: 'researched landscape record', re: /"(housing_involvement|members_public)"\s*:/, ext: /\.json$/i },
  { label: 'pipeline relationship field', re: /\brelationship_tier\b/ },
  { label: 'pipeline last-talked field', re: /\blast_talked\b/ },
  { label: 'pipeline next-action column', re: /\bnext_action(_due)?\b/, ext: /\.(csv|tsv|json)$/i },
  { label: 'signal log column', re: /\bsignal_type\b/, ext: /\.(csv|tsv|json)$/i },
  { label: 'anti-targets column', re: /\b(date_dropped|revisit_date)\b/, ext: /\.(csv|tsv|json)$/i },
  { label: 'outreach templates column', re: /\b(template_name|notes_for_personalization)\b/, ext: /\.(csv|tsv|json)$/i },
  { label: 'partnership terms heading', re: /^#+\s*Proposed partnership terms\b/im },
  { label: 'call sheet heading', re: /^#+\s*Call sheet\b/im },
  // A held-back project's private studies, application text and pro forma
  // stay out. CHFA's public award and applicant records may still name it.
  { label: 'Fruita Mews private study or application text', re: /\bMews\b[\s\S]{0,200}?(clarification response|application narrative|pro ?forma|wait ?list|market stud)|(clarification response|application narrative|pro ?forma|wait ?list|market stud)[\s\S]{0,200}?\bMews\b/i }
];
// The hash list: it holds hashes, never a name.
const PRIVATE_TERMS_FILE = 'scripts/lib/private-terms.mjs';
// The hash list's canary phrase, built backwards so this file never spells it.
const CANARY = ['canary', 'guard', 'zz'].reverse().join(' ');
// Files that name these patterns in order to block them.
const ALLOWED = new Set([
  'test/repo-private-data.test.mjs',
  'scripts/lib/public-sensitive-patterns.mjs',
  'scripts/audit/public-artifact-guard.mjs',
  'docs/_external-references/HUD-CHAS-data-dictionary-2018-2022.xlsx'
]);
// Code that reads or blocks these field names, never data. Data-like files in
// the same folders (fixtures, CSVs, JSON) are still scanned.
const CODE_FILE = /\.(js|mjs|cjs|ts|py|sh)$|^developer[a-z-]*\.html$/i;
const TEXT_EXT = /\.(md|json|csv|txt|html|tsv|yml|yaml)$/i;
const MAX_TEXT = 30 * 1024 * 1024;

// A researched place file: a root object whose "contacts" is an array of
// people (objects with a name). Nested public lists don't count.
function rootContacts(text) {
  if (!/"contacts"\s*:/.test(text)) return false;
  let d; try { d = JSON.parse(text); } catch { return /^\s*\{[^{]*"contacts"\s*:\s*\[\s*\{/.test(text); }
  const roots = Array.isArray(d) ? d : [d];
  return roots.some((r) => r && typeof r === 'object' && Array.isArray(r.contacts) && r.contacts.some((c) => c && typeof c === 'object' && 'name' in c));
}

// Bytes to text: UTF-16 exports (with their byte-order mark) and a UTF-8 BOM
// would otherwise hide a header from the anchored patterns.
function decode(buf) {
  if (buf == null) return null;
  if (typeof buf === 'string') return buf.replace(/^\uFEFF/, '');
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

// One file: what makes it private, if anything. readText is called only when
// the content needs checking. The real scan and the self-test both use this.
function scanFile(f, readText, selfTest = false) {
  const allowed = ALLOWED.has(f);
  const out = [];
  if (!allowed) for (const { label, re } of PRIVATE_PATHS) if (re.test(f)) out.push(`${f}: ${label}`);
  const code = CODE_FILE.test(f);
  if (!TEXT_EXT.test(f) && !code) return out;
  const text = decode(readText());
  if (text == null) return out;
  if (text.length > MAX_TEXT) return out.concat(`${f}: too large to check (${Math.round(text.length / 1048576)} MB); keep exports out of the public repo`);
  // Private names and phrases, held as hashes, in any text file, code and tests
  // included. Only the hash list itself is exempt; ALLOWED covers the patterns below.
  // The canary is not private: it counts only in the self-test below, so an
  // older blob that spelled it (this PR's first commit) never fails a real scan.
  if (f !== PRIVATE_TERMS_FILE) for (const label of findPrivateTerms(text)) if (selfTest || label !== 'the guard canary') out.push(`${f}: ${label}`);
  if (code || allowed) return out;
  for (const { label, re, ext } of PRIVATE_TEXT) if ((!ext || ext.test(f)) && re.test(text)) out.push(`${f}: ${label}`);
  return out;
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const findings = [];
for (const f of files) {
  findings.push(...scanFile(f, () => { try { return readFileSync(path.join(ROOT, f)); } catch { return null; } }));
}

// On a pull request, also every file the PR's own commits added or changed,
// even one a later commit deleted: its blob stays readable in the PR history.
const base = process.env.GITHUB_BASE_REF;
if (base) {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const blob = (sha) => execFileSync('git', ['cat-file', '-p', sha], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  let raw = '';
  // -z: paths unquoted, NUL-separated. --diff-merges=remerge: a merge commit's
  // own conflict resolution counts too, without re-listing the base's changes.
  try { raw = git('log', '-z', '--format=', '--raw', '--no-abbrev', '--no-renames', '--diff-filter=AMT', '--diff-merges=remerge', `origin/${base}..HEAD`); } catch { console.warn(`repo-private-data: origin/${base} not available; PR history not scanned`); }
  const parts = raw.split('\0');
  for (let i = 0; i + 1 < parts.length; i++) {
    const m = parts[i].match(/^\n*:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [AMT]$/);
    if (!m) continue;
    const f = parts[++i];
    for (const x of scanFile(f, () => { try { return blob(m[1]); } catch { return null; } })) findings.push(`${x} (in this PR's history)`);
  }
}

if (findings.length) {
  console.error('Private developer material is tracked in the public repo. Move it to coho-backend (gated/, docs/ or dossiers/) and remove it here:');
  for (const x of [...new Set(findings)]) console.error('- ' + x);
  process.exit(1);
}

// The guard must catch what it is for, through the same per-file scan.
const mustCatch = [
  ['data/jurisdiction-briefs/_contacts/0899999.json'], ['data/jurisdiction-briefs/_land-banking-contacts.json'],
  ['data/jurisdiction-briefs/_round-watch-contacts.json'], ['docs/developer-pipeline-prototype/04-network.csv'],
  ['dossiers/example-site/index.html'], ['data/ripeness.json'], ['docs/Example-Partnership-Terms.pdf'],
  ['notes/example-call-sheet.md'], ['data/x.docx'], ['data/café-contacts.json'], ['x/contact.tsv'], ['data/notes.md', '## Proposed partnership terms\n'],
  ['data/people.csv', 'name,org,email,phone\n'], ['data/bom.csv', Buffer.from('\uFEFFname,org,email,phone\nPat,X,p@x,1\n', 'utf8')],
  ['data/u16.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name,org,email,phone\n', 'utf16le')])], ['data/q.csv', '"Name","Org","Email","Phone"\n'],
  ['test/fixtures/private-contact-leak.csv', 'name,org,email,phone\nPat,Org,pat@example.com,555\n'],
  ['scripts/data/network.json', '{"relationship_tier": "warm"}'], ['.github/notes.md', '# Call sheet\n'],
  ['data/jurisdiction-briefs/round-watch-contacts.json'], ['data/exports/example-contacts.csv'], ['notes/x.pptx'],
  ['data/renamed.csv', 'id,place,next_action,next_action_due\n'], ['archive/private/x.json'], ['backup/dossiers/brief.pdf'],
  ['data/one.json', '{"geoid":"0899999","contacts":[{"name":"Pat","role":"Mayor","email":"p@x.org"}]}'],
  ['data/hna/local-resources.json', '{"geoid":"0899999","contacts":[{"name":"Pat","role":"Mayor"}]}'],
  ['data/land.json', '{"people":[{"name":"Pat","public_role":"Developer","housing_involvement":"x"}]}'],
  ['data/people.json', '[{"name":"Pat","org":"X","phone":"555","email":"p@x.org"}]'], ['data/awards-copy.json', '{"from_award_lists":[]}'],
  ['data/a.csv', 'date,signal_type,place\n'], ['data/b.csv', 'org,date_dropped,revisit_date\n'], ['data/c.csv', 'template_name,body,notes_for_personalization\n'], ['data/big.json', 'x'.repeat(MAX_TEXT + 1)],
  ['docs/benchmarks/pma.md', 'Market Study of The Fruita Mews II'], ['data/brief.json', '"note": "the clarification response to CHFA on the Fruita Mews II application"'],
  ['docs/x.md', 'Fruita Mews Phase II pro forma'], ['docs/y.md', '# Fruita Mews Phase II\n\n## Market Study\n'],
  ['data/z.txt', 'Fruita Mews Phase II\napplication narrative'],
  ['docs/notes.md', `call ${CANARY.toUpperCase().replace(' ', '-')} first`], ['test/x.test.mjs', `// ask ${CANARY}`],
  ['test/repo-private-data.test.mjs', CANARY], ['scripts/lib/public-sensitive-patterns.mjs', CANARY], ['scripts/audit/public-artifact-guard.mjs', CANARY]
];
for (const [f, t = ''] of mustCatch) if (!scanFile(f, () => t, true).length) { console.error('guard misses ' + f); process.exit(1); }
const mustPass = [['js/components/pipeline-store.js', 'relationship_tier'], ['developer-pipeline.html', 'last_talked'], ['js/x.js', '// zz guard only, canary later'], [PRIVATE_TERMS_FILE, `// ${CANARY}`], ['data/hna/x.json', '{"a":1}'],
  ['docs/api/js__components__pipeline-store.md', 'next_action'],
  ['data/awards.json', '"name": "Fruita Mews", "Total Units: 50", "Credit Amount Awarded: $1,330,877"']];
for (const [f, t] of mustPass) if (scanFile(f, () => t, true).length) { console.error('guard wrongly flags ' + f); process.exit(1); }
console.log(`repo-private-data: ${files.length} tracked files checked, none private.`);
