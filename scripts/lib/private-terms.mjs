// Names and phrases that never go in this public repo or on the public site:
// private contacts, a private study firm, a private site address. The list
// keeps only salted hashes, so the guard itself names no one.
//
// Text is reduced to lower-case words (letters and digits); a term is one to
// three consecutive words. Check a phrase, or get the line to add a new one:
//   node scripts/lib/private-terms.mjs --hash "the phrase"
//
// Read by test/repo-private-data.test.mjs (every tracked file and every file a
// PR's commits touch) and scripts/audit/public-artifact-guard.mjs (the built site).
import { createHash } from 'node:crypto';

const SALT = 'coho-private-term:';
const MAX_WORDS = 3;

// [first-word hash, whole-term hash, label]
const TERMS = [
  ['180841afe61dedbe9da917d1', '3dd70a883645ad22498f0638', 'a private study firm'],
  ['ac113272aab90550e5f80feb', 'ac113272aab90550e5f80feb', 'a private contact name'],
  ['3f46c7017cf8dfcb260d4d39', '3f46c7017cf8dfcb260d4d39', 'a private contact name'],
  ['907a86a7fbf4a78a0c008146', '907a86a7fbf4a78a0c008146', 'a private contact name'],
  ['0a43e9c0438d8bfe4ebb687b', '2297e8875345a211de0763a7', 'a private site address'],
  // The guard's own canary, so the self-test needs no real name.
  ['259b79e2fb3f736e5066ced5', '6817f3b3d9145199f31cfaba', 'the guard canary']
];

export function termHash(phrase) {
  return createHash('sha256').update(SALT + phrase).digest('hex').slice(0, 24);
}

export function words(text) {
  return String(text).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const FIRST = new Map();
for (const [first, whole, label] of TERMS) {
  if (!FIRST.has(first)) FIRST.set(first, []);
  FIRST.get(first).push({ whole, label });
}

// Labels of the private terms the text contains (empty when none).
export function findPrivateTerms(text) {
  const w = words(text);
  const seen = new Map();
  const found = new Set();
  for (let i = 0; i < w.length; i++) {
    let h = seen.get(w[i]);
    if (h === undefined) { h = termHash(w[i]); seen.set(w[i], h); }
    const cands = FIRST.get(h);
    if (!cands) continue;
    for (let n = 1; n <= MAX_WORDS && i + n <= w.length; n++) {
      const whole = termHash(w.slice(i, i + n).join(' '));
      for (const c of cands) if (c.whole === whole) found.add(c.label);
    }
  }
  return [...found];
}

if (process.argv[2] === '--hash') {
  const w = words(process.argv.slice(3).join(' '));
  if (!w.length || w.length > MAX_WORDS) { console.error(`give one to ${MAX_WORDS} words`); process.exit(1); }
  console.log(`  ['${termHash(w[0])}', '${termHash(w.join(' '))}', 'LABEL'],`);
  const hit = findPrivateTerms(w.join(' '));
  console.log(hit.length ? `already listed: ${hit.join(', ')}` : 'not listed yet');
}
