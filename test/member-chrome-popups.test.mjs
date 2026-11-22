// Member pages: no member-chrome.css rule may style every span inside an element.
//
// The glossary pop-ups (js/glossary.js .gl-tooltip-popup, inline-glossary) are spans hidden with
// display:none until hover or focus. A rule like `body.member-page .ib-quick-link span { display: block }`
// outranks that and leaves the pop-up open over the cards (member home, 22 Nov 2026). Style the
// direct child instead (`.ib-quick-link > span`).
//
// Run: node test/member-chrome-popups.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'css/member-chrome.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };

const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
check(rules.length > 20, 'read ' + rules.length + ' rules from css/member-chrome.css');

// A selector part ending in a descendant `span` (space before it, not `>`), in a rule that sets display.
const broad = rules.filter((r) => /display\s*:/.test(r.body) &&
  r.sel.split(',').some((s) => /[^>\s]\s+span\s*$/.test(s.trim())));
check(broad.length === 0, 'no rule sets display on every span inside an element' +
  (broad.length ? ': ' + broad.map((r) => r.sel).join(' | ') : ''));

check(/\.ib-quick-link\s*>\s*span\s*\{[^}]*display\s*:\s*block/.test(css), 'the quick-link card description is styled as the direct child span');

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All member chrome pop-up checks passed');
