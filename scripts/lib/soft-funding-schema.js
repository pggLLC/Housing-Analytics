'use strict';

const Ajv2020 = require('ajv/dist/2020');
const schema = require('../../schemas/soft-funding-status.schema.json');

const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('date', value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
ajv.addFormat('https-url', value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
});

// The CLI and invented fixtures use the same schema, including required keys.
module.exports = ajv.compile(schema);
