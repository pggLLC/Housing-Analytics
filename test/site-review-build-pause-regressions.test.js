#!/usr/bin/env node
// Guards for the 2026-07-20 build-pause M2/M4/M3 review findings.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { contrastRatio, parseCssColor, blendOver } = require('../scripts/audit/contrast-utils.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const siteTheme = read('css/site-theme.css');

function declarationsFromBlock(block) {
  const out = {};
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  clean.replace(/--([\w-]+)\s*:\s*([^;]+);/g, (_, name, value) => {
    out[`--${name}`] = value.trim();
    return _;
  });
  return out;
}

function rootBlockFor(mode) {
  if (mode === 'dark') {
    const dark = siteTheme.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\s*\}/);
    assert.ok(dark, 'dark-mode token block is present');
    return dark[1];
  }
  const light = siteTheme.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(light, 'light-mode token block is present');
  return light[1];
}

function varsFor(mode) {
  return declarationsFromBlock(rootBlockFor(mode));
}

function splitVarArgs(contents) {
  let depth = 0;
  for (let i = 0; i < contents.length; i += 1) {
    const ch = contents[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      return [contents.slice(0, i).trim(), contents.slice(i + 1).trim()];
    }
  }
  return [contents.trim(), ''];
}

function resolveOneVar(value, vars) {
  const start = value.indexOf('var(');
  if (start < 0) return value;
  let depth = 0;
  let end = -1;
  for (let i = start; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > start, `CSS var expression is balanced: ${value}`);
  const [name, fallback] = splitVarArgs(value.slice(start + 4, end));
  const replacement = vars[name] || fallback;
  return value.slice(0, start) + replacement + value.slice(end + 1);
}

function resolveCss(raw, vars) {
  let value = String(raw || '').replace(/!important/g, '').trim();
  for (let i = 0; i < 8 && value.includes('var('); i += 1) {
    value = resolveOneVar(value, vars).trim();
  }
  return value;
}

function color(raw, mode, baseRaw) {
  const vars = varsFor(mode);
  const resolved = resolveCss(raw, vars);
  const parsed = parseCssColor(resolved);
  assert.ok(parsed, `resolved ${raw} in ${mode} mode to a parseable color (${resolved})`);
  if (parsed.a < 1) {
    const base = baseRaw ? color(baseRaw, mode) : color('var(--card)', mode);
    return blendOver(parsed, base);
  }
  return parsed;
}

function contrastFor(fgRaw, bgRaw, mode) {
  const bg = color(bgRaw, mode);
  const fgParsed = parseCssColor(resolveCss(fgRaw, varsFor(mode)));
  assert.ok(fgParsed, `resolved ${fgRaw} in ${mode} mode to a parseable foreground`);
  const fg = fgParsed.a < 1 ? blendOver(fgParsed, bg) : fgParsed;
  return contrastRatio(fg, bg);
}

function assertContrast(name, fgRaw, bgRaw, options) {
  const threshold = options && options.large ? 3 : 4.5;
  const modes = options && options.modes ? options.modes : ['light', 'dark'];
  modes.forEach((mode) => {
    const ratio = contrastFor(fgRaw, bgRaw, mode);
    assert.ok(ratio >= threshold,
      `${name} ${mode} contrast ${ratio.toFixed(2)}:1 clears ${threshold}:1`);
  });
}

function cssBlock(source, selector, label, occurrence) {
  let cursor = -1;
  let found = -1;
  const limit = occurrence == null ? Infinity : occurrence;
  for (let i = 0; i < limit; i += 1) {
    found = source.indexOf(selector, cursor + 1);
    if (found < 0) break;
    cursor = found;
    if (occurrence == null) {
      const next = source.indexOf(selector, cursor + 1);
      if (next < 0) break;
    }
  }
  if (occurrence == null) {
    let next;
    while ((next = source.indexOf(selector, cursor + 1)) >= 0) cursor = next;
    found = cursor;
  }
  assert.ok(found >= 0, `${label || selector} rule is present`);
  const open = source.indexOf('{', found);
  const close = source.indexOf('}', open);
  assert.ok(open > found && close > open, `${label || selector} rule has declarations`);
  return source.slice(open + 1, close);
}

