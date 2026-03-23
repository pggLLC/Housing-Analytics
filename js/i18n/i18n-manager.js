/**
 * i18n-manager.js — COHO Analytics Internationalization
 *
 * Lightweight i18n manager supporting English (default) and Spanish.
 * Key-based translation with dot-notation paths, fallback to English,
 * and localStorage persistence of language preference.
 *
 * Usage:
 *   window.i18n.t('hna.projections.title')  → "20-Year Projection" (EN)
 *   window.i18n.setLang('es')               → switches to Spanish
 *   window.i18n.getLang()                   → 'es'
 *
 * Dispatches 'i18nchange' on document when language changes.
 */
(function () {
  'use strict';

  const SUPPORTED_LANGS = ['en', 'es'];
  const DEFAULT_LANG = 'en';
  const STORAGE_KEY = 'coho_lang';
  const DATA_BASE = (typeof window !== 'undefined' && window.__REPO_ROOT)
    ? window.__REPO_ROOT + 'data/i18n/'
    : 'data/i18n/';

  let _translations = {};
  let _fallback = {};
  let _currentLang = DEFAULT_LANG;
  let _loaded = false;
  let _pendingCallbacks = [];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Resolve a dot-notation key against a translations object. */
  function _resolve(obj, key) {
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return (typeof cur === 'string') ? cur : undefined;
  }

  /** Detect preferred language from localStorage, then browser preference. */
  function _detectLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
    } catch (_) { /* ignore */ }
    // Check browser language
    const nav = (typeof navigator !== 'undefined') ? navigator.language || '' : '';
    if (nav.toLowerCase().startsWith('es')) return 'es';
    return DEFAULT_LANG;
  }

  /** Fetch a JSON translation file. */
  async function _fetchLang(lang) {
    const url = DATA_BASE + lang + '.json';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`i18n: failed to load ${url} (${resp.status})`);
    return resp.json();
  }

  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------

  const i18n = {
    /**
     * Translate a key. Falls back to English if key is missing in current lang.
     * @param {string} key - Dot-notation path (e.g. 'hna.projections.title')
     * @param {Object} [vars] - Optional interpolation vars: {name: 'Denver'} fills {{name}}
     * @returns {string}
     */
    t(key, vars) {
      let val = _resolve(_translations, key);
      if (val === undefined) val = _resolve(_fallback, key);
      if (val === undefined) return key; // last resort: return the key itself
      if (vars) {
        Object.keys(vars).forEach(k => {
          val = val.replace(new RegExp(`{{${k}}}`, 'g'), vars[k]);
        });
      }
      return val;
    },

    /** Return the active language code ('en' or 'es'). */
    getLang() {
      return _currentLang;
    },

    /** Return all supported language codes. */
    getSupportedLangs() {
      return SUPPORTED_LANGS.slice();
    },

    /** Switch to a new language and re-render translated elements. */
    async setLang(lang) {
      if (!SUPPORTED_LANGS.includes(lang)) {
        console.warn(`i18n: unsupported language "${lang}"`);
        return;
      }
      if (lang === _currentLang && _loaded) return;

      try {
        const data = await _fetchLang(lang);
        _translations = data;
        _currentLang = lang;
        _loaded = true;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
        document.documentElement.lang = lang;
        document.dispatchEvent(new CustomEvent('i18nchange', { detail: { lang } }));
        i18n._applyToDOM();
      } catch (err) {
        console.error('i18n: language switch failed:', err);
      }
    },

    /** Initialize i18n: detect language, load translations. */
    async init() {
      const lang = _detectLang();
      // Always load English as fallback first
      try {
        _fallback = await _fetchLang(DEFAULT_LANG);
      } catch (err) {
        console.warn('i18n: could not load fallback (en.json):', err);
        _fallback = {};
      }

      if (lang !== DEFAULT_LANG) {
        try {
          _translations = await _fetchLang(lang);
        } catch (err) {
          console.warn(`i18n: could not load ${lang}.json, falling back to English:`, err);
          _translations = _fallback;
        }
      } else {
        _translations = _fallback;
      }

      _currentLang = lang;
      _loaded = true;
      document.documentElement.lang = lang;
      i18n._applyToDOM();

      // Flush any callbacks that were registered before init completed
      _pendingCallbacks.forEach(cb => { try { cb(); } catch (_) { /* ignore */ } });
      _pendingCallbacks = [];
    },

    /**
     * Register a callback to run once i18n is initialized.
     * If already initialized, runs immediately.
     */
    onReady(cb) {
      if (_loaded) { try { cb(); } catch (_) { /* ignore */ } }
      else _pendingCallbacks.push(cb);
    },

    /**
     * Apply translations to DOM elements with data-i18n attributes.
     * Elements can use:
     *   data-i18n="key"               → sets textContent
     *   data-i18n-placeholder="key"   → sets placeholder attribute
     *   data-i18n-aria-label="key"    → sets aria-label attribute
     *   data-i18n-title="key"         → sets title attribute
     */
    _applyToDOM() {
      if (typeof document === 'undefined') return;

      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = i18n.t(key);
        if (val !== key) el.textContent = val;
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const val = i18n.t(key);
        if (val !== key) el.setAttribute('placeholder', val);
      });

      document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        const val = i18n.t(key);
        if (val !== key) el.setAttribute('aria-label', val);
      });

      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const val = i18n.t(key);
        if (val !== key) el.setAttribute('title', val);
      });
    },

    /** Check if translations are loaded. */
    isReady() {
      return _loaded;
    },
  };

  window.i18n = i18n;
})();
