[File contents - displaying lines 1600-1700 with fixes applied]

   * renderChasAffordabilityGap — render a stacked bar chart showing renter
   * cost burden by AMI tier from HUD CHAS data for the selected county.
   *
   * HUD CHAS is published at county granularity. When the user selected a
   * place or CDP, this chart shows their CONTAINING county's CHAS data —
   * not place-level. The optional `selectedGeo` argument lets callers
   * pass the user's actual selection so the renderer can surface a
   * prominent "scaled from county" disclosure inline above the chart.
   * Without this disclosure, a place/CDP user sees county data labeled
   * with the county name and may not realize the proxy is happening.
   *
   * @param {string} countyFips5 - 5-digit county FIPS to look up
   * @param {object|null} chasData - pre-loaded chas_affordability_gap.json
   * @param {{type:string, geoid:string, name:string}} [selectedGeo] -
   *   User's selected geography. If type is 'place' or 'cdp' and the
   *   geoid differs from countyFips5, an inline proxy disclosure renders.
   */

  function renderChasAffordabilityGap(countyFips5, chasData, selectedGeo) {
    const canvas = document.getElementById('chartChasGap');
    const statusEl = document.getElementById('chasGapStatus');
    if (!canvas) return;

    // Render or clear the proxy-disclosure note above the chart. Mounts
    // into a sibling div #chartChasGapProxyNote (created lazily so the
    // page HTML doesn't need to change). Visible only when a sub-county
    // geography is selected AND county data was actually resolved.
    const _renderProxyNote = (countyName) => {
      let noteEl = document.getElementById('chartChasGapProxyNote');
      const isProxy = selectedGeo &&
        (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') &&
        selectedGeo.geoid && selectedGeo.geoid !== countyFips5 &&
        countyFips5; // Guard: only show if county data was actually resolved
      if (!isProxy) {
        if (noteEl) noteEl.remove();
        return;
      }
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.id = 'chartChasGapProxyNote';
        noteEl.setAttribute('role', 'note');
        noteEl.style.cssText =
          'margin:0 0 .5rem;padding:.5rem .75rem;border-left:3px solid var(--warn,#d97706);' +
          'border-radius:0 4px 4px 0;background:var(--warn-dim,#fef3c7);font-size:.78rem;' +
          'line-height:1.45;color:var(--text);';
        const wrap = canvas.closest('.chart-card') || canvas.parentElement;
        if (wrap) wrap.insertBefore(noteEl, wrap.firstChild.nextSibling);
      }
      const placeLabel = selectedGeo.name || 'this place';
      const safePlace = String(placeLabel).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const safeCounty = String(countyName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      
      // Build warning text using textContent + createElement for safety
      const intro = document.createElement('strong');
      intro.style.color = 'var(--warn,#d97706)';
      intro.textContent = '⚠ Scaled from county data.';
      
      const body = document.createTextNode(
        'HUD CHAS publishes cost-burden tables at county granularity only. ' +
        'You selected '
      );
      
      const placeStrong = document.createElement('strong');
      placeStrong.textContent = placeLabel;
      
      const middleText = document.createTextNode('; the chart below shows ');
      
      const countyStrong = document.createElement('strong');
      countyStrong.textContent = countyName;
      
      const endText = document.createTextNode(
        ''s tier breakdown — your selected ' +
        'place's actual mix may differ. Use this for directional context, not ' +
        'as a place-level estimate.'
      );
      
      // Clear and rebuild
      noteEl.textContent = '';
      noteEl.appendChild(intro);
      noteEl.appendChild(document.createTextNode(' '));
      noteEl.appendChild(body);
      noteEl.appendChild(placeStrong);
      noteEl.appendChild(middleText);
      noteEl.appendChild(countyStrong);
      noteEl.appendChild(endText);
    };
