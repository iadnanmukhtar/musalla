const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('action notices render as dismissible toasts instead of page banners', () => {
  const views = path.join(__dirname, '..', 'views', 'partials');
  const head = fs.readFileSync(path.join(views, 'head.ejs'), 'utf8');
  const nav = fs.readFileSync(path.join(views, 'nav.ejs'), 'utf8');
  const publicNav = fs.readFileSync(path.join(views, 'public-nav.ejs'), 'utf8');
  const foot = fs.readFileSync(path.join(views, 'foot.ejs'), 'utf8');

  assert.doesNotMatch(head, /class="notice"/);
  assert.doesNotMatch(nav, /class="notice"/);
  assert.doesNotMatch(publicNav, /class="notice"/);
  assert.match(foot, /data-toast-region/);
  assert.match(foot, /data-toast-autoclose/);
  assert.match(foot, /toast-close/);
  assert.match(foot, /role="<%= toastNotice\.type==='error'\?'alert':'status' %>"/);
});

test('client validation uses the shared error toast', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'registration.js'), 'utf8');
  assert.match(script, /showToast\('Select at least one Musalla\.', \{ type: 'error' \}\)/);
});

test('server acknowledgements and recoverable errors use typed toast notices', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.equal((server.match(/req\.session\.notice\s*=/g) || []).length, 1);
  assert.match(server, /const setNotice = \(req, message, type = 'success'\)/);
  assert.match(server, /setNotice\(req, 'Enter a valid email address', 'error'\)/);
  assert.match(server, /setNotice\(req, 'Profile updated'\)/);
});
