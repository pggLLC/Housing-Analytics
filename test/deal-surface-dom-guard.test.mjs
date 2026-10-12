// Static guard: calculated values must not be recovered from rendered text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseScript } from 'meriyah';
const files = ['js/deal-calculator.js', 'js/pro-forma.js', 'js/deal-calculator-share.js', 'js/deal-calculator-report-meta.js'];
function numericTextReads(source) {
  const ast = parseScript(source, { next: true, loc: true });
  const scopes = new WeakMap(), nodes = [], functions = new Map();
  function visit(node, parentScope) {
    if (!node || typeof node !== 'object' || !node.type) return;
    let scope = parentScope;
    if (/Function/.test(node.type)) {
      scope = { parent: parentScope, bindings: new Map(), returnTainted: false };
      if (node.id) functions.set(node.id.name, scope);
      for (const p of node.params) if (p.name) scope.bindings.set(p.name, false);
    }
    scopes.set(node, scope); nodes.push(node);
    if (node.type === 'VariableDeclarator' && node.id.name) scope.bindings.set(node.id.name, false);
    for (const [key, value] of Object.entries(node)) if (key !== 'loc') {
      if (Array.isArray(value)) value.forEach(child => visit(child, scope));
      else if (value && value.type) visit(value, scope);
    }
  }
  visit(ast, { parent: null, bindings: new Map(), returnTainted: false });
  function binding(scope, name) {
    for (let s = scope; s; s = s.parent) if (s.bindings.has(name)) return s;
    return scope;
  }
  function tainted(node) {
    if (!node || typeof node !== 'object') return false;
    if (/Function/.test(node.type)) return false;
    if (node.type === 'Identifier') return binding(scopes.get(node), node.name).bindings.get(node.name) === true;
    if (node.type === 'MemberExpression' && ['textContent','innerText'].includes(node.computed ? node.property.value : node.property.name)) return true;
    if (node.type === 'CallExpression' && functions.get(node.callee.name)?.returnTainted) return true;
    return Object.entries(node).some(([key, value]) => key !== 'loc' && (Array.isArray(value) ? value.some(tainted) : value?.type && tainted(value)));
  }
  let changed;
  do {
    changed = false;
    for (const node of nodes) {
      const target = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' ? node.left : null;
      const rhs = node.type === 'VariableDeclarator' ? node.init : node.right;
      if (target?.type === 'Identifier' && tainted(rhs)) {
        const scope = binding(scopes.get(node), target.name);
        if (!scope.bindings.get(target.name)) { scope.bindings.set(target.name, true); changed = true; }
      }
      if (node.type === 'ReturnStatement' && tainted(node.argument) && !scopes.get(node).returnTainted) {
        scopes.get(node).returnTainted = true; changed = true;
      }
    }
  } while (changed);
  return nodes.filter(node => {
    if (node.type === 'CallExpression') {
      const name = node.callee.name || node.callee.property?.name;
      return ['Number','parseFloat','parseInt'].includes(name) && node.arguments.some(tainted);
    }
    if (node.type === 'UnaryExpression') return ['+','-','~'].includes(node.operator) && tainted(node.argument);
    return node.type === 'BinaryExpression' && ['-','*','/','%','**'].includes(node.operator) && (tainted(node.left) || tainted(node.right));
  }).map(node => node.loc.start.line);
}
let numericCalls = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert.deepEqual(numericTextReads(source), [], file + ': numbers may not come from textContent/innerText');
  assert(!/\b(?:textNum|_parseMoney|_readExitOutputs|_getEquityRate)\b/.test(source), file + ': retired display readers/fallback cannot return');
  assert(!/getElementById\(['"](?:dc-eligible-basis|dc-deferred-dev-fee)['"]\)/.test(source), file + ': obsolete control ID');
  numericCalls += [...source.matchAll(/\b(?:Number|parseFloat|parseInt)\(/g)].length;
}
// Demonstrate that the detector catches direct, alias and helper-return parsing.
for (const source of [
  'parseFloat(el.textContent)',
  'function f(){var text=el.textContent.replace(/[$,]/g, "");return Number(text)}',
  'function read(){return el.textContent} var x=read(); parseInt(x)',
  'const n = +el.innerText'
]) assert(numericTextReads(source).length > 0, 'non-vacuous detector: ' + source);
assert.equal(files.length, 4); assert(numericCalls > 20, 'scanned actual numeric consumers, not empty files');
console.log(`deal-surface-dom-guard: PASS (${files.length} surfaces, ${numericCalls} numeric calls, direct/alias/helper detector checks)`);
