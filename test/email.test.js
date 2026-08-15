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
  const queries = [];
  const pool = {
    execute: async sql => {
      queries.push(sql);
      if (sql.includes('FROM musalla_locations')) return [[{ enabled: 1 }]];
      return [[
        { email: 'imam@example.com' },
        { email: 'admin@example.com' },
        { email: 'IMAM@example.com' }
      ]];
    }
  };

  try {
    const delivered = await notifyMusallaImamsAndAdmins(pool, 7, {
      subject: 'Schedule updated', heading: 'Schedule updated', message: 'A slot changed.'
    });
    assert.equal(delivered, true);
    assert.equal(sent.from, process.env.MAIL_FROM);
    assert.equal(sent.bcc, 'imam@example.com,admin@example.com');
    assert.match(queries[0], /u\.notifications_enabled=TRUE/);
    assert.match(queries[1], /notifications_enabled=TRUE/);
  } finally {
    nodemailer.createTransport = previous.createTransport;
    if (previous.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previous.SMTP_HOST;
    if (previous.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previous.MAIL_FROM;
    delete require.cache[require.resolve('../src/email')];
  }
});

test('notification preferences suppress user and Musalla email delivery', async () => {
  const previous = {
    SMTP_HOST: process.env.SMTP_HOST,
    MAIL_FROM: process.env.MAIL_FROM,
    createTransport: nodemailer.createTransport
  };
  process.env.SMTP_HOST = 'smtp.test';
  process.env.MAIL_FROM = 'Musalla Local <developer@gmail.com>';
  let sendCount = 0;
  nodemailer.createTransport = () => ({ sendMail: async () => { sendCount += 1; } });
  delete require.cache[require.resolve('../src/email')];
  const { notifyMusallaImams, notifyUser } = require('../src/email');

  try {
    const optedOutUserPool = {
      execute: async sql => {
        assert.match(sql, /notifications_enabled=TRUE/);
        return [[]];
      }
    };
    assert.equal(await notifyUser(optedOutUserPool, 9, { subject: 'Direct update' }), false);

    const disabledMusallaPool = {
      execute: async sql => sql.includes('FROM musalla_locations')
        ? [[]]
        : [[{ email: 'imam@example.com' }]]
    };
    assert.equal(await notifyMusallaImams(disabledMusallaPool, 7, { subject: 'Schedule update' }), false);
    assert.equal(sendCount, 0);
  } finally {
    nodemailer.createTransport = previous.createTransport;
    if (previous.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previous.SMTP_HOST;
    if (previous.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previous.MAIL_FROM;
    delete require.cache[require.resolve('../src/email')];
  }
});

test('opted-out Imams and administrators are excluded from every Musalla recipient group', async () => {
  const previous = {
    SMTP_HOST: process.env.SMTP_HOST,
    MAIL_FROM: process.env.MAIL_FROM,
    createTransport: nodemailer.createTransport
  };
  process.env.SMTP_HOST = 'smtp.test';
  process.env.MAIL_FROM = 'Musalla Local <developer@gmail.com>';
  const sent = [];
  nodemailer.createTransport = () => ({ sendMail: async message => { sent.push(message); } });
  delete require.cache[require.resolve('../src/email')];
  const {
    notifyMusallaAdmins,
    notifyMusallaAdminsAndSuperAdmins,
    notifyMusallaImams,
    notifyMusallaImamsAndAdmins
  } = require('../src/email');
  const members = [
    { email: 'imam-enabled@example.com', role: 'imam', notifications_enabled: true },
    { email: 'imam-opted-out@example.com', role: 'imam', notifications_enabled: false },
    { email: 'admin-enabled@example.com', role: 'admin', notifications_enabled: true },
    { email: 'admin-opted-out@example.com', role: 'admin', notifications_enabled: false }
  ];
  const superAdmins = [
    { email: 'super-enabled@example.com', notifications_enabled: true },
    { email: 'super-opted-out@example.com', notifications_enabled: false }
  ];
  const pool = {
    execute: async sql => {
      if (sql.includes('FROM musalla_locations')) return [[{ enabled: 1 }]];
      let recipients = members;
      if (!sql.includes("FIND_IN_SET('imam',ms.role)>0 OR FIND_IN_SET('admin',ms.role)>0")) {
        const role = sql.includes("FIND_IN_SET('imam',ms.role)>0") ? 'imam' : 'admin';
        recipients = recipients.filter(member => member.role === role);
      }
      if (sql.includes('u.notifications_enabled=TRUE')) recipients = recipients.filter(member => member.notifications_enabled);
      return [recipients.map(({ email }) => ({ email }))];
    },
    query: async sql => {
      const recipients = sql.includes('notifications_enabled=TRUE')
        ? superAdmins.filter(user => user.notifications_enabled)
        : superAdmins;
      return [recipients.map(({ email }) => ({ email }))];
    }
  };

  try {
    await notifyMusallaImams(pool, 7, { subject: 'Imam reminder' });
    await notifyMusallaAdmins(pool, 7, { subject: 'Admin notice' });
    await notifyMusallaImamsAndAdmins(pool, 7, { subject: 'Schedule update' });
    await notifyMusallaAdminsAndSuperAdmins(pool, 7, { subject: 'Membership request' });

    assert.equal(sent[0].bcc, 'imam-enabled@example.com');
    assert.equal(sent[1].bcc, 'admin-enabled@example.com');
    assert.equal(sent[2].bcc, 'imam-enabled@example.com,admin-enabled@example.com');
    assert.equal(sent[3].bcc, 'super-enabled@example.com,admin-enabled@example.com');
    assert.ok(sent.every(message => !message.bcc.includes('opted-out')));
  } finally {
    nodemailer.createTransport = previous.createTransport;
    if (previous.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previous.SMTP_HOST;
    if (previous.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previous.MAIL_FROM;
    delete require.cache[require.resolve('../src/email')];
  }
});

test('an added-member rejection notice bypasses optional notification preferences', async () => {
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
  const { notifyRequiredUser } = require('../src/email');
  let recipientQuery;
  const pool = {
    execute: async sql => {
      recipientQuery = sql;
      return [[{ email: 'added-member@example.com' }]];
    }
  };

  try {
    const delivered = await notifyRequiredUser(pool, 22, {
      subject: 'You were added',
      heading: 'You were added to a Musalla',
      message: 'Reject this membership if you do not want it.',
      actionLabel: 'Reject membership',
      actionUrl: 'https://example.com/memberships/example-guid/reject'
    });
    assert.equal(delivered, true);
    assert.doesNotMatch(recipientQuery, /notifications_enabled/);
    assert.equal(sent.bcc, 'added-member@example.com');
    assert.match(sent.html, />Reject membership<\/a>/);
    assert.match(sent.text, /Reject membership: https:\/\/example\.com\/memberships\/example-guid\/reject/);
  } finally {
    nodemailer.createTransport = previous.createTransport;
    if (previous.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previous.SMTP_HOST;
    if (previous.MAIL_FROM === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previous.MAIL_FROM;
    delete require.cache[require.resolve('../src/email')];
  }
});
