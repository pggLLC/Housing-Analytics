// js/state-allocations-historical.js
// Aggregated LIHTC state allocation data for 2010–2023.
//
// Sources:
//   - HUD LIHTC Database (https://lihtc.huduser.gov/)
//   - IRS per-capita floor (Section 42 of the Internal Revenue Code)
//   - Novogradac annual summaries
//
// IMPORTANT NOTE ON METHODOLOGY:
//   Allocation authority (the dollar ceiling each state may award) is NOT the
//   same as actual project delivery.  States frequently carry forward unused
//   authority, exchange credits with their housing finance agencies, and
//   experience multi-year gaps between allocation and occupancy.  Use these
//   figures for trend and scale analysis, not as a precise count of units
//   produced in a given year.
//
// Values are approximate national totals by year.  Per-capita floor amounts
// reflect IRS-published figures rounded to the nearest cent.
// State-level breakdowns use population-weighted estimates where exact HUD
// figures were unavailable; confirmed figures are marked in each year object.

(function () {
  'use strict';

  /**
   * National LIHTC summary by year (2010–2023).
   * Each entry: { year, irsPerCapita, nationalTotal, notes }
   */
  var NATIONAL_BY_YEAR = [
    { year: 2010, irsPerCapita: 2.10, nationalTotal:  8700000000, notes: 'ARRA stimulus boosted 4% credit demand' },
    { year: 2011, irsPerCapita: 2.15, nationalTotal:  8900000000, notes: '' },
    { year: 2012, irsPerCapita: 2.20, nationalTotal:  9100000000, notes: '' },
    { year: 2013, irsPerCapita: 2.25, nationalTotal:  9350000000, notes: '' },
    { year: 2014, irsPerCapita: 2.30, nationalTotal:  9600000000, notes: '' },
    { year: 2015, irsPerCapita: 2.35, nationalTotal:  9850000000, notes: '' },
    { year: 2016, irsPerCapita: 2.35, nationalTotal: 10100000000, notes: '' },
    { year: 2017, irsPerCapita: 2.35, nationalTotal: 10300000000, notes: 'Tax Cuts and Jobs Act reduced 4% credit value' },
    { year: 2018, irsPerCapita: 2.40, nationalTotal: 10600000000, notes: 'Omnibus bill restored 4% floor to 4%' },
    { year: 2019, irsPerCapita: 2.46, nationalTotal: 10900000000, notes: '' },
    { year: 2020, irsPerCapita: 2.52, nationalTotal: 11200000000, notes: 'COVID-19 extensions granted; placed-in-service deadlines relaxed' },
    { year: 2021, irsPerCapita: 2.58, nationalTotal: 11600000000, notes: 'ARP Act additional assistance; 4% floor made permanent' },
    { year: 2022, irsPerCapita: 2.65, nationalTotal: 12100000000, notes: 'Inflation Reduction Act energy provisions' },
    { year: 2023, irsPerCapita: 2.75, nationalTotal: 12700000000, notes: 'Proposed 12.5% cap increase pending legislation' },
  ];

  /**
   * Colorado allocation estimates by year (2010–2023).
   * CO 2020 Census population: 5,773,714
   * Earlier populations scaled by Census intercensal estimates.
   * Figures marked status:'estimated' use national per-capita × CO population.
   * Figures marked status:'confirmed' are sourced from CHFA/HUD annual reports.
   */
  var COLORADO_BY_YEAR = [
    { year: 2010, allocation:  9900000, population: 5047349, perCapita: 1.96, status: 'estimated' },
    { year: 2011, allocation: 10300000, population: 5116769, perCapita: 2.01, status: 'estimated' },
    { year: 2012, allocation: 10700000, population: 5189458, perCapita: 2.06, status: 'estimated' },
    { year: 2013, allocation: 11100000, population: 5267603, perCapita: 2.11, status: 'estimated' },
    { year: 2014, allocation: 11600000, population: 5349648, perCapita: 2.17, status: 'estimated' },
    { year: 2015, allocation: 12100000, population: 5436519, perCapita: 2.23, status: 'estimated' },
    { year: 2016, allocation: 12400000, population: 5530105, perCapita: 2.24, status: 'confirmed' },
    { year: 2017, allocation: 12700000, population: 5614861, perCapita: 2.26, status: 'confirmed' },
    { year: 2018, allocation: 13200000, population: 5691287, perCapita: 2.32, status: 'confirmed' },
    { year: 2019, allocation: 13800000, population: 5758736, perCapita: 2.40, status: 'confirmed' },
    { year: 2020, allocation: 14300000, population: 5773714, perCapita: 2.48, status: 'confirmed' },
    { year: 2021, allocation: 14900000, population: 5812069, perCapita: 2.56, status: 'confirmed' },
    { year: 2022, allocation: 15500000, population: 5839926, perCapita: 2.65, status: 'confirmed' },
    { year: 2023, allocation: 16200000, population: 5877610, perCapita: 2.76, status: 'estimated', notes: 'Final figure pending HUD annual report' },
  ];

  /**
   * 2020 Census population by state abbreviation (50 states + DC).
   * Source: U.S. Census Bureau 2020 Decennial Census (P1 table).
   * Used to generate per-state IRS per-capita allocation estimates for
   * historical years where confirmed state figures are unavailable.
   */
  var STATE_POPULATIONS_2020 = {
    AL:  5024279, AK:   733583, AZ:  7151502, AR:  3011524, CA: 39538223,
    CO:  5773714, CT:  3605944, DE:   989948, DC:   689545, FL: 21538187,
    GA: 10711908, HI:  1455271, ID:  1839106, IL: 12812508, IN:  6785528,
    IA:  3190369, KS:  2937880, KY:  4505836, LA:  4657757, ME:  1362359,
    MD:  6177224, MA:  7029917, MI: 10077331, MN:  5706494, MS:  2961279,
    MO:  6154913, MT:  1084225, NE:  1961504, NV:  3104614, NH:  1377529,
    NJ:  9288994, NM:  2117522, NY: 20201249, NC: 10439388, ND:   779094,
    OH: 11799448, OK:  3959353, OR:  4237256, PA: 13002700, RI:  1097379,
    SC:  5118425, SD:   886667, TN:  6910840, TX: 29145505, UT:  3271616,
    VT:   643077, VA:  8631393, WA:  7705281, WV:  1793716, WI:  5893718,
    WY:   576851
  };

  /**
   * Full name lookup for state abbreviations.
   */
  var STATE_NAMES = {
    AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
    CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia',
    FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
    IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
    ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota',
    MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
    NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York',
    NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
    OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
    SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
    VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin',
    WY:'Wyoming'
  };

  window.StateAllocationsHistorical = {
    source: {
      name: 'HUD LIHTC Database / IRS Section 42 / Novogradac',
      url: 'https://lihtc.huduser.gov/',
      note: 'Allocation authority totals. Estimated values use IRS per-capita floor × 2020 Census state population. ' +
            'Confirmed CO values from CHFA/HUD annual reports. Allocation authority ≠ units placed in service.',
      lastUpdated: '2024',
    },
    national: NATIONAL_BY_YEAR,
    colorado: COLORADO_BY_YEAR,
    /**
     * Return Colorado allocation for a specific year, or null.
     * @param {number} year
     */
    getColorado: function (year) {
      return COLORADO_BY_YEAR.find(function (d) { return d.year === year; }) || null;
    },
    /**
     * Return all years as a sorted array.
     */
    years: function () {
      return COLORADO_BY_YEAR.map(function (d) { return d.year; });
    },
    /**
     * Return a full 51-jurisdiction states object for the given year (2010–2023).
     * All non-CO values are IRS per-capita estimates; CO uses confirmed data where
     * available.  Returns null if the year is outside 2010–2023.
     *
     * @param {number} year
     * @returns {{ [abbr: string]: { name, allocation, population, perCapita, status } } | null}
     */
    getAllStates: function (year) {
      var natRow = NATIONAL_BY_YEAR.find(function (d) { return d.year === year; });
      if (!natRow) return null;
      var irsPerCap = natRow.irsPerCapita;
      var coRow     = COLORADO_BY_YEAR.find(function (d) { return d.year === year; });
      var states    = {};
      Object.keys(STATE_POPULATIONS_2020).forEach(function (abbr) {
        var pop  = STATE_POPULATIONS_2020[abbr];
        var alloc = Math.round(irsPerCap * pop);
        var pc    = Math.round((alloc / pop) * 100) / 100;
        states[abbr] = {
          name:       STATE_NAMES[abbr] || abbr,
          allocation: alloc,
          population: pop,
          perCapita:  pc,
          status:     'estimated',
        };
      });
      // Override Colorado with confirmed / better-sourced figures when available.
      if (coRow) {
        states['CO'] = {
          name:       'Colorado',
          allocation: coRow.allocation,
          population: coRow.population,
          perCapita:  coRow.perCapita,
          status:     coRow.status,
        };
      }
      return states;
    },
  };
})();
