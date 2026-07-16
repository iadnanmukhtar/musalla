const crypto = require('crypto');
const { scheduleBounds, TEST_MODE } = require('./db');
const { notifyMusallaImams } = require('./email');

const DIGEST_TIMEZONE = 'America/New_York';

function zonedParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function easternDigestDate(now = new Date()) {
  const parts = zonedParts(now, DIGEST_TIMEZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isPastEasternNoon(now = new Date()) {
  return Number(zonedParts(now, DIGEST_TIMEZONE).hour) >= 12;
}

function millisecondsUntilNextEasternNoon(now = new Date()) {
  for (let minutes = 1; minutes <= 25 * 60; minutes += 1) {
    const candidate = new Date(now.getTime() + minutes * 60000);
    const parts = zonedParts(candidate, DIGEST_TIMEZONE);
    if (parts.hour === '12' && parts.minute === '00') return candidate.getTime() - now.getTime();
  }
  return 24 * 60 * 60 * 1000;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function displayDate(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function weeklyDigestRows(slots, weekStart) {
  const prayers = ['Fajr','Zuhr','Asr','Maghrib','Isha'];
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateSlots = slots.filter(slot => slot.prayer_date === date);
    return {
      date,
      label: displayDate(date),
      prayers: prayers.map(prayer => {
        const matching = dateSlots.filter(slot => prayer === 'Zuhr'
          ? slot.prayer_name === 'Zuhr' || slot.prayer_name.startsWith('Jumuah')
          : slot.prayer_name === prayer);
        if (!matching.length) return { prayer, value: '—', open: false };
        const value = matching.map(slot => {
          const prefix = slot.prayer_name.startsWith('Jumuah') ? `${slot.prayer_name.replace('Jumuah ', 'J')}: ` : '';
          return `${prefix}${slot.imam_name || 'Open'}`;
        }).join(' · ');
        return { prayer, value, open: matching.some(slot => !slot.imam_name) };
      })
    };
  });
}

function digestDetails(slots, weekStart) {
  return weeklyDigestRows(slots, weekStart).map(row => ({
    label: row.label,
    value: row.prayers.map(item => `${item.prayer}: ${item.value}`).join(' | ')
  }));
}

function weeklyDigestHtml(slots, weekStart) {
  const rows = weeklyDigestRows(slots, weekStart);
  const headers = ['Day','Fajr','Zuhr','Asr','Maghrib','Isha'].map(label => `<th style="padding:8px 3px;background:#eef7fa;border-bottom:1px solid #d7e8ee;color:#087fab;font-size:10px;text-transform:uppercase;">${label}</th>`).join('');
  const body = rows.map(row => `<tr><th style="padding:8px 4px;border-bottom:1px solid #e3eef2;color:#087fab;font-size:10px;text-align:left;white-space:nowrap;">${escapeHtml(row.label.replace(',', ''))}</th>${row.prayers.map(item => `<td style="padding:8px 3px;border-bottom:1px solid #e3eef2;background:${item.open?'#fff9db':'#ffffff'};color:${item.open?'#725b12':'#425b64'};font-size:10px;font-weight:${item.open?'700':'600'};text-align:center;overflow-wrap:anywhere;">${escapeHtml(item.value)}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto;"><table role="table" border="0" cellpadding="0" cellspacing="0" width="100%" aria-label="Seven-day prayer coverage" style="width:100%;border:1px solid #d7e8ee;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;table-layout:fixed;"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function claimDigest(pool, musallaId, digestDate) {
  const token = crypto.randomUUID();
  await pool.execute(`INSERT INTO musalla_daily_digest_deliveries (musalla_id,digest_date,status,claim_token,claimed_at) VALUES (?,?,'pending',?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE claim_token=IF(status='pending' AND claimed_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 15 MINUTE),VALUES(claim_token),claim_token),claimed_at=IF(status='pending' AND claimed_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 15 MINUTE),CURRENT_TIMESTAMP,claimed_at)`, [musallaId,digestDate,token]);
  const [claims] = await pool.execute('SELECT claim_token,status FROM musalla_daily_digest_deliveries WHERE musalla_id=? AND digest_date=?', [musallaId,digestDate]);
  return claims[0]?.status === 'pending' && claims[0]?.claim_token === token ? token : null;
}

async function sendDailyAdminPrayerDigests(pool, { now = new Date(), baseUrl = process.env.BASE_URL || 'http://localhost:3000' } = {}) {
  const digestDate = easternDigestDate(now);
  const [musallas] = await pool.execute(`SELECT id,guid,name,timezone,logo_url FROM musalla_locations WHERE is_disabled=FALSE AND is_test=${TEST_MODE?'TRUE':'FALSE'} ORDER BY id`);
  let sent = 0;
  for (const musalla of musallas) {
    const token = await claimDigest(pool, musalla.id, digestDate);
    if (!token) continue;
    const { today } = scheduleBounds(now, musalla.timezone);
    const weekEnd = addDays(today, 6);
    const [slots] = await pool.execute(`SELECT p.prayer_date,p.prayer_name,u.name imam_name FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date BETWEEN ? AND ? ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [musalla.id,today,weekEnd]);
    const details = digestDetails(slots, today);
    const delivered = await notifyMusallaImams(pool, musalla.id, {
      subject: `${musalla.name} weekly prayer coverage · ${displayDate(today)}–${displayDate(weekEnd)}`,
      preheader: 'See which prayer slots still need an imam over the next seven days.',
      heading: 'Weekly prayer coverage',
      message: `Here is the next seven days of prayer coverage for ${musalla.name}. Yellow “Open” slots still need an imam.`,
      details,
      contentHtml: weeklyDigestHtml(slots, today),
      actionLabel: 'View prayer schedule',
      actionUrl: new URL(`/musallas/${musalla.guid}?date=${today}`, `${baseUrl}/`).href,
      logoUrl: musalla.logo_url ? new URL(musalla.logo_url, `${baseUrl}/`).href : undefined
    });
    if (delivered) {
      await pool.execute("UPDATE musalla_daily_digest_deliveries SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE musalla_id=? AND digest_date=? AND claim_token=?", [musalla.id,digestDate,token]);
      sent += 1;
    } else {
      await pool.execute("DELETE FROM musalla_daily_digest_deliveries WHERE musalla_id=? AND digest_date=? AND claim_token=? AND status='pending'", [musalla.id,digestDate,token]);
    }
  }
  return sent;
}

function startDailyAdminPrayerDigest(pool, options = {}) {
  let timer;
  const run = async () => {
    try { await sendDailyAdminPrayerDigests(pool, options); }
    catch (error) { console.error('Unable to send daily prayer coverage digest:', error.message); }
  };
  const scheduleNext = () => {
    timer = setTimeout(async () => {
      await run();
      scheduleNext();
    }, millisecondsUntilNextEasternNoon());
    timer.unref?.();
  };
  if (isPastEasternNoon()) void run();
  scheduleNext();
  return () => clearTimeout(timer);
}

module.exports = { DIGEST_TIMEZONE, digestDetails, weeklyDigestHtml, weeklyDigestRows, easternDigestDate, isPastEasternNoon, millisecondsUntilNextEasternNoon, sendDailyAdminPrayerDigests, startDailyAdminPrayerDigest };
