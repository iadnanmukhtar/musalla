const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('public sitemaps only list canonical public pages', () => {
  const server = read('src/server.js');
  const textSitemap = server.match(/app\.get\('\/sitemap\.txt'[\s\S]*?app\.get\('\/sitemap\.xml'/)?.[0] || '';

  assert.match(textSitemap, /const paths = \['\/','\/about','\/musallas'/);
  assert.doesNotMatch(textSitemap, /'\/login'/);
  assert.match(server, /Sitemap: \$\{baseUrl\}\/sitemap\.xml/);
});

test('anonymous homepage is substantive and links to public communities', () => {
  const server = read('src/server.js');
  const home = read('views/home.ejs');
  const overview = read('views/partials/about-overview.ejs');

  assert.match(server, /return res\.render\('home', \{ featuredMusallas, structuredData, googleReady:/);
  assert.match(home, /class="login home-login"/);
  assert.match(home, /class="login-card"/);
  assert.match(home, /include\('partials\/about-overview'/);
  assert.match(home, /Frequently asked questions/i);
  assert.match(overview, /Inside the app/i);
  assert.match(home, /href="\/musallas"/);
  assert.match(home, /href="\/m\/<%= musalla\.guid %>"/);
  assert.equal((overview.match(/class="app-screenshot"/g) || []).length, 3);
});

test('public Musalla profiles expose richer fields and PostalAddress data', () => {
  const server = read('src/server.js');
  const view = read('views/public-musalla.ejs');
  const database = read('src/db.js');

  for (const field of ['street_address','address_locality','address_region','postal_code','address_country','facilities','website_url','public_email','public_phone']) {
    assert.match(database, new RegExp(field));
  }
  assert.match(server, /'@type': 'PostalAddress'/);
  assert.match(server, /amenityFeature/);
  assert.match(view, /Prayer information/);
  assert.match(view, /Facilities/);
  assert.match(view, /Website and contact/);
});

test('all changed public templates compile', () => {
  for (const file of ['views/home.ejs','views/login.ejs','views/about.ejs','views/public-musalla.ejs','views/register-musalla.ejs','views/musalla-profile.ejs','views/super-admin-musalla.ejs','views/partials/head.ejs','views/partials/about-overview.ejs','views/partials/public-nav.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
