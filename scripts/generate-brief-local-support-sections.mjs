#!/usr/bin/env node
/**
 * Add or refresh the "Local support for affordable housing" section in the
 * curated jurisdiction briefs.
 *
 * The section is written from data/policy/local-support.json (adopted plans,
 * council and planning-commission votes) plus the incentive records in
 * data/policy/fee-reductions.json and data/policy/local-housing-funds.json,
 * scored by js/local-support-data.js — the same module the Opportunity Finder
 * uses, so the bonus a brief states is the bonus the Finder adds.
 *
 * Every claim cites a kind='data' source naming the record it comes from;
 * scripts/validate-jurisdiction-briefs.py checks each one against that record
 * and its quoted evidence. Hand-written sections are never touched. A brief
 * whose jurisdiction has no local-support row gets no section (it has not been
 * checked); test/local-support.test.mjs lists every brief that lacks one.
 *
 * The evaluation date is local-support.json's meta.as_of, not the clock, so
 * the output only changes when the data does.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFS_DIR = path.join(ROOT, "data", "jurisdiction-briefs");
const require = createRequire(import.meta.url);
const LocalSupportData = require("../js/local-support-data.js");

export const SECTION_ID = "local-support";
export const SOURCE_PREFIX = "ls";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

export function loadDocs() {
  return {
    support: readJson("data/policy/local-support.json"),
    fees: readJson("data/policy/fee-reductions.json"),
    funds: readJson("data/policy/local-housing-funds.json"),
    coverage: readJson("data/policy/incentive-coverage.json"),
  };
}

/** '2025-03-11' → 'March 11, 2025'; '2025-03' → 'March 2025'; '2025' → '2025'. */
export function fmtDate(date) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(date || "");
  if (!m) return null;
  if (!m[2]) return m[1];
  const month = MONTHS[Number(m[2]) - 1];
  return m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`;
}

/** "On March 11, 2025" / "In March 2025" / "In 2025". */
function dateLead(date) {
  const text = fmtDate(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `On ${text}` : `In ${text}`;
}

function list(parts) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

const OUTCOME_VERB = {
  adopted: "adopted",
  approved: "approved",
  recommended_approval: "recommended approval of",
  denied: "rejected",
  recommended_denial: "recommended denial of",
};

function incentiveLabel(item) {
  return LocalSupportData.incentiveLabel(item);
}

/**
 * The section and the sources it cites, or null when the jurisdiction has not
 * been checked. `brief` needs geoid, jurisdiction and scope.
 */
export function sectionFor(brief, docs) {
  const model = LocalSupportData.build(docs);
  const asOf = docs.support.meta.as_of;
  const kind = brief.scope === "cdp" ? "cdp" : brief.scope;
  const prof = model.profile(brief.geoid, asOf, { kind, county: brief.containing_county_fips });
  const row = model.rows.get(prof.subjectGeoid);
  if (!row) return null;

  const sources = [];
  const cite = (dataset, field, label, url) => {
    const id = `${SOURCE_PREFIX}${sources.length + 1}`;
    sources.push({ id, label, url, kind: "data", dataset, field, accessed: row.checked });
    return id;
  };
  const rowCite = cite("local-support", `row:${prof.subjectGeoid}`,
    `Local support record for ${brief.jurisdiction}, checked ${row.checked}`,
    "data/policy/local-support.json");
  const name = brief.jurisdiction;
  const checkedText = fmtDate(row.checked);
  const paragraphs = [];

  // 1. Plans
  const plans = prof.plans;
  if (plans.length) {
    const cites = [];
    const bits = plans.map((p) => {
      cites.push(cite("local-support", p.id, `${p.title} (${p.source.label})`, p.source.url));
      const counted = prof.parts.plans.counted.includes(p);
      return `${p.title} (${p.outcome === "approved" ? "accepted" : p.outcome} ${fmtDate(p.date)})` +
        (p.affordable_detail ? `: ${p.affordable_detail.replace(/\.$/, "")}` : "") +
        (counted ? "." : `. It is older than the ${LocalSupportData.PLAN_WINDOW_YEARS}-year window the score counts.`);
    });
    paragraphs.push({ text: `Adopted plans. ${bits.join(" ")}`, cites });
  } else {
    const state = row.result_by_scope && row.result_by_scope.plans;
    paragraphs.push({
      text: state === "unreadable"
        ? `Adopted plans: the official plan sources for ${name} could not be read when checked on ${checkedText}, so no plan is recorded yet.`
        : `Adopted plans: no adopted housing plan or needs assessment with affordable-housing goals was found in the official sources checked on ${checkedText}.`,
      cites: [rowCite],
    });
  }

  // 2. Incentives and local funding (from the Local Housing Incentives records)
  const inc = prof.parts.incentives.counted;
  if (inc.length) {
    const cites = [];
    const bits = inc.map((i) => {
      const r = i.record;
      const dataset = i.scope === "funds" ? "local-housing-funds" : "fee-reductions";
      cites.push(cite(dataset, r.id, r.source.label, r.source.url));
      return incentiveLabel(i);
    });
    paragraphs.push({
      text: `Incentives and local funding on record: ${list(bits)}. The Local Housing Incentives page has the terms and sources of each.`,
      cites,
    });
  } else {
    const state = prof.parts.incentives.state;
    const why = state === "none_found" ? "the official sources checked hold no standing fee reduction, land-use incentive or dedicated fund"
      : state === "unreadable" ? "some official incentive sources could not be read"
      : "incentives have not been checked yet";
    paragraphs.push({ text: `Incentives and local funding: none counted, because ${why}.`, cites: [rowCite] });
  }

  // 3. Council and planning commission record
  const actions = prof.actions.filter((a) => a.type !== "denial" && a.outcome !== "denied" && a.outcome !== "recommended_denial");
  if (actions.length) {
    const cites = [];
    const bits = actions.map((a) => {
      cites.push(cite("local-support", a.id, `${a.title} (${a.source.label})`, a.source.url));
      const counted = prof.parts.council.counted.includes(a);
      return `${dateLead(a.date)}, ${a.body ? `the ${a.body}` : "the jurisdiction"} ${OUTCOME_VERB[a.outcome] || a.outcome}: ${a.title}` +
        (a.vote ? ` (vote ${a.vote})` : "") +
        (a.affordable_detail ? `. ${a.affordable_detail.replace(/\.$/, "")}` : "") +
        (counted ? "." : `. It is older than the ${LocalSupportData.ACTION_WINDOW_MONTHS}-month window the score counts.`);
    });
    paragraphs.push({ text: `Council and planning commission record. ${bits.join(" ")}`, cites });
  } else {
    const state = row.result_by_scope && row.result_by_scope.council;
    paragraphs.push({
      text: state === "unreadable"
        ? `Council and planning commission record: the official minutes and agendas could not be read when checked on ${checkedText}.`
        : `Council and planning commission record: no recorded vote specifically on affordable housing was found in the official minutes and agendas checked on ${checkedText}.`,
      cites: [rowCite],
    });
  }

  // 4. Denials are shown, not scored.
  const denials = prof.actions.filter((a) => !actions.includes(a));
  if (denials.length) {
    const cites = [];
    const bits = denials.map((a) => {
      cites.push(cite("local-support", a.id, `${a.title} (${a.source.label})`, a.source.url));
      return `${dateLead(a.date)}, ${a.body ? `the ${a.body}` : "the jurisdiction"} ${OUTCOME_VERB[a.outcome] || a.outcome}: ${a.title}` +
        (a.vote ? ` (vote ${a.vote})` : "") + ".";
    });
    paragraphs.push({
      text: `Recorded denials, shown for context and not scored. ${bits.join(" ")}`,
      cites,
    });
  }

  // 5. What it adds in the Opportunity Finder.
  const p = prof.parts;
  paragraphs.push({
    text: `In the Opportunity Finder this record adds a local support bonus of +${prof.bonus} of a possible ` +
      `+${LocalSupportData.MAX_BONUS} points as of ${fmtDate(asOf)}: plans +${p.plans.points}, ` +
      `incentives and funding +${p.incentives.points}, council and planning commission +${p.council.points}. ` +
      `A part with nothing counted adds nothing; it never lowers the score.`,
    cites: [rowCite],
  });

  return {
    section: { id: SECTION_ID, heading: "Local support for affordable housing", paragraphs },
    sources,
  };
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** Replace this section and its ls* sources in one brief object; returns it. */
export function applyTo(brief, docs) {
  const built = sectionFor(brief, docs);
  brief.sections = (brief.sections || []).filter((s) => s.id !== SECTION_ID);
  brief.sources = (brief.sources || []).filter((s) => !new RegExp(`^${SOURCE_PREFIX}\\d+$`).test(s.id));
  if (!built) return brief;
  // Before the generated Metric Digest, after the hand-written sections.
  const at = brief.sections.findIndex((s) => s.id === "metric-digest");
  if (at === -1) brief.sections.push(built.section);
  else brief.sections.splice(at, 0, built.section);
  brief.sources.push(...built.sources);
  return brief;
}

export function briefFiles() {
  return fs.readdirSync(BRIEFS_DIR)
    .filter((file) => /^08\d{3}(\d{2})?\.json$/.test(file))
    .sort()
    .map((file) => path.join(BRIEFS_DIR, file));
}

function main() {
  const docs = loadDocs();
  let n = 0;
  for (const file of briefFiles()) {
    const brief = JSON.parse(fs.readFileSync(file, "utf8"));
    const before = JSON.stringify(brief);
    applyTo(brief, docs);
    if (JSON.stringify(brief) !== before) { writeJson(file, brief); n += 1; }
  }
  console.log(`[local-support-briefs] updated ${n} brief(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
