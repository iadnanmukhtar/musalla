require('dotenv').config();
const path = require('path');
const { execFileSync } = require('child_process');
const { pool, initializeDatabase } = require('../src/db');

const sqlitePath = path.join(__dirname, '..', 'data', 'musalla.db');
const read = sql => JSON.parse(execFileSync('sqlite3', ['-json', sqlitePath, sql], { encoding: 'utf8' }) || '[]');

async function migrate() {
  await initializeDatabase();
  const users = read('SELECT * FROM users ORDER BY id');
  const musallas = read('SELECT * FROM musallas ORDER BY id');
  const memberships = read('SELECT ms.* FROM memberships ms JOIN users u ON u.id=ms.user_id JOIN musallas m ON m.id=ms.musalla_id ORDER BY ms.musalla_id,ms.user_id');
  const slots = read('SELECT p.* FROM prayer_slots p JOIN musallas m ON m.id=p.musalla_id LEFT JOIN users u ON u.id=p.imam_user_id WHERE p.imam_user_id IS NULL OR u.id IS NOT NULL ORDER BY p.id');
  const skippedMemberships = read('SELECT COUNT(*) count FROM memberships ms LEFT JOIN users u ON u.id=ms.user_id LEFT JOIN musallas m ON m.id=ms.musalla_id WHERE u.id IS NULL OR m.id IS NULL')[0].count;
  const skippedSlots = read('SELECT COUNT(*) count FROM prayer_slots p LEFT JOIN musallas m ON m.id=p.musalla_id LEFT JOIN users u ON u.id=p.imam_user_id WHERE m.id IS NULL OR (p.imam_user_id IS NOT NULL AND u.id IS NULL)')[0].count;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const user of users) {
      await connection.execute(`INSERT INTO musalla_users (id,google_id,email,name,phone,bio,avatar_url,is_superuser,is_disabled,registration_completed,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE google_id=VALUES(google_id),email=VALUES(email),name=VALUES(name),phone=VALUES(phone),bio=VALUES(bio),avatar_url=VALUES(avatar_url),is_superuser=VALUES(is_superuser),is_disabled=VALUES(is_disabled),registration_completed=TRUE`, [user.id,user.google_id,user.email,user.name,user.phone||'',user.bio||'',user.avatar_url||'',user.is_superuser,user.is_disabled,1,user.created_at]);
    }
    for (const musalla of musallas) {
      await connection.execute(`INSERT INTO musalla_locations (id,name,address,timetable_url,logo_url,is_disabled,timezone,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),address=VALUES(address),timetable_url=VALUES(timetable_url),logo_url=VALUES(logo_url),is_disabled=VALUES(is_disabled),timezone=VALUES(timezone),created_by=VALUES(created_by)`, [musalla.id,musalla.name,musalla.address||'',musalla.timetable_url||'',musalla.logo_url||'',musalla.is_disabled,musalla.timezone,musalla.created_by,musalla.created_at]);
    }
    for (const membership of memberships) {
      await connection.execute(`INSERT INTO musalla_memberships (user_id,musalla_id,role,status) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),status=VALUES(status)`, [membership.user_id,membership.musalla_id,membership.role,membership.status]);
    }
    for (const slot of slots) {
      await connection.execute(`INSERT INTO musalla_prayer_slots (id,musalla_id,prayer_date,prayer_name,imam_user_id,notes) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE imam_user_id=VALUES(imam_user_id),notes=VALUES(notes)`, [slot.id,slot.musalla_id,slot.prayer_date,slot.prayer_name,slot.imam_user_id,slot.notes||'']);
    }
    await connection.commit();
    console.log(`Migrated ${users.length} users, ${musallas.length} Musallas, ${memberships.length} memberships, and ${slots.length} prayer slots.`);
    if (skippedMemberships || skippedSlots) console.log(`Skipped ${skippedMemberships} orphaned memberships and ${skippedSlots} orphaned prayer slots.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch(error => { console.error(error.message); process.exit(1); });
