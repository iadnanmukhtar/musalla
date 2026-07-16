const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test('schedule updates use the dotenv sender and include recipients once', async () => {
  const previous = {
    SMTP_HOST: process.env.SMTP_HOST,
    MAIL_FROM: process.env.MAIL_FROM,
    createTransport: nodemailer.createTransport
  };
  process.env.SMTP_HOST = 'smtp.test';
  process.env.MAIL_FROM = 'Musalla Local <developer@gmail.com>';
  let sent;
  nodemailer.createTransport = () => ({ sendMail: async message => { sent = message; } });
  delete require.cache[require.resolve('../src/email')];
  const { notifyMusallaImamsAndAdmins } = require('../src/email');
  const pool = {
    execute: async () => [[
      { email: 'imam@example.com' },
      { email: 'admin@example.com' },
      { email: 'IMAM@example.com' }
    ]]
  };

  try {
    const delivered = await notifyMusallaImamsAndAdmins(pool, 7, {
      subject: 'Schedule updated', heading: 'Schedule updated', message: 'A slot changed.'
    });
    assert.equal(delivered, true);
    assert.equal(sent.from, process.env.MAIL_FROM);
    assert.equal(sent.bcc, 'imam@example.com,admin@example.com');
  } finally {
    nodemailer.createTransport = previous.createTransport;
    if (previous.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previous.SMTP_HOST;
    if (previous.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previous.MAIL_FROM;
    delete require.cache[require.resolve('../src/email')];
  }
});
