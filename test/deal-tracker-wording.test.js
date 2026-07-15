#!/usr/bin/env node
// test/deal-tracker-wording.test.js
//
// Phase 2.2: keep the public "Affordable Housing Pipeline" methodology
// distinct from the gated internal Deal Tracker affordance.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PUBLIC_MOUNTS = [
  { page: 'compare.html', mountId: 'cmpDealTrackerMount' },
  { page: 'deal-calculator.html', mountId: 'dcDealTrackerMount' },
  { page: 'market-analysis.html', mountId: 'pmaDealTrackerMount' }
];

function scriptsFor(html) {
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1].includes('PipelineAddButton.attach') && match[1].includes('_isIBAuthed')) {
      scripts.push(match[1]);
    }
  }
  return scripts;
}

function runHydrator({ page, mountId, body, beforeEval }) {
  const html = read(page);
  const scripts = scriptsFor(html);
  assert.equal(scripts.length, 1, `${page} has exactly one gated Deal Tracker hydration script`);

  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
    url: `https://cohoanalytics.com/${page}`,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const calls = [];
  window.PipelineAddButton = {
    attach(container, opts) {
      calls.push({ id: container && container.id, opts });
    }
  };
  window.PipelineStore = {};
  if (beforeEval) beforeEval(window);
  window.eval(scripts[0]);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPipelineStore({ beforeEval, fetchImpl }) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://127.0.0.1/developer-pipeline.html',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.fetch = fetchImpl;
  if (beforeEval) beforeEval(window);
  window.eval(read('js/components/pipeline-store.js'));
  return window;
}

for (const { page, mountId } of PUBLIC_MOUNTS) {
  const html = read(page);

  assert(!html.includes('Developer Pipeline add button'), `${page} no longer labels the gated mount Developer Pipeline`);
  assert(!html.includes('Add to Developer Pipeline'), `${page} no longer contains the old gated button label`);
  assert(!html.includes('Deal Tracker'), `${page} does not expose the renamed internal label in public HTML`);
  assert(html.includes(`id="${mountId}"`), `${page} uses the renamed ${mountId} mount`);

  const { window, calls } = runHydrator({
    page,
    mountId,
    body: `<div id="${mountId}">stale gated content</div>`
  });

  assert.equal(calls.length, 0, `${page} does not attach Deal Tracker for logged-out visitors`);
  assert.equal(
    window.document.getElementById(mountId).innerHTML,
    '',
    `${page} clears the gated Deal Tracker mount for logged-out visitors`
  );
}

const authed = (window) => {
  window.sessionStorage.setItem('ib-auth-v1', JSON.stringify({ ts: Date.now() }));
};

{
  const { calls } = runHydrator({
    page: 'compare.html',
    mountId: 'cmpDealTrackerMount',
    body: `
      <div id="cmpDealTrackerMount"></div>
      <table><thead><tr id="cmpHeadRow">
        <th><button class="cmp-rmBtn" data-geoid="0804000"></button><span class="cmp-name">Aurora</span></th>
      </tr></thead></table>`,
    beforeEval: authed
  });
  assert(calls.length >= 1, 'compare.html attaches Deal Tracker when authed and a comparison jurisdiction exists');
  assert.equal(calls[0].id, 'cmpDealTrackerMount');
  assert.deepEqual(plain(calls[0].opts), {
    jurisdiction: 'Aurora',
    geoid: '0804000',
    defaults: { stage: 'Signal', notes: 'From Compare · top of set' }
  });
}

for (const { page, mountId, expectedNotes } of [
  { page: 'deal-calculator.html', mountId: 'dcDealTrackerMount', expectedNotes: 'From Deal Calculator · Aurora' },
  { page: 'market-analysis.html', mountId: 'pmaDealTrackerMount', expectedNotes: 'From Market Analysis · Aurora' }
]) {
  const { calls } = runHydrator({
    page,
    mountId,
    body: `<div id="${mountId}"></div>`,
    beforeEval(window) {
      authed(window);
      window.WorkflowState = {
        getActiveProject() {
          return { jurisdiction: { type: 'city', placeGeoid: '0804000', displayName: 'Aurora (city)' } };
        }
      };
    }
  });
  assert(calls.length >= 1, `${page} attaches Deal Tracker when authed and a jurisdiction exists`);
  assert.equal(calls[0].id, mountId);
  assert.deepEqual(plain(calls[0].opts), {
    jurisdiction: 'Aurora',
    geoid: '0804000',
    defaults: { stage: 'Signal', notes: expectedNotes }
  });
}

const component = read('js/components/pipeline-add-button.js');
assert(component.includes('+ Add to Deal Tracker'), 'gated button now says Add to Deal Tracker');
assert(component.includes('In Deal Tracker'), 'canonical state now says In Deal Tracker');
assert(!component.includes('Add to Developer Pipeline'), 'component no longer uses the old internal feature label');
assert(!component.includes('+ Add to Pipeline'), 'component no longer uses the ambiguous short pipeline label');
assert(!component.includes('Deal Tracker page'), 'save confirmations do not point at the removed Deal Tracker page');
assert(component.includes('Export from the Pipeline page'), 'save confirmations point users to the Pipeline page drafts/export surface');

(async () => {
  const draft = {
    jurisdiction: 'Aurora',
    geoid: '0804000',
    stage: 'Signal',
    ioi_score: '72',
    confidence: 'high',
    classification: 'A',
    product_type: '',
    last_update: '',
    next_action: 'Call housing staff',
    next_action_due: '',
    notes: ''
  };
  const draftKey = 'coho_developer_pipeline_drafts_v1';
  const syncedKey = 'coho_developer_pipeline_synced_v1';

  {
    const calls = [];
    const window = loadPipelineStore({
      beforeEval(win) {
        win.localStorage.setItem(draftKey, JSON.stringify([draft]));
      },
      fetchImpl(url, opts) {
        calls.push({ url: String(url), method: opts && opts.method });
        return Promise.resolve({ ok: false, status: 404 });
      }
    });
    await window.PipelineStore.ready;
    assert.equal(window.PipelineStore.getDrafts().length, 1, 'ungated /api/pipeline 404 keeps local drafts');
    assert.equal(window.localStorage.getItem(syncedKey), null, 'ungated /api/pipeline 404 does not mark the device synced');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'ungated /api/pipeline 404 does not push a false empty sync');
  }

  {
    const window = loadPipelineStore({
      beforeEval(win) {
        win.localStorage.setItem(draftKey, JSON.stringify([draft]));
        win.localStorage.setItem(syncedKey, '1');
      },
      fetchImpl() {
        return Promise.resolve({ ok: false, status: 404 });
      }
    });
    await window.PipelineStore.ready;
    assert.equal(window.PipelineStore.getDrafts().length, 1, 'ungated /api/pipeline 404 keeps local drafts even after a prior sync flag');
  }

  const hna = read('housing-needs-assessment.html');
  const opportunityFinder = read('lihtc-opportunity-finder.html');
  for (const [label, html] of [
    ['housing-needs-assessment.html', hna],
    ['lihtc-opportunity-finder.html', opportunityFinder]
  ]) {
    assert(
      html.includes('The Affordable Housing Pipeline') && html.includes('pipeline.html'),
      `${label} keeps the public Affordable Housing Pipeline methodology teaser`
    );
  }

  console.log('Deal Tracker wording and public gating: PASS');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
