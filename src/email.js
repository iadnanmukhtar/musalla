const nodemailer = require('nodemailer');
const TEST_MODE = /^(1|true|yes)$/i.test(process.env.TEST_MODE || '');

let transporter;
let configurationWarningShown = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function notificationText({ heading, message, details = [], actionLabel, actionUrl }) {
  const lines = [heading, '', message];
  if (details.length) lines.push('', ...details.map(({ label, value }) => `${label}: ${value}`));
  if (actionUrl) lines.push('', `${actionLabel || 'Open Musalla'}: ${actionUrl}`);
  lines.push('', 'Musalla · Helping communities organize prayer leadership');
  return lines.join('\n');
}

function notificationHtml({ preheader, heading, message, details = [], actionLabel, actionUrl, logoUrl }) {
  const resolvedLogoUrl = logoUrl || new URL('/icon-192.png', process.env.BASE_URL || 'http://localhost:3000').href;
  const detailRows = details.map(({ label, value }) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e3eef2;color:#607780;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;vertical-align:top;width:34%;">${escapeHtml(label)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #e3eef2;color:#12313d;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere;">${escapeHtml(value)}</td>
    </tr>`).join('');
  const action = actionUrl ? `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr><td bgcolor="#087fab" style="border-radius:10px;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(actionLabel || 'Open Musalla')}</a></td></tr>
    </table>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>${escapeHtml(heading)}</title>
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:22px!important;padding-right:22px!important}.brand-title{font-size:25px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#eaf4f8;color:#12313d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader || message)}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#eaf4f8;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="email-shell" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(8,127,171,.10);">
        <tr><td class="email-pad" style="padding:25px 36px;border-bottom:1px solid #e3eef2;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td width="42" height="42" align="center" style="width:42px;height:42px;"><img src="${escapeHtml(resolvedLogoUrl)}" width="42" height="42" alt="Musalla" style="display:block;width:42px;height:42px;border:0;border-radius:12px;object-fit:cover;"></td><td style="padding-left:12px;color:#087fab;font-size:20px;font-weight:800;">Musalla</td></tr></table></td>
            <td align="right" style="color:#607780;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Notification</td>
          </tr></table>
        </td></tr>
        <tr><td class="email-pad" style="padding:38px 36px 34px;">
          <p style="margin:0 0 8px;color:#0a9dce;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">Community update</p>
          <h1 class="brand-title" style="margin:0 0 14px;color:#087fab;font-size:30px;line-height:1.2;font-weight:750;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 24px;color:#425b64;font-size:15px;line-height:1.65;">${escapeHtml(message)}</p>
          ${details.length ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f7fbfd;border:1px solid #e3eef2;border-radius:12px;overflow:hidden;">${detailRows}</table>` : ''}
          ${action}
        </td></tr>
        <tr><td class="email-pad" style="padding:22px 36px;background:#f7fbfd;border-top:1px solid #e3eef2;color:#607780;font-size:12px;line-height:1.55;">
          This automated notification was sent by <strong style="color:#087fab;">Musalla</strong> to help your community coordinate prayer leadership.
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#78909a;font-size:11px;">Musalla · Serving communities, one prayer at a time</p>
    </td></tr>
  </table>
</body>
</html>`;
}

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

async function sendNotification(pool, { subject, text, html, preheader, heading, message, details, actionLabel, actionUrl, logoUrl, additionalRecipients = [], includeSuperAdmins = true }) {
  const mailer = smtpTransport();
  if (!mailer) return false;
  try {
    const [users] = includeSuperAdmins
      ? await pool.query(`SELECT email FROM musalla_users WHERE is_superuser=TRUE AND is_disabled=FALSE${TEST_MODE?'':' AND is_test=FALSE'}`)
      : [[]];
    const recipients = [...new Set([...users.map(user=>user.email), ...additionalRecipients]
      .map(email=>String(email || '').trim().toLowerCase())
      .filter(Boolean))];
    if (!recipients.length) {
      console.warn('Email notification skipped because no active database recipient was found.');
      return false;
    }
    const content = { heading: heading || subject, message: message || text || '', details, actionLabel, actionUrl, logoUrl };
    await mailer.sendMail({
      from: process.env.MAIL_FROM,
      bcc: recipients.join(','),
      subject,
      text: text || notificationText(content),
      html: html || notificationHtml({ ...content, preheader })
    });
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

async function notifyMusallaAdmins(pool, musallaId, message) {
  const [admins] = await pool.execute(`SELECT u.email FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='active' AND FIND_IN_SET('admin',ms.role)>0 AND u.is_disabled=FALSE AND u.is_test=${TEST_MODE?'TRUE':'FALSE'}`, [musallaId]);
  return sendNotification(pool, { ...message, additionalRecipients: admins.map(admin=>admin.email), includeSuperAdmins: false });
}

async function notifyUser(pool, userId, message) {
  const [users] = await pool.execute(`SELECT email FROM musalla_users WHERE id=? AND is_disabled=FALSE${TEST_MODE?'':' AND is_test=FALSE'}`, [userId]);
  if (!users[0]) return false;
  return sendNotification(pool, { ...message, additionalRecipients: [users[0].email], includeSuperAdmins: false });
}

module.exports = { notifySuperAdmins, notifyMusallaAdminsAndSuperAdmins, notifyMusallaAdmins, notifyUser };
