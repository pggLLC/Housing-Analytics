#!/usr/bin/env node
// Builds deal-market-analysis.html: the full Market Analysis in the new format, from market-analysis.html.
//
// The tool itself is not copied or rewritten. This script reads market-analysis.html, the page the tool is
// maintained on, and writes the same body (every control, table, chart, map, download and script, in the same
// order) inside the new pages' header, menu, footer and look. So a figure on the new page comes from the same
// code, fed the same inputs, as the figure on the old page, and a fix to the old page reaches the new one the
// next time this runs. test/market-analysis-hub-page.test.mjs fails when the written page is out of date.
//
//   node scripts/build-market-analysis-hub.mjs          write deal-market-analysis.html
//   node scripts/build-market-analysis-hub.mjs --check  exit 1 when the page on disk differs from a fresh build
//
// What changes, and nothing else:
//   1. the head: title, description, canonical address, the new pages' fonts, palette and sheets, one bridging sheet
//   2. the header and footer: the new pages' own (hub/page-chrome.js and hub/nav.js draw the five menus)
//   3. js/navigation.js, js/dark-mode-toggle.js and js/mobile-menu.js are not loaded (the new header does their
//      jobs); js/glossary.js, which navigation.js used to load, is loaded the same way at the same moment
//   4. the old seven-step bar gives way to a line that says where this sits in Build a deal
//   5. a trail back to Build a deal above the heading
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'market-analysis.html';
const TARGET = 'deal-market-analysis.html';

// The new pages' sheets a page outside the hubs needs for the header, menu, footer and base type (as the place profiles load them).
const HUB_SHEETS = ['shell.css', 'visual-pass.css', 'templates.css', 'look.css'];
const DROPPED_SCRIPTS = ['js/navigation.js', 'js/dark-mode-toggle.js', 'js/mobile-menu.js'];

// js/navigation.js added js/glossary.js to the end of the body at the moment it ran. An inline module runs in the
// same turn a deferred script would, so the glossary starts at the same moment, under the same id, as on the old page.
const GLOSSARY = '  <script type="module">/* The glossary, loaded as js/navigation.js loaded it. */\n' +
  '  if (!document.getElementById(\'glossary-script\')) { const gs = document.createElement(\'script\'); gs.id = \'glossary-script\'; gs.src = \'js/glossary.js\'; document.body.appendChild(gs); }</script>\n';

function must(cond, what) { if (!cond) throw new Error('build-market-analysis-hub: ' + SOURCE + ' ' + what); }

// The new pages' header and footer, word for word as scripts/build-port.js writes them on a hub page.
function chromeFrom(hubPage) {
  const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(hubPage);
  const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(hubPage);
  if (!header || !footer) throw new Error('build-market-analysis-hub: deal-hub.html no longer carries the header and footer the way this reads them');
  return { header: header[0], footer: footer[0] };
}

// The new pages write their small print (menu headings, footer lines, the trail) in the palette's --muted. The tool's
// own theme uses that same name for its secondary text, and on this page it has to keep doing so. So the header,
// footer and trail get the palette's own value back, read from hub/palette.css when the page is built: light, and
// dark both ways the palette switches (the system setting, and the site's own toggle).
function chromeMuted(palette) {
  const cut = palette.indexOf('@media screen and (prefers-color-scheme: dark)');
  const light = /--muted:\s*([^;]+);/.exec(palette.slice(0, cut));
  const dark = [...palette.slice(cut).matchAll(/--muted:\s*([^;]+);/g)].map(m => m[1].trim());
  if (cut < 0 || !light || dark.length !== 2 || dark[0] !== dark[1]) throw new Error('build-market-analysis-hub: hub/palette.css no longer sets --muted once for light and twice, alike, for dark');
  const where = ':is(.skip-link, .site-header, .site-footer, .crumbs)';
  return '  <style>/* The header, footer and trail keep the new pages\' small-print colour (hub/palette.css, read at build). */\n' +
    '  ' + where + ' { --muted: ' + light[1].trim() + '; }\n' +
    '  @media screen and (prefers-color-scheme: dark) { :root:not(.light-mode) ' + where + ' { --muted: ' + dark[0] + '; } }\n' +
    '  @media screen { :root.dark-mode ' + where + ' { --muted: ' + dark[0] + '; } }</style>\n';
}

