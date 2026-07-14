const nodemailer = require('nodemailer');
const TEST_MODE = /^(1|true|yes)$/i.test(process.env.TEST_MODE || '');

let transporter;
let configurationWarningShown = false;

function smtpTransport() {
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) {
    if (!configurationWarningShown) {
      console.warn('Email notifications are disabled. Set SMTP_HOST and MAIL_FROM to enable them.');
      configurationWarningShown = true;
    }
    return null;
  }
  if (!transporter) {
    const auth = process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
      : undefined;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth
    });
  }
  return transporter;
}

async function sendNotification(pool, { subject, text, additionalRecipients = [] }) {
  const mailer = smtpTransport();
  if (!mailer) return false;
  try {
    const [users] = await pool.query(`SELECT email FROM musalla_users WHERE is_superuser=TRUE AND is_disabled=FALSE${TEST_MODE?'':' AND is_test=FALSE'}`);
    const recipients = [...new Set([...users.map(user=>user.email), ...additionalRecipients]
      .map(email=>String(email || '').trim().toLowerCase())
      .filter(Boolean))];
    if (!recipients.length) {
      console.warn('Email notification skipped because no active database recipient was found.');
      return false;
    }
    await mailer.sendMail({ from: process.env.MAIL_FROM, bcc: recipients.join(','), subject, text });
    return true;
  } catch (error) {
    console.error('Unable to send super-admin email notification:', error.message);
    return false;
  }
}

async function notifySuperAdmins(pool, message) {
  return sendNotification(pool, message);
}

async function notifyMusallaAdminsAndSuperAdmins(pool, musallaId, message) {
  const [admins] = await pool.execute("SELECT u.email FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='active' AND FIND_IN_SET('admin',ms.role)>0 AND u.is_disabled=FALSE", [musallaId]);
  return sendNotification(pool, { ...message, additionalRecipients: admins.map(admin=>admin.email) });
}

module.exports = { notifySuperAdmins, notifyMusallaAdminsAndSuperAdmins };
