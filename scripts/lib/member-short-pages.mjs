// The full tools paul moved behind sign-in (25 Nov 2026, "approve the member moves"; batch B, the needs assessment pages). The public build keeps each
// address, so no link, bookmark or shared link breaks, and serves a short free page there instead: what the tool is,
// the free version to use, and a member sign-in link to the same page on the member site. The member site
// (coho-backend member-pages.json) serves the full page from this checkout at the same address.
//
// Methods and the two papers keep their own masthead and their free sections; the rest are written here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, build } from '../build-member-chrome.mjs';

// Each short tool page wears the new pages' header, menu and footer (scripts/build-member-chrome.mjs --public),
// as every free page does (paul, 28 Nov 2026: the old header was still showing on these).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let chrome;
const inChrome = (html, file) => build(html, chrome || (chrome = blocks(fs.readFileSync(path.join(ROOT, 'deal-hub.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'hub/palette.css'), 'utf8'), { public: true })), file);

export const MEMBER_SITE = 'https://coho-backend.communityplanner.workers.dev/';

// A place carried in the old page's query (?geoid=, ?fips=, ?g=) goes to the free page as the hub's ?g=.
const CARRY = `<script>
(function () {
  var q = new URLSearchParams(location.search), g = [q.get('geoid'), q.get('fips'), q.get('g')].filter(function (x) { return /^\\d{5}(\\d{2})?$/.test(x || ''); })[0];
  document.querySelectorAll('[data-carry-place]').forEach(function (a) {
    if (!g) return;
    // A place page carries its place in the route (#/place/<geoid>); the other hubs take ?g=.
    if (a.hasAttribute('data-place-route')) a.href = a.getAttribute('href').split('#')[0] + '#/place/' + g;
    else a.href = a.getAttribute('href') + (a.getAttribute('href').indexOf('?') === -1 ? '?g=' : '&g=') + g;
  });
  document.querySelectorAll('[data-member-link]').forEach(function (a) { a.href = a.getAttribute('href') + location.search + location.hash; });
})();
</script>`;

const TOOLS = {
  'deal-market-analysis.html': {
    title: 'Market Analysis',
    description: 'The full site market study is a member tool. The free market check shows renters, rents, new supply and a capture rate for any Colorado place.',
    lede: 'The full market study for one site is a member tool. For any Colorado town or county, the free market check shows renters, rents, homes being built and a capture rate.',
    members: ['Draw the market area around your site', 'Capture rate, rents and comparable properties for that area', 'Environmental, flood and parcel layers on the map', 'A PDF to share with a lender or attach to an application'],
    free: { href: 'deal-hub.html#/market', label: 'Run the free market check' }
  },
  'for-sale-market-study.html': {
    title: 'For-sale market study',
    description: 'The full for-sale project study is a member tool. The free For-sale and ownership page shows what each income can pay for a home in any Colorado place.',
    lede: 'The full for-sale study is a member tool. The free For-sale and ownership page shows what each income can pay for a home in any Colorado town, and how resale formulas work.',
    members: ['Test project scenarios and land structures', 'Shared equity and resale over the years', 'Effective demand and capture for a for-sale project'],
    free: { href: 'deal-hub.html#/for-sale', label: 'Open For-sale and ownership' }
  },
  'lihtc-opportunity-finder.html': {
    title: 'Opportunity Finder scores',
    description: 'The scored Opportunity Finder is a member tool. The free Opportunity Finder lists every Colorado town on the facts that matter for 4% and 9% tax credit deals.',
    lede: 'The scored Opportunity Finder is a member tool. The free Opportunity Finder lists every Colorado town on the facts that matter for 4% and 9% tax credit deals, without a score.',
    members: ['A weighted score for every town', 'Weights tuned to the deal type you pick', 'Local support points and flags where survey data is thin'],
    free: { href: 'opportunities-hub.html#/finder', label: 'Open the free Opportunity Finder' }
  }
};
// The old-format Market Analysis page, still linked from older pages and bookmarks.
TOOLS['market-analysis.html'] = TOOLS['deal-market-analysis.html'];

// Batch B (paul, 25 Nov 2026, "do it": HNA option B). The needs assessment's chapters, scenarios and comparisons are
// for members; every town and county keeps a free summary and report on its place page. A place in the old page's
// query (?geoid=, ?fips=) opens that place's page (places-hub.html#/place/<geoid>), otherwise the list of places.
// housing-needs-assessment.html itself stays whole: the place page's free PDF and Excel report are built from it in a
// hidden frame (hub/hna.js oldHnaUrl), and the place page's Local partners links into it (Codex P1 on HA #3015). Its
// chapters are gated where visitors read them, on the place page (lab port).
const HNA_FREE = { href: 'places-hub.html#/places', label: 'Open the free place summary', place: true };
const HNA_MEMBERS = ['All six chapters for any Colorado town or county', 'Scenarios for growth and policy', 'Side-by-side comparisons and rankings of places'];
const chapter = (title, what) => ({
  title,
  description: `${title} is a chapter of the needs assessment, for members. Every Colorado town and county has a free summary and report on its place page.`,
  lede: `${what} is a chapter of the full needs assessment, which is for members. Every Colorado town and county has a free summary and a free report on its place page.`,
  members: HNA_MEMBERS,
  free: HNA_FREE
});
Object.assign(TOOLS, {
  'hna-who-lives-here.html': chapter('Who lives here', 'Who lives here, the people and households of a place,'),
  'hna-what-housing-exists.html': chapter('What housing exists', 'What housing exists, the homes a place has today,'),
  'hna-what-households-can-afford.html': chapter('What households can afford', 'What households can afford, renters and owners side by side,'),
  'hna-where-its-heading.html': chapter('Where it’s heading', 'Where it’s heading, the growth and need ahead,'),
  'hna-what-to-do.html': chapter('What to do', 'What to do, the actions that fit a place,'),
  'hna-scenario-builder.html': {
    title: 'Scenario builder',
    description: 'The needs assessment scenario builder is for members. Every Colorado town and county has a free summary and report on its place page.',
    lede: 'The scenario builder, which tests growth and policy choices for a place, is for members. Every Colorado town and county has a free summary and a free report on its place page.',
    members: HNA_MEMBERS,
    free: HNA_FREE
  },
  'hna-comparative-analysis.html': {
    title: 'Compare places',
    description: 'Comparing places side by side is for members. Every Colorado town and county has a free summary and report on its place page.',
    lede: 'Comparing places side by side is for members. Every Colorado town and county has a free summary and a free report on its place page.',
    members: HNA_MEMBERS,
    free: HNA_FREE
  }
});

// Sections kept on the public copy of each long page; everything else goes to members.
const LONG = {
  'methods.html': {
    keep: ['m-footprint', 'm-conventions', 'm-capture'],
    note: 'This is the short version of Methods: how the site is built and its environmental footprint, the conventions and core sources every page follows, and how a capture rate is counted. The full Methods, with every formula, the scoring chain and the known defects, is for members.'
  },
  'working-paper.html': {
    keep: ['s-exec'],
    note: 'This is the executive summary of the working paper. The full paper, with the case study, the method and its PDF, is for members.'
  },
  'apa-white-paper.html': {
    keep: ['summary-h'],
    note: 'This is the summary of the white paper. The full paper, with the worked example and how to read the site’s charts, is for members.'
  }
};

export const SHORT_PAGES = new Set([...Object.keys(TOOLS), ...Object.keys(LONG)]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function memberButtons(file) {
  return `<p class="member-short-actions"><a class="button-link" data-member-link href="${MEMBER_SITE}${file}">Member sign in</a> ` +
    `<a class="button-link secondary" href="mailto:info@cohoanalytics.com?subject=Member%20access">Ask about member access</a></p>`;
}

function toolPage(file, t) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#096e65" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0fd4cf" media="(prefers-color-scheme: dark)">
  <title>${esc(t.title)} | COHO Analytics</title>
  <meta name="description" content="${esc(t.description)}">
  <meta property="og:title" content="${esc(t.title)} | COHO Analytics">
  <meta property="og:description" content="${esc(t.description)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="assets/og-image.png">
  <link rel="stylesheet" href="css/site-theme.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/pages.css">
  <script src="js/path-resolver.js"></script>
  <script src="js/config.js"></script>
  <script src="js/site-state.js"></script>
  <script defer src="js/navigation.js"></script>
  <script defer src="js/dark-mode-toggle.js"></script>
  <script defer src="js/mobile-menu.js"></script>
  <style>
    .member-short { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    .member-short .kicker { font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--accent); margin: 0 0 .5rem; }
    .member-short h1 { margin: 0 0 .8rem; }
    .member-short .lede { font-size: 1.1rem; line-height: 1.55; }
    .member-short ul { padding-left: 1.2em; line-height: 1.6; }
    .member-short-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin: 1.2rem 0; }
    .member-short .button-link { display: inline-flex; align-items: center; min-height: 44px; padding: .55rem 1.1rem; border-radius: 8px; font-weight: 700; text-decoration: none; background: var(--accent); color: var(--bg, #fff); border: 2px solid var(--accent); }
    .member-short .button-link.secondary { background: transparent; color: var(--accent); }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header id="site-header"></header>
  <main id="main-content" class="member-short">
    <p class="kicker">Member tool</p>
    <h1>${esc(t.title)}</h1>
    <p class="lede">${esc(t.lede)}</p>
    <p class="member-short-actions"><a class="button-link" data-carry-place${t.free.place ? ' data-place-route' : ''} href="${t.free.href}">${esc(t.free.label)}</a></p>
    <h2>What members get</h2>
    <ul>${t.members.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    ${memberButtons(file)}
    <p class="note">Members open this same address on the member site and get the full tool.</p>
  </main>
  <script src="js/contrast-guard.js"></script>
  <footer id="site-footer"></footer>
${CARRY}
</body>
</html>
`;
}

// The end of the element that opens at `start` (a <section ...> tag), counting nested sections.
function sectionEnd(html, start) {
  const re = /<\/?section\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error('member-short-pages: unclosed <section>');
}

// The long page with every top-level article section not in `keep` taken out, listed instead in one member card
// where the first of them was. Each removed section's ids stay on its line in the card, so a link to it still lands.
const MARK = '<!--member-short-card-->';
export function longPage(file, html) {
  const spec = LONG[file];
  const removed = [];
  let out = '', i = 0;
  const open = /<section\b[^>]*>/gi;
  let m;
  while ((m = open.exec(html))) {
    const end = sectionEnd(html, m.index);
    const block = html.slice(m.index, end);
    const ids = [(/aria-labelledby="([^"]+)"/.exec(m[0]) || [])[1], (/\bid="([^"]+)"/.exec(m[0]) || [])[1]].filter(Boolean);
    const heading = /<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    if (heading) ids.push(heading[1]);
    // Every id inside the section too (methods #m-sampling-error sits under §10), so links into it still land.
    for (const d of block.matchAll(/\bid="([^"]+)"/g)) ids.push(d[1]);
    const keep = ids.some((x) => spec.keep.includes(x));
    if (!keep && heading) {
      removed.push({ ids: [...new Set(ids)], hid: heading[1], title: heading[2].replace(/<span class="num">[^<]*<\/span>/, '').trim() });
      out += html.slice(i, m.index) + (removed.length === 1 ? MARK : '');
      i = end;
    }
    open.lastIndex = end;
  }
  out += html.slice(i);
  if (!removed.length) throw new Error(`member-short-pages: nothing to take out of ${file}`);
  const gone = new Set(removed.flatMap((r) => r.ids));
  // Contents entries for sections that left.
  out = out.replace(/\s*<li><a href="#([^"]+)">[\s\S]*?<\/a><\/li>/g, (li, id) => (gone.has(id) ? '' : li));
  // A paragraph that sends readers into a section that left goes too ("Reviewers are asked to attack §05 first").
  out = out.replace(/\s*<p>(?:(?!<\/p>)[\s\S])*?Reviewers are asked(?:(?!<\/p>)[\s\S])*?<\/p>/g, '');
  const card = `<section class="member-short-card" aria-labelledby="member-short-h">
        <h2 id="member-short-h">The full version is for members</h2>
        <p>${esc(spec.note)}</p>
        <ul>${removed.map((r) => `<li id="${esc(r.hid)}">${r.ids.filter((x) => x !== r.hid).map((x) => `<span id="${esc(x)}"></span>`).join('')}${r.title}</li>`).join('')}</ul>
        ${memberButtons(file)}
      </section>`;
  out = out.replace(MARK, card)
    // The page's own description and masthead say it is the full text; on the public copy they say what it is.
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(spec.note)}">`)
    .replace(/(<h1\b[^>]*>[\s\S]*?<\/h1>)/, `$1\n<p class="note member-short-banner"><strong>Short version.</strong> The full text is for members. The member box below lists what it adds.</p>`);
  return out.replace('</body>', `${CARRY}\n</body>`);
}

export function shortPage(file, html) {
  if (TOOLS[file]) return inChrome(toolPage(file, TOOLS[file]), file);
  if (LONG[file]) return longPage(file, html);
  throw new Error(`member-short-pages: no short page for ${file}`);
}
