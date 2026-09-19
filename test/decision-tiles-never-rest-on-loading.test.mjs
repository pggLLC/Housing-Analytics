#!/usr/bin/env node
/**
 * No decision tile is ever shown reading "Loading".
 *
 * ── What was wrong ──
 *
 * _paintDecisionStrip() reveals the whole strip as soon as ANY ONE tile has a
 * value (`strip.hidden = !hasValue`), but decided each tile's own visibility
 * with `tile.hidden = !!data.absent && empty` — hiding an empty tile only once
 * its owning renderer had explicitly reported the section absent.
 *
 * The two rules disagree during load. The first tile to report unhides the
 * strip and puts every not-yet-reported tile on screen showing its placeholder
 * — an em dash over the word "Loading" — which reads as a broken metric, not a
 * pending one. It stays that way for as long as its renderer takes.
 *
 * Measured on https://cohoanalytics.com/hna-what-housing-exists.html
 * (place 0828745) on 2026-09-19: the strip appeared at 738ms with four tiles
 * reading "— Loading"; three resolved at 1.2s; "20-yr production need" sat
 * visible and stuck until 17.6s. A beta tester reported exactly that row.
 *
 * ── How this guard works ──
 *
 * It extracts the SHIPPED _paintDecisionStrip out of js/hna/hna-renderers.js
 * and RUNS it over a minimal fake DOM, then reads the resulting `hidden` flags.
 * It asserts the invariant a viewer actually cares about — nothing visible is
 * empty — rather than pinning the expression that implements it, so a future
 * rewrite that keeps the promise still passes.
 *
 * The converse is asserted too: a tile WITH a value must be shown. Without it
 * this guard would pass against code that hides the entire strip forever.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');

function extract(name) {
  let i = SRC.indexOf('function ' + name + '(');
  assert.ok(i >= 0, `${name}() is gone from hna-renderers.js — this guard is checking nothing`);
  if (SRC.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') { depth -= 1; if (!depth) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const DEFAULTS_SRC = (() => {
  const i = SRC.indexOf('const DECISION_STRIP_DEFAULTS');
  assert.ok(i >= 0, 'DECISION_STRIP_DEFAULTS is gone — this guard is checking nothing');
  return SRC.slice(i, SRC.indexOf('};', i) + 2);
})();

/** The smallest DOM _paintDecisionStrip needs: one anchor per tile. */
function fakeDom(keys) {
  const tiles = {};
  const texts = {};
  keys.forEach((k) => {
    tiles[k] = {
      hidden: false,
      _attrs: {},
      setAttribute(n, v) { this._attrs[n] = v; },
      removeAttribute(n) { delete this._attrs[n]; },
      getAttribute(n) { return this._attrs[n]; },
    };
    const cap = k.charAt(0).toUpperCase() + k.slice(1);
    texts['decision' + cap + 'Value'] = { textContent: '' };
    texts['decision' + cap + 'Read'] = { textContent: '' };
  });
  const strip = {
    hidden: true,
    querySelector(sel) {
      const m = /\[data-decision-key="([^"]+)"\]/.exec(sel);
      return (m && tiles[m[1]]) || null;
    },
  };
  const document = {
    getElementById: (id) => (id === 'hnaDecisionStrip' ? strip : (texts[id] || null)),
  };
  return { strip, tiles, texts, document };
}

function paint(patch) {
  const defaults = new Function(`${DEFAULTS_SRC}; return DECISION_STRIP_DEFAULTS;`)();
  const keys = Object.keys(defaults);
  const dom = fakeDom(keys);
  const stripState = {};
  keys.forEach((k) => { stripState[k] = Object.assign({}, defaults[k], patch[k] || {}); });

  const run = new Function(
    'document', 'window', '__state',
    `${DEFAULTS_SRC}
     function S() { return { state: { decisionStrip: __state } }; }
     function _decisionState() { return __state; }
     function _decisionTone() { return ''; }
     function _resolveAnchor(h) { return h; }
     ${extract('_paintDecisionStrip')}
     return _paintDecisionStrip;`
  );
  run(dom.document, { HNA_VIEW_ANCHORS: {} }, stripState)();
  return dom;
}

const EMPTY = (v) => !v || v === '—' || v === 'Loading';

test('a tile that is still a placeholder is never visible', () => {
  // One tile has reported; the rest have not. This is the state the strip is
  // actually in at 738ms on a real page load.
  const dom = paint({ affordability: { value: '43.6%', read: 'Elevated' } });

  assert.equal(dom.strip.hidden, false, 'a strip with a real value must be shown');

  Object.entries(dom.tiles).forEach(([key, tile]) => {
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    const value = dom.texts['decision' + cap + 'Value'].textContent;
    const read = dom.texts['decision' + cap + 'Read'].textContent;
    if (!tile.hidden) {
      assert.ok(!EMPTY(value),
        `tile "${key}" is visible showing ${JSON.stringify(value)} / ${JSON.stringify(read)} — ` +
        'a card on screen with nothing in it reads as broken, not as pending');
    }
  });
});

test('a tile that has reported a value is shown', () => {
  const dom = paint({ affordability: { value: '43.6%', read: 'Elevated' } });
  assert.equal(dom.tiles.affordability.hidden, false,
    'the tile that has a real number must be visible — otherwise "hide the empty ones" ' +
    'has become "hide everything" and this guard would be vacuous');
  assert.equal(dom.texts.decisionAffordabilityValue.textContent, '43.6%');
});

test('an explicit absence verdict is still shown when it carries text', () => {
  // _scorecardUnavailable() answers "Not scored / Select a jurisdiction".
  // That is a real answer and must reach the viewer.
  const dom = paint({ need: { value: 'Not scored', read: 'Select a jurisdiction', tone: 'unavailable' } });
  assert.equal(dom.tiles.need.hidden, false,
    'absence stated in words is information; only an empty placeholder is hidden');
});
