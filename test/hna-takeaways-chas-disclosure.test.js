'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'hna', 'hna-section-takeaways.js'), 'utf8');

console.log('\nHNA takeaways CHAS fallback disclosure guard');
console.log('='.repeat(52));

assert(src.includes('function _chasFallbackNote'), 'defines _chasFallbackNote helper');
assert(src.includes('c.chasSourceIsPlace !== false'), 'helper reads chasSourceIsPlace and mirrors narrative fallback gate');
assert(src.includes('place-level cost-burden data unavailable'), 'disclosure text explains place-level CHAS fallback');
assert(src.includes('county-level CHAS'), 'disclosure text identifies county-level CHAS');

const calls = src.match(/_chasFallbackNote\s*\(/g) || [];
const definitionCount = src.includes('function _chasFallbackNote') ? 1 : 0;
assert(calls.length - definitionCount >= 3, 'CHAS fallback note is appended to at least three takeaway renderers');

const writeIndex = src.indexOf('ctx.chasSourceIsPlace = chasSourceIsPlace');
const readIndex = src.indexOf('c.chasSourceIsPlace !== false');
assert(writeIndex >= 0, 'existing ctx.chasSourceIsPlace write remains present');
assert(readIndex >= 0 && readIndex !== writeIndex, 'chasSourceIsPlace is read outside the ctx write');

console.log('hna-takeaways-chas-disclosure: PASS');
