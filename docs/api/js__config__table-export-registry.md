# `js/config/table-export-registry.js`

table-export-registry.js — the tables that offer "Download Excel" and
"Download CSV" (js/components/table-export.js).

A table opts in with data-export="<id>"; its entry here says what the
download is called, what the rows are, which sources it comes from and
which on-page controls decide what it shows.

  title        name used for the file's About sheet and the button label
  description  one sentence on what a row is
  sources      ids in js/data-source-inventory.js. The Sources sheet is
               read from the inventory, so maintenance mode and the
               last-changed date are never copied here.
  selection    { label: CSS selector } for controls whose current value
               changes the rows (a county picker); recorded on About.
  sourcesBySelection
               for a table whose rows come from a different dataset
               depending on a control: { control, values: { value: [ids] },
               otherwise: [ids] }. `sources` is then the page's default.
  notes        caveats a reader of the file needs that the table can't say

Column definitions are deliberately absent: each comes from the header's
own on-page definition, so the file and the page cannot disagree.
test/table-export.test.js fails on a data-export id with no entry here,
an entry no page uses, or a source id the inventory does not hold.

_No documented symbols — module has a file-header comment only._
