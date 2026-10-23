#!/usr/bin/env node
/**
 * Add or refresh the Metric Digest section in curated jurisdiction briefs.
 *
 * The section consumes data/hna/jurisdiction-metrics-digest/<geoid>.json.
 * It does not rebuild rankings or recompute metrics.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFS_DIR = path.join(ROOT, "data", "jurisdiction-briefs");
const DIGEST_DIR = path.join(ROOT, "data", "hna", "jurisdiction-metrics-digest");

const DATA_SOURCES = [
  ["d1", "rank", "Ranking index rank"],
  ["d2", "overall_need_score", "Overall housing-need score"],
  ["d3", "housing_gap_units", "Deep-affordability housing gap units"],
  ["d4", "housing_gap_rate_lte30", "Deep-affordability gap rate"],
  ["d5", "pct_cost_burdened", "Renter cost-burden rate"],
  ["d6", "overcrowding_rate_pct", "Occupied-household overcrowding rate"],
  ["d7", "median_home_value", "ZHVI market home-value estimate"],
  ["d8", "gross_rent_median", "Median gross rent"],
  ["d9", "pct_renters", "Renter household share"],
  ["d10", "pct_multifamily", "Multifamily housing-stock share"],
  ["d11", "population", "Population"],
  ["d12", "in_commuters", "In-commuters"],
  ["d13", "commute_ratio", "Commute ratio"],
  ["d14", "future_units_needed_20yr", "Twenty-year future units needed"],
  ["d15", "opportunity_score", "Opportunity score"],
  ["d16", "walkability_score", "Walkability score"],
  ["d17", "workforce_housing_pressure_score", "Workforce housing pressure score"],
  ["d18", "wage_affordability_ownership_gap_dollars", "Ownership wage-affordability gap"],
  ["d19", "wage_affordability_rent_gap_dollars", "Rent wage-affordability gap"],
  ["d20", "county_service_sector_share_pct", "County service-sector employment share"],
  ["d21", "county_trend_rent_change_2009_2024_pct", "County rent change, ACS cohort trend"],
  ["d22", "county_trend_income_change_2009_2024_pct", "County income change, ACS cohort trend"],
  ["d23", "future_units_growth_20yr", "Twenty-year resident growth in homes needed"],
  ["d24", "incommuter_need_units", "In-commuter need, a quarter moving closer"],
];

// d23 and d24 are cited only where the 20-year figure has both parts.
const COMPONENT_SOURCES = new Set(["d23", "d24"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function metric(digest, field) {
  const value = digest.metrics && digest.metrics[field];
  if (!value || value.value === null || value.value === undefined) {
    throw new Error(`${digest.geography.geoid}: missing digest metric ${field}`);
  }
  return value;
}

function gapRateIsAvailable(digest) {
  const value = digest.metrics && digest.metrics.housing_gap_rate_lte30;
  return !!(value && value.value !== null && value.value !== undefined);
}

function housingGapRateText(digest) {
  if (gapRateIsAvailable(digest)) {
    return `The deep-affordability gap rate is ${valueText(digest, "housing_gap_rate_lte30", "pct")} of <=30% AMI households.`;
  }

  const value = digest.metrics && digest.metrics.housing_gap_rate_lte30;
  if (value && value.denominator_floor_applied && value.denominator !== null && value.denominator !== undefined) {
    const floor = value.min_denominator ?? 50;
    return `The deep-affordability gap rate is suppressed because only ${num(value.denominator)} <=30% AMI households are observed, below the digest's ${num(floor)}-household reporting floor.`;
  }

  return "A stable deep-affordability gap rate is unavailable in the digest.";
}

function num(value, digits = 0) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function valueText(digest, field, style = "number") {
  const value = metric(digest, field).value;
  if (style === "money") return `$${num(value)}`;
  if (style === "pct") return `${num(value, Number.isInteger(value) ? 0 : 1)}%`;
  if (style === "score") return num(value, 1);
  return num(value, Number.isInteger(value) ? 0 : 1);
}

// Below zero is a surplus where projected households fall, said in words.
function futureUnitsText(digest) {
  const value = metric(digest, "future_units_needed_20yr").value;
  if (typeof value === "number" && value < 0) return `a surplus of ${num(Math.abs(value), 0)} homes as projected households fall`;
  return `${valueText(digest, "future_units_needed_20yr")} future units needed`;
}

function hasNeedComponents(digest) {
  const m = digest.metrics || {};
  const finite = (field) => m[field] && typeof m[field].value === "number" && Number.isFinite(m[field].value);
  return !!(m.future_units_reading && m.future_units_reading.value === "resident_growth_plus_incommuters"
    && finite("future_units_growth_20yr") && finite("incommuter_need_units"));
}

// The 20-year figure adds two parts with different geographies and time frames:
// projected resident growth (county context for a place) and today's in-commuters
// to this place. Each is named with its own frame, not the whole as county context.
function futureNeedText(digest, jurisdiction) {
  if (!hasNeedComponents(digest)) {
    return `The digest's county-context projection shows ${futureUnitsText(digest)} over 20 years, ` +
      `so that projection should be read as county context rather than a place trend.`;
  }
  const total = metric(digest, "future_units_needed_20yr").value;
  const growthMetric = metric(digest, "future_units_growth_20yr");
  const growth = growthMetric.value;
  const inc = metric(digest, "incommuter_need_units").value;
  const totalText = total < 0 ? `a surplus of ${num(Math.abs(total))} homes` : `${num(total)} homes`;
  const growthText = growth < 0
    ? `Projected households fall, so resident growth lowers need by ${num(Math.abs(growth))}`
    : `Projected resident growth gives ${num(growth)}`;
  const growthFrame = growthMetric.geography_level === "county_context"
    ? "; it comes from the county projection, so read it as county context, not a place trend"
    : "";
  return `The digest's 20-year figure is ${totalText}. ${growthText}${growthFrame}. ` +
    `Today's in-commuters give ${num(inc)}: homes for a quarter of the households, at or below 120% AMI, ` +
    `of the people who commute into ${jurisdiction}, if they moved closer.`;
}

function sourceFor(geoid, id, field, label) {
  const m = readJson(path.join(DIGEST_DIR, `${geoid}.json`)).metrics[field];
  return {
    id,
    label: `${label} - jurisdiction metrics digest (${m.as_of})`,
    url: `data/hna/jurisdiction-metrics-digest/${geoid}.json`,
    kind: "data",
    dataset: "jurisdiction-metrics-digest",
    field,
    accessed: "2026-07-03",
  };
}

export function sectionFor(brief, digest) {
  const jurisdiction = brief.jurisdiction || digest.geography.name;
  const gapRateAvailable = gapRateIsAvailable(digest);
  const para0Cites = ["d1", "d2", "d3", "d5", "d6"];
  if (gapRateAvailable) para0Cites.splice(3, 0, "d4");
  return {
    id: "metric-digest",
    heading: "Metric Digest",
    paragraphs: [
      {
        text:
          `The metric digest ranks ${jurisdiction} at #${valueText(digest, "rank")} ` +
          `with an overall housing-need score of ${valueText(digest, "overall_need_score", "score")}. ` +
          `It identifies ${valueText(digest, "housing_gap_units")} deeply affordable units missing at <=30% AMI. ` +
          `${housingGapRateText(digest)} ` +
          `${valueText(digest, "pct_cost_burdened", "pct")} of renter households are cost burdened, ` +
          `and ${valueText(digest, "overcrowding_rate_pct", "pct")} of occupied households are overcrowded.`,
        cites: para0Cites,
      },
      {
        text:
          `Market and supply context: the digest reports a ZHVI market estimate of ` +
          `${valueText(digest, "median_home_value", "money")} and median gross rent of ` +
          `${valueText(digest, "gross_rent_median", "money")}. ` +
          `${valueText(digest, "pct_renters", "pct")} of households rent, and ` +
          `${valueText(digest, "pct_multifamily", "pct")} of the housing stock is multifamily.`,
        cites: ["d7", "d8", "d9", "d10"],
      },
      {
        text:
          `Demographics and demand: the population metric is ` +
          `${valueText(digest, "population")}. LEHD-based commuting signals show ` +
          `${valueText(digest, "in_commuters")} in-commuters and a commute ratio of ` +
          `${valueText(digest, "commute_ratio", "pct")}. ${futureNeedText(digest, jurisdiction)}`,
        cites: hasNeedComponents(digest) ? ["d11", "d12", "d13", "d14", "d23", "d24"] : ["d11", "d12", "d13", "d14"],
      },
      {
        text:
          `Opportunity context: the digest gives an opportunity score of ` +
          `${valueText(digest, "opportunity_score", "score")} and a walkability score of ` +
          `${valueText(digest, "walkability_score", "score")}. These are current digest levels, not trends.`,
        cites: ["d15", "d16"],
      },
      {
        text:
          `Economic and service-worker context: the digest reports a workforce-housing pressure score of ` +
          `${valueText(digest, "workforce_housing_pressure_score", "score")}. A worker earning the containing ` +
          `county's LEHD earnings-bin wage estimate faces an ownership affordability gap of ` +
          `${valueText(digest, "wage_affordability_ownership_gap_dollars", "money")} and a rent affordability gap of ` +
          `${valueText(digest, "wage_affordability_rent_gap_dollars", "money")}. The county-context service-sector ` +
          `employment share is ${valueText(digest, "county_service_sector_share_pct", "pct")}, and county-context ACS ` +
          `cohorts show median gross rent changed ${valueText(digest, "county_trend_rent_change_2009_2024_pct", "pct")} ` +
          `from 2009 to 2024 while median household income changed ` +
          `${valueText(digest, "county_trend_income_change_2009_2024_pct", "pct")}. These county-context figures are ` +
          `economic context, not place-level sector or wage observations.`,
        cites: ["d17", "d18", "d19", "d20", "d21", "d22"],
      },
    ],
  };
}

function updateBrief(file) {
  const brief = readJson(file);
  const geoid = brief.geoid;
  const digest = readJson(path.join(DIGEST_DIR, `${geoid}.json`));

  brief.sections = (brief.sections || []).filter((section) => section.id !== "metric-digest");
  brief.sections.push(sectionFor(brief, digest));

  const dataSourceIds = new Set(DATA_SOURCES.map(([id]) => id));
  brief.sources = (brief.sources || []).filter(
    (source) => !dataSourceIds.has(source.id) && !/^d-/.test(source.id)
  );
  const gapRateAvailable = gapRateIsAvailable(digest);
  for (const [id, field, label] of DATA_SOURCES) {
    if (id === "d4" && !gapRateAvailable) continue;
    if (COMPONENT_SOURCES.has(id) && !hasNeedComponents(digest)) continue;
    brief.sources.push(sourceFor(geoid, id, field, label));
  }

  writeJson(file, brief);
}

function main() {
  const files = fs.readdirSync(BRIEFS_DIR)
    .filter((file) => /^08\d{3}(\d{2})?\.json$/.test(file))
    .sort()
    .map((file) => path.join(BRIEFS_DIR, file));

  for (const file of files) updateBrief(file);
  console.log(`[metric-digest-briefs] updated ${files.length} brief(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
