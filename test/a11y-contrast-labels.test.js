const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const siteTheme = read('css/site-theme.css');
const scenarioBuilder = read('css/scenario-builder.css');
const landValueTool = read('js/components/land-value-tool.js');
const pipelineAddButton = read('js/components/pipeline-add-button.js');
const developerHtml = read('developer.html');
const developerBrief = read('developer-brief.html');
const dataSourcesUi = read('dashboard-data-sources-ui.html');

const lvtBandRule = siteTheme.match(/\.lvt-band-bar\s*\{[^}]*\}/);
assert(lvtBandRule, 'site theme defines .lvt-band-bar');
assert(!/color\s*:\s*#fff\b/i.test(lvtBandRule[0]), '.lvt-band-bar no longer hard-codes white text');

assert(/color\.indexOf\('--bad'\)[\s\S]*var\(--on-bad\)/.test(landValueTool), 'land-value bad band uses --on-bad');
assert(/color\.indexOf\('--warn'\)[\s\S]*var\(--on-warn\)/.test(landValueTool), 'land-value warn band uses --on-warn');
assert(/color\.indexOf\('--accent'\)[\s\S]*var\(--on-accent\)/.test(landValueTool), 'land-value accent band uses --on-accent');
assert(/color\.indexOf\('--good'\)[\s\S]*var\(--on-good\)/.test(landValueTool), 'land-value good band uses --on-good');
assert(/style="[^"]*background:[^"]*\+ color \+[^"]*color:[^"]*\+ onColor \+/.test(landValueTool), 'land-value band bar writes paired background and on-token color');

const dangerHoverRule = scenarioBuilder.match(/\.btn-danger:hover\s*\{[^}]*\}/);
assert(dangerHoverRule, 'scenario builder defines .btn-danger:hover');
assert(/background\s*:\s*var\(--bad\)/.test(dangerHoverRule[0]), 'danger hover still uses --bad background');
assert(!/color\s*:\s*#fff\b/i.test(dangerHoverRule[0]), 'danger hover no longer uses white on --bad');
assert(/color\s*:\s*var\(--on-bad\)/.test(dangerHoverRule[0]), 'danger hover uses --on-bad');

const skippedHoverRule = siteTheme.match(/\.wf-next-action--skipped \.wf-next-action__cta:hover\s*\{[^}]*\}/);
assert(skippedHoverRule, 'site theme defines skipped next-action hover');
assert(!/color\s*:\s*#fff\b/i.test(skippedHoverRule[0]), 'skipped next-action hover no longer uses white text');
assert(/color\s*:\s*var\(--on-warn\)/.test(skippedHoverRule[0]), 'skipped next-action hover uses --on-warn');

const formLabels = [...pipelineAddButton.matchAll(/<label class="pab-form__label"([^>]*)>/g)];
assert(formLabels.length >= 10, 'pipeline add form labels are present');
const labelsWithoutFor = formLabels.filter((match) => !/\bfor=/.test(match[1]));
assert.equal(labelsWithoutFor.length, 0, 'every pipeline add form label has a for attribute');

for (const name of ['stage', 'confidence', 'classification']) {
  assert(new RegExp(`selectHtml\\('${name}'[\\s\\S]*'${name.replace(/^./, (c) => c.toUpperCase())}'`).test(pipelineAddButton), `${name} select passes an aria label`);
  assert(new RegExp(`id="\\s*' \\+ fieldId\\(name\\) \\+ '\\s*"`).test(pipelineAddButton) || pipelineAddButton.includes('id="\' + fieldId(name) + \'"'), 'selectHtml writes an id');
}

assert(/<label[^>]+for="pri-text"[^>]*>/.test(developerHtml), 'developer priorities textarea has a visible label');
assert(/<textarea[^>]+id="pri-text"/.test(developerHtml), 'developer priorities textarea retains id');

assert(/aria-label="Open source in new tab">↗<\/a>/.test(developerBrief), 'developer brief injected arrow link has an accessible name');
assert(/aria-label="Open source">🔗<\/a>/.test(dataSourcesUi), 'dashboard data-source link icon has an accessible name');

console.log('a11y-contrast-labels: PASS');
