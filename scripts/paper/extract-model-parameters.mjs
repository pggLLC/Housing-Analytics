#!/usr/bin/env node
/**
 * Extract every published constant and weight from the code that uses it.
 *
 * A methods paper is only peer-reviewable if the formulas it prints are the
 * formulas that run. Transcribing them by hand guarantees the opposite, and
 * this repository has already demonstrated it: working-paper.html §6.3
 * described the ownership affordability model as "20% down, 6.5%, 0.65% tax,
 * 0.85% insurance, 43% back-end DTI". The registry holds SEVEN models, the
 * default is 30% front-end rather than 43% back-end, and js/config/
 * financial-constants.js carries a third set again (5% down, 7.0%, $2,400 flat
 * insurance). Three descriptions of one model, none of them agreeing.
 *
 * So the methods paper prints what this reads out of the source, and
 * test/paper-methods-fresh.test.js fails when the source moves.
 *
 * Every constant here is parsed from the file that DEFINES it. Where a value
 * cannot be parsed it is null with the reason — a methods paper that silently
 * substitutes a plausible default for an unreadable constant is worse than one
 * that admits it could not read it.
 *
 *   node scripts/paper/extract-model-parameters.mjs            # write JSON
 *   node scripts/paper/extract-model-parameters.mjs --stdout
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'paper', 'model-parameters.json');
const R = (p) => path.join(ROOT, p);

const unavailable = [];
const absent = (key, reason) => { unavailable.push({ key, reason }); return null; };

function source(rel) {
  const p = R(rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

/**
 * Pull `NAME = <number>` out of Python or JS source.
 *
 * Deliberately anchored to an assignment rather than matching the number
 * anywhere in the file: several of these constants also appear inside comments
 * explaining why they were changed, and a comment is not what executes.
 */
function constant(src, name, { file }) {
  if (src == null) return absent(name, `${file} is not present`);
  const m = src.match(new RegExp(`^\\s*(?:var\\s+|const\\s+|let\\s+)?${name}\\s*[:=]\\s*(-?[\\d.]+)`, 'm'));
  if (!m) return absent(name, `no assignment to ${name} found in ${file}`);
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : absent(name, `${name} in ${file} is not a finite number`);
}

