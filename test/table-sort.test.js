// Every data table sorts by its headers (paul, 2026-10-18), and a header's
// definition is reached from the header itself rather than a separate
// circled "i" glyph. Drives js/components/table-sort.js and
// table-header-tips.js together in jsdom:
//   1. a plain table gets an arrow per header and sorts asc → desc → original,
//      numbers as numbers, blanks last, .total rows pinned;
//   2. tables that are not data tables (two rows, merged cells, opted out)
//      are left alone;
//   3. a table a renderer already sorts keeps the renderer's sort: the arrow
//      only clicks the header, and no DOM sort runs on top of it;
//   4. on touch, a tap on a header with a definition opens the definition
//      and does not sort; the arrow still sorts;
//   5. every page that loads the definitions loads the sorter too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sortSrc = read('js/components/table-sort.js');
const tipsSrc = read('js/components/table-header-tips.js');

const html = `<!doctype html><body>
<table id="plain"><thead><tr><th>Name</th><th data-tip="Homes in the development, restricted and unrestricted.">Units</th><th>Cost</th></tr></thead>
<tbody>
<tr><td>Bravo</td><td>120</td><td>$1.2M</td></tr>
<tr><td>alpha</td><td>—</td><td>$950,000</td></tr>
<tr><td>Charlie</td><td>44</td><td>$2.0M</td></tr>
<tr><td>Delta</td><td>1,050</td><td>(5)</td></tr>
<tr class="total"><td>Total</td><td>1,214</td><td>—</td></tr>
</tbody></table>
<table id="short"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>
<table id="merged"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td colspan="2">x</td></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>
<table id="optout" data-no-sort><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr><tr><td>5</td><td>6</td></tr></tbody></table>
<table id="ownaria"><thead><tr><th data-sort="a" aria-sort="descending">A</th><th data-sort="b">B</th></tr></thead><tbody><tr><td>2</td><td>x</td></tr><tr><td>1</td><td>y</td></tr><tr><td>3</td><td>z</td></tr></tbody></table>
<table id="dates"><thead><tr><th>Date</th><th>Action</th></tr></thead><tbody>
<tr><td>3 Mar 2025</td><td>a</td></tr><tr><td>10 Aug 2026</td><td>b</td></tr><tr><td>10 Dec 2025</td><td>c</td></tr><tr><td>14 Jan 2026</td><td>d</td></tr></tbody></table>
<table id="iconown"><thead><tr><th class="pres-th sortable" aria-sort="none">Expiration <span class="sort-icon">↑</span></th><th class="pres-th sortable" aria-sort="none">Property</th></tr></thead><tbody><tr><td>1</td><td>x</td></tr><tr><td>2</td><td>y</td></tr><tr><td>3</td><td>z</td></tr></tbody></table>
<table id="own"><thead><tr><th data-col="a">A</th><th data-col="b">B</th></tr></thead><tbody><tr><td>2</td><td>x</td></tr><tr><td>1</td><td>y</td></tr><tr><td>3</td><td>z</td></tr></tbody></table>
</body>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ tips: {} }) });
let ownClicks = 0;
// Like lihtc-opportunity-finder.js: the renderer writes aria-sort itself.
document.querySelectorAll('#ownaria th').forEach((th) => th.addEventListener('click', () => {
  document.querySelectorAll('#ownaria th').forEach((h) => h.removeAttribute('aria-sort'));
  th.setAttribute('aria-sort', 'ascending');
}));
document.querySelectorAll('#own th').forEach((th) => th.addEventListener('click', () => {
  ownClicks++;
  // Like chfa-portfolio.html: direction is marked only with classes.
  const asc = !th.classList.contains('sort-asc');
  document.querySelectorAll('#own th').forEach((h) => h.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(asc ? 'sort-asc' : 'sort-desc');
}));
window.eval(tipsSrc);
window.eval(sortSrc);

const col = (id, i) => Array.from(document.querySelectorAll(`#${id} tbody tr`)).map((r) => r.cells[i].textContent);
const tick = () => new Promise((r) => setTimeout(r, 120));
const mouse = (el) => {
  const pd = new window.Event('pointerdown', { bubbles: true });
  Object.defineProperty(pd, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(pd);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const touchTap = (el) => {
  const pd = new window.Event('pointerdown', { bubbles: true });
  Object.defineProperty(pd, 'pointerType', { value: 'touch' });
  el.dispatchEvent(pd);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};

(async () => {
  await tick();
  const ths = document.querySelectorAll('#plain thead th');

  // 1. Wiring and sorting.
  ths.forEach((th) => {
    assert.ok(th.querySelector('button.th-sort'), `"${th.textContent}" has a sort arrow`);
    assert.equal(th.getAttribute('aria-sort'), 'none');
  });
  assert.match(ths[1].querySelector('.th-sort').getAttribute('aria-label'), /^Sort by Units$/);
  assert.equal(document.querySelectorAll('.th-tip__btn').length, 0, 'no circled-i glyph anywhere');
  assert.ok(ths[1].querySelector('.th-tip__label'), 'the label carries the definition');
  assert.ok(ths[1].classList.contains('th-tip') && ths[1].getAttribute('aria-describedby'), 'definition linked for screen readers');

  mouse(ths[1]);
  assert.equal(ths[1].getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(col('plain', 1), ['44', '120', '1,050', '—', '1,214'], 'numbers ascend as numbers, blank last, total pinned');
  mouse(ths[1]);
  assert.equal(ths[1].getAttribute('aria-sort'), 'descending');
  assert.deepEqual(col('plain', 1), ['1,050', '120', '44', '—', '1,214'], 'descending keeps blank last');
  mouse(ths[1]);
  assert.equal(ths[1].getAttribute('aria-sort'), 'none');
  assert.deepEqual(col('plain', 0), ['Bravo', 'alpha', 'Charlie', 'Delta', 'Total'], 'third click restores the original order');

  mouse(ths[2]);
  assert.deepEqual(col('plain', 2), ['(5)', '$950,000', '$1.2M', '$2.0M', '—'], 'money with M suffixes and negatives in parentheses');
  assert.equal(ths[1].getAttribute('aria-sort'), 'none', 'only one column shows as sorted');
  ths[0].querySelector('.th-sort').click();
  assert.deepEqual(col('plain', 0), ['alpha', 'Bravo', 'Charlie', 'Delta', 'Total'], 'text sorts case-insensitively via the arrow');

  const key = (c) => JSON.parse(JSON.stringify(window.TableSort.key(c)));
  const cell = (t) => { const td = document.createElement('td'); td.textContent = t; return td; };
  assert.deepEqual(key(cell('12.5%')), { n: 12.5 });
  assert.deepEqual(key(cell('−3')), { n: -3 });
  assert.deepEqual(key(cell('Not published')), { blank: true });
  assert.deepEqual(key(cell('2025')), { n: 2025 });
  assert.deepEqual(key(cell('3 Mar 2025')), { n: Date.UTC(2025, 2, 3) });
  assert.deepEqual(key(cell('Mar 3, 2025')), { n: Date.UTC(2025, 2, 3) });
  assert.deepEqual(key(cell('October 2026')), { n: Date.UTC(2026, 9, 1) });
  assert.deepEqual(key(cell('Apr–Jun 2026')), { n: Date.UTC(2026, 3, 1) }, 'a month range sorts by its start');
  assert.deepEqual(key(cell('2026-10-18')), { n: Date.UTC(2026, 9, 18) });
  assert.deepEqual(key(cell('10/18/2026')), { n: Date.UTC(2026, 9, 18) });
  assert.deepEqual(key(cell('5 years')), { n: 5 });
  assert.deepEqual(key(cell('4-5 weeks')), { n: 4 }, 'a range sorts by its start');
  assert.deepEqual(key(cell('384 (36%)')), { n: 384 });
  assert.deepEqual(key(cell('$35.04/hr')), { n: 35.04 });
  assert.deepEqual(key(cell('+105 bp')), { n: 105 });
  assert.deepEqual(key(cell('2.1 MB')), { n: 2.1e6 });
  assert.ok(key(cell('7.5 KB')).n < key(cell('2.1 MB')).n, 'file sizes compare across units');
  assert.ok(key(cell('3 weeks were spent reviewing the application package')).s, 'prose that starts with a number stays text');
  assert.deepEqual(key(cell('May fund rehab')), { s: 'may fund rehab' }, 'a label with a month name stays text');
  const dth = document.querySelector('#dates th');
  mouse(dth);
  assert.deepEqual(col('dates', 0), ['3 Mar 2025', '10 Dec 2025', '14 Jan 2026', '10 Aug 2026'], 'displayed dates sort by time');
  assert.equal(document.querySelector('#iconown th .th-sort').getAttribute('aria-label'), 'Sort by Expiration',
    'a renderer\'s direction glyph is left out of the arrow\'s name');

  // 2. Not data tables.
  for (const id of ['short', 'merged', 'optout']) {
    assert.equal(document.querySelectorAll(`#${id} .th-sort`).length, 0, `#${id} is left alone`);
  }

  // 3. Renderer-sorted table.
  const own = document.querySelectorAll('#own th');
  assert.ok(document.getElementById('own').classList.contains('th-own-sort'));
  own[0].querySelector('.th-sort').click();
  assert.equal(ownClicks, 1, 'the arrow clicks the header so the renderer sorts');
  assert.deepEqual(col('own', 0), ['2', '1', '3'], 'no DOM sort on top of the renderer');
  await tick();
  assert.equal(own[0].getAttribute('aria-sort'), 'ascending', 'class-only renderer direction is mirrored to aria-sort');
  assert.equal(own[1].getAttribute('aria-sort'), 'none');
  own[0].querySelector('.th-sort').click();
  await tick();
  assert.equal(own[0].getAttribute('aria-sort'), 'descending');
  assert.equal(ownClicks, 2);
  const oa = document.querySelectorAll('#ownaria th');
  oa[1].querySelector('.th-sort').click();
  await tick();
  assert.equal(oa[1].getAttribute('aria-sort'), 'ascending', 'a renderer that writes aria-sort keeps its value');
  assert.ok(!oa[1].hasAttribute('data-aria-from-class'));

  // 4. Touch: tap on a header with a definition opens it and does not sort.
  touchTap(ths[1].querySelector('.th-tip__label'));
  assert.ok(ths[1].classList.contains('is-open'), 'tap opens the definition');
  assert.equal(ths[1].getAttribute('aria-sort'), 'none', 'tap on the label does not sort');
  touchTap(ths[1].querySelector('.th-sort'));
  assert.equal(ths[1].getAttribute('aria-sort'), 'ascending', 'tap on the arrow sorts');
  touchTap(ths[2]);
  assert.equal(ths[2].getAttribute('aria-sort'), 'ascending', 'a header with no definition sorts on a tap anywhere');

  // Re-render: a renderer replaces the rows while a sort shows; the arrow resets.
  const tb = document.querySelector('#plain tbody');
  tb.innerHTML = '<tr><td>Z</td><td>1</td><td>1</td></tr><tr><td>Y</td><td>2</td><td>2</td></tr><tr><td>X</td><td>3</td><td>3</td></tr>';
  await tick();
  assert.equal(ths[2].getAttribute('aria-sort'), 'none', 'new rows from a renderer reset the arrow');

  // 5. Wiring on pages.
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const missing = pages.filter((p) => { const h = read(p); return h.includes('js/components/table-header-tips.js') && !h.includes('js/components/table-sort.js'); });
  assert.deepEqual(missing, [], 'pages that load table-header-tips.js but not table-sort.js');
  assert.ok(read('js/components/table-export.js').includes('.th-sort'), 'downloads drop the sort arrow');
  // Statements whose row order is the meaning stay unsorted.
  const ms = read('js/project-market-study/market-study-page.js');
  for (const label of ['Resale settlement steps', 'Effective-demand funnel']) {
    assert.ok(ms.includes(`'${label}', true)`), `${label} opts out of sorting`);
  }
  // Renderers' own indicators give way to the shared arrow.
  const css = read('css/site-theme.css');
  for (const cls of ['sort-icon', 'aff-sort-indicator', 'mhc-sort-indicator']) {
    assert.ok(new RegExp('table\\.th-own-sort th\\.th-sortable [^{]*\\.' + cls + '\\b').test(css), `.${cls} is hidden in renderer-sorted tables`);
  }
  const dc = read('js/deal-calculator.js');
  for (const id of ['dc-su-table', 'dc-pf-table', 'dc-act-table', 'dc-doh15-table', 'dc-doh15-totals']) {
    assert.ok(dc.includes(`<table id="${id}" data-no-sort`), `${id} opts out of sorting`);
  }

  console.log(`table-sort: PASS — ${pages.filter((p) => read(p).includes('js/components/table-sort.js')).length} pages load the sorter`);
})().catch((e) => { console.error(e); process.exit(1); });
