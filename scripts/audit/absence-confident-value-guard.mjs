#!/usr/bin/env node

/**
 * Dependency-free source guard for two mechanically decidable ways that
 * missing data becomes a confident number:
 *
 * A. global isFinite() applied directly to a property/index read. The global
 *    function coerces null and the empty string to zero. A narrow companion
 *    check covers the historical one-line currency-formatter form.
 * B. global isFinite(Number(...)), where Number() performs the same coercion.
 * C. a data-keyed map lookup that falls back to a non-zero numeric literal.
 *
 * This is intentionally not a JavaScript linter. It follows the repository's
 * readFileSync/source-scan convention and excludes vendor bundles and common
 * configuration-option identifiers. Every safe match requires an exact,
 * reasoned allowlist entry below; stale entries fail the check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const ALLOWLIST = Object.freeze([
  {
    rule: 'A',
    file: 'js/census-geo.js',
    expression: 'isFinite(o.value)',
    reason: 'The observation value is null-filtered and converted with Number() immediately before this numeric NaN filter.',
  },
  {
    rule: 'A',
    file: 'js/fred-cards.js',
    expression: 'isFinite(o.value)',
    reason: 'The observation value is null-filtered and converted with Number() immediately before this numeric NaN filter.',
  },
  {
    rule: 'A',
    file: 'js/market-analysis.js',
    expression: 'isFinite(t.score)',
    reason: 'The same predicate explicitly rejects null and undefined before checking the already-computed score.',
  },
  {
    rule: 'A',
    file: 'js/market-analysis.js',
    expression: 'isFinite(d.score)',
    reason: 'The same predicate explicitly rejects null and undefined before checking the already-computed score.',
  },
  {
    rule: 'A',
    file: 'js/market-analysis/site-selection-score.js',
    expression: 'isFinite(transitMetrics.transitAccessibilityScore)',
    reason: 'The preceding conjunct requires typeof transitAccessibilityScore to be number, so null and empty strings cannot reach this call.',
  },
  {
    rule: 'B',
    file: 'js/census-geo.js',
    expression: 'isFinite(Number(r.renter_share))',
    reason: 'The same condition requires renter_share != null before Number() is evaluated; Census returns this field as a numeric string.',
  },
  {
    rule: 'C',
    file: 'js/components/toast.js',
    expression: 'DEFAULTS[type] || 4000',
    reason: 'This selects a UI timeout policy by toast type; it is a configuration default, not a measured value.',
  },
  {
    rule: 'C',
    file: 'js/hna/hna-market-bridge.js',
    expression: 'priorityOrder[a.priority] || 3',
    reason: 'This puts an unknown category last in a presentation sort; the number is neither stored nor rendered as a measurement.',
  },
  {
    rule: 'C',
    file: 'js/hna/hna-market-bridge.js',
    expression: 'priorityOrder[b.priority] || 3',
    reason: 'This puts an unknown category last in a presentation sort; the number is neither stored nor rendered as a measurement.',
  },
]);

const CONFIG_IDENTIFIERS = new Set([
  'opts', 'options', '_cfg', 'cfg', 'config', 'params', 'input', 'settings',
]);

function maskNonCode(source) {
  const chars = source.split('');
  let state = 'code';
  let escaped = false;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i += 1;
        state = 'line-comment';
      } else if (ch === '/' && next === '*') {
        chars[i] = chars[i + 1] = ' ';
        i += 1;
        state = 'block-comment';
      } else if (ch === "'") {
        chars[i] = ' ';
        state = 'single';
        escaped = false;
      } else if (ch === '"') {
        chars[i] = ' ';
        state = 'double';
        escaped = false;
      } else if (ch === '`') {
        chars[i] = ' ';
        state = 'template';
        escaped = false;
      }
      continue;
    }

    if (ch === '\n') {
      if (state === 'line-comment') state = 'code';
      else if (state === 'single' || state === 'double') state = 'code';
      escaped = false;
      continue;
    }
    chars[i] = ' ';
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        chars[i + 1] = ' ';
        i += 1;
        state = 'code';
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if ((state === 'single' && ch === "'") ||
        (state === 'double' && ch === '"') ||
        (state === 'template' && ch === '`')) {
      state = 'code';
    }
  }
  return chars.join('');
}

function normalizeExpression(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function candidate(rule, file, source, index, raw, detail) {
  return {
    rule,
    file,
    line: source.slice(0, index).split('\n').length,
    expression: normalizeExpression(raw),
    detail,
  };
}

export function scanSource(file, source) {
  const masked = maskNonCode(source);
  const findings = [];

  // Rule A: direct property/index read passed to coercive global isFinite().
  const propertyRead = /(?<![.\w$])isFinite\s*\(\s*[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*|\[[^\]\r\n]+\])+\s*\)/g;
  for (const match of masked.matchAll(propertyRead)) {
    findings.push(candidate('A', file, source, match.index, source.slice(match.index, match.index + match[0].length),
      'global isFinite() coerces a missing property value to zero'));
  }

  // Historical #1581 shape: a one-line money/currency formatter applies
  // global isFinite() directly to its parameter without an absence guard.
  const moneyFunction = /function\s+[A-Za-z_$][\w$]*(?:Money|Currency)[\w$]*\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{([^\n}]*)\}/gi;
  for (const fn of masked.matchAll(moneyFunction)) {
    const param = fn[1];
    const body = fn[2];
    const direct = new RegExp(`(?<![.\\w$])isFinite\\s*\\(\\s*${param}\\s*\\)`);
    const directMatch = direct.exec(body);
    if (!directMatch) continue;
    const before = body.slice(0, directMatch.index);
    const escapedParam = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absenceGuard = new RegExp(
      `(?:${escapedParam}\\s*(?:={2,3}|!={1,2})\\s*(?:null|undefined)|` +
      `(?:null|undefined)\\s*(?:={2,3}|!={1,2})\\s*${escapedParam}|` +
      `(?:isAbsent|MoneyFormatter\\.isAbsent)\\s*\\(\\s*${escapedParam}\\s*\\))`,
    );
    if (absenceGuard.test(before)) continue;
    const offset = fn.index + fn[0].indexOf(body) + directMatch.index;
    findings.push(candidate('A', file, source, offset,
      source.slice(offset, offset + directMatch[0].length),
      'money formatter uses coercive global isFinite() without first guarding absence'));
  }

  // Rule B: Number() manufactures zero before coercive global isFinite().
  const numberCoercion = /(?<![.\w$])isFinite\s*\(\s*Number\s*\(\s*[^)\r\n]+\)\s*\)/g;
  for (const match of masked.matchAll(numberCoercion)) {
    findings.push(candidate('B', file, source, match.index, source.slice(match.index, match.index + match[0].length),
      'Number(null) and Number("") are zero'));
  }

  // Rule C: data-keyed map lookup with a non-zero numeric fallback.
  const numericMapFallback = /\b([A-Za-z_$][\w$]*)\s*\[[^\]\r\n]+\]\s*\|\|\s*(\d+(?:\.\d+)?|\.\d+)\b/g;
  for (const match of masked.matchAll(numericMapFallback)) {
    const identifier = match[1].toLowerCase();
    const literal = Number(match[2]);
    const rawExpression = source.slice(match.index, match.index + match[0].length);
    const keyText = rawExpression.slice(rawExpression.indexOf('[') + 1, rawExpression.lastIndexOf(']')).trim();
    if (CONFIG_IDENTIFIERS.has(identifier)) continue;
    if (/^['"]?\d+(?:\.\d+)?['"]?$/.test(keyText)) continue;
    if (literal === 0) continue;
    findings.push(candidate('C', file, source, match.index, source.slice(match.index, match.index + match[0].length),
      'missing map entry falls back to a confident non-zero number'));
  }

  return findings;
}

function listJsFiles(dir, relative = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' && relative === 'js') continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full, rel));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

function allowKey(entry) {
  return `${entry.rule}|${entry.file}|${normalizeExpression(entry.expression)}`;
}

export function evaluateCandidates(candidates, allowlist = ALLOWLIST) {
  const allowMap = new Map();
  const duplicateAllowlistKeys = [];
  for (const entry of allowlist) {
    const key = allowKey(entry);
    if (allowMap.has(key)) duplicateAllowlistKeys.push(key);
    allowMap.set(key, entry);
  }
  const candidateKeys = new Set(candidates.map(allowKey));
  return {
    unexpected: candidates.filter((entry) => !allowMap.has(allowKey(entry))),
    staleAllowlist: allowlist.filter((entry) => !candidateKeys.has(allowKey(entry))),
    duplicateAllowlistKeys,
  };
}

export function scanTree(root = ROOT) {
  const jsRoot = path.join(root, 'js');
  const candidates = listJsFiles(jsRoot, 'js').flatMap((file) =>
    scanSource(file, fs.readFileSync(path.join(root, file), 'utf8'))
  );
  return { candidates, ...evaluateCandidates(candidates) };
}

function printEntry(prefix, entry) {
  console.error(`${prefix} ${entry.file}:${entry.line || '?'} [Rule ${entry.rule}] ${entry.expression}`);
  if (entry.reason) console.error(`  reason: ${entry.reason}`);
  if (entry.detail) console.error(`  ${entry.detail}`);
}

function main() {
  const report = scanTree(ROOT);
  for (const entry of report.unexpected) printEntry('VIOLATION', entry);
  for (const entry of report.staleAllowlist) printEntry('STALE ALLOWLIST', entry);
  for (const key of report.duplicateAllowlistKeys) console.error(`DUPLICATE ALLOWLIST ${key}`);
  if (report.unexpected.length || report.staleAllowlist.length || report.duplicateAllowlistKeys.length) {
    process.exitCode = 1;
    return;
  }
  console.log(`absence-confident-value guard: PASS (${report.candidates.length} reasoned exceptions, 0 violations)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
