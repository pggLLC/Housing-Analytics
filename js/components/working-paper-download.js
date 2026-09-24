/**
 * working-paper-download.js — "Download PDF" / "Download Word (.doc)" for the
 * working paper.
 *
 * Restored 2026-09-23. #1804 added this inline in working-paper.html; a merge
 * that treated that page as a regenerated artifact took main's copy and the
 * feature merged as a title with no code. It now lives in its own file, which
 * no generator writes, with only a markup block on the page.
 *
 * PDF goes through the browser's print dialog: the site's @media print already
 * strips the chrome, and a 12-section article renders far better that way
 * than through a client-side PDF layout. Word is the article's own HTML handed
 * to Word as a .doc — no library; Word, LibreOffice and Google Docs open HTML
 * saved with that extension. The download controls, buttons and scripts are
 * stripped so they never end up in the document; figures are whatever the
 * page shows at download time.
 */
(function (global) {
  'use strict';

  var FILENAME = 'instrumenting-housing-need-working-paper.doc';

  function buildWordDocument(doc) {
    doc = doc || global.document;
    var article = doc.querySelector('article.wp');
    if (!article) return null;
    var clone = article.cloneNode(true);
    clone.querySelectorAll('.wp-actions, button, script').forEach(function (n) { n.remove(); });
    var h1 = doc.querySelector('article.wp h1');
    var title = (h1 && h1.textContent) || doc.title || 'Working paper';
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
      '<head><meta charset="utf-8"><title>' + title.replace(/</g, '&lt;') + '</title>' +
      '<style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.45;max-width:7in;margin:1in auto}' +
      'h1{font-size:22pt}h2{font-size:15pt;margin-top:18pt}h3{font-size:12pt}' +
      'table{border-collapse:collapse}td,th{border:1px solid #999;padding:3pt 6pt;font-size:10pt}' +
      'code{font-family:Consolas,monospace;font-size:10pt}dt{font-weight:bold;margin-top:8pt}</style></head>' +
      '<body>' + clone.innerHTML + '</body></html>';
  }

  function downloadWord(doc) {
    doc = doc || global.document;
    var html = buildWordDocument(doc);
    if (!html) return false;
    var blob = new global.Blob(['﻿', html], { type: 'application/msword' });
    var url = global.URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = FILENAME;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  function init(doc) {
    doc = doc || global.document;
    var pdfBtn = doc.getElementById('wpDownloadPdf');
    var docBtn = doc.getElementById('wpDownloadWord');
    if (pdfBtn) pdfBtn.addEventListener('click', function () { global.print(); });
    if (docBtn) docBtn.addEventListener('click', function () { downloadWord(doc); });
    return !!(pdfBtn || docBtn);
  }

  global.WorkingPaperDownload = { init: init, buildWordDocument: buildWordDocument, downloadWord: downloadWord, FILENAME: FILENAME };
  global.__wpBuildWordDocument = function () { return buildWordDocument(global.document); };

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
