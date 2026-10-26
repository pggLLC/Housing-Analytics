'use strict';

/**
 * Stale and unconfirmed funding programs, for the daily audit
 * (test/audit-modules/data-integrity.js) and test/funding-eligibility-claims.test.js.
 *
 * Two catalogs list Colorado funding programs:
 *   data/policy/co-developer-funding-guide.json — the verified guide (Funding Sources tab,
 *     Opportunity Finder, Compare).
 *   data/policy/soft-funding-status.json — the older catalog the Deal Calculator's
 *     tranche picker and the soft-funding tracker still read.
 *
 * Until 2026-10 nothing flagged a program that no official page establishes, or a round
 * whose dates had all passed: the 2026-10-09 recheck marked 19 legacy labels VERIFY with
 * a fresh checked date, so every freshness check read them as current. These checks look
 * at what the entries say, not when they were last touched.
 *
 * Pure: pass the parsed files and a YYYY-MM-DD "today".
 */

// Only these statuses mean the program's current terms were confirmed on its own page.
// Mirrors CONFIRMED_STATUSES in js/soft-funding-tracker.js (the test holds them equal).
const CONFIRMED_SOFT_STATUSES = ['active'];
// Statuses that say plainly the label is not a source today: no finding for these.
// 'retired' marks a legacy label no official page establishes (kept so older saved
// deals still resolve); 'ended' a program whose own page says it is over.
const SETTLED_SOFT_STATUSES = ['closed', 'retired', 'ended'];
// Guide statuses that promise a next round. (Open and rolling programs often name only
// the date they opened, "since December 2022", so a past date there is not staleness.)
const GUIDE_LIVE_STATUSES = ['rounds', 'annual'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DATE_RE = new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{1,2}),\\s+(20\\d\\d)\\b', 'g');

const MONTH_RE = new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(20\\d\\d)\\b', 'g');

/**
 * Every date in a text, as YYYY-MM-DD: "Month D, YYYY" as written, and "Month YYYY"
 * (e.g. "the first business day of November 2026") as that month's last day, so a
 * round named only by month still counts as upcoming until the month ends.
 */