/** Pull a whole `NAME = { "k": v, ... }` dict out of Python source. */
function dictOfNumbers(src, name, { file }) {
  if (src == null) return absent(name, `${file} is not present`);
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'm'));
  if (!m) return absent(name, `no ${name} dict found in ${file}`);
  const out = {};
  for (const entry of m[1].matchAll(/["']([\w]+)["']\s*:\s*(-?[\d.]+)/g)) {
    out[entry[1]] = Number(entry[2]);
  }
  return Object.keys(out).length ? out : absent(name, `${name} in ${file} parsed to an empty dict`);
}

/** A set of weights that is claimed to partition 1.0 must actually do so. */
function sumsToOne(dict) {
  if (!dict) return null;
  const total = Object.values(dict).reduce((a, b) => a + b, 0);
  return { sum: Number(total.toFixed(6)), partitions_unity: Math.abs(total - 1) < 1e-9 };
}

/* ── ranking index ───────────────────────────────────────────────────────── */

const RANK_FILE = 'scripts/hna/build_ranking_index.py';
const rank = source(RANK_FILE);

const axis = dictOfNumbers(rank, 'AXIS_WEIGHTS', { file: RANK_FILE });
const need = dictOfNumbers(rank, 'COMMUNITY_NEED_WEIGHTS', { file: RANK_FILE });
const opp = dictOfNumbers(rank, 'OPPORTUNITY_WEIGHTS', { file: RANK_FILE });

const ranking = {
  source_file: RANK_FILE,
  axis_weights: axis,
  axis_weights_check: sumsToOne(axis),
  community_need_weights: need,
  community_need_weights_check: sumsToOne(need),
  opportunity_weights: opp,
  opportunity_weights_check: sumsToOne(opp),
  subscore_weights: {
    gap: {
      count: constant(rank, 'GAP_COUNT_WEIGHT', { file: RANK_FILE }),
      rate: constant(rank, 'GAP_RATE_WEIGHT', { file: RANK_FILE }),
    },
    cost_burden: {
      all_renter: constant(rank, 'COST_ALL_RENTER_WEIGHT', { file: RANK_FILE }),
      severe: constant(rank, 'COST_SEVERE_WEIGHT', { file: RANK_FILE }),
      deep_tier: constant(rank, 'COST_DEEP_TIER_WEIGHT', { file: RANK_FILE }),
    },
    affordability: {
      homebuyer: constant(rank, 'AFFORDABILITY_HOMEBUYER_WEIGHT', { file: RANK_FILE }),
      renter: constant(rank, 'AFFORDABILITY_RENTER_WEIGHT', { file: RANK_FILE }),
    },
    future: {
      units: constant(rank, 'FUTURE_UNITS_WEIGHT', { file: RANK_FILE }),
      senior: constant(rank, 'FUTURE_SENIOR_WEIGHT', { file: RANK_FILE }),
    },
    commuter: {
      count: constant(rank, 'COMMUTER_COUNT_WEIGHT', { file: RANK_FILE }),
      ratio: constant(rank, 'COMMUTER_RATIO_WEIGHT', { file: RANK_FILE }),
      // The augment multiplier. Not a weight in the partition: it scales an
      // already-complete score, so it can only ever raise it.
      augment_alpha: constant(rank, 'COMMUTER_AUGMENT_ALPHA', { file: RANK_FILE }),
    },
  },
  confidence: {
    penalty_per_imputed_factor: constant(rank, 'CONFIDENCE_PENALTY_PER_IMPUTED_FACTOR', { file: RANK_FILE }),
    penalty_per_approximated_field: constant(rank, 'CONFIDENCE_PENALTY_PER_APPROXIMATED_FIELD', { file: RANK_FILE }),
    min_multiplier: constant(rank, 'MIN_CONFIDENCE_MULTIPLIER', { file: RANK_FILE }),
  },
  guards: {
    min_rate_denominator: constant(rank, '_MIN_RATE_DENOMINATOR', { file: RANK_FILE }),
    vacancy_renter_base_floor: constant(rank, '_VACANCY_RENTER_BASE_FLOOR', { file: RANK_FILE }),
  },
};

/* ── ownership affordability ─────────────────────────────────────────────── */

const REG_FILE = 'data/policy/affordability-models.json';
const FIN_FILE = 'js/config/financial-constants.js';

function affordability() {
  const p = R(REG_FILE);
  if (!existsSync(p)) {
    return { models: absent('affordability.models', `${REG_FILE} is not present`) };
  }
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    return { models: absent('affordability.models', `${REG_FILE} did not parse: ${e.message}`) };
  }
  const models = (doc.models || []).map((m) => {
    const q = m.params || m;
    return {
      id: m.id,
      label: m.label || m.name || null,
      is_default: !!(m.default || m.isDefault) || /default/i.test(m.label || ''),
      housing_ratio_type: q.housingRatioType || 'front',
      housing_ratio: q.housingRatio ?? q.frontEndRatio ?? q.backEndRatio ?? null,
      front_end_ratio_cap: q.frontEndRatioCap ?? null,
      down_payment_rate: q.downPaymentRate ?? null,
      interest_rate: q.rateAnnual ?? q.interestRate ?? q.rate ?? null,
      term_years: q.termYears ?? q.term ?? null,
      property_tax_rate: q.propertyTaxRate ?? null,
      insurance_rate: q.insuranceRate ?? null,
      pmi_rate: q.pmiRate ?? null,
      pmi_ltv_gate: q.pmiLtvGate ?? null,
    };
  });

  // The separate constants file. It is a THIRD description of the same model
  // and the divergence is the point, so both are published side by side.
  const fin = source(FIN_FILE);
  const constants_file = {
    source_file: FIN_FILE,
    mortgage_rate: constant(fin, 'mortgageRate', { file: FIN_FILE }),
    down_payment_pct: constant(fin, 'downPaymentPct', { file: FIN_FILE }),
    housing_cost_pct: constant(fin, 'housingCostPct', { file: FIN_FILE }),
    max_dti_ratio: constant(fin, 'maxDtiRatio', { file: FIN_FILE }),
    property_tax_rate: constant(fin, 'propertyTaxRate', { file: FIN_FILE }),
    insurance_annual_dollars: constant(fin, 'insuranceAnnual', { file: FIN_FILE }),
    mortgage_term_yr: constant(fin, 'mortgageTermYr', { file: FIN_FILE }),
  };

  // Do the registry and the constants file agree? Published rather than
  // reconciled: a reader deserves to know which number reached which surface.
  const defaultModel = models.find((m) => m.is_default) || models[0] || null;
  //
  // A divergence is EXPECTED when the two surfaces are documented as answering
  // different questions. js/config/financial-constants.js states the scope in
  // full: the constants there serve the deal-calculator and rent-vs-buy
  // surfaces, the registry serves the HNA ownership model, and they
  // "deliberately differ" — down payment, property tax rate, and insurance
  // (which is a UNIT difference, dollars against a rate of value).
  //
  // Recording that here is the difference between a report and an alarm. Until
  // 2026-09-23 every run printed "[paper] DIVERGENCE property tax rate" with
  // no way to tell it from a real one, so the line was permanent and therefore
  // unread — the same shape as a GOTCHA comment nobody reads (#1695). An
  // expected pair is stated, with its values; anything else is a finding
  // (#1841), and test:paper-model-divergence fails on it.
  const EXPECTED_DIVERGENCE = [{
    parameter: 'property tax rate',
    registry_default: 0.0065,
    constants_file: 0.006,
    reason: 'the deal-calculator and HNA ownership surfaces answer different '
      + 'questions and are documented as deliberately differing — see the SCOPE '
      + 'block in js/config/financial-constants.js, pinned by '
      + 'test/affordability-defaults-inventory.test.js',
  }];

  const divergence = [];
  if (defaultModel && constants_file.property_tax_rate != null
      && defaultModel.property_tax_rate != null
      && defaultModel.property_tax_rate !== constants_file.property_tax_rate) {
    divergence.push({
      parameter: 'property tax rate',
      registry_default: defaultModel.property_tax_rate,
      constants_file: constants_file.property_tax_rate,
    });
  }
  // Tag each one. An expected entry must match on BOTH values: if either side
  // moves, the documented pair is stale and this stops being expected.
  for (const d of divergence) {
    const known = EXPECTED_DIVERGENCE.find((e) => e.parameter === d.parameter
      && e.registry_default === d.registry_default
      && e.constants_file === d.constants_file);
    d.expected = Boolean(known);
    d.reason = known ? known.reason : null;
  }
  if (defaultModel && constants_file.housing_cost_pct != null
      && defaultModel.housing_ratio != null
      && defaultModel.housing_ratio !== constants_file.housing_cost_pct) {
    divergence.push({
      parameter: 'housing-cost ratio',
      registry_default: defaultModel.housing_ratio,
      constants_file: constants_file.housing_cost_pct,
    });
  }

  return {
    source_file: REG_FILE,
    model_count: models.length,
    default_model_id: defaultModel ? defaultModel.id : null,
    models,
    constants_file,
    divergence,
    // Distinct ratio TYPES in play. More than one means "the affordability
    // model" is not a single object and a paper must not speak of it as one.
    distinct_ratio_types: [...new Set(models.map((m) => m.housing_ratio_type))].sort(),
    distinct_housing_ratios: [...new Set(models.map((m) => m.housing_ratio).filter((v) => v != null))].sort((a, b) => a - b),
  };
}

