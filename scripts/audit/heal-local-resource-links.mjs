#!/usr/bin/env node
/**
 * heal-local-resource-links.mjs — replace broken local-resources URLs with
 * durable jurisdiction-name Google searches.
 *
 * Why: data/hna/local-resources.json carries housing-authority / lead /
 * advocacy / plan / contact URLs per jurisdiction. Many were hand-typed
 * CivicPlus page IDs that get reassigned over time, so links rot to the
 * wrong page or a 404. A `google.com/search?q="<name>" Colorado` link
 * always lands on the current correct page and never rots. F35 healed 185
 * broken links to searches; this script makes that a re-runnable maintenance
 * task — run it after a new local-resources entry batch, or quarterly.
 *
 * Detection (a URL is "broken" only when high-confidence wrong):
 *   - HTTP 404 / 410 / 5xx after one retry, OR
 *   - 2xx that redirects to the site homepage when the original wasn't root, OR
 *   - 2xx CivicPlus-style URL (/digits/Slug) whose final path differs from the
 *     requested path (CMS page-ID reassigned), OR
 *   - fetch failure twice AND DNS lookup of the hostname fails (true dead
 *     domain — guards against transient TLS / bot-block false positives).
 *
 * 401/403/405/406/429/436 are KEPT (bot-block; live for humans).
 * Timeouts (AbortError) are KEPT (uncertain; don't destroy a maybe-good link).
 *
 * Usage:
 *   node scripts/audit/heal-local-resource-links.mjs            # apply heal in place
 *   node scripts/audit/heal-local-resource-links.mjs --dry-run  # report only, no write
 *
 * Exit codes:
 *   0  always (informational tool)
 */

import fs from "node:fs";
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const FILE = path.join(REPO, "data/hna/local-resources.json");
const DRY  = process.argv.includes("--dry-run");

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

const norm = (p) => (p || "/").replace(/\/+$/, "") || "/";
const pathOf = (u) => { try { return norm(new URL(u).pathname); } catch { return "?"; } };
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
const isCivicPlus = (u) => { try { return /\/\d+\//.test(new URL(u).pathname); } catch { return false; } };
const searchFor = (name) => "https://www.google.com/search?q=" + encodeURIComponent('"' + name + '" Colorado');

async function once(u) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(u, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t); return { status: r.status, finalUrl: r.url };
  } catch (e) { clearTimeout(t); return { status: 0, errType: String(e.name || e) }; }
}
async function probe(u) {
  let r = await once(u);
  const failed = r.status === 0 || r.status >= 500 || r.status === 404 || r.status === 410;
  if (failed) { await new Promise(s => setTimeout(s, 400)); r = await once(u); }
  return r;
}
async function hostResolves(u) {
  const h = hostOf(u); if (!h) return false;
  for (let i = 0; i < 3; i++) {
    try { await dns.lookup(h); return true; } catch { await new Promise(s => setTimeout(s, 300)); }
  }
  return false;
}
async function classify(u, r) {
  if ([401, 403, 405, 406, 429, 436].includes(r.status)) return "keep-botblock";
  if (r.status === 0 && /Abort/.test(r.errType || "")) return "keep-timeout";
  if (r.status === 0) return (await hostResolves(u)) ? "keep-live-blocking" : "dead-domain";
  if ([404, 410, 500, 502, 503, 504].includes(r.status)) return "http-" + r.status;
  if (r.status >= 200 && r.status < 300 && r.finalUrl) {
    if (pathOf(r.finalUrl) === "/" && pathOf(u) !== "/") return "homepage";
    if (isCivicPlus(u) && pathOf(r.finalUrl) !== pathOf(u)) return "civicplus-reassigned";
    return "keep-ok";
  }
  return "keep-ok";
}
const BROKEN = (c) => c === "dead-domain" || c === "homepage" || c === "civicplus-reassigned" || c.startsWith("http-");

const slots = [];
for (const [key, v] of Object.entries(data)) {
  if (v.housingLead && v.housingLead.url) slots.push({ url: v.housingLead.url, name: v.housingLead.name, set: (nu) => v.housingLead.url = nu, key });
  (v.housingAuthority || []).forEach(h => h.url && slots.push({ url: h.url, name: h.name, set: (nu) => h.url = nu, key }));
  (v.advocacy        || []).forEach(a => a.url && slots.push({ url: a.url, name: a.name, set: (nu) => a.url = nu, key }));
  (v.housingPlans    || []).forEach(p => p.url && slots.push({ url: p.url, name: p.name || p.type, set: (nu) => p.url = nu, key }));
  (v.contacts        || []).forEach(c => c.url && slots.push({ url: c.url, name: c.name, set: (nu) => c.url = nu, key }));
}
const uniq = [...new Set(slots.map(s => s.url))];
const verdict = new Map();
let i = 0;
const CONC = 12;
async function worker() { while (i < uniq.length) { const u = uniq[i++]; verdict.set(u, await classify(u, await probe(u))); } }
console.log(`[heal-lr-links] probing ${uniq.length} unique URLs (${slots.length} slots)…`);
await Promise.all(Array.from({ length: CONC }, worker));

const replacements = [];
for (const s of slots) {
  const c = verdict.get(s.url);
  if (BROKEN(c)) { replacements.push({ key: s.key, name: s.name, was: s.url, why: c }); if (!DRY) s.set(searchFor(s.name)); }
}
const tally = (vals) => vals.reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {});

if (!DRY && replacements.length) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
}

console.log(`\n[heal-lr-links] ${DRY ? "would replace" : "replaced"} ${replacements.length} broken links.`);
console.log("Per-URL verdicts:", JSON.stringify(tally([...verdict.values()])));
console.log("Replacements by reason:", JSON.stringify(tally(replacements.map(r => r.why))));
console.log(`Kept (live-but-blocking / timeout / botblock / ok): ${[...verdict.values()].filter(v => v.startsWith("keep")).length} unique URLs`);
if (DRY) console.log("\n(dry-run — no file written)");