function cssProp(source, selector, prop, label, occurrence) {
  const block = cssBlock(source, selector, label, occurrence);
  const re = new RegExp(`${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`);
  const match = block.match(re);
  assert.ok(match, `${label || selector} declares ${prop}`);
  return match[1].trim();
}

function inlineStyleProp(source, id, prop) {
  const re = new RegExp(`id=["']${id}["'][^>]*style=["']([^"']+)["']`);
  const match = source.match(re);
  assert.ok(match, `${id} inline style is present`);
  const decl = match[1].match(new RegExp(`${prop}\\s*:\\s*([^;]+)`));
  assert.ok(decl, `${id} inline style declares ${prop}`);
  return decl[1].trim();
}

const census = read('census-dashboard.html');
const mfStatBg = cssProp(census, '.mf-stat {', 'background', 'census multifamily stat card');
assertContrast('census multifamily stat label', cssProp(census, '.mf-stat__label {', 'color'), mfStatBg);
assertContrast('census multifamily stat value', cssProp(census, '.mf-stat__value {', 'color'), mfStatBg, { large: true });
assert.doesNotMatch(census, /\.mf-stat__(?:label|sub)\s*\{[^}]*opacity\s*:/s, 'census multifamily stat text no longer relies on opacity-thinned inherited color');

const economic = read('economic-dashboard.html');
assert.doesNotMatch(economic, /id="yardiNational"[^>]*color:var\(--muted\)/, 'Yardi national callout is not muted in light mode');
assertContrast('Yardi national callout', inlineStyleProp(economic, 'yardiNational', 'color'), inlineStyleProp(economic, 'yardiNational', 'background'));
const yardiLowGrowth = economic.match(/asking_rent_yoy_pct\s*<\s*1\s*\?\s*'([^']+)'/);
assert.ok(yardiLowGrowth, 'Yardi low-growth warning color branch is present');
assertContrast('Yardi low-growth warning value', yardiLowGrowth[1], 'var(--surface-2)', { modes: ['light'] });

const insights = read('insights.html');
assert.doesNotMatch(insights, /id="jchsCoNarrative"[^>]*color:var\(--muted\)/, 'JCHS narrative block is not muted in light mode');
assertContrast('JCHS narrative callout', inlineStyleProp(insights, 'jchsCoNarrative', 'color'), inlineStyleProp(insights, 'jchsCoNarrative', 'background'));

const complianceCss = read('css/pages/compliance-dashboard.css');
assertContrast('compliance green KPI value', cssProp(complianceCss, 'html.light-mode .cd-kpi-green  .cd-kpi-value', 'color'), 'var(--card)', { modes: ['light'] });
assertContrast('compliance yellow KPI value', cssProp(complianceCss, 'html.light-mode .cd-kpi-yellow .cd-kpi-value', 'color'), 'var(--card)', { modes: ['light'] });
assertContrast('compliance red KPI value', cssProp(complianceCss, 'html.light-mode .cd-kpi-red    .cd-kpi-value', 'color'), 'var(--card)', { modes: ['light'] });
assertContrast('compliance green KPI value', cssProp(complianceCss, '.cd-kpi-green  .cd-kpi-value', 'color'), 'var(--card)', { modes: ['dark'] });
assertContrast('compliance yellow KPI value', cssProp(complianceCss, '.cd-kpi-yellow .cd-kpi-value', 'color'), 'var(--card)', { modes: ['dark'] });
assertContrast('compliance red KPI value', cssProp(complianceCss, '.cd-kpi-red    .cd-kpi-value', 'color'), 'var(--card)', { modes: ['dark'] });

const pagesCss = read('css/pages.css');
assertContrast('shared kicker', cssProp(pagesCss, 'html.light-mode .kicker', 'color'), cssProp(pagesCss, 'html.light-mode .kicker', 'background'), { modes: ['light'] });
assertContrast('shared kicker', cssProp(siteTheme, 'html.dark-mode .kicker', 'color'), cssProp(pagesCss, '.kicker {', 'background', 'shared pages kicker', 1), { modes: ['dark'] });
assertContrast('shared green tag', cssProp(pagesCss, 'html.light-mode .tag-green', 'color'), cssProp(pagesCss, 'html.light-mode .tag-green', 'background'), { modes: ['light'] });
assertContrast('shared green tag', cssProp(pagesCss, '.tag-green', 'color'), cssProp(pagesCss, '.tag-green', 'background'), { modes: ['dark'] });

