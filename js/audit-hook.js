/**
 * audit-hook.js
 * Optional non-invasive diagnostics panel.
 * Only activates when the ?audit=1 query parameter is present.
 * Does nothing when the audit param is absent.
 */
(function () {
  if (!/[?&]audit=1/.test(window.location.search)) return;

  var MAX_ENTRIES = 20;
  var log = [];

  // Intercept fetch
  var origFetch = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    addEntry('fetch', url);
    return origFetch.apply(this, arguments);
  };

  // Intercept XHR
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var self = this;
    addEntry('xhr', String(url));
    this.addEventListener('load', function () {
      if (self.status >= 400) markFailed(String(url), self.status);
    });
    this.addEventListener('error', function () {
      markFailed(String(url), 'network error');
    });
    return origOpen.apply(this, arguments);
  };

  function addEntry(type, url) {
    log.unshift({ type: type, url: url, status: null, ts: Date.now() });
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    render();
  }

  function markFailed(url, status) {
    for (var i = 0; i < log.length; i++) {
      if (log[i].url === url && log[i].status === null) {
        log[i].status = status;
        log[i].failed = true;
        break;
      }
    }
    render();
  }

  // Build panel
  var panel = document.createElement('div');
  panel.id = '__audit_panel';
  panel.style.cssText = [
    'position:fixed', 'bottom:0', 'right:0', 'z-index:999999',
    'width:420px', 'max-height:320px', 'overflow-y:auto',
    'background:rgba(20,20,20,0.92)', 'color:#e8e8e8',
    'font:12px/1.5 monospace', 'padding:8px',
    'border-top-left-radius:6px', 'box-shadow:0 -2px 12px rgba(0,0,0,0.4)',
  ].join(';');

  var header = document.createElement('div');
  header.style.cssText = 'font-weight:bold;margin-bottom:4px;color:#7ec8e3';
  header.textContent = '🔍 Audit Panel (last ' + MAX_ENTRIES + ' requests)';

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'float:right;background:none;border:none;color:#e8e8e8;cursor:pointer;font-size:14px;';
  closeBtn.onclick = function () { panel.remove(); };
  header.appendChild(closeBtn);

  var list = document.createElement('ul');
  list.style.cssText = 'list-style:none;margin:0;padding:0;';

  panel.appendChild(header);
  panel.appendChild(list);

  function render() {
    list.innerHTML = '';
    log.forEach(function (entry) {
      var li = document.createElement('li');
      li.style.cssText = 'padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.08);word-break:break-all;';
      var badge = entry.failed ? '❌' : '✔';
      var color = entry.failed ? '#ff6b6b' : '#a8e6a3';
      li.innerHTML =
        '<span style="color:' + color + '">' + badge + '</span> ' +
        '<span style="color:#aaa">[' + entry.type.toUpperCase() + ']</span> ' +
        truncate(entry.url, 60) +
        (entry.status ? ' <span style="color:#ffcc00">(' + entry.status + ')</span>' : '');
      list.appendChild(li);
    });
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  // Attach panel after DOM is ready
  function attach() {
    document.body.appendChild(panel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
