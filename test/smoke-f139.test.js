#!/usr/bin/env node
/**
 * smoke-f139.test.js — F140
 * ==========================
 * Fast smoke test (~2s) that verifies the F119-F139 changes are wired
 * correctly across data, components, renderers, and HTML pages. Catches
 * the "did a refactor silently remove a mount point" class of bug.
 *
 * This is NOT a browser walk-through (use Playwright for that). It's a
 * static verification that asserts:
 *
 *   1. Curated data has the expected shape + key records present
 *   2. Each HTML page loads the components it depends on
 *   3. Each renderer JS file references the mount points it expects
 *   4. The unified properties.json has Silt + Lakota Ridge deduped
 *
 * Run:  node test/smoke-f139.test.js
 *       npm run test:smoke (after wiring up)
 *
 * Exit 0 = all checks pass. Exit 1 = at least one regression detected.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
function check(label, cond, hint) {
  if (cond) {
    console.log('  ✓ ' + label);
  } else {
    console.log('  ✗ ' + label + (hint ? ' — ' + hint : ''));
    fails.push(label);
  }
}
function readJson(rel)  { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')); }
function readText(rel)  { return fs.readFileSync(path.join(ROOT, rel), 'utf-8'); }
function exists(rel)    { return fs.existsSync(path.join(ROOT, rel)); }

// ─────────────────────────────────────────────────────────────────────
// 1. Data files have expected shape + key records
// ─────────────────────────────────────────────────────────────────────
console.log('\n── 1. Data files ──');

// F128 — properties.json has Silt + dedupes Lakota Ridge
const props = readJson('data/affordable-housing/properties.json').properties;
const silt = props.find(p => (p.city || '').toLowerCase() === 'silt' && p.property_name === 'Silt Senior Housing');
check('Silt Senior Housing present in properties.json (F122)', !!silt,
  'Run scripts/build-affordable-housing-properties.js');
check('Silt has pbv-local program_type', silt && (silt.program_type || []).includes('pbv-local'));
check('Silt has Garfield County HA as PHA', silt && silt.pha_administered_by === 'Garfield County Housing Authority');

const newCastle = props.filter(p => (p.city || '').toLowerCase() === 'new castle');
check('New Castle deduped to 2 records (was 4) (F128)', newCastle.length === 2,
  'Got ' + newCastle.length);
const lakota = newCastle.find(p => /lakota ridge/i.test(p.property_name || ''));
check('Lakota Ridge has merged source provenance', lakota && lakota.source && /\+/.test(lakota.source),
  'merged_from should track CHFA LIHTC + CHFA Preservation');

// F128 — manifest matches content
const manifestPath = 'data/affordable-housing/properties-manifest.json';
check('Manifest file exists (F128)', exists(manifestPath));
if (exists(manifestPath)) {
  const manifest = readJson(manifestPath);
  const crypto = require('crypto');
  const liveHash = crypto.createHash('sha1')
    .update(readText('data/affordable-housing/properties.json'))
    .digest('hex').slice(0, 12);
  check('Manifest hash matches live properties.json content', manifest.v === liveHash,
    'Run build script to refresh manifest');
}

// F136 — local-resources expansion
const lr = readJson('data/hna/local-resources.json');
const placeKeys = Object.keys(lr).filter(k => k.startsWith('place:'));
check('At least 60 places have local-resources entries (F136)', placeKeys.length >= 60,
  'Got ' + placeKeys.length + ' place entries');

const sdCount = placeKeys.filter(k => lr[k].schoolDistrict).length;
const hospCount = placeKeys.filter(k => lr[k].hospital).length;
const empCount = placeKeys.filter(k => Array.isArray(lr[k].majorEmployers) && lr[k].majorEmployers.length).length;
check('≥40 places have curated schoolDistrict (F131/F136)', sdCount >= 40, 'Got ' + sdCount);
check('≥30 places have curated hospital (F132/F136)',       hospCount >= 30, 'Got ' + hospCount);
check('≥30 places have curated majorEmployers (F133/F136)', empCount >= 30, 'Got ' + empCount);

// F130 — Lake/La Plata swap fixed
check('Lake County (08065) has Lake County HA', /Lake County Housing Authority/i.test(
  lr['county:08065'] && lr['county:08065'].housingAuthority && lr['county:08065'].housingAuthority[0].name || ''));
check('La Plata County (08067) has Durango/La Plata HA', /Durango|La Plata/i.test(
  lr['county:08067'] && lr['county:08067'].housingAuthority && lr['county:08067'].housingAuthority[0].name || ''));

// F130 — Mountain Family Center on Grand County, NOT Garfield/New Castle
const mfcOnGarfield = (lr['county:08045'].advocacy || []).some(a => /^Mountain Family Center$/i.test(a.name));
const mfcOnGrand    = (lr['county:08049'].advocacy || []).some(a => /^Mountain Family Center$/i.test(a.name));
check('Mountain Family Center NOT on Garfield County (F130)', !mfcOnGarfield);
check('Mountain Family Center IS on Grand County (F130)', mfcOnGrand);

// F138 — capital-partners.json
const cp = readJson('data/capital-partners.json');
check('capital-partners.json present (F138)', !!cp.partners);
check('capital-partners has 15+ entries', cp.partners.length >= 15, 'Got ' + cp.partners.length);
check('CHFA is in capital-partners', cp.partners.some(p => /^Colorado Housing and Finance/i.test(p.name)));
check('USDA RD is in capital-partners', cp.partners.some(p => /USDA Rural Development/i.test(p.name)));

// ─────────────────────────────────────────────────────────────────────
// 2. Components loaded on every analytic page
// ─────────────────────────────────────────────────────────────────────
console.log('\n── 2. Component loading on HTML pages ──');

const ANALYTIC_PAGES = [
  'housing-needs-assessment.html',
  'market-analysis.html',
  'colorado-deep-dive.html',
  'lihtc-opportunity-finder.html',
  'compare.html',
  'deal-calculator.html',
  'ic-summary.html'
];
ANALYTIC_PAGES.forEach(page => {
  if (!exists(page)) return;
  const html = readText(page);
  check(page + ' loads method-footer.js (F134)',   /js\/components\/method-footer\.js/.test(html));
  check(page + ' loads capital-partners.js (F138)', /js\/components\/capital-partners\.js/.test(html));
});

// HNA + OF + IC summary also need property-lookup-links + affordable-housing-layer
['housing-needs-assessment.html','lihtc-opportunity-finder.html','ic-summary.html'].forEach(page => {
  if (!exists(page)) return;
  const html = readText(page);
  check(page + ' loads affordable-housing-layer.js', /affordable-housing-layer\.js/.test(html));
  check(page + ' loads property-lookup-links.js (F124)', /property-lookup-links\.js/.test(html));
});

// ─────────────────────────────────────────────────────────────────────
// 3. Renderer mount points exist
// ─────────────────────────────────────────────────────────────────────
console.log('\n── 3. Renderer mount points + section IDs ──');

// HNA — info panel + community institutions + capital partners
const hnaHtml = readText('housing-needs-assessment.html');
check('HNA has #lihtcInfoPanel mount',   /id="lihtcInfoPanel"/.test(hnaHtml));

// OF — comp set mount (F137)
const ofHtml = readText('lihtc-opportunity-finder.html');
check('OF detail has #lofDetailCompSet (F137)', /id="lofDetailCompSet"/.test(ofHtml));

// IC summary — new section mounts (F139)
const icHtml = readText('ic-summary.html');
check('IC summary has #icSchoolDist (F139)',         /id="icSchoolDist"/.test(icHtml));
check('IC summary has #icHospital (F139)',           /id="icHospital"/.test(icHtml));
check('IC summary has #icEmployers (F139)',          /id="icEmployers"/.test(icHtml));
check('IC summary has #icCapitalPartners (F139)',    /id="icCapitalPartners"/.test(icHtml));
check('IC summary has #icMultiSourceComp (F139)',    /id="icMultiSourceComp"/.test(icHtml));

// ─────────────────────────────────────────────────────────────────────
// 4. Renderer JS calls expected functions
// ─────────────────────────────────────────────────────────────────────
console.log('\n── 4. Renderer wiring ──');

const icJs = readText('js/ic-summary.js');
check('ic-summary.js calls renderAnchorInstitutions',  /renderAnchorInstitutions/.test(icJs));
check('ic-summary.js calls renderCapitalPartners',     /renderCapitalPartners/.test(icJs));
check('ic-summary.js calls renderMultiSourceComp',     /renderMultiSourceComp/.test(icJs));

const ofJs = readText('js/lihtc-opportunity-finder.js');
check('OF JS calls _renderCompSet (F137)',             /_renderCompSet/.test(ofJs));

const hnaRendererJs = readText('js/hna/hna-renderers.js');
check('HNA renderers call _renderCommunityInstitutionsSection (F131)', /_renderCommunityInstitutionsSection/.test(hnaRendererJs));
check('HNA renderers call _renderMajorEmployersSection (F133)',         /_renderMajorEmployersSection/.test(hnaRendererJs));
check('HNA renderers reference #lr-capital-partners-mount (F138)',      /lr-capital-partners-mount/.test(hnaRendererJs));

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
if (!fails.length) {
  console.log('✓ Smoke test PASSED — F119-F139 wired correctly.');
  process.exit(0);
} else {
  console.log('✗ Smoke test FAILED — ' + fails.length + ' regression(s):');
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
