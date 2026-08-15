require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool, initializeDatabase, scheduleBounds, syncPrayerSchedules, TEST_MODE } = require('./db');
const { notifySuperAdmins, notifyMusallaAdminsAndSuperAdmins, notifyMusallaImams, notifyMusallaImamsAndAdmins, notifyUser, notifyRequiredUser } = require('./email');
const { digestDetails, weeklyDigestHtml, startDailyAdminPrayerDigest } = require('./daily-digest');

const app = express();
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const absoluteUrl = value => new URL(value || '/icon-192.png', `${baseUrl}/`).href;
const cleanText = value => String(value || '').trim();
const setNotice = (req, message, type = 'success') => {
  req.session.notice = { message, type };
};
const safeHttpUrl = value => {
  const candidate = cleanText(value);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return ['http:','https:'].includes(url.protocol) ? url.href : '';
  } catch (_error) { return ''; }
};
const inferStructuredAddress = musalla => {
  if (!musalla || musalla.street_address || musalla.address_locality || musalla.address_region || musalla.postal_code || musalla.address_country) return musalla;
  const address = cleanText(musalla.address);
  if (!address) return musalla;
  const commaParts = address.split(',').map(part => part.trim()).filter(Boolean);
  if (commaParts.length >= 3) {
    const regionMatch = commaParts[commaParts.length - 1].match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
    if (regionMatch) return {
      ...musalla,
      street_address: commaParts.slice(0, -2).join(', '),
      address_locality: commaParts[commaParts.length - 2],
      address_region: regionMatch[1].toUpperCase(),
      postal_code: regionMatch[2] || '',
      address_country: 'US'
    };
  }
  const compactMatch = address.match(/^(.*?\b(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Pkwy|Parkway))\s+(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!compactMatch) return musalla;
  return {
    ...musalla,
    street_address: compactMatch[1],
    address_locality: compactMatch[2],
    address_region: compactMatch[3].toUpperCase(),
    postal_code: compactMatch[4],
    address_country: 'US'
  };
};
const publicProfileFields = body => {
  const fields = {
    street_address: cleanText(body.street_address),
    address_locality: cleanText(body.address_locality),
    address_region: cleanText(body.address_region),
    postal_code: cleanText(body.postal_code),
    address_country: cleanText(body.address_country),
    about: cleanText(body.about),
    facilities: cleanText(body.facilities),
    website_url: safeHttpUrl(body.website_url),
    public_email: cleanText(body.public_email).toLowerCase(),
    public_phone: cleanText(body.public_phone),
    timetable_url: safeHttpUrl(body.timetable_url)
  };
  const displayCountry = /^(?:US|USA|United States(?: of America)?)$/i.test(fields.address_country) ? '' : fields.address_country;
  fields.address = [
    fields.street_address,
    fields.address_locality,
    [fields.address_region, fields.postal_code].filter(Boolean).join(' '),
    displayCountry
  ].filter(Boolean).join(', ');
  return fields;
};
const facilitiesList = value => cleanText(value).split(/[\n,]+/).map(item => item.trim()).filter(Boolean).slice(0, 30);
const dailyPrayerNames = musalla => [
  ['fajr_enabled','Fajr'],['zuhr_enabled','Zuhr'],['asr_enabled','Asr'],['maghrib_enabled','Maghrib'],['isha_enabled','Isha']
].filter(([field]) => musalla[field]).map(([,name]) => name);
const jumuahSlotCount = musalla => [1,2,3].filter(number => musalla[`jumuah_${number}_enabled`]).length;
const logoDirectory = path.join(__dirname, '..', 'public', 'uploads', 'musalla-logos');
const profilePhotoDirectory = path.join(__dirname, '..', 'public', 'uploads', 'profile-photos');
const visibleMusalla = alias => TEST_MODE ? '1=1' : `${alias}.is_test=FALSE`;
fs.mkdirSync(logoDirectory, { recursive: true });
fs.mkdirSync(profilePhotoDirectory, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, logoDirectory),
    filename: (_req, file, done) => {
      const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      done(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, done) => ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)
    ? done(null, true)
    : done(new Error('Logo must be a PNG, JPG, WebP, or GIF image'))
});
const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, profilePhotoDirectory),
    filename: (_req, file, done) => {
      const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      done(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, done) => ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)
    ? done(null, true)
    : done(new Error('Profile photo must be a PNG, JPG, WebP, or GIF image'))
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'development-only-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: baseUrl.startsWith('https://'), maxAge: 30 * 24 * 60 * 60 * 1000 } }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM musalla_users WHERE id=?', [id]);
    const user = rows[0];
    done(null, user && (TEST_MODE || !user.is_test) ? user : false);
  } catch (error) { done(error); }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: `${baseUrl}/auth/google/callback` }, async (_a, _r, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error('Google account did not provide an email address'));
      let [rows] = await pool.execute('SELECT * FROM musalla_users WHERE google_id=? OR email=? LIMIT 1', [profile.id, email]);
      let user = rows[0];
      if (user?.is_test && !TEST_MODE) return done(null, false, { message: 'Test accounts are disabled' });
      if (user) {
        const generatedName = emailDisplayName(email);
        const name = !user.google_id && user.name === generatedName ? (profile.displayName || user.name || email) : user.name;
        await pool.execute("UPDATE musalla_users SET name=?,google_id=?,avatar_url=COALESCE(NULLIF(?,''),avatar_url) WHERE id=?", [name, profile.id, profile.photos?.[0]?.value || '', user.id]);
        [rows] = await pool.execute('SELECT * FROM musalla_users WHERE id=?', [user.id]);
        user = rows[0];
      } else {
        const [result] = await pool.execute('INSERT INTO musalla_users (google_id,email,name,avatar_url,is_test) VALUES (?,?,?,?,?)', [profile.id, email, profile.displayName || email, profile.photos?.[0]?.value || '', TEST_MODE]);
        [rows] = await pool.execute('SELECT * FROM musalla_users WHERE id=?', [result.insertId]);
        user = rows[0];
      }
      done(null, user);
    } catch (error) { done(error); }
  }));
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.is_disabled) { req.logout(() => {}); return res.status(403).render('message', { title: 'Access disabled', message: 'Please contact an administrator.' }); }
  next();
}

function hasRole(membership, role) {
  return String(membership?.role || '').split(',').includes(role);
}

function selectedRoles(body) {
  const values = Array.isArray(body.roles) ? body.roles : [body.roles];
  return ['imam','admin'].filter(role => values.includes(role));
}

function normalizedEmail(value) {
  const email = cleanText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '';
}

function emailDisplayName(email) {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 150) || email;
}

function roleNames(roles) {
  return roles.map(role => role === 'admin' ? 'Administrator' : 'Imam');
}

