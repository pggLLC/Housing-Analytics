# `js/components/table-export.js`

table-export.js — "Download Excel" and "Download CSV" for any table marked
with data-export="<registry id>".

Every download carries its own metadata, so a table that leaves the site
still says what it is and where it came from:

  Data        the rows as the page shows them, numbers as numbers
  Indicators  each column's definition, unit and source
  Sources     each source's provider, link, maintenance mode and freshness
  About       the page, the export time, the selection, how to cite it

Excel gets those four sheets. CSV gets a .zip holding the data CSV, an
indicators CSV, a sources CSV and a README.txt, so the data file itself
stays clean for Excel, R or pandas.

Where the metadata comes from — nothing here is typed twice:
  - Column definitions are the header's own on-page definition (the "?"
    popover from table-header-tips.js: data-tip, title, or the shared
    data/table-header-tips.json entry). The download says exactly what the
    page says.
  - Sources are ids into js/data-source-inventory.js, the same registry the
    data sources dashboard reads, so maintenance mode and last-changed date
    are the inventory's, not a copy.
  - Table title, description, sources and selection controls live in
    js/config/table-export-registry.js.

An unmeasurable value is never exported as 0. A cell that reads "—" or
"Value unavailable…" is written as a blank, and the row's last column
records what the page showed and why.

Under each table a source line names the table's sources and offers the
table's download plus each source's full dataset (every record in its file
on this site, written by js/components/dataset-export.js, loaded on the
first click).

Usage:
  <table data-export="dd-funding-vs-need">…</table>
  TableExport.decorateAll();          // runs on load and on DOM changes
  TableExport.collect(tableEl);       // the model both formats are built from

## Symbols

### `parseValue(text)`

Parse one displayed value. Returns
  { kind: 'empty' }                         blank cell
  { kind: 'unavailable', text }             "—", "Value unavailable (…)"
  { kind: 'number', value, unit }           "$1,234", "12.5%", "+109 bp"
  { kind: 'text', text }                    anything else, kept verbatim

### `collect(table)`

The model both formats are written from. Pure DOM read, no network.

### `zip(files)`

A stored (uncompressed) zip. Small tables, no dependency to load, and
every unzip tool reads it.

### `describe(spec)`

The same Sources and About metadata, for a download that is a report
rather than one table (the HNA workbook, the PMA site CSV).
  spec = { title, description, sources: [inventory ids], selection:
           [[label, value]], notes }
Resolves to { model, sources: [[header], ...rows], about: [[header], ...],
fieldRows: Field/Value rows for a two-column CSV }.

### `build(table, format)`

Build a download. Resolves to { name, blob, format } without saving, so
tests can read the file a click would produce.
