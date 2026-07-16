const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('signed-in Musalla cards link with the public GUID', async () => {
  const html = await ejs.renderFile(path.join(root, 'views', 'dashboard.ejs'), {
    musallas: [{
      id: 2,
      guid: '3bb94078-e737-46a6-9992-df982df0b314',
      name: 'Example Musalla',
      address: '',
      logo_url: '',
      role: 'imam',
      member_count: 1,
      jumuah_1_enabled: 0,
      jumuah_2_enabled: 0,
      jumuah_3_enabled: 0
    }],
    requests: [],
    user: { id: 1, name: 'Member', avatar_url: '', is_superuser: false },
    baseUrl: 'http://localhost:3000',
    path: '/',
    notice: null,
    musallaNav: null,
    canManageMembers: false,
    pendingApprovalCount: 0,
    isSuperAdmin: false,
    superAdminMode: false,
    hideNavigation: false,
    registrationConfirmation: null
  });

  assert.match(html, /href="\/musallas\/3bb94078-e737-46a6-9992-df982df0b314"/);
  assert.doesNotMatch(html, /href="\/musallas\/2(?:[/?"])/);
});

test('authenticated Musalla routes resolve GUIDs and expose no raw-ID route', () => {
  const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');

  assert.match(server, /WHERE guid=\?[^\n]+\[req\.params\.guid\]/);
  assert.doesNotMatch(server, /app\.(?:get|post)\('\/musallas\/:id(?:['/])/);
  assert.match(server, /app\.get\('\/musallas\/:guid'/);
});
