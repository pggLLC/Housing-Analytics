# `js/deal-calculator-unit-size.js`

Deal calculator: estimate gross building area from a bedroom mix (#1814).

Pure functions, no DOM. The rules the UI relies on:
  - nothing is derived without an explicit reference standard;
  - a mix that has units of a bedroom type the standard does not size
    yields NO estimate (blank means blank, never a guess from partial data);
  - gross = net / efficiency, and the efficiency is an input the caller
    discloses, never a hidden constant.

## Symbols

### `workingText(result, standard)`

One-line working the UI shows beside the estimate, so the figure is never bare.
