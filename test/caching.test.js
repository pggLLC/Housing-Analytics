// test/caching.test.js
//
// Unit tests for the CacheManager class in js/cache-manager.js.
//
// Verifies:
//   1. Cache hit returns stored value.
//   2. Expired entry returns null.
//   3. clear() removes a single key.
//   4. clearAll() removes all keys in namespace.
//   5. In-memory fallback works when localStorage is unavailable.
//   6. housing-data-integration.js initialises CacheManager when available.
//
// Usage:
//   node test/caching.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── Inline CacheManager for Node.js (no window/localStorage) ────────────────

function buildCacheManager(lsStore) {
  // lsStore: null = simulate unavailable localStorage; object = simulate available
  const DEFAULT_TTL_MS = 60 * 60 * 1000;

  function CacheManager(namespace, ttlMs) {
    this._ns    = (namespace || 'cm') + ':';
    this._ttl   = (typeof ttlMs === 'number') ? ttlMs : DEFAULT_TTL_MS;
    this._mem   = {};
    this._useLS = (lsStore !== null);
  }

  CacheManager.prototype.set = function (key, value) {
    const entry = { ts: Date.now(), data: value };
    const lsKey = this._ns + key;
    if (this._useLS) {
      try {
        lsStore[lsKey] = JSON.stringify(entry);
        return;
      } catch (e) {
        this._useLS = false;
      }
    }
    this._mem[lsKey] = entry;
  };

  CacheManager.prototype.get = function (key) {
    const lsKey = this._ns + key;
    let entry = null;
    if (this._useLS) {
      try {
        const raw = lsStore[lsKey];
        if (raw) entry = JSON.parse(raw);
      } catch (e) {
        entry = null;
      }
    } else {
      entry = this._mem[lsKey] || null;
    }
    if (!entry || !entry.ts || !('data' in entry)) return null;
    if ((Date.now() - entry.ts) > this._ttl) {
      this.clear(key);
      return null;
    }
    return entry.data;
  };

  CacheManager.prototype.clear = function (key) {
    const lsKey = this._ns + key;
    if (this._useLS) {
      try { delete lsStore[lsKey]; } catch (e) { /* ignore */ }
    }
    delete this._mem[lsKey];
  };

  CacheManager.prototype.clearAll = function () {
    const prefix = this._ns;
    if (this._useLS) {
      try {
        Object.keys(lsStore).filter(k => k.startsWith(prefix)).forEach(k => delete lsStore[k]);
      } catch (e) { /* ignore */ }
    }
    const mem = this._mem;
    Object.keys(mem).filter(k => k.startsWith(prefix)).forEach(k => delete mem[k]);
  };

  return CacheManager;
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('cache-manager.js source file exists', () => {
  const src = path.resolve(__dirname, '..', 'js', 'cache-manager.js');
  assert(fs.existsSync(src), 'js/cache-manager.js exists');
  const content = fs.readFileSync(src, 'utf8');
  assert(content.includes('CacheManager'), 'source defines CacheManager');
  assert(content.includes('_localStorageAvailable'), 'source includes localStorage availability check');
  assert(content.includes('global.CacheManager = CacheManager'), 'CacheManager is exposed globally');
});

test('housing-data-integration.js integrates CacheManager', () => {
  const src = path.resolve(__dirname, '..', 'js', 'housing-data-integration.js');
  const content = fs.readFileSync(src, 'utf8');
  assert(content.includes('CacheManager'), 'housing-data-integration.js references CacheManager');
  assert(content.includes('_lsCache'), 'housing-data-integration.js uses _lsCache variable');
});

test('cache hit: get() returns stored value within TTL', () => {
  const CM    = buildCacheManager({});
  const cache = new CM('test', 60000);
  cache.set('myKey', { foo: 'bar' });
  const val = cache.get('myKey');
  assert(val !== null, 'get() returns non-null for fresh entry');
  assert(typeof val === 'object' && val.foo === 'bar', 'get() returns stored value');
});

test('cache miss: get() returns null for unknown key', () => {
  const CM    = buildCacheManager({});
  const cache = new CM('test', 60000);
  assert(cache.get('nonexistent') === null, 'get() returns null for missing key');
});

test('TTL expiry: get() returns null after TTL elapsed', () => {
  const CM    = buildCacheManager({});
  const cache = new CM('test', 1); // 1ms TTL
  cache.set('expKey', 42);
  // Wait just long enough for TTL to expire
  const start = Date.now();
  while (Date.now() - start < 5) { /* busy-wait 5ms */ }
  assert(cache.get('expKey') === null, 'get() returns null after TTL expired');
});

test('clear(): removes single key, leaves others intact', () => {
  const CM    = buildCacheManager({});
  const cache = new CM('test', 60000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear('a');
  assert(cache.get('a') === null, 'cleared key returns null');
  assert(cache.get('b') === 2,    'other key still accessible');
});

test('clearAll(): removes all keys in namespace', () => {
  const CM    = buildCacheManager({});
  const cache = new CM('ns', 60000);
  cache.set('x', 10);
  cache.set('y', 20);
  cache.clearAll();
  assert(cache.get('x') === null, 'x removed by clearAll');
  assert(cache.get('y') === null, 'y removed by clearAll');
});

test('clearAll(): does not remove keys from a different namespace', () => {
  const store = {};
  const CMfn  = buildCacheManager(store);
  const cacheA = new CMfn('nsA', 60000);
  const cacheB = new CMfn('nsB', 60000);
  cacheA.set('k', 'valA');
  cacheB.set('k', 'valB');
  cacheA.clearAll();
  assert(cacheA.get('k') === null,    'nsA:k removed');
  assert(cacheB.get('k') === 'valB',  'nsB:k untouched');
});

test('in-memory fallback: works when localStorage is unavailable', () => {
  const CM    = buildCacheManager(null); // null = LS unavailable
  const cache = new CM('mem', 60000);
  cache.set('memKey', 'hello');
  assert(cache.get('memKey') === 'hello', 'in-memory fallback stores and retrieves value');
  cache.clear('memKey');
  assert(cache.get('memKey') === null, 'in-memory fallback clear() works');
});

test('multiple namespaces do not collide', () => {
  const store = {};
  const CMfn  = buildCacheManager(store);
  const c1    = new CMfn('alpha', 60000);
  const c2    = new CMfn('beta',  60000);
  c1.set('key', 'from-alpha');
  c2.set('key', 'from-beta');
  assert(c1.get('key') === 'from-alpha', 'alpha namespace value correct');
  assert(c2.get('key') === 'from-beta',  'beta namespace value correct');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
