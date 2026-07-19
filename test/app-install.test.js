const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

test('shared footer offers public and signed-in browser users the installable app', async () => {
  const root = path.join(__dirname, '..');
  const footer = fs.readFileSync(path.join(root, 'views', 'partials', 'foot.ejs'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'app-install.js'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.json'), 'utf8'));

  assert.match(footer, /id="install-app-prompt"/);
  const publicHtml = await ejs.renderFile(path.join(root, 'views', 'partials', 'foot.ejs'), {
    user: null,
    hideNavigation: false,
    registrationConfirmation: null
  });

  assert.match(publicHtml, /id="install-app-prompt"/);
  const styles = fs.readFileSync(path.join(root, 'public', 'app-install.css'), 'utf8');

  assert.match(footer, /app-install\.js\?v=9/);
  assert.match(script, /beforeinstallprompt/);
  assert.match(script, /display-mode: standalone/);
  assert.match(script, /Add to Home Screen/);
  assert.match(script, /window\.location\.assign\('\/'\)/);
  assert.match(script, /Install app or Add to Home screen/);
  assert.match(script, /sessionStorage/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(script, /max-width: 768px/);
  assert.doesNotMatch(styles, /min-width: 769px/);
  assert.match(script, /install-prompt-visible/);
  assert.match(styles, /install-prompt-visible \.app-shell/);
  assert.match(serviceWorker, /app-install\.js\?v=9/);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});
