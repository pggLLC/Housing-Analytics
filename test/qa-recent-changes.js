/**
 * test/qa-recent-changes.js
 *
 * QA/QC verification harness for the methodology + UI changes that
 * landed in PRs #881 → #890 (May 2026 session). Designed for the Codex
 * handover so a fresh reviewer can run a single command to validate
 * that all the recent fixes still work end-to-end.
 *
 * Usage:
 *   node test/qa-recent-changes.js                # full suite
 *   node test/qa-recent-changes.js --skip-puppeteer  # data + unit only
 *   node test/qa-recent-changes.js --only schema     # one category
 *
 * Categories:
 *   schema      JSON file structural checks
 *   units       Pure-function unit tests for scoring engines
 *   urls        Source-URL liveness (re-uses scripts/audit/source-url-sweep.mjs)
 *   smoke       Headless browser smoke test (requires puppeteer)
 *
 * Exit code: 0 = all pass · 1 = any failure
 *
 * Designed to be:
 *   - Hermetic where possible (no network for schema + units)
 *   - Single-process (no daemons / parallel workers)
 *   - Honest about what it can't verify (e.g. live ACS API)
 *
 * Author: 2026-05-25 handover prep.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argHas = (flag) => args.indexOf(flag) >= 0;
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const ONLY        = argVal('--only');
const SKIP_PUPPET = argHas('--skip-puppeteer');

/* ── Test runner ──────────────────────────────────────────────────── */

const results = { pass: 0, fail: 0, skip: 0, items: [] };

function record(category, name, status, detail) {
  results[status]++;
  results.items.push({ category, name, status, detail: detail || '' });
  const sym = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '○';
  const colorOpen  = status === 'pass' ? '\x1b[32m' : status === 'fail' ? '\x1b[31m' : '\x1b[33m';
  const colorClose = '\x1b[0m';
  console.log(`  ${colorOpen}${sym}${colorClose} [${category}] ${name}${detail ? '  — ' + detail : ''}`);
}

function section(title) {
  console.log('\n\x1b[1m' + title + '\x1b[0m');
}

function shouldRun(category) {
  return !ONLY || ONLY === category;
}

/* ── 1. Schema checks ─────────────────────────────────────────────── */

