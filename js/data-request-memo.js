// js/data-request-memo.js
//
// One download per data file per page view.
//
// The Housing Needs Assessment is fed by many independent loaders
// (fetch-helper, the data service, chart renderers, map layers). Several of
// them ask for the same file: on a phone, the Fruita full report fetched
// ranking-index.json five times, qct-colorado.json and dda-colorado.json five
// times each, and about 3 MB of its 8 MB was repeat downloads (Codex audit
// F9, 31 Oct 2026). The browser's HTTP cache did not absorb them.
//
// This keeps the first response for a same-origin GET of a file under data/
// and hands every later caller its own copy (Response.clone()), so each
// caller still reads a fresh, unread body and parses its own object. Nothing
// else changes:
//   - other hosts, non-GET requests and anything outside data/ pass through;
//   - the first request for a file keeps the caller's cache mode, so a
//     loader that asks for 'no-store' (so a rebuilt file shows on reload)
//     still gets a network copy; later callers in the same page view share
//     that copy. A new page view always starts empty;
//   - a failed or non-OK response is not kept, so a retry goes to the network;
//   - a caller's own AbortSignal still aborts that caller's promise.
// The memo lasts for this page view only.
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window.__dataRequestMemo) return;

  var innerFetch = window.fetch;
  var memo = Object.create(null);

  function memoKey(input, init) {
    if (typeof Request !== 'undefined' && input instanceof Request) return null;
    var method = (init && init.method ? String(init.method) : 'GET').toUpperCase();
    if (method !== 'GET') return null;
    if (init && init.body != null) return null;
    var url;
    try { url = new URL(String(input), window.location.href); } catch (e) { return null; }
    if (url.origin !== window.location.origin) return null;
    if (!/(^|\/)data\//.test(url.pathname)) return null;
    // ?v=<data version> is a cache-buster for the same file, so a request
    // with it and one without it share one copy.
    url.searchParams.delete('v');
    return url.pathname + url.search;
  }

  function forCaller(key, shared, signal) {
    var copy = shared.then(function (res) { return res.clone(); });
    if (!signal) return copy;
    return new Promise(function (resolve, reject) {
      function abortError() {
        try { return new DOMException('The operation was aborted.', 'AbortError'); }
        catch (e) { var err = new Error('The operation was aborted.'); err.name = 'AbortError'; return err; }
      }
      if (signal.aborted) { reject(abortError()); return; }
      signal.addEventListener('abort', function () {
        // A caller that gives up (usually a timeout) will retry. Let the
        // retry start a new request instead of joining one that may hang.
        if (memo[key] === shared && !shared.__settled) delete memo[key];
        reject(abortError());
      }, { once: true });
      copy.then(resolve, reject);
    });
  }

  function memoFetch(input, init) {
    var key = memoKey(input, init);
    if (!key) return innerFetch.apply(this, arguments);
    var shared = memo[key];
    if (!shared) {
      // The shared request carries no caller's signal, so one caller timing
      // out cannot cancel the file for the others.
      var sharedInit = init ? Object.assign({}, init) : undefined;
      if (sharedInit) delete sharedInit.signal;
      shared = memo[key] = innerFetch.call(this, input, sharedInit).then(function (res) {
        if (!res || !res.ok) { if (memo[key] === shared) delete memo[key]; }
        else if (typeof res.clone === 'function') {
          // fetch() resolves once the headers arrive. If the body then fails
          // (a connection dropped mid-download), every later clone would
          // fail the same way for the rest of the page view, so a retry
          // could never recover. Read one copy through; on failure, forget
          // it so the next caller goes back to the network.
          try {
            res.clone().arrayBuffer().then(null, function () {
              if (memo[key] === shared) delete memo[key];
            });
          } catch (e) {
            if (memo[key] === shared) delete memo[key];
          }
        }
        return res;
      }, function (err) {
        if (memo[key] === shared) delete memo[key];
        throw err;
      });
      shared.then(function () { shared.__settled = true; }, function () { shared.__settled = true; });
    }
    return forCaller(key, shared, init && init.signal);
  }

  window.fetch = memoFetch;
  window.__dataRequestMemo = {
    size: function () { return Object.keys(memo).length; },
    _keyForTest: memoKey
  };
})();
