/**
 * Step 7 — rendering the recommendation.
 *
 * Conclusion first, in the literal sense: the verdict and the sentence that
 * explains it are the first two things on the page, before any table, and the
 * evidence that produced them is underneath, collapsed. A reader who opens
 * this page and reads nothing else should still leave with the answer.
 *
 * The three states are drawn as three different things, not three colours of
 * the same thing. An insufficient verdict does not get a number with a warning
 * icon beside it — it gets a sentence saying no recommendation was reached and
 * a list of what is missing. Half of Colorado's 546 jurisdictions land there,
 * so it has to read as a real outcome rather than a broken page.
 *
 * Everything here reads RecommendationContract's output. It never reaches into
 * another page's DOM.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root && root.RecommendationContract);
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./recommendation-contract.js'));
  }
  if (root) root.RecommendationPage = api;
}(typeof window !== 'undefined' ? window : this, function (Contract) {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var STATE_WORD = {
    established: 'Established',
    provisional: 'Provisional',
    insufficient: 'Insufficient evidence'
  };

  function stateChip(state) {
    return '<span class="rec-chip" data-state="' + esc(state) + '">' + esc(STATE_WORD[state] || state) + '</span>';
  }

  function formatValue(item) {
    if (item.value === null || item.value === undefined) return 'no figure';
    if (typeof item.value === 'number') {
      return item.unit === 'pct'
        ? item.value + '%'
        : item.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return String(item.value);
  }

  function renderEvidence(items) {
    var rows = items.map(function (item) {
      var borrowed = item.borrowedFrom
        ? '<span class="rec-borrowed">from ' + esc(item.borrowedFrom.replace(/_/g, ' ')) + '</span>'
        : '';
      return '<tr data-state="' + esc(item.state) + '">'
        + '<th scope="row">' + esc(item.label) + '</th>'
        + '<td>' + esc(formatValue(item)) + ' ' + borrowed + '</td>'
        + '<td>' + stateChip(item.state) + '</td>'
        + '<td>' + esc(item.source || 'source not recorded')
        + (item.asOf ? ' <span class="rec-asof">' + esc(item.asOf) + '</span>' : '') + '</td>'
        + '<td>' + esc(item.why || '') + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="rec-table-wrap"><table class="rec-table">'
      + '<thead><tr><th scope="col">Measure</th><th scope="col">Value</th>'
      + '<th scope="col">Standing</th><th scope="col">Source</th>'
      + '<th scope="col">Why it stands there</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>';
  }

  function renderConclusion(item) {
    var blocking = item.blocking.length
      ? '<ul class="rec-blocking">' + item.blocking.map(function (line) {
        return '<li>' + esc(line) + '</li>';
      }).join('') + '</ul>'
      : '';
    return '<section class="rec-conclusion" data-conclusion="' + esc(item.id) + '" data-state="' + esc(item.state) + '">'
      + '<h3>' + esc(item.question) + '</h3>'
      + '<p class="rec-answer">' + (item.verdict
        ? '<strong>' + esc(item.verdict) + '</strong>'
        : '<strong class="rec-none">Not answered</strong>') + ' ' + stateChip(item.state) + '</p>'
      + '<p class="rec-plain">' + esc(item.plain) + '</p>'
      + blocking
      + (item.computedAt
        ? '<p class="rec-source-link"><a href="' + esc(item.computedAt.page)
          + '#' + esc(item.computedAt.anchor) + '">See ' + esc(item.computedAt.label)
          + ', with the working &rarr;</a></p>'
        : '')
      + '<details class="rec-evidence"><summary>Evidence ('
      + esc(item.usableCount) + ' of ' + esc(item.evidenceCount) + ' measures usable)</summary>'
      + renderEvidence(item.evidence) + '</details>'
      + '</section>';
  }

  function renderProject(steps) {
    var rows = steps.map(function (step) {
      if (step.status === 'not_run') {
        return '<li class="rec-step" data-step-key="' + esc(step.key) + '" data-status="not_run">'
          + '<span class="rec-step__label">' + esc(step.label) + '</span> '
          + '<span class="rec-step__state">not run yet</span> '
          + '<a href="' + esc(step.href) + '">Open this step</a></li>';
      }
      var fields = step.fields.length
        ? '<dl class="rec-step__fields">' + step.fields.map(function (field) {
          return '<dt>' + esc(field.label) + '</dt><dd>' + esc(field.value) + '</dd>';
        }).join('') + '</dl>'
        : '<p class="rec-step__empty">Recorded, but it carried no values to quote back.</p>';
      return '<li class="rec-step" data-step-key="' + esc(step.key) + '" data-status="recorded">'
        + '<span class="rec-step__label">' + esc(step.label) + '</span> '
        + '<span class="rec-step__state">recorded ' + esc(String(step.recordedAt).slice(0, 10)) + '</span>'
        + fields
        // A recorded step keeps its link. It used to lose it, which had the
        // relationship backwards: the step a reader most wants to reopen is
        // the one they already did and now want to change.
        + '<p class="rec-step__link"><a href="' + esc(step.href) + '">Reopen this step</a></p>'
        + '</li>';
    }).join('');
    return '<ol class="rec-steps">' + rows + '</ol>';
  }

  function renderSources(sources) {
    if (!sources.length) return '';
    return '<ul class="rec-sources">' + sources.map(function (item) {
      return '<li><code>' + esc(item.source) + '</code>'
        + (item.asOf ? ' &mdash; ' + esc(item.asOf) : '') + '</li>';
    }).join('') + '</ul>';
  }

  function render(mount, contract) {
    if (!mount) throw new Error('RecommendationPage.render: no mount element');
    var head = contract.headline;
    var where = contract.geography ? contract.geography.name : null;
    mount.innerHTML =
      '<section class="rec-headline" data-state="' + esc(head.state) + '"'
      + (contract.geography ? ' data-geoid="' + esc(contract.geography.geoid) + '"' : '') + '>'
      + '<p class="rec-headline__eyebrow">' + (where ? esc(where) : 'No jurisdiction') + '</p>'
      + '<h2 class="rec-headline__verdict">' + esc(head.verdict) + '</h2>'
      + '<p class="rec-headline__plain">' + esc(head.plain) + '</p>'
      + '</section>'
      + (contract.conclusions.length
        ? '<div class="rec-conclusions">' + contract.conclusions.map(renderConclusion).join('') + '</div>'
        : '')
      + '<section class="rec-project"><h2>What you have recorded</h2>'
      + '<p class="rec-plain">These are quoted from the steps you completed, exactly as each '
      + 'page saved them. Nothing here is recalculated.</p>'
      + renderProject(contract.project) + '</section>'
      + (contract.sources.length
        ? '<section class="rec-sourcelist"><h2>Where the figures come from</h2>'
          + renderSources(contract.sources) + '</section>'
        : '');
    return mount;
  }

  /* ── Export ──────────────────────────────────────────────────────────────
     Built from the contract, in the visual idiom of hna-export's structured
     PDF (Letter portrait, 0.6" margins, accent section heads, a methodology
     table at the end). Deliberately NOT hna-export itself: that function reads
     the HNA page's DOM and its live Chart.js canvases, so on this page it
     would export someone else's screen. */

  function pdfFilename(contract) {
    var stem = contract.geography ? contract.geography.name : 'no-jurisdiction';
    return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-recommendation.pdf';
  }

  function exportPdf(contract, jsPDFCtor) {
    var pdf = new jsPDFCtor({ orientation: 'p', unit: 'pt', format: 'letter' });
    var PAGE_W = pdf.internal.pageSize.getWidth();
    var PAGE_H = pdf.internal.pageSize.getHeight();
    var MARGIN = 43;
    var WIDTH = PAGE_W - (2 * MARGIN);
    var ACCENT = [9, 110, 101];
    var INK = [40, 40, 40];
    var MUTED = [110, 110, 110];
    var y = MARGIN;

    function space(needed) {
      if (y + needed > PAGE_H - MARGIN) { pdf.addPage(); y = MARGIN; }
    }
    function text(value, size, style, color, gap) {
      pdf.setFontSize(size);
      pdf.setFont('helvetica', style);
      pdf.setTextColor(color[0], color[1], color[2]);
      var lines = pdf.splitTextToSize(String(value), WIDTH);
      space(lines.length * (size + 3) + (gap || 0));
      pdf.text(lines, MARGIN, y);
      y += lines.length * (size + 3) + (gap || 6);
    }

    var where = contract.geography ? contract.geography.name : 'No jurisdiction selected';
    text('Housing recommendation — ' + where, 16, 'bold', ACCENT, 4);
    text('Screening synthesis. Not a housing needs study, and not underwriting.', 9, 'normal', MUTED, 12);

    text(contract.headline.verdict, 14, 'bold', INK, 4);
    text(contract.headline.plain, 10, 'normal', INK, 14);

    contract.conclusions.forEach(function (item) {
      text(item.question, 11, 'bold', ACCENT, 2);
      text((item.verdict || 'Not answered') + '  [' + (STATE_WORD[item.state] || item.state) + ']',
        10, 'bold', INK, 2);
      text(item.plain, 9.5, 'normal', INK, 2);
      item.blocking.forEach(function (line) { text('• ' + line, 9, 'normal', MUTED, 2); });
      // A printed page cannot be clicked, so the path is spelled out. Without
      // it the PDF is the one copy of this synthesis with no way back to the
      // working, and it is the copy that gets forwarded.
      if (item.computedAt) {
        text('Shown in full on ' + item.computedAt.page + ' \u2014 ' + item.computedAt.label,
          8.5, 'italic', MUTED, 2);
      }
      y += 8;
    });

    text('What the reader recorded', 11, 'bold', ACCENT, 4);
    contract.project.forEach(function (step) {
      if (step.status === 'not_run') {
        text(step.label + ' — not run', 9.5, 'normal', MUTED, 2);
        return;
      }
      var quoted = step.fields.map(function (f) { return f.label + ': ' + f.value; }).join('  ·  ');
      text(step.label + ' — recorded ' + String(step.recordedAt).slice(0, 10)
        + (quoted ? '  ·  ' + quoted : ''), 9.5, 'normal', INK, 2);
    });
    y += 10;

    text('Sources', 11, 'bold', ACCENT, 4);
    contract.sources.forEach(function (item) {
      text(item.source + (item.asOf ? ' — ' + item.asOf : ''), 8.5, 'normal', MUTED, 1);
    });
    return pdf;
  }

  return {
    render: render,
    renderConclusion: renderConclusion,
    renderProject: renderProject,
    pdfFilename: pdfFilename,
    exportPdf: exportPdf,
    STATE_WORD: STATE_WORD,
    Contract: Contract
  };
}));