function datesIn(text) {
  const out = [];
  const t = String(text || '');
  for (const m of t.matchAll(DATE_RE)) {
    const mm = String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0');
    out.push(`${m[3]}-${mm}-${m[2].padStart(2, '0')}`);
  }
  for (const m of t.matchAll(MONTH_RE)) {
    const month = MONTHS.indexOf(m[1]) + 1;
    const last = new Date(Date.UTC(Number(m[2]), month, 0)).getUTCDate();
    out.push(`${m[2]}-${String(month).padStart(2, '0')}-${last}`);
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @returns {Array<{severity, file, description, expected, actual, recommendation}>}
 */
function fundingProgramFindings({ guide, soft, today }) {
  const findings = [];
  const GUIDE = 'data/policy/co-developer-funding-guide.json';
  const SOFT = 'data/policy/soft-funding-status.json';

  if (soft && soft.programs) {
    const entries = Object.entries(soft.programs);
    const unconfirmed = entries.filter(([, p]) => p && !SETTLED_SOFT_STATUSES.includes(p.status) && !CONFIRMED_SOFT_STATUSES.includes(p.status));
    if (unconfirmed.length) {
      findings.push({
        severity: 'medium',
        file: SOFT,
        description: `${unconfirmed.length} funding program label(s) in the older catalog are not confirmed on any official page: ` +
          unconfirmed.map(([id, p]) => `${p.name || id} (${p.status || 'no status'})`).join('; '),
        expected: 'Every program in the catalog is confirmed on its administrator\'s page, or retired',
        actual: `${unconfirmed.length} unconfirmed`,
        recommendation: 'Confirm each on the administrator\'s page and record its terms, or map it to a program in the verified guide and remove the label. The Deal Calculator\'s tranche picker still offers these names.',
      });
    }
    for (const [id, p] of entries) {
      if (!p) continue;
      if (CONFIRMED_SOFT_STATUSES.includes(p.status) && ISO.test(p.deadline || '') && p.deadline < today) {
        findings.push({
          severity: 'medium', file: SOFT,
          description: `${p.name || id} is marked ${p.status} but its deadline ${p.deadline} has passed`,
          expected: 'A confirmed program carries its next deadline, or none',
          actual: `deadline ${p.deadline}`,
          recommendation: 'Recheck the program page and update its status and deadline.',
        });
      }
      if (ISO.test(p.review_by || '') && p.review_by < today) {
        findings.push({
          severity: 'medium', file: SOFT,
          description: `${p.name || id} was due for review on ${p.review_by}`,
          expected: 'Every program reviewed by its review_by date',
          actual: `review_by ${p.review_by}`,
          recommendation: 'Recheck the program against its official page.',
        });
      }
    }
  }

  if (guide && Array.isArray(guide.programs)) {
    const meta = guide.meta || {};
    if (ISO.test(meta.review_by || '') && meta.review_by < today) {
      findings.push({
        severity: 'high', file: GUIDE,
        description: `The funding guide was due for its scheduled review on ${meta.review_by}`,
        expected: 'Program terms rechecked by meta.review_by',
        actual: `last checked ${meta.last_checked}`,
        recommendation: 'Recheck every program against its official page and update last_checked and review_by.',
      });
    }
    for (const p of guide.programs) {
      if (!p || !GUIDE_LIVE_STATUSES.includes(p.status)) continue;
      const dates = datesIn(p.application_cycle);
      if (dates.length && dates.every((d) => d < today)) {
        findings.push({
          severity: 'medium', file: GUIDE,
          description: `${p.name} is marked "${p.status}" but every date in its application cycle has passed (latest ${dates.sort().pop()})`,
          expected: 'A program shown with periodic rounds names a current or future round',
          actual: p.application_cycle,
          recommendation: 'Recheck the program page: record the next round, or mark it closed or watch.',
        });
      }
    }
  }
  return findings;
}

/**
 * What the funding watch (scripts/audit/funding_watch.py, data/audit/funding-watch.json)
 * saw on the agencies' own pages, against what the catalogs say:
 *   - a program whose page changed after the program was last checked, and
 *   - a program whose page has been unreachable or blocked for days, and
 *   - a federal notice search that has failed for days.
 * The watch never edits a status, so these stay open until a person rechecks the
 * program on its page and updates last_checked. A missing watch file (before its
 * first run) yields nothing.
 *
 * @returns {Array<{severity, file, description, expected, actual, recommendation}>}
 */
function fundingWatchFindings({ watch }) {
  const findings = [];
  if (!watch) return findings;
  const FILES = { guide: 'data/policy/co-developer-funding-guide.json', soft: 'data/policy/soft-funding-status.json' };
  // A federal search (Grants.gov, the Federal Register) failing for days hides new
  // notices the same way a blocked page hides a new round. The run's tracker issue
  // opens once; this keeps reporting it daily until the feed answers (Codex, 2026-10-15).
  for (const [source, st] of Object.entries(watch.federal_sources || {})) {
    if (!st || !st.unverifiable) continue;
    findings.push({
      severity: 'medium', file: 'data/audit/funding-watch.json',
      description: `The ${source} search for new federal funding notices has failed since ${String(st.first_failed_at || '').slice(0, 10)}`,
      expected: 'Every federal funding search answers, or is checked by hand while it fails',
      actual: `${st.endpoint || source}: ${st.error || 'unreachable'}`,
      recommendation: `Search ${source} by hand for new housing and infrastructure funding notices. A failed search is not "no new notices".`,
    });
  }
  for (const page of Array.isArray(watch.pages) ? watch.pages : []) {
    if (!page) continue;
    const programs = page.programs || [];
    // Agency announcement pages carry no programs, but a blocked one still hides
    // new rounds, so it is reported before the program comparison below.
    if (page.unverifiable) {
      const what = programs.length ? programs.map((p) => p.name || p.id).join('; ') : `${page.agency || page.id} (agency page)`;
      findings.push({
        severity: 'medium', file: 'data/audit/funding-watch.json',
        description: `The page for ${what} could not be read since ${String(page.first_failed_at || '').slice(0, 10)}`,
        expected: 'Every watched funding page is readable, or checked by hand while it is blocked',
        actual: `${page.url}: ${page.error || 'unreachable'}`,
        recommendation: 'Open the page in a browser and recheck what it lists. A blocked page is not "no change".',
      });
    }
    const changed = String(page.last_changed_at || '').slice(0, 10);
    for (const p of programs) {
      const checked = String(p.last_checked || '').slice(0, 10);
      if (ISO.test(changed) && (!ISO.test(checked) || changed > checked)) {
        findings.push({
          severity: 'medium', file: FILES[p.catalog] || FILES.guide,
          description: `${p.name || p.id}: its page changed on ${changed}, after the program was last checked (${checked || 'never'})`,
          expected: 'A program is rechecked after its own page changes',
          actual: `${page.url} changed ${changed}`,
          recommendation: 'Read the page (the funding-watch issue lists the lines that changed) and update the record with a quote, or update last_checked if nothing material changed.',
        });
      }
    }
  }
  return findings;
}

module.exports = { fundingProgramFindings, fundingWatchFindings, datesIn, CONFIRMED_SOFT_STATUSES, SETTLED_SOFT_STATUSES, GUIDE_LIVE_STATUSES };
