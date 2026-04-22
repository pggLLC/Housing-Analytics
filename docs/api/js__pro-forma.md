# `js/pro-forma.js`

pro-forma.js — 15-Year Operating Pro Forma Module for LIHTC Deal Calculator

ES5 IIFE pattern.  Reads year-1 values from the deal-calculator DOM,
projects rent/expense growth over a configurable horizon, and renders
an interactive table + Chart.js line chart.

Mount:  ProForma.render('containerId')
Event:  auto-updates on 'deal-calc:updated' CustomEvent.

_No documented symbols — module has a file-header comment only._
