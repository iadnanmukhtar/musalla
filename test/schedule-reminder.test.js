const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');

const view = path.join(__dirname, '..', 'views', 'musalla.ejs');
const locals = {
  musalla: { id: 'demo-guid', guid: 'demo-guid', name: 'Demo', address: '', timetable_url: '', logo_url: '', jumuah_1_enabled: 0, jumuah_2_enabled: 0, jumuah_3_enabled: 0 },
  slots: [], date: '2026-07-15', weekEndDate: '2026-07-21', today: '2026-07-15',
  firstDate: '2026-06-17', lastDate: '2026-10-15', finalWeekStart: '2026-10-09',
  canLead: true, user: { id: 1, name: 'Admin', avatar_url: '', is_superuser: false },
  baseUrl: 'http://localhost:3000', path: '/musallas/demo-guid', notice: null,
  musallaNav: { id: 'demo-guid' }, canManageMembers: true, pendingApprovalCount: 0,
  isSuperAdmin: false, superAdminMode: false, hideNavigation: false, registrationConfirmation: null
};

test('only Musalla admins see the schedule reminder action', async () => {
  const adminHtml = await ejs.renderFile(view, { ...locals, isAdmin: true });
  const imamHtml = await ejs.renderFile(view, { ...locals, isAdmin: false, canManageMembers: false });

  assert.match(adminHtml, /action="\/musallas\/demo-guid\/remind-imams"/);
  assert.doesNotMatch(adminHtml, /\/musallas\/7(?:[/?"])/);
  assert.match(adminHtml, /class="schedule-reminder"[\s\S]*> Remind Imams<\/button>/);
  assert.match(adminHtml, /Send the seven-day schedule to all active Imam members/);
  assert.ok(adminHtml.indexOf('class="schedule-reminder"') > adminHtml.indexOf('class="weekly-table-wrap"'));
  assert.doesNotMatch(imamHtml, /\/remind-imams/);
});