function runSchemaChecks() {
  if (!shouldRun('schema')) return;
  section('Schema checks (JSON file integrity)');

  const checks = [
    {
      name: 'CHAS affordability gap — 64 counties + summary fields',
      file: 'data/hna/chas_affordability_gap.json',
      check: (d) => {
        if (!d.counties || Object.keys(d.counties).length !== 64) {
          return 'expected 64 counties; got ' + (d.counties ? Object.keys(d.counties).length : 0);
        }
        for (const fips of Object.keys(d.counties)) {
          const s = d.counties[fips].summary;
          if (!s || s.pct_renter_cb30 == null || s.pct_owner_cb30 == null) {
            return 'county ' + fips + ' missing pct_renter_cb30 / pct_owner_cb30';
          }
        }
        return null;
      }
    },
    {
      name: 'ACS AMI Gap by county — 7-band data populated',
      file: 'data/co_ami_gap_by_county.json',
      check: (d) => {
        if (!Array.isArray(d.counties)) return 'counties not an array';
        const bands = d.bands || [];
        const expected = [30, 40, 50, 60, 70, 80, 100];
        if (JSON.stringify(bands) !== JSON.stringify(expected)) {
          return 'bands ' + JSON.stringify(bands) + ' ≠ expected ' + JSON.stringify(expected);
        }
        const delta = d.counties.find(c => c.fips === '08029');
        if (!delta || !delta.households_le_ami_pct || !delta.households_le_ami_pct['30']) {
          return 'Delta County (08029) missing 7-band data';
        }
        return null;
      }
    },
    {
      name: 'Economic indicators — 64 counties + LAUS source',
      file: 'data/co-county-economic-indicators.json',
      check: (d) => {
        const cnt = d.counties ? Object.keys(d.counties).length : 0;
        if (cnt !== 64) return 'expected 64 counties; got ' + cnt;
        if (!d.source || !/BLS LAUS/i.test(d.source)) {
          return 'source field should mention BLS LAUS (PR #621 migration)';
        }
        const adams = d.counties['Adams'];
        if (!adams || adams.unemployment_rate == null || adams.affordability_index == null) {
          return 'Adams County missing unemployment_rate / affordability_index';
        }
        return null;
      }
    },
    {
      name: 'ACS tract metrics — severe_cost_burden + poverty + unemployment fields',
      file: 'data/market/acs_tract_metrics_co.json',
      check: (d) => {
        const tracts = d.tracts || [];
        if (!tracts.length) return 'no tracts in file';
        const fields = ['severe_cost_burden_rate', 'poverty_rate', 'unemployment_rate'];
        // At least 80% of tracts must have each field (some may be suppressed)
        for (const f of fields) {
          const have = tracts.filter(t => Number.isFinite(+t[f])).length;
          if (have / tracts.length < 0.8) {
            return f + ' populated for only ' + Math.round(have / tracts.length * 100) +
              '% of tracts; expected ≥80%';
          }
        }
        return null;
      }
    },
    {
      name: 'LIHTC assumptions — 2026-Q1 vintage + hard cost matrix',
      file: 'data/policy/lihtc-assumptions.json',
      check: (d) => {
        if (!d.version || !/2026/.test(d.version)) {
          return 'version ' + d.version + ' is stale (expected 2026-*)';
        }
        const hc = d.hardCostPerUnit || {};
        if (!hc.family || !hc.seniors || !hc.mixedUse || !hc.supportive) {
          return 'hardCostPerUnit missing one of family/seniors/mixedUse/supportive';
        }
        if (hc.family < 200000 || hc.family > 500000) {
          return 'family hard cost $' + hc.family + ' outside plausible $200K-$500K range';
        }
        return null;
      }
    },
    {
      name: 'OSM amenities — ≥20K records covering all expected types',
      file: 'data/derived/market-analysis/neighborhood_access.json',
      check: (d) => {
        const a = d.amenities || [];
        if (a.length < 20000) return 'only ' + a.length + ' amenities; expected ≥20K';
        const types = new Set(a.map(x => x.type));
        for (const t of ['grocery', 'healthcare', 'school', 'park', 'transit_stop']) {
          if (!types.has(t)) return 'missing amenity type: ' + t;
        }
        return null;
      }
    }
  ];

  for (const c of checks) {
    const fp = path.join(ROOT, c.file);
    if (!fs.existsSync(fp)) {
      record('schema', c.name, 'fail', 'file missing: ' + c.file);
      continue;
    }
    try {
      const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const err = c.check(d);
      if (err) record('schema', c.name, 'fail', err);
      else record('schema', c.name, 'pass');
    } catch (e) {
      record('schema', c.name, 'fail', 'parse error: ' + e.message);
    }
  }
}

/* ── 2. Pure-function unit tests ──────────────────────────────────── */

