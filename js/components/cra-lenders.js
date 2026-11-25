/*
 * Colorado lenders and CDFIs active in tax credit deals, drawn into #dcCraGrid on deal-reference.html.
 * Moved word for word from deal-calculator.html's own script when the reading below the calculator moved to its own
 * page (paul, 25 Nov 2026, build plan item 10). One list, one place.
 */
(function () {
  'use strict';
  var CRA_LENDERS = [
    {
      name: 'Wells Fargo',
      role: 'National LIHTC equity investor and construction lender. One of the largest affordable housing equity investors in the country. Active in Colorado new construction and preservation.',
      tags: ['Equity', 'Construction', 'Permanent']
    },
    {
      name: 'U.S. Bancorp Community Development Corporation',
      role: 'Major LIHTC syndicator through USBCDC. Consistent equity investor in Colorado 9% and 4% deals. Also provides construction financing.',
      tags: ['Equity', 'Construction']
    },
    {
      name: 'JPMorgan Chase',
      role: 'Affordable housing equity investment and construction lending. CRA-active nationally and in Colorado Front Range markets.',
      tags: ['Equity', 'Construction']
    },
    {
      name: 'FirstBank Colorado',
      role: 'Colorado-headquartered bank with strong CRA presence. Provides construction financing for affordable multifamily. Active along the Front Range.',
      tags: ['Construction', 'CRA-active']
    },
    {
      name: 'Vectra Bank Colorado',
      role: 'Regional bank providing construction and mini-perm lending for affordable housing. Front Range and mountain community focus. CRA-motivated lending.',
      tags: ['Construction']
    },
    {
      name: 'Colorado Housing Assistance Corporation (CHAC)',
      role: 'Non-bank CDFI providing subordinate debt for affordable homeownership and rental projects. Frequently stacked in LIHTC capital structures as gap filler.',
      tags: ['Subordinate Debt', 'CDFI']
    },
    {
      name: 'Colorado Housing and Finance Authority (CHFA)',
      role: 'State HFA providing subordinate loans, HOME funds, and construction-to-perm financing. CHFA is typically the allocating agency and a key program lender in every Colorado LIHTC deal.',
      tags: ['Subordinate Debt', 'HOME', 'Program Lender']
    },
    {
      name: 'CDFI Locator (Opportunity Finance Network)',
      role: 'Directory of Community Development Financial Institutions offering flexible, mission-driven capital, searchable by state. Not a single lender.',
      tags: ['CDFI Directory'],
      link: 'https://www.ofn.org/cdfi-locator/'
    }
  ];

  function populateCraGrid() {
    var grid = document.getElementById('dcCraGrid');
    if (!grid) return;
    var html = '';
    CRA_LENDERS.forEach(function (l) {
      var tagsHtml = (l.tags || []).map(function (t) {
        return '<span class="dc-cra-card__tag">' + t + '</span>';
      }).join(' ');
      var nameHtml = l.link
        ? '<a href="' + l.link + '" class="dc-cra-card__name" target="_blank" rel="noopener">' + l.name + '</a>'
        : '<div class="dc-cra-card__name">' + l.name + '</div>';
      html += '<div class="dc-cra-card">' +
        nameHtml +
        '<div class="dc-cra-card__role" data-no-source="definition">' + l.role + '</div>' +
        '<div style="margin-top:8px;">' + tagsHtml + '</div>' +
        '</div>';
    });
    grid.innerHTML = html;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', populateCraGrid);
  else populateCraGrid();
})();
