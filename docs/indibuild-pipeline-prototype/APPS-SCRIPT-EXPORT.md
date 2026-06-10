# Google Apps Script — Sheet → JSON Export

**When to use:** After 2 weeks of manual sheet use, when you're ready to wire the data into the private COHO pages (`/pipeline/*`).

This Apps Script exports the 5 tabs as a single JSON file you can drop into `data/pipeline/` in the repo. **Not needed during the prototype phase** — the CSVs alone are enough to prove the workflow.

---

## Setup (one-time, ~10 min)

1. In your Google Sheet, click **Extensions → Apps Script**
2. Replace the default `Code.gs` content with the snippet below
3. Click **Save** (disk icon)
4. Click **Run** the first time — Google will ask for permission to access the Sheet. Grant it.
5. Output appears in the Apps Script logs and is downloaded as `pipeline-export.json` to your Downloads folder.

To re-run weekly: open Apps Script → Run. Or set a time-based trigger to run every Monday at 7am (Apps Script → Triggers).

---

## The script

```javascript
/**
 * IndiBuild Pipeline → JSON exporter
 *
 * Reads the 5 tabs of the IndiBuild Pipeline sheet and writes a single
 * pipeline-export.json file to Google Drive. The output schema matches
 * what /pipeline/data/*.json expects in the private COHO surfaces.
 */
function exportPipeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      sheet_id: ss.getId(),
      sheet_url: ss.getUrl()
    },
    signal_log: tabToObjects_(ss.getSheetByName('Signal Log')),
    pipeline: tabToObjects_(ss.getSheetByName('Pipeline')),
    on_pause: tabToObjects_(ss.getSheetByName('On Pause')),
    network: tabToObjects_(ss.getSheetByName('Network'))
      .filter(r => r.name && !r.name.startsWith('EXAMPLE') && !r.name.startsWith('INSTRUCTIONS')),
    outreach_templates: tabToObjects_(ss.getSheetByName('Outreach Templates'))
  };

  const json = JSON.stringify(out, null, 2);
  const blob = Utilities.newBlob(json, 'application/json', 'pipeline-export.json');
  const folder = DriveApp.getRootFolder();
  // Replace any existing copy
  const existing = folder.getFilesByName('pipeline-export.json');
  while (existing.hasNext()) existing.next().setTrashed(true);
  folder.createFile(blob);

  Logger.log('Exported %s rows total: %s signals + %s pipeline + %s on-pause + %s contacts + %s templates',
    out.signal_log.length + out.pipeline.length + out.on_pause.length + out.network.length + out.outreach_templates.length,
    out.signal_log.length, out.pipeline.length, out.on_pause.length, out.network.length, out.outreach_templates.length);
}

/**
 * Convert a sheet tab to an array of objects keyed by row 1 headers.
 * Skips fully-empty rows.
 */
function tabToObjects_(sheet) {
  if (!sheet) return [];
  const range = sheet.getDataRange().getValues();
  if (range.length < 2) return [];
  const headers = range[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < range.length; i++) {
    const row = range[i];
    if (row.every(c => c === '' || c === null)) continue;
    const obj = {};
    headers.forEach((h, j) => {
      let v = row[j];
      if (v instanceof Date) v = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
      obj[h] = v === '' ? null : v;
    });
    rows.push(obj);
  }
  return rows;
}
```

---

## Auto-pull into COHO repo

Once you're ready for the private COHO pages, replace the Drive export with a fetch from a Cloudflare Worker or GitHub Action that:

1. Downloads `pipeline-export.json` from Drive (using a service-account token)
2. Splits it into `data/pipeline/signal-log.json`, `data/pipeline/pipeline.json`, etc.
3. Commits to the private COHO branch

The private COHO pages then `fetch()` those files on load.

I'll write that automation when you're ready — for now, the Apps Script export is sufficient to prove the integration path.

---

## Privacy note

The Apps Script runs under your Google account. The exported JSON file lives in your Drive. **It does not leave your control until you intentionally check it in to the COHO repo or upload it elsewhere.** If you're testing with sensitive contact data and don't want to risk an accidental commit, prefix the filename with `private-` so a pre-commit hook can flag it.
