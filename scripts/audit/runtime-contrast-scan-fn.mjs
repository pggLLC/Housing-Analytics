/**
 * The in-page half of scripts/audit/runtime-contrast-scanner.mjs: the scanner
 * that runs inside each page, and the walk through the page's tabs. Split out
 * so test/runtime-contrast-scanner-fixtures.test.mjs can run exactly what the
 * gate runs against fixtures with known ratios (#2038).
 */

// ─────────────────────────────────────────────────────────────────────
// Scanner function — serialized into the browser via Puppeteer.evaluate.
// Kept as a string so it can also be pasted into a devtools console as
// `window.__contrastScan()` for ad-hoc debugging.
// ─────────────────────────────────────────────────────────────────────
export const SCANNER_FN = `function __contrastScan() {
  function srgb(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
  function L(rgb){return 0.2126*srgb(rgb[0])+0.7152*srgb(rgb[1])+0.0722*srgb(rgb[2])}
  /* Computed colours are not always rgb(): color-mix() computes to oklab(...)
     and some colours come back as color(srgb ...). parseRGB used to read only
     rgb()/rgba(), so an oklab() background parsed as null and was skipped, and
     the text was measured against an ancestor instead: the HNA jurisdiction
     banner's links were scored against white, not their 3.25:1 tint (#2038).
     A 1x1 canvas converts any colour the browser accepts to sRGB, the same
     way scripts/contrast-audit/run.js does. */
  var probeCtx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  function parseRGB(s){
    if(!s)return null;
    var m=s.match(/^rgba?\\(([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\)$/);
    if(m)return [+m[1],+m[2],+m[3],m[4]!==undefined?+m[4]:1];
    if(!probeCtx)return null;
    probeCtx.clearRect(0,0,1,1);
    probeCtx.fillStyle='transparent';
    probeCtx.fillStyle=s;
    probeCtx.fillRect(0,0,1,1);
    var d=probeCtx.getImageData(0,0,1,1).data;
    return [d[0],d[1],d[2],d[3]/255];
  }
  function over(top,under){var a=top[3];return [top[0]*a+under[0]*(1-a),top[1]*a+under[1]*(1-a),top[2]*a+under[2]*(1-a),1]}
  function ratio(fg,bg){return ((Math.max(L(fg),L(bg))+0.05)/(Math.min(L(fg),L(bg))+0.05))}
  /* The background the text is actually drawn on: every translucent layer
     from the element up to <html>, composited over the white canvas. This
     used to skip any layer with alpha <= 0.5 and return the first one above
     it as if opaque, so a 10% tint was ignored and a 60% one was measured as
     solid. A background image or gradient cannot be measured this way, so the
     element is skipped, as before. */
  function getEffectiveBg(el){
    var layers=[];
    for(var cur=el;cur;cur=cur.parentElement){
      var cs=getComputedStyle(cur);
      var bg=parseRGB(cs.backgroundColor);
      if(bg&&bg[3]>0){layers.push(bg);if(bg[3]>=1)break}
      if(cs.backgroundImage&&cs.backgroundImage!=='none')return null;
    }
    var result=[255,255,255,1];
    for(var i=layers.length-1;i>=0;i--)result=over(layers[i],result);
    return [Math.round(result[0]),Math.round(result[1]),Math.round(result[2]),1];
  }
  var failures=[];
  /* How many text elements were actually measured, so a test can tell a scan
     that checked everything and found nothing from one that checked nothing. */
  var measured=0;
  var els=document.querySelectorAll('*');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(!el.textContent||!el.textContent.trim())continue;
    var hasDirectText=false;
    for(var j=0;j<el.childNodes.length;j++){
      if(el.childNodes[j].nodeType===3&&el.childNodes[j].textContent.trim()){hasDirectText=true;break}
    }
    if(!hasDirectText)continue;
    /* WCAG 1.4.3 exempts text in an inactive control and pure decoration.
       A disabled button (or aria-disabled) is the first; aria-hidden is how
       the site marks the second, e.g. the "·" separators. Same rule as
       scripts/contrast-audit/run.js, which skips aria-hidden. */
    if(el.closest('[aria-hidden="true"],:disabled,[aria-disabled="true"]'))continue;
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
    if(!fg||fg[3]<=0)continue;
    var bg=getEffectiveBg(el);
    if(!bg)continue;
    if(fg[3]<1)fg=over(fg,bg);
    measured++;
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
        state:window.__contrastScanState||'default',
        bg:'rgb('+bg.slice(0,3).join(',')+')',
        ratio:Number(r.toFixed(2)),
        threshold:min,
        large:large
      });
    }
  }
  window.__contrastScanMeasured=(window.__contrastScanMeasured||0)+measured;
  return failures;
}
window.__contrastScan = __contrastScan;
__contrastScan();`;

// #2038 — content in an inactive tab panel is display:none at load, so a
// scan of the page as loaded never measures it. "Western Slope" on
// colorado-deep-dive.html (2.9:1) sat in the Market Trends tab and passed this
// gate for that reason alone. After the default scan, open every tab the user
// could open and scan again: each pass clicks the first visible, unselected
// [role="tab"] not yet visited. aria-controls is not required: the six tabs on
// data-review-hub.html are wired by data-tab and have none. A tab that is a
// link to another page is skipped, so the walk never navigates away. Visited
// tabs are marked on the element itself, so two tabs with the same label or
// no id are still told apart. Tabs nested inside a panel become visible once
// their panel is open, so repeated passes reach them too.
const MAX_TAB_STATES = 40;
export function clickNextTab(visited) {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.hasAttribute('data-contrast-scan-visited')) continue;
    if (tab.getAttribute('aria-selected') === 'true') continue;
    if (tab.disabled || tab.getAttribute('aria-disabled') === 'true') continue;
    const href = tab.tagName === 'A' ? (tab.getAttribute('href') || '') : '';
    if (href && href.charAt(0) !== '#') continue;
    const r = tab.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const key = tab.id || tab.getAttribute('aria-controls') || tab.getAttribute('data-tab') || 'tab#' + i;
    if (visited.includes(key)) continue;
    tab.setAttribute('data-contrast-scan-visited', '');
    window.__contrastScanState = 'tab: ' + (tab.textContent || key).trim().slice(0, 40);
    tab.click();
    return key;
  }
  return null;
}

export function addFailures(seen, failures) {
  if (!Array.isArray(failures)) return;
  for (const f of failures) {
    const key = [f.selector, f.text, f.fg, f.bg].join('|');
    if (!seen.has(key)) seen.set(key, f);
  }
}

// Scan the page as it is now, then once per tab state. Returns the union
// of failures, de-duplicated.
export async function scanAllStates(page) {
  const seen = new Map();
  addFailures(seen, await page.evaluate(SCANNER_FN));
  const visited = [];
  for (let i = 0; i < MAX_TAB_STATES; i++) {
    const key = await page.evaluate(clickNextTab, visited);
    if (typeof key !== 'string') break;
    visited.push(key);
    await new Promise(r => setTimeout(r, 500));
    addFailures(seen, await page.evaluate(SCANNER_FN));
  }
  return [...seen.values()];
}
