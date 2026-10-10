// Text that must never reach the public artifact. scripts/audit/public-artifact-guard.mjs fails
// the build on any match; generators that compose new public text (the search index) read the
// same list so they leave such text out rather than tripping the guard.
export const SENSITIVE_PATTERNS = [
  { label: 'default developer password', regex: /DEFAULT PASSWORD/i },
  { label: 'developer gate implementation', regex: /Developer Password Gate/i },
  { label: 'pipeline relationship tier field', regex: /\brelationship_tier\b/i },
  { label: 'pipeline anti-targets file', regex: /\banti-targets\b/i },
  { label: 'pipeline next action field', regex: /\bnext_action\b/i },
  { label: 'local draft pipeline badge', regex: /\bLocal draft\b/i },
  { label: 'contact CSV email/phone fields', regex: /\bemail,phone\b/i },
  { label: 'network contact fields', regex: /\bphone,last_talked,relationship_tier\b/i },
  { label: 'legacy developer password', regex: /\bsalida2026\b/i },
  { label: 'legacy gate hash', regex: /\b029fb5d4a8a29de1c16bcb718162284a45adf69fc12916613f28b2d037a19119\b/i },
  { label: 'legacy IndiBuild brand text', regex: /\bindibuild\b/i }
];

export function isSensitive(text) {
  return SENSITIVE_PATTERNS.some(({ regex }) => regex.test(String(text)));
}
