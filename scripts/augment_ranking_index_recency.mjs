#!/usr/bin/env node
/**
 * F179 — Augment ranking-index.json with LIHTC recency fields.
 *
 * Adds per-jurisdiction:
 *   - latest_lihtc_year   (CHFA AwardYear or YR_PIS, whichever is highest)
 *   - lihtc_project_count (count of CHFA LIHTC projects matching this jurisdiction)
 *   - r1_2026_count       (2026 R1 bridge awards in this jurisdiction)
 *   - drought_years       (CURRENT_YEAR - latest_lihtc_year, null if never funded)
 *   - recency_score       (F146 formula: min(100, drought × 25); 100 means
 *                          "never funded on record", treated as max opportunity)
 *   - recency_basis       ('award_year' | 'pis_year' | 'r1_bridge' | 'never_funded')
 *
 * Matches CHFA records to jurisdictions by uppercased city name against
 * the entry's `name` field (stripping common LSAD suffixes — "city",
 * "town", "CDP"). This is the same matching logic compare.js + the OF
 * use at runtime, just persisted so consumers don't recompute.
 *
 * Idempotent — re-running with the same input data produces the same
 * output; safe to re-run after a CHFA feed refresh.
 *
 * Usage:
 *   node scripts/augment_ranking_index_recency.mjs           (writes back)
 *   node scripts/augment_ranking_index_recency.mjs --dry     (preview, no write)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry');
const CURRENT_YEAR = 2026;
const MAX_RECENCY_YEARS = 4;  // matches F146 / compare.js / OF

const RANKING_INDEX_PATH = path.join(REPO_ROOT, 'data', 'hna', 'ranking-index.json');
const CHFA_PROPS_PATH    = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const R1_BRIDGE_PATH     = path.join(REPO_ROOT, 'data', 'affordable-housing', 'chfa-awards', '2026-round-one.json');

function _normCity(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s*\(?(city|town|cdp|cdp\.|village)\)?\s*$/i, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

function _recencyScore(lastYear) {
  if (lastYear == null) return 100;
  const yrs = Math.max(0, CURRENT_YEAR - lastYear);
  return Math.min(100, Math.round((yrs / MAX_RECENCY_YEARS) * 100));
}

async function main() {
  const [riText, chfaText, r1Text] = await Promise.all([
    fs.readFile(RANKING_INDEX_PATH, 'utf8'),
    fs.readFile(CHFA_PROPS_PATH, 'utf8'),
    fs.readFile(R1_BRIDGE_PATH, 'utf8'),
  ]);
  const ri    = JSON.parse(riText);
  const chfa  = JSON.parse(chfaText);
  const r1    = JSON.parse(r1Text);
  const r1Yr  = Number((r1.metadata && r1.metadata.round || '').match(/(\d{4})/)?.[1])
              || Number((r1.metadata && r1.metadata.announcement_date || '').slice(0, 4))
              || 2026;

  // Build per-city aggregates from CHFA props.
  // F234 — Stratify by credit type (TypeOfCredits) so the OF's recency
  // scoring can use the right history per target preset (4% / 9% /
  // state-credit). Without this, a place last awarded under 9%
  // Competitive (e.g., Rifle 2023) gets penalized on 4% recency even
  // though it has zero 4% history, and CHFA's geographic-spread logic
  // for bond cap doesn't track 9% Competitive at all.
  const chfaByCity = new Map();
  for (const f of (chfa.features || [])) {
    const p = f.properties || {};
    const city = _normCity(p.PROJ_CTY || p.PROJ_CITY);
    if (!city) continue;
    const entry = chfaByCity.get(city) || {
      count: 0, latestAward: null, latestPis: null,
      // F234 — credit-type-specific latest-year + counts
      count_9pct: 0, latest_9pct: null,
      count_4pct: 0, latest_4pct: null,
      count_state_credit: 0, latest_state_credit: null,
      count_competitive: 0, latest_competitive: null,
    };
    entry.count++;
    const aw = parseInt(p.AwardYear || p.YR_ALLOC, 10);
    if (Number.isFinite(aw) && (entry.latestAward == null || aw > entry.latestAward)) entry.latestAward = aw;
    const pis = parseInt(p.YR_PIS, 10);
    if (Number.isFinite(pis) && (entry.latestPis == null || pis > entry.latestPis)) entry.latestPis = pis;
    // F234 — type classification. The TypeOfCredits string carries the
    // canonical CHFA labels: "9% Competitive", "4% Tax Exempt",
    // "4% and State", "9% and State", "4% and Noncompetitive State", etc.
    const type = String(p.TypeOfCredits || '').toLowerCase();
    const yr = Number.isFinite(aw) ? aw : (Number.isFinite(pis) ? pis : null);
    const has9pct        = type.includes('9%');
    const has4pct        = type.includes('4%');
    const hasStateCredit = type.includes('state'); // catches "and State" + "Noncompetitive State"
    // "Competitive" = where CHFA's geographic-spread logic actually
    // bites: 9% (any flavor — "9% Competitive" AND "9% and State")
    // + 4% and State (state credit allocation is scarce + competitively
    // scored). Excludes pure "4% Tax Exempt" (bond cap allocation
    // rarely binds + isn't geographically spread). F239a — added
    // has9pct branch so Parachute 2024 "9% and State" propagates to
    // Garfield County's regional competitive recency.
    const isCompetitive = has9pct || (has4pct && hasStateCredit) || type.includes('competitive');
    if (yr != null) {
      if (has9pct) {
        entry.count_9pct++;
        if (entry.latest_9pct == null || yr > entry.latest_9pct) entry.latest_9pct = yr;
      }
      if (has4pct) {
        entry.count_4pct++;
        if (entry.latest_4pct == null || yr > entry.latest_4pct) entry.latest_4pct = yr;
      }
      if (hasStateCredit) {
        entry.count_state_credit++;
        if (entry.latest_state_credit == null || yr > entry.latest_state_credit) entry.latest_state_credit = yr;
      }
      if (isCompetitive) {
        entry.count_competitive++;
        if (entry.latest_competitive == null || yr > entry.latest_competitive) entry.latest_competitive = yr;
      }
    }
    chfaByCity.set(city, entry);
  }

  const r1ByCity = new Map();
  for (const a of (r1.awards || [])) {
    const city = _normCity(a.city);
    if (!city) continue;
    r1ByCity.set(city, (r1ByCity.get(city) || 0) + 1);
  }

  // Annotate each ranking entry.
  let touched = 0;
  let neverFunded = 0;
  for (const e of (ri.rankings || [])) {
    const cityKey = _normCity(e.name);
    const chfaAgg = chfaByCity.get(cityKey) || null;
    const r1n     = r1ByCity.get(cityKey) || 0;

    const latestAward = chfaAgg && chfaAgg.latestAward;
    const latestPis   = chfaAgg && chfaAgg.latestPis;
    // Newest year wins. R1 bridge counts as a 2026 signal — included so
    // the recency score is consistent with what the OF + Compare pages
    // compute at runtime.
    const candidates = [latestAward, latestPis, r1n > 0 ? r1Yr : null].filter(y => Number.isFinite(y));
    const latest_lihtc_year = candidates.length ? Math.max(...candidates) : null;
    const recency_basis = latest_lihtc_year == null ? 'never_funded'
                        : (r1n > 0 && latest_lihtc_year === r1Yr) ? 'r1_bridge'
                        : (latestAward != null && latest_lihtc_year === latestAward) ? 'award_year'
                        : 'pis_year';
    const drought_years = latest_lihtc_year == null ? null : Math.max(0, CURRENT_YEAR - latest_lihtc_year);
    const recency_score = _recencyScore(latest_lihtc_year);

    e.metrics = e.metrics || {};
    e.metrics.latest_lihtc_year   = latest_lihtc_year;
    e.metrics.lihtc_project_count = chfaAgg ? chfaAgg.count : 0;
    e.metrics.r1_2026_count       = r1n;
    e.metrics.drought_years       = drought_years;
    e.metrics.recency_score       = recency_score;
    e.metrics.recency_basis       = recency_basis;

    // F234 — Per-credit-type recency. The OF reads these per preset
    // (4pct → latest_4pct_year or latest_state_credit_year; 9pct →
    // latest_9pct_year; etc.) so a recent 9% award doesn't penalize
    // 4%-bond recency, and vice versa.
    if (chfaAgg) {
      e.metrics.latest_9pct_year         = chfaAgg.latest_9pct;
      e.metrics.latest_4pct_year         = chfaAgg.latest_4pct;
      e.metrics.latest_state_credit_year = chfaAgg.latest_state_credit;
      e.metrics.latest_competitive_year  = chfaAgg.latest_competitive;
      e.metrics.lihtc_9pct_count         = chfaAgg.count_9pct;
      e.metrics.lihtc_4pct_count         = chfaAgg.count_4pct;
      e.metrics.lihtc_state_credit_count = chfaAgg.count_state_credit;
      e.metrics.lihtc_competitive_count  = chfaAgg.count_competitive;
      // Pre-computed recency scores per type — saves the OF from re-doing
      // the math on every render. Same formula as F146.
      e.metrics.recency_score_9pct         = _recencyScore(chfaAgg.latest_9pct);
      e.metrics.recency_score_4pct         = _recencyScore(chfaAgg.latest_4pct);
      e.metrics.recency_score_state_credit = _recencyScore(chfaAgg.latest_state_credit);
      e.metrics.recency_score_competitive  = _recencyScore(chfaAgg.latest_competitive);
    } else {
      // No CHFA history at all for this place — every type is "never funded"
      e.metrics.latest_9pct_year         = null;
      e.metrics.latest_4pct_year         = null;
      e.metrics.latest_state_credit_year = null;
      e.metrics.latest_competitive_year  = null;
      e.metrics.lihtc_9pct_count         = 0;
      e.metrics.lihtc_4pct_count         = 0;
      e.metrics.lihtc_state_credit_count = 0;
      e.metrics.lihtc_competitive_count  = 0;
      e.metrics.recency_score_9pct         = 100;
      e.metrics.recency_score_4pct         = 100;
      e.metrics.recency_score_state_credit = 100;
      e.metrics.recency_score_competitive  = 100;
    }

    touched++;
    if (latest_lihtc_year == null) neverFunded++;
  }

  // F239 — Regional (county-level) recency rollup.
  // CHFA's QAP scores geographic spread within the primary market area
  // (PMA) — typically 5–10 mi urban, 30 mi rural. A 2023 9% Competitive
  // award in Rifle absolutely depresses a 2026 Silt application's
  // saturation score even though Silt has zero own-jurisdiction LIHTC
  // history. Same logic applies to 4% + State (state credit allocation
  // is finite + geographically spread).
  //
  // First pass: walk every ranking entry, accumulate per-county MAX
  // latest_*_year across all places in that county.
  // Second pass: for each entry, expose regional_recency_year_* and
  // regional_recency_score_* using county MAX (which already covers
  // the entry's own value).
  //
  // Crude vs distance-weighted: county is a known approximation. Aspen
  // (Pitkin) and Rifle (Garfield) aren't in the same county so they
  // don't pollute each other. Within Garfield, Rifle/New Castle/Silt
  // share a market, so a single rollup captures the relevant spread.
  const countyAgg = new Map();
  for (const e of (ri.rankings || [])) {
    const county = e.containingCounty;
    if (!county) continue;
    const m = e.metrics || {};
    let bucket = countyAgg.get(county);
    if (!bucket) {
      bucket = {
        latest_lihtc:       null,
        latest_9pct:        null,
        latest_4pct:        null,
        latest_state_credit:null,
        latest_competitive: null,
        // Track the strongest-signal place so we can explain WHY a regional
        // score is what it is (e.g., "Rifle 2023 9% Competitive sets the
        // regional ceiling for Garfield County")
        anchor_9pct:        null,
        anchor_4pct:        null,
        anchor_state_credit:null,
        anchor_competitive: null,
        anchor_lihtc:       null,
      };
      countyAgg.set(county, bucket);
    }
    function _bump(field, anchorField, yr) {
      if (yr == null) return;
      if (bucket[field] == null || yr > bucket[field]) {
        bucket[field] = yr;
        bucket[anchorField] = e.name;
      }
    }
    _bump('latest_lihtc',        'anchor_lihtc',        m.latest_lihtc_year);
    _bump('latest_9pct',         'anchor_9pct',         m.latest_9pct_year);
    _bump('latest_4pct',         'anchor_4pct',         m.latest_4pct_year);
    _bump('latest_state_credit', 'anchor_state_credit', m.latest_state_credit_year);
    _bump('latest_competitive',  'anchor_competitive',  m.latest_competitive_year);
  }

  // Second pass: write regional fields per entry.
  for (const e of (ri.rankings || [])) {
    const county = e.containingCounty;
    const bucket = county ? countyAgg.get(county) : null;
    const m = e.metrics;
    if (!m) continue;
    if (!bucket) {
      // No county membership → regional = own (fallback for state-level
      // or otherwise unmapped entries). Treat as "never funded regionally."
      m.regional_latest_lihtc_year   = m.latest_lihtc_year;
      m.regional_latest_9pct_year    = m.latest_9pct_year;
      m.regional_latest_4pct_year    = m.latest_4pct_year;
      m.regional_latest_state_credit_year = m.latest_state_credit_year;
      m.regional_latest_competitive_year  = m.latest_competitive_year;
      m.regional_recency_score             = m.recency_score;
      m.regional_recency_score_9pct        = m.recency_score_9pct;
      m.regional_recency_score_4pct        = m.recency_score_4pct;
      m.regional_recency_score_state_credit= m.recency_score_state_credit;
      m.regional_recency_score_competitive = m.recency_score_competitive;
      m.regional_recency_anchor            = null;
      continue;
    }
    m.regional_latest_lihtc_year         = bucket.latest_lihtc;
    m.regional_latest_9pct_year          = bucket.latest_9pct;
    m.regional_latest_4pct_year          = bucket.latest_4pct;
    m.regional_latest_state_credit_year  = bucket.latest_state_credit;
    m.regional_latest_competitive_year   = bucket.latest_competitive;
    m.regional_recency_score             = _recencyScore(bucket.latest_lihtc);
    m.regional_recency_score_9pct        = _recencyScore(bucket.latest_9pct);
    m.regional_recency_score_4pct        = _recencyScore(bucket.latest_4pct);
    m.regional_recency_score_state_credit= _recencyScore(bucket.latest_state_credit);
    m.regional_recency_score_competitive = _recencyScore(bucket.latest_competitive);
    // Anchor: the place + year + credit type that drove the regional
    // signal, for explainability. We pick the most recent of the four
    // typed signals to caption the rollup.
    const anchorCandidates = [
      { year: bucket.latest_9pct,         place: bucket.anchor_9pct,         type: '9% Competitive' },
      { year: bucket.latest_4pct,         place: bucket.anchor_4pct,         type: '4%' },
      { year: bucket.latest_state_credit, place: bucket.anchor_state_credit, type: 'state credit' },
      { year: bucket.latest_competitive,  place: bucket.anchor_competitive,  type: 'competitive pool' },
    ].filter(a => a.year != null);
    if (anchorCandidates.length) {
      anchorCandidates.sort((a, b) => b.year - a.year);
      const top = anchorCandidates[0];
      m.regional_recency_anchor = {
        place: top.place,
        year:  top.year,
        type:  top.type,
        // True when the anchor is a DIFFERENT place from this entry —
        // i.e., the regional signal genuinely comes from a neighbor,
        // not this place's own award history.
        from_neighbor: top.place !== e.name,
      };
    } else {
      m.regional_recency_anchor = null;
    }
  }

  // Add metric descriptors so consumers can introspect.
  const newMetrics = [
    { id: 'latest_lihtc_year',   label: 'Latest LIHTC award year', description: 'Highest CHFA AwardYear or YR_PIS for any project in this jurisdiction; folds in 2026 R1 bridge awards.', unit: 'year', sortOrder: 'descending' },
    { id: 'lihtc_project_count', label: 'LIHTC project count',     description: 'Count of CHFA LIHTC projects with PROJ_CTY matching this jurisdiction.', unit: 'count', sortOrder: 'descending' },
    { id: 'r1_2026_count',       label: '2026 R1 awards',          description: 'Count of 2026 R1 bridge awards in this jurisdiction (not yet ingested into the CHFA ArcGIS feed).', unit: 'count', sortOrder: 'descending' },
    { id: 'drought_years',       label: 'Years since last LIHTC',  description: 'CURRENT_YEAR − latest_lihtc_year. null = never funded on record.', unit: 'years', sortOrder: 'descending' },
    { id: 'recency_score',       label: 'Recency / competition score', description: 'F146 formula: min(100, drought × 25). 100 = never funded (max opportunity); 0 = fresh award.', unit: 'score', sortOrder: 'descending' },
    { id: 'recency_basis',       label: 'Recency basis',           description: 'Which signal determined latest_lihtc_year: award_year, pis_year, r1_bridge, or never_funded.', unit: 'category', sortOrder: 'ascending' },
    // F234 — Per-credit-type recency. The OF reads these per preset so a
    // recent 9% award doesn't depress 4%-recency, and vice versa.
    { id: 'latest_9pct_year',         label: 'Latest 9% Competitive award', description: 'Most recent award where TypeOfCredits contains "9%" — captures both 9% Competitive and 9% and State combos.', unit: 'year', sortOrder: 'descending' },
    { id: 'latest_4pct_year',         label: 'Latest 4% award',             description: 'Most recent award where TypeOfCredits contains "4%" — includes 4% Tax Exempt, 4% and State, and 4% and Noncompetitive State.', unit: 'year', sortOrder: 'descending' },
    { id: 'latest_state_credit_year', label: 'Latest state-credit award',   description: 'Most recent award where TypeOfCredits includes any "State" credit (4% and State, 9% and State, 4% and Noncompetitive State). The truly competitive piece of 4% bond deals.', unit: 'year', sortOrder: 'descending' },
    { id: 'latest_competitive_year',  label: 'Latest competitive award',    description: 'Combines 9% Competitive + 4% and State (and TOC variants) — the awards CHFA spreads geographically. Excludes 4% Tax Exempt (bond cap, rarely the binding constraint).', unit: 'year', sortOrder: 'descending' },
    { id: 'lihtc_9pct_count',         label: '9% award count',              description: 'Count of TypeOfCredits-containing-9% awards for this jurisdiction.', unit: 'count', sortOrder: 'descending' },
    { id: 'lihtc_4pct_count',         label: '4% award count',              description: 'Count of TypeOfCredits-containing-4% awards for this jurisdiction.', unit: 'count', sortOrder: 'descending' },
    { id: 'lihtc_state_credit_count', label: 'State-credit award count',    description: 'Count of awards with any state-credit attached.', unit: 'count', sortOrder: 'descending' },
    { id: 'lihtc_competitive_count',  label: 'Competitive award count',     description: 'Count of competitive awards (9% Competitive + 4% and State).', unit: 'count', sortOrder: 'descending' },
    { id: 'recency_score_9pct',         label: '9% recency score',         description: 'Same F146 formula as recency_score but using latest_9pct_year. Use this for 9% Competitive ranking.', unit: 'score', sortOrder: 'descending' },
    { id: 'recency_score_4pct',         label: '4% recency score',         description: 'Same formula using latest_4pct_year. Use this for any-4% ranking.', unit: 'score', sortOrder: 'descending' },
    { id: 'recency_score_state_credit', label: 'State-credit recency score', description: 'Using latest_state_credit_year. The most accurate recency signal for 4%-bond + state-credit deals where CHFA geographic-spread bites.', unit: 'score', sortOrder: 'descending' },
    { id: 'recency_score_competitive',  label: 'Competitive-award recency score', description: 'Using latest_competitive_year. The blended scarcity signal for any competitively-scored allocation.', unit: 'score', sortOrder: 'descending' },
    // F239 — Regional (county-level) recency rollup. Captures the
    // CHFA PMA-saturation logic: a recent award in a neighboring town
    // depresses this place's recency too, because they share a market.
    { id: 'regional_latest_lihtc_year',         label: 'County-max LIHTC year',            description: 'F239 — most recent LIHTC award anywhere in the containing county (any credit type). Reflects CHFA PMA saturation: a recent award in a neighboring place sets the regional ceiling.', unit: 'year', sortOrder: 'descending' },
    { id: 'regional_latest_9pct_year',          label: 'County-max 9% year',               description: 'F239 — most recent 9% Competitive award anywhere in the containing county. Use for 9% scoring instead of own-place recency.', unit: 'year', sortOrder: 'descending' },
    { id: 'regional_latest_4pct_year',          label: 'County-max 4% year',               description: 'F239 — most recent 4% award (any 4% type) anywhere in the containing county.', unit: 'year', sortOrder: 'descending' },
    { id: 'regional_latest_state_credit_year',  label: 'County-max state-credit year',     description: 'F239 — most recent state-credit-attached award anywhere in the containing county.', unit: 'year', sortOrder: 'descending' },
    { id: 'regional_latest_competitive_year',   label: 'County-max competitive year',      description: 'F239 — most recent competitive-pool award (9% Comp + 4% and State) anywhere in the containing county.', unit: 'year', sortOrder: 'descending' },
    { id: 'regional_recency_score',             label: 'Regional recency score',           description: 'F239 — F146 formula applied to regional_latest_lihtc_year. Captures county-level PMA saturation across all credit types.', unit: 'score', sortOrder: 'descending' },
    { id: 'regional_recency_score_9pct',        label: 'Regional 9% recency score',        description: 'F239 — score from county-max 9% award year. Drops Silt + New Castle to 75 when Rifle (their county-mate) won 9% in 2023.', unit: 'score', sortOrder: 'descending' },
    { id: 'regional_recency_score_4pct',        label: 'Regional 4% recency score',        description: 'F239 — score from county-max 4% award year.', unit: 'score', sortOrder: 'descending' },
    { id: 'regional_recency_score_state_credit',label: 'Regional state-credit recency score', description: 'F239 — score from county-max state-credit award year. Most accurate for 4% + State deals where CHFA spread bites hardest.', unit: 'score', sortOrder: 'descending' },
    { id: 'regional_recency_score_competitive', label: 'Regional competitive recency score', description: 'F239 — score from county-max competitive-pool award year. Best signal for any competitively-scored allocation.', unit: 'score', sortOrder: 'descending' },
    { id: 'regional_recency_anchor',            label: 'Regional recency anchor',          description: 'F239 — { place, year, type, from_neighbor } describing which jurisdiction + award drove the regional ceiling. from_neighbor=true means the signal comes from a different place than this one.', unit: 'object', sortOrder: 'descending' },
  ];
  ri.metrics = ri.metrics || [];
  const haveIds = new Set(ri.metrics.map(m => m.id));
  for (const m of newMetrics) {
    if (!haveIds.has(m.id)) ri.metrics.push(m);
  }

  // Stamp metadata.
  ri.metadata = ri.metadata || {};
  ri.metadata.recencyAugmentedAt = '2026-06-09';
  ri.metadata.recencyAugmentedBy = 'scripts/augment_ranking_index_recency.mjs';

  console.log('Augmented ' + touched + ' ranking entries.');
  console.log('  · ' + neverFunded + ' never-funded on record');
  console.log('  · ' + (touched - neverFunded) + ' have a known LIHTC history');

  if (DRY_RUN) {
    console.log('(dry run — no write)');
    return;
  }
  await fs.writeFile(RANKING_INDEX_PATH, JSON.stringify(ri, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + RANKING_INDEX_PATH);
}

main().catch(e => { console.error(e); process.exit(1); });
