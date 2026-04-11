/**
 * js/qap-simulator.js
 * CHFA QAP Competitiveness Simulator — Interactive scoring tool
 *
 * Allows users to toggle individual QAP scoring drivers and see
 * estimated competitiveness in real time. Wraps the scoring logic
 * from CHFAAwardPredictor with a fully interactive UI.
 *
 * Non-goals:
 *   - Does NOT predict the actual CHFA score (CHFA is the sole arbiter)
 *   - Does NOT guarantee an award — estimates only
 *   - Does NOT replace professional pre-application consultation with CHFA
 *
 * Exposed as window.QAPSimulator (browser) and module.exports (Node).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QAPSimulator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Scoring weights (mirrored from CHFAAwardPredictor) ───────── */
  var SCORING_WEIGHTS = {
    geography:     { maxPts: 20, avgWinner: 16.2, avgLoser: 12.1 },
    communityNeed: { maxPts: 25, avgWinner: 20.8, avgLoser: 14.3 },
    localSupport:  { maxPts: 22, avgWinner: 18.5, avgLoser: 11.2 },
    developer:     { maxPts: 15, avgWinner: 12.1, avgLoser: 9.4  },
    design:        { maxPts: 10, avgWinner: 7.8,  avgLoser: 5.2  },
    other:         { maxPts: 8,  avgWinner: 6.1,  avgLoser: 3.8  }
  };

  var AVG_WINNER_TOTAL = 82;
  var AVG_LOSER_TOTAL  = 56;

  /* ── Factor definitions (drives, labels, tips) ────────────────── */
  var FACTORS = {
    geography: {
      label: 'Geography & Site',
      maxPts: 20,
      drivers: [
        { id: 'isQct',     type: 'checkbox', label: 'Qualified Census Tract (QCT)', pts: '+2.5' },
        { id: 'isDda',     type: 'checkbox', label: 'Difficult Development Area (DDA)', pts: '+2.0' },
        { id: 'pmaHigh',   type: 'checkbox', label: 'PMA score >= 75', pts: '+2.0' },
        { id: 'pmaMod',    type: 'checkbox', label: 'PMA score >= 60 (if not >= 75)', pts: '+1.0' },
        { id: 'isRural',   type: 'checkbox', label: 'Rural location', pts: '-1.5' }
      ],
      tip: 'Sites in QCTs or DDAs receive automatic bonuses. Strong PMA scores (75+) from a market study add further points. Rural locations typically score lower on geography but may qualify for rural set-aside pools.',
      base: 12.1
    },
    communityNeed: {
      label: 'Community Need',
      maxPts: 25,
      drivers: [
        { id: 'gapOver200',    type: 'checkbox', label: 'Housing gap > 200 units', pts: '+4.0' },
        { id: 'gapOver50',     type: 'checkbox', label: 'Housing gap > 50 units (if not > 200)', pts: '+2.0' },
        { id: 'ami30Need',     type: 'checkbox', label: 'AMI 30% need > 50 units', pts: '+2.0' },
        { id: 'hasHnaData',    type: 'checkbox', label: 'HNA-backed need documentation', pts: '+1.5' }
      ],
      tip: 'Documenting housing need with a Housing Needs Assessment (HNA) is one of the strongest score improvements. Quantify the undersupply and AMI 30% demand in your primary market area.',
      base: 14.3
    },
    localSupport: {
      label: 'Local Support',
      maxPts: 22,
      drivers: [
        { id: 'softOver500k',  type: 'checkbox', label: 'Soft funding > $500K', pts: '+5.0' },
        { id: 'softOver100k',  type: 'checkbox', label: 'Soft funding > $100K (if not > $500K)', pts: '+2.5' },
        { id: 'govSupport',    type: 'checkbox', label: 'Government support letter / commitment', pts: '+3.0' },
        { id: 'publicLand',    type: 'checkbox', label: 'Public land opportunity (strong)', pts: '+2.5' }
      ],
      tip: 'Local government support is heavily weighted. Secure letters of support, soft funding commitments (HOME, CDBG, trust funds), and explore public land donations or below-market leases before application.',
      base: 11.2
    },
    developer: {
      label: 'Developer Track Record',
      maxPts: 15,
      drivers: [
        { id: 'devScore', type: 'range', label: 'Track record score', min: 0, max: 15, step: 0.5, defaultVal: 11.4 }
      ],
      tip: 'Developer experience with CHFA, successful project completions, and compliance history all factor in. First-time developers should consider partnering with experienced LIHTC developers.',
      base: 11.4
    },
    design: {
      label: 'Design & Green Building',
      maxPts: 10,
      drivers: [
        { id: 'designScore', type: 'range', label: 'Design quality score', min: 0, max: 10, step: 0.5, defaultVal: 5.2 },
        { id: 'greenBuilding', type: 'checkbox', label: 'Green building commitment', pts: '+2.0' }
      ],
      tip: 'Green building certifications (Enterprise Green, LEED, ENERGY STAR) add points. Universal design, visitability standards, and quality architecture improve design scoring.',
      base: 5.2
    },
    other: {
      label: 'Other Factors',
      maxPts: 8,
      drivers: [
        { id: 'ruralPriority',  type: 'checkbox', label: 'Rural priority tiebreaker', pts: '+1.5' },
        { id: 'isPreservation', type: 'checkbox', label: 'Preservation preference', pts: '+1.0' },
        { id: 'otherBonus',     type: 'range',    label: 'Additional factors', min: 0, max: 4, step: 0.5, defaultVal: 0 }
      ],
      tip: 'Rural projects and preservation/rehab deals can earn additional points. Nonprofit sponsorship and special population targeting (veterans, persons with disabilities) may also contribute.',
      base: 3.8
    }
  };

  /* ── State ─────────────────────────────────────────────────────── */
  var _containerId = null;
  var _state = {};

  function _initState() {
    _state = {
      isQct: false,
      isDda: false,
      pmaHigh: false,
      pmaMod: false,
      isRural: false,
      gapOver200: false,
      gapOver50: false,
      ami30Need: false,
      hasHnaData: false,
      softOver500k: false,
      softOver100k: false,
      govSupport: false,
      publicLand: false,
      devScore: 11.4,
      designScore: 5.2,
      greenBuilding: false,
      ruralPriority: false,
      isPreservation: false,
      otherBonus: 0
    };
  }

  /* ── Scoring engine ────────────────────────────────────────────── */

  function _calcFactorScore(factorKey) {
    var w = SCORING_WEIGHTS[factorKey];
    var score;

    switch (factorKey) {
      case 'geography':
        score = w.avgLoser;
        if (_state.isQct)    score += 2.5;
        if (_state.isDda)    score += 2.0;
        if (_state.pmaHigh)  score += 2.0;
        else if (_state.pmaMod) score += 1.0;
        if (_state.isRural)  score -= 1.5;
        break;

      case 'communityNeed':
        score = w.avgLoser;
        if (_state.gapOver200)    score += 4.0;
        else if (_state.gapOver50) score += 2.0;
        if (_state.ami30Need)     score += 2.0;
        if (_state.hasHnaData)    score += 1.5;
        break;

      case 'localSupport':
        score = w.avgLoser;
        if (_state.softOver500k)      score += 5.0;
        else if (_state.softOver100k) score += 2.5;
        if (_state.govSupport)        score += 3.0;
        if (_state.publicLand)        score += 2.5;
        break;

      case 'developer':
        score = parseFloat(_state.devScore) || 0;
        break;

      case 'design':
        score = parseFloat(_state.designScore) || 0;
        if (_state.greenBuilding) score += 2.0;
        break;

      case 'other':
        score = w.avgLoser;
        if (_state.ruralPriority)  score += 1.5;
        if (_state.isPreservation) score += 1.0;
        score += (parseFloat(_state.otherBonus) || 0);
        break;

      default:
        score = 0;
    }

    return Math.max(0, Math.min(score, w.maxPts));
  }

  function _calcAllScores() {
    var scores = {};
    var total = 0;
    var keys = ['geography', 'communityNeed', 'localSupport', 'developer', 'design', 'other'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var val = parseFloat(_calcFactorScore(k).toFixed(1));
      scores[k] = val;
      total += val;
    }
    scores._total = parseFloat(total.toFixed(1));
    return scores;
  }

  function _getAssessment(total) {
    if (total >= 85) return { text: 'Strong candidate',         cls: 'good'  };
    if (total >= 74) return { text: 'Competitive',              cls: 'good'  };
    if (total >= 60) return { text: 'Below typical winner',     cls: 'warn'  };
    return               { text: 'Unlikely to score',          cls: 'bad'   };
  }

  function _getFactorColor(factorKey, value) {
    var w = SCORING_WEIGHTS[factorKey];
    if (value >= w.avgWinner) return 'good';
    if (value >= w.avgLoser)  return 'warn';
    return 'bad';
  }

  /* ── CSS-in-JS helpers ─────────────────────────────────────────── */

  var _cssInjected = false;

  function _injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.qsim { font-family: var(--font-sans, system-ui, sans-serif); }',
      '.qsim-hdr { text-align:center; margin-bottom:1.5rem; }',
      '.qsim-hdr h2 { font-size:var(--h2,1.3rem); font-weight:700; margin:0 0 .35rem; color:var(--text-strong,#060f1d); }',
      '.qsim-hdr p  { font-size:var(--small,.875rem); color:var(--muted,#374151); margin:0; line-height:1.5; }',
      '.qsim-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; margin-bottom:24px; }',
      '.qsim-card { background:var(--card,#fff); border:1px solid var(--border,rgba(13,31,53,.11)); border-radius:var(--radius,10px); padding:16px 18px; box-shadow:var(--shadow-sm); position:relative; }',
      '.qsim-card-hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }',
      '.qsim-card-title { font-size:.95rem; font-weight:700; color:var(--text-strong,#060f1d); margin:0; }',
      '.qsim-card-pts { font-size:.78rem; font-weight:600; padding:2px 8px; border-radius:var(--radius-sm,6px); }',
      '.qsim-card-pts--good { background:var(--good-dim,#d1fae5); color:var(--good,#047857); }',
      '.qsim-card-pts--warn { background:var(--warn-dim,#fef3c7); color:var(--warn,#a84608); }',
      '.qsim-card-pts--bad  { background:color-mix(in oklab, var(--card,#fff) 85%, var(--bad,#991b1b) 15%); color:var(--bad,#991b1b); }',
      '.qsim-drivers { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }',
      '.qsim-driver { display:flex; align-items:center; gap:8px; font-size:.85rem; color:var(--text,#0d1f35); }',
      '.qsim-driver input[type="checkbox"] { width:16px; height:16px; accent-color:var(--accent,#096e65); flex-shrink:0; cursor:pointer; }',
      '.qsim-driver label { cursor:pointer; flex:1; line-height:1.35; }',
      '.qsim-driver .qsim-pts-badge { font-size:.72rem; font-weight:600; color:var(--muted,#374151); white-space:nowrap; }',
      '.qsim-range-wrap { width:100%; }',
      '.qsim-range-row { display:flex; align-items:center; gap:10px; }',
      '.qsim-range-row input[type="range"] { flex:1; accent-color:var(--accent,#096e65); cursor:pointer; }',
      '.qsim-range-val { font-size:.85rem; font-weight:700; min-width:32px; text-align:right; color:var(--accent,#096e65); }',
      '.qsim-range-label { font-size:.82rem; color:var(--text,#0d1f35); margin-bottom:3px; }',
      '.qsim-bar-wrap { background:var(--bg2,#e4ecf4); border-radius:4px; height:8px; overflow:hidden; margin-bottom:4px; }',
      '.qsim-bar-fill { height:100%; border-radius:4px; transition:width .3s ease, background .3s ease; }',
      '.qsim-bar-fill--good { background:var(--good,#047857); }',
      '.qsim-bar-fill--warn { background:var(--warn,#a84608); }',
      '.qsim-bar-fill--bad  { background:var(--bad,#991b1b); }',
      '.qsim-bar-legend { display:flex; justify-content:space-between; font-size:.7rem; color:var(--faint,#4b5563); }',
      '.qsim-tip-btn { background:none; border:none; cursor:pointer; font-size:.82rem; color:var(--link,#005a9c); text-decoration:underline; padding:0; margin-top:6px; font-family:inherit; }',
      '.qsim-tip-btn:hover { color:var(--link-hover,#004880); }',
      '.qsim-tip-text { font-size:.78rem; color:var(--muted,#374151); line-height:1.5; margin-top:6px; padding:8px 10px; background:var(--bg2,#e4ecf4); border-radius:var(--radius-sm,6px); display:none; }',
      '.qsim-tip-text--open { display:block; }',
      /* Total bar area */
      '.qsim-total { background:var(--card,#fff); border:1px solid var(--border,rgba(13,31,53,.11)); border-radius:var(--radius,10px); padding:20px 22px; box-shadow:var(--shadow); }',
      '.qsim-total-row { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px; }',
      '.qsim-total-score { font-size:2.2rem; font-weight:800; line-height:1; color:var(--text-strong,#060f1d); }',
      '.qsim-total-max { font-size:.85rem; color:var(--faint,#4b5563); }',
      '.qsim-total-assess { font-size:.95rem; font-weight:700; padding:3px 12px; border-radius:var(--radius-sm,6px); }',
      '.qsim-total-assess--good { background:var(--good-dim); color:var(--good); }',
      '.qsim-total-assess--warn { background:var(--warn-dim); color:var(--warn); }',
      '.qsim-total-assess--bad  { background:color-mix(in oklab, var(--card,#fff) 85%, var(--bad) 15%); color:var(--bad); }',
      '.qsim-gauge { position:relative; height:28px; background:var(--bg2,#e4ecf4); border-radius:6px; overflow:visible; margin-bottom:8px; }',
      '.qsim-gauge-fill { height:100%; border-radius:6px; transition:width .4s ease, background .4s ease; }',
      '.qsim-gauge-fill--good { background:var(--good,#047857); }',
      '.qsim-gauge-fill--warn { background:var(--warn,#a84608); }',
      '.qsim-gauge-fill--bad  { background:var(--bad,#991b1b); }',
      '.qsim-gauge-marker { position:absolute; top:-4px; width:2px; height:36px; background:var(--text-strong,#060f1d); border-radius:1px; }',
      '.qsim-gauge-marker-label { position:absolute; top:38px; font-size:.68rem; font-weight:600; color:var(--faint,#4b5563); white-space:nowrap; transform:translateX(-50%); }',
      '.qsim-gauge-labels { display:flex; justify-content:space-between; font-size:.72rem; color:var(--faint,#4b5563); margin-top:10px; }',
      '.qsim-disclaimer { font-size:.72rem; color:var(--faint,#4b5563); text-align:center; margin-top:16px; line-height:1.5; }',
      /* Responsive: stack on narrow screens */
      '@media (max-width:700px) { .qsim-grid { grid-template-columns:1fr; } .qsim-total-row { flex-direction:column; align-items:flex-start; gap:8px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── DOM helpers ────────────────────────────────────────────────── */

  function _el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'style' && typeof attrs[k] === 'object') {
          for (var s in attrs[k]) {
            if (attrs[k].hasOwnProperty(s)) node.style[s] = attrs[k][s];
          }
        } else if (k === 'className') {
          node.className = attrs[k];
        } else if (k === 'htmlFor') {
          node.htmlFor = attrs[k];
        } else if (k.indexOf('data-') === 0 || k === 'type' || k === 'id' || k === 'min' ||
                   k === 'max' || k === 'step' || k === 'value' || k === 'name' ||
                   k === 'role' || k === 'aria-label' || k === 'aria-live' || k === 'aria-hidden') {
          node.setAttribute(k, attrs[k]);
        } else if (typeof attrs[k] === 'function') {
          node.addEventListener(k.replace(/^on/, '').toLowerCase(), attrs[k]);
        }
      }
    }
    if (children) {
      if (typeof children === 'string') {
        node.textContent = children;
      } else if (Array.isArray(children)) {
        for (var i = 0; i < children.length; i++) {
          if (children[i]) node.appendChild(children[i]);
        }
      } else {
        node.appendChild(children);
      }
    }
    return node;
  }

  /* ── Build factor card ─────────────────────────────────────────── */

  function _buildDriverInput(driver, factorKey) {
    var wrap = _el('div', { className: 'qsim-driver' });
    var inputId = 'qsim_' + driver.id;

    if (driver.type === 'checkbox') {
      var cb = _el('input', {
        type: 'checkbox',
        id: inputId,
        name: driver.id
      });
      cb.checked = !!_state[driver.id];
      cb.addEventListener('change', function () {
        _state[driver.id] = cb.checked;
        _handleMutualExclusions(driver.id);
        _recalculate();
      });
      var lbl = _el('label', { htmlFor: inputId }, driver.label);
      var badge = _el('span', { className: 'qsim-pts-badge' }, driver.pts);
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      wrap.appendChild(badge);
    } else if (driver.type === 'range') {
      var rangeWrap = _el('div', { className: 'qsim-range-wrap' });
      var rangeLabel = _el('div', { className: 'qsim-range-label' }, driver.label);
      var rangeRow = _el('div', { className: 'qsim-range-row' });

      var slider = _el('input', {
        type: 'range',
        id: inputId,
        name: driver.id,
        min: String(driver.min),
        max: String(driver.max),
        step: String(driver.step),
        value: String(_state[driver.id] != null ? _state[driver.id] : driver.defaultVal)
      });
      var valDisplay = _el('span', { className: 'qsim-range-val' },
        String(_state[driver.id] != null ? _state[driver.id] : driver.defaultVal));

      slider.addEventListener('input', function () {
        var v = parseFloat(slider.value);
        _state[driver.id] = v;
        valDisplay.textContent = v.toFixed(1);
        _recalculate();
      });

      rangeRow.appendChild(slider);
      rangeRow.appendChild(valDisplay);
      rangeWrap.appendChild(rangeLabel);
      rangeWrap.appendChild(rangeRow);
      wrap.appendChild(rangeWrap);
    }

    return wrap;
  }

  /** Handle mutually exclusive toggles (e.g. PMA high vs mod). */
  function _handleMutualExclusions(changedId) {
    /* PMA: pmaHigh and pmaMod are mutually exclusive */
    if (changedId === 'pmaHigh' && _state.pmaHigh) {
      _state.pmaMod = false;
      _syncCheckbox('pmaMod', false);
    }
    if (changedId === 'pmaMod' && _state.pmaMod) {
      _state.pmaHigh = false;
      _syncCheckbox('pmaHigh', false);
    }
    /* Housing gap: gapOver200 and gapOver50 mutually exclusive */
    if (changedId === 'gapOver200' && _state.gapOver200) {
      _state.gapOver50 = false;
      _syncCheckbox('gapOver50', false);
    }
    if (changedId === 'gapOver50' && _state.gapOver50) {
      _state.gapOver200 = false;
      _syncCheckbox('gapOver200', false);
    }
    /* Soft funding: softOver500k and softOver100k mutually exclusive */
    if (changedId === 'softOver500k' && _state.softOver500k) {
      _state.softOver100k = false;
      _syncCheckbox('softOver100k', false);
    }
    if (changedId === 'softOver100k' && _state.softOver100k) {
      _state.softOver500k = false;
      _syncCheckbox('softOver500k', false);
    }
  }

  function _syncCheckbox(stateKey, checked) {
    var el = document.getElementById('qsim_' + stateKey);
    if (el) el.checked = checked;
  }

  function _buildFactorCard(factorKey) {
    var f = FACTORS[factorKey];
    var card = _el('div', { className: 'qsim-card', 'data-factor': factorKey });

    /* Header */
    var hdr = _el('div', { className: 'qsim-card-hdr' });
    hdr.appendChild(_el('h3', { className: 'qsim-card-title' }, f.label));
    var ptsEl = _el('span', {
      className: 'qsim-card-pts',
      id: 'qsim_pts_' + factorKey
    });
    hdr.appendChild(ptsEl);
    card.appendChild(hdr);

    /* Drivers */
    var driversWrap = _el('div', { className: 'qsim-drivers' });
    for (var i = 0; i < f.drivers.length; i++) {
      driversWrap.appendChild(_buildDriverInput(f.drivers[i], factorKey));
    }
    card.appendChild(driversWrap);

    /* Score bar */
    var barWrap = _el('div', { className: 'qsim-bar-wrap' });
    var barFill = _el('div', { className: 'qsim-bar-fill', id: 'qsim_bar_' + factorKey });
    barWrap.appendChild(barFill);
    card.appendChild(barWrap);

    /* Bar legend */
    var legend = _el('div', { className: 'qsim-bar-legend' });
    legend.appendChild(_el('span', null, '0'));
    legend.appendChild(_el('span', null, 'Max: ' + f.maxPts));
    card.appendChild(legend);

    /* Tip toggle */
    var tipBtn = _el('button', { className: 'qsim-tip-btn', type: 'button' }, 'How to improve');
    var tipText = _el('div', { className: 'qsim-tip-text', id: 'qsim_tip_' + factorKey }, f.tip);
    tipBtn.addEventListener('click', function () {
      var isOpen = tipText.className.indexOf('qsim-tip-text--open') !== -1;
      tipText.className = isOpen ? 'qsim-tip-text' : 'qsim-tip-text qsim-tip-text--open';
      tipBtn.textContent = isOpen ? 'How to improve' : 'Hide tip';
    });
    card.appendChild(tipBtn);
    card.appendChild(tipText);

    return card;
  }

  /* ── Build total bar ───────────────────────────────────────────── */

  function _buildTotalBar() {
    var wrap = _el('div', { className: 'qsim-total', 'aria-live': 'polite' });

    /* Row: score + assessment */
    var row = _el('div', { className: 'qsim-total-row' });
    row.appendChild(_el('div', { className: 'qsim-total-score', id: 'qsim_total_val' }, '--'));
    row.appendChild(_el('div', { className: 'qsim-total-max' }, ' / 100'));
    row.appendChild(_el('span', { className: 'qsim-total-assess', id: 'qsim_total_assess' }, '--'));
    wrap.appendChild(row);

    /* Gauge */
    var gauge = _el('div', { className: 'qsim-gauge' });
    var gaugeFill = _el('div', { className: 'qsim-gauge-fill', id: 'qsim_gauge_fill' });
    gauge.appendChild(gaugeFill);

    /* Marker: avg loser */
    var loserMarker = _el('div', {
      className: 'qsim-gauge-marker',
      id: 'qsim_marker_loser',
      style: { left: (AVG_LOSER_TOTAL) + '%' }
    });
    var loserLabel = _el('div', { className: 'qsim-gauge-marker-label' }, 'Avg Loser: ' + AVG_LOSER_TOTAL);
    loserMarker.appendChild(loserLabel);
    gauge.appendChild(loserMarker);

    /* Marker: avg winner */
    var winnerMarker = _el('div', {
      className: 'qsim-gauge-marker',
      id: 'qsim_marker_winner',
      style: { left: (AVG_WINNER_TOTAL) + '%' }
    });
    var winnerLabel = _el('div', { className: 'qsim-gauge-marker-label' }, 'Avg Winner: ' + AVG_WINNER_TOTAL);
    winnerMarker.appendChild(winnerLabel);
    gauge.appendChild(winnerMarker);

    wrap.appendChild(gauge);

    /* Gauge labels */
    var gaugeLabels = _el('div', { className: 'qsim-gauge-labels' });
    gaugeLabels.appendChild(_el('span', null, '0'));
    gaugeLabels.appendChild(_el('span', null, '100'));
    wrap.appendChild(gaugeLabels);

    return wrap;
  }

  /* ── Recalculate and update DOM ────────────────────────────────── */

  function _recalculate() {
    var scores = _calcAllScores();
    var total = scores._total;
    var assessment = _getAssessment(total);
    var keys = ['geography', 'communityNeed', 'localSupport', 'developer', 'design', 'other'];

    /* Update each factor card */
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var val = scores[k];
      var w = SCORING_WEIGHTS[k];
      var color = _getFactorColor(k, val);

      /* Points badge */
      var ptsEl = document.getElementById('qsim_pts_' + k);
      if (ptsEl) {
        ptsEl.textContent = val.toFixed(1) + ' / ' + w.maxPts;
        ptsEl.className = 'qsim-card-pts qsim-card-pts--' + color;
      }

      /* Bar fill */
      var barEl = document.getElementById('qsim_bar_' + k);
      if (barEl) {
        var pct = w.maxPts > 0 ? (val / w.maxPts * 100) : 0;
        barEl.style.width = Math.min(pct, 100) + '%';
        barEl.className = 'qsim-bar-fill qsim-bar-fill--' + color;
      }
    }

    /* Update total */
    var totalVal = document.getElementById('qsim_total_val');
    if (totalVal) totalVal.textContent = total.toFixed(1);

    var assessEl = document.getElementById('qsim_total_assess');
    if (assessEl) {
      assessEl.textContent = assessment.text;
      assessEl.className = 'qsim-total-assess qsim-total-assess--' + assessment.cls;
    }

    /* Update gauge fill */
    var gaugeFill = document.getElementById('qsim_gauge_fill');
    if (gaugeFill) {
      gaugeFill.style.width = Math.min(total, 100) + '%';
      var gaugeCls = 'qsim-gauge-fill';
      if (total >= AVG_WINNER_TOTAL)     gaugeCls += ' qsim-gauge-fill--good';
      else if (total >= AVG_LOSER_TOTAL) gaugeCls += ' qsim-gauge-fill--warn';
      else                               gaugeCls += ' qsim-gauge-fill--bad';
      gaugeFill.className = gaugeCls;
    }
  }

  /* ── Public API: render ─────────────────────────────────────────── */

  /**
   * Render the QAP Simulator into a container element.
   * @param {string} containerId - DOM id of the mount point
   */
  function render(containerId) {
    _containerId = containerId;
    var container = document.getElementById(containerId);
    if (!container) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[QAPSimulator] Mount element #' + containerId + ' not found.');
      }
      return;
    }

    _injectCSS();
    _initState();

    /* Root wrapper */
    var root = _el('div', { className: 'qsim', role: 'region', 'aria-label': 'CHFA QAP Competitiveness Simulator' });

    /* Header */
    var hdr = _el('div', { className: 'qsim-hdr' });
    hdr.appendChild(_el('h2', null, 'CHFA QAP Competitiveness Simulator'));
    hdr.appendChild(_el('p', null, 'Estimates based on 2015\u20132025 historical award patterns. Not official CHFA scoring.'));
    root.appendChild(hdr);

    /* Factor cards grid */
    var grid = _el('div', { className: 'qsim-grid' });
    var factorKeys = ['geography', 'communityNeed', 'localSupport', 'developer', 'design', 'other'];
    for (var i = 0; i < factorKeys.length; i++) {
      grid.appendChild(_buildFactorCard(factorKeys[i]));
    }
    root.appendChild(grid);

    /* Total score bar */
    root.appendChild(_buildTotalBar());

    /* Disclaimer */
    root.appendChild(_el('p', { className: 'qsim-disclaimer' },
      'This simulator provides rough estimates based on historical CHFA QAP patterns. Actual scoring criteria change with each QAP cycle. Consult CHFA directly for current scoring guidance.'));

    /* Mount */
    container.innerHTML = '';
    container.appendChild(root);

    /* Initial calculation */
    _recalculate();
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  return {
    render:      render,
    /** Return current scores (for testing / integration). */
    getScores:   _calcAllScores,
    /** Return current state (for testing / integration). */
    getState:    function () { return _state; },
    /** Programmatically set state and recalculate. */
    setState:    function (newState) {
      if (!newState) return;
      for (var k in newState) {
        if (newState.hasOwnProperty(k) && _state.hasOwnProperty(k)) {
          _state[k] = newState[k];
        }
      }
      _recalculate();
    }
  };
}));
