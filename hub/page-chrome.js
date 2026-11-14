// The hub's header, menu and footer on a page of the site's own that is not a hub page: the place profiles
// (places/<geoid>.html), which keep their own addresses and their own words and figures.
//
// The page carries the same header and footer markup the hub pages do and loads, in order:
//   <script>window.LAB_ROOT = '../';</script>, hub/lab-config.js, this file, hub/nav.js.
// hub/nav.js draws the five menus into #site-nav exactly as it does on a hub page; hub/shell.js (the hubs' router)
// is not loaded, so this file does the few things shell.js does for the header and footer. Keep the two alike.
(function (global) {
  'use strict';

  var ROOT = global.LAB_ROOT || '';

  // hub/nav.js asks the shell for its escaper and nothing else.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  if (!global.LabShell) global.LabShell = { esc: esc };

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  ready(function () {
    var html = document.documentElement;

    // Light or dark: follows the device until the reader picks one; the pick is kept (the site's own key).
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      var mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
      var isDark = function () { return html.classList.contains('dark-mode') || (!html.classList.contains('light-mode') && !!(mq && mq.matches)); };
      var label = function () { var d = isDark(); btn.textContent = d ? 'Light' : 'Dark'; btn.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode'); btn.setAttribute('aria-pressed', String(d)); };
      btn.addEventListener('click', function () {
        var next = isDark() ? 'light' : 'dark';
        html.classList.remove('dark-mode', 'light-mode'); html.classList.add(next + '-mode');
        try { localStorage.setItem('coho-analytics-scheme', next); } catch (e) {}
        label();
      });
      if (mq && mq.addEventListener) mq.addEventListener('change', label);
      label();
    }

    // The phone menu button.
    var toggle = document.querySelector('.menu-toggle'), nav = document.getElementById('site-nav');
    if (toggle && nav) toggle.addEventListener('click', function () { toggle.setAttribute('aria-expanded', String(nav.classList.toggle('open'))); });

    // The skip link lands on the page's words.
    var skip = document.querySelector('.skip-link'), main = document.getElementById('main-content');
    if (skip && main) skip.addEventListener('click', function (ev) { ev.preventDefault(); main.setAttribute('tabindex', '-1'); main.focus(); });

    // The menu a page belongs to shows as current (the page names it: <body data-menu="places">).
    var mine = document.body.getAttribute('data-menu');
    if (mine) Array.prototype.forEach.call(document.querySelectorAll('.menu-button'), function (b) { if (b.dataset.menu === mine) b.setAttribute('aria-current', 'true'); });

    // Español: this page through Google Translate, as the site's own link does (js/navigation.js spanishHref).
    var es = document.querySelector('.site-footer a[lang="es"]');
    if (es) es.setAttribute('href', 'https://translate.google.com/translate?sl=en&tl=es&hl=es&u={page}'.replace('{page}', function () { return encodeURIComponent(location.origin + location.pathname); }));

    // Questions or feedback: the form is told which page it was opened from, as on the site's other pages.
    var fb = document.querySelector('.site-footer a[data-feedback]');
    if (fb && fb.getAttribute('href').indexOf('?') < 0) fb.setAttribute('href', fb.getAttribute('href') + '?usp=pp_url&entry.440415848=' + encodeURIComponent(location.pathname));
  });

  global.LabPageChrome = { ROOT: ROOT, esc: esc };
})(window);
