#!/usr/bin/env node
/**
 * F128 — Runtime contrast scanner. Uses Puppeteer to load every HTML
 * page in both light AND dark mode, walks every visible text node, and
 * fails if any rendered foreground/background pair scores below WCAG AA
 * (4.5:1 normal text, 3.0:1 large text).
 *
 * THIS IS THE GATE THE PROJECT SHOULD HAVE HAD FROM THE START.
 *
 * Why static gates aren't enough:
 *   - test:pill-contrast only checks predefined badge classes
 *   - test:inline-contrast only catches specific source patterns
 *   - Real bugs come from CASCADE — a perfectly-valid CSS rule gets
 *     a hardcoded color from a 3rd-party stylesheet (Leaflet, etc.) or
 *     the `strong { color: !important }` rule paints the wrong text on
 *     a class-set bg. Source-pattern gates can't see the rendered
 *     contrast.
 *
 * Usage:
 *   npm run test:runtime-contrast              # all pages, both modes
 *   npm run test:runtime-contrast -- index     # one page
 *   npm run test:runtime-contrast -- --light   # only light mode
 *
 * The scanner is also exported as window.__contrastScan() — paste it
 * into any preview/devtools console to get a snapshot for the page
 * currently loaded.
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const pageFilter = args.find(a => !a.startsWith('--'));
const onlyLight = args.includes('--light');
const onlyDark = args.includes('--dark');
const PORT = 8765;
const OUT_DIR = join(ROOT, 'audit-report', 'runtime-contrast');

// ─────────────────────────────────────────────────────────────────────
// Scanner function — serialized into the browser via Puppeteer.evaluate.
// Kept as a string so it can also be pasted into a devtools console as
// `window.__contrastScan()` for ad-hoc debugging.
// ─────────────────────────────────────────────────────────────────────
const SCANNER_FN = `function __contrastScan() {
  function srgb(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
  function L(rgb){return 0.2126*srgb(rgb[0])+0.7152*srgb(rgb[1])+0.0722*srgb(rgb[2])}
  function parseRGB(s){if(!s)return null;var m=s.match(/rgba?\\(([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s]+([\\d.]+))?/);return m?[+m[1],+m[2],+m[3],m[4]!==undefined?+m[4]:1]:null}
  function ratio(fg,bg){return ((Math.max(L(fg),L(bg))+0.05)/(Math.min(L(fg),L(bg))+0.05))}
  function getEffectiveBg(el){
    var cur=el;
    while(cur&&cur!==document.documentElement){
      var cs=getComputedStyle(cur);
      var bg=parseRGB(cs.backgroundColor);
      if(bg&&bg[3]>0.5)return bg;
      if(cs.backgroundImage&&cs.backgroundImage!=='none')return null;
      cur=cur.parentElement;
    }
    return parseRGB(getComputedStyle(document.body).backgroundColor)||[10,15,29,1];
  }
  var failures=[];
  var els=document.querySelectorAll('*');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(!el.textContent||!el.textContent.trim())continue;
    var hasDirectText=false;
    for(var j=0;j<el.childNodes.length;j++){
      if(el.childNodes[j].nodeType===3&&el.childNodes[j].textContent.trim()){hasDirectText=true;break}
    }
    if(!hasDirectText)continue;
    var rect=el.getBoundingClientRect();
    if(rect.width===0||rect.height===0)continue;
    var cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0')continue;
    /* F133 — walk ancestors to catch elements hidden by a closed <details>,
       a collapsed accordion, an inert ancestor, etc. Without this we were
       reporting contrast failures for anchors inside <details> sections
       that the user can't actually see — their getComputedStyle still
       returns a color (frozen from initial paint), but rect.* is 0 and
       parent display is none. */
    var anc=el.parentElement, hidden=false;
    while(anc&&anc!==document.documentElement){
      if(anc.tagName==='DETAILS'&&!anc.open){hidden=true;break}
      var acs=getComputedStyle(anc);
      if(acs.display==='none'||acs.visibility==='hidden'){hidden=true;break}
      anc=anc.parentElement;
    }
    if(hidden)continue;
    var fg=parseRGB(cs.color);
    if(!fg||fg[3]<0.5)continue;
    var bg=getEffectiveBg(el);
    if(!bg)continue;
    var r=ratio(fg,bg);
    var fontSize=parseFloat(cs.fontSize);
    var fontWeight=parseInt(cs.fontWeight,10)||400;
    var large=fontSize>=24||(fontSize>=18.66&&fontWeight>=700);
    var min=large?3.0:4.5;
    if(r<min){
      var selector=el.tagName;
      if(el.id)selector+='#'+el.id;
      if(el.className&&typeof el.className==='string'){
        var cls=el.className.split(' ').filter(Boolean).slice(0,2).join('.');
        if(cls)selector+='.'+cls;
      }
      failures.push({
        selector:selector,
        text:el.textContent.trim().slice(0,60),
        fg:cs.color,
        bg:'rgb('+bg.slice(0,3).join(',')+')',
        ratio:Number(r.toFixed(2)),
        threshold:min,
        large:large
      });
    }
  }
  return failures;
}
window.__contrastScan = __contrastScan;
__contrastScan();`;

// Helper: try to dynamically import puppeteer. If not installed, fall
// back to documenting how the user can run the in-browser version.
async function loadPuppeteer() {
  try {
    const m = await import('puppeteer');
    return m.default || m;
  } catch (e) {
    return null;
  }
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['http-server', '.', '-p', String(PORT), '-c', '60', '-g', '-b', '--silent'], {
      stdio: 'ignore',
      cwd: ROOT,
      detached: false
    });
    setTimeout(() => resolve(proc), 1500);
    proc.on('error', reject);
  });
}

function listPages() {
  const files = readdirSync(ROOT).filter(f => f.endsWith('.html'));
  if (pageFilter) {
    return files.filter(f => f.includes(pageFilter));
  }
  return files;
}

async function scanPage(browser, page, url, mode) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // Force theme
  await page.evaluate((m) => {
    document.documentElement.classList.remove('light-mode', 'dark-mode');
    document.documentElement.classList.add(m + '-mode');
  }, mode);
  // F133 — give the page longer to re-render after theme switch. The
  // contrast-guard.js theme-change re-scan fires via MutationObserver +
  // requestAnimationFrame which means the actual repaint happens at least
  // 16ms after class flip. 800ms was sometimes catching the page
  // mid-recompute and reporting stale `.contrast-guard-fixed` patches.
  // 1500ms is comfortably past the longest observed re-scan cycle.
  await new Promise(r => setTimeout(r, 1500));
  const failures = await page.evaluate(SCANNER_FN);
  return failures;
}

async function main() {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    console.log('⚠ puppeteer is not installed (npm install --save-dev puppeteer to enable headless runs).');
    console.log('');
    console.log('In-browser fallback: open the preview, paste this into devtools console:');
    console.log('');
    console.log('  ' + SCANNER_FN.split('\n').map(l => l.trim()).join(' '));
    console.log('');
    console.log('It will return an array of every visible text node whose contrast ratio');
    console.log('falls below WCAG AA (4.5:1 normal, 3.0:1 large). One snapshot per (page, mode).');
    process.exit(0);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log('Starting local server on port ' + PORT + '…');
  const server = await startServer();
  process.on('exit', () => { try { server.kill(); } catch (_) {} });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pages = listPages();
  const modes = onlyLight ? ['light'] : onlyDark ? ['dark'] : ['light', 'dark'];
  const totals = { pages: 0, scans: 0, failures: 0 };
  const report = {};

  for (const p of pages) {
    const url = 'http://localhost:' + PORT + '/' + p;
    report[p] = {};
    totals.pages++;
    for (const mode of modes) {
      process.stdout.write('  ' + p + ' [' + mode + ']…');
      try {
        const failures = await scanPage(browser, page, url, mode);
        report[p][mode] = failures;
        totals.scans++;
        totals.failures += failures.length;
        process.stdout.write(' ' + failures.length + ' failures\n');
      } catch (e) {
        process.stdout.write(' ERROR: ' + e.message + '\n');
        report[p][mode] = { error: e.message };
      }
    }
  }

  await browser.close();
  try { server.kill(); } catch (_) {}

  const reportPath = join(OUT_DIR, 'report-' + Date.now() + '.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\nReport written: ' + reportPath);
  console.log('Pages scanned: ' + totals.pages + ' · Mode-scans: ' + totals.scans + ' · Total contrast failures: ' + totals.failures);

  if (totals.failures > 0) {
    console.log('\n✗ Site has visible contrast failures. See report for per-page, per-mode breakdown.');
    process.exit(1);
  }
  console.log('✓ No contrast failures site-wide. Every visible text passes WCAG AA in both modes.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
