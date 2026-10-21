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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Paths that are private wherever they appear.
const PRIVATE_PATHS = [
  { label: 'named contacts (coho-backend gated/)', re: /^data\/jurisdiction-briefs\/_(contacts|landscape)\// },
  { label: 'named contacts (coho-backend gated/)', re: /^data\/jurisdiction-briefs\/_[a-z0-9-]*contacts[a-z0-9-]*\.json$/i },
  { label: 'private pipeline files (coho-backend docs/)', re: /^docs\/(developer|indibuild)-pipeline-prototype\// },
  { label: 'coho-backend folder', re: /^(gated|dossiers|ripeness|private|internal)\// },
  { label: 'readiness readings built from dossiers (coho-backend build)', re: /^data\/ripeness\.json$/ },
  { label: 'dossier, partnership terms or call sheet', re: /(^|\/)[^/]*(dossier|partnership-terms|call-sheet|seller-ask|term-sheet)[^/]*\.(md|json|csv|docx|pdf|html|txt)$/i },
  { label: 'saved deal or uploaded draft', re: /(^|\/)(saved-deals|deal-versions|submittal-uploads|uploads)\// },
  { label: 'office document (keep drafts and dossiers in coho-backend)', re: /\.(docx|doc|pptx|xlsm)$/i }
];
// Text that only private material carries.
const PRIVATE_TEXT = [
  { label: 'contact CSV header', re: /^name,[^\n]*\bemail\b[^\n]*\bphone\b/im },
  { label: 'pipeline relationship field', re: /\brelationship_tier\b/ },
  { label: 'pipeline last-talked field', re: /\blast_talked\b/ },
  { label: 'partnership terms heading', re: /^#+\s*Proposed partnership terms\b/im },
  { label: 'call sheet heading', re: /^#+\s*Call sheet\b/im }
];
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

// One file: what makes it private, if anything. readText is called only when
// the content needs checking. The real scan and the self-test both use this.
function scanFile(f, readText) {
  if (ALLOWED.has(f)) return [];
  const out = [];
  for (const { label, re } of PRIVATE_PATHS) if (re.test(f)) out.push(`${f}: ${label}`);
  if (!TEXT_EXT.test(f) || CODE_FILE.test(f)) return out;
  const text = readText();
  if (text == null || text.length > MAX_TEXT) return out;
  for (const { label, re } of PRIVATE_TEXT) if (re.test(text)) out.push(`${f}: ${label}`);
  return out;
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const findings = [];
for (const f of files) {
  findings.push(...scanFile(f, () => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } }));
}

if (findings.length) {
  console.error('Private developer material is tracked in the public repo. Move it to coho-backend (gated/, docs/ or dossiers/) and remove it here:');
  for (const x of [...new Set(findings)]) console.error('- ' + x);
  process.exit(1);
}

// The guard must catch what it is for, through the same per-file scan.
const mustCatch = [
  ['data/jurisdiction-briefs/_contacts/0805265.json'], ['data/jurisdiction-briefs/_land-banking-contacts.json'],
  ['data/jurisdiction-briefs/_round-watch-contacts.json'], ['docs/developer-pipeline-prototype/04-network.csv'],
  ['dossiers/bayfield-750-orchard/index.html'], ['data/ripeness.json'], ['docs/Bayfield-Partnership-Terms-750-Orchard-Drive.pdf'],
  ['notes/bayfield-call-sheet.md'], ['data/x.docx'], ['data/notes.md', '## Proposed partnership terms\n'],
  ['data/people.csv', 'name,org,email,phone\n'],
  ['test/fixtures/private-contact-leak.csv', 'name,org,email,phone\nPat,Org,pat@example.com,555\n'],
  ['scripts/data/network.json', '{"relationship_tier": "warm"}'], ['.github/notes.md', '# Call sheet\n']
];
for (const [f, t = ''] of mustCatch) if (!scanFile(f, () => t).length) { console.error('guard misses ' + f); process.exit(1); }
const mustPass = [['js/components/pipeline-store.js', 'relationship_tier'], ['developer-pipeline.html', 'last_talked'], ['data/hna/x.json', '{"a":1}']];
for (const [f, t] of mustPass) if (scanFile(f, () => t).length) { console.error('guard wrongly flags ' + f); process.exit(1); }
console.log(`repo-private-data: ${files.length} tracked files checked, none private.`);
