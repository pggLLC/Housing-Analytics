/*!
 * js/deal-calculator-quick.js — Quick estimate panel for the Deal Calculator.
 *
 * paul 10-26 picked "panel now, full stays for now": a short panel at the top
 * of the public calculator that answers "could this deal pencil?" with county,
 * total development cost, the credit rate and homes by income limit, and shows
 * the annual credit, equity, first mortgage and funding gap.
 *
 * The panel does no math of its own. Each field writes the full calculator's
 * own input below it and each result is read back from the full calculator's
 * own output, after it recalculates ('deal-calc:updated'). So the panel and
 * the full calculator can never disagree, and a share link or deal file opens
 * both. The panel's controls (ids dq-) are not shared: they only mirror dc- ones.
 *
 * Total development cost: the full calculator needs its cost lines to add up to
 * the total. A total typed here scales every cost line by the same share, so the
 * split the lines had stays the same (the example budget's split until a user
 * itemizes their own).
 */
(function () {
  'use strict';

  // Credit-eligible income limits shown in the panel; 100% AMI and up stay in the full unit mix.
  var TIERS = [20, 30, 40, 50, 60, 70, 80];
  var OUTPUTS = [
    { id: 'dc-r-credits', label: 'Annual federal credit' },
    { id: 'dc-r-equity', label: 'Credit equity' },
    { id: 'dc-r-mortgage', label: 'First mortgage' },
    { id: 'dc-su-gap', label: 'Funding gap' }
  ];
  var COST_SUFFIXES = ['', '-eligible', '-used'];

  function $(id) { return document.getElementById(id); }
  function fire(el, types) { types.forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); }); }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : NaN; }

  // ── Total development cost: scale the cost lines to it ──────────────────
  function costInputs() {
    var host = $('dc-cost-lines');
    if (!host) return [];
    return Array.prototype.filter.call(host.querySelectorAll('input[type="number"][id^="dc-cost-"]'), function (el) {
      var base = el.id.replace(/-(eligible|used)$/, '');
      return COST_SUFFIXES.indexOf(el.id.slice(base.length)) !== -1;
    });
  }
  function amountInputs() { return costInputs().filter(function (el) { return !/-(eligible|used)$/.test(el.id); }); }
  function itemized() {
    return amountInputs().reduce(function (s, el) { var n = num(el.value); return s + (el.value !== '' && n > 0 ? n : 0); }, 0);
  }
  // Scales every cost line to `total`, keeping their shares; the rounding left over goes on the largest line
  // so the lines add up to the total exactly. Returns false when there are no lines to scale.
  function scaleCosts(total) {
    var from = itemized();
    if (!(from > 0) || !(total > 0)) return false;
    var k = total / from;
    costInputs().forEach(function (el) {
      if (el.value === '') return;
      var n = num(el.value);
      if (n >= 0) el.value = String(Math.round(n * k));
    });
    var lines = amountInputs().filter(function (el) { return el.value !== ''; });
    var left = Math.round(total) - itemized();
    if (left && lines.length) {
      var big = lines.reduce(function (a, b) { return num(b.value) > num(a.value) ? b : a; });
      big.value = String(num(big.value) + left);
    }
    return true;
  }

  // ── Mirrors ─────────────────────────────────────────────────────────────
  function tierFixed(pct) {
    // A bedroom split replaces the tier total, and a Market Analysis rent schedule replaces the grid.
    var rows = $('dc-ami-rows');
    if (!rows || rows.closest('[hidden]')) return 'The unit mix comes from your rent schedule. Change it in Unit mix below.';
    var split = Array.prototype.some.call(document.querySelectorAll('[id^="dc-units-' + pct + '-"]'), function (el) { return num(el.value) > 0; });
    return split ? 'Set by the bedroom split in Unit mix below.' : '';
  }
  function tierUnits(pct) {
    var chk = $('dc-chk-' + pct), total = $('dc-units-' + pct);
    if (!total || (chk && !chk.checked)) return 0;
    var split = Array.prototype.reduce.call(document.querySelectorAll('[id^="dc-units-' + pct + '-"]'), function (s, el) { var n = num(el.value); return s + (n > 0 ? n : 0); }, 0);
    return split > 0 ? split : (num(total.value) > 0 ? num(total.value) : 0);
  }

  function syncCounties() {
    var from = $('dc-county-select'), to = $('dq-county');
    if (!from || !to) return;
    if (to.options.length !== from.options.length) {
      to.innerHTML = '';
      Array.prototype.forEach.call(from.options, function (o) { to.appendChild(new Option(o.textContent, o.value)); });
    }
    to.value = from.value;
  }

  // Calculator → panel. A field the reader is typing in is left alone.
  function pull() {
    var active = document.activeElement;
    syncCounties();
    var tdc = $('dc-tdc'), q = $('dq-tdc');
    if (tdc && q && active !== q) q.value = tdc.value;
    var r4 = $('dc-rate-4');
    if (r4) { $('dq-rate-4').checked = r4.checked; $('dq-rate-9').checked = !r4.checked; }
    TIERS.forEach(function (pct) {
      var box = $('dq-units-' + pct);
      if (!box) return;
      var fixed = tierFixed(pct);
      box.disabled = !!fixed;
      box.title = fixed;
      if (active !== box) box.value = String(tierUnits(pct));
    });
    var homes = TIERS.reduce(function (s, pct) { return s + tierUnits(pct); }, 0);
    var note = $('dq-homes');
    if (note) note.textContent = homes + ' homes at these income limits';
    OUTPUTS.forEach(function (o) {
      var src = $(o.id), dst = $('dq-out-' + o.id);
      if (!dst) return;
      var text = src ? src.textContent.replace(/\s+/g, ' ').trim() : '';
      dst.textContent = text || '—';
      dst.classList.toggle('dq-unavailable', /^Unavailable\b/.test(text));
    });
  }

  // Panel → calculator.
  function push(e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'dq-county') {
      var c = $('dc-county-select');
      if (c) { c.value = t.value; fire(c, ['change']); }
    } else if (t.id === 'dq-tdc') {
      var total = num(t.value), tdc = $('dc-tdc');
      if (!tdc || !(total > 0)) return;
      scaleCosts(total);
      tdc.value = String(Math.round(total));
      fire(tdc, ['input', 'change']);
    } else if (t.id === 'dq-rate-9' || t.id === 'dq-rate-4') {
      var r = $(t.id === 'dq-rate-4' ? 'dc-rate-4' : 'dc-rate-9');
      if (r) { r.checked = true; fire(r, ['change']); }
    } else if (/^dq-units-\d+$/.test(t.id)) {
      var pct = t.id.slice('dq-units-'.length), units = $('dc-units-' + pct), chk = $('dc-chk-' + pct);
      var n = num(t.value);
      if (!units || !(n >= 0) || tierFixed(pct)) return;
      units.value = String(Math.round(n));
      if (chk && n > 0 && !chk.checked) { chk.checked = true; fire(chk, ['change']); }
      fire(units, ['input', 'change']);
    }
  }

  function render(host) {
    var field = 'min-height:44px;width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm,6px);background:var(--card);color:var(--text);font:inherit;';
    host.innerHTML =
      '<h2 id="dq-title" style="margin:0 0 .25rem;font-size:1.15rem;">Quick estimate</h2>' +
      '<p style="margin:0 0 .75rem;font-size:.88rem;color:var(--muted);">Start here. The full calculator below runs the same numbers, with costs, rents, loans and the 15-year pro forma.</p>' +
      '<div class="dq-grid">' +
        '<label class="dq-f">County<select id="dq-county" style="' + field + '"></select></label>' +
        '<label class="dq-f">Total development cost ($)<input id="dq-tdc" type="number" min="0" step="100000" inputmode="numeric" style="' + field + '"></label>' +
        '<fieldset class="dq-f" style="border:0;margin:0;padding:0;min-width:0;"><legend style="padding:0;font-weight:600;font-size:.9rem;">Credit</legend>' +
          '<div class="dq-rates"><label class="dq-radio"><input type="radio" name="dq-rate" id="dq-rate-9"> 9% competitive</label>' +
          '<label class="dq-radio"><input type="radio" name="dq-rate" id="dq-rate-4"> 4% with bonds</label></div></fieldset>' +
      '</div>' +
      '<fieldset style="border:0;margin:.75rem 0 0;padding:0;min-width:0;"><legend style="padding:0;font-weight:600;font-size:.9rem;">Homes by income limit (% of area median income)</legend>' +
        '<div class="dq-tiers">' + TIERS.map(function (pct) {
          return '<label class="dq-tier">' + pct + '%<input id="dq-units-' + pct + '" type="number" min="0" step="1" inputmode="numeric" aria-label="Homes at ' + pct + '% AMI" style="' + field + 'text-align:right;"></label>';
        }).join('') + '</div>' +
        '<p id="dq-homes" style="margin:.3rem 0 0;font-size:.82rem;color:var(--muted);"></p></fieldset>' +
      '<dl class="dq-out no-glossary" aria-live="polite">' + OUTPUTS.map(function (o) {
        return '<div><dt>' + o.label + '</dt><dd id="dq-out-' + o.id + '">—</dd></div>';
      }).join('') + '</dl>' +
      '<p style="margin:.5rem 0 0;font-size:.82rem;color:var(--muted);">A new total scales every cost line by the same share. Screening estimate, not underwriting.</p>';
    var style = document.createElement('style');
    style.textContent =
      '#dcQuick{max-width:1400px;margin:0 auto 12px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:var(--radius);box-sizing:border-box;text-align:left}' +
      '#dcQuick label,#dcQuick legend{text-align:left;align-items:stretch}' +
      '#dcQuick .dq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem .9rem;align-items:end}' +
      '#dcQuick .dq-f{display:flex;flex-direction:column;gap:.25rem;font-weight:600;font-size:.9rem;min-width:0}' +
      '#dcQuick .dq-rates{display:flex;flex-wrap:wrap;gap:0 1rem}' +
      '#dcQuick .dq-radio{display:inline-flex;flex-direction:row;align-items:center;gap:.35rem;min-height:44px;font-weight:400}' +
      '#dcQuick .dq-radio input{width:20px;height:20px;margin:0}' +
      '#dcQuick .dq-tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:.4rem}' +
      '#dcQuick .dq-tier{display:flex;flex-direction:column;gap:.2rem;font-size:.85rem;font-weight:600;min-width:0}' +
      '#dcQuick .dq-out{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin:.9rem 0 0}' +
      '#dcQuick .dq-out div{padding:.55rem .7rem;background:var(--bg2);border-radius:var(--radius-sm,6px);min-width:0}' +
      '#dcQuick .dq-out dt{font-size:.8rem;color:var(--muted)}' +
      '#dcQuick .dq-out dd{margin:.15rem 0 0;font-size:1.15rem;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}' +
      '#dcQuick .dq-out dd.dq-unavailable{font-size:.82rem;font-weight:600;color:var(--warn,#a84608)}';
    document.head.appendChild(style);
  }

  function init() {
    var host = $('dcQuick');
    if (!host || !$('dealCalcMount')) return;
    render(host);
    host.addEventListener('change', push);
    // Homes update as they are typed. The total waits for the reader to finish (change), since scaling
    // the cost lines to each partial number ("2", "25", ...) would round them away.
    host.addEventListener('input', function (e) { if (e.target && /^dq-units-/.test(e.target.id)) push(e); });
    document.addEventListener('deal-calc:updated', pull);
    // The county list loads after the calculator first draws.
    var county = $('dc-county-select');
    if (county && window.MutationObserver) new MutationObserver(syncCounties).observe(county, { childList: true });
    pull();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__DealCalcQuick = { scaleCosts: scaleCosts, itemized: itemized, pull: pull, TIERS: TIERS, OUTPUTS: OUTPUTS };
})();
