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
  const explanation = JSON.stringify(registry['affordable-ownership-need']).replace(/[–−]/g, '-');
  for (const fact of ['80%', '51-100%', 'HAMFI', 'CHAS']) assert(explanation.includes(fact), 'missing methodology fact ' + fact);
  const metadata = file => JSON.parse(fs.readFileSync(file, 'utf8')).meta;
  for (const file of ['data/market/chas_co.json', 'data/hna/place-chas.json']) {
    const meta = metadata(file);
    const vintage = meta.vintage_chas || meta.vintage;
    assert(vintage, file + ' must name its CHAS vintage');
    assert(explanation.includes(vintage.replace(/[–−]/g, '-')), 'CHAS explanation must agree with ' + file);
  }
  for (const file of ['data/co_ami_gap_by_place.json', 'data/co_ami_gap_by_county.json']) {
    const meta = metadata(file);
    assert(Number.isInteger(meta.acs_year) && Number.isInteger(meta.hud_income_limits_year));
    const acsRange = (meta.acs_year - 4) + '-' + meta.acs_year;
    assert(explanation.includes(acsRange), 'ACS five-year range must agree with ' + file);
    assert(explanation.includes('FY' + meta.hud_income_limits_year), 'HUD threshold vintage must agree with ' + file);
  }
  const hud = metadata('data/hud-fmr-income-limits.json');
  assert(Number.isInteger(hud.income_limits_fiscal_year));
  assert(explanation.includes('FY' + hud.income_limits_fiscal_year), 'HUD explanation must agree with the income-limit source');
  assert(warnings.some(w => w.includes('missing-test-key')), 'development must warn on unknown keys');
  console.log('methodology-registry: PASS (' + checked + ' HTML keys checked)');
} finally { dom.window.close(); }
