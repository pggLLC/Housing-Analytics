/**
 * test/fetch-error-surface.test.js — F249
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Minimal DOM stub — just enough for innerHTML + querySelector + addEventListener
class StubElement {
  constructor() {
    this.innerHTML = '';
    this.hidden = false;
    this._listeners = {};
    this._children = [];
  }
  querySelector(sel) {
    if (sel === '.fes-retry' && this.innerHTML.includes('fes-retry')) {
      return new StubElement();
    }
    return null;
  }
  addEventListener(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
  }
}

const moduleSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'components', 'fetch-error-surface.js'),
  'utf8'
);
const win = { console: { warn: () => {} } };
new Function('window', 'console', moduleSrc)(win, win.console);
const FES = win.FetchErrorSurface;

function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { console.error('  ✗ ' + name + '\n    ' + err.message); process.exitCode = 1; }
}

console.log('FetchErrorSurface — F249 fetch failure UI');

run('renders the source label and error message', () => {
  const el = new StubElement();
  FES.render(el, {
    source: 'HUD Fair Market Rent',
    error: new Error('network down')
  });
  assert.ok(el.innerHTML.includes('HUD Fair Market Rent'), 'should show source name');
  assert.ok(el.innerHTML.includes('network down'), 'should show error message');
  assert.strictEqual(el.hidden, false, 'should reveal the element');
});

run('XSS-safe: escapes HTML in source and error', () => {
  const el = new StubElement();
  FES.render(el, {
    source: '<img src=x onerror=alert(1)>',
    error: '"><script>alert(1)</script>'
  });
  assert.ok(!el.innerHTML.includes('<img src=x'), 'should escape <img>');
  assert.ok(!el.innerHTML.includes('<script>'), 'should escape <script>');
  assert.ok(el.innerHTML.includes('&lt;img'), 'should retain escaped content');
});

run('shows last-known value when provided', () => {
  const el = new StubElement();
  FES.render(el, {
    source: 'Zillow ZORI',
    error: new Error('timeout'),
    lastKnownValue: '$1,985 (Denver 2BR)',
    lastKnownDate: '2026-05-22'
  });
  assert.ok(el.innerHTML.includes('Last known value'), 'should label cached value');
  assert.ok(el.innerHTML.includes('$1,985'), 'should show the cached value');
  assert.ok(el.innerHTML.includes('2026-05-22'), 'should show the cached date');
});

run('renders retry button when retryFn provided', () => {
  const el = new StubElement();
  FES.render(el, {
    source: 'Yardi Matrix',
    error: 'failed',
    retryFn: () => {}
  });
  assert.ok(el.innerHTML.includes('fes-retry'), 'should include retry button');
  assert.ok(el.innerHTML.includes('Retry'), 'should label the button');
});

run('renders View raw file link when url provided', () => {
  const el = new StubElement();
  FES.render(el, {
    source: 'CHFA LIHTC inventory',
    error: 'failed',
    url: 'data/affordable-housing/properties.json'
  });
  assert.ok(el.innerHTML.includes('View raw file'), 'should include raw-file link');
  assert.ok(el.innerHTML.includes('data/affordable-housing/properties.json'), 'should link to the URL');
});

run('null target is a no-op (does not throw)', () => {
  FES.render(null, { source: 'test', error: 'test' });
  // No assertion needed — just must not throw
});

console.log('Done.');
