const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const themeCss = fs.readFileSync(path.join(ROOT, 'css', 'site-theme.css'), 'utf8');
const hnaCss = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    console.error('FAIL', name);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

test('homepage data vintage badge clamps and wraps on narrow screens', () => {
  assert(themeCss.includes('.data-vintage-badge'), 'data vintage badge rule exists');
  assert(themeCss.includes('box-sizing: border-box;'), 'badge uses border-box sizing');
  assert(themeCss.includes('min-width: 0;'), 'badge can shrink inside narrow containers');
  assert(themeCss.includes('max-width: 100%;'), 'badge is capped to its parent width');
  assert(themeCss.includes('white-space: normal;'), 'badge text can wrap');
  assert(themeCss.includes('overflow-wrap: anywhere;'), 'badge long text can break before overflowing');
  assert(themeCss.includes('max-width: calc(100vw - 24px);'), 'badge is clamped to the 375px viewport gutter');
});

test('HNA mobile containment keeps generated tables inside chart cards', () => {
  assert(hnaCss.includes('@media (max-width: 767px)'), 'HNA mobile breakpoint exists');
  assert(hnaCss.includes('#main-content .chart-card'), 'chart-card containment is scoped to HNA main content');
  assert(hnaCss.includes('overflow-x: clip;'), 'chart cards clip accidental horizontal bleed');
  assert(hnaCss.includes('#main-content .chart-card > div[style*="overflow-x:auto"]'), 'generated inline overflow wrappers are contained');
  assert(hnaCss.includes('#main-content .chart-card table:not(.no-mobile-scroll)'), 'generated chart-card tables are targeted');
  assert(hnaCss.includes('#main-content #decadeAffordRatioTable'), 'decade affordability ratio table is targeted');
  assert(hnaCss.includes('#main-content .hnp-table'), 'housing need projection table is targeted');
  assert(hnaCss.includes('min-width: 100% !important;'), 'HNA tables override the global 540px mobile min-width');
  assert(hnaCss.includes('max-width: 100% !important;'), 'HNA tables cannot expand past their card');
  assert(hnaCss.includes('table-layout: auto;'), 'HNA tables keep natural columns while fitting the card');
});

/* ── Measured mobile defects on housing-needs-assessment.html (2026-09-12) ──
   At 390px: the six-step workflow bar clipped step 6 with no way to reach it,
   and 14 interactive controls measured under 24x24 — both verified in a real
   browser before and after the fix. These assertions pin the rules that fixed
   them; the runtime axe job covers the rendered result. */

test('the workflow progress bar scrolls on narrow screens instead of clipping a step', () => {
  // .wf-progress-wrap is overflow-x: hidden in site-theme.css, and six steps
  // do not fit in 390px — step 6 was simply cut off, on the component that
  // tells a user where they are in the flow.
  assert(hnaCss.includes('.wf-progress-steps'), 'the step list is targeted');
  const m = /@media \(max-width: 720px\)[\s\S]{0,900}?\.wf-progress-steps/.exec(hnaCss);
  assert(m, 'the scroll override is inside a narrow-screen media query');
  const block = hnaCss.slice(m.index, m.index + 1200);
  assert(/overflow-x:\s*auto/.test(block), 'the wrap scrolls rather than clipping');
  assert(/width:\s*max-content/.test(block), 'the step list is allowed to exceed the viewport so it can scroll');
});

test('checkbox targets meet the WCAG 2.5.8 minimum of 24x24', () => {
  const m = /#combineGeosToggle\s*\{[\s\S]{0,220}?\}/.exec(hnaCss);
  assert(m, 'the shared checkbox target rule exists');
  const block = m[0];
  assert(/min-width:\s*24px/.test(block) && /min-height:\s*24px/.test(block),
    'targets are at least 24x24');
  // Applied at every pointer type: WCAG 2.5.8 exempts a user-agent default
  // size, and these are explicitly styled, so a mouse user must not be left
  // with the smaller target.
  const beforeRule = hnaCss.slice(Math.max(0, m.index - 400), m.index);
  assert(!/@media \(pointer: coarse\)[^{]*\{\s*$/.test(beforeRule),
    'the 24px floor is not scoped to touch only');
  // The superseded 20px override must not shrink them back.
  assert(!/checklist-item input\[type="checkbox"\]\s*\{\s*min-width:\s*20px/.test(hnaCss),
    'the old 20px override was removed');
});
