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
 *
 * Bedrooms (paul, 23 Nov 2026: "deal calculator has only ami, not brs?"): each income limit's bedroom size
 * mirrors the full calculator's own dc-br-<pct> (2 bedrooms unless changed), which sets that tier's rent
 * limit. Before, the panel never showed it, so its results quietly assumed 2-bedroom homes. A tier split by
 * bedroom in Unit mix, or a Market Analysis rent schedule, sets the sizes there instead, and the panel says so.
 *
 * Homes that earn no credit (paul's walkthrough, 27 Nov 2026: "I'm getting errors"): a 70% or 80% home counts for
 * credit only under the Average Income Test, and a market-rate home never does. With any such home the law takes
 * the lower of the unit share and the floor-space share (26 U.S.C. 42(c)(1)(B)), so the full calculator needs both
 * floor areas, and the panel used to show "Unavailable" with nowhere to enter them. Now the panel says which homes
 * earn no credit and why, and shows the election and the two floor areas, each mirroring the full calculator's own
 * input (dc-minimum-set-aside, dc-res-sf, dc-restricted-sf). No size is assumed: Colorado sets no unit sizes.
 *
 * Bedroom mix (paul, 27 Nov 2026: "only 1 br type?"): "Mix sizes" under an income limit opens a row of counts by
 * bedroom size for it, mirroring the full calculator's own bedroom split (dc-units-<pct>-<br>). The current homes
 * start in the size they had, so nothing moves until a count changes; a count changed there moves the tier and
 * Total Units by the same number. "One size" folds the tier back into its biggest size.
 *
 * Homes: a tier changed here moves Total Units by the same number, so homes
 * outside these limits (market rate, 100% AMI and up) stay as they were. When a
 * Market Analysis rent schedule is active the counts come from its rows (the
 * full calculator's #dc-schedule-table), read only.
 */
(function () {
  'use strict';

  // Credit-eligible income limits shown in the panel; 100% AMI and up stay in the full unit mix.
  var TIERS = [20, 30, 40, 50, 60, 70, 80];
  // The full calculator's bedroom sizes (js/deal-calculator.js, dc-br-<pct>), in its order.
  var BEDROOMS = [['studio', 'Studio'], ['1br', '1 BR'], ['2br', '2 BR'], ['3br', '3 BR'], ['4br', '4 BR']];
  var OUTPUTS = [
    { id: 'dc-r-credits', label: 'Annual federal credit' },
    { id: 'dc-r-equity', label: 'Credit equity' },
    { id: 'dc-r-mortgage', label: 'First mortgage' },
    { id: 'dc-su-gap', label: 'Funding gap' }
  ];
  var COST_SUFFIXES = ['', '-eligible', '-used'];

  function $(id) { return document.getElementById(id); }
  function fire(el, types) { types.forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); }); }
  // Writes only what changed: each DOM change wakes the page's observers (glossary, contrast guard).
  function put(el, prop, v) { if (el && el[prop] !== v) el[prop] = v; }
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
  // The active Market Analysis rent schedule's rows, or null when the page's own unit mix is in use.
  function scheduleRows() {
    var host = $('dc-schedule-table');
    if (!host || host.hidden) return null;
    return host.querySelectorAll('tbody tr[data-tier]');
  }
  // A tier's bedroom split inputs, looked up inside the unit grid (a whole-page id scan is slow).
  function splitInputs(pct) {
    var rows = $('dc-ami-rows');
    return rows ? rows.querySelectorAll('input[id^="dc-units-' + pct + '-"]') : [];
  }
  function tierFixed(pct) {
    // A bedroom split replaces the tier total, and a Market Analysis rent schedule replaces the grid.
    var rows = $('dc-ami-rows');
    if (!rows || rows.closest('[hidden]')) return 'The unit mix comes from your rent schedule. Change it in Unit mix below.';
    return '';
  }
  function hasSplit(pct) { return Array.prototype.some.call(splitInputs(pct), function (el) { return num(el.value) > 0; }); }
  var SPLIT_OPEN = {}; // tiers whose bedroom row the reader opened, shown even while every count is 0
  function tierUnits(pct) {
    var rows = scheduleRows();
    if (rows) return Array.prototype.reduce.call(rows, function (s, tr) {
      return s + (tr.dataset.tier === String(pct) && num(tr.dataset.units) > 0 ? num(tr.dataset.units) : 0);
    }, 0);
    var chk = $('dc-chk-' + pct), total = $('dc-units-' + pct);
    if (!total || (chk && !chk.checked)) return 0;
    var split = Array.prototype.reduce.call(splitInputs(pct), function (s, el) { var n = num(el.value); return s + (n > 0 ? n : 0); }, 0);
    return split > 0 ? split : (num(total.value) > 0 ? num(total.value) : 0);
  }

  function syncCounties() {
    var from = $('dc-county-select'), to = $('dq-county');
    if (!from || !to) return;
    if (to.options.length !== from.options.length) {
      var list = document.createDocumentFragment();
      Array.prototype.forEach.call(from.options, function (o) { list.appendChild(new Option(o.textContent, o.value)); });
      to.replaceChildren(list);
    }
    put(to, 'value', from.value);
  }

  // Calculator → panel. A field the reader is typing in is left alone.
  function pull() {
    var active = document.activeElement;
    syncCounties();
    var tdc = $('dc-tdc'), q = $('dq-tdc');
    if (tdc && q && active !== q) put(q, 'value', tdc.value);
    var r4 = $('dc-rate-4');
    if (r4) { put($('dq-rate-4'), 'checked', r4.checked); put($('dq-rate-9'), 'checked', !r4.checked); }
    TIERS.forEach(function (pct) {
      var box = $('dq-units-' + pct);
      if (!box) return;
      var fixed = tierFixed(pct), split = !fixed && (hasSplit(pct) || SPLIT_OPEN[pct]);
      put(box, 'disabled', !!fixed);
      put(box, 'readOnly', !!split);
      put(box, 'title', fixed || (split ? 'The sum of the bedroom sizes below.' : ''));
      if (active !== box) put(box, 'value', String(tierUnits(pct)));
      var br = $('dq-br-' + pct), full = $('dc-br-' + pct);
      if (br) {
        put(br, 'disabled', !!fixed || !full);
        put(br, 'title', fixed);
        put(br, 'hidden', !!split);
        if (full && active !== br) put(br, 'value', full.value);
      }
      var more = $('dq-more-' + pct);
      if (more) { put(more, 'hidden', !!split || !!fixed); }
      var row = $('dq-split-' + pct);
      if (row) {
        put(row, 'hidden', !split);
        BEDROOMS.forEach(function (b) {
          var cell = $('dq-split-' + pct + '-' + b[0]), src = $('dc-units-' + pct + '-' + b[0]);
          if (cell && src && active !== cell) put(cell, 'value', String(num(src.value) > 0 ? num(src.value) : 0));
        });
      }
    });
    var all = $('dc-units'), qAll = $('dq-units');
    if (all && qAll) {
      put(qAll, 'disabled', !!all.readOnly);
      put(qAll, 'title', all.readOnly ? 'Set by your rent schedule.' : '');
      if (active !== qAll) put(qAll, 'value', all.value);
    }
    var homes = TIERS.reduce(function (s, pct) { return s + tierUnits(pct); }, 0);
    var note = $('dq-homes');
    put(note, 'textContent', homes + ' homes at these income limits' + (scheduleRows() ? ', from your Market Analysis rent schedule.' : '.'));
    // The full calculator's own check of tier homes against Total Units, shown here when it speaks.
    var warn = $('dc-units-sync-warn'), mix = $('dq-mix');
    if (mix) {
      var said = warn && !warn.hidden && !scheduleRows() ? warn.textContent.replace(/^[^A-Za-z0-9]+/, '').replace(/\s+/g, ' ').trim() : '';
      put(mix, 'textContent', said);
      put(mix, 'hidden', !said);
      mix.classList.toggle('dq-unavailable', /exceed/i.test(said));
    }
    floorBox(active);
    OUTPUTS.forEach(function (o) {
      var src = $(o.id), dst = $('dq-out-' + o.id);
      if (!dst) return;
      var text = src ? src.textContent.replace(/\s+/g, ' ').trim() : '';
      put(dst, 'textContent', text || '—');
      dst.classList.toggle('dq-unavailable', /^Unavailable\b/.test(text));
    });
  }

  // Homes that earn no credit, by the full calculator's own rule (DealEngine.isLihtcCreditEligiblePct).
  var ELECTION = { '20-50': 'the 20-50 election counts homes at 50% or below',
    '40-60': 'the 40-60 election counts homes at 60% or below',
    'average-income': 'the Average Income Test counts homes up to 80%' };
  function noCredit() {
    var sel = $('dc-minimum-set-aside'), E = window.DealEngine;
    var election = sel ? sel.value : '40-60';
    var tiers = TIERS.filter(function (pct) {
      return tierUnits(pct) > 0 && !(E && E.isLihtcCreditEligiblePct ? E.isLihtcCreditEligiblePct(pct, election) : pct <= 60);
    }).map(function (pct) { return { pct: pct, homes: tierUnits(pct) }; });
    var inTiers = TIERS.reduce(function (s, pct) { return s + tierUnits(pct); }, 0);
    var all = num(($('dc-units') || {}).value);
    return { election: election, tiers: tiers, market: all > inTiers ? Math.round(all - inTiers) : 0 };
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // The election and the two floor areas, shown while any home earns no credit; each mirrors the full calculator.
  function floorBox(active) {
    var box = $('dq-floor');
    if (!box) return;
    var nc = noCredit();
    var homes = nc.tiers.reduce(function (s, t) { return s + t.homes; }, 0) + nc.market;
    // The full calculator's own verdict on the election (for example, the Average Income Test needs every home designated).
    var st = $('dc-minimum-set-aside-status'), msg = $('dq-floor-status');
    var said = st && !st.hidden && /does not qualify/i.test(st.textContent) ? st.textContent.replace(/\s+/g, ' ').trim() : '';
    put(msg, 'textContent', said);
    put(msg, 'hidden', !said);
    put(box, 'hidden', !(homes > 0) && !said);
    put($('dq-floor-why'), 'hidden', !(homes > 0));
    Array.prototype.forEach.call(box.querySelectorAll('.dq-sf'), function (l) { put(l, 'hidden', !(homes > 0)); });
    var sel = $('dc-minimum-set-aside'), q = $('dq-set-aside');
    if (sel && q && active !== q) put(q, 'value', sel.value);
    if (!(homes > 0)) return;
    var parts = nc.tiers.map(function (t) { return plural(t.homes, 'home', 'homes') + ' at ' + t.pct + '%'; });
    if (nc.market) parts.push(plural(nc.market, 'market-rate home', 'market-rate homes'));
    var why = (nc.tiers.length ? ELECTION[nc.election] || '' : '');
    put($('dq-floor-why'), 'textContent', parts.join(' and ') + (homes === 1 ? ' earns' : ' earn') + ' no tax credit' + (why ? ' (' + why + ')' : '') +
      '. With homes like these the law uses the lower of two shares: credit homes out of all homes, and their floor space out of all floor space. Enter both floor areas' +
      (nc.tiers.length && !nc.market && nc.election !== 'average-income' ? ', or count homes up to 80% with the Average Income Test' : '') + '.');
    [['dq-res-sf', 'dc-res-sf'], ['dq-restricted-sf', 'dc-restricted-sf']].forEach(function (m) {
      var from = $(m[1]), to = $(m[0]);
      if (from && to && active !== to) put(to, 'value', from.value);
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
    } else if (t.id === 'dq-units') {
      var homes = num(t.value), total = $('dc-units');
      if (!total || total.readOnly || !(homes >= 1)) return;
      total.value = String(Math.round(homes));
      fire(total, ['input', 'change']);
    } else if (t.id === 'dq-set-aside') {
      var el = $('dc-minimum-set-aside');
      if (el) { el.value = t.value; fire(el, ['change']); }
    } else if (t.id === 'dq-res-sf' || t.id === 'dq-restricted-sf') {
      var sf = $(t.id === 'dq-res-sf' ? 'dc-res-sf' : 'dc-restricted-sf');
      if (sf) { sf.value = t.value === '' ? '' : String(Math.max(0, Math.round(num(t.value)) || 0)); fire(sf, ['input', 'change']); }
    } else if (/^dq-split-\d+-[a-z0-9]+$/.test(t.id)) {
      var m = t.id.match(/^dq-split-(\d+)-([a-z0-9]+)$/), sp = m[1], cell = $('dc-units-' + sp + '-' + m[2]), n2 = num(t.value);
      if (!cell || !(n2 >= 0) || tierFixed(sp)) return;
      var was2 = tierUnits(sp);
      cell.value = String(Math.round(n2));
      setTier(sp, Array.prototype.reduce.call(splitInputs(sp), function (s2, el) { var k = num(el.value); return s2 + (k > 0 ? k : 0); }, 0), was2);
      fire(cell, ['input', 'change']);
    } else if (/^dq-br-\d+$/.test(t.id)) {
      var size = $('dc-br-' + t.id.slice('dq-br-'.length));
      if (!size || size.disabled || tierFixed(t.id.slice('dq-br-'.length))) return;
      size.value = t.value;
      fire(size, ['input', 'change']);
    } else if (/^dq-units-\d+$/.test(t.id)) {
      var pct = t.id.slice('dq-units-'.length), units = $('dc-units-' + pct), chk = $('dc-chk-' + pct);
      var n = num(t.value);
      if (!units || !(n >= 0) || tierFixed(pct)) return;
      // Total Units moves with the tier, so the homes outside these limits stay the same.
      var was = tierUnits(pct);
      units.value = String(Math.round(n));
      moveTotal(Math.round(n) - was);
      if (chk && n > 0 && !chk.checked) { chk.checked = true; fire(chk, ['change']); }
      fire(units, ['input', 'change']);
    }
  }

  // Total Units moves by `delta`. Total Units can't go below 1, so while a count is cleared on the way to a new one
  // (60 homes moved from 2 BR to 3 BR by clearing 2 BR first) the running total is held here and Total Units keeps
  // what it showed; the next count lands on the held total, not on top of the old one (Codex, #3046). The hold only
  // counts while Total Units still shows what it showed then, so a total typed meanwhile wins.
  var HELD = null;
  function moveTotal(delta) {
    var all = $('dc-units');
    if (!all || all.readOnly || !delta) return;
    var cur = HELD && HELD.shown === all.value ? HELD.total : num(all.value), next = cur + delta;
    if (next >= 1) { HELD = null; all.value = String(next); fire(all, ['input', 'change']); }
    else HELD = { total: next, shown: all.value };
  }
  // A tier's homes set to `n` (was `was`): its count, its tick, and Total Units by the same change, so the homes
  // outside these limits stay the same.
  function setTier(pct, n, was) {
    var units = $('dc-units-' + pct), chk = $('dc-chk-' + pct);
    if (units) units.value = String(Math.round(n));
    moveTotal(Math.round(n) - was);
    if (chk && n > 0 && !chk.checked) { chk.checked = true; fire(chk, ['change']); }
    if (units) fire(units, ['input', 'change']);
  }
  // "Mix sizes" opens a tier's bedroom row with its homes in the size they had; "One size" folds it back.
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest('button[data-dq-split]');
    if (!b) return;
    var pct = b.getAttribute('data-dq-split'), cells = splitInputs(pct);
    if (tierFixed(pct)) return;
    if (b.getAttribute('data-dq-act') === 'open') {
      SPLIT_OPEN[pct] = true;
      var n = tierUnits(pct), size = ($('dc-br-' + pct) || {}).value || '2br', start = $('dc-units-' + pct + '-' + size);
      if (n > 0 && start && !hasSplit(pct)) { start.value = String(n); fire(start, ['input', 'change']); }
      pull();
      var first = $('dq-split-' + pct + '-' + size) || $('dq-split-' + pct + '-studio');
      if (first) first.focus();
    } else {
      delete SPLIT_OPEN[pct];
      var big = null, total = 0;
      Array.prototype.forEach.call(cells, function (el) { var k = num(el.value); if (k > 0) { total += k; if (!big || k > num(big.value)) big = el; } });
      var sel = $('dc-br-' + pct);
      if (big && sel) { sel.value = big.id.slice(('dc-units-' + pct + '-').length); fire(sel, ['input', 'change']); }
      Array.prototype.forEach.call(cells, function (el) { if (el.value !== '0') { el.value = '0'; fire(el, ['input', 'change']); } });
      var units = $('dc-units-' + pct);
      if (units) { units.value = String(total); fire(units, ['input', 'change']); }
      pull();
      var more = $('dq-more-' + pct);
      if (more) more.focus();
    }
  }

  function render(host) {
    var field = 'min-height:44px;width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm,6px);background:var(--card);color:var(--text);font:inherit;';
    host.innerHTML =
      '<h2 id="dq-title" style="margin:0 0 .25rem;font-size:1.15rem;">Quick start: five answers fill in the pro forma</h2>' +
      '<p style="margin:0 0 .75rem;font-size:.88rem;color:var(--muted);">Each answer here writes the pro forma\u2019s own line below, and the results are read back from it, so the two never differ. Then change any line: costs, rents, loans and the 15-year cash flow.</p>' +
      '<div class="dq-grid">' +
        '<label class="dq-f">County<select id="dq-county" style="' + field + '"></select></label>' +
        '<label class="dq-f">Total development cost ($)<input id="dq-tdc" type="number" min="0" step="100000" inputmode="numeric" style="' + field + '"></label>' +
        '<fieldset class="dq-f" style="border:0;margin:0;padding:0;min-width:0;"><legend style="padding:0;font-weight:600;font-size:.9rem;">Credit</legend>' +
          '<div class="dq-rates"><label class="dq-radio"><input type="radio" name="dq-rate" id="dq-rate-9"> 9% competitive</label>' +
          '<label class="dq-radio"><input type="radio" name="dq-rate" id="dq-rate-4"> 4% with bonds</label></div></fieldset>' +
        '<label class="dq-f">Total homes<input id="dq-units" type="number" min="1" step="1" inputmode="numeric" style="' + field + '"></label>' +
      '</div>' +
      '<fieldset style="border:0;margin:.75rem 0 0;padding:0;min-width:0;"><legend style="padding:0;font-weight:600;font-size:.9rem;">Homes and bedroom size by income limit (% of area median income)</legend>' +
        '<div class="dq-tiers">' + TIERS.map(function (pct) {
          return '<div class="dq-tier"><label for="dq-units-' + pct + '">' + pct + '%</label><input id="dq-units-' + pct + '" type="number" min="0" step="1" inputmode="numeric" aria-label="Homes at ' + pct + '% AMI" style="' + field + 'text-align:right;">' +
            '<select id="dq-br-' + pct + '" class="dq-br" aria-label="Bedrooms for homes at ' + pct + '% AMI" style="' + field + 'padding:.35rem .25rem;">' +
            BEDROOMS.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('') + '</select>' +
            '<button type="button" id="dq-more-' + pct + '" class="dq-more" data-dq-split="' + pct + '" data-dq-act="open" aria-label="Mix sizes at ' + pct + '% AMI">Mix sizes</button></div>';
        }).join('') + '</div>' +
        TIERS.map(function (pct) {
          return '<div id="dq-split-' + pct + '" class="dq-split" hidden role="group" aria-label="Homes by bedroom size at ' + pct + '% AMI"><span class="dq-split-k">' + pct + '% by size</span>' +
            BEDROOMS.map(function (b) {
              return '<label class="dq-split-c">' + b[1] + '<input id="dq-split-' + pct + '-' + b[0] + '" type="number" min="0" step="1" inputmode="numeric" aria-label="' + b[1] + ' homes at ' + pct + '% AMI" style="' + field + 'text-align:right;"></label>';
            }).join('') +
            '<button type="button" class="dq-more" data-dq-split="' + pct + '" data-dq-act="close" aria-label="One size at ' + pct + '% AMI">One size</button></div>';
        }).join('') +
        '<p id="dq-homes" style="margin:.3rem 0 0;font-size:.82rem;color:var(--muted);"></p>' +
        '<p id="dq-mix" hidden style="margin:.3rem 0 0;font-size:.82rem;color:var(--muted);"></p></fieldset>' +
      '<div id="dq-floor" hidden class="dq-floor">' +
        '<p id="dq-floor-why" style="margin:0 0 .5rem;font-size:.88rem;"></p>' +
        '<div class="dq-grid">' +
          '<label class="dq-f">Income election<select id="dq-set-aside" style="' + field + '">' +
            '<option value="40-60">40-60 (homes at 60% or below)</option><option value="20-50">20-50 (homes at 50% or below)</option>' +
            '<option value="average-income">Average Income Test (20% to 80%, average 60% or below)</option></select></label>' +
          '<label class="dq-f dq-sf">Floor space of all homes (sq ft)<input id="dq-res-sf" type="number" min="0" step="100" inputmode="numeric" placeholder="not entered" style="' + field + '"></label>' +
          '<label class="dq-f dq-sf">Floor space of the credit homes (sq ft)<input id="dq-restricted-sf" type="number" min="0" step="100" inputmode="numeric" placeholder="not entered" style="' + field + '"></label>' +
        '</div>' +
        '<p id="dq-floor-status" hidden class="dq-unavailable" style="margin:.4rem 0 0;font-size:.82rem;"></p>' +
        '<p style="margin:.4rem 0 0;font-size:.8rem;color:var(--muted);">Floor space of the homes themselves, without halls or common space. Colorado sets no unit sizes, so the calculator assumes none. Source: 26 U.S.C. 42(c)(1)(B) and 42(g)(1).</p>' +
      '</div>' +
      '<dl class="dq-out no-glossary" aria-live="polite">' + OUTPUTS.map(function (o) {
        return '<div><dt>' + o.label + '</dt><dd id="dq-out-' + o.id + '">—</dd></div>';
      }).join('') + '</dl>' +
      '<p style="margin:.5rem 0 0;font-size:.82rem;color:var(--muted);">A new cost total scales every cost line by the same share. Homes added at an income limit add to total homes. Screening estimate, not underwriting.</p>';
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
      '#dcQuick .dq-br{font-weight:400;font-size:.85rem}' +
      '#dcQuick .dq-tier>label{min-height:0;margin:0;padding:0;text-align:left}' +
      '#dcQuick .dq-out{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin:.9rem 0 0}' +
      '#dcQuick .dq-out div{padding:.55rem .7rem;background:var(--bg2);border-radius:var(--radius-sm,6px);min-width:0}' +
      '#dcQuick .dq-out dt{font-size:.8rem;color:var(--muted)}' +
      '#dcQuick .dq-out dd{margin:.15rem 0 0;font-size:1.15rem;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}' +
      '#dcQuick .dq-more{align-self:flex-start;min-height:44px;min-width:44px;padding:.1rem .35rem;border:0;background:none;color:var(--link,var(--accent));font:inherit;font-size:.8rem;font-weight:600;text-decoration:underline;cursor:pointer}' +
      '#dcQuick .dq-more[hidden],#dcQuick .dq-split[hidden],#dcQuick .dq-br[hidden]{display:none}' +
      '#dcQuick .dq-split{display:grid;grid-template-columns:auto repeat(5,minmax(52px,1fr)) auto;gap:.35rem .5rem;align-items:end;margin:.5rem 0 0;padding:.4rem .5rem;background:var(--bg2);border-radius:var(--radius-sm,6px)}' +
      '#dcQuick .dq-split-k{font-size:.85rem;font-weight:600;align-self:center}' +
      '#dcQuick .dq-split-c{display:flex;flex-direction:column;gap:.15rem;font-size:.78rem;font-weight:600;min-width:0}' +
      '@media (max-width:560px){#dcQuick .dq-split{grid-template-columns:repeat(5,minmax(0,1fr))}#dcQuick .dq-split-k{grid-column:1/-1}#dcQuick .dq-split .dq-more{grid-column:1/-1}}' +
      '#dcQuick .dq-floor[hidden],#dcQuick .dq-sf[hidden]{display:none}' +
      '#dcQuick .dq-floor{margin:.75rem 0 0;padding:.6rem .75rem;border:1px solid var(--border);border-left:4px solid var(--warn,#a84608);border-radius:var(--radius-sm,6px);background:var(--bg2)}' +
      '#dcQuick p.dq-unavailable{color:var(--warn,#a84608);font-weight:600}' +
      '#dcQuick .dq-out dd.dq-unavailable{font-size:.82rem;font-weight:600;color:var(--warn,#a84608)}';
    document.head.appendChild(style);
  }

  function init() {
    var host = $('dcQuick');
    if (!host || !$('dealCalcMount')) return;
    render(host);
    host.addEventListener('change', push);
    host.addEventListener('click', onClick);
    // Homes update as they are typed. The total waits for the reader to finish (change), since scaling
    // the cost lines to each partial number ("2", "25", ...) would round them away.
    host.addEventListener('input', function (e) { if (e.target && /^dq-(units|split)(-|$)/.test(e.target.id)) push(e); });
    document.addEventListener('deal-calc:updated', pull);
    // The county list loads after the calculator first draws.
    var county = $('dc-county-select');
    if (county && window.MutationObserver) new MutationObserver(syncCounties).observe(county, { childList: true });
    pull();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__DealCalcQuick = { scaleCosts: scaleCosts, itemized: itemized, tierUnits: tierUnits, pull: pull, noCredit: noCredit, TIERS: TIERS, OUTPUTS: OUTPUTS };
})();
