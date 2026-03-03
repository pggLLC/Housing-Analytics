// Vercel Serverless Function: /api/prop123
// Same logic as the Cloudflare worker, but for Node runtime.
// Returns: {updated, source_url, sheet_url, csv_url, jurisdictions: [{name,type,required_commitment}]}

export default async function handler(req, res) {
  const CDOLA = 'https://cdola.colorado.gov/commitment-filings';

  try {
    const html = await (await fetch(CDOLA, { headers: { 'User-Agent': 'co-prop123-vercel' }})).text();

    const sheetUrl = findFirst(html, [
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+\/[^\s"']*/g,
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+[^\s"']*/g
    ]);

    let csvUrl = findFirst(html, [
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+\/export\?format=csv[^\s"']*/g,
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+\/gviz\/tq\?tqx=out:csv[^\s"']*/g
    ]);

    if (!csvUrl && sheetUrl) {
      csvUrl = sheetUrl.replace(/\/edit.*$/,'') + '/gviz/tq?tqx=out:csv';
    }

    let jurisdictions = [];
    if (csvUrl) {
      try {
        const csvText = await (await fetch(csvUrl, { headers: { 'User-Agent': 'co-prop123-vercel' }})).text();
        jurisdictions = parseCommitmentsCSV(csvText);
      } catch {}
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=0');
    res.status(200).json({
      updated: new Date().toISOString(),
      source_url: CDOLA,
      sheet_url: sheetUrl || null,
      csv_url: csvUrl || null,
      jurisdictions
    });
  } catch (e) {
    res.status(502).json({ updated: new Date().toISOString(), source_url: CDOLA, jurisdictions: [], error: 'Failed to fetch CDOLA page' });
  }
}

function findFirst(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[0]) return m[0];
  }
  return null;
}

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalize(s) { return (s || '').toString().trim().replace(/\s+/g, ' '); }

function parseCommitmentsCSV(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];
  const header = rows[0].map(h => normalize(h).toLowerCase());

  const idxName   = header.findIndex(h => h.includes('jurisdiction') || h.includes('local government') || h === 'name');
  const idxReq    = header.findIndex(h => h.includes('required') || h.includes('commitment') || h.includes('contribution'));
  const idxType   = header.findIndex(h => h.includes('type') || h.includes('jurisdiction type'));
  const idxStatus = header.findIndex(h => h.includes('status') || h.includes('filed') || h.includes('committed'));
  const idxDate   = header.findIndex(h => h.includes('date') || h.includes('filed on') || h.includes('filing'));
  const idxLink   = header.findIndex(h => h.includes('link') || h.includes('url') || h.includes('document'));

  const out = [];
  for (const r of rows.slice(1)) {
    const name = normalize(r[idxName] || '');
    if (!name) continue;

    const type = normalize(r[idxType] || '');
    const required_commitment = normalize(r[idxReq] || '');
    const status = normalize(r[idxStatus] || '');
    const filing_date = normalize(r[idxDate] || '');
    const source_url = normalize(r[idxLink] || '');

    out.push({
      name,
      type,
      kind: (type.toLowerCase().includes('county') || name.toLowerCase().includes(' county')) ? 'county' : 'municipality',
      required_commitment,
      status,
      filing_date,
      source_url
    });
  }

  // Dedup by lowercase name (prefer rows with more metadata)
  const best = new Map();
  for (const j of out) {
    const k = j.name.toLowerCase();
    const score = (j.required_commitment ? 1 : 0) + (j.status ? 1 : 0) + (j.filing_date ? 1 : 0) + (j.source_url ? 1 : 0);
    const prev = best.get(k);
    if (!prev) best.set(k, { j, score });
    else if (score > prev.score) best.set(k, { j, score });
  }
  return Array.from(best.values()).map(x => x.j);
}
