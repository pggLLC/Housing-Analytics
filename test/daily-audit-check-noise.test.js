'use strict';

/**
 * The daily audit's three "failed" checks on 2026-10-09, each of which had
 * failed the same way every day since at least 2026-09-22.
 *
 * A check that fails every day for a reason nobody will act on teaches the
 * reader to skip it (see test/signals-that-cry-wolf.test.mjs). Each block
 * below pins one cause shut, and checks it against what it has to agree
 * with: the data, the data-source inventory, and the weekly sweeps' policy.
 *
 *  1. Logic: QCT is null on every CHFA LIHTC record. The audit was right to
 *     say so, and right that the site must not render it as a negative. The
 *     opportunity finder did: `pr.QCT || 'no'` printed "QCT no" on all 926
 *     projects. It now says "not published". The audit finding stays, since
 *     the data gap is real.
 *  2. Logic: data/hna/municipal-config.json was a "required" file that
 *     nothing has ever built; the inventory lists it as planned.
 *  3. Links: a bare HEAD request reported a 405-to-HEAD host as broken, and
 *     two hosts that 403 every datacenter client as broken. See
 *     audit-modules/link-check.js.
 *  4. Email: a "(critical)" tag on the check type read as a severity.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { probeLink, classifyLinkResults } = require('./audit-modules/link-check.js');
const { runLogicValidationChecks } = require('./audit-modules/logic-validation.js');
const { buildHtmlReport } = require('./audit-modules/report-generator.js');

let failures = 0;
async function run(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function loadOpportunityFinder() {
  global.window = global;
  global.document = {
    readyState: 'loading',
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; }
  };
  global.ChfaRentLimits = require('../js/chfa-rent-limits.js');
  require('../js/components/zori-rent-utils.js');
  require('../js/lihtc-opportunity-finder.js');
  const lof = global.__LOF && global.__LOF._test;
  assert.ok(lof && typeof lof.projectMetaTail === 'function', 'expected __LOF._test.projectMetaTail');
  return lof;
}

(async () => {
  console.log('daily-audit-check-noise');

  // ── 1. QCT absence is not "no" ────────────────────────────────────────────
  const lof = loadOpportunityFinder();
  const lihtc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'));

  await run('every CHFA project renders QCT as published only when the data publishes it', () => {
    const features = lihtc.features || [];
    assert.ok(features.length > 0, 'data/chfa-lihtc.json has no features; the scan checked nothing');
    for (const f of features) {
      const pr = f.properties || {};
      const text = lof.projectMetaTail(pr);
      const absent = pr.QCT == null || pr.QCT === '';
      if (absent) {
        assert.ok(/QCT not published$/.test(text), `${pr.PROJECT}: absent QCT rendered as "${text}"`);
      } else {
        assert.ok(!/not published/.test(text), `${pr.PROJECT}: published QCT ${pr.QCT} rendered as "${text}"`);
      }
    }
  });

  // The site's own QCT measurement sits beside CHFA's blank, never in it:
  // pr.QCT is untouched, and the note names the map year it was measured on.
  const qctMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'qct-colorado.json'), 'utf8'));
  const mapYear = (/(19|20)\d{2}/.exec(String(qctMap.source || '')) || [])[0];

  // Independent point-in-polygon (winding number), so the guard does not
  // trust the module's own ray caster.
  function windingContains(lon, lat, ring) {
    let wn = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const side = (x2 - x1) * (lat - y1) - (lon - x1) * (y2 - y1);
      if (y1 <= lat) { if (y2 > lat && side > 0) wn++; }
      else if (y2 <= lat && side < 0) wn--;
    }
    return wn !== 0;
  }
  function tractFor(lon, lat) {
    for (const f of qctMap.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) {
        if (windingContains(lon, lat, rings[0]) && !rings.slice(1).some(h => windingContains(lon, lat, h))) {
          return f.properties.GEOID;
        }
      }
    }
    return null;
  }

  await run('every project\'s QCT map status agrees with the HUD QCT map the site holds', () => {
    assert.ok(mapYear, 'data/qct-colorado.json source names no map year; the label would not say whose map it is');
    const features = (lihtc.features || []).filter(f => f.geometry && f.geometry.type === 'Point');
    assert.ok(features.length > 0, 'no project points; the scan checked nothing');
    let inside = 0;
    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates;
      const want = tractFor(lon, lat);
      const got = lof.qctMapStatus(f, qctMap);
      assert.ok(got, `${f.properties.PROJECT}: point present but no status`);
      assert.equal(got.inQct, !!want, `${f.properties.PROJECT}: module says ${got.inQct}, map says ${want}`);
      assert.equal(got.tract, want, `${f.properties.PROJECT}: tract ${got.tract} vs ${want}`);
      assert.equal(got.year, mapYear);
      if (want) inside += 1;
      const text = lof.projectMetaTail(f.properties, got);
      assert.ok(text.includes((got.inQct ? 'in a QCT on the ' : 'not in a QCT on the ') + mapYear + ' HUD map'),
        `${f.properties.PROJECT}: rendered "${text}"`);
      assert.ok(/QCT not published · /.test(text), `${f.properties.PROJECT}: CHFA's blank must still read "not published"`);
    }
    // Both outcomes occur, so neither label is a constant.
    assert.ok(inside > 0 && inside < features.length, `${inside} of ${features.length} projects inside a QCT`);
  });

  await run('a project with no point, or no map, is unknown, not "not in a QCT"', () => {
    assert.equal(lof.qctMapStatus({ properties: {} }, qctMap), null);
    assert.equal(lof.qctMapStatus({ geometry: { type: 'Point', coordinates: [-105, 39.7] } }, { features: [] }), null);
    assert.ok(!/QCT on the/.test(lof.projectMetaTail({ QCT: null }, null)));
  });

  await run('HUD QCT codes still render: 1 is yes, 2 is no', () => {
    assert.match(lof.projectMetaTail({ QCT: 1, N_UNITS: 10, LI_UNITS: 8 }), /QCT yes$/);
    assert.match(lof.projectMetaTail({ QCT: '2', N_UNITS: 10, LI_UNITS: 8 }), /QCT no$/);
  });

  await run('an absent unit count is unknown, not 0 units', () => {
    const text = lof.projectMetaTail({ QCT: null });
    assert.ok(!/\b0 units/.test(text) && !/\(0 LI\)/.test(text), `rendered "${text}"`);
    assert.match(lof.projectMetaTail({ N_UNITS: 16, LI_UNITS: 16 }), /^16 units \(16 LI\)/);
  });

  // ── 2. Required HNA files agree with the data-source inventory ────────────
  await run('the logic check requires no file the inventory lists as planned', async () => {
    const inventory = fs.readFileSync(path.join(ROOT, 'js', 'data-source-inventory.js'), 'utf8');
    // One segment per inventory entry, from its id to the next entry's id.
    const planned = inventory.split(/\n\s*id:\s*'/).slice(1)
      .filter(seg => /maintenance:\s*'planned'/.test(seg))
      .map(seg => seg.slice(0, seg.indexOf("'")));
    assert.ok(planned.includes('municipal-config'),
      'expected municipal-config to be listed as planned in js/data-source-inventory.js');
    const issues = await runLogicValidationChecks();
    const missing = issues.filter(i => /Required HNA file missing/.test(i.description));
    for (const issue of missing) {
      const id = path.basename(issue.file, '.json');
      assert.ok(!planned.includes(id), `audit reports planned file ${issue.file} as missing`);
    }
  });

  // ── 3. Links: ask like a reader, and a refusal is not rot ─────────────────
  await run('a host that refuses HEAD is retried with GET and passes', async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push(opts);
      return opts.method === 'HEAD'
        ? { ok: false, status: 405, redirected: false }
        : { ok: true, status: 200, redirected: false };
    };
    const headers = { 'User-Agent': 'UA', 'Accept': 'text/html' };
    const result = await probeLink(fakeFetch, 'https://example.org/', { headers });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(c => c.method), ['HEAD', 'GET']);
    for (const c of calls) {
      assert.equal(c.headers['User-Agent'], 'UA', 'request sent without the browser User-Agent');
      assert.equal(c.headers.Accept, 'text/html', 'request sent without the browser Accept');
    }
  });

  await run('401/403/429 are declined, everything else that fails is broken', () => {
    const results = [401, 403, 429, 404, 410, 500, null].map(status => ({
      url: `https://example.org/${status}`, status, ok: false, slow: false, redirected: false,
    }));
    const { broken, declined } = classifyLinkResults(results);
    assert.deepEqual(declined.map(r => r.status), [401, 403, 429]);
    assert.deepEqual(broken.map(r => r.status), [404, 410, 500, null]);
  });

  await run('the declined set matches the weekly sweep policy', async () => {
    // url-health-policy.mjs treats 'auth' (401/403) and 'ratelimit' (429) as a
    // live host answering. If the sweeps change that, this must change too.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'url-health-policy.mjs'), 'utf8');
    assert.match(src, /HEALTHY_STATUSES = new Set\(\[[^\]]*'auth'[^\]]*'ratelimit'/,
      'url-health-policy.mjs no longer treats auth/ratelimit as healthy');
    const { DECLINED_STATUSES } = require('./audit-modules/link-check.js');
    assert.deepEqual([...DECLINED_STATUSES].sort(), [401, 403, 429]);
  });

  // ── 4. The email does not call a check type "critical" ───────────────────
  await run('a core check with medium findings is not labelled critical', () => {
    const html = buildHtmlReport({
      summary: { critical: 0, high: 0, medium: 1, low: 0, total: 1 },
      allIssues: [],
      comparison: { newIssues: [], resolvedIssues: [], persistentIssues: [] },
      priorDate: null,
      trend: [],
      runDurationMs: 0,
      auditHealth: {
        totalChecks: 1, passed: 0, failed: 1, skipped: 0, unavailable: 0,
        checks: [{ name: 'Logic & Methodology Validation', critical: true, status: 'failed' }],
      },
    });
    assert.ok(html.includes('Logic &amp; Methodology Validation'), 'check table did not render');
    assert.ok(!/\(critical\)/.test(html), 'check type still labelled "(critical)"');
    assert.ok(html.includes('(core check)'));
  });

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll daily-audit-check-noise tests passed.');
})();
