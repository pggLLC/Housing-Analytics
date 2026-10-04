/** One explicit jsPDF test double. Unknown APIs throw even when an exporter probes them. */
'use strict';
const assert = require('node:assert/strict');
function createJsPdfMock({ width = 612, height = 792, wrapText = false } = {}) {
  const calls = [], text = [], savedFilenames = [], unsupported = [];
  let properties;
  function strict(target, path) {
    return new Proxy(target, { get(object, key, receiver) {
      if (typeof key === 'symbol' || Reflect.has(object, key)) return Reflect.get(object, key, receiver);
      const message = 'jsPDF mock does not implement ' + path + '.' + key + '; add the API to test/helpers/jspdf-mock.cjs';
      unsupported.push(message);
      throw new Error(message);
    } });
  }
  function jsPDF() {
    let page = 1, pages = 1, fontSize = 10, instance;
    const record = (method, args) => calls.push({ method, args, page, fontSize });
    const pdf = { internal: strict({
      pageSize: strict({ getWidth: () => width, getHeight: () => height }, 'internal.pageSize'),
      getNumberOfPages: () => pages,
    }, 'internal') };
    for (const method of ['addImage', 'line', 'rect', 'roundedRect', 'setDrawColor', 'setFillColor', 'setFont', 'setLineWidth', 'setTextColor']) {
      pdf[method] = (...args) => { record(method, args); return instance; };
    }
    pdf.addPage = (...args) => { page = ++pages; record('addPage', args); return instance; };
    pdf.setPage = number => { page = number; record('setPage', [number]); return instance; };
    pdf.setFontSize = size => { fontSize = size; record('setFontSize', [size]); return instance; };
    pdf.setProperties = value => { properties = value; record('setProperties', [value]); return instance; };
    pdf.save = filename => { savedFilenames.push(filename); record('save', [filename]); return instance; };
    pdf.splitTextToSize = (value, availableWidth) => {
      const lines = (Array.isArray(value) ? value : [value]).flatMap(line => String(line == null ? '' : line).split('\n'));
      if (!wrapText) return lines;
      const columns = Math.max(1, Math.floor(availableWidth / (fontSize * .6)));
      return lines.flatMap(line => line.match(new RegExp('.{1,' + columns + '}', 'gu')) || ['']);
    };
    pdf.text = (...args) => {
      (Array.isArray(args[0]) ? args[0] : [args[0]]).forEach(value => text.push(String(value == null ? '' : value)));
      record('text', args); return instance;
    };
    instance = strict(pdf, 'jsPDF');
    return instance;
  }
  return { jsPDF, calls, text, savedFilenames, get saved() { return savedFilenames.length > 0; },
    get properties() { return properties; },
    // Also expose swallowed export errors to tests whose production path catches exceptions.
    assertSupported() { assert.deepEqual(unsupported, [], unsupported.join('\n')); } };
}
module.exports = { createJsPdfMock };
