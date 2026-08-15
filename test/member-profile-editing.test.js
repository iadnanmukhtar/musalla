const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
const superAdminMusalla = fs.readFileSync(path.join(root, 'views', 'super-admin-musalla.ejs'), 'utf8');
const baseLocals = {
  member: {
    id: 22, name: 'Example Imam', email: 'imam@example.com', phone: '555-0100', bio: 'Community Imam',
    avatar_url: '', role: 'imam', status: 'active', musalla_name: 'Example Musalla', musalla_id: 7
  },
  user: { id: 1, name: 'Administrator', avatar_url: '', is_superuser: false },
  baseUrl: 'http://localhost:3000', path: '/members/profile', notice: null, musallaNav: null,
  canManageMembers: true, pendingApprovalCount: 0, superAdminMode: false,
  canSwitchToMember: false, hideNavigation: false, registrationConfirmation: null,
  profileFormAction: '/members/profile/details', roleFormAction: '/members/profile', backUrl: '/members'
};

test('super admins can edit every member profile including pending members', async () => {
  const html = await ejs.renderFile(path.join(root, 'views', 'member-profile.ejs'), {
    ...baseLocals,
    member: { ...baseLocals.member, status: 'pending', role: '' },
    user: { ...baseLocals.user, is_superuser: true },
    isSuperAdmin: true,
    canEditProfile: true,
    superAdminMode: true
  });

  assert.match(html, /<h2>Edit profile<\/h2>/);
  assert.match(html, /name="name"/);
  assert.match(html, /name="phone"/);
  assert.match(html, /name="bio"/);
  assert.doesNotMatch(html, /Save roles/);
  assert.match(server, /ms\.status IN \('pending','active','disabled'\)/);
  assert.match(server, /UPDATE musalla_users SET name=\?,phone=\?,bio=\? WHERE id=\?/);
  assert.match(superAdminMusalla, /requestProfileUrl=`\/super-admin\/musallas\/\$\{musalla\.id\}\/members\/\$\{request\.id\}\/profile`/);
});

test('Musalla admins can update names only for Imams or administrators in their Musalla', async () => {
  const html = await ejs.renderFile(path.join(root, 'views', 'member-profile.ejs'), {
    ...baseLocals,
    isSuperAdmin: false,
    canEditProfile: true
  });

  assert.match(html, /Update this Imam or administrator’s name/);
  assert.match(html, /name="name"/);
  assert.doesNotMatch(html, /name="phone"/);
  assert.doesNotMatch(html, /name="bio"/);
  assert.match(server, /const canEditProfile = rows\[0\]\.status!=='pending' && \(hasRole\(rows\[0\],'imam'\) \|\| hasRole\(rows\[0\],'admin'\)\)/);
  assert.match(server, /app\.post\('\/musallas\/:guid\/members\/:userId\/profile\/details', requireAuth, musallaAccess, requireAdmin/);
  assert.match(server, /ms\.musalla_id=\? AND ms\.user_id=\?[^"]+FIND_IN_SET\('imam',ms\.role\)>0 OR FIND_IN_SET\('admin',ms\.role\)>0/);
  assert.match(server, /UPDATE musalla_users SET name=\? WHERE id=\?/);
});
