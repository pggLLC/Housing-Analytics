#!/usr/bin/env node
/**
 * Add or refresh the Metric Digest section in curated jurisdiction briefs.
 *
 * The section consumes data/hna/jurisdiction-metrics-digest/<geoid>.json.
 * It does not rebuild rankings or recompute metrics.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFS_DIR = path.join(ROOT, "data", "jurisdiction-briefs");
const DIGEST_DIR = path.join(ROOT, "data", "hna", "jurisdiction-metrics-digest");

const DATA_SOURCES = [
  ["d1", "rank", "Ranking index rank"],
  ["d2", "overall_need_score", "Overall housing-need score"],
  ["d3", "housing_gap_units", "Deep-affordability housing gap units"],
  ["d4", "housing_gap_rate_lte30", "Deep-affordability gap rate"],
  ["d5", "pct_cost_burdened", "Renter cost-burden rate"],
  ["d6", "overcrowding_rate", "Occupied-household overcrowding rate"],
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
];

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

function sectionFor(brief, digest) {
  const jurisdiction = brief.jurisdiction || digest.geography.name;
  return {
    id: "metric-digest",
    heading: "Metric Digest",
    paragraphs: [
      {
        text:
          `The metric digest ranks ${jurisdiction} at #${valueText(digest, "rank")} ` +
          `with an overall housing-need score of ${valueText(digest, "overall_need_score", "score")}. ` +
          `It identifies ${valueText(digest, "housing_gap_units")} deeply affordable units missing at <=30% AMI, ` +
          `equal to ${valueText(digest, "housing_gap_rate_lte30", "pct")} of <=30% AMI households. ` +
          `${valueText(digest, "pct_cost_burdened", "pct")} of renter households are cost burdened, ` +
          `and ${valueText(digest, "overcrowding_rate", "pct")} of occupied households are overcrowded.`,
        cites: ["d1", "d2", "d3", "d4", "d5", "d6"],
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
          `${valueText(digest, "commute_ratio", "pct")}. The digest's county-context projection ` +
          `shows ${valueText(digest, "future_units_needed_20yr")} future units needed over 20 years, ` +
          `so that projection should be read as county context rather than a place trend.`,
        cites: ["d11", "d12", "d13", "d14"],
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
  brief.sources = (brief.sources || []).filter((source) => !dataSourceIds.has(source.id));
  for (const [id, field, label] of DATA_SOURCES) {
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

main();
