/**
 * hna-narratives.js
 * Responsibility: Narrative text builders and copy generation.
 * Dependencies: window.HNAUtils
 * Exposes: window.HNANarratives
 */
(function () {
  'use strict';

  window.HNANarratives = {
    lihtcSourceInfo: function(source) { return window.HNAUtils.lihtcSourceInfo(source); },
    lihtcPopupHtml: function(p, source) { return window.HNAUtils.lihtcPopupHtml(p, source); },
    generateComplianceReport: function(rows) { return window.HNAUtils.generateComplianceReport(rows); },
  };
})();
