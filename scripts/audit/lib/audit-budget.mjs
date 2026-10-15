/**
 * Budgets for the browser audits. Pure functions, so they are unit-tested
 * without a browser (test/audit-budgets.test.mjs).
 */

/**
 * Compare serious and critical findings with the committed budget. Returns
 * { over: [...], under: [...] }. Moderate and minor findings are reported but
 * not budgeted.
 *
 * Without this the audit was a reporter nobody read: it could find 926
 * serious failures and still finish green.
 */
export function checkA11yBudget(summary, budget) {
  const max = (budget && budget.maxElements) || {};
  const over = [];
  const under = [];
  for (const [rule, info] of Object.entries(summary.byRule)) {
    if (info.impact !== 'serious' && info.impact !== 'critical') continue;
    const allowed = Object.prototype.hasOwnProperty.call(max, rule) ? max[rule] : 0;
    if (info.nodeCount > allowed) over.push({ rule, impact: info.impact, found: info.nodeCount, allowed, pages: info.pages });
  }
  for (const [rule, allowed] of Object.entries(max)) {
    const found = summary.byRule[rule] ? summary.byRule[rule].nodeCount : 0;
    if (found < allowed) under.push({ rule, found, allowed });
  }
  return { over, under };
}

/**
 * Compare the usability pass with its budget. Returns a list of breaches,
 * each { page, measure, found, allowed }.
 *
 * Budgeted (hard): DOM size and main-thread blocking per page, because those
 * are what froze step 3 for ~18 s on a phone; and exactly one <h1>, because a
 * page without one has no stated purpose for a screen reader or a newcomer.
 *
 * Reading grade and first-screen abbreviations are never budgeted. They are
 * rough signals for a professional audience, not measures of comprehension;
 * only people reading the site can say whether they understood it.
 */
export function checkUxBudget(results, budget) {
  const breaches = [];
  const d = budget.defaults || {};
  for (const r of results) {
    if (r.error) { breaches.push({ page: r.page, measure: 'load', found: r.error, allowed: 'loads' }); continue; }
    const b = { ...d, ...((budget.pages || {})[r.page] || {}) };
    if (Number.isFinite(b.maxDomNodes) && r.domNodes > b.maxDomNodes) {
      breaches.push({ page: r.page, measure: 'DOM nodes', found: r.domNodes, allowed: b.maxDomNodes });
    }
    if (Number.isFinite(b.maxBlockingMs) && r.blockingMs > b.maxBlockingMs) {
      breaches.push({ page: r.page, measure: 'main-thread blocking (ms)', found: r.blockingMs, allowed: b.maxBlockingMs });
    }
    if (b.oneH1 && r.h1Count !== 1) {
      breaches.push({ page: r.page, measure: '<h1> count', found: r.h1Count, allowed: 1 });
    }
  }
  return breaches;
}

/** Flesch-Kincaid grade of a block of prose, or null when there is none. */
export function fleschKincaidGrade(text) {
  const words = String(text || '').split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return null;
  const sentences = Math.max(1, (String(text).match(/[.!?](\s|$)/g) || []).length);
  const syllables = words.reduce((a, w) => a + countSyllables(w), 0);
  return Math.round((0.39 * words.length / sentences + 11.8 * syllables / words.length - 15.59) * 10) / 10;
}

function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
