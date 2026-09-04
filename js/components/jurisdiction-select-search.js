/**
 * Progressive search enhancement for jurisdiction <select> controls.
 *
 * The native select remains the source of truth. Search results are built
 * from its live options, matched with HomeJurisdictionSearch, and committed
 * by setting select.value and dispatching one bubbling change event.
 */
(function (root, factory) {
  'use strict';

  var searchApi = null;
  if (typeof module === 'object' && module.exports) {
    searchApi = require('../home-jurisdiction-search.js');
  } else if (root) {
    searchApi = root.HomeJurisdictionSearch;
  }

  var api = factory(searchApi);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JurisdictionSelectSearch = api;
  }
}(typeof window !== 'undefined' ? window : null, function (HomeJurisdictionSearch) {
  'use strict';

  var instanceCount = 0;

  function injectStyles(doc) {
    if (!doc || doc.getElementById('jurisdictionSelectSearchStyles')) return;
    var style = doc.createElement('style');
    style.id = 'jurisdictionSelectSearchStyles';
    style.textContent =
      '.jurisdiction-select-search{position:relative;display:flex;flex-direction:column;gap:4px;min-width:220px;max-width:360px;}' +
      '.jurisdiction-select-search__label{font-size:.78rem;font-weight:700;color:var(--muted,#5f6b76);}' +
      '.jurisdiction-select-search__input{box-sizing:border-box;width:100%;min-height:44px;padding:.5rem .7rem;border:1px solid var(--border,#cbd5e1);border-radius:8px;background:var(--card,#fff);color:var(--text,#17202a);font:inherit;}' +
      '.jurisdiction-select-search__input:focus-visible{outline:3px solid var(--focus-ring,var(--accent,#096e65));outline-offset:2px;}' +
      '.jurisdiction-select-search__list{position:absolute;top:100%;left:0;right:0;z-index:1000;max-height:280px;overflow-y:auto;margin:4px 0 0;padding:4px 0;list-style:none;border:1px solid var(--border,#cbd5e1);border-radius:8px;background:var(--card,#fff);box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.14));}' +
      '.jurisdiction-select-search__option{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;cursor:pointer;}' +
      '.jurisdiction-select-search__option[aria-selected="true"]{background:var(--bg2,#eef4f3);}' +
      '.jurisdiction-select-search__type{color:var(--muted,#5f6b76);font-size:.78rem;white-space:nowrap;}' +
      '.jurisdiction-select-search__selected{min-height:1em;font-size:.76rem;color:var(--muted,#5f6b76);}' +
      '.jurisdiction-select-search__empty{padding:8px 12px;color:var(--muted,#5f6b76);font-style:italic;}';
    (doc.head || doc.documentElement).appendChild(style);
  }

  function associatedLabel(select) {
    if (select.labels && select.labels.length) return select.labels[0];
    var parent = select.parentElement;
    while (parent) {
      if (String(parent.tagName).toLowerCase() === 'label') return parent;
      parent = parent.parentElement;
    }
    var labels = select.ownerDocument.querySelectorAll('label[for]');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].getAttribute('for') === select.id) return labels[i];
    }
    return null;
  }

  function entriesFromSelect(select, fallbackType) {
    var entries = [];
    if (!select || !select.options) return entries;
    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      if (!option.value || option.disabled) continue;
      var name = String(option.textContent || '').trim();
      if (!name) continue;
      var parent = option.parentElement;
      var type = fallbackType || '';
      if (parent && String(parent.tagName).toLowerCase() === 'optgroup') {
        type = parent.label || type;
      }
      entries.push({
        geoid: String(option.value),
        name: name,
        type: type,
        option: option
      });
    }
    return entries;
  }

  function enhance(selectOrId, options) {
    options = options || {};
    var doc = options.document || (selectOrId && selectOrId.ownerDocument) ||
      (typeof document !== 'undefined' ? document : null);
    if (!doc || !HomeJurisdictionSearch ||
        typeof HomeJurisdictionSearch.searchJurisdictions !== 'function') return null;

    var select = typeof selectOrId === 'string' ? doc.getElementById(selectOrId) : selectOrId;
    if (!select || select.__jurisdictionSelectSearch) return select && select.__jurisdictionSelectSearch;

    injectStyles(doc);
    instanceCount += 1;
    var baseId = select.id || ('jurisdictionSelect' + instanceCount);
    var inputId = baseId + 'Search';
    var listId = baseId + 'SearchResults';
    var optionIdPrefix = baseId + 'SearchOption';
    var defaultValue = select.options.length ? String(select.options[0].value || '') : '';
    var fallbackType = options.typeLabel || select.getAttribute('data-jurisdiction-search-type') || '';
    var limit = Number(options.limit || select.getAttribute('data-jurisdiction-search-limit')) || 8;
    var labelText = options.label || select.getAttribute('data-jurisdiction-search-label') || 'Search jurisdictions';
    var placeholder = options.placeholder || select.getAttribute('data-jurisdiction-search-placeholder') || 'Type a jurisdiction name…';

    var wrapper = doc.createElement('div');
    wrapper.className = 'jurisdiction-select-search';
    wrapper.hidden = true;

    var label = doc.createElement('label');
    label.className = 'jurisdiction-select-search__label';
    label.setAttribute('for', inputId);
    label.textContent = labelText;

    var input = doc.createElement('input');
    input.id = inputId;
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.className = 'jurisdiction-select-search__input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');

    var list = doc.createElement('ul');
    list.id = listId;
    list.className = 'jurisdiction-select-search__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Matching jurisdictions');
    list.hidden = true;

    var selected = doc.createElement('div');
    selected.className = 'jurisdiction-select-search__selected';
    selected.setAttribute('aria-live', 'polite');

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(list);
    wrapper.appendChild(selected);

    var nativeLabel = associatedLabel(select);
    var anchor = nativeLabel || select;
    anchor.parentNode.insertBefore(wrapper, anchor);

    var entries = [];
    var results = [];
    var activeIndex = -1;
    var activated = false;

    function close() {
      list.hidden = true;
      list.textContent = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      results = [];
      activeIndex = -1;
    }

    function syncFromSelect() {
      var option = select.options[select.selectedIndex];
      if (option && option.value) {
        input.value = String(option.textContent || '').trim();
        selected.textContent = 'Selected: ' + input.value;
      } else {
        input.value = '';
        selected.textContent = '';
      }
    }

    function activate() {
      if (activated || !entries.length) return;
      activated = true;
      wrapper.hidden = false;
      select.hidden = true;
      select.setAttribute('aria-hidden', 'true');
      select.setAttribute('tabindex', '-1');
      if (nativeLabel) nativeLabel.hidden = true;
      syncFromSelect();
    }

    function syncOptions() {
      entries = entriesFromSelect(select, fallbackType);
      activate();
      if (activated && doc.activeElement !== input) syncFromSelect();
    }

    function setActive(index) {
      activeIndex = index;
      var nodes = list.querySelectorAll('[role="option"]');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
      }
      if (index >= 0 && nodes[index]) {
        input.setAttribute('aria-activedescendant', nodes[index].id);
        if (typeof nodes[index].scrollIntoView === 'function') {
          nodes[index].scrollIntoView({ block: 'nearest' });
        }
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function pick(entry) {
      if (!entry) return;
      select.value = entry.geoid;
      if (select.value !== entry.geoid) return;
      var EventCtor = doc.defaultView && doc.defaultView.Event;
      select.dispatchEvent(new EventCtor('change', { bubbles: true }));
      close();
    }

    function render(query) {
      var q = String(query || '').trim();
      if (!q) {
        close();
        if (select.value !== defaultValue) {
          select.value = defaultValue;
          var EventCtor = doc.defaultView && doc.defaultView.Event;
          select.dispatchEvent(new EventCtor('change', { bubbles: true }));
        } else {
          syncFromSelect();
        }
        return;
      }

      results = HomeJurisdictionSearch.searchJurisdictions(entries, q, limit);
      activeIndex = -1;
      list.textContent = '';
      if (!results.length) {
        var empty = doc.createElement('li');
        empty.className = 'jurisdiction-select-search__empty';
        empty.setAttribute('role', 'presentation');
        empty.textContent = 'No matching options';
        list.appendChild(empty);
      } else {
        results.forEach(function (entry, index) {
          var item = doc.createElement('li');
          item.id = optionIdPrefix + index;
          item.className = 'jurisdiction-select-search__option';
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', 'false');

          var name = doc.createElement('span');
          name.textContent = entry.name;
          item.appendChild(name);
          if (entry.type) {
            var type = doc.createElement('span');
            type.className = 'jurisdiction-select-search__type';
            type.textContent = entry.type;
            item.appendChild(type);
          }
          item.addEventListener('mousedown', function (event) {
            event.preventDefault();
            pick(entry);
          });
          item.addEventListener('mousemove', function () { setActive(index); });
          list.appendChild(item);
        });
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () {
      if (input.value) render(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(close, 150);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (list.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        render(input.value);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (results.length) setActive(Math.min(activeIndex + 1, results.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (results.length) setActive(activeIndex <= 0 ? 0 : activeIndex - 1);
      } else if (event.key === 'Enter') {
        if (activeIndex >= 0 && results[activeIndex]) {
          event.preventDefault();
          pick(results[activeIndex]);
        } else if (results.length === 1) {
          event.preventDefault();
          pick(results[0]);
        }
      }
    });
    select.addEventListener('change', syncFromSelect);

    var Observer = doc.defaultView && doc.defaultView.MutationObserver;
    var observer = Observer ? new Observer(syncOptions) : null;
    if (observer) observer.observe(select, { childList: true, subtree: true });

    var instance = {
      select: select,
      input: input,
      list: list,
      selected: selected,
      refresh: syncOptions,
      close: close
    };
    select.__jurisdictionSelectSearch = instance;
    syncOptions();
    return instance;
  }

  function initBrowser(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    var nodes = doc.querySelectorAll('select[data-jurisdiction-search]');
    var instances = [];
    for (var i = 0; i < nodes.length; i++) {
      var instance = enhance(nodes[i], { document: doc });
      if (instance) instances.push(instance);
    }
    return instances;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { initBrowser(document); });
    } else {
      initBrowser(document);
    }
  }

  return {
    entriesFromSelect: entriesFromSelect,
    enhance: enhance,
    initBrowser: initBrowser
  };
}));
