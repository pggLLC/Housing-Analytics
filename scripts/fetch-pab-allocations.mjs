#!/usr/bin/env node
/**
 * fetch-pab-allocations.mjs  (F25, 2026-05-28)
 *
 * Builds data/policy/pab-allocations.json — Colorado Private Activity Bond
 * (PAB) volume-cap DIRECT ALLOCATIONS to designated local issuers.
 *
 * WHAT THIS IS
 * ------------
 * Colorado's annual PAB volume cap (IRC §146) is split by C.R.S. §24-32-1701
 * et seq.:
 *   - 50% to statewide authorities (CHFA 48% + Ag Development 2%)
 *   - ~47% as DIRECT ALLOCATIONS to cities + counties large enough to clear a
 *     $1,000,000 minimum (≈ population ≥ 15,300 at the current per-capita rate)
 *   - ~3% retained by DOLA as the "Statewide Balance" pool
 *
 * The direct allocation is purely per-capita: every designated local issuer
 * receives `localPerCapita × population`. Smaller jurisdictions receive $0
 * direct and instead draw from the Statewide Balance (administered by DOLA /
 * conduited through CHFA for 4% LIHTC deals).
 *
 * IMPORTANT (relevance caveat surfaced in the UI): a jurisdiction's direct
 * allocation is NOT a hard ceiling on 4% bond deals there. Most CO 4% LIHTC
 * deals use CHFA's statewide pool, or the locality cedes/assigns its direct
 * allocation to CHFA. Local cap also frequently funds non-housing uses (IDBs,
 * mortgage credit certificates) or is relinquished by the Sept 15 deadline.
 * So this is a CAPACITY signal, not a deal gate.
 *
 * COMPUTE + RECONCILE
 * -------------------
 *   1. Fetch DOLA's published table (authoritative assigned amounts).
 *   2. Compute the per-capita rate from the table (cap ÷ population).
 *   3. Validate every row reproduces that rate; flag population anomalies
 *      (the published table has at least one copy-paste population typo).
 *   4. Match each issuer name to the site's geoid (county FIPS or place GEOID)
 *      via data/hna/ranking-index.json.
 *
 * SOURCE: https://doh.colorado.gov/PAB-Allocations-2025
 * Re-run: `node scripts/fetch-pab-allocations.mjs`  (or `--html <file>` to
 * parse a saved copy when DOLA blocks automated fetches with a 403).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SOURCE_URL = 'https://doh.colorado.gov/PAB-Allocations-2025';
const OUT = path.join(REPO, 'data/policy/pab-allocations.json');
const RANKING = path.join(REPO, 'data/hna/ranking-index.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// City+county consolidated jurisdictions — DOLA lists once; we surface the
// allocation under BOTH the place GEOID and the county FIPS so a lookup from
// either geography resolves.
const CONSOLIDATED = {
  Denver:     { place: '0820000', county: '08031' },
  Broomfield: { place: '0809280', county: '08014' }
};

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (Cañon → Canon)
    .replace(/\b(city|town|county)\b/g, '')
    .replace(/[().]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getHtml() {
  const flagIdx = process.argv.indexOf('--html');
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return fs.readFileSync(process.argv[flagIdx + 1], 'utf8');
  }
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(
      `DOLA returned HTTP ${res.status}. Save the page manually and re-run ` +
      `with --html <file>. (DOLA sometimes 403s automated fetches.)`
    );
  }
  return res.text();
}

function parseTable(html) {
  const cells = [];
  const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const txt = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#36;/g, '$')
      .replace(/\s+/g, ' ')
      .trim();
    cells.push(txt);
  }
  // Locate header end ("Population as % of State Population")
  let start = 0;
  for (let i = 0; i < cells.length; i++) {
    if (/population as/i.test(cells[i])) { start = i + 1; break; }
  }
  const rows = [];
  for (let i = start; i + 3 < cells.length + 1 && i + 3 <= cells.length; i += 4) {
    const name = cells[i];
    const cap = cells[i + 1];
    const pop = cells[i + 2];
    if (!name || !cap || !/\$/.test(cap)) continue;
    if (/^total$/i.test(name)) continue;
    const capNum = Number(cap.replace(/[^0-9.]/g, ''));
    const popNum = Number((pop || '').replace(/[^0-9.]/g, ''));
    if (!capNum) continue;
    rows.push({ name, cap: capNum, pop: popNum || null });
  }
  return rows;
}

function extractScalar(html, label) {
  // Find a dollar/number appearing near a label like "Per Capita" or the
  // state ceiling. Best-effort; validated downstream.
  const idx = html.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  const slice = html.slice(idx, idx + 400).replace(/<[^>]+>/g, ' ');
  const m = slice.match(/\$([0-9][0-9,]*)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function buildGeoIndex() {
  const idx = JSON.parse(fs.readFileSync(RANKING, 'utf8'));
  const arr = Array.isArray(idx.rankings) ? idx.rankings : Object.values(idx.rankings);
  const byCounty = new Map();
  const byPlace = new Map();
  arr.forEach((r) => {
    const key = normalize(r.name);
    if (r.type === 'county') byCounty.set(key, r);
    else if (r.type === 'place') {
      // Prefer the first match; "(city)" beats "(town)" if both exist (rare).
      if (!byPlace.has(key)) byPlace.set(key, r);
    }
  });
  return { byCounty, byPlace };
}

function main() {
  return getHtml().then((html) => {
    const rows = parseTable(html);
    if (rows.length < 30) {
      throw new Error(`Parsed only ${rows.length} rows — DOLA layout may have changed.`);
    }

    const stateCeiling = extractScalar(html, 'State Ceiling') ||
                         extractScalar(html, 'Total State') || 767174070;
    const statePerCapita = (() => {
      const i = html.toLowerCase().indexOf('per capita');
      if (i === -1) return 130;
      const s = html.slice(i, i + 120).replace(/<[^>]+>/g, ' ');
      const m = s.match(/\$([0-9]+)/);
      return m ? Number(m[1]) : 130;
    })();

    // Derive local per-capita rate from the largest issuer (least rounding noise).
    const ref = rows.slice().sort((a, b) => b.cap - a.cap)[0];
    const localPerCapita = ref.pop ? ref.cap / ref.pop : statePerCapita / 2;

    const { byCounty, byPlace } = buildGeoIndex();

    const allocations = {};
    const unmatched = [];
    const anomalies = [];
    let totalDirect = 0;

    rows.forEach((row) => {
      totalDirect += row.cap;
      const isCounty = /\bcounty\b/i.test(row.name);
      const key = normalize(row.name);

      // Reconcile: population implied by cap ÷ rate vs published population.
      const impliedPop = Math.round(row.cap / localPerCapita);
      let reconcileFlag = null;
      if (row.pop && Math.abs(row.pop - impliedPop) / impliedPop > 0.02) {
        reconcileFlag = `published population ${row.pop.toLocaleString()} disagrees with ` +
                        `cap-implied ${impliedPop.toLocaleString()} (likely a source typo); ` +
                        `using cap-implied for the population field`;
        anomalies.push(`${row.name}: ${reconcileFlag}`);
      }
      const population = reconcileFlag ? impliedPop : (row.pop || impliedPop);

      const record = {
        name: row.name,
        type: isCounty ? 'county' : 'place',
        directAllocation: row.cap,
        population,
        perCapita: Math.round((row.cap / population) * 100) / 100,
        reconcileFlag
      };

      const consolidated = CONSOLIDATED[row.name];
      if (consolidated) {
        allocations[consolidated.place] = { ...record, geoid: consolidated.place, type: 'place', consolidatedCityCounty: true };
        allocations[consolidated.county] = { ...record, geoid: consolidated.county, type: 'county', consolidatedCityCounty: true };
        return;
      }

      const match = isCounty ? byCounty.get(key) : byPlace.get(key);
      if (!match) {
        unmatched.push(row.name);
        // Still record under a synthetic key so the data isn't lost.
        allocations['unmatched:' + row.name] = { ...record, geoid: null };
        return;
      }
      allocations[match.geoid] = { ...record, geoid: match.geoid };
    });

    const out = {
      metadata: {
        title: 'Colorado Private Activity Bond — Local Direct Allocations',
        year: 2025,
        source: 'Colorado DOLA Division of Housing',
        sourceUrl: SOURCE_URL,
        fetched: new Date().toISOString().slice(0, 10),
        stateVolumeCap: stateCeiling,
        statePerCapita,
        localPerCapita: Math.round(localPerCapita * 100) / 100,
        designatedIssuerCount: rows.length,
        totalDirectAllocations: totalDirect,
        minimumAllocation: 1000000,
        approxPopulationThreshold: Math.ceil(1000000 / localPerCapita),
        method:
          'Direct allocation = localPerCapita × population for cities/counties ' +
          'clearing the $1,000,000 minimum. Jurisdictions not listed receive $0 ' +
          'direct and draw from the DOLA Statewide Balance.',
        caveat:
          'A direct allocation is a CAPACITY signal, not a ceiling on 4% bond ' +
          'deals. Most Colorado 4% LIHTC deals use CHFA’s statewide pool, or ' +
          'the locality cedes its direct allocation to CHFA. Local cap also funds ' +
          'non-housing uses (IDBs, mortgage credit certificates) or is relinquished ' +
          'by the Sept 15 deadline.'
      },
      allocations
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

    // Report
    const matchedCount = Object.values(allocations).filter((a) => a.geoid).length;
    console.log(`✓ Wrote ${path.relative(REPO, OUT)}`);
    console.log(`  State ceiling: $${stateCeiling.toLocaleString()} ($${statePerCapita}/capita)`);
    console.log(`  Local rate:    $${out.metadata.localPerCapita}/capita`);
    console.log(`  Issuers:       ${rows.length} (total direct $${totalDirect.toLocaleString()})`);
    console.log(`  Matched geoid: ${matchedCount} / ${rows.length}`);
    console.log(`  Pop threshold: ≈${out.metadata.approxPopulationThreshold.toLocaleString()} people ($1M min)`);
    if (anomalies.length) {
      console.log(`  ⚠ Reconciled ${anomalies.length} population anomal${anomalies.length === 1 ? 'y' : 'ies'}:`);
      anomalies.forEach((a) => console.log(`     - ${a}`));
    }
    if (unmatched.length) {
      console.log(`  ⚠ Unmatched issuer names (recorded under synthetic keys):`);
      unmatched.forEach((u) => console.log(`     - ${u}`));
    }
  });
}

main().catch((err) => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
