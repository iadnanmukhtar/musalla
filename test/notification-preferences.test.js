const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('personal profile exposes and saves the email notification preference', () => {
  const profile = read('views/profile.ejs');
  const server = read('src/server.js');
  assert.match(profile, /name="notifications_enabled"/);
  assert.match(profile, /form="user-notifications-form" onchange="this\.form\.submit\(\)"/);
  assert.match(profile, /Number\(user\.notifications_enabled\)===1\?'checked':''/);
  assert.match(server, /app\.post\('\/profile\/notifications'/);
  assert.match(server, /UPDATE musalla_users SET notifications_enabled=\? WHERE id=\?/);
});

test('admin and super-admin Musalla profiles expose and save the shared preference', () => {
  const adminProfile = read('views/musalla-profile.ejs');
  const superAdminProfile = read('views/super-admin-musalla.ejs');
  const server = read('src/server.js');
  for (const profile of [adminProfile, superAdminProfile]) {
    assert.match(profile, /<b>Enable notifications<\/b>/);
    assert.match(profile, /name="notifications_enabled"/);
    assert.match(profile, /form="musalla-notifications-form" onchange="this\.form\.submit\(\)"/);
    assert.match(profile, /Number\(musalla\.notifications_enabled\)===1\?'checked':''/);
  }
  assert.match(server, /app\.post\('\/musallas\/:guid\/notifications'/);
  assert.match(server, /app\.post\('\/super-admin\/musallas\/:id\/notifications'/);
  assert.equal((server.match(/UPDATE musalla_locations SET notifications_enabled=\?/g) || []).length, 2);
  assert.doesNotMatch(server, /UPDATE musalla_locations SET name=\?[^'\n]+notifications_enabled=\?/);
});
