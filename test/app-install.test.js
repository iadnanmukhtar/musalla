const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

  assert.match(footer, /app-install\.js\?v=10/);
  assert.match(script, /beforeinstallprompt/);
  assert.match(script, /display-mode: standalone/);
  assert.match(script, /Add to Home Screen/);
  assert.match(script, /window\.location\.assign\('\/'\)/);
  assert.match(script, /Install app or Add to Home screen/);
  assert.match(script, /installEvent\.userChoice/);
  assert.match(script, /appinstalled/);
  assert.match(script, /pwa_install_choice/);
  assert.match(script, /sessionStorage/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(script, /max-width: 768px/);
  assert.doesNotMatch(styles, /min-width: 769px/);
  assert.match(script, /install-prompt-visible/);
  assert.match(styles, /install-prompt-visible \.app-shell/);
  assert.match(styles, /@media \(display-mode: standalone\)/);
  assert.match(serviceWorker, /app-install\.js\?v=10/);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.description.length > 80);
  assert.deepEqual(manifest.categories, ['productivity', 'utilities']);
  assert.deepEqual(manifest.screenshots.map(screenshot => screenshot.form_factor).sort(), ['narrow', 'wide']);
  manifest.screenshots.forEach(screenshot => {
    assert.equal(screenshot.type, 'image/png');
    assert.ok(screenshot.label);
    const screenshotPath = path.join(root, 'public', screenshot.src);
    assert.ok(fs.existsSync(screenshotPath));
    const image = fs.readFileSync(screenshotPath);
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    assert.equal(screenshot.sizes, `${width}x${height}`);
    assert.ok(width >= 320 && height >= 320 && width <= 3840 && height <= 3840);
    assert.ok(Math.max(width, height) / Math.min(width, height) <= 2.3);
  });
});

test('native install events replace fallback instructions and record the browser choice', async () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-install.js'), 'utf8');
  const windowListeners = {};
  const analytics = [];
  const stored = new Map();
  const createElement = (hidden = false) => ({
    hidden,
    textContent: '',
    dataset: {},
    disabled: false,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; }
  });
  const elements = {
    'install-app-prompt': createElement(true),
    'install-app-button': createElement(),
    'install-app-close': createElement(),
    'install-app-message': createElement(),
    'install-app-instructions': createElement(true)
  };
  const bodyClasses = new Set();
  const context = {
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector() { return null; },
      body: { classList: { toggle(name, enabled) { enabled ? bodyClasses.add(name) : bodyClasses.delete(name); } } }
    },
    window: {
      navigator: { userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36', platform: 'MacIntel', maxTouchPoints: 0, standalone: false },
      matchMedia() { return { matches: false }; },
      sessionStorage: {
        getItem(key) { return stored.get(key) || null; },
        setItem(key, value) { stored.set(key, value); }
      },
      location: { pathname: '/', assign() {} },
      addEventListener(type, listener) { windowListeners[type] = listener; },
      gtag(...args) { analytics.push(args); }
    }
  };

  vm.runInNewContext(script, context);
  assert.equal(elements['install-app-button'].dataset.action, 'instructions');
  assert.equal(elements['install-app-button'].textContent, 'How to install');

  let prevented = false;
  let promptCalls = 0;
  windowListeners.beforeinstallprompt({
    preventDefault() { prevented = true; },
    async prompt() { promptCalls += 1; },
    userChoice: Promise.resolve({ outcome: 'dismissed' })
  });
  assert.equal(prevented, true);
  assert.equal(elements['install-app-button'].dataset.action, 'install');
  assert.equal(elements['install-app-button'].textContent, 'Install app');

  await elements['install-app-button'].listeners.click();
  assert.equal(promptCalls, 1);
  assert.equal(elements['install-app-prompt'].hidden, true);
  assert.equal(stored.get('musalla-install-dismissed'), '1');
  assert.ok(analytics.some(([, eventName, details]) => eventName === 'pwa_install_choice' && details.outcome === 'dismissed'));
});
