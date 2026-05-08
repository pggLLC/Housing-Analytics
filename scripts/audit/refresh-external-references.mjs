#!/usr/bin/env node
/**
 * scripts/audit/refresh-external-references.mjs
 *
 * Refresh the external reference docs mirrored in docs/_external-references/.
 * Two responsibilities:
 *
 *   1. **Fetch from upstream directly** with a browser-grade User-Agent so
 *      we don't depend on Wayback Machine. Several federal data publishers
 *      (HUD's CDN especially) gate downloads behind a WAF challenge for
 *      bot User-Agents but accept browser ones. The 2026-05-08 audit found
 *      the HUD CHAS data dictionary was effectively only fetchable via
 *      Wayback because the original urllib-based fetch returned HTTP 202
 *      with empty body. With `Mozilla/5.0 (...) Chrome/...` HUD ships the
 *      file directly.
 *
 *   2. **Integrity check** — for each tracked reference, compute SHA-256
 *      of the upstream copy and compare against the pinned hash in
 *      `provenance.json`. When upstream ships a corrected version (rare
 *      but happens), this detects drift within 24 hours of the next cron run.
 *
 * Behavior modes
 * --------------
 *   --check       (default)  fetch upstream, compare SHA-256 to pinned, exit 1 on drift
 *   --refresh                fetch upstream, replace local copy + provenance.json
 *   --pin                    fetch upstream, write provenance.json (initial setup)
 *
 * Output: `docs/_external-references/<file>.provenance.json` per tracked file:
 *   {
 *     "source_url":   "...",
 *     "retrieved_at": "ISO timestamp",
 *     "sha256":       "...",
 *     "size_bytes":   N,
 *     "fetch_method": "https + browser User-Agent",
 *     "notes":        "..."
 *   }
 *
 * Exit codes
 * ----------
 *   0 — all checks pass (or refresh succeeded)
 *   1 — at least one reference drifted from pinned hash
 *   2 — internal error (network, file write)
 *
 * Usage
 * -----
 *   node scripts/audit/refresh-external-references.mjs --check
 *   node scripts/audit/refresh-external-references.mjs --refresh
 *   node scripts/audit/refresh-external-references.mjs --pin
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REFS_DIR = path.join(ROOT, 'docs', '_external-references');

// Browser-grade User-Agent that HUD's WAF accepts. Updated when major
// browsers bump versions; the WAF check is permissive on the browser
// detection so this doesn't need to track Chrome's release cadence.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// Tracked external references. Add a row when mirroring a new doc.
const TRACKED = [
  {
    name:        'HUD-CHAS-data-dictionary-2018-2022.xlsx',
    source_url:  'https://www.huduser.gov/portal/datasets/cp/CHAS-data-dictionary-18-22.xlsx',
    notes:       'HUD CHAS Table column → semantic mapping for 2018-2022 vintage. ' +
                 'Required reference for scripts/fetch_chas.py to interpret which ' +
                 'T7_estN column corresponds to which HAMFI tier × cost-burden cell. ' +
                 'HUD CDN gates direct downloads behind a WAF challenge for bot ' +
                 'User-Agents (returns HTTP 202 + empty body); using a browser UA ' +
                 'bypasses the gate cleanly.',
  },
  // Add more here as new pipelines mirror their reference docs.
];

const MODE_CHECK = '--check';
const MODE_REFRESH = '--refresh';
const MODE_PIN = '--pin';
const args = process.argv.slice(2);
const mode = args.find(a => [MODE_CHECK, MODE_REFRESH, MODE_PIN].includes(a)) || MODE_CHECK;

function log(...m) { console.log(...m); }
function err(...m) { console.error(...m); }


/**
 * Fetch a URL with a browser User-Agent. Returns { status, bytes, sha256 }.
 * Throws on non-2xx response.
 */
async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept':     '*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  return { status: res.status, bytes: buf, sha256: sha };
}

