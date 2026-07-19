const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('About page includes an accessible three-screen app carousel', () => {
  const root = path.join(__dirname, '..');
  const view = fs.readFileSync(path.join(root, 'views', 'about.ejs'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'about-carousel.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'about-carousel.css'), 'utf8');

  assert.match(view, /aria-roledescription="carousel"/);
  assert.equal((view.match(/class="app-screenshot"/g) || []).length, 3);
  assert.equal((view.match(/class="preview-logo"><img src="\/icon\.svg"/g) || []).length, 3);
  assert.match(view, /about-carousel\.js\?v=1/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /IntersectionObserver/);
  assert.match(styles, /scroll-snap-type:x mandatory/);
});
