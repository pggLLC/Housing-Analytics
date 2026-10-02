#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const warnings = [];
const vc = new VirtualConsole(); vc.on('warn', message => warnings.push(message));
const dom = new JSDOM('<span data-methodology-key="missing-test-key"></span>', {url:'http://127.0.0.1/', runScripts:'outside-only',virtualConsole:vc});
try {
  dom.window.eval(fs.readFileSync('js/methodology-explainer.js','utf8'));
  dom.window.MethodologyExplainer.attach();
  const registry = dom.window.MethodologyExplainer.REGISTRY;
  let checked = 0;
  for (const file of execFileSync('git',['ls-files','*.html'],{encoding:'utf8'}).trim().split('\n')) {
    const fragment = JSDOM.fragment(fs.readFileSync(file, 'utf8'));
    for (const anchor of fragment.querySelectorAll('[data-methodology-key]')) {
      const key = anchor.getAttribute('data-methodology-key');
      assert(registry[key], file + ': missing methodology ' + key); checked++;
    }
  }
  assert(checked > 0); assert(registry['affordable-ownership-need']);
  const explanation = JSON.stringify(registry['affordable-ownership-need']);
  for (const fact of ['80%', '51–100%', 'HAMFI', 'CHAS', '2018–2022', '2020–2024', 'FY2026']) assert(explanation.includes(fact), 'missing methodology fact ' + fact);
  assert(warnings.some(w => w.includes('missing-test-key')), 'development must warn on unknown keys');
  console.log('methodology-registry: PASS (' + checked + ' HTML keys checked)');
} finally { dom.window.close(); }