export function build(src, hubPage, palette) {
  const chrome = chromeFrom(hubPage);
  let out = src;
  const swap = (re, to, what) => { must(re.test(out), 'no longer has ' + what); out = out.replace(re, to); };

  // 1. Head.
  swap(/<title>[^<]*<\/title>/, '<title>Market Analysis · COHO Analytics</title>', 'a title');
  must(!/rel="canonical"/.test(out), 'now names a canonical address; decide which page owns it');
  swap(/(<meta name="description"[^>]*>)/, '$1\n  <link rel="canonical" href="https://cohoanalytics.com/' + TARGET + '">\n  <meta name="robots" content="noindex, follow">', 'a description');
  swap(/<head>/, '<head>\n  <!-- Built from ' + SOURCE + ' by scripts/build-market-analysis-hub.mjs. Do not edit by hand: change ' + SOURCE + ' or the script, then run it. -->\n' +
    '  <script>/* Light or dark, before the page paints (the site\'s own key and classes). */\n' +
    '  try { var s = localStorage.getItem(\'coho-analytics-scheme\'); if (s === \'dark\' || s === \'light\') document.documentElement.classList.add(s + \'-mode\'); } catch (e) {}</script>', 'a head');
  // The new look goes after the page's own sheets, so it wins where both speak.
  const lastSheet = out.lastIndexOf('<link rel="stylesheet"', out.indexOf('</head>'));
  must(lastSheet > 0, 'no longer lists stylesheets in its head');
  const lineEnd = out.indexOf('\n', lastSheet);
  out = out.slice(0, lineEnd + 1) +
    '  <link rel="stylesheet" href="hub/palette.css">\n' +
    '  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap">\n' +
    // The new pages' sheets go in a cascade layer. A layered rule gives way to every unlayered one, so the tool's own
    // sheets keep deciding the tool's layout however the new pages' sheets change later, and
    // css/pages/market-analysis-hub.css hands the header, menu and footer back to this layer alone.
    '  <style>' + HUB_SHEETS.map(f => '@import url("hub/' + f + '") layer(hub);').join(' ') + '</style>\n' +
    '  <link rel="stylesheet" href="css/pages/market-analysis-hub.css">\n' +
    chromeMuted(palette) +
    out.slice(lineEnd + 1);

  // 2. Header and footer.
  swap(/<header class="site-header">[\s\S]*?<\/header>/, chrome.header, 'the header navigation.js fills');
  swap(/<footer id="site-footer"><\/footer>/, chrome.footer, 'the footer navigation.js fills');
  swap(/<body([^>]*)>/, '<body$1 data-menu="deal" class="tool-page">', 'a body');

  // 3. Scripts the new header replaces.
  DROPPED_SCRIPTS.forEach(f => {
    const re = new RegExp('[ \\t]*<script defer src="' + f.replace(/[.\/]/g, '\\$&') + '"></script>\\n');
    swap(re, f === 'js/navigation.js' ? GLOSSARY : '', 'a deferred ' + f);
  });
  swap(/<\/body>/, '<script src="hub/lab-config.js"></script>\n<script src="hub/page-chrome.js"></script>\n<script src="hub/nav.js"></script>\n</body>', 'a closing body tag');

  // 4. The old seven-step bar. Its links are kept, as one line under the heading (no link is lost).
  const bar = /[ \t]*<!-- Workflow progress bar[\s\S]*?<div class="wf-progress-wrap" id="maWorkflowProgress">[\s\S]*?\n  <\/div>\n/.exec(out);
  must(bar, 'no longer has the seven-step bar');
  const steps = [...bar[0].matchAll(/<a class="wf-step" href="([^"]+)"[^>]*>\s*<span class="wf-step__num">\d<\/span>\s*<span class="wf-step__label">([^<]+)<\/span>/g)].map(m => ({ href: m[1], label: m[2] }));
  must(steps.length === 6, 'seven-step bar no longer has six links and this page');
  out = out.replace(bar[0], '');

  // 5. Where the page sits (the new pages' trail), and the old bar's six links as one line under the opening words.
  const trail = '<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="index.html">Home</a></li><li><a href="deal-hub.html#/projects">Build a deal</a></li><li><a href="deal-hub.html#/market">Market check</a></li><li><span aria-current="page">Market Analysis</span></li></ol></nav>\n';
  const stepLine = '<p class="tool-steps"><span>Other steps</span> ' + steps.map(s => '<a href="' + s.href + '">' + s.label + '</a>').join(' ') + '</p>\n';
  swap(/(<main id="main-content">\n)/, '$1    ' + trail, 'a main');
  swap(/(<p class="pma-intro-text">[\s\S]*?<\/p>\n)/, '$1      ' + stepLine, 'its opening paragraph');

  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = build(fs.readFileSync(path.join(root, SOURCE), 'utf8'), fs.readFileSync(path.join(root, 'deal-hub.html'), 'utf8'), fs.readFileSync(path.join(root, 'hub/palette.css'), 'utf8'));
  const file = path.join(root, TARGET);
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === fresh;
    console.log(TARGET + (same ? ': up to date' : ': OUT OF DATE, run node scripts/build-market-analysis-hub.mjs'));
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(file, fresh);
  console.log('wrote ' + TARGET + ' (' + fresh.length + ' characters) from ' + SOURCE);
}
