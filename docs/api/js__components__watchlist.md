# `js/components/watchlist.js`

## Symbols

### `renderToggle(opts)`

Build a star toggle button for one jurisdiction. The button label/state
stays in sync with localStorage — click → toggles → updates label.
@param {Object} opts {geoid, name, type, fips}
@returns {HTMLButtonElement}

### `renderPanel(opts)`

Mount a small fixed corner panel that shows the saved jurisdictions.
Idempotent — calling twice doesn't double-mount. Default position is
bottom-right; opts.position can override ('bottom-left' etc.).

### `autoWireMarkers(root)`

Resolve the current page's active jurisdiction. Tries WorkflowState
first; falls back to URL `?fips=` / `?geoid=` params. Returns null if
no jurisdiction context — caller shows the empty-add prompt.
/
    function _currentJurisdiction() {
      // F224 — URL-first detection. Previously WorkflowState was preferred,
      // which on Compare (where state is multi-selection via ?jurisdictions=)
      // silently fell back to whatever stale jurisdiction the WorkflowState
      // held from a prior session — so "Save current" saved the wrong place.
      // Now we read URL params first (most authoritative for the page the
      // user is actually viewing) then fall back to WorkflowState.
      try {
        var params = new URLSearchParams(window.location.search);
        // Compare uses ?jurisdictions=GEOID1,GEOID2,... (plural). Take the first.
        var multi = params.get('jurisdictions');
        if (multi) {
          var firstGeoid = (multi.split(',')[0] || '').trim().replace(/\D/g, '');
          if (firstGeoid) {
            return { geoid: firstGeoid, name: 'Compare jurisdiction',
                     type: firstGeoid.length === 5 ? 'county' : 'place',
                     fips: firstGeoid.length === 5 ? firstGeoid : null };
          }
        }
        var g = (params.get('geoid') || params.get('fips') || '').replace(/\D/g, '');
        if (g) {
          return { geoid: g, name: 'Current jurisdiction',
                   type: g.length === 5 ? 'county' : 'place',
                   fips: g.length === 5 ? g : null };
        }
      } catch (_) {}
      // WorkflowState fallback
      try {
        var proj = global.WorkflowState && global.WorkflowState.getActiveProject &&
                   global.WorkflowState.getActiveProject();
        var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
        if (jx && (jx.geoid || jx.fips)) {
          return {
            geoid: jx.geoid || jx.fips,
            name:  jx.name || 'Active jurisdiction',
            type:  jx.geoType || (jx.fips && !jx.geoid ? 'county' : 'place'),
            fips:  jx.fips || null
          };
        }
      } catch (_) {}
      return null;
    }
    function _addCurrentBtn() {
      var jx = _currentJurisdiction();
      if (!jx) return '';
      var on = contains(jx.geoid);
      var label = on ? '★ ' + _esc(jx.name) + ' saved' : '☆ Save "' + _esc(jx.name) + '" to watchlist';
      return '<button type="button" id="coho-watchlist-add-current" data-geoid="' + _esc(jx.geoid) + '" ' +
                'data-name="' + _esc(jx.name) + '" data-type="' + _esc(jx.type) + '" ' +
                'data-fips="' + _esc(jx.fips || '') + '" ' +
                'style="display:block;width:100%;padding:7px 10px;margin-bottom:8px;' +
                       'background:' + (on ? 'var(--accent-dim)' : 'var(--card)') + ';' +
                       'border:1px solid ' + (on ? 'var(--accent)' : 'var(--border)') + ';' +
                       'color:' + (on ? 'var(--accent)' : 'var(--text)') + ';' +
                       'border-radius:var(--radius-sm);font-weight:600;font-size:.82rem;cursor:pointer;text-align:left;">' +
        label + '</button>';
    }
    function _refresh() {
      var arr = list();
      if (countEl) countEl.textContent = '(' + arr.length + ')';
      if (!bodyEl) return;
      var addCurrentHtml = _addCurrentBtn();
      if (!arr.length) {
        bodyEl.innerHTML = addCurrentHtml +
          '<p style="color:var(--muted);font-size:.78rem;margin:0;">No saved jurisdictions yet. ' +
          (addCurrentHtml ? 'Click above to save the current one.' : 'Open an HNA/OF/PMA page to start saving.') +
          '</p>';
        _wireAddCurrent();
        return;
      }
      // Build entries with quick re-jump links + the add-current button
      bodyEl.innerHTML = addCurrentHtml + arr.map(function (entry) {
        var hnaUrl = 'housing-needs-assessment.html?fips=' + encodeURIComponent(entry.geoid);
        var ofUrl  = 'lihtc-opportunity-finder.html';
        var pmaUrl = 'market-analysis.html?fips=' + encodeURIComponent(entry.fips || entry.geoid);
        var icUrl  = 'ic-summary.html?geoid=' + encodeURIComponent(entry.geoid);
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:.4rem;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-weight:600;color:var(--text);">' + _esc(entry.name) + '</div>' +
            '<div style="display:flex;gap:.5rem;flex-wrap:wrap;font-size:.74rem;margin-top:2px;">' +
              '<a href="' + hnaUrl + '" style="color:var(--accent);text-decoration:none;">HNA</a>' +
              '<a href="' + ofUrl  + '" style="color:var(--accent);text-decoration:none;">OF</a>' +
              '<a href="' + pmaUrl + '" style="color:var(--accent);text-decoration:none;">PMA</a>' +
              '<a href="' + icUrl  + '" style="color:var(--accent);text-decoration:none;">IC</a>' +
            '</div>' +
          '</div>' +
          '<button type="button" aria-label="Remove ' + _esc(entry.name) + ' from watchlist" ' +
                  'data-geoid="' + _esc(entry.geoid) + '" ' +
                  'style="background:none;border:none;color:var(--faint);font-size:1rem;cursor:pointer;padding:2px 6px;">✕</button>' +
        '</div>';
      }).join('');
      // Wire the X buttons (skip the add-current button which has its own handler)
      bodyEl.querySelectorAll('button[data-geoid]').forEach(function (b) {
        if (b.id === 'coho-watchlist-add-current') return;
        b.addEventListener('click', function () { remove(b.getAttribute('data-geoid')); });
      });
      _wireAddCurrent();
    }
    function _wireAddCurrent() {
      var addBtn = document.getElementById('coho-watchlist-add-current');
      if (!addBtn) return;
      addBtn.addEventListener('click', function () {
        toggle({
          geoid: addBtn.getAttribute('data-geoid'),
          name:  addBtn.getAttribute('data-name'),
          type:  addBtn.getAttribute('data-type'),
          fips:  addBtn.getAttribute('data-fips')
        });
      });
    }
    _refresh();
    onChange(_refresh);
    document.addEventListener('watchlist:changed', _refresh);
  }

  // ── DOM marker auto-wire ──────────────────────────────────────────────
  /**
Auto-replace <span data-watchlist-toggle data-geoid="..." data-name="..."
data-type="..." data-fips="..."></span> markers with star buttons.
Run once on DOMContentLoaded; also exposed for late-render pages.
