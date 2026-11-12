// Text fit: marks table cells that hold a phrase or a sentence, so text-fit.css gives them room to
// read across instead of one word per line, and links printed as bare web addresses.
// Cells are tagged again whenever a page or its data redraws.
(function () {
  var main = document.getElementById('main');
  if (!main) return;
  function tag() {
    // A web address printed as text is one long word; let it break anywhere rather than push the page wide.
    main.querySelectorAll('a').forEach(function (a) {
      if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/\S{6,}$/.test(a.textContent.trim())) a.classList.add('url-text');
    });
    main.querySelectorAll('table').forEach(function (t) {
      // Fixed-layout tables (the calendar month) set their own column widths and shorten labels on purpose.
      if (getComputedStyle(t).tableLayout === 'fixed') return;
      t.querySelectorAll('td, tbody th').forEach(function (c) {
        var n = c.textContent.trim().length;
        c.classList.toggle('cell-xlong', n > 200);
        c.classList.toggle('cell-long', n > 60 && n <= 200);
        c.classList.toggle('cell-mid', n > 28 && n <= 60);
      });
    });
  }
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; tag(); });
  }).observe(main, { childList: true, subtree: true });
  tag();
})();
