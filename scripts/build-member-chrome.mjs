#!/usr/bin/env node
// Puts the member pages in the new pages' header, menu, footer and look (paul, 14 Nov 2026: "build the member switch").
//
// The member pages are the developer*.html pages here (the public build leaves them out; the member site serves them)
// and coho-backend's gated/developer-*.html. Each keeps its own words, figures, controls and scripts. This script
// writes four marked blocks into each page, and rewrites only those blocks when it runs again:
//   member-chrome:theme    light or dark before the page paints (the site's own key), first thing in the head
//   member-chrome:head     the favicon, the new pages' palette, fonts and sheets (in the cascade layer "hub"), and
//                          css/member-chrome.css, which hands the header and footer to the new sheets and the page's
//                          content to its own, and gives the old theme's colour names the new palette's colours
//   member-chrome:header   the skip link target is kept; the new pages' header, word for word as on deal-hub.html
//   member-chrome:footer   the new pages' footer, with "Member home" in place of "Member sign in"
//   member-chrome:scripts  in place of js/navigation.js: js/glossary.js and the 'nav:rendered' announcement, as
//                          navigation.js did them, then hub/lab-config.js, hub/page-chrome.js and hub/nav.js, which
//                          draw the five menus as on every hub page
// The member menu under the header (js/whitepaper/developer-nav.js) stays, as a row of tabs.
//
//   node scripts/build-member-chrome.mjs                     every developer*.html here
//   node scripts/build-member-chrome.mjs <page.html> ...     those pages (coho-backend runs it on gated/)
//   node scripts/build-member-chrome.mjs --public            the free pages in PUBLIC_PAGES below, which still drew
//                                                            the old header (paul, 28 Nov 2026: "looks like somehow
//                                                            we're getting the old site pulled in"). The footer keeps
//                                                            "Member sign in", the body is a chrome-page, and 404.html,
//                                                            served at any depth, takes its addresses from the root.
//   add --check                                              exit 1 when a page differs from a fresh build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The free pages that are not hub pages and keep their own body: each is in the new pages' header, menu and footer.
// scripts/lib/member-short-pages.mjs puts its short pages in the same chrome when the public build writes them.
export const PUBLIC_PAGES = ['member-sign-in.html', 'privacy-policy.html', 'terms-of-use.html', 'search.html', 'sitemap.html', 'research-brief.html', '404.html'];
// 404.html is served at whatever address was asked for, so its own links and sheets start at the site's root.
export const rootFor = (name) => (name === '404.html' ? '/' : '');
const HUB_SHEETS = ['shell.css', 'visual-pass.css', 'templates.css', 'look.css'];

function chromeFrom(hubPage, opts) {
  const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(hubPage);
  const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(hubPage);
  if (!header || !footer) throw new Error('build-member-chrome: deal-hub.html no longer carries the header and footer the way this reads them');
  const signIn = '<a class="footer-link" href="https://coho-backend.communityplanner.workers.dev/">Member sign in</a>';
  if (footer[0].indexOf(signIn) < 0) throw new Error('build-member-chrome: the footer no longer has the Member sign in link this replaces');
  return { header: header[0], footer: opts.public ? footer[0] : footer[0].replace(signIn, '<a class="footer-link" href="developer.html">Member home</a>') };
}

// The small print of the header and footer keeps the palette's own --muted (the old theme uses the name for its
// secondary text, which section 3 of css/member-chrome.css points at the palette too). Read from hub/palette.css.
function chromeMuted(palette) {
  const cut = palette.indexOf('@media screen and (prefers-color-scheme: dark)');
  const light = /--muted:\s*([^;]+);/.exec(palette.slice(0, cut));
  const dark = [...palette.slice(cut).matchAll(/--muted:\s*([^;]+);/g)].map(m => m[1].trim());
  if (cut < 0 || !light || dark.length !== 2 || dark[0] !== dark[1]) throw new Error('build-member-chrome: hub/palette.css no longer sets --muted once for light and twice, alike, for dark');
  const where = ':is(.skip-link, .site-header, .site-footer)';
  return '<style>/* The header and footer keep the new pages\' small-print colour (hub/palette.css, read at build). */\n' +
    where + ' { --muted: ' + light[1].trim() + '; }\n' +
    '@media screen and (prefers-color-scheme: dark) { :root:not(.light-mode) ' + where + ' { --muted: ' + dark[0] + '; } }\n' +
    '@media screen { :root.dark-mode ' + where + ' { --muted: ' + dark[0] + '; } }</style>';
}

