#!/usr/bin/env node
'use strict';
// A role="list" may own only listitems (WCAG 1.3.1; axe aria-required-children
// is critical). On 2026-10-17 axe found three on the guided path and the
// dashboard: the HNA housing-type need ranking (canonical HNA and "What to do")
// and the Economic Dashboard's binary predictions (that panel has since been
// removed with its module). Each remaining list is rendered here by its
// real module from committed data, and every role=list it produces is checked
// for what it actually contains, so a new list or a new row type is covered too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function checkLists(root, where) {
  const lists = [...root.querySelectorAll('[role="list"]')];
  for (const list of lists) {
    const kids = [...list.children];
    assert(kids.length > 0, `${where}: "${list.getAttribute('aria-label')}" has rows`);
    for (const k of kids) {
      const ok = k.getAttribute('role') === 'listitem' || (k.tagName === 'LI' && !k.hasAttribute('role'));
      assert(ok, `${where}: "${list.getAttribute('aria-label')}" owns a <${k.tagName.toLowerCase()} role="${k.getAttribute('role')}"> instead of a listitem`);
    }
  }
  return lists.length;
}

(async () => {
  // 1. HNA housing-type need ranking, for Fruita from its committed summary.
  {
    const dom = new JSDOM('<!doctype html><body><div id="hnaHousingTypeNeed"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(read('js/components/housing-type-need.js'));
    new w.Function(read('js/hna/hna-renderers.js')).call(w);
    const summary = JSON.parse(read('data/hna/summary/0828745.json'));
    w.HNARenderers.renderHousingTypeNeed(summary);
    const n = checkLists(w.document, 'HNA housing-type need');
    assert(n >= 1, 'the HNA ranking rendered a role=list to check');
  }

  console.log('aria-list-ownership: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
