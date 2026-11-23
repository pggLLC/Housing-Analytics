// Member pages: a glossary pop-up stays closed until its term is hovered or focused.
//
// js/glossary.js wraps a term as <abbr class="gl-tooltip-trigger"><span class="gl-tooltip-popup">, and hides
// the pop-up with `.gl-tooltip-popup { display: none }` until :hover or :focus. On 22 Nov 2026 the member
// home's tool cards showed the CHFA pop-up all the time, because css/member-chrome.css had
// `body.member-page .ib-quick-link span { display: block }`, which outranks that rule.
//
// This test checks the behaviour, not a spelling: it renders member markup with css/member-chrome.css and
// glossary.js's own pop-up rules in a real browser, and requires every pop-up to compute display:none while
// nothing is hovered. It then re-runs the same check with selectors that bring the bug back in other forms
// (the original rule, `:is(span)`, `:where(span)`, a direct `.gl-tooltip-popup` rule) and requires each to fail.
//
// Run: node test/member-chrome-popups.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memberCss = fs.readFileSync(path.join(ROOT, 'css/member-chrome.css'), 'utf8');

// glossary.js's pop-up rules, as it injects them.
const glossarySrc = fs.readFileSync(path.join(ROOT, 'js/glossary.js'), 'utf8');
const glossaryCss = [...glossarySrc.matchAll(/'(\.gl-tooltip-[^']*)'/g)].map((m) => m[1]).join('\n');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
check(/\.gl-tooltip-popup\s*\{[^}]*display\s*:\s*none/.test(glossaryCss), 'read glossary.js pop-up rules (hidden by default)');

const popup = (term) => `<abbr class="gl-tooltip-trigger" tabindex="0" data-glossary-term="${term}">${term}` +
  `<span class="gl-tooltip-popup" aria-hidden="true"><strong>${term} in full</strong>Definition text.</span></abbr>`;

// Member markup where pop-ups appear: tool cards (title and description), stats, prose.
const body = `
<a class="skip-link" href="#main">Skip</a>
<header class="site-header"><nav id="devNav" class="ib-section-nav"><a href="#">Home</a></nav></header>
<main id="main" class="ib-main">
  <div class="ib-section-card"><h2>Open in another tool</h2>
    <div class="ib-quick-links">
      <a class="ib-quick-link" href="#"><strong>Market area and ${popup('capture rate')} brief</strong>
        <span>How drawing the market area changes ${popup('CHFA')}'s capture rate</span></a>
      <a class="ib-quick-link" href="#"><strong>Next round watch</strong><span>Deals likely to apply</span></a>
    </div>
  </div>
  <div class="ib-stat"><span>In the pipeline ${popup('LIHTC')}</span></div>
  <p>Prose with ${popup('AMI')} in it. <span>A span with ${popup('QAP')}</span></p>
</main>
<footer class="site-footer"><p class="footer-terms">Terms</p></footer>`;

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function render(extraCss) {
  await page.setContent(`<!doctype html><html><head><style>${glossaryCss}</style><style>${memberCss}${extraCss}</style>` +
    `</head><body class="member-page">${body}</body></html>`);
  await page.mouse.move(1270, 890); // nothing hovered
  return page.evaluate(() => ({
    popups: [...document.querySelectorAll('.gl-tooltip-popup')].map((p) => getComputedStyle(p).display),
    cardDesc: getComputedStyle(document.querySelector('.ib-quick-link > span')).display,
  }));
}

const base = await render('');
check(base.popups.length === 5, 'rendered ' + base.popups.length + ' glossary pop-ups in member markup');
check(base.popups.every((d) => d === 'none'), 'every pop-up is closed while nothing is hovered (' + base.popups.join(', ') + ')');
check(base.cardDesc === 'block', 'the tool card description still shows on its own line (display: ' + base.cardDesc + ')');

// Each of these brings the 22 Nov bug back in another spelling; the check above must catch every one.
const MUTATIONS = [
  'body.member-page .ib-quick-link span { display: block; }',
  'body.member-page .ib-quick-link :is(span) { display: block; }',
  'body.member-page .ib-quick-link :where(span) { display: block; }',
  'body.member-page .gl-tooltip-popup { display: block; }',
];
for (const css of MUTATIONS) {
  const r = await render('\n' + css);
  check(r.popups.some((d) => d !== 'none'), 'the check catches: ' + css);
}

await browser.close();
if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All member chrome pop-up checks passed');
