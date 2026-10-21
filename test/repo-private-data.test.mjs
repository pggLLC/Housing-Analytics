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
// Files that name these patterns in order to block them, or that the build
// already keeps out of every public surface with code only.
const ALLOWED = new Set([
  'test/repo-private-data.test.mjs',
  'scripts/lib/public-sensitive-patterns.mjs',
  'scripts/audit/public-artifact-guard.mjs',
  'docs/_external-references/HUD-CHAS-data-dictionary-2018-2022.xlsx'
]);
const ALLOWED_TEXT_DIRS = /^(test|tests|scripts|js|\.github)\/|^developer[a-z-]*\.html$/; // gated page code that reads these fields, never data
const TEXT_EXT = /\.(md|json|csv|txt|html|tsv|yml|yaml)$/i;

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const findings = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  for (const { label, re } of PRIVATE_PATHS) if (re.test(f)) findings.push(`${f}: ${label}`);
  if (!TEXT_EXT.test(f) || ALLOWED_TEXT_DIRS.test(f)) continue;
  let text;
  try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (text.length > 30 * 1024 * 1024) continue;
  for (const { label, re } of PRIVATE_TEXT) if (re.test(text)) findings.push(`${f}: ${label}`);
}

if (findings.length) {
  console.error('Private developer material is tracked in the public repo. Move it to coho-backend (gated/, docs/ or dossiers/) and remove it here:');
  for (const x of [...new Set(findings)]) console.error('- ' + x);
  process.exit(1);
}

// The guard must catch what it is for.
const probe = (f, text = '') => PRIVATE_PATHS.some(({ re }) => re.test(f)) || PRIVATE_TEXT.some(({ re }) => re.test(text));
const mustCatch = [
  ['data/jurisdiction-briefs/_contacts/0805265.json'], ['data/jurisdiction-briefs/_land-banking-contacts.json'],
  ['data/jurisdiction-briefs/_round-watch-contacts.json'], ['docs/developer-pipeline-prototype/04-network.csv'],
  ['dossiers/bayfield-750-orchard/index.html'], ['docs/Bayfield-Partnership-Terms-750-Orchard-Drive.pdf'],
  ['notes/bayfield-call-sheet.md'], ['data/x.docx'], ['data/notes.md', '## Proposed partnership terms\n'],
  ['data/people.csv', 'name,org,email,phone\n']
];
for (const [f, t] of mustCatch) if (!probe(f, t)) { console.error('guard misses ' + f); process.exit(1); }
console.log(`repo-private-data: ${files.length} tracked files checked, none private.`);