/* ── apportionment ───────────────────────────────────────────────────────── */

const CHAS_FILE = 'scripts/hna/build_place_chas.py';
const chasSrc = source(CHAS_FILE);

function apportionment() {
  if (chasSrc == null) {
    return { weight_rule: absent('apportionment.weight_rule', `${CHAS_FILE} is not present`) };
  }
  // Which weight rule is live? The header still documents area-share; F28
  // replaced it with max(area-share, pop-share). Detected rather than assumed.
  const usesMax = /max\(\s*(?:area|share)[\w_]*\s*,\s*(?:pop|population)[\w_]*/i.test(chasSrc)
    || /max\(\s*(?:pop|population)[\w_]*\s*,\s*(?:area|share)[\w_]*/i.test(chasSrc)
    || /population-share apportionment/i.test(chasSrc);
  return {
    source_file: CHAS_FILE,
    weight_rule: usesMax ? 'max(area_share, population_share)' : 'area_share',
    weight_rule_detected_from_source: true,
    header_still_says_area_weighted: /area-weighted apportionment/i.test(chasSrc),
    share_rounding_decimals: 4,
    count_rounding_decimals: 1,
    shares_derived_from_published_counts:
      /round\(s\['renter_cb30_count'\] \/ tr_pub, 4\)/.test(chasSrc)
      || /Derive every share from the PUBLISHED counts/i.test(chasSrc),
  };
}

/* ── emit ────────────────────────────────────────────────────────────────── */

const out = {
  extracted_at_commit: (() => {
    try {
      return execFileSync
        ('git', ['rev-parse','--short','HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch { return null; }
  })(),
  ranking,
  affordability: affordability(),
  apportionment: apportionment(),
  unavailable,
};

const json = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[paper] wrote ${path.relative(ROOT, OUT)}`);
  console.log(`[paper] ${out.affordability.model_count} affordability models, `
    + `ratio types: ${(out.affordability.distinct_ratio_types || []).join(', ')}`);
  for (const d of out.affordability.divergence || []) {
    // Expected pairs are reported as such rather than shouted. An unexpected
    // one keeps the loud form, because that is the one worth looking at.
    const head = d.expected ? 'divergence (expected)' : 'DIVERGENCE';
    console.log(`[paper] ${head} ${d.parameter}: registry ${d.registry_default} `
      + `vs constants file ${d.constants_file}`
      + (d.expected ? ' — deliberate, see js/config/financial-constants.js' : ''));
  }
  console.log(`[paper] apportionment weight rule: ${out.apportionment.weight_rule}`);
  if (unavailable.length) {
    console.log(`[paper] ${unavailable.length} constant(s) unreadable: `
      + unavailable.map((u) => u.key).join(', '));
  }
}
