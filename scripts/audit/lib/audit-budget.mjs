/**
 * Budgets for the browser audits. Pure functions, so they are unit-tested
 * without a browser (test/audit-budgets.test.mjs).
 */

/**
 * Compare serious and critical findings with the committed budget, page by
 * page and rule by rule. Returns { over: [...], under: [...] }. Moderate and
 * minor findings are reported but not budgeted.
 *
 * Budgeted per page, not per rule across the site: a site-wide allowance lets
 * a fix on one page pay for a new failure on another, and the debt stays
 * hidden. A page or rule absent from the budget is allowed nothing.
 *
 * Without this the audit was a reporter nobody read: it could find 926
 * serious failures and still finish green.
 */
export function checkA11yBudget(results, budget) {
  const max = (budget && budget.maxElements) || {};
  const allowedFor = (rule, page) => (max[rule] && Number.isInteger(max[rule][page]) ? max[rule][page] : 0);
  const found = {};
  const over = [];
  for (const r of results) {
    if (r.error) continue;
    for (const v of r.violations || []) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      const allowed = allowedFor(v.id, r.page);
      (found[v.id] ||= {})[r.page] = v.nodeCount;
      if (v.nodeCount > allowed) over.push({ rule: v.id, impact: v.impact, page: r.page, found: v.nodeCount, allowed });
    }
  }
  const audited = new Set(results.filter((r) => !r.error).map((r) => r.page));
  const under = [];
  for (const [rule, pages] of Object.entries(max)) {
    for (const [page, allowed] of Object.entries(pages)) {
      if (!audited.has(page)) continue;
      const n = (found[rule] && found[rule][page]) || 0;
      if (n < allowed) under.push({ rule, page, found: n, allowed });
    }
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
  // A measurement that did not happen is a breach, not a pass: NaN and null
  // are never "over" a limit, so an unguarded comparison waves them through.
  const limit = (page, measure, found, allowed) => {
    if (!Number.isFinite(allowed)) return;
    if (!Number.isFinite(found)) breaches.push({ page, measure, found: 'not measured', allowed });
    else if (found > allowed) breaches.push({ page, measure, found, allowed });
  };
  for (const r of results) {
    if (r.error) { breaches.push({ page: r.page, measure: 'load', found: r.error, allowed: 'loads' }); continue; }
    const b = { ...d, ...((budget.pages || {})[r.page] || {}) };
    // Non-vacuity: a page whose data never rendered is light and fast, and
    // would pass every limit below.
    if (b.ready) {
      const min = Number.isFinite(b.ready.min) ? b.ready.min : 1;
      if (!(r.readyCount >= min)) {
        breaches.push({ page: r.page, measure: `rendered ${b.ready.selector}`, found: r.readyCount ?? 'not measured', allowed: `at least ${min}` });
      }
    }
    limit(r.page, 'DOM nodes', r.domNodes, b.maxDomNodes);
    limit(r.page, 'main-thread blocking (ms)', r.blockingMs, b.maxBlockingMs);
    if (b.oneH1 && r.h1Count !== 1) {
      breaches.push({ page: r.page, measure: '<h1> count', found: r.h1Count, allowed: 1 });
    }
    // The expanded state is held to the same limits as the first view: a fast
    // first screen must not hide a slow click.
    if (b.click) {
      const a = r.afterClick;
      if (!a || !(a.clicks > 0)) {
        breaches.push({ page: r.page, measure: `click ${b.click.selector}`, found: a ? a.clicks : 'not run', allowed: 'at least 1 click' });
      } else {
        limit(r.page, `DOM nodes after ${a.clicks} click(s)`, a.domNodes, b.maxDomNodes);
        limit(r.page, `blocking after ${a.clicks} click(s) (ms)`, a.blockingMs, b.maxBlockingMs);
      }
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
