#!/usr/bin/env node
'use strict';

const assert = require('assert');
const nodemailer = require('nodemailer');

async function main() {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  assert.equal(typeof transporter.sendMail, 'function', 'transport exposes sendMail');

  const info = await transporter.sendMail({
    from: 'COHO Analytics <audit@cohoanalytics.com>',
    to: 'qa@example.com',
    subject: 'Nodemailer v9 smoke test',
    text: 'This message is captured by jsonTransport and never sent over SMTP.',
  });

  assert(info.messageId, 'sendMail returns a messageId');
  assert.equal(typeof info.message, 'string', 'jsonTransport returns serialized message content');

  const message = JSON.parse(info.message);
  assert.equal(message.subject, 'Nodemailer v9 smoke test', 'message subject survives transport');
  assert.equal(message.to[0].address, 'qa@example.com', 'recipient survives transport');

  console.log('Nodemailer v9 smoke test: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
