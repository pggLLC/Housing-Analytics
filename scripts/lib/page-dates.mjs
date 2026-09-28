// page-dates.mjs — the date each served page's content last changed, from git.
//
// Every public page carries a visible "Last updated" date, stamped into the
// built artifact by scripts/build-public-site.mjs. The date is the last commit
// that changed what the page SAYS: its visible text, with scripts, styles,
// comments and markup stripped. The last commit to touch the file is not that
// date. On 2026-09-28 the last commits to the AHCIA, CRA and legislation pages
// were layout sweeps (#1806, #1889) while their text dated from June and July;
// stamping the commit date would have told readers June's analysis was
// September's. A copy edit counts; so does a regenerated number on a place
// profile, because the reader sees a different figure.
//
// Only the last-changed date is derived. A file's FIRST commit is not its
// publication date (the history begins 2026-02-20 with an import, and several
// pages were later rewritten under the same name), so no "Published" date is
// derived here. Pages that declare an editorial publication date keep it.
//
// A shallow clone cannot answer the question. In a depth-1 checkout every file
// appears to have been changed in the one commit present, which is how the
// live sitemap came to report all 547 URLs as changed on the deploy day. So a
// shallow repository yields NO dates — the stamp and <lastmod> are omitted —
// rather than a wrong one.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const STAMP_CLASS = 'coho-page-date';

// Pages that are not reader-facing documents: a social-card render target, a
// not-found page, the place-page template, and map fragments embedded in iframes.
export function isStampable(relPath) {
  const p = relPath.split('\\').join('/');
  if (!p.endsWith('.html')) return false;
  if (p === '404.html' || p === 'og-card.html' || p === 'places/_template.html') return false;
  if (p.startsWith('assets/')) return false;
  return true;
}

// Documents a reader reads top to bottom: the date goes under the title,
// where a reader of an article looks for it. Every other page (tools,
// dashboards, the homepage, place profiles) gets it at the foot of <main>.
export const ARTICLE_PAGES = new Set([
  'about.html',
  'colorado-deep-dive.html',
  'colorado-elections.html',
  'cra-expansion-analysis.html',
  'help-for-homebuyers.html',
  'historical-trends.html',
  'housing-legislation-2026.html',
  'insights.html',
  'lihtc-enhancement-ahcia.html',
  'lihtc-guide-for-stakeholders.html',
  'market-intelligence.html',
  'methods.html',
  'privacy-policy.html',
  'working-paper.html'
]);

export function isArticle(relPath) {
  const p = relPath.split('\\').join('/');
  return ARTICLE_PAGES.has(p) || /^article-[^/]+\.html$/.test(p);
}

// Parse `git log --format='@%H %cs' --name-only` output (newest commit first)
// into Map<path, [{ sha, date }]> listing every commit that touched each path,
// newest first.
export function parseHistory(stdout) {
  const history = new Map();
  let current = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@')) {
      const m = /^@([0-9a-f]{7,64}) (\d{4}-\d{2}-\d{2})$/.exec(line);
      current = m ? { sha: m[1], date: m[2] } : null;
      continue;
    }
    if (!current) continue;
    if (!history.has(line)) history.set(line, []);
    history.get(line).push(current);
  }
  return history;
}

// What a reader sees, as a comparable string: no scripts, styles, comments,
// tags or attribute values, whitespace collapsed, two common entities decoded.
export function visibleText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Date of the newest commit whose visible text differs from the version before
// it. `commits` is newest first; `readText(sha)` resolves to that version's
// visibleText, or null if it cannot be read. A page whose text never changed
// is dated by its oldest commit. Returns null when a needed version is
// unreadable — an unknown date, never a guessed one.
export async function contentChangedDate(commits, readText) {
  if (!commits || !commits.length) return null;
  let newer = null;
  for (const commit of commits) {
    const text = await readText(commit.sha);
    if (text === null) return null;
    if (newer !== null && text !== newer.text) return newer.date;
    newer = { text, date: commit.date };
  }
  return newer.date;
}

export function formatLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

function stampHtml(iso) {
  return `<p class="${STAMP_CLASS}" style="font-size:.8rem;color:var(--muted);margin:.25rem 0 1rem;" ` +
    `title="The last date this page's text changed. Figures on the page carry their own data dates.">` +
    `Last updated <time datetime="${iso}">${formatLongDate(iso)}</time></p>`;
}

// An article that already prints an editorial date near its title (e.g.
// "Published: June 10, 2026 · Updated: July 16, 2026") gets the stamp at the
// foot of <main> instead, so two different dates never sit side by side
// under one heading.
const EDITORIAL_DATE = /\b(Published|Updated)\s*:?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}/;

// Insert the meta tag and the visible stamp. Returns the html unchanged when
// the date is unknown or the page is already stamped.
export function stampPage(html, iso, { article = false } = {}) {
  if (!formatLongDate(iso)) return html;
  if (html.includes(`class="${STAMP_CLASS}"`)) return html;

  let out = html.replace(/<\/head>/i, `  <meta name="coho:page-updated" content="${iso}">\n</head>`);
  const stamp = stampHtml(iso);

  const mainOpen = out.search(/<main\b/i);
  const mainClose = out.search(/<\/main>/i);
  const hasEditorialDate = EDITORIAL_DATE.test(mainOpen >= 0 ? out.slice(mainOpen, mainClose >= 0 ? mainClose : undefined) : out);

  if (article && !hasEditorialDate) {
    // Directly under the page's first heading, where a reader looks for a date.
    const from = mainOpen >= 0 ? mainOpen : 0;
    const h1Close = out.slice(from).search(/<\/h1>/i);
    if (h1Close >= 0) {
      const at = from + h1Close + '</h1>'.length;
      return out.slice(0, at) + '\n' + stamp + out.slice(at);
    }
  }
  if (mainClose >= 0) return out.slice(0, mainClose) + stamp + '\n' + out.slice(mainClose);
  const bodyClose = out.search(/<\/body>/i);
  if (bodyClose >= 0) return out.slice(0, bodyClose) + stamp + '\n' + out.slice(bodyClose);
  return out;
}
