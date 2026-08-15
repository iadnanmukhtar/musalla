const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Musalla admins can assign and opt out other Imams without holding the Imam role', async () => {
  const html = await ejs.renderFile(path.join(root, 'views', 'musalla.ejs'), {
    musalla: { id: 'demo-guid', guid: 'demo-guid', name: 'Demo', address: '', timetable_url: '', logo_url: '', jumuah_1_enabled: 0, jumuah_2_enabled: 0, jumuah_3_enabled: 0 },
    slots: [
      { id: 1, prayer_date: '2026-08-17', prayer_name: 'Fajr', imam_user_id: null, imam_name: null },
      { id: 2, prayer_date: '2026-08-18', prayer_name: 'Asr', imam_user_id: 12, imam_name: 'Bilal Ahmed' }
    ],
    eligibleImams: [{ id: 11, name: 'Amina Ali' }, { id: 12, name: 'Bilal Ahmed' }],
    date: '2026-08-17', weekEndDate: '2026-08-23', today: '2026-08-17',
    firstDate: '2026-07-20', lastDate: '2026-11-14', finalWeekStart: '2026-11-08',
    canLead: false, isAdmin: true,
    user: { id: 20, name: 'Schedule Admin', avatar_url: '', is_superuser: false },
    baseUrl: 'http://localhost:3000', path: '/musallas/demo-guid', notice: null,
    musallaNav: { id: 'demo-guid' }, canManageMembers: true, pendingApprovalCount: 0,
    isSuperAdmin: false, superAdminMode: false, hideNavigation: false, registrationConfirmation: null
  });

  assert.match(html, /action="\/musallas\/demo-guid\/slots\/1\/manage"/);
  assert.match(html, /data-schedule-action="admin-opt-in"/);
  assert.match(html, /data-date="2026-08-17"/);
  assert.match(html, /data-schedule-action="admin-opt-out"/);
  assert.match(html, /name="admin_action" value="assign"/);
  assert.match(html, /name="admin_action" value="release"/);
  assert.match(html, /<option value="11">Amina Ali<\/option>/);
  assert.match(html, /<option value="12">Bilal Ahmed<\/option>/);
  assert.match(html, /id="admin-opt-in-once"[^>]*>This day<\/button>/);
  assert.match(html, /id="admin-opt-in-weekly"[^>]*>Every week<\/button>/);
  assert.match(html, /id="admin-opt-out-description"/);
  assert.match(html, /id="admin-opt-out-once"[^>]*>This day<\/button>/);
  assert.match(html, /id="admin-opt-out-future"[^>]*>This and future weeks<\/button>/);
  assert.doesNotMatch(html, /aria-label="Assign an Imam to Fajr"[^>]*disabled/);
});

test('admin schedule writes validate permissions, Imam membership, and stale assignments', () => {
  const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public', 'musalla.js'), 'utf8');

  assert.match(server, /app\.post\('\/musallas\/:guid\/slots\/:slotId\/manage', requireAuth, musallaAccess, requireAdmin/);
  assert.match(server, /ms\.status='active' AND FIND_IN_SET\('imam',ms\.role\)>0 AND u\.is_disabled=FALSE/);
  assert.match(server, /Number\(req\.body\.assigned_imam_id\)!==Number\(slot\.imam_user_id\)/);
  assert.match(server, /admin_action/);
  assert.match(client, /data-schedule-action="admin-opt-in"/);
  assert.match(client, /data-schedule-action="admin-opt-out"/);
  assert.match(client, /imam_user_id/);
  assert.match(client, /Assign \$\{form\.dataset\.prayer\} on \$\{timing\.weekday\}/);
  assert.match(client, /Opt \$\{form\.dataset\.imam\} out of \$\{form\.dataset\.prayer\} on \$\{timing\.weekday\}\?/);
  assert.match(client, /makeDismissible\(adminOptInDialog/);
  assert.match(client, /makeDismissible\(adminOptOutDialog/);
  assert.match(client, /timing\.date/);
});
