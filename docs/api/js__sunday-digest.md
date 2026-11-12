# `js/sunday-digest.js`

sunday-digest.js — renders the Sunday digest of Colorado housing news.

Reads data/news-digest/index.json (list of editions) and the edition's
Markdown file, and renders it with a small, escape-first Markdown reader.
Only the Markdown the digest uses is supported: headings, paragraphs,
bullet and numbered lists (one nested level), rules, bold, italic, inline
code and links. Every character of the source is HTML-escaped before any
markup is added, and links are kept only when they point to http(s) or to a
relative path, so an edition cannot inject script.

?date=YYYY-MM-DD shows that edition; the default is the newest.

## Symbols

### `render(md)`

Markdown string -> HTML string. Exported for tests.
