/*
 * The member bar on the Deal Calculator, on the member site only: who is signed in, back to the member home, Save to
 * workbook, Sign out, and the carry to Submittal review. Its two scripts are in js/whitepaper/, which only the member
 * site serves. js/navigation.js loaded them (loadMemberCalculator) until the calculator moved into the site shell
 * (HA #3013), which does not load navigation.js; this does the same job here (member live check, 26 Nov 2026: no
 * "Save to workbook" on the member calculator).
 */
(function () {
  'use strict';
  if (!/\.workers\.dev$/.test(String(location.hostname || ''))) return;
  try { if (window.top !== window) return; } catch (e) { return; } // the workbook's hidden calculator frame
  if (document.querySelector('script[data-member-calculator]')) return;
  ['js/whitepaper/submittal-review.js', 'js/whitepaper/member-calculator.js'].forEach(function (src) {
    var s = document.createElement('script');
    s.async = false; // in order: the bar reads the review's export reader
    s.src = src;
    s.setAttribute('data-member-calculator', '');
    document.head.appendChild(s);
  });
})();
