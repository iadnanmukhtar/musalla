const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS musalla_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE,
      email VARCHAR(320) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(30) NOT NULL DEFAULT '',
      bio VARCHAR(500) NOT NULL DEFAULT '',
      avatar_url TEXT,
      is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
      is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      registration_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [registrationColumns] = await pool.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='musalla_users' AND column_name='registration_completed'");
  if (!registrationColumns.length) {
    await pool.query('ALTER TABLE musalla_users ADD COLUMN registration_completed BOOLEAN NOT NULL DEFAULT FALSE');
    await pool.query('UPDATE musalla_users SET registration_completed=TRUE');
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS musalla_locations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      address VARCHAR(300) NOT NULL DEFAULT '',
      timetable_url TEXT,
      logo_url TEXT,
      is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
      timezone VARCHAR(100) NOT NULL DEFAULT 'America/Chicago',
      jumuah_1_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      jumuah_2_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      jumuah_3_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_musalla_locations_creator FOREIGN KEY (created_by) REFERENCES musalla_users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [jumuahColumns] = await pool.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='musalla_locations' AND column_name LIKE 'jumuah_%_enabled'");
  const existingJumuahColumns = new Set(jumuahColumns.map(column => column.COLUMN_NAME));
  for (const column of ['jumuah_1_enabled','jumuah_2_enabled','jumuah_3_enabled']) {
    if (!existingJumuahColumns.has(column)) await pool.query(`ALTER TABLE musalla_locations ADD COLUMN ${column} BOOLEAN NOT NULL DEFAULT FALSE`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS musalla_memberships (
      user_id BIGINT UNSIGNED NOT NULL,
      musalla_id BIGINT UNSIGNED NOT NULL,
      role SET('imam','admin') NOT NULL DEFAULT '',
      status ENUM('pending','active','disabled','denied') NOT NULL DEFAULT 'active',
      PRIMARY KEY (user_id,musalla_id),
      KEY idx_musalla_memberships_location (musalla_id),
      CONSTRAINT fk_musalla_memberships_user FOREIGN KEY (user_id) REFERENCES musalla_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_musalla_memberships_location FOREIGN KEY (musalla_id) REFERENCES musalla_locations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [roleColumns] = await pool.query("SELECT COLUMN_TYPE,COLUMN_DEFAULT FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='musalla_memberships' AND column_name='role'");
  if (roleColumns[0] && (!roleColumns[0].COLUMN_TYPE.toLowerCase().startsWith('set(') || roleColumns[0].COLUMN_DEFAULT !== '')) {
    await pool.query("ALTER TABLE musalla_memberships MODIFY role SET('imam','admin') NOT NULL DEFAULT ''");
  }
  const [statusColumns] = await pool.query("SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='musalla_memberships' AND column_name='status'");
  if (statusColumns[0] && !statusColumns[0].COLUMN_TYPE.includes("'pending'")) {
    await pool.query("ALTER TABLE musalla_memberships MODIFY status ENUM('pending','active','disabled','denied') NOT NULL DEFAULT 'active'");
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS musalla_prayer_slots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      musalla_id BIGINT UNSIGNED NOT NULL,
      prayer_date DATE NOT NULL,
      prayer_name ENUM('Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha') NOT NULL,
      imam_user_id BIGINT UNSIGNED NULL,
      notes VARCHAR(500) NOT NULL DEFAULT '',
      UNIQUE KEY uq_musalla_prayer (musalla_id,prayer_date,prayer_name),
      KEY idx_musalla_slots_imam (imam_user_id),
      CONSTRAINT fk_musalla_slots_location FOREIGN KEY (musalla_id) REFERENCES musalla_locations(id) ON DELETE CASCADE,
      CONSTRAINT fk_musalla_slots_imam FOREIGN KEY (imam_user_id) REFERENCES musalla_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [prayerColumns] = await pool.query("SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='musalla_prayer_slots' AND column_name='prayer_name'");
  if (prayerColumns[0]?.COLUMN_TYPE.includes("'Dhuhr'")) {
    await pool.query("ALTER TABLE musalla_prayer_slots MODIFY prayer_name ENUM('Fajr','Dhuhr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha') NOT NULL");
    await pool.query("UPDATE musalla_prayer_slots SET prayer_name='Zuhr' WHERE prayer_name='Dhuhr'");
    await pool.query("ALTER TABLE musalla_prayer_slots MODIFY prayer_name ENUM('Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha') NOT NULL");
  }
}

const DAILY_PRAYERS = ['Fajr','Zuhr','Asr','Maghrib','Isha'];
const isoDate = date => date.toISOString().slice(0, 10);

function localIsoDate(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function scheduleBounds(now = new Date(), timezone = 'America/Chicago') {
  const today = new Date(`${localIsoDate(now, timezone)}T12:00:00Z`);
  const first = new Date(today);
  first.setUTCDate(first.getUTCDate() - 28);
  const last = new Date(today);
  last.setUTCMonth(last.getUTCMonth() + 3);
  return { firstDate: isoDate(first), lastDate: isoDate(last), today: isoDate(today) };
}

async function syncPrayerSchedules(musallaId) {
  const params = [];
  let sql = 'SELECT id,timezone,jumuah_1_enabled,jumuah_2_enabled,jumuah_3_enabled FROM musalla_locations WHERE is_disabled=FALSE';
  if (musallaId) { sql += ' AND id=?'; params.push(Number(musallaId)); }
  const [musallas] = await pool.execute(sql, params);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const { id, timezone } of musallas) {
      const { firstDate, lastDate } = scheduleBounds(new Date(), timezone);
      await connection.execute('DELETE FROM musalla_prayer_slots WHERE musalla_id=? AND (prayer_date<? OR prayer_date>?)', [id, firstDate, lastDate]);
      const values = [];
      const desiredKeys = new Set();
      const date = new Date(`${firstDate}T12:00:00Z`);
      while (isoDate(date) <= lastDate) {
        const dateValue = isoDate(date);
        const musalla = musallas.find(item => Number(item.id) === Number(id));
        const enabledJumuah = [1,2,3].filter(number => musalla[`jumuah_${number}_enabled`]).map(number => `Jumuah ${number}`);
        const prayers = date.getUTCDay() === 5 && enabledJumuah.length
          ? ['Fajr', ...enabledJumuah, 'Asr','Maghrib','Isha']
          : DAILY_PRAYERS;
        for (const prayer of prayers) {
          values.push([id, dateValue, prayer]);
          desiredKeys.add(`${dateValue}|${prayer}`);
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
      const [currentSlots] = await connection.execute('SELECT id,prayer_date,prayer_name FROM musalla_prayer_slots WHERE musalla_id=? AND prayer_date BETWEEN ? AND ?', [id, firstDate, lastDate]);
      const obsoleteIds = currentSlots.filter(slot => !desiredKeys.has(`${slot.prayer_date}|${slot.prayer_name}`)).map(slot => slot.id);
      if (obsoleteIds.length) await connection.query('DELETE FROM musalla_prayer_slots WHERE id IN (?)', [obsoleteIds]);
      if (values.length) await connection.query('INSERT IGNORE INTO musalla_prayer_slots (musalla_id,prayer_date,prayer_name) VALUES ?', [values]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, initializeDatabase, scheduleBounds, syncPrayerSchedules };
