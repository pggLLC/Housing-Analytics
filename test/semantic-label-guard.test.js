#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'data/schema/semantic-label-evidence.json');
const KEYWORD_RE = /(candidate|risk|recommendation|classification|score)/i;
const STRING_RE = /['"`]([^'"`\n]{0,180})['"`]/g;
const IDENT_RE = /\b[A-Za-z_][A-Za-z0-9_]*(?:candidate|risk|recommendation|classification|score)[A-Za-z0-9_]*\b/gi;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function semanticTokens(src) {
  const stripped = stripComments(src);
  const tokens = new Set();
  for (const match of stripped.matchAll(STRING_RE)) {
    const token = match[1].trim();
    if (KEYWORD_RE.test(token)) tokens.add(token);
  }
  for (const match of stripped.matchAll(IDENT_RE)) {
    tokens.add(match[0]);
  }
  return Array.from(tokens).sort();
}

function declarationKey(file, token) {
  return `${file}\u0000${token}`;
}

function missingEvidenceForSources(files, declarations) {
  const declared = new Set(declarations.map((d) => declarationKey(d.file, d.token)));
  const missing = [];
  for (const [file, src] of Object.entries(files)) {
    for (const token of semanticTokens(src)) {
      if (!declared.has(declarationKey(file, token))) missing.push({ file, token });
    }
  }
  return missing;
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
assert.strictEqual(schema.schema, 'semantic-label-evidence/v1');
assert(Array.isArray(schema.watched_files) && schema.watched_files.length > 0, 'schema must list watched files');
assert(Array.isArray(schema.declarations) && schema.declarations.length > 0, 'schema must declare semantic label evidence');

const allowed = new Set(schema.allowed_evidence_types || []);
for (const expected of ['computed', 'curated', 'source-membership', 'modeled']) {
  assert(allowed.has(expected), `missing allowed evidence type ${expected}`);
}

const seen = new Set();
for (const declaration of schema.declarations) {
  assert(schema.watched_files.includes(declaration.file), `${declaration.token} points at unwatched file ${declaration.file}`);
  assert(allowed.has(declaration.evidence_type), `${declaration.token} has invalid evidence_type ${declaration.evidence_type}`);
  assert(declaration.rationale && declaration.rationale.length >= 20, `${declaration.token} needs a useful rationale`);
  const key = declarationKey(declaration.file, declaration.token);
  assert(!seen.has(key), `duplicate declaration for ${declaration.file} ${declaration.token}`);
  seen.add(key);
  assert(read(declaration.file).includes(declaration.token), `${declaration.file} no longer contains declared token ${declaration.token}`);
}

const watchedSources = Object.fromEntries(schema.watched_files.map((file) => [file, read(file)]));
const missing = missingEvidenceForSources(watchedSources, schema.declarations);
assert.deepStrictEqual(missing, [], `semantic labels missing evidence declarations:\n${missing.map((m) => `- ${m.file}: ${m.token}`).join('\n')}`);

const oldPreservationBugFixture = {
  'scripts/build-affordable-housing-properties.js': "return { program_type: ['preservation-candidate'], property_name: p.PROJECT || null };",
};
const oldBugDeclarations = schema.declarations.filter((d) => d.token !== 'preservation-candidate');
const oldBugMissing = missingEvidenceForSources(oldPreservationBugFixture, oldBugDeclarations);
assert(
  oldBugMissing.some((m) => m.token === 'preservation-candidate'),
  'guard should catch the pre-0.2 preservation-candidate source-membership bug when evidence is omitted',
);

const ownershipNeed = JSON.parse(read('data/hna/ownership-need.json'));
const sampleRecord = Object.values(ownershipNeed.records || {}).find((r) => r && r.recommendation && r.affordability_classification);
assert(sampleRecord, 'ownership artifact should include recommendation and affordability_classification labels');
assert(seen.has(declarationKey('scripts/hna/build_jurisdiction_metrics_digest.mjs', 'ownership_need_recommendation')), 'ownership recommendation digest label must be declared');
assert(seen.has(declarationKey('scripts/hna/build_jurisdiction_metrics_digest.mjs', 'affordability_classification')), 'affordability classification digest label must be declared');

const properties = JSON.parse(read('data/affordable-housing/properties.json'));
const preservation = (properties.properties || []).find((p) => (p.program_type || []).includes('preservation-candidate'));
assert(preservation, 'properties artifact should include preservation-candidate source-membership labels');
assert(seen.has(declarationKey('scripts/build-affordable-housing-properties.js', 'preservation-candidate')), 'preservation-candidate evidence type must be declared');
assert.strictEqual(
  schema.declarations.find((d) => d.file === 'scripts/build-affordable-housing-properties.js' && d.token === 'preservation-candidate').evidence_type,
  'source-membership',
  'preservation-candidate must remain source-membership, not risk/model output',
);

console.log('semantic-label-guard: ok');
