const crypto = require('crypto');
const { scheduleBounds, TEST_MODE } = require('./db');
const { notifyMusallaAdmins } = require('./email');

const DIGEST_TIMEZONE = 'America/New_York';
const PRAYER_ORDER = ['Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha'];

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

function nextIsoDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function displayDate(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

function digestDetails(slots, tomorrow) {
  const ordered = [...slots].sort((a, b) => {
    if (a.prayer_date !== b.prayer_date) return a.prayer_date.localeCompare(b.prayer_date);
    return PRAYER_ORDER.indexOf(a.prayer_name) - PRAYER_ORDER.indexOf(b.prayer_name);
  });
  return ordered.map(slot => ({
    label: slot.prayer_date === tomorrow ? `Next Fajr · ${displayDate(tomorrow)}` : slot.prayer_name,
    value: slot.imam_name || 'Available'
  }));
}

async function claimDigest(pool, musallaId, digestDate) {
  const token = crypto.randomUUID();
  await pool.execute(`INSERT INTO musalla_daily_digest_deliveries (musalla_id,digest_date,status,claim_token,claimed_at) VALUES (?,?,'pending',?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE claim_token=IF(status='pending' AND claimed_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 15 MINUTE),VALUES(claim_token),claim_token),claimed_at=IF(status='pending' AND claimed_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 15 MINUTE),CURRENT_TIMESTAMP,claimed_at)`, [musallaId,digestDate,token]);
  const [claims] = await pool.execute('SELECT claim_token,status FROM musalla_daily_digest_deliveries WHERE musalla_id=? AND digest_date=?', [musallaId,digestDate]);
  return claims[0]?.status === 'pending' && claims[0]?.claim_token === token ? token : null;
}

async function sendDailyAdminPrayerDigests(pool, { now = new Date(), baseUrl = process.env.BASE_URL || 'http://localhost:3000' } = {}) {
  const digestDate = easternDigestDate(now);
  const [musallas] = await pool.execute(`SELECT id,name,timezone,logo_url FROM musalla_locations WHERE is_disabled=FALSE AND is_test=${TEST_MODE?'TRUE':'FALSE'} ORDER BY id`);
  let sent = 0;
  for (const musalla of musallas) {
    const token = await claimDigest(pool, musalla.id, digestDate);
    if (!token) continue;
    const { today } = scheduleBounds(now, musalla.timezone);
    const tomorrow = nextIsoDate(today);
    const [slots] = await pool.execute(`SELECT p.prayer_date,p.prayer_name,u.name imam_name FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND (p.prayer_date=? OR (p.prayer_date=? AND p.prayer_name='Fajr')) ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [musalla.id,today,tomorrow]);
    const delivered = await notifyMusallaAdmins(pool, musalla.id, {
      subject: `${musalla.name} prayer coverage for ${displayDate(today)}`,
      preheader: 'See available and assigned prayer slots, including the next Fajr slot.',
      heading: 'Daily prayer coverage',
      message: `Here is today’s prayer roster for ${musalla.name}, including tomorrow’s Fajr. Available slots still need an imam.`,
      details: digestDetails(slots, tomorrow),
      actionLabel: 'View prayer schedule',
      actionUrl: new URL(`/musallas/${musalla.id}?date=${today}`, `${baseUrl}/`).href,
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

module.exports = { DIGEST_TIMEZONE, digestDetails, easternDigestDate, isPastEasternNoon, millisecondsUntilNextEasternNoon, sendDailyAdminPrayerDigests, startDailyAdminPrayerDigest };
