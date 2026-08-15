const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const { recurringImamForDate } = require('../src/db');

const root = path.join(__dirname, '..');

test('weekly recurrence applies only on its weekday and from its start date', () => {
  const recurrences = [{ weekday: 1, prayer_name: 'Fajr', imam_user_id: 17, starts_on: '2026-08-17' }];
  assert.equal(recurringImamForDate(recurrences, 'Fajr', '2026-08-17'), 17);
  assert.equal(recurringImamForDate(recurrences, 'Fajr', '2026-08-24'), 17);
  assert.equal(recurringImamForDate(recurrences, 'Fajr', '2026-08-16'), null);
  assert.equal(recurringImamForDate(recurrences, 'Asr', '2026-08-17'), null);
});

test('schedule offers one-week or weekly opt-in and once-or-future change dialogs', async () => {
  const html = await ejs.renderFile(path.join(root, 'views', 'musalla.ejs'), {
    musalla: { id: 'demo-guid', guid: 'demo-guid', name: 'Demo', address: '', timetable_url: '', logo_url: '', jumuah_1_enabled: 0, jumuah_2_enabled: 0, jumuah_3_enabled: 0 },
    slots: [
      { id: 1, prayer_date: '2026-08-17', prayer_name: 'Fajr', imam_user_id: null, imam_name: null },
      { id: 2, prayer_date: '2026-08-18', prayer_name: 'Fajr', imam_user_id: 7, imam_name: 'Current Imam' },
      { id: 3, prayer_date: '2026-08-19', prayer_name: 'Fajr', imam_user_id: 8, imam_name: 'Other Imam' }
    ],
    date: '2026-08-17', weekEndDate: '2026-08-23', today: '2026-08-17',
    firstDate: '2026-07-20', lastDate: '2026-11-14', finalWeekStart: '2026-11-08',
    canLead: true, isAdmin: false,
    user: { id: 7, name: 'Current Imam', avatar_url: '', is_superuser: false },
    baseUrl: 'http://localhost:3000', path: '/musallas/demo-guid', notice: null,
    musallaNav: { id: 'demo-guid' }, canManageMembers: false, pendingApprovalCount: 0,
    isSuperAdmin: false, superAdminMode: false, hideNavigation: false, registrationConfirmation: null
  });

  assert.doesNotMatch(html, /Number of days|consecutive days|data-multi-day-opt-in/);
  assert.match(html, /data-schedule-action="opt-in"/);
  assert.match(html, /data-date="2026-08-17"/);
  assert.match(html, /data-schedule-action="opt-in"[^>]*>[\s\S]*?name="change_scope" value="occurrence"/);
  assert.match(html, /name="change_scope" value="future"/);
  assert.match(html, /data-schedule-action="opt-out"/);
  assert.match(html, /data-schedule-action="replace"/);
  assert.match(html, /id="change-assignment-description"/);
  assert.match(html, /id="opt-out-title"/);
  assert.match(html, /id="opt-out-description"/);
  assert.match(html, /id="opt-in-description"/);
  assert.match(html, /musalla\.js\?v=9/);
});

test('recurrence persistence and future-scope updates are wired to generated slots', () => {
  const database = fs.readFileSync(path.join(root, 'src', 'db.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public', 'musalla.js'), 'utf8');

  assert.match(database, /CREATE TABLE IF NOT EXISTS musalla_prayer_recurrences/);
  assert.match(database, /INSERT IGNORE INTO musalla_prayer_slots \(musalla_id,prayer_date,prayer_name,imam_user_id\)/);
  assert.match(server, /DAYOFWEEK\(prayer_date\)=\?/);
  assert.match(server, /changeScope === 'occurrence'[\s\S]+UPDATE musalla_prayer_slots SET imam_user_id=\? WHERE id=\?/);
  assert.match(server, /DELETE FROM musalla_prayer_recurrences/);
  assert.match(client, /data-schedule-action="opt-in"/);
  assert.match(client, /Lead \$\{form\.dataset\.prayer\} on \$\{timing\.weekday\}\?/);
  assert.match(client, /Every \$\{timing\.weekday\}/);
  assert.match(client, /Replace \$\{form\.dataset\.imam\} for \$\{form\.dataset\.prayer\} on \$\{timing\.weekday\}\?/);
  assert.match(client, /Opt out of \$\{form\.dataset\.prayer\} on \$\{timing\.weekday\}\?/);
  assert.match(client, /This & future \$\{timing\.weekday\}s/);
  assert.match(client, /'occurrence'/);
  assert.match(client, /'future'/);
  assert.doesNotMatch(client, /opt-in-days|Number of days/);
});
