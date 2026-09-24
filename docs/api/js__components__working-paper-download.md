# `js/components/working-paper-download.js`

working-paper-download.js — "Download PDF" / "Download Word (.doc)" for the
working paper.

Restored 2026-09-23. #1804 added this inline in working-paper.html; a merge
that treated that page as a regenerated artifact took main's copy and the
feature merged as a title with no code. It now lives in its own file, which
no generator writes, with only a markup block on the page.

PDF goes through the browser's print dialog: the site's @media print already
strips the chrome, and a 12-section article renders far better that way
than through a client-side PDF layout. Word is the article's own HTML handed
to Word as a .doc — no library; Word, LibreOffice and Google Docs open HTML
saved with that extension. The download controls, buttons and scripts are
stripped so they never end up in the document; figures are whatever the
page shows at download time.

_No documented symbols — module has a file-header comment only._
