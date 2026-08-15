const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Musalla admins and super admins can activate members by email with selected roles', async () => {
  const server = read('src/server.js');
  const membersView = read('views/members.ejs');
  const superAdminView = read('views/super-admin-musalla.ejs');
  const membersScript = read('public/members.js');
  const form = await ejs.renderFile(path.join(root, 'views', 'partials', 'add-member-form.ejs'), {
    addMemberAction: '/musallas/example-guid/members/add'
  });

  assert.match(server, /app\.post\('\/musallas\/:guid\/members\/add', requireAuth, musallaAccess, requireAdmin/);
  assert.match(server, /app\.post\('\/super-admin\/musallas\/:id\/members\/add', requireAuth, requireSuperAdmin/);
  assert.match(server, /INSERT INTO musalla_users \(email,name,is_test,registration_completed\)/);
  assert.match(server, /SET status='active',role=\?,requested_role=''/);
  assert.match(server, /VALUES \(\?,\?,\?,'','active'\)/);
  assert.match(form, /type="email"/);
  assert.match(form, /name="roles" value="imam"/);
  assert.match(form, /name="roles" value="admin"/);
  assert.match(form, /starts immediately/);
  assert.match(form, /<dialog[^>]+id="add-member-dialog"[^>]+data-add-member-dialog/);
  assert.match(form, /data-add-member-open/);
  assert.match(form, /data-add-member-close/);
  assert.doesNotMatch(form, /data-confirm/);
  assert.ok(membersView.indexOf('if(requests.length)') < membersView.indexOf('<h2>Current members</h2>'));
  assert.ok(membersView.indexOf('<h2>Current members</h2>') < membersView.indexOf("include('partials/add-member-form'"));
  assert.ok(superAdminView.indexOf('<h2>Membership requests</h2>') < superAdminView.indexOf('<h2>Members</h2>'));
  assert.ok(superAdminView.indexOf('<h2>Members</h2>') < superAdminView.indexOf("include('partials/add-member-form'"));
  assert.match(membersView, /<script src="\/members\.js\?v=5"><\/script>/);
  assert.match(superAdminView, /<script src="\/members\.js\?v=5"><\/script>/);
  assert.match(membersScript, /dialog\.showModal\(\)/);
  assert.match(membersScript, /dialog\.close\(\)/);
});

test('only the signed-in membership owner can reject an added membership', () => {
  const server = read('src/server.js');
  const rejectView = read('views/reject-membership.ejs');

  assert.match(server, /app\.get\('\/memberships\/:guid\/reject'/);
  assert.match(server, /app\.post\('\/memberships\/:guid\/reject', requireAuth/);
  assert.match(server, /m\.guid=\? AND ms\.user_id=\?/);
  assert.match(server, /DELETE FROM musalla_memberships WHERE musalla_id=\? AND user_id=\?/);
  assert.match(server, /DELETE FROM musalla_prayer_recurrences WHERE musalla_id=\? AND imam_user_id=\?/);
  assert.match(rejectView, /Reject membership/);
  assert.match(rejectView, /future prayer assignments will be cleared/);
});

test('first Google sign-in claims an email-created placeholder account', () => {
  const server = read('src/server.js');
  assert.match(server, /const generatedName = emailDisplayName\(email\)/);
  assert.match(server, /!user\.google_id && user\.name === generatedName/);
  assert.match(server, /UPDATE musalla_users SET name=\?,google_id=\?/);
});