const hnaRenderers = read('js/hna/hna-renderers.js');
const overlayStyle = hnaRenderers.match(/background:([^;']+);[^']*color:([^;']+);font-weight:600/);
assert.ok(overlayStyle, 'HNA chart loading overlay declares a foreground/background pair');
assertContrast('HNA chart loading overlay', overlayStyle[2], overlayStyle[1]);

assertContrast('Leaflet zoom controls', cssProp(siteTheme, '.leaflet-control-zoom a, .leaflet-control-zoom a:hover', 'color'), cssProp(siteTheme, '.leaflet-control-zoom a, .leaflet-control-zoom a:hover', 'background'));
assertContrast('Leaflet generic controls', cssProp(siteTheme, '.leaflet-control-layers,', 'color'), cssProp(siteTheme, '.leaflet-control-layers,', 'background'));
assertContrast('site-theme green tag', cssProp(siteTheme, 'html.light-mode .tag.tag-green', 'color'), cssProp(siteTheme, 'html.light-mode .tag.tag-green', 'background'), { modes: ['light'] });
assertContrast('site-theme green tag', cssProp(siteTheme, '.tag.tag-green', 'color'), cssProp(siteTheme, '.tag.tag-green', 'background'), { modes: ['dark'] });
assertContrast('site-theme kicker', cssProp(siteTheme, 'html.light-mode .kicker', 'color'), cssProp(siteTheme, 'html.light-mode .kicker', 'background'), { modes: ['light'] });
assertContrast('site-theme kicker', cssProp(siteTheme, 'html.dark-mode .kicker', 'color'), cssProp(pagesCss, '.kicker {', 'background', 'shared pages kicker', 1), { modes: ['dark'] });

const fetchErrorSurface = read('js/components/fetch-error-surface.js');
const fetchWarn = fetchErrorSurface.match(/warn:\s*\{\s*bg:\s*'([^']+)'\s*,\s*fg:\s*'([^']+)'/);
assert.ok(fetchWarn, 'fetch-error warn style declares a foreground/background pair');
assertContrast('fetch-error warning surface', fetchWarn[2], fetchWarn[1]);

const hca = read('hna-comparative-analysis.html');
assertContrast('HCA explore banner link', cssProp(hca, '.hca-explore-banner__link', 'color', 'HCA explore banner link', 1), 'var(--bg2)');

const contrastGuard = read('js/contrast-guard.js');
assert.ok(contrastGuard.includes('.kicker, .tag, .chart-source, .chart-source *, .fes-error, .fes-error *'), 'contrast guard leaves explicitly theme-styled kicker/tag/source/error badges alone');

const legislationDom = new JSDOM(read('housing-legislation-2026.html'));
const watchlist = legislationDom.window.document.getElementById('bill-status-cards');
assert.equal(watchlist.getAttribute('role'), 'list', 'watchlist container remains a role=list');
assert.ok(Array.from(watchlist.children).every((child) => child.getAttribute('role') === 'listitem'), 'watchlist placeholder satisfies aria-required-children before hydration');

const privateRuntimePaths = [
  'DATA-MANIFEST.json',
  'data/audit/quarantine-candidates.json',
  'config/data-discovery-config.json'
];
for (const rel of ['js/discovery-ui-handler.js', 'js/data-source-discovery.js', 'js/data-freshness-monitor.js']) {
  const src = read(rel);
  for (const privatePath of privateRuntimePaths) {
    assert.ok(!src.includes(privatePath), `${rel} does not request maintainer-only ${privatePath}`);
  }
}

const hub = read('data-review-hub.html');
assert.ok(!/href="(?:DATA-MANIFEST\.json|config\/data-discovery-config\.json)"/.test(hub), 'Data Trust Center public HTML does not link stripped maintainer-only artifacts');

const buildScript = read('scripts/build-public-site.mjs');
assert.ok(!/SERVED_LINK_GUARD_EXEMPT_PATHS[\s\S]*?DATA-MANIFEST\.json/.test(buildScript), 'public build served-link guard does not exempt DATA-MANIFEST.json');
assert.ok(!/SERVED_LINK_GUARD_EXEMPT_PATHS[\s\S]*?data-discovery-config\.json/.test(buildScript), 'public build served-link guard does not exempt discovery config');

console.log('Build-pause M2/M4/M3 regression guards: PASS');
