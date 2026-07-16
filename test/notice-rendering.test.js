const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('navigation renders action notices after the page header', () => {
  const views = path.join(__dirname, '..', 'views', 'partials');
  const head = fs.readFileSync(path.join(views, 'head.ejs'), 'utf8');
  const nav = fs.readFileSync(path.join(views, 'nav.ejs'), 'utf8');
  const publicNav = fs.readFileSync(path.join(views, 'public-nav.ejs'), 'utf8');
  const noticeMarkup = /class="notice"/g;

  assert.equal((head.match(noticeMarkup) || []).length, 0);
  assert.equal((nav.match(noticeMarkup) || []).length, 1);
  assert.equal((publicNav.match(noticeMarkup) || []).length, 1);
  assert.ok(nav.indexOf('class="notice"') > nav.indexOf('class="topbar"'));
  assert.ok(publicNav.indexOf('class="notice"') > publicNav.indexOf('</nav>'));
});