const mark = (name, body) => '<!-- member-chrome:' + name + ' (scripts/build-member-chrome.mjs; do not edit by hand) -->\n' + body + '\n<!-- /member-chrome:' + name + ' -->';
const markRe = name => new RegExp('<!-- member-chrome:' + name + ' [^>]*-->[\\s\\S]*?<!-- /member-chrome:' + name + ' -->');

// A site-relative address (not a scheme, a mailto or a fragment) from the root, for a page served at any depth.
const fromRoot = (html, r) => (r ? html.replace(/(\s(?:href|src)=")(?![a-z][a-z0-9+.-]*:|\/|#)/gi, '$1' + r).replace(/(@import url\(")(?![a-z][a-z0-9+.-]*:|\/)/gi, '$1' + r) : html);

export function blocks(hubPage, palette, opts = {}) {
  const chrome = chromeFrom(hubPage, opts);
  const r = opts.root || '';
  const b = {
    theme: mark('theme', '<script>/* Light or dark, before the page paints (the site\'s own key and classes). */\n' +
      'try { var s = localStorage.getItem(\'coho-analytics-scheme\'); if (s === \'dark\' || s === \'light\') document.documentElement.classList.add(s + \'-mode\'); } catch (e) {}</script>'),
    head: mark('head', '<link rel="icon" href="favicon.svg" type="image/svg+xml">\n' +
      '<link rel="stylesheet" href="hub/palette.css">\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap">\n' +
      '<style>' + HUB_SHEETS.map(f => '@import url("hub/' + f + '") layer(hub);').join(' ') + '</style>\n' +
      '<link rel="stylesheet" href="css/member-chrome.css">\n' + chromeMuted(palette)),
    header: mark('header', chrome.header),
    footer: mark('footer', chrome.footer),
    scripts: mark('scripts', '<script type="module">/* The glossary and the header announcement, as js/navigation.js did them. */\n' +
      'if (!document.getElementById(\'glossary-script\')) { const gs = document.createElement(\'script\'); gs.id = \'glossary-script\'; gs.src = \'js/glossary.js\'; document.body.appendChild(gs); }\n' +
      'document.dispatchEvent(new CustomEvent(\'nav:rendered\'));</script>\n' +
      (r ? '<script>window.LAB_ROOT = ' + JSON.stringify(r) + ';</script>\n' : '') +
      '<script src="hub/lab-config.js"></script>\n<script src="hub/page-chrome.js"></script>\n<script src="hub/nav.js"></script>' +
      (opts.public ? '' : '\n<script>/* On a member page, the header\'s Members link is the current one. */\n' +
      'document.querySelectorAll(\'.site-nav a[data-hub="members"]\').forEach(function (a) { a.setAttribute(\'aria-current\', \'page\'); });</script>'))
  };
  // glossary.js is added by a script, so its address is written from the root by hand.
  if (r) b.scripts = b.scripts.replace("gs.src = 'js/glossary.js'", "gs.src = '" + r + "js/glossary.js'");
  for (const k of Object.keys(b)) b[k] = fromRoot(b[k], r);
  b.bodyClass = opts.public ? 'chrome-page' : 'member-page';
  return b;
}

