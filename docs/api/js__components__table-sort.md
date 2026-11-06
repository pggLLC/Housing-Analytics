# `js/components/table-sort.js`

table-sort.js — every data table on the site sorts by its column headers.

paul's standing rule (2026-10-18): all tables sort by their headers.
Before this, 21 of about 240 tables sorted, each with its own code and
its own arrow.

Two kinds of table:
  - Tables a renderer already sorts (it marks its headers with aria-sort,
    data-sort, data-sort-key, data-col, data-metric, .sortable or
    .sort-asc/.sort-desc) keep that renderer's logic, because many of them
    sort a filtered or paginated dataset that is larger than the rows on
    screen. They only get the shared arrow, which clicks the header.
  - Every other table with one header row, at least three body rows and
    no merged cells is sorted here, in the DOM. Click a header (or its
    arrow) for ascending, again for descending, a third time for the
    original order — some tables have a meaningful order (steps, years,
    ranks) and readers need a way back to it. Numbers sort as numbers
    ($, %, commas and K/M/B stripped, and a number followed by a short
    unit such as "5 years" or "7.5 KB"), displayed dates by time; blanks
    and dashes go last either way; rows marked .total stay at the bottom;
    <tfoot> is never touched.
    A page opts a table out with data-no-sort on the <table>: the Deal
    Calculator's financial statements (sources and uses, pro forma,
    depreciation schedules) and the resale settlement steps do, because
    their row order is the meaning (subtotals and indented sub-rows).

On touch there is no hover, so a tap on a header that has a definition
opens the definition (table-header-tips.js stops that tap before it
reaches any sort handler) and the arrow is the separate sort target. A
header with no definition sorts on a tap anywhere. With a mouse or
keyboard the whole header sorts.

Runs on load and again whenever tables are inserted or re-rendered
(MutationObserver). Idempotent per header.

_No documented symbols — module has a file-header comment only._
