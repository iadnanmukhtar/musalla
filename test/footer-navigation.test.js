const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');

const footer = path.join(__dirname, '..', 'views', 'partials', 'foot.ejs');
const baseLocals = {
  user: { id: 1, is_superuser: false },
  hideNavigation: false,
  superAdminMode: false,
  canManageMembers: false,
  pendingApprovalCount: 0,
  registrationConfirmation: null,
  path: '/'
};

test('Musalla views replace Join with a link to the schedule', async () => {
  const html = await ejs.renderFile(footer, {
    ...baseLocals,
    path: '/musallas/7/members',
    musallaNav: { id: 7 }
  });

  assert.match(html, /href="\/musallas\/7"[^>]*><span[^>]*>▦<\/span>Schedule/);
  assert.doesNotMatch(html, />Join<\/a>/);
});

test('non-Musalla views retain the Join navigation item', async () => {
  const html = await ejs.renderFile(footer, {
    ...baseLocals,
    path: '/membership-requests',
    musallaNav: null
  });

  assert.match(html, /href="\/membership-requests"[^>]*><span>＋<\/span>Join/);
  assert.doesNotMatch(html, />Schedule<\/a>/);
});