export function build(src, b, name) {
  const must = (cond, what) => { if (!cond) throw new Error('build-member-chrome: ' + name + ' ' + what); };
  let out = src;
  const put = (key, insert) => { if (markRe(key).test(out)) out = out.replace(markRe(key), () => b[key]); else insert(); };

  put('theme', () => { must(/<head>\n/.test(out), 'has no <head> on a line of its own'); out = out.replace(/<head>\n/, () => '<head>\n' + b.theme + '\n'); });
  put('head', () => { must(out.indexOf('</head>') > 0, 'has no </head>'); out = out.replace('</head>', () => b.head + '\n</head>'); });
  // The old header's empty placeholder goes; the new header takes its place, after the skip link.
  out = out.replace(/[ \t]*<header (?:id="siteHeader"|id="site-header"|class="site-header")>\s*(?:<!--[^>]*-->)?\s*<\/header>\n/, '');
  out = out.replace(/[ \t]*<footer (?:id="site-footer"|class="site-footer")>\s*(?:<!--[^>]*-->)?\s*<\/footer>\n/, '');
  // The old header's theme button and phone drawer go with it: the new header has both, and two theme buttons would
  // each label only themselves (Codex P2 on #3058).
  out = out.replace(/[ \t]*<script (?:defer )?src="\/?js\/(?:dark-mode-toggle|mobile-menu)\.js"><\/script>\n/g, '');
  put('header', () => {
    const skip = /<a class="skip-link"[^>]*>[^<]*<\/a>\n/.exec(out);
    if (skip) out = out.replace(skip[0], () => skip[0] + b.header + '\n');
    else {
      must(/<body[^>]*>\n/.test(out), 'has no <body> on a line of its own');
      // A new skip link lands on the page's <main> by the id it already has.
      const mainId = (/<main[^>]*\bid="([^"]+)"/.exec(out) || [])[1] || 'main-content';
      out = out.replace(/(<body[^>]*>\n)/, (m) => m + '<a class="skip-link" href="#' + mainId + '">Skip to content</a>\n' + b.header + '\n');
    }
  });
  // The skip link lands on the page's <main>.
  const skipTo = (/<a class="skip-link" href="#([^"]+)"/.exec(out) || [])[1];
  if (skipTo && out.indexOf('id="' + skipTo + '"') < 0) {
    must(/<main(?![^>]*\bid=)([^>]*)>/.test(out), 'has no <main> without an id for the skip link');
    out = out.replace(/<main(?![^>]*\bid=)([^>]*)>/, '<main id="' + skipTo + '"$1>');
  }
  put('footer', () => { must(out.indexOf('</main>') > 0, 'has no </main>'); out = out.replace(/<\/main>\n?/, () => '</main>\n' + b.footer + '\n'); });
  put('scripts', () => {
    // The menu draws into the header, so its scripts go where the header has been read: before </body>, whether the
    // old header script sat in the head (deferred) or at the end of the body.
    out = out.replace(/[ \t]*<script (?:defer )?src="\/?js\/navigation\.js"><\/script>\n/, '');
    must(out.indexOf('</body>') > 0, 'has no </body>');
    out = out.replace(/<\/body>(?![\s\S]*<\/body>)/, () => b.scripts + '\n</body>');
  });
  must(!/src="\/?js\/navigation\.js"/.test(out), 'still loads js/navigation.js');
  must((out.match(/<header class="site-header">/g) || []).length === 1 && (out.match(/<footer class="site-footer">/g) || []).length === 1, 'has one site header and one site footer');
  // The page names itself a member page (or, on the free site, a chrome page) for css/member-chrome.css.
  const cls = b.bodyClass || 'member-page';
  if (!new RegExp('<body[^>]*\\b' + cls + '\\b').test(out)) {
    if (/<body([^>]*)\bclass="([^"]*)"/.test(out)) out = out.replace(/<body([^>]*)\bclass="([^"]*)"/, (m, a, c) => '<body' + a + 'class="' + (c ? c + ' ' : '') + cls + '"');
    else out = out.replace(/<body([^>]*)>/, '<body$1 class="' + cls + '">');
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), check = args.includes('--check'), pub = args.includes('--public');
  let files = args.filter(a => !a.startsWith('--'));
  if (!files.length && pub) files = PUBLIC_PAGES.map(f => path.join(root, f));
  if (!files.length) files = fs.readdirSync(root).filter(f => /^developer.*\.html$/.test(f) && !/Redirecting|http-equiv="refresh"/i.test(fs.readFileSync(path.join(root, f), 'utf8'))).map(f => path.join(root, f));
  const hubPage = fs.readFileSync(path.join(root, 'deal-hub.html'), 'utf8'), palette = fs.readFileSync(path.join(root, 'hub/palette.css'), 'utf8');
  let stale = 0;
  files.forEach(f => {
    const b = blocks(hubPage, palette, { public: pub, root: pub ? rootFor(path.basename(f)) : '' });
    const src = fs.readFileSync(f, 'utf8'), fresh = build(src, b, path.basename(f));
    if (check) { if (src !== fresh) { stale++; console.log(path.basename(f) + ': OUT OF DATE, run node scripts/build-member-chrome.mjs'); } }
    else if (src !== fresh) { fs.writeFileSync(f, fresh); console.log('wrote ' + path.basename(f)); }
  });
  if (check) { console.log(stale ? stale + ' member page(s) out of date' : 'member pages: ' + files.length + ' up to date'); process.exit(stale ? 1 : 0); }
}
