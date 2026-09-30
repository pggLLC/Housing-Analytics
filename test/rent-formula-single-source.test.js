#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Reviewed exceptions must name an exact expression and why it is not a
// competing rent-limit implementation. No remaining exceptions are needed.
const allowlist = [];
const normalize = (s) => s.replace(/\s+/g, '');

// Lex code, not comments or quoted labels. Template interpolations remain code.
// This is an arithmetic guard, not general cross-statement constant propagation.
function tokens(source) {
  const out = [];
  let i = 0;
  function emit(value, start, end = i) { out.push({ value, start, end }); }
  function code(inInterpolation = false) {
    let braces = 0;
    while (i < source.length) {
      const start = i, c = source[i];
      if (/\s/.test(c)) { i++; continue; }
      if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue; }
      if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
      // A slash after an expression opener begins a regexp, not division.
      // Quotes/backticks inside it must not hide the rest of the file.
      const previous = out.length ? out[out.length - 1].value : null;
      if (c === '/' && (previous == null || /^(?:[=(:,;{\[!?&|+*%~<>-]|return|case|throw|yield)$/.test(previous))) {
        i++;
        let characterClass = false;
        while (i < source.length) {
          const ch = source[i++];
          if (ch === '\\') { i++; continue; }
          if (ch === '[') characterClass = true;
          if (ch === ']') characterClass = false;
          if (ch === '/' && !characterClass) break;
        }
        while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
        emit('#', start); continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === c) break; }
        emit('#', start); continue;
      }
      if (c === '`') {
        i++; emit('#', start);
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '`') { i++; break; }
          if (source.startsWith('${', i)) { i += 2; emit(';', i); code(true); emit(';', i); }
          else i++;
        }
        continue;
      }
      if (inInterpolation && c === '}' && braces === 0) { i++; return; }
      if (c === '{') braces++;
      if (c === '}') braces--;
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^[A-Za-z_$][\w$]*/i.exec(source.slice(i));
      if (match) { i += match[0].length; emit(match[0], start); }
      else { i++; emit(c, start); }
    }
  }
  code(); return out;
}

function scan(source) {
  const ts = tokens(source), hits = [];
  const close = new Map(), stack = [];
  ts.forEach((t, i) => {
    if (['(', '[', '{'].includes(t.value)) stack.push(i);
    if ([')', ']', '}'].includes(t.value)) {
      const start = stack.pop();
      if (start !== undefined) close.set(start, i);
    }
  });
  function atom(i) {
    const t = ts[i]; if (!t) return null;
    if (t.value === '(' && close.has(i)) {
      const inside = product(i + 1);
      return { next: close.get(i) + 1, factors: inside && inside.next === close.get(i) ? inside.factors : [{ unknown: true }] };
    }
    if (/^(?:\d|\.\d)/.test(t.value)) return { next: i + 1, factors: [{ value: Number(t.value), power: 1 }] };
    if (/^[A-Za-z_$]/.test(t.value)) {
      let next = i + 1, name = t.value;
      while (next < ts.length) {
        if (ts[next].value === '.' && ts[next + 1]) { name = ts[next + 1].value; next += 2; }
        else if (['[', '('].includes(ts[next].value) && close.has(next)) { next = close.get(next) + 1; name = ''; }
        else break;
      }
      return { next, factors: [{ unknown: true, burden: /^(?:burden|rentBurden|rent_burden)$/i.test(name), power: 1 }] };
    }
    return null;
  }
  function isRent(factors) {
    const constants = factors.filter((f) => f.value != null);
    const monthly = constants.some((f) => f.value === 12 && f.power === -1);
    const thirty = constants.some((f) => Math.abs(f.value - 0.3) < 1e-10 && f.power === 1) ||
      (constants.some((f) => f.value === 30 && f.power === 1) && constants.some((f) => f.value === 100 && f.power === -1));
    const coefficient = constants.reduce((v, f) => v * Math.pow(f.value, f.power), 1);
    return (monthly && (thirty || factors.some((f) => f.burden && f.power === 1))) ||
      (factors.some((f) => f.unknown) && Math.abs(coefficient - 0.3 / 12) < 1e-10);
  }
  function product(start) {
    let result = atom(start); if (!result) return null;
    while (ts[result.next] && ['*', '/'].includes(ts[result.next].value)) {
      const op = ts[result.next].value, right = atom(result.next + 1);
      if (!right) break;
      result = { next: right.next, factors: result.factors.concat(right.factors.map((f) => ({ ...f, power: (f.power || 1) * (op === '/' ? -1 : 1) }))) };
      if (isRent(result.factors)) hits.push({ start: ts[start].start, end: ts[result.next - 1].end });
    }
    return result;
  }
  ts.forEach((_, i) => product(i));
  return hits.filter((h, i) => !hits.some((other, j) => j !== i && other.start <= h.start && other.end >= h.end && (other.start < h.start || other.end > h.end || j < i)))
    .map((h) => ({ line: source.slice(0, h.start).split('\n').length, expression: source.slice(h.start, h.end) }));
}

// Independent positive fixtures include ordering, grouping, numeric spellings,
// percentages, simplified factors and interpolation; inverse income math is not rent.
const positives = ['x * 0.30 / 12', 'x * 0.3 / 12', 'x / 12 * 0.3', '(x * .30) / 12',
  '(x * .6 / 12) * .30', 'x * (30 / 100) / 12', 'x * (3e-1 / 12)', 'x * .025',
  'x / 40', '(x + y) * 0.30 / 12', 'x * burden / 12', '`Rent ${x * 0.30 / 12}`'];
positives.push("const re = /['\"`]/g; function rent(x) { return x * 0.30 / 12; }");
for (const expression of positives) assert(scan(expression).length, 'scanner misses ' + expression);
for (const source of ['// x * 0.30 / 12', '"x * 0.30 / 12"', '`x * 0.30 / 12`', 'rent * 12 / .3', 'x * .3', 'x / 12']) {
  assert.equal(scan(source).length, 0, 'scanner wrongly flags ' + source);
}
const moduleHits = scan(fs.readFileSync(path.join(root, 'js/chfa-rent-limits.js'), 'utf8'));
assert(moduleHits.some((h) => h.expression.includes('burden')), 'non-vacuity: find the module’s real rent formula before excluding it');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'vendor') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : e.name.endsWith('.js') ? [p] : [];
  });
}
const violations = [], used = new Set();
let count = 0;
for (const file of files(path.join(root, 'js'))) {
  const relative = path.relative(root, file);
  if (relative === 'js/chfa-rent-limits.js') continue;
  count++;
  for (const hit of scan(fs.readFileSync(file, 'utf8'))) {
    const exception = allowlist.find((a) => a.file === relative && normalize(a.expression) === normalize(hit.expression));
    if (exception) { assert(exception.reason && exception.reason.trim(), 'every exception needs a written reason'); used.add(exception); }
    else violations.push(`${relative}:${hit.line}: ${hit.expression}`);
  }
}
assert.equal(used.size, allowlist.length, 'remove stale allowlist entries');
assert.equal(violations.length, 0, `Found ${violations.length} rent-formula violation(s):\n${violations.join('\n')}`);
const scripts = require('../package.json').scripts;
assert(Object.entries(scripts).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:rent-formula-single-source')));
console.log(`Rent formula single source: ${count} files scanned; ${moduleHits.length} module formula(s) found; ${positives.length} positive fixtures; 0 violations.`);