async function readSha256OfFile(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function loadProvenance(name) {
  const p = path.join(REFS_DIR, `${name}.provenance.json`);
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

async function writeProvenance(name, payload) {
  const p = path.join(REFS_DIR, `${name}.provenance.json`);
  await fs.writeFile(p, JSON.stringify(payload, null, 2) + '\n');
}


async function checkOne(ref) {
  const localPath = path.join(REFS_DIR, ref.name);
  const provPath = path.join(REFS_DIR, `${ref.name}.provenance.json`);

  // 1. Verify local copy exists
  try {
    await fs.access(localPath);
  } catch {
    err(`  ✗ ${ref.name}: local copy missing at ${path.relative(ROOT, localPath)}`);
    return { name: ref.name, status: 'missing-local' };
  }

  const localSha = await readSha256OfFile(localPath);
  const prov = await loadProvenance(ref.name);

  if (mode === MODE_PIN) {
    // Just record current local SHA + try a fresh upstream fetch for cross-check
    let upstreamSha = null;
    try {
      const r = await fetchUpstream(ref.source_url);
      upstreamSha = r.sha256;
    } catch (e) {
      err(`  ⚠ ${ref.name}: upstream fetch failed during --pin: ${e.message}`);
    }
    await writeProvenance(ref.name, {
      source_url:   ref.source_url,
      retrieved_at: new Date().toISOString(),
      sha256:       localSha,
      size_bytes:   (await fs.stat(localPath)).size,
      fetch_method: 'https + browser User-Agent',
      notes:        ref.notes,
      upstream_sha256_at_pin: upstreamSha,
      upstream_matches:       upstreamSha === localSha,
    });
    log(`  ✓ ${ref.name}: pinned local sha=${localSha.slice(0, 12)}…` +
        (upstreamSha
          ? ` (upstream ${upstreamSha === localSha ? 'matches' : 'DIFFERS'})`
          : ' (upstream not reachable)'));
    return { name: ref.name, status: 'pinned', localSha, upstreamSha };
  }

  // CHECK / REFRESH modes both fetch upstream
  let upstream;
  try {
    upstream = await fetchUpstream(ref.source_url);
  } catch (e) {
    err(`  ✗ ${ref.name}: upstream fetch failed: ${e.message}`);
    return { name: ref.name, status: 'fetch-failed', error: e.message };
  }

  if (mode === MODE_REFRESH) {
    // Always replace local + bump provenance
    await fs.writeFile(localPath, upstream.bytes);
    await writeProvenance(ref.name, {
      source_url:   ref.source_url,
      retrieved_at: new Date().toISOString(),
      sha256:       upstream.sha256,
      size_bytes:   upstream.bytes.length,
      fetch_method: 'https + browser User-Agent',
      notes:        ref.notes,
      previous_sha256: localSha !== upstream.sha256 ? localSha : null,
    });
    if (localSha === upstream.sha256) {
      log(`  ✓ ${ref.name}: upstream unchanged (sha=${upstream.sha256.slice(0, 12)}…)`);
    } else {
      log(`  ↻ ${ref.name}: REFRESHED. local was ${localSha.slice(0, 12)}…, now ${upstream.sha256.slice(0, 12)}…`);
    }
    return { name: ref.name, status: 'refreshed', upstreamSha: upstream.sha256, prevLocalSha: localSha };
  }

  // CHECK mode: compare upstream to pinned hash
  const pinnedSha = prov?.sha256;
  if (!pinnedSha) {
    err(`  ⚠ ${ref.name}: no provenance.json (run --pin to initialize)`);
    return { name: ref.name, status: 'no-provenance' };
  }

  if (upstream.sha256 === pinnedSha && localSha === pinnedSha) {
    log(`  ✓ ${ref.name}: upstream + local match pinned sha (${pinnedSha.slice(0, 12)}…)`);
    return { name: ref.name, status: 'ok', sha256: pinnedSha };
  }

  if (localSha !== pinnedSha) {
    err(`  ✗ ${ref.name}: LOCAL drifted from pinned. ` +
        `local=${localSha.slice(0, 12)}… pinned=${pinnedSha.slice(0, 12)}…`);
  }
  if (upstream.sha256 !== pinnedSha) {
    err(`  ✗ ${ref.name}: UPSTREAM drifted from pinned. ` +
        `upstream=${upstream.sha256.slice(0, 12)}… pinned=${pinnedSha.slice(0, 12)}…`);
    err(`    → HUD likely shipped a corrected version. Run --refresh to update.`);
  }
  return {
    name: ref.name,
    status: 'drift',
    localSha, upstreamSha: upstream.sha256, pinnedSha,
  };
}


async function main() {
  log(`refresh-external-references mode=${mode}`);
  log('');

  const results = [];
  for (const ref of TRACKED) {
    results.push(await checkOne(ref));
  }
  log('');

  const driftCount = results.filter(r => r.status === 'drift').length;
  const failCount = results.filter(r =>
    ['missing-local', 'fetch-failed', 'no-provenance'].includes(r.status)
  ).length;

  log(`Summary: ${results.length} reference(s) checked, ` +
      `${driftCount} drifted, ${failCount} failed.`);

  if (driftCount > 0 || failCount > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  err('refresh-external-references crashed:', e);
  process.exit(2);
});
