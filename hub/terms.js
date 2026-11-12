// Terms of use (#/terms), linked from the footer on every page. Plain-language terms for the free public
// site, chosen by paul on 1 Nov 2026 (footer option A). Not reviewed by an attorney yet. The paid member
// site needs its own subscription terms; nothing here covers seats or payment.
(function (global) {
  'use strict';

  var Shell = global.LabShell, T = global.LabTpl;
  var UPDATED = '1 November 2026';
  var SECTIONS = [
    { id: 'free', title: 'It’s free', html: 'COHO Analytics is a free reference on Colorado affordable housing, run by pggLLC. Using the site means you accept these terms. If you don’t, please don’t use it.' },
    { id: 'as-is', title: 'It’s as-is', html: 'The site, its data, tools, calculators and downloads are provided “as is” and “as available,” with no warranty of any kind, express or implied, including accuracy, completeness, timeliness, merchantability or fitness for a particular purpose.' },
    { id: 'not-advice', title: 'It’s not advice', html: 'Nothing here is legal, tax, financial, investment, appraisal or engineering advice, or a market study or underwriting that a lender or agency will accept. Calculator results are estimates.' },
    { id: 'data', title: 'Public data ages', html: 'Figures come from public sources such as HUD, Census, CHFA and DOLA. They can be out of date, revised or wrong at the source. Each figure links to its source and date. Confirm program rules, limits and awards with <a href="https://www.chfainfo.com/">CHFA</a>, <a href="https://www.huduser.gov/">HUD</a> or the agency that publishes them, and get your own attorney, accountant or other professional before you rely on anything.' },
    { id: 'liability', title: 'Our liability', html: 'To the fullest extent the law allows, pggLLC and its members, staff and contributors are not liable for any direct, indirect, incidental, consequential or other damages, or for lost profits, credits or awards, arising from your use of the site or your reliance on it. Your use is at your own risk.' },
    { id: 'links', title: 'Links', html: 'Links to other sites are there for convenience. We don’t control or endorse them.' },
    { id: 'changes', title: 'Changes', html: 'We may change the site or these terms at any time. The date at the top shows the latest version.' },
    { id: 'law', title: 'Colorado law', html: 'These terms are governed by Colorado law. Any dispute goes to the state or federal courts in Colorado.' },
    { id: 'privacy', title: 'Privacy', html: 'How the site handles data and cookies is in the <a href="#/privacy">Privacy Policy</a>.' },
    { id: 'questions', title: 'Questions', html: 'Email <a href="mailto:info@cohoanalytics.com">info@cohoanalytics.com</a>.' }
  ];

  function view() {
    return T.head({
      kind: 'guide', crumbs: [{ label: 'Home', href: '#/' }, { label: 'Terms of use' }], title: 'Terms of use',
      answer: 'Free to use, offered as-is, not advice, and at your own risk.', meta: 'Last updated ' + UPDATED
    }) + '<div class="terms">' + SECTIONS.map(function (s) {
      return '<section id="terms-' + s.id + '"><h2>' + Shell.esc(s.title) + '</h2><p>' + s.html + '</p></section>';
    }).join('') + '</div>';
  }

  Shell.views.terms = view;
  global.LabTerms = { SECTIONS: SECTIONS, UPDATED: UPDATED };
})(typeof window !== 'undefined' ? window : globalThis);
