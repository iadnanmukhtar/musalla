const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('super admins can act on pending requests even when a Musalla already has an administrator', () => {
  const server = read('src/server.js');
  const view = read('views/super-admin-musalla.ejs');

  assert.doesNotMatch(server, /already has an administrator; its admins must approve new requests/);
  assert.match(server, /Membership request approved/);
  assert.match(server, /u\.avatar_url,ms\.requested_role FROM musalla_memberships/);
  assert.match(server, /SET status='active',role=\?,requested_role=''/);
  assert.match(server, /SET status='denied',role='',requested_role=''/);
  assert.match(view, /if\(requests\.length\)/);
  assert.doesNotMatch(view, /if\(needsInitialAdmin\)\{ %>\s*<section/);
  assert.match(view, /approve or deny any pending request for this Musalla/);
});

test('the super-admin dashboard surfaces every pending membership request', () => {
  const server = read('src/server.js');
  const dashboard = read('views/super-admin.ejs');
  const footer = read('views/partials/foot.ejs');

  assert.match(server, /superAdminPendingCount=musallas\.reduce/);
  assert.match(dashboard, /pendingCount=Number\(m\.pending_count\)/);
  assert.match(dashboard, /pendingCount %> awaiting approval/);
  assert.match(footer, /pending membership request/);
});