function runUnitTests() {
  if (!shouldRun('units')) return;
  section('Unit tests (scoring engines + AMI matrix)');

  // 2a. AMI × bedroom matrix (PR #890)
  try {
    // lihtc-deal-predictor.js is a UMD module — `require()`'able directly.
    delete require.cache[require.resolve(path.join(ROOT, 'js/lihtc-deal-predictor.js'))];
    const LDP = require(path.join(ROOT, 'js/lihtc-deal-predictor.js'));
    if (!LDP) throw new Error('LIHTCDealPredictor not exposed');

    // Public entry point is predictConcept (see doc-block at top of module).
    const out = LDP.predictConcept({
      proposedUnits: 100,
      countyFips: '08029',  // Delta
      ami30UnitsNeeded: 1866,
      ami50UnitsNeeded: 1371,
      ami60UnitsNeeded: 627,
      totalUndersupply: 5896,
      isQct: false,
      isDda: false
    });

    if (!out.suggestedMatrix) {
      record('units', 'AMI matrix exposed on recommender output', 'fail', 'suggestedMatrix field missing');
    } else if (!Array.isArray(out.suggestedMatrix.tiers) || out.suggestedMatrix.tiers.length !== 4) {
      record('units', 'AMI matrix has 4 AMI-tier rows', 'fail',
        'got ' + (out.suggestedMatrix.tiers || []).length + ' tiers');
    } else {
      record('units', 'AMI matrix has 4 AMI-tier rows', 'pass');
      // Row sums match AMI marginals
      const rowSums = out.suggestedMatrix.tiers.map(t => {
        return ['studio', 'oneBR', 'twoBR', 'threeBR', 'fourBRPlus']
          .reduce((s, k) => s + (t[k] || 0), 0);
      });
      const marginals = out.suggestedMatrix.tiers.map(t => t.total);
      const allMatch = rowSums.every((s, i) => s === marginals[i]);
      if (allMatch) {
        record('units', 'AMI matrix row sums = AMI marginals', 'pass');
      } else {
        record('units', 'AMI matrix row sums = AMI marginals', 'fail',
          'row sums ' + JSON.stringify(rowSums) + ' ≠ marginals ' + JSON.stringify(marginals));
      }
      // No bedroom counts are NaN
      const hasNaN = out.suggestedMatrix.tiers.some(t =>
        ['studio', 'oneBR', 'twoBR', 'threeBR'].some(k => !Number.isFinite(t[k]))
      );
      record('units', 'AMI matrix cells are finite integers',
        hasNaN ? 'fail' : 'pass');
    }
  } catch (e) {
    record('units', 'AMI matrix exposed on recommender output', 'fail',
      'module-load error: ' + e.message);
  }

  // 2b. Site Selection Score weight redistribution
  try {
    const src = fs.readFileSync(
      path.join(ROOT, 'js/market-analysis/site-selection-score.js'),
      'utf8'
    );
    const window = {};
    eval(src);
    const SSS = window.SiteSelectionScore;
    if (!SSS) throw new Error('SiteSelectionScore not exposed');

    // Full inputs — should score on 6/6
    const full = SSS.computeScore({
      acs: { cost_burden_rate: 0.45, renter_share: 0.40, poverty_rate: 0.15, severe_burden_rate: 0.20 },
      qctFlag: true, ddaFlag: false, fmrRatio: 1.05, nearbySubsidized: 50,
      floodRisk: 0, soilScore: 80, cleanupFlag: false,
      amenities: { grocery: 0.5, transit: 0.3, parks: 0.4, healthcare: 1.0, schools: 0.8 },
      zoningCapacity: 100, publicOwnership: false, overlayCount: 2,
      rentTrend: 0.04, jobTrend: 0.025, concentration: 0.4, serviceStrength: 0.25
    });
    if (full.dimensionsAvailable !== 6) {
      record('units', 'Site Score full inputs → 6/6 dimensions', 'fail',
        'got ' + full.dimensionsAvailable);
    } else {
      record('units', 'Site Score full inputs → 6/6 dimensions', 'pass');
    }

    // Missing ACS → 5/6 dimensions
    const noAcs = SSS.computeScore({
      acs: null,
      qctFlag: true, ddaFlag: false, fmrRatio: 1.05, nearbySubsidized: 50,
      floodRisk: 0, soilScore: 80, cleanupFlag: false,
      amenities: { grocery: 0.5, transit: 0.3, parks: 0.4, healthcare: 1.0, schools: 0.8 },
      zoningCapacity: 100, publicOwnership: false, overlayCount: 2,
      rentTrend: 0.04, jobTrend: 0.025, concentration: 0.4, serviceStrength: 0.25
    });
    if (noAcs.dimensionsAvailable === 5 && noAcs.demand_score === null) {
      record('units', 'Site Score null-ACS → demand=null + 5/6 dims', 'pass');
    } else {
      record('units', 'Site Score null-ACS → demand=null + 5/6 dims', 'fail',
        'dimensionsAvailable=' + noAcs.dimensionsAvailable + ', demand=' + noAcs.demand_score);
    }

    // Opportunity band thresholds — at-boundary checks
    const high = SSS.computeScore({
      acs: { cost_burden_rate: 0.45, renter_share: 0.60, poverty_rate: 0.20, severe_burden_rate: 0.25 },
      qctFlag: true, ddaFlag: true, basisBoostEligible: true,
      fmrRatio: 1.20, nearbySubsidized: 0,
      floodRisk: 0, soilScore: 100, cleanupFlag: false,
      amenities: { grocery: 0.1, transit: 0.1, parks: 0.1, healthcare: 0.5, schools: 0.3 },
      zoningCapacity: 200, publicOwnership: true, overlayCount: 4,
      rentTrend: 0.06, jobTrend: 0.04, concentration: 0.2, serviceStrength: 0.35
    });
    if (high.final_score >= 70 && high.opportunity_band === 'High') {
      record('units', 'Top-end inputs → High band (≥70)', 'pass',
        'score=' + high.final_score);
    } else {
      record('units', 'Top-end inputs → High band (≥70)', 'fail',
        'score=' + high.final_score + ' band=' + high.opportunity_band);
    }
  } catch (e) {
    record('units', 'Site Selection Score module loads + scores', 'fail',
      'module-load error: ' + e.message);
  }

  // 2c. rentBurden30Plus fallback chain (PR #881)
  try {
    // hna-utils.js references `location.search` at parse time — shim it
    // before eval so we can lift the function into Node.
    const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8');
    const window = {};
    const location = { search: '' };
    const document = { addEventListener: () => {} };
    eval(src);
    const U = window.HNAUtils;
    if (!U || typeof U.rentBurden30Plus !== 'function') {
      throw new Error('HNAUtils.rentBurden30Plus not exposed');
    }
    // Current codes — use approximate equality (IEEE-754 float arithmetic).
    const cur = U.rentBurden30Plus({ DP04_0141PE: 25.3, DP04_0142PE: 22.1 });
    record('units', 'rentBurden30Plus — current codes (DP04_0141 + 0142)',
      Math.abs(cur - 47.4) < 1e-6 ? 'pass' : 'fail', 'got ' + cur);
    // Legacy codes
    const legacy = U.rentBurden30Plus({ DP04_0145PE: 15, DP04_0146PE: 20 });
    record('units', 'rentBurden30Plus — legacy codes (DP04_0145 + 0146)',
      legacy === 35 ? 'pass' : 'fail', 'got ' + legacy);
    // Composite fallback
    const comp = U.rentBurden30Plus({ DP04_0136PE: 33.3 });
    record('units', 'rentBurden30Plus — composite fallback (DP04_0136)',
      comp === 33.3 ? 'pass' : 'fail', 'got ' + comp);
    // All missing → null
    const none = U.rentBurden30Plus({});
    record('units', 'rentBurden30Plus — no codes returns null',
      none === null ? 'pass' : 'fail', 'got ' + none);
  } catch (e) {
    record('units', 'rentBurden30Plus fallback chain', 'fail', e.message);
  }
}