async function addMemberByEmail(musalla, email, roles) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userResult] = await connection.execute(`INSERT INTO musalla_users (email,name,is_test,registration_completed) VALUES (?,?,?,TRUE)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [email,emailDisplayName(email),Boolean(musalla.is_test)]);
    const [users] = await connection.execute('SELECT * FROM musalla_users WHERE id=? FOR UPDATE', [userResult.insertId]);
    const user = users[0];
    if (!user || Boolean(user.is_test)!==Boolean(musalla.is_test)) {
      await connection.rollback();
      return { status: 'environment_mismatch' };
    }
    if (user.is_disabled) {
      await connection.rollback();
      return { status: 'disabled' };
    }
    const [memberships] = await connection.execute('SELECT status FROM musalla_memberships WHERE musalla_id=? AND user_id=? FOR UPDATE', [musalla.id,user.id]);
    if (memberships[0] && ['active','disabled'].includes(memberships[0].status)) {
      await connection.rollback();
      return { status: 'already_member', user };
    }
    if (memberships[0]) {
      await connection.execute("UPDATE musalla_memberships SET status='active',role=?,requested_role='' WHERE musalla_id=? AND user_id=?", [roles.join(','),musalla.id,user.id]);
    } else {
      await connection.execute("INSERT INTO musalla_memberships (user_id,musalla_id,role,requested_role,status) VALUES (?,?,?,'','active')", [user.id,musalla.id,roles.join(',')]);
    }
    await connection.commit();
    return { status: 'added', user };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function removeMembership(musallaId, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=? FOR UPDATE', [musallaId]);
    if (!locations[0]) { await connection.rollback(); return false; }
    const { today } = scheduleBounds(new Date(), locations[0].timezone);
    await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [musallaId,userId,today]);
    await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND imam_user_id=?', [musallaId,userId]);
    const [result] = await connection.execute('DELETE FROM musalla_memberships WHERE musalla_id=? AND user_id=?', [musallaId,userId]);
    await connection.commit();
    return Boolean(result.affectedRows);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendAddedMembershipEmail(musalla, user, roles, addedBy) {
  const names = roleNames(roles);
  return notifyRequiredUser(pool, user.id, {
    subject: `You were added to ${musalla.name}`,
    preheader: `${addedBy} added you to ${musalla.name} as ${names.join(' and ')}.`,
    heading: 'You were added to a Musalla',
    message: `${addedBy} added you to ${musalla.name}. If you do not want this membership, use the button below to reject it.`,
    details: [
      { label: 'Musalla', value: musalla.name },
      { label: names.length === 1 ? 'Role' : 'Roles', value: names.join(', ') },
      { label: 'Added by', value: addedBy }
    ],
    actionLabel: 'Reject membership',
    actionUrl: `${baseUrl}/memberships/${musalla.guid}/reject`,
    logoUrl: absoluteUrl(musalla.logo_url)
  });
}

async function handleAddMemberRequest(req, res, musalla, redirectUrl) {
  const email = normalizedEmail(req.body.email);
  const roles = selectedRoles(req.body);
  if (!email) {
    setNotice(req, 'Enter a valid email address', 'error');
    return res.redirect(redirectUrl);
  }
  if (!roles.length) {
    setNotice(req, 'Select the Imam role, Administrator role, or both', 'error');
    return res.redirect(redirectUrl);
  }
  const result = await addMemberByEmail(musalla, email, roles);
  if (result.status === 'already_member') {
    setNotice(req, `${email} is already a member. Open their profile to change roles.`, 'error');
    return res.redirect(redirectUrl);
  }
  if (result.status === 'disabled') {
    setNotice(req, `${email} belongs to a disabled account`, 'error');
    return res.redirect(redirectUrl);
  }
  if (result.status === 'environment_mismatch') {
    setNotice(req, 'That account is not available in this environment', 'error');
    return res.redirect(redirectUrl);
  }
  const delivered = await sendAddedMembershipEmail(musalla, result.user, roles, req.user.name);
  setNotice(
    req,
    delivered
      ? `${email} was added and emailed instructions to reject the membership`
      : `${email} was added, but the membership email could not be sent`,
    delivered ? 'success' : 'error'
  );
  return res.redirect(redirectUrl);
}

async function notifyMembershipApproved(musallaId, userId, roles) {
  const [musallas] = await pool.execute('SELECT guid,name,logo_url FROM musalla_locations WHERE id=?', [musallaId]);
  if (!musallas[0]) return false;
  const roleNames = roles.length
    ? roles.map(role => role === 'admin' ? 'Administrator' : 'Imam')
    : ['Member'];
  return notifyUser(pool, userId, {
    subject: `Membership approved for ${musallas[0].name}`,
    preheader: `You have been approved to join ${musallas[0].name} as ${roleNames.join(' and ')}.`,
    heading: 'Your membership is approved',
    message: `You can now access ${musallas[0].name} in the Musalla app.`,
    details: [
      { label: 'Musalla', value: musallas[0].name },
      { label: roleNames.length === 1 ? 'Role' : 'Roles', value: roleNames.join(', ') }
    ],
    actionLabel: 'Open Musalla',
    actionUrl: `${baseUrl}/musallas/${musallas[0].guid}`,
    logoUrl: absoluteUrl(musallas[0].logo_url)
  }, musallaId);
}

function isSuperAdminMode(req) {
  return Boolean(req.user?.is_superuser && req.session.viewMode !== 'member');
}

async function updateMemberRoles(musallaId, userId, roles) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=?', [musallaId]);
    if (!locations[0]) { await connection.rollback(); return false; }
    const [memberships] = await connection.execute("SELECT status FROM musalla_memberships WHERE musalla_id=? AND user_id=? FOR UPDATE", [musallaId,userId]);
    if (!memberships[0] || !['active','disabled'].includes(memberships[0].status)) { await connection.rollback(); return false; }
    await connection.execute('UPDATE musalla_memberships SET role=? WHERE musalla_id=? AND user_id=?', [roles.join(','),musallaId,userId]);
    if (!roles.includes('imam')) {
      const { today } = scheduleBounds(new Date(), locations[0].timezone);
      await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [musallaId,userId,today]);
      await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND imam_user_id=?', [musallaId,userId]);
    }
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function musallaAccess(req, res, next) {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [locations] = await pool.execute(`SELECT id,guid,is_disabled FROM musalla_locations m WHERE guid=? AND ${visibleMusalla('m')}`, [req.params.guid]);
  if (!locations[0]) return res.sendStatus(404);
  if (locations[0].is_disabled) return res.status(403).render('message', { title: 'Musalla unavailable', message: 'This Musalla has been disabled.' });
  const [memberships] = await pool.execute("SELECT * FROM musalla_memberships WHERE user_id=? AND musalla_id=? AND status='active'", [req.user.id, locations[0].id]);
  if (!memberships[0]) return res.status(403).render('message', { title: 'No access', message: 'You are not a member of this Musalla.' });
  req.params.id = locations[0].id;
  req.musallaGuid = locations[0].guid;
  const redirect = res.redirect.bind(res);
  res.redirect = location => redirect(typeof location === 'string'
    ? location.replace(`/musallas/${locations[0].id}`, `/musallas/${locations[0].guid}`)
    : location);
  req.membership = memberships[0];
  next();
}

function requireAdmin(req, res, next) {
  if (hasRole(req.membership, 'admin')) return next();
  return res.status(403).render('message', { title: 'Admin only', message: 'You need Musalla administrator access.' });
}

function requireImam(req, res, next) {
  if (hasRole(req.membership, 'imam')) return next();
  setNotice(req, 'Only imams can opt in to lead salah', 'error');
  return res.redirect(`/musallas/${req.musallaGuid}`);
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.is_superuser) {
    req.session.viewMode = 'super';
    res.locals.superAdminMode = true;
    return next();
  }
  return res.status(403).render('message', { title: 'Super admin only', message: 'You need super administrator access.' });
}

app.use(async (req, res, next) => {
  try {
    res.locals.user = req.user || null;
    res.locals.baseUrl = baseUrl;
    res.locals.path = req.path;
    res.locals.musallaNav = null;
    res.locals.canManageMembers = false;
    res.locals.pendingApprovalCount = 0;
    res.locals.hideNavigation = false;
    res.locals.registrationConfirmation = req.session.registrationConfirmation || null;
    delete req.session.registrationConfirmation;
    res.locals.superAdminMode = isSuperAdminMode(req);
    res.locals.canSwitchToMember = false;
    if (req.user?.is_superuser) {
      const [roles] = await pool.execute("SELECT 1 FROM musalla_memberships WHERE user_id=? AND status='active' AND (FIND_IN_SET('imam',role)>0 OR FIND_IN_SET('admin',role)>0) LIMIT 1", [req.user.id]);
      res.locals.canSwitchToMember = Boolean(roles[0]);
      if (!roles[0] && req.session.viewMode==='member') {
        req.session.viewMode='super';
        res.locals.superAdminMode=true;
      }
    }
    res.locals.notice = req.session.notice;
    delete req.session.notice;
    next();
  } catch (error) { next(error); }
});
app.get('/login', (_req, res) => res.render('login', { googleReady: Boolean(process.env.GOOGLE_CLIENT_ID),testMode: TEST_MODE }));
app.get('/about', (req, res) => {
  res.locals.hideNavigation = true;
  res.render('about');
});
app.get('/musallas', async (req, res, next) => {
  try {
    const [musallas] = await pool.query(`SELECT m.guid,m.name,m.address,m.about,m.logo_url,m.jumuah_1_enabled,m.jumuah_2_enabled,m.jumuah_3_enabled,(SELECT COUNT(*) FROM musalla_memberships members WHERE members.musalla_id=m.id AND members.status='active') member_count FROM musalla_locations m WHERE is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY name`);
    res.locals.hideNavigation = true;
    res.render('public-musallas', { musallas });
  } catch (error) { next(error); }
});
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /profile\nDisallow: /membership-requests\nDisallow: /register\nDisallow: /super-admin\nSitemap: ${baseUrl}/sitemap.xml\nSitemap: ${baseUrl}/sitemap.txt\n`);
});
app.get('/sitemap.txt', async (_req, res, next) => {
  try {
    const [musallas] = await pool.query(`SELECT guid FROM musalla_locations m WHERE is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY id`);
    const paths = ['/','/about','/musallas',...musallas.map(musalla => `/m/${musalla.guid}`)];
    res.type('text/plain').send(`${paths.map(routePath => `${baseUrl}${routePath}`).join('\n')}\n`);
  } catch (error) { next(error); }
});
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const [musallas] = await pool.query(`SELECT guid FROM musalla_locations m WHERE is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY id`);
    const urls = ['/','/about','/musallas',...musallas.map(musalla => `/m/${musalla.guid}`)];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${baseUrl}${url}</loc></url>`).join('')}</urlset>`;
    res.type('application/xml').send(xml);
  } catch (error) { next(error); }
});
app.get('/m/:guid', async (req, res, next) => {
  try {
    const [musallas] = await pool.execute(`SELECT m.* FROM musalla_locations m WHERE guid=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.guid]);
    const musalla = inferStructuredAddress(musallas[0]);
    if (!musalla) return res.status(404).render('message', { title: 'Musalla unavailable', message: 'This public Musalla page is no longer available.' });
    let membership = null;
    if (req.user) {
      const [memberships] = await pool.execute('SELECT role,status FROM musalla_memberships WHERE user_id=? AND musalla_id=?', [req.user.id,musalla.id]);
      membership = memberships[0] || null;
    }
    res.locals.hideNavigation = true;
    const structuredData = { '@context': 'https://schema.org', '@type': ['Mosque','Organization'], name: musalla.name, url: `${baseUrl}/m/${musalla.guid}` };
    if (musalla.street_address || musalla.address_locality || musalla.address_region || musalla.postal_code || musalla.address_country) structuredData.address = {
      '@type': 'PostalAddress',
      streetAddress: musalla.street_address || undefined,
      addressLocality: musalla.address_locality || undefined,
      addressRegion: musalla.address_region || undefined,
      postalCode: musalla.postal_code || undefined,
      addressCountry: musalla.address_country || undefined
    };
    if (musalla.logo_url) structuredData.image = absoluteUrl(musalla.logo_url);
    if (musalla.about) structuredData.description = musalla.about;
    if (musalla.website_url) structuredData.sameAs = safeHttpUrl(musalla.website_url);
    if (musalla.public_email) structuredData.email = musalla.public_email;
    if (musalla.public_phone) structuredData.telephone = musalla.public_phone;
    const facilities = facilitiesList(musalla.facilities);
    if (facilities.length) structuredData.amenityFeature = facilities.map(name => ({ '@type': 'LocationFeatureSpecification', name, value: true }));
    res.render('public-musalla', {
      musalla: { ...musalla, id: musalla.guid }, membership,
      joinUrl: `/join/musallas/${musalla.guid}`, structuredData, facilities,
      dailyPrayers: dailyPrayerNames(musalla), jumuahCount: jumuahSlotCount(musalla),
      websiteUrl: safeHttpUrl(musalla.website_url)
    });
  } catch (error) { next(error); }
});
app.get('/join/musallas/:guid', async (req, res, next) => {
  try {
    const [musallas] = await pool.execute(`SELECT id FROM musalla_locations m WHERE guid=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.guid]);
    if (!musallas[0]) return res.status(404).render('message', { title: 'Musalla unavailable', message: 'This Musalla is no longer available to join.' });
    const destination = `/membership-requests?join=${musallas[0].id}`;
    if (req.user) return res.redirect(destination);
    req.session.authRedirect = destination;
    res.redirect('/login');
  } catch (error) { next(error); }
});
app.get('/invite/musallas/:guid', async (req, res, next) => {
  try {
    const [musallas] = await pool.execute(`SELECT id FROM musalla_locations m WHERE guid=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.guid]);
    if (!musallas[0]) return res.status(404).render('message', { title: 'Invitation unavailable', message: 'This Musalla invitation is no longer available.' });
    const destination = `/membership-requests?musalla=${musallas[0].id}`;
    if (req.user) return res.redirect(destination);
    req.session.authRedirect = destination;
    res.redirect('/login');
  } catch (error) { next(error); }
});
app.post('/auth/test/:role', async (req, res, next) => {
  if (!TEST_MODE || !['new','imam','admin'].includes(req.params.role)) return res.sendStatus(404);
  try {
    const email = `test-${req.params.role}@musalla.local`;
    if (req.params.role==='new') {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute('SELECT id FROM musalla_users WHERE email=? AND is_test=TRUE FOR UPDATE', [email]);
        if (!users[0]) { await connection.rollback(); return res.status(503).render('message', { title: 'Test account unavailable', message: 'Restart the app to seed test accounts.' }); }
        await connection.execute('DELETE FROM musalla_locations WHERE created_by=? AND is_test=TRUE', [users[0].id]);
        await connection.execute('DELETE FROM musalla_memberships WHERE user_id=?', [users[0].id]);
        await connection.execute("UPDATE musalla_users SET name='Test New User',phone='',bio='',avatar_url='',registration_completed=FALSE,is_disabled=FALSE WHERE id=?", [users[0].id]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    const [rows] = await pool.execute('SELECT * FROM musalla_users WHERE email=? AND is_test=TRUE AND is_disabled=FALSE', [email]);
    if (!rows[0]) return res.status(503).render('message', { title: 'Test account unavailable', message: 'Restart the app to seed test accounts.' });
    const destination = req.params.role==='new' ? '/' : (req.session.authRedirect || '/');
    delete req.session.authRedirect;
    req.login(rows[0], error => error ? next(error) : res.redirect(destination));
  } catch (error) { next(error); }
});
app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/login');
  req.session.authRedirect = req.query.next==='/register-musalla' ? '/register-musalla' : (req.session.authRedirect || '/');
  passport.authenticate('google', { scope: ['profile','email'] })(req,res,next);
});
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  const destination = req.session.authRedirect || '/';
  delete req.session.authRedirect;
  res.redirect(destination);
});
app.post('/logout', (req, res) => req.logout(() => res.redirect('/login')));
app.post('/view-mode', requireAuth, async (req, res) => {
  if (!req.user.is_superuser) return res.sendStatus(403);
  if (req.body.mode==='super') {
    req.session.viewMode='super';
    return res.redirect('/super-admin');
  }
  if (req.body.mode!=='member') return res.sendStatus(400);
  const [roles] = await pool.execute("SELECT 1 FROM musalla_memberships WHERE user_id=? AND status='active' AND (FIND_IN_SET('imam',role)>0 OR FIND_IN_SET('admin',role)>0) LIMIT 1", [req.user.id]);
  if (!roles[0]) {
    setNotice(req, 'You need an active Imam or Musalla Administrator role to switch views', 'error');
    return res.redirect('/super-admin');
  }
  req.session.viewMode='member';
  res.redirect('/');
});

app.get('/super-admin', requireAuth, requireSuperAdmin, async (req, res) => {
  const [musallas] = await pool.query(`SELECT m.*,COUNT(DISTINCT CASE WHEN ms.status IN ('active','disabled') THEN ms.user_id END) member_count,COUNT(DISTINCT CASE WHEN ms.status='pending' THEN ms.user_id END) pending_count,COUNT(DISTINCT CASE WHEN ms.status='active' AND FIND_IN_SET('admin',ms.role)>0 THEN ms.user_id END) admin_count FROM musalla_locations m LEFT JOIN musalla_memberships ms ON ms.musalla_id=m.id WHERE ${visibleMusalla('m')} GROUP BY m.id ORDER BY m.is_disabled,m.name`);
  res.locals.superAdminPendingCount=musallas.reduce((count, musalla) => count + Number(musalla.pending_count), 0);
  res.render('super-admin', { musallas });
});
app.get('/super-admin/musallas/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  const [members] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url,IF(ms.role='','Member',ms.role) role,ms.status FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status IN ('active','disabled') ORDER BY ms.status,ms.role,u.name", [req.params.id]);
  const [requests] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url,ms.requested_role FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='pending' ORDER BY u.name", [req.params.id]);
  const [adminRows] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  res.render('super-admin-musalla', { musalla: inferStructuredAddress(rows[0]), members, requests, needsInitialAdmin: Number(adminRows[0].count)===0 });
});
app.post('/super-admin/musallas/:id/members/add', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT id,guid,name,logo_url,is_test FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  return handleAddMemberRequest(req, res, rows[0], `/super-admin/musallas/${req.params.id}`);
});
app.post('/super-admin/musallas/:id/membership-requests/:userId/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  const [admins] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  if (Number(admins[0].count)===0 && !roles.length) { setNotice(req, 'Select at least one role for the initial membership', 'error'); return res.redirect(`/super-admin/musallas/${req.params.id}`); }
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='active',role=?,requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [roles.join(','),req.params.id,req.params.userId]);
  if (result.affectedRows) await notifyMembershipApproved(req.params.id, req.params.userId, roles);
  setNotice(req, result.affectedRows?'Membership request approved':'Membership request is no longer pending', result.affectedRows?'success':'error');
  res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.post('/super-admin/musallas/:id/membership-requests/:userId/deny', requireAuth, requireSuperAdmin, async (req, res) => {
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='denied',role='',requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [req.params.id,req.params.userId]);
  setNotice(req, result.affectedRows?'Membership request denied':'Membership request is no longer pending', result.affectedRows?'success':'error');
  res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.get('/super-admin/musallas/:id/members/:userId/profile', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT u.id,u.name,u.email,u.phone,u.bio,u.avatar_url,ms.role,ms.status,m.name musalla_name,m.id musalla_id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('pending','active','disabled') AND ${visibleMusalla('m')}`, [req.params.id,req.params.userId]);
  if (!rows[0]) return res.sendStatus(404);
  res.type('html').set('Content-Disposition','inline').render('member-profile', {
    member: rows[0], isSuperAdmin: true, canEditProfile: true,
    profileFormAction: `/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile/details`,
    roleFormAction: `/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`,
    backUrl: `/super-admin/musallas/${req.params.id}`
  });
});
app.post('/super-admin/musallas/:id/members/:userId/profile/details', requireAuth, requireSuperAdmin, async (req, res) => {
  const [members] = await pool.execute(`SELECT u.id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('pending','active','disabled') AND ${visibleMusalla('m')}`, [req.params.id,req.params.userId]);
  if (!members[0]) return res.sendStatus(404);
  const name = cleanText(req.body.name).slice(0, 150);
  if (!name) { setNotice(req, 'Member name is required', 'error'); return res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`); }
  await pool.execute('UPDATE musalla_users SET name=?,phone=?,bio=? WHERE id=?', [name,cleanText(req.body.phone).slice(0,30),cleanText(req.body.bio).slice(0,500),members[0].id]);
  setNotice(req, 'Member profile updated');
  res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`);
});
app.post('/super-admin/musallas/:id/members/:userId/profile', requireAuth, requireSuperAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  if (!roles.length) { setNotice(req, 'Select at least one role', 'error'); return res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`); }
  await updateMemberRoles(req.params.id, req.params.userId, roles);
  setNotice(req, 'Member roles updated'); res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`);
});
app.post('/super-admin/musallas/:id/notifications', requireAuth, requireSuperAdmin, async (req, res) => {
  const notificationsEnabled = req.body.notifications_enabled === '1';
  const [result] = await pool.execute(`UPDATE musalla_locations SET notifications_enabled=? WHERE id=? AND ${visibleMusalla('musalla_locations')}`, [notificationsEnabled,req.params.id]);
  if (!result.affectedRows) return res.sendStatus(404);
  setNotice(req, notificationsEnabled?'Musalla notifications enabled':'Musalla notifications disabled');
  res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.post('/super-admin/musallas/:id', requireAuth, requireSuperAdmin, logoUpload.single('logo'), async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  const musalla = rows[0];
  if (!musalla) return res.sendStatus(404);
  const logoUrl = req.file ? `/uploads/musalla-logos/${req.file.filename}` : musalla.logo_url;
  const publicProfile = publicProfileFields(req.body);
  const salahEnabled = ['fajr','zuhr','asr','maghrib','isha'].map(prayer => req.body[`${prayer}_enabled`] === '1');
  const jumuahEnabled = [1,2,3].map(number => req.body[`jumuah_${number}_enabled`] === '1');
  await pool.execute('UPDATE musalla_locations SET name=?,address=?,street_address=?,address_locality=?,address_region=?,postal_code=?,address_country=?,about=?,facilities=?,website_url=?,public_email=?,public_phone=?,timetable_url=?,timezone=?,logo_url=?,fajr_enabled=?,zuhr_enabled=?,asr_enabled=?,maghrib_enabled=?,isha_enabled=?,jumuah_1_enabled=?,jumuah_2_enabled=?,jumuah_3_enabled=? WHERE id=?', [cleanText(req.body.name),publicProfile.address,publicProfile.street_address,publicProfile.address_locality,publicProfile.address_region,publicProfile.postal_code,publicProfile.address_country,publicProfile.about||null,publicProfile.facilities||null,publicProfile.website_url||null,publicProfile.public_email,publicProfile.public_phone,publicProfile.timetable_url,cleanText(req.body.timezone)||'America/Chicago',logoUrl,...salahEnabled,...jumuahEnabled,req.params.id]);
  await syncPrayerSchedules(req.params.id);
  setNotice(req, 'Musalla updated'); res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.post('/super-admin/musallas/:id/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  const musalla = rows[0];
  if (!musalla) return res.sendStatus(404);
  const disabling = !musalla.is_disabled;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE musalla_locations SET is_disabled=? WHERE id=?', [disabling, req.params.id]);
    if (disabling) {
      await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=?', [req.params.id]);
      await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=?', [req.params.id]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (!disabling) await syncPrayerSchedules(req.params.id);
  setNotice(req, disabling?'Musalla disabled and imams unslotted':'Musalla enabled'); res.redirect('/super-admin');
});
app.post('/super-admin/musallas/:id/delete', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  const musalla = rows[0];
  if (!musalla) return res.sendStatus(404);
  await pool.execute('DELETE FROM musalla_locations WHERE id=?', [req.params.id]);
  if (musalla.logo_url?.startsWith('/uploads/musalla-logos/')) fs.unlink(path.join(__dirname, '..', 'public', musalla.logo_url), () => {});
  setNotice(req, 'Musalla deleted'); res.redirect('/super-admin');
});

app.get('/', async (req, res) => {
  if (!req.user) {
    const [rows] = await pool.query(`SELECT m.guid,m.name,m.address,m.street_address,m.address_locality,m.address_region,m.postal_code,m.address_country,m.about,m.logo_url,m.jumuah_1_enabled,m.jumuah_2_enabled,m.jumuah_3_enabled FROM musalla_locations m WHERE is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY name LIMIT 6`);
    const featuredMusallas = rows.map(inferStructuredAddress);
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Musalla', url: `${baseUrl}/`, description: 'Prayer and khutbah scheduling for Musallas and Masajid.' },
        { '@type': 'SoftwareApplication', name: 'Musalla', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: `${baseUrl}/`, description: 'A shared weekly imam, salah, and khutbah scheduling workspace for prayer communities.' }
      ]
    };
    return res.render('home', { featuredMusallas, structuredData, googleReady: Boolean(process.env.GOOGLE_CLIENT_ID), testMode: TEST_MODE });
  }
  if (req.user.is_disabled) {
    req.logout(() => {});
    return res.status(403).render('message', { title: 'Access disabled', message: 'Please contact an administrator.' });
  }
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [musallas] = await pool.execute(`SELECT m.*,IF(ms.role='','Member',ms.role) role,(SELECT COUNT(*) FROM musalla_memberships members WHERE members.musalla_id=m.id AND members.status='active') member_count FROM musalla_locations m JOIN musalla_memberships ms ON ms.musalla_id=m.id AND ms.user_id=? WHERE ms.status='active' AND m.is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY CASE WHEN FIND_IN_SET('imam',ms.role)>0 OR FIND_IN_SET('admin',ms.role)>0 THEN 0 ELSE 1 END,m.name`, [req.user.id]);
  if (!musallas.length) return res.redirect('/register/musallas');
  const [requests] = await pool.execute(`SELECT m.id,m.name,ms.status FROM musalla_memberships ms JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.user_id=? AND ms.status IN ('pending','denied') AND m.is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY m.name`, [req.user.id]);
  res.render('dashboard', { musallas,requests });
});
app.get('/membership-requests', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const invitedMusallaId = Number.parseInt(req.query.musalla, 10) || 0;
  const selectedMusallaId = invitedMusallaId || Number.parseInt(req.query.join, 10) || 0;
  const [musallas] = await pool.execute(`SELECT m.id,m.guid,m.name,m.address,m.logo_url,m.jumuah_1_enabled,m.jumuah_2_enabled,m.jumuah_3_enabled,ms.status,(SELECT COUNT(*) FROM musalla_memberships members WHERE members.musalla_id=m.id AND members.status='active') member_count FROM musalla_locations m LEFT JOIN musalla_memberships ms ON ms.musalla_id=m.id AND ms.user_id=? WHERE m.is_disabled=FALSE AND (ms.status IS NULL OR ms.status IN ('pending','denied')) AND ${visibleMusalla('m')} ORDER BY (m.id=?) DESC,CASE ms.status WHEN 'pending' THEN 0 WHEN 'denied' THEN 1 ELSE 2 END,m.name`, [req.user.id,selectedMusallaId]);
  res.render('membership-requests', { musallas,selectedMusallaId,invitedMusallaId });
});
app.post('/membership-requests/:id', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [locations] = await pool.execute(`SELECT id,guid,name,is_test,logo_url FROM musalla_locations m WHERE id=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.id]);
  if (!locations[0]) return res.sendStatus(404);
  if (req.user.is_test && !locations[0].is_test) return res.sendStatus(403);
  const requestedRole = req.body.requested_role === 'imam' ? 'imam' : '';
  const [existing] = await pool.execute('SELECT status FROM musalla_memberships WHERE user_id=? AND musalla_id=?', [req.user.id,req.params.id]);
  await pool.execute(`INSERT INTO musalla_memberships (user_id,musalla_id,role,requested_role,status) VALUES (?,?,'',?,'pending') ON DUPLICATE KEY UPDATE status=IF(status IN ('active','disabled'),status,'pending'),requested_role=IF(status IN ('active','disabled'),requested_role,VALUES(requested_role))`, [req.user.id,req.params.id,requestedRole]);
  if (!existing[0] || existing[0].status==='denied') await notifyMusallaAdminsAndSuperAdmins(pool, locations[0].id, {
    subject: `Membership request for ${locations[0].name}`,
    preheader: `${req.user.name} requested to join ${locations[0].name}.`,
    heading: 'New membership request',
    message: 'A community member is waiting for approval. Review their request and assign the appropriate role.',
    details: [
      { label: 'Applicant', value: req.user.name },
      { label: 'Email', value: req.user.email },
      { label: 'Musalla', value: locations[0].name },
      { label: 'Requested role', value: requestedRole === 'imam' ? 'Imam' : 'Member' }
    ],
    actionLabel: 'Review membership request',
    actionUrl: `${baseUrl}/musallas/${locations[0].guid}/members`,
    logoUrl: absoluteUrl(locations[0].logo_url)
  });
  setNotice(req, 'Membership request sent'); res.redirect('/membership-requests');
});
app.post('/membership-requests/:id/cancel', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [result] = await pool.execute("DELETE FROM musalla_memberships WHERE user_id=? AND musalla_id=? AND status='pending'", [req.user.id,req.params.id]);
  setNotice(req, result.affectedRows?'Membership request cancelled':'Membership request is no longer pending', result.affectedRows?'success':'error');
  res.redirect(req.body.return_to==='/'?'/':'/membership-requests');
});
app.get('/memberships/:guid/reject', async (req, res) => {
  if (!req.user) {
    req.session.authRedirect=req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.is_disabled) {
    req.logout(() => {});
    return res.status(403).render('message', { title: 'Access disabled', message: 'Please contact an administrator.' });
  }
  const [memberships] = await pool.execute(`SELECT m.id,m.guid,m.name,ms.role FROM musalla_memberships ms JOIN musalla_locations m ON m.id=ms.musalla_id WHERE m.guid=? AND ms.user_id=? AND ms.status IN ('active','disabled') AND ${visibleMusalla('m')}`, [req.params.guid,req.user.id]);
  if (!memberships[0]) return res.status(404).render('message', { title: 'Membership unavailable', message: 'This membership is no longer active or belongs to a different account.' });
  const membership = memberships[0];
  const roles = roleNames(String(membership.role || '').split(',').filter(Boolean));
  res.render('reject-membership', { membership, roleLabel: roles.join(' and ') || 'Member' });
});
app.post('/memberships/:guid/reject', requireAuth, async (req, res) => {
  const [memberships] = await pool.execute(`SELECT m.id,m.name FROM musalla_memberships ms JOIN musalla_locations m ON m.id=ms.musalla_id WHERE m.guid=? AND ms.user_id=? AND ms.status IN ('active','disabled') AND ${visibleMusalla('m')}`, [req.params.guid,req.user.id]);
  if (!memberships[0]) return res.status(404).render('message', { title: 'Membership unavailable', message: 'This membership is no longer active or belongs to a different account.' });
  await removeMembership(memberships[0].id, req.user.id);
  setNotice(req, `Membership at ${memberships[0].name} rejected and removed`);
  res.redirect('/');
});
app.get('/register/musallas', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [active] = await pool.execute("SELECT 1 FROM musalla_memberships WHERE user_id=? AND status='active' LIMIT 1", [req.user.id]);
  if (active[0]) return res.redirect('/');
  const [musallas] = await pool.execute(`SELECT m.id,m.guid,m.name,m.address,m.logo_url,m.jumuah_1_enabled,m.jumuah_2_enabled,m.jumuah_3_enabled,ms.status,(SELECT COUNT(*) FROM musalla_memberships members WHERE members.musalla_id=m.id AND members.status='active') member_count FROM musalla_locations m LEFT JOIN musalla_memberships ms ON ms.musalla_id=m.id AND ms.user_id=? WHERE m.is_disabled=FALSE AND (ms.status IS NULL OR ms.status IN ('pending','denied')) AND ${visibleMusalla('m')} ORDER BY CASE ms.status WHEN 'pending' THEN 0 WHEN 'denied' THEN 1 ELSE 2 END,m.name`, [req.user.id]);
  res.render('register-musallas', { musallas });
});
app.post('/register/musallas', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [active] = await pool.execute("SELECT 1 FROM musalla_memberships WHERE user_id=? AND status='active' LIMIT 1", [req.user.id]);
  if (active[0]) return res.redirect('/');
  const submittedIds = req.body?.musalla_ids;
  const requested = (Array.isArray(submittedIds)?submittedIds:[submittedIds]).filter(Boolean).map(Number).filter(Number.isInteger);
  const ids = [...new Set(requested)];
  if (!ids.length) { setNotice(req, 'Select at least one Musalla', 'error'); return res.redirect('/register/musallas'); }
  const [available] = await pool.query(`SELECT id,guid,name,is_test,logo_url FROM musalla_locations m WHERE is_disabled=FALSE AND id IN (?) AND ${visibleMusalla('m')}`, [ids]);
  if (req.user.is_test && available.some(musalla => !musalla.is_test)) { setNotice(req, 'Test users can only join test Musallas', 'error'); return res.redirect('/register/musallas'); }
  if (!available.length) { setNotice(req, 'Select at least one available Musalla', 'error'); return res.redirect('/register/musallas'); }
  const connection = await pool.getConnection();
  const newRequests = [];
  try {
    await connection.beginTransaction();
    for (const musalla of available) {
      const [result] = await connection.execute("INSERT INTO musalla_memberships (user_id,musalla_id,role,status) VALUES (?,?,'','pending') ON DUPLICATE KEY UPDATE status=IF(status='denied','pending',status)", [req.user.id,musalla.id]);
      if (result.affectedRows) newRequests.push(musalla);
    }
    await connection.execute('UPDATE musalla_users SET registration_completed=TRUE WHERE id=?', [req.user.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  for (const musalla of newRequests) await notifyMusallaAdminsAndSuperAdmins(pool, musalla.id, {
    subject: `Membership request for ${musalla.name}`,
    preheader: `${req.user.name} requested to join ${musalla.name}.`,
    heading: 'New membership request',
    message: 'A community member is waiting for approval. Review their request and assign the appropriate role.',
    details: [
      { label: 'Applicant', value: req.user.name },
      { label: 'Email', value: req.user.email },
      { label: 'Musalla', value: musalla.name },
      { label: 'Requested role', value: 'Member' }
    ],
    actionLabel: 'Review membership request',
    actionUrl: `${baseUrl}/musallas/${musalla.guid}/members`,
    logoUrl: absoluteUrl(musalla.logo_url)
  });
  setNotice(req, 'Musalla membership requested. An administrator can now assign your role.');
  res.redirect('/');
});
app.get('/profile', requireAuth, (req, res) => res.render('profile'));
app.post('/profile/notifications', requireAuth, async (req, res) => {
  const notificationsEnabled = req.body.notifications_enabled === '1';
  await pool.execute('UPDATE musalla_users SET notifications_enabled=? WHERE id=?', [notificationsEnabled,req.user.id]);
  setNotice(req, notificationsEnabled?'Notifications enabled':'Notifications disabled');
  res.redirect('/profile');
});
app.post('/profile', requireAuth, profilePhotoUpload.single('profile_photo'), async (req, res) => {
  const avatarUrl = req.file ? `/uploads/profile-photos/${req.file.filename}` : req.user.avatar_url;
  await pool.execute('UPDATE musalla_users SET name=?,phone=?,bio=?,avatar_url=? WHERE id=?', [req.body.name.trim(),req.body.phone.trim(),req.body.bio.trim(),avatarUrl,req.user.id]);
  setNotice(req, 'Profile updated'); res.redirect('/profile');
});
app.get('/register-musalla', requireAuth, (req, res) => {
  const canCancel = Boolean(req.user.registration_completed);
  res.locals.hideNavigation = !canCancel;
  res.render('register-musalla', { canCancel, isSuperAdminRegistration: Boolean(req.user.is_superuser) });
});
app.post('/musallas', requireAuth, async (req, res) => {
  const isSuperAdminRegistration = Boolean(req.user.is_superuser);
  const [activeMemberships] = isSuperAdminRegistration ? [[]] : await pool.execute("SELECT 1 FROM musalla_memberships WHERE user_id=? AND status='active' LIMIT 1", [req.user.id]);
  const registrationDestination = activeMemberships[0] ? '/' : '/register/musallas';
  const connection = await pool.getConnection();
  const guid = crypto.randomUUID();
  const musallaName = cleanText(req.body.name);
  const publicProfile = publicProfileFields(req.body);
  const musallaAddress = publicProfile.address;
  let id;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO musalla_locations (guid,name,address,street_address,address_locality,address_region,postal_code,address_country,about,facilities,website_url,public_email,public_phone,timetable_url,timezone,created_by,is_test) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [guid,musallaName,musallaAddress,publicProfile.street_address,publicProfile.address_locality,publicProfile.address_region,publicProfile.postal_code,publicProfile.address_country,publicProfile.about||null,publicProfile.facilities||null,publicProfile.website_url||null,publicProfile.public_email,publicProfile.public_phone,publicProfile.timetable_url,req.body.timezone||'America/Chicago',req.user.id,Boolean(TEST_MODE || req.user.is_test)]);
    id = result.insertId;
    if (!isSuperAdminRegistration) await connection.execute("INSERT INTO musalla_memberships (user_id,musalla_id,role,status) VALUES (?,?,'','pending')", [req.user.id,id]);
    await connection.execute('UPDATE musalla_users SET registration_completed=TRUE WHERE id=?', [req.user.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await syncPrayerSchedules(id);
  await notifyUser(pool, req.user.id, {
    subject: `${musallaName} has been registered`,
    preheader: `Your new Musalla, ${musallaName}, was registered successfully.`,
    heading: 'Musalla registration confirmed',
    message: isSuperAdminRegistration ? `${musallaName} is ready to manage.` : `${musallaName} has been added. A super admin will review your initial membership and role.`,
    details: [
      { label: 'Musalla', value: musallaName },
      { label: 'Address', value: musallaAddress || 'Not provided' },
      { label: 'Status', value: isSuperAdminRegistration ? 'Registered' : 'Awaiting initial membership approval' }
    ],
    actionLabel: 'View public Musalla page',
    actionUrl: `${baseUrl}/m/${guid}`,
    logoUrl: absoluteUrl('/icon-192.png')
  }, id);
  await notifySuperAdmins(pool, {
    subject: `New Musalla registered: ${musallaName}`,
    preheader: isSuperAdminRegistration ? `${musallaName} was registered.` : `${musallaName} was registered and needs its first member approved.`,
    heading: 'New Musalla registration',
    message: isSuperAdminRegistration ? 'A new Musalla has been added by a super admin.' : 'A new Musalla has been added. Approve its first member and assign the appropriate role.',
    details: [
      { label: 'Musalla', value: musallaName },
      { label: 'Address', value: musallaAddress || 'Not provided' },
      { label: 'Submitted by', value: req.user.name },
      { label: 'Email', value: req.user.email }
    ],
    actionLabel: isSuperAdminRegistration ? 'Manage Musalla' : 'Review initial membership',
    actionUrl: `${baseUrl}/super-admin/musallas/${id}`,
    logoUrl: absoluteUrl('/icon-192.png'),
    musallaId: id
  });
  req.session.registrationConfirmation = {
    name: musallaName,
    message: isSuperAdminRegistration ? 'The Musalla was registered successfully and is ready to manage.' : 'The Musalla was registered successfully. A super admin has been notified to review your initial membership and role.'
  };
  if (isSuperAdminRegistration) {
    req.session.viewMode='super';
    return res.redirect(`/super-admin/musallas/${id}`);
  }
  res.redirect(registrationDestination);
});
app.get('/musallas/:guid', requireAuth, musallaAccess, async (req, res) => {
  const [locations] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  const musalla = locations[0];
  const { firstDate,lastDate,today } = scheduleBounds(new Date(),musalla.timezone);
  const requestedDate = req.query.navigate || req.query.date || today;
  let date = requestedDate >= firstDate && requestedDate <= lastDate ? requestedDate : today;
  const finalWeekStart = new Date(`${lastDate}T12:00:00Z`);
  finalWeekStart.setUTCDate(finalWeekStart.getUTCDate()-6);
  const finalWeekStartValue = finalWeekStart.toISOString().slice(0,10);
  if (date > finalWeekStartValue) date = finalWeekStartValue;
  const weekEnd = new Date(`${date}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
  const weekEndDate = weekEnd.toISOString().slice(0,10);
  const [slots] = await pool.execute(`SELECT p.*,u.name imam_name,u.avatar_url FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date BETWEEN ? AND ? ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [req.params.id,date,weekEndDate]);
  const isAdmin = hasRole(req.membership, 'admin');
  const canLead = hasRole(req.membership, 'imam');
  let eligibleImams = [];
  res.locals.musallaNav={ ...musalla, id: musalla.guid };
  res.locals.canManageMembers=isAdmin;
  if (isAdmin) {
    const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
    res.locals.pendingApprovalCount=Number(pending[0].count);
    [eligibleImams] = await pool.execute("SELECT u.id,u.name FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='active' AND FIND_IN_SET('imam',ms.role)>0 AND u.is_disabled=FALSE ORDER BY u.name", [req.params.id]);
  }
  res.render('musalla', { musalla: { ...musalla, id: musalla.guid },slots,date,weekEndDate,today,firstDate,lastDate,finalWeekStart: finalWeekStartValue,isAdmin,canLead,eligibleImams });
});
app.post('/musallas/:guid/remind-imams', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [locations] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  const musalla = locations[0];
  if (!musalla) return res.sendStatus(404);
  const { firstDate,lastDate,today } = scheduleBounds(new Date(),musalla.timezone);
  const finalWeekStart = new Date(`${lastDate}T12:00:00Z`);
  finalWeekStart.setUTCDate(finalWeekStart.getUTCDate()-6);
  const finalWeekStartValue = finalWeekStart.toISOString().slice(0,10);
  const requestedDate = req.body.date;
  let weekStart = requestedDate >= firstDate && requestedDate <= lastDate ? requestedDate : today;
  if (weekStart > finalWeekStartValue) weekStart = finalWeekStartValue;
  const weekEnd = new Date(`${weekStart}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
  const weekEndDate = weekEnd.toISOString().slice(0,10);
  const [slots] = await pool.execute(`SELECT p.prayer_date,p.prayer_name,u.name imam_name FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date BETWEEN ? AND ? ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [req.params.id,weekStart,weekEndDate]);
  const openCount = slots.filter(slot => !slot.imam_name).length;
  if (!openCount) {
    setNotice(req, 'Every available prayer slot in this week is already filled', 'error');
    return res.redirect(`/musallas/${req.params.id}?date=${weekStart}`);
  }
  const displayDate = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
  const delivered = await notifyMusallaImams(pool, musalla.id, {
    subject: `${musalla.name} needs Imam coverage · ${displayDate(weekStart)}–${displayDate(weekEndDate)}`,
    preheader: `${openCount} prayer ${openCount===1?'slot needs':'slots need'} an Imam over the next seven days.`,
    heading: 'Please help fill the prayer schedule',
    message: `${musalla.name} has ${openCount} open prayer ${openCount===1?'slot':'slots'} in this week. Please review the highlighted openings and opt in where you can lead.`,
    details: digestDetails(slots, weekStart),
    contentHtml: weeklyDigestHtml(slots, weekStart),
    actionLabel: 'View open prayer slots',
    actionUrl: new URL(`/musallas/${musalla.guid}?date=${weekStart}`, `${baseUrl}/`).href,
    logoUrl: musalla.logo_url ? absoluteUrl(musalla.logo_url) : undefined
  });
  setNotice(req, delivered?`Reminder sent to active Imams for ${openCount} open ${openCount===1?'slot':'slots'}`:'The reminder could not be sent because no active Imam recipient or email service was available', delivered?'success':'error');
  res.redirect(`/musallas/${req.params.id}?date=${weekStart}`);
});
app.post('/musallas/:guid/leave', requireAuth, musallaAccess, async (req, res) => {
  await removeMembership(req.params.id, req.user.id);
  setNotice(req, 'You have left the Musalla and your future prayer assignments were cleared');
  res.redirect('/');
});
app.get('/musallas/:guid/members', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [locations] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  const musalla = locations[0];
  if (!musalla) return res.sendStatus(404);
  const isAdmin = true;
  const sql = `SELECT u.id,u.name,u.email,u.avatar_url,IF(ms.role='','Member',ms.role) role,ms.status FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status IN ('active','disabled') ORDER BY ms.status,ms.role,u.name`;
  const [members] = await pool.execute(sql, [req.params.id]);
  const [requests] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url,ms.status,ms.requested_role FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='pending' ORDER BY u.name", [req.params.id]);
  res.locals.musallaNav={ ...musalla, id: musalla.guid };
  res.locals.canManageMembers=true;
  res.locals.pendingApprovalCount=requests.length;
  res.render('members', { musalla: { ...musalla, id: musalla.guid },members,requests,isAdmin });
});
app.post('/musallas/:guid/members/add', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [rows] = await pool.execute('SELECT id,guid,name,logo_url,is_test FROM musalla_locations WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  return handleAddMemberRequest(req, res, rows[0], `/musallas/${req.musallaGuid}/members`);
});
app.get('/musallas/:guid/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  res.locals.musallaNav={ ...rows[0], id: rows[0].guid };
  res.locals.canManageMembers=true;
  const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
  res.locals.pendingApprovalCount=Number(pending[0].count);
  const musalla = inferStructuredAddress(rows[0]);
  res.render('musalla-profile', { musalla: { ...musalla, id: musalla.guid } });
});
app.get('/musallas/:guid/members/:userId/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [rows] = await pool.execute("SELECT u.id,u.name,u.email,u.phone,u.bio,u.avatar_url,ms.role,ms.status,m.name musalla_name,m.id musalla_id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('pending','active','disabled')", [req.params.id,req.params.userId]);
  if (!rows[0]) return res.sendStatus(404);
  res.locals.musallaNav={ id: req.musallaGuid };
  res.locals.canManageMembers=true;
  const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
  res.locals.pendingApprovalCount=Number(pending[0].count);
  const canEditProfile = rows[0].status!=='pending' && (hasRole(rows[0],'imam') || hasRole(rows[0],'admin'));
  res.type('html').set('Content-Disposition','inline').render('member-profile', {
    member: rows[0], isSuperAdmin: false, canEditProfile,
    profileFormAction: `/musallas/${req.musallaGuid}/members/${req.params.userId}/profile/details`,
    roleFormAction: `/musallas/${req.musallaGuid}/members/${req.params.userId}/profile`,
    backUrl: `/musallas/${req.musallaGuid}/members`
  });
});
app.post('/musallas/:guid/members/:userId/profile/details', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [members] = await pool.execute("SELECT u.id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('active','disabled') AND (FIND_IN_SET('imam',ms.role)>0 OR FIND_IN_SET('admin',ms.role)>0)", [req.params.id,req.params.userId]);
  if (!members[0]) return res.sendStatus(403);
  const name = cleanText(req.body.name).slice(0, 150);
  if (!name) { setNotice(req, 'Member name is required', 'error'); return res.redirect(`/musallas/${req.musallaGuid}/members/${req.params.userId}/profile`); }
  await pool.execute('UPDATE musalla_users SET name=? WHERE id=?', [name,members[0].id]);
  setNotice(req, 'Member name updated');
  res.redirect(`/musallas/${req.musallaGuid}/members/${req.params.userId}/profile`);
});
app.post('/musallas/:guid/members/:userId/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  if (!roles.length) { setNotice(req, 'Select at least one role', 'error'); return res.redirect(`/musallas/${req.params.id}/members/${req.params.userId}/profile`); }
  await updateMemberRoles(req.params.id, req.params.userId, roles);
  setNotice(req, 'Member roles updated'); res.redirect(`/musallas/${req.params.id}/members/${req.params.userId}/profile`);
});
app.post('/musallas/:guid/notifications', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const notificationsEnabled = req.body.notifications_enabled === '1';
  await pool.execute('UPDATE musalla_locations SET notifications_enabled=? WHERE id=?', [notificationsEnabled,req.params.id]);
  setNotice(req, notificationsEnabled?'Musalla notifications enabled':'Musalla notifications disabled');
  res.redirect(`/musallas/${req.params.id}/profile`);
});
app.post('/musallas/:guid/profile', requireAuth, musallaAccess, requireAdmin, logoUpload.single('logo'), async (req, res) => {
  const [rows] = await pool.execute('SELECT logo_url FROM musalla_locations WHERE id=?', [req.params.id]);
  const logoUrl = req.file ? `/uploads/musalla-logos/${req.file.filename}` : rows[0].logo_url;
  const publicProfile = publicProfileFields(req.body);
  const salahEnabled = ['fajr','zuhr','asr','maghrib','isha'].map(prayer => req.body[`${prayer}_enabled`] === '1');
  const jumuahEnabled = [1,2,3].map(number => req.body[`jumuah_${number}_enabled`] === '1');
  await pool.execute('UPDATE musalla_locations SET name=?,address=?,street_address=?,address_locality=?,address_region=?,postal_code=?,address_country=?,about=?,facilities=?,website_url=?,public_email=?,public_phone=?,timetable_url=?,logo_url=?,fajr_enabled=?,zuhr_enabled=?,asr_enabled=?,maghrib_enabled=?,isha_enabled=?,jumuah_1_enabled=?,jumuah_2_enabled=?,jumuah_3_enabled=? WHERE id=?', [cleanText(req.body.name),publicProfile.address,publicProfile.street_address,publicProfile.address_locality,publicProfile.address_region,publicProfile.postal_code,publicProfile.address_country,publicProfile.about||null,publicProfile.facilities||null,publicProfile.website_url||null,publicProfile.public_email,publicProfile.public_phone,publicProfile.timetable_url,logoUrl,...salahEnabled,...jumuahEnabled,req.params.id]);
  await syncPrayerSchedules(req.params.id);
  setNotice(req, 'Musalla profile updated'); res.redirect(`/musallas/${req.params.id}/profile`);
});
app.post('/musallas/:guid/slots/:slotId/manage', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const action = req.body.admin_action;
  if (!['assign','release'].includes(action)) return res.sendStatus(400);
  const changeScope = req.body.change_scope === 'future' ? 'future' : 'occurrence';
  const connection = await pool.getConnection();
  let slot;
  let managedImam;
  let returnDate;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM musalla_prayer_slots WHERE id=? AND musalla_id=? FOR UPDATE', [req.params.slotId,req.params.id]);
    slot = rows[0];
    if (!slot) { await connection.rollback(); return res.sendStatus(404); }
    if (slot.prayer_name === 'Zuhr' && new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay() === 5) {
      const [locations] = await connection.execute('SELECT jumuah_1_enabled,jumuah_2_enabled,jumuah_3_enabled FROM musalla_locations WHERE id=?', [req.params.id]);
      const offersJumuah = locations[0] && [1,2,3].some(number => locations[0][`jumuah_${number}_enabled`]);
      if (!offersJumuah) {
        await connection.rollback();
        setNotice(req, 'This Musalla does not offer a Friday Zuhr or Jumuah slot', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${req.body.return_date || slot.prayer_date}`);
      }
    }
    const earliestReturnDate = new Date(`${slot.prayer_date}T12:00:00Z`);
    earliestReturnDate.setUTCDate(earliestReturnDate.getUTCDate()-6);
    const requestedReturnDate = req.body.return_date;
    returnDate = requestedReturnDate >= earliestReturnDate.toISOString().slice(0,10) && requestedReturnDate <= slot.prayer_date
      ? requestedReturnDate
      : slot.prayer_date;
    const weekday = new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay();
    if (action === 'assign') {
      if (slot.imam_user_id) {
        await connection.rollback();
        setNotice(req, 'This prayer was assigned while you were making your selection', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
      }
      const imamId = Number.parseInt(req.body.imam_user_id, 10);
      const [imams] = await connection.execute("SELECT u.id,u.name FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status='active' AND FIND_IN_SET('imam',ms.role)>0 AND u.is_disabled=FALSE FOR UPDATE", [req.params.id,imamId]);
      managedImam = imams[0];
      if (!managedImam) {
        await connection.rollback();
        setNotice(req, 'Select an active Imam from this Musalla', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
      }
      if (changeScope === 'occurrence') {
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id=?', [managedImam.id,slot.id]);
      } else {
        const [assignmentSlots] = await connection.execute('SELECT id,prayer_date,imam_user_id FROM musalla_prayer_slots WHERE musalla_id=? AND prayer_name=? AND prayer_date>=? AND DAYOFWEEK(prayer_date)=? ORDER BY prayer_date FOR UPDATE', [req.params.id,slot.prayer_name,slot.prayer_date,weekday+1]);
        const conflict = assignmentSlots.find(item => item.imam_user_id && Number(item.imam_user_id)!==Number(managedImam.id));
        if (conflict) {
          await connection.rollback();
          setNotice(req, `Another Imam is already assigned on ${conflict.prayer_date}`, 'error');
          return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
        }
        await connection.execute(`INSERT INTO musalla_prayer_recurrences (musalla_id,weekday,prayer_name,imam_user_id,starts_on) VALUES (?,?,?,?,?)
          ON DUPLICATE KEY UPDATE imam_user_id=VALUES(imam_user_id),starts_on=VALUES(starts_on)`, [req.params.id,weekday,slot.prayer_name,managedImam.id,slot.prayer_date]);
        await connection.query('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id IN (?)', [managedImam.id,assignmentSlots.map(item=>item.id)]);
      }
    } else {
      if (!slot.imam_user_id || Number(req.body.assigned_imam_id)!==Number(slot.imam_user_id)) {
        await connection.rollback();
        setNotice(req, 'The assignment changed. Review the current Imam before opting them out', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
      }
      const [imams] = await connection.execute('SELECT id,name FROM musalla_users WHERE id=?', [slot.imam_user_id]);
      managedImam = imams[0] || { id: slot.imam_user_id, name: 'The assigned Imam' };
      if (changeScope === 'future') {
        await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND weekday=? AND prayer_name=? AND imam_user_id=?', [req.params.id,weekday,slot.prayer_name,managedImam.id]);
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND prayer_name=? AND imam_user_id=? AND prayer_date>=? AND DAYOFWEEK(prayer_date)=?', [req.params.id,slot.prayer_name,managedImam.id,slot.prayer_date,weekday+1]);
      } else {
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE id=?', [slot.id]);
      }
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  const weekStart = slot.prayer_date;
  const weekEnd = new Date(`${weekStart}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
  const weekEndDate = weekEnd.toISOString().slice(0,10);
  const [locations] = await pool.execute('SELECT name,logo_url FROM musalla_locations WHERE id=?', [req.params.id]);
  const scheduleMusalla = locations[0];
  const [weeklySlots] = await pool.execute(`SELECT p.prayer_date,p.prayer_name,u.name imam_name FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date BETWEEN ? AND ? ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [req.params.id,weekStart,weekEndDate]);
  const reason = action === 'release' ? String(req.body.opt_out_reason || '').trim().slice(0, 500) : '';
  const changeMessage = action === 'assign'
    ? `${req.user.name} assigned ${managedImam.name} to lead ${slot.prayer_name} ${changeScope==='future'?`every week beginning ${slot.prayer_date}`:`on ${slot.prayer_date}`}.`
    : `${req.user.name} opted ${managedImam.name} out of ${slot.prayer_name} on ${slot.prayer_date}${changeScope==='future'?' and all future weekly occurrences':''}; the slot is now available.${reason?` Reason: ${reason}`:''}`;
  await notifyMusallaImamsAndAdmins(pool, req.params.id, {
    subject: `${scheduleMusalla.name} prayer schedule updated · ${slot.prayer_name} ${slot.prayer_date}`,
    preheader: changeMessage,
    heading: 'Prayer schedule updated',
    message: `${changeMessage} Here is the updated seven-day schedule.`,
    details: digestDetails(weeklySlots, weekStart),
    contentHtml: weeklyDigestHtml(weeklySlots, weekStart),
    actionLabel: 'View prayer schedule',
    actionUrl: `${baseUrl}/musallas/${req.musallaGuid}?date=${returnDate}`,
    logoUrl: absoluteUrl(scheduleMusalla.logo_url)
  });
  setNotice(req, action === 'assign'
    ? `${managedImam.name} is assigned ${changeScope==='future'?'weekly':'for this week'}`
    : `${managedImam.name} was opted out for ${changeScope==='future'?'this and all future weeks':'this occurrence'}`);
  res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
});
app.post('/musallas/:guid/slots/:slotId/opt-in', requireAuth, musallaAccess, requireImam, async (req, res) => {
  const connection = await pool.getConnection();
  let slot;
  let replacedImam = null;
  let musalla = null;
  const changeScope = req.body.change_scope === 'occurrence' ? 'occurrence' : 'future';
  let returnDate;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM musalla_prayer_slots WHERE id=? AND musalla_id=? FOR UPDATE', [req.params.slotId,req.params.id]);
    slot = rows[0];
    if (!slot) { await connection.rollback(); return res.sendStatus(404); }
    if (slot.prayer_name === 'Zuhr' && new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay() === 5) {
      const [locations] = await connection.execute('SELECT jumuah_1_enabled,jumuah_2_enabled,jumuah_3_enabled FROM musalla_locations WHERE id=?', [req.params.id]);
      const offersJumuah = locations[0] && [1,2,3].some(number => locations[0][`jumuah_${number}_enabled`]);
      if (!offersJumuah) {
        await connection.rollback();
        setNotice(req, 'This Musalla does not offer a Friday Zuhr or Jumuah slot', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${req.body.return_date || slot.prayer_date}`);
      }
    }
    const earliestReturnDate = new Date(`${slot.prayer_date}T12:00:00Z`);
    earliestReturnDate.setUTCDate(earliestReturnDate.getUTCDate()-6);
    const requestedReturnDate = req.body.return_date;
    returnDate = requestedReturnDate >= earliestReturnDate.toISOString().slice(0,10) && requestedReturnDate <= slot.prayer_date
      ? requestedReturnDate
      : slot.prayer_date;
    if (slot.imam_user_id && Number(slot.imam_user_id)!==Number(req.user.id)) {
      if (Number(req.body.replace_imam_id)!==Number(slot.imam_user_id)) {
        await connection.rollback();
        setNotice(req, 'The assignment changed. Review the current imam before replacing them', 'error');
        return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
      }
      const [imams] = await connection.execute('SELECT id,name FROM musalla_users WHERE id=?', [slot.imam_user_id]);
      replacedImam = imams[0] || { id: slot.imam_user_id, name: 'The assigned imam' };
      const [locations] = await connection.execute('SELECT name,logo_url FROM musalla_locations WHERE id=?', [req.params.id]);
      musalla = locations[0];
      if (changeScope === 'future') {
        const weekday = new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay();
        await connection.execute(`INSERT INTO musalla_prayer_recurrences (musalla_id,weekday,prayer_name,imam_user_id,starts_on) VALUES (?,?,?,?,?)
          ON DUPLICATE KEY UPDATE imam_user_id=VALUES(imam_user_id),starts_on=VALUES(starts_on)`, [req.params.id,weekday,slot.prayer_name,req.user.id,slot.prayer_date]);
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE musalla_id=? AND prayer_name=? AND prayer_date>=? AND DAYOFWEEK(prayer_date)=?', [req.user.id,req.params.id,slot.prayer_name,slot.prayer_date,weekday+1]);
      } else {
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id=?', [req.user.id,slot.id]);
      }
    } else if (slot.imam_user_id) {
      if (changeScope === 'future') {
        const weekday = new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay();
        await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND weekday=? AND prayer_name=? AND imam_user_id=?', [req.params.id,weekday,slot.prayer_name,req.user.id]);
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND prayer_name=? AND imam_user_id=? AND prayer_date>=? AND DAYOFWEEK(prayer_date)=?', [req.params.id,slot.prayer_name,req.user.id,slot.prayer_date,weekday+1]);
      } else {
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE id=?', [slot.id]);
      }
    } else {
      if (changeScope === 'occurrence') {
        await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id=?', [req.user.id,slot.id]);
      } else {
        const weekday = new Date(`${slot.prayer_date}T12:00:00Z`).getUTCDay();
        const [assignmentSlots] = await connection.execute('SELECT id,prayer_date,imam_user_id FROM musalla_prayer_slots WHERE musalla_id=? AND prayer_name=? AND prayer_date>=? AND DAYOFWEEK(prayer_date)=? ORDER BY prayer_date FOR UPDATE', [req.params.id,slot.prayer_name,slot.prayer_date,weekday+1]);
        const conflict = assignmentSlots.find(item => item.imam_user_id && Number(item.imam_user_id)!==Number(req.user.id));
        if (conflict) {
          await connection.rollback();
          setNotice(req, `Another imam is already assigned on ${conflict.prayer_date}. Change that occurrence before starting this weekly opt-in`, 'error');
          return res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
        }
        await connection.execute(`INSERT INTO musalla_prayer_recurrences (musalla_id,weekday,prayer_name,imam_user_id,starts_on) VALUES (?,?,?,?,?)
          ON DUPLICATE KEY UPDATE imam_user_id=VALUES(imam_user_id),starts_on=VALUES(starts_on)`, [req.params.id,weekday,slot.prayer_name,req.user.id,slot.prayer_date]);
        await connection.query('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id IN (?)', [req.user.id,assignmentSlots.map(item=>item.id)]);
      }
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (replacedImam) {
    const replacementScope = changeScope === 'future' ? ' and all future weekly occurrences' : '';
    await notifyUser(pool, replacedImam.id, {
      subject: `Prayer assignment changed at ${musalla.name}`,
      preheader: `Your ${slot.prayer_name} assignment on ${slot.prayer_date}${replacementScope} has been replaced.`,
      heading: 'Your prayer assignment was replaced',
      message: `${req.user.name} will now lead this salah${replacementScope}.`,
      details: [
        { label: 'Musalla', value: musalla.name },
        { label: 'Prayer', value: slot.prayer_name },
        { label: 'Date', value: slot.prayer_date },
        { label: 'Replacement imam', value: req.user.name }
      ],
      actionLabel: 'View prayer schedule',
      actionUrl: `${baseUrl}/musallas/${req.musallaGuid}?date=${slot.prayer_date}`,
      logoUrl: absoluteUrl(musalla.logo_url)
    }, req.params.id);
  }
  const weekStart = slot.prayer_date;
  const weekEnd = new Date(`${weekStart}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
  const weekEndDate = weekEnd.toISOString().slice(0,10);
  const [locations] = await pool.execute('SELECT name,logo_url FROM musalla_locations WHERE id=?', [req.params.id]);
  const scheduleMusalla = locations[0];
  const [weeklySlots] = await pool.execute(`SELECT p.prayer_date,p.prayer_name,u.name imam_name FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date BETWEEN ? AND ? ORDER BY p.prayer_date,FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [req.params.id,weekStart,weekEndDate]);
  const optedOut = Boolean(slot.imam_user_id) && !replacedImam;
  const optOutReason = optedOut ? String(req.body.opt_out_reason || '').trim().slice(0, 500) : '';
  const changeMessage = replacedImam
    ? `${req.user.name} replaced ${replacedImam.name} for ${slot.prayer_name} on ${slot.prayer_date}${changeScope==='future'?' and all future weekly occurrences':''}.`
    : optedOut
      ? `${req.user.name} opted out of ${slot.prayer_name} on ${slot.prayer_date}${changeScope==='future'?' and all future weekly occurrences':''}; the slot is now available.${optOutReason?` Reason: ${optOutReason}`:''}`
      : `${req.user.name} opted in to lead ${slot.prayer_name} ${changeScope==='future'?`every week beginning ${slot.prayer_date}`:`on ${slot.prayer_date}`}.`;
  await notifyMusallaImamsAndAdmins(pool, req.params.id, {
    subject: `${scheduleMusalla.name} prayer schedule updated · ${slot.prayer_name} ${slot.prayer_date}`,
    preheader: changeMessage,
    heading: 'Prayer schedule updated',
    message: `${changeMessage} Here is the updated seven-day schedule.`,
    details: digestDetails(weeklySlots, weekStart),
    contentHtml: weeklyDigestHtml(weeklySlots, weekStart),
    actionLabel: 'View prayer schedule',
    actionUrl: `${baseUrl}/musallas/${req.musallaGuid}?date=${returnDate}`,
    logoUrl: absoluteUrl(scheduleMusalla.logo_url)
  });
  setNotice(req, replacedImam
    ? `You replaced ${replacedImam.name} for ${changeScope==='future'?'this and all future weeks':'this occurrence'}`
    : slot.imam_user_id
      ? `You opted out for ${changeScope==='future'?'this and all future weeks':'this occurrence'}`
      : `Jazak Allahu Khayran — you are leading this salah ${changeScope==='future'?'every week':'this week'}`);
  res.redirect(`/musallas/${req.params.id}?date=${returnDate}`);
});
app.post('/musallas/:guid/members/:userId/status', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  if (Number(req.params.userId)===Number(req.user.id)) { setNotice(req, 'You cannot disable your own membership', 'error'); return res.redirect(`/musallas/${req.params.id}/members`); }
  if (!['active','disabled'].includes(req.body.status)) return res.sendStatus(400);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE musalla_memberships SET status=? WHERE musalla_id=? AND user_id=? AND status IN ('active','disabled')", [req.body.status,req.params.id,req.params.userId]);
    if (req.body.status === 'disabled') {
      const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=?', [req.params.id]);
      const { today } = scheduleBounds(new Date(), locations[0].timezone);
      await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [req.params.id,req.params.userId,today]);
      await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND imam_user_id=?', [req.params.id,req.params.userId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  setNotice(req, 'Member access updated'); res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:guid/membership-requests/:userId/approve', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [admins] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  if (Number(admins[0].count)===0) { setNotice(req, 'A super admin must approve the initial membership', 'error'); return res.redirect(`/musallas/${req.params.id}/members`); }
  const roles = selectedRoles(req.body);
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='active',role=?,requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [roles.join(','),req.params.id,req.params.userId]);
  if (result.affectedRows) await notifyMembershipApproved(req.params.id, req.params.userId, roles);
  setNotice(req, result.affectedRows?'Membership request approved':'Membership request is no longer pending', result.affectedRows?'success':'error');
  res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:guid/membership-requests/:userId/deny', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='denied',role='',requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [req.params.id,req.params.userId]);
  setNotice(req, result.affectedRows?'Membership request denied':'Membership request is no longer pending', result.affectedRows?'success':'error');
  res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:guid/members/:userId/remove', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  if (Number(req.params.userId)===Number(req.user.id)) { setNotice(req, 'You cannot remove yourself', 'error'); return res.redirect(`/musallas/${req.params.id}/members`); }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [memberships] = await connection.execute('SELECT role FROM musalla_memberships WHERE musalla_id=? AND user_id=? FOR UPDATE', [req.params.id,req.params.userId]);
    const target = memberships[0];
    if (!target) { await connection.rollback(); return res.sendStatus(404); }
    if (!hasRole(target,'imam') || hasRole(target,'admin')) {
      await connection.rollback();
      setNotice(req, 'Administrators cannot be removed with the imam removal action', 'error');
      return res.redirect(`/musallas/${req.params.id}/members`);
    }
    const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=?', [req.params.id]);
    const { today } = scheduleBounds(new Date(), locations[0].timezone);
    await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [req.params.id,req.params.userId,today]);
    await connection.execute('DELETE FROM musalla_prayer_recurrences WHERE musalla_id=? AND imam_user_id=?', [req.params.id,req.params.userId]);
    await connection.execute('DELETE FROM musalla_memberships WHERE musalla_id=? AND user_id=?', [req.params.id,req.params.userId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  setNotice(req, 'Imam removed from the Musalla and future prayers unslotted');
  res.redirect(`/musallas/${req.params.id}/members`);
});

app.use((req,res)=>res.status(404).render('message',{title:'Page not found',message:'The page you requested does not exist.'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).render('message',{title:'Something went wrong',message:'Please try again.'});});

async function start() {
  await initializeDatabase();
  await syncPrayerSchedules();
  startDailyAdminPrayerDigest(pool, { baseUrl });
  app.listen(port,()=>console.log(`Musalla app running at ${baseUrl}`));
}

start().catch(error => { console.error('Unable to start Musalla app:', error.message); process.exit(1); });
