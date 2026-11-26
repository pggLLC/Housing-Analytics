# `js/components/ma-pdf.js`

js/components/ma-pdf.js
market-analysis.html and deal-market-analysis.html (rebuilt from it).

"Download PDF" (paul, 24 Nov 2026: "add the pma pdf"): one click saves the whole study as a PDF file. The existing
"Print report" (js/market-analysis/market-report-renderers.js exportReport, formerly "Export Report") stays: it opens
a printable page of the eight report sections.

The PDF holds, in page order, what the screen shows after an analysis:
  1. a cover: the place, the site point, the buffer, the date, the site score and its tier, and the screening note
  2. the map, with the OpenStreetMap credit (and Esri's when the satellite layer is on)
  3. the market area panel: score, capture rate, supply, risk flags, the transit-zone and QCT/DDA lines
  4. the place context, CHFA requirements checklist and Subject Project
  5. the eight report sections, the infrastructure section and the concept recommendation
Each part is a picture of the part on screen (html2canvas, as the Deal Calculator's "Download PDF" does), so every
figure, label and source line in the file is the one on screen. Nothing here works out a figure.

jsPDF is the copy the site's other PDF downloads use (jsdelivr, 2.5.1), loaded on the first click. If either
library cannot load, or the capture fails, the printable page opens instead and the reason is shown.

_No documented symbols — module has a file-header comment only._