/* ── 3. Source-URL liveness ──────────────────────────────────────── */

function runUrlChecks() {
  if (!shouldRun('urls')) return;
  section('Source URL sweep (full inventory)');

  const { spawnSync } = require('child_process');
  const sweepScript = path.join(ROOT, 'scripts/audit/source-url-sweep.mjs');
  if (!fs.existsSync(sweepScript)) {
    record('urls', 'source-url-sweep.mjs available', 'fail', 'script missing');
    return;
  }

  console.log('  (running source-url-sweep.mjs — this hits external URLs, may take 30-60s)');
  const out = spawnSync('node', [sweepScript, '--quiet'], { encoding: 'utf8', cwd: ROOT });
  const stdoutTail = (out.stdout || '').split('\n').slice(-3).join(' ');
  if (out.status === 0) {
    record('urls', 'source-url-sweep — all green or allow-listed', 'pass', stdoutTail);
  } else {
    record('urls', 'source-url-sweep — has hard failures', 'fail', stdoutTail);
  }
}

/* ── 4. Headless smoke test ──────────────────────────────────────── */

async function runSmokeTest() {
  if (!shouldRun('smoke') || SKIP_PUPPET) return;
  section('Smoke test (headless browser)');

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    record('smoke', 'puppeteer available', 'skip',
      'puppeteer not installed (npm install --save-dev puppeteer to enable)');
    return;
  }

  // Boot a local http-server pointing at repo root
  const { spawn } = require('child_process');
  const server = spawn('npx', ['http-server', ROOT, '-p', '9876', '-c-1', '-s'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: false
  });
  // Wait for "Available on" line
  await new Promise((resolve) => {
    let buf = '';
    server.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      if (/Available on|Hit CTRL-C/i.test(buf)) resolve();
    });
    setTimeout(resolve, 5000);
  });

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    const baseUrl = 'http://localhost:9876';

    // HNA page — select Delta County and verify several fixes
    await page.goto(baseUrl + '/housing-needs-assessment.html', { waitUntil: 'networkidle2' });
    await page.evaluate(async () => {
      const t = document.getElementById('geoType');
      t.value = 'county'; t.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 2500));
      const g = document.getElementById('geoSelect');
      g.value = '08029'; g.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 8000));
    });

    const hna = await page.evaluate(() => ({
      rentBurden:    document.getElementById('statRentBurden')?.textContent,
      gap30:         document.getElementById('statGap30')?.textContent,
      gap100:        document.getElementById('statGap100')?.textContent,
      scorecardComp: document.querySelector('#hnaScorecardPanel .composite-value, ' +
                                            '#hnaScorecardPanel [style*="font-size:1.9rem"]')?.textContent,
      blsHeader:     document.getElementById('blsLabourMarketCards')?.textContent?.split('\n')[0]
    }));

    record('smoke', 'HNA Delta — rent burden populated (not "—")',
      hna.rentBurden && hna.rentBurden !== '—' ? 'pass' : 'fail',
      'got: ' + hna.rentBurden);

    record('smoke', 'HNA Delta — AMI Gap ≤30% populated',
      hna.gap30 && hna.gap30 !== '—' ? 'pass' : 'fail',
      'got: ' + hna.gap30);

    record('smoke', 'HNA Delta — AMI Gap ≤100% populated (7-band view)',
      hna.gap100 && hna.gap100 !== '—' ? 'pass' : 'fail',
      'got: ' + hna.gap100);

    record('smoke', 'HNA Delta — Scorecard v2 composite renders',
      hna.scorecardComp && /^\d+/.test(hna.scorecardComp) ? 'pass' : 'fail',
      'got: ' + hna.scorecardComp);

    record('smoke', 'HNA Delta — BLS header reads "Delta County" (not statewide)',
      /Delta/i.test(hna.blsHeader || '') ? 'pass' : 'fail',
      'header: ' + hna.blsHeader);

    // PMA page — load + verify amenity panel exists
    await page.goto(baseUrl + '/market-analysis.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    const pma = await page.evaluate(() => ({
      hasOsmAmenities: !!window.OsmAmenities,
      amenityCount: window.OsmAmenities && window.OsmAmenities.getAll
        ? window.OsmAmenities.getAll().length : 0,
      satelliteToggle: !!document.querySelector('.leaflet-control-layers')
    }));

    record('smoke', 'PMA — OsmAmenities loaded ≥20K records',
      pma.amenityCount >= 20000 ? 'pass' : 'fail',
      'got ' + pma.amenityCount);

    record('smoke', 'PMA — Satellite tile-layer toggle present',
      pma.satelliteToggle ? 'pass' : 'fail');

  } finally {
    await browser.close();
    server.kill();
  }
}

/* ── Run ──────────────────────────────────────────────────────────── */

(async function main() {
  console.log('\x1b[1mQA/QC verification — recent changes (PRs #881-#890)\x1b[0m');
  console.log('Repo: ' + ROOT);
  if (ONLY) console.log('Category filter: ' + ONLY);
  if (SKIP_PUPPET) console.log('--skip-puppeteer flag set');

  runSchemaChecks();
  runUnitTests();
  runUrlChecks();
  await runSmokeTest();

  console.log('\n\x1b[1mSummary\x1b[0m');
  console.log(`  passed: ${results.pass}`);
  console.log(`  failed: ${results.fail}`);
  console.log(`  skipped: ${results.skip}`);
  if (results.fail > 0) {
    console.log('\n\x1b[31mFAILED:\x1b[0m');
    results.items.filter(i => i.status === 'fail').forEach((i) => {
      console.log(`  [${i.category}] ${i.name}  — ${i.detail}`);
    });
    process.exit(1);
  }
  console.log('\n\x1b[32mAll checks passed.\x1b[0m');
  process.exit(0);
})().catch((err) => {
  console.error('\x1b[31mRunner error:\x1b[0m', err);
  process.exit(2);
});
