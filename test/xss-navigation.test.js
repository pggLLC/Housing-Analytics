'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js', 'navigation.js'), 'utf8');

function renderNavigation(options) {
  const dom = new JSDOM('<main id="main-content"></main>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/index.html'
  });
  const active = {
    id: options.activeId || 'active-project',
    jurisdiction: options.jurisdiction
  };
  dom.window.WorkflowState = {
    getActiveProject: function () { return active; },
    listProjects: function () { return options.projects || []; },
    loadProject: function () {}
  };
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

function openProjectSwitcher(dom) {
  const wrap = dom.window.document.getElementById('jurisdictionPillWrap');
  wrap.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return wrap.querySelector('.jx-dropdown');
}

const normalDom = renderNavigation({
  jurisdiction: {
    name: 'Mesa County',
    type: 'city',
    displayName: 'Grand Junction (city)'
  },
  projects: [{ id: 'project-1', name: 'Normal project' }]
});
assert.strictEqual(
  normalDom.window.document.querySelector('.jurisdiction-pill__name').textContent,
  'Mesa County · Grand Junction',
  'normal jurisdiction text renders unchanged'
);
const normalDropdown = openProjectSwitcher(normalDom);
assert.strictEqual(
  normalDropdown.querySelector('[data-proj-id]').outerHTML,
  '<button class="jx-dropdown__item" data-proj-id="project-1">Normal project</button>',
  'normal project markup renders byte-identically'
);

const hostileText = '<tag data-note="quoted">A & B</tag>';
const longName = 'A'.repeat(26) + '&BCDEFGHIJKLMNOP';
const hostileDom = renderNavigation({
  jurisdiction: { name: hostileText },
  projects: [{ id: hostileText, name: longName }]
});

const pill = hostileDom.window.document.querySelector('.jurisdiction-pill__name');
assert.strictEqual(pill.textContent, hostileText, 'escaped jurisdiction keeps its visible text');
assert.strictEqual(pill.querySelector('tag'), null, 'jurisdiction text does not become markup');
assert(
  pill.innerHTML.includes('&lt;tag data-note="quoted"&gt;A &amp; B&lt;/tag&gt;'),
  'jurisdiction HTML meta-characters are escaped'
);

const hostileDropdown = openProjectSwitcher(hostileDom);
const projectButton = hostileDropdown.querySelector('[data-proj-id]');
assert(projectButton, 'hostile project ID remains a single selectable project');
assert.strictEqual(
  projectButton.getAttribute('data-proj-id'),
  hostileText,
  'escaped project ID round-trips through the data attribute'
);
assert.strictEqual(projectButton.attributes.length, 2, 'project ID cannot inject another attribute');
assert.strictEqual(projectButton.querySelector('tag'), null, 'project ID cannot inject markup');
assert(
  projectButton.outerHTML.includes('data-proj-id="<tag data-note=&quot;quoted&quot;>A &amp; B</tag>"'),
  'project ID is escaped in attribute context: ' + projectButton.outerHTML
);

const expectedTruncatedName = 'A'.repeat(26) + '&B';
assert.strictEqual(
  projectButton.textContent,
  expectedTruncatedName,
  'project name is sliced to 28 characters before escaping'
);
assert(
  projectButton.innerHTML.endsWith('&amp;B'),
  'truncated project name retains a complete ampersand entity'
);

console.log('xss-navigation: PASS');
