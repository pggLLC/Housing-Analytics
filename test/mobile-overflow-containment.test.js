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
