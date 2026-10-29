# `js/whitepaper/ask-pggllc.js`

ask-pggllc.js — "Ask pggLLC" on the gated developer pages: anyone signed in
asks for a clarification, and pggLLC answers in the same list, so everyone
let into the site reads the answer. Nothing is emailed.

The questions are saved on the private site (/api/questions, coho-backend).
On any other copy of the page the form says where questions are kept instead
of pretending to send.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.AskPggllc in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
