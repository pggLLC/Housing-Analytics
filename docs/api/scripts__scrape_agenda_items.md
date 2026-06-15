# `scripts/scrape_agenda_items.mjs`

## Symbols

### `HOUSING_KEYWORDS`

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
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_RESOURCES = path.join(ROOT, 'data', 'hna', 'local-resources.json');
const CENTROIDS = path.join(ROOT, 'data', 'co-place-centroids.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'town-agendas.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const MAX_ITEMS_PER_JURISDICTION = 12;
const USER_AGENT =
  'CohoAgendaScraperBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

/* ── Keywords ───────────────────────────────────────────────────────
