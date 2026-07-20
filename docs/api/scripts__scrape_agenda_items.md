# `scripts/scrape_agenda_items.mjs`

scrape_agenda_items.mjs  (F169b, 2026-06-04)

For each curated jurisdiction in data/hna/local-resources.json that
HAS a `council_agenda_url`, fetches the page and extracts recent
housing-related agenda items. No DOM library — plain fetch + regex.

Civic Plus AgendaCenter pages emit a visible HTML table with rows
containing date + title + a link to the packet/agenda PDF. Granicus
pages expose ViewPublisher.php which we parse the same way; the JSON
archive endpoint exists but isn't documented and varies per tenant,
so we stick with the public HTML.

Output:
  data/town-agendas.json — { jurisdictions: [{ key, geoid, name,
    source_url, platform, fetched_at, recent_items: [{date,title,url}] }] }

CLI:
  node scripts/scrape_agenda_items.mjs           # write file
  node scripts/scrape_agenda_items.mjs --dry     # don't write
  node scripts/scrape_agenda_items.mjs --limit 5

Exit codes:
  0 — completed
  2 — script-level failure

_No documented symbols — module has a file-header comment only._
