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
const { notifySuperAdmins, notifyMusallaAdminsAndSuperAdmins } = require('./email');

const app = express();
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const absoluteUrl = value => new URL(value || '/icon-192.png', `${baseUrl}/`).href;
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
        await pool.execute("UPDATE musalla_users SET google_id=?,avatar_url=COALESCE(NULLIF(?,''),avatar_url) WHERE id=?", [profile.id, profile.photos?.[0]?.value || '', user.id]);
        [rows] = await pool.execute('SELECT * FROM musalla_users WHERE id=?', [user.id]);
        user = rows[0];
      } else {
        const [result] = await pool.execute('INSERT INTO musalla_users (google_id,email,name,avatar_url) VALUES (?,?,?,?)', [profile.id, email, profile.displayName || email, profile.photos?.[0]?.value || '']);
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
    }
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function musallaAccess(req, res, next) {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [locations] = await pool.execute(`SELECT is_disabled FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  if (!locations[0]) return res.sendStatus(404);
  if (locations[0].is_disabled) return res.status(403).render('message', { title: 'Musalla unavailable', message: 'This Musalla has been disabled.' });
  const [memberships] = await pool.execute("SELECT * FROM musalla_memberships WHERE user_id=? AND musalla_id=? AND status='active'", [req.user.id, req.params.id]);
  if (!memberships[0]) return res.status(403).render('message', { title: 'No access', message: 'You are not a member of this Musalla.' });
  req.membership = memberships[0];
  next();
}

function requireAdmin(req, res, next) {
  if (hasRole(req.membership, 'admin')) return next();
  return res.status(403).render('message', { title: 'Admin only', message: 'You need Musalla administrator access.' });
}

function requireImam(req, res, next) {
  if (hasRole(req.membership, 'imam')) return next();
  req.session.notice='Only imams can opt in to lead salah';
  return res.redirect(`/musallas/${req.params.id}`);
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
    res.locals.path = req.path;
    res.locals.musallaNav = null;
    res.locals.canManageMembers = false;
    res.locals.pendingApprovalCount = 0;
    res.locals.hideNavigation = false;
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
app.get('/login', (req, res) => res.render('login', { googleReady: Boolean(process.env.GOOGLE_CLIENT_ID), testMode: TEST_MODE }));
app.get('/invite/musallas/:id', async (req, res, next) => {
  try {
    const [musallas] = await pool.execute(`SELECT id FROM musalla_locations m WHERE id=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.id]);
    if (!musallas[0]) return res.status(404).render('message', { title: 'Invitation unavailable', message: 'This Musalla invitation is no longer available.' });
    const destination = `/membership-requests?musalla=${musallas[0].id}`;
    if (req.user) return res.redirect(destination);
    req.session.authRedirect = destination;
    res.redirect('/login');
  } catch (error) { next(error); }
});
app.post('/auth/test/:role', async (req, res, next) => {
  if (!TEST_MODE || !['imam','admin'].includes(req.params.role)) return res.sendStatus(404);
  try {
    const email = `test-${req.params.role}@musalla.local`;
    const [rows] = await pool.execute('SELECT * FROM musalla_users WHERE email=? AND is_test=TRUE AND is_disabled=FALSE', [email]);
    if (!rows[0]) return res.status(503).render('message', { title: 'Test account unavailable', message: 'Restart the app to seed test accounts.' });
    const destination = req.session.authRedirect || '/';
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
    req.session.notice='You need an active Imam or Musalla Administrator role to switch views';
    return res.redirect('/super-admin');
  }
  req.session.viewMode='member';
  res.redirect('/');
});

app.get('/super-admin', requireAuth, requireSuperAdmin, async (req, res) => {
  const [musallas] = await pool.query(`SELECT m.*,COUNT(DISTINCT CASE WHEN ms.status IN ('active','disabled') THEN ms.user_id END) member_count,COUNT(DISTINCT CASE WHEN p.imam_user_id IS NOT NULL THEN p.id END) assignment_count FROM musalla_locations m LEFT JOIN musalla_memberships ms ON ms.musalla_id=m.id LEFT JOIN musalla_prayer_slots p ON p.musalla_id=m.id WHERE ${visibleMusalla('m')} GROUP BY m.id ORDER BY m.is_disabled,m.name`);
  res.render('super-admin', { musallas });
});
app.get('/super-admin/musallas/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  const [members] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url,IF(ms.role='','Member',ms.role) role,ms.status FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status IN ('active','disabled') ORDER BY ms.status,ms.role,u.name", [req.params.id]);
  const [requests] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='pending' ORDER BY u.name", [req.params.id]);
  const [adminRows] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  res.render('super-admin-musalla', { musalla: rows[0], members, requests, needsInitialAdmin: Number(adminRows[0].count)===0 });
});
app.post('/super-admin/musallas/:id/membership-requests/:userId/approve', requireAuth, requireSuperAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  if (!roles.length) { req.session.notice='Select at least one role'; return res.redirect(`/super-admin/musallas/${req.params.id}`); }
  const [admins] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  if (Number(admins[0].count)>0) { req.session.notice='This Musalla already has an administrator; its admins must approve new requests'; return res.redirect(`/super-admin/musallas/${req.params.id}`); }
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='active',role=? WHERE musalla_id=? AND user_id=? AND status='pending'", [roles.join(','),req.params.id,req.params.userId]);
  req.session.notice=result.affectedRows?'Initial membership approved':'Membership request is no longer pending';
  res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.post('/super-admin/musallas/:id/membership-requests/:userId/deny', requireAuth, requireSuperAdmin, async (req, res) => {
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='denied',role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [req.params.id,req.params.userId]);
  req.session.notice=result.affectedRows?'Membership request denied':'Membership request is no longer pending';
  res.redirect(`/super-admin/musallas/${req.params.id}`);
});
app.get('/super-admin/musallas/:id/members/:userId/profile', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT u.id,u.name,u.email,u.phone,u.bio,u.avatar_url,ms.role,ms.status,m.name musalla_name,m.id musalla_id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('active','disabled') AND ${visibleMusalla('m')}`, [req.params.id,req.params.userId]);
  if (!rows[0]) return res.sendStatus(404);
  res.type('html').set('Content-Disposition','inline').render('member-profile', { member: rows[0], isSuperAdmin: true, formAction: `/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`, backUrl: `/super-admin/musallas/${req.params.id}` });
});
app.post('/super-admin/musallas/:id/members/:userId/profile', requireAuth, requireSuperAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  if (!roles.length) { req.session.notice='Select at least one role'; return res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`); }
  await updateMemberRoles(req.params.id, req.params.userId, roles);
  req.session.notice='Member roles updated'; res.redirect(`/super-admin/musallas/${req.params.id}/members/${req.params.userId}/profile`);
});
app.post('/super-admin/musallas/:id', requireAuth, requireSuperAdmin, logoUpload.single('logo'), async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  const musalla = rows[0];
  if (!musalla) return res.sendStatus(404);
  const logoUrl = req.file ? `/uploads/musalla-logos/${req.file.filename}` : musalla.logo_url;
  const jumuahEnabled = [1,2,3].map(number => req.body[`jumuah_${number}_enabled`] === '1');
  await pool.execute('UPDATE musalla_locations SET name=?,address=?,timetable_url=?,timezone=?,logo_url=?,jumuah_1_enabled=?,jumuah_2_enabled=?,jumuah_3_enabled=? WHERE id=?', [req.body.name.trim(),req.body.address.trim(),req.body.timetable_url?.trim()||'',req.body.timezone.trim()||'America/Chicago',logoUrl,...jumuahEnabled,req.params.id]);
  await syncPrayerSchedules(req.params.id);
  req.session.notice='Musalla updated'; res.redirect(`/super-admin/musallas/${req.params.id}`);
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
    if (disabling) await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=?', [req.params.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  if (!disabling) await syncPrayerSchedules(req.params.id);
  req.session.notice=disabling?'Musalla disabled and imams unslotted':'Musalla enabled'; res.redirect('/super-admin');
});
app.post('/super-admin/musallas/:id/delete', requireAuth, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM musalla_locations m WHERE id=? AND ${visibleMusalla('m')}`, [req.params.id]);
  const musalla = rows[0];
  if (!musalla) return res.sendStatus(404);
  await pool.execute('DELETE FROM musalla_locations WHERE id=?', [req.params.id]);
  if (musalla.logo_url?.startsWith('/uploads/musalla-logos/')) fs.unlink(path.join(__dirname, '..', 'public', musalla.logo_url), () => {});
  req.session.notice='Musalla deleted'; res.redirect('/super-admin');
});

app.get('/', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  if (!req.user.registration_completed) return res.redirect('/register/musallas');
  const [musallas] = await pool.execute(`SELECT m.*,IF(ms.role='','Member',ms.role) role FROM musalla_locations m JOIN musalla_memberships ms ON ms.musalla_id=m.id AND ms.user_id=? WHERE ms.status='active' AND m.is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY CASE WHEN FIND_IN_SET('imam',ms.role)>0 OR FIND_IN_SET('admin',ms.role)>0 THEN 0 ELSE 1 END,m.name`, [req.user.id]);
  const [requests] = await pool.execute(`SELECT m.id,m.name,ms.status FROM musalla_memberships ms JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.user_id=? AND ms.status IN ('pending','denied') AND m.is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY m.name`, [req.user.id]);
  res.render('dashboard', { musallas, requests });
});
app.get('/membership-requests', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const selectedMusallaId = Number.parseInt(req.query.musalla, 10) || 0;
  const [musallas] = await pool.execute(`SELECT m.id,m.name,m.address,m.logo_url,ms.status FROM musalla_locations m LEFT JOIN musalla_memberships ms ON ms.musalla_id=m.id AND ms.user_id=? WHERE m.is_disabled=FALSE AND (ms.status IS NULL OR ms.status IN ('pending','denied')) AND ${visibleMusalla('m')} ORDER BY (m.id=?) DESC,CASE ms.status WHEN 'pending' THEN 0 WHEN 'denied' THEN 1 ELSE 2 END,m.name`, [req.user.id,selectedMusallaId]);
  res.render('membership-requests', { musallas, selectedMusallaId });
});
app.post('/membership-requests/:id', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [locations] = await pool.execute(`SELECT id,name,is_test,logo_url FROM musalla_locations m WHERE id=? AND is_disabled=FALSE AND ${visibleMusalla('m')}`, [req.params.id]);
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
    actionUrl: `${baseUrl}/musallas/${locations[0].id}/members`,
    logoUrl: absoluteUrl(locations[0].logo_url)
  });
  req.session.notice='Membership request sent'; res.redirect('/membership-requests');
});
app.post('/membership-requests/:id/cancel', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  const [result] = await pool.execute("DELETE FROM musalla_memberships WHERE user_id=? AND musalla_id=? AND status='pending'", [req.user.id,req.params.id]);
  req.session.notice=result.affectedRows?'Membership request cancelled':'Membership request is no longer pending';
  res.redirect(req.body.return_to==='/'?'/':'/membership-requests');
});
app.get('/register/musallas', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  if (req.user.registration_completed) return res.redirect('/');
  const [musallas] = await pool.query(`SELECT id,name,address,logo_url FROM musalla_locations m WHERE is_disabled=FALSE AND ${visibleMusalla('m')} ORDER BY name`);
  res.render('register-musallas', { musallas });
});
app.post('/register/musallas', requireAuth, async (req, res) => {
  if (isSuperAdminMode(req)) return res.redirect('/super-admin');
  if (req.user.registration_completed) return res.redirect('/');
  const submittedIds = req.body?.musalla_ids;
  const requested = (Array.isArray(submittedIds)?submittedIds:[submittedIds]).filter(Boolean).map(Number).filter(Number.isInteger);
  const ids = [...new Set(requested)];
  if (!ids.length) { req.session.notice='Select at least one Musalla'; return res.redirect('/register/musallas'); }
  const [available] = await pool.query(`SELECT id,name,is_test,logo_url FROM musalla_locations m WHERE is_disabled=FALSE AND id IN (?) AND ${visibleMusalla('m')}`, [ids]);
  if (req.user.is_test && available.some(musalla => !musalla.is_test)) { req.session.notice='Test users can only join test Musallas'; return res.redirect('/register/musallas'); }
  if (!available.length) { req.session.notice='Select at least one available Musalla'; return res.redirect('/register/musallas'); }
  const connection = await pool.getConnection();
  const newRequests = [];
  try {
    await connection.beginTransaction();
    for (const musalla of available) {
      const [result] = await connection.execute("INSERT IGNORE INTO musalla_memberships (user_id,musalla_id,role,status) VALUES (?,?,'','pending')", [req.user.id,musalla.id]);
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
    actionUrl: `${baseUrl}/musallas/${musalla.id}/members`,
    logoUrl: absoluteUrl(musalla.logo_url)
  });
  req.session.notice='Musalla membership requested. An administrator can now assign your role.';
  res.redirect('/');
});
app.get('/profile', requireAuth, (req, res) => res.render('profile'));
app.post('/profile', requireAuth, profilePhotoUpload.single('profile_photo'), async (req, res) => {
  const avatarUrl = req.file ? `/uploads/profile-photos/${req.file.filename}` : req.user.avatar_url;
  await pool.execute('UPDATE musalla_users SET name=?,phone=?,bio=?,avatar_url=? WHERE id=?', [req.body.name.trim(),req.body.phone.trim(),req.body.bio.trim(),avatarUrl,req.user.id]);
  req.session.notice='Profile updated'; res.redirect('/profile');
});
app.get('/register-musalla', requireAuth, (req, res) => {
  const canCancel = Boolean(req.user.registration_completed);
  res.locals.hideNavigation = !canCancel;
  res.render('register-musalla', { canCancel, isSuperAdminRegistration: Boolean(req.user.is_superuser) });
});
app.post('/musallas', requireAuth, async (req, res) => {
  const isSuperAdminRegistration = Boolean(req.user.is_superuser);
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO musalla_locations (name,address,timetable_url,timezone,created_by,is_test) VALUES (?,?,?,?,?,?)', [req.body.name.trim(),req.body.address.trim(),req.body.timetable_url?.trim()||'',req.body.timezone||'America/Chicago',req.user.id,Boolean(req.user.is_test)]);
    id = result.insertId;
    if (!isSuperAdminRegistration) await connection.execute("INSERT INTO musalla_memberships (user_id,musalla_id,role,status) VALUES (?,?,'','pending')", [req.user.id,id]);
    await connection.execute('UPDATE musalla_users SET registration_completed=TRUE WHERE id=?', [req.user.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  await syncPrayerSchedules(id);
  if (!isSuperAdminRegistration) await notifySuperAdmins(pool, {
    subject: `New Musalla registered: ${req.body.name.trim()}`,
    preheader: `${req.body.name.trim()} was submitted for review.`,
    heading: 'New Musalla registration',
    message: 'A new Musalla has been submitted. Review its information and initial membership request before activation.',
    details: [
      { label: 'Musalla', value: req.body.name.trim() },
      { label: 'Address', value: req.body.address.trim() || 'Not provided' },
      { label: 'Submitted by', value: req.user.name },
      { label: 'Email', value: req.user.email }
    ],
    actionLabel: 'Review Musalla',
    actionUrl: `${baseUrl}/super-admin/musallas/${id}`,
    logoUrl: absoluteUrl('/icon-192.png')
  });
  if (isSuperAdminRegistration) {
    req.session.viewMode='super';
    req.session.notice='Musalla created';
    return res.redirect(`/super-admin/musallas/${id}`);
  }
  req.session.notice='Musalla created. A super admin must approve its initial membership.'; res.redirect('/');
});
app.get('/musallas/:id', requireAuth, musallaAccess, async (req, res) => {
  const [locations] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  const musalla = locations[0];
  const { firstDate,lastDate,today } = scheduleBounds(new Date(),musalla.timezone);
  const requestedDate = req.query.navigate || req.query.date || today;
  const date = requestedDate >= firstDate && requestedDate <= lastDate ? requestedDate : today;
  const [slots] = await pool.execute(`SELECT p.*,u.name imam_name,u.avatar_url FROM musalla_prayer_slots p LEFT JOIN musalla_users u ON u.id=p.imam_user_id WHERE p.musalla_id=? AND p.prayer_date=? ORDER BY FIELD(p.prayer_name,'Fajr','Zuhr','Jumuah 1','Jumuah 2','Jumuah 3','Asr','Maghrib','Isha')`, [req.params.id,date]);
  const isAdmin = hasRole(req.membership, 'admin');
  const canLead = hasRole(req.membership, 'imam');
  res.locals.musallaNav=musalla;
  res.locals.canManageMembers=isAdmin;
  if (isAdmin) {
    const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
    res.locals.pendingApprovalCount=Number(pending[0].count);
  }
  res.render('musalla', { musalla,slots,date,today,firstDate,lastDate,isAdmin,canLead });
});
app.post('/musallas/:id/leave', requireAuth, musallaAccess, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=? FOR UPDATE', [req.params.id]);
    if (!locations[0]) { await connection.rollback(); return res.sendStatus(404); }
    const { today } = scheduleBounds(new Date(), locations[0].timezone);
    await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [req.params.id,req.user.id,today]);
    await connection.execute('DELETE FROM musalla_memberships WHERE musalla_id=? AND user_id=?', [req.params.id,req.user.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  req.session.notice='You have left the Musalla and your future prayer assignments were cleared';
  res.redirect('/');
});
app.get('/musallas/:id/members', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [locations] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  const musalla = locations[0];
  if (!musalla) return res.sendStatus(404);
  const isAdmin = true;
  const sql = `SELECT u.id,u.name,u.email,u.avatar_url,IF(ms.role='','Member',ms.role) role,ms.status FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status IN ('active','disabled') ORDER BY ms.status,ms.role,u.name`;
  const [members] = await pool.execute(sql, [req.params.id]);
  const [requests] = await pool.execute("SELECT u.id,u.name,u.email,u.avatar_url,ms.status,ms.requested_role FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id WHERE ms.musalla_id=? AND ms.status='pending' ORDER BY u.name", [req.params.id]);
  res.locals.musallaNav=musalla;
  res.locals.canManageMembers=true;
  res.locals.pendingApprovalCount=requests.length;
  const inviteUrl = `${baseUrl}/invite/musallas/${musalla.id}`;
  res.render('members', { musalla,members,requests,isAdmin,inviteUrl });
});
app.get('/musallas/:id/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM musalla_locations WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.sendStatus(404);
  res.locals.musallaNav=rows[0];
  res.locals.canManageMembers=true;
  const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
  res.locals.pendingApprovalCount=Number(pending[0].count);
  res.render('musalla-profile', { musalla: rows[0] });
});
app.get('/musallas/:id/members/:userId/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [rows] = await pool.execute("SELECT u.id,u.name,u.email,u.phone,u.bio,u.avatar_url,ms.role,ms.status,m.name musalla_name,m.id musalla_id FROM musalla_memberships ms JOIN musalla_users u ON u.id=ms.user_id JOIN musalla_locations m ON m.id=ms.musalla_id WHERE ms.musalla_id=? AND ms.user_id=? AND ms.status IN ('pending','active','disabled')", [req.params.id,req.params.userId]);
  if (!rows[0]) return res.sendStatus(404);
  res.locals.musallaNav={ id: req.params.id };
  res.locals.canManageMembers=true;
  const [pending] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='pending'", [req.params.id]);
  res.locals.pendingApprovalCount=Number(pending[0].count);
  res.type('html').set('Content-Disposition','inline').render('member-profile', { member: rows[0], isSuperAdmin: false, formAction: `/musallas/${req.params.id}/members/${req.params.userId}/profile`, backUrl: `/musallas/${req.params.id}/members` });
});
app.post('/musallas/:id/members/:userId/profile', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const roles = selectedRoles(req.body);
  if (!roles.length) { req.session.notice='Select at least one role'; return res.redirect(`/musallas/${req.params.id}/members/${req.params.userId}/profile`); }
  await updateMemberRoles(req.params.id, req.params.userId, roles);
  req.session.notice='Member roles updated'; res.redirect(`/musallas/${req.params.id}/members/${req.params.userId}/profile`);
});
app.post('/musallas/:id/profile', requireAuth, musallaAccess, requireAdmin, logoUpload.single('logo'), async (req, res) => {
  const [rows] = await pool.execute('SELECT logo_url FROM musalla_locations WHERE id=?', [req.params.id]);
  const logoUrl = req.file ? `/uploads/musalla-logos/${req.file.filename}` : rows[0].logo_url;
  const jumuahEnabled = [1,2,3].map(number => req.body[`jumuah_${number}_enabled`] === '1');
  await pool.execute('UPDATE musalla_locations SET name=?,address=?,timetable_url=?,logo_url=?,jumuah_1_enabled=?,jumuah_2_enabled=?,jumuah_3_enabled=? WHERE id=?', [req.body.name.trim(),req.body.address.trim(),req.body.timetable_url?.trim()||'',logoUrl,...jumuahEnabled,req.params.id]);
  await syncPrayerSchedules(req.params.id);
  req.session.notice='Musalla profile updated'; res.redirect(`/musallas/${req.params.id}/profile`);
});
app.post('/musallas/:id/slots/:slotId/opt-in', requireAuth, musallaAccess, requireImam, async (req, res) => {
  const connection = await pool.getConnection();
  let slot;
  let assignedDays = 1;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM musalla_prayer_slots WHERE id=? AND musalla_id=? FOR UPDATE', [req.params.slotId,req.params.id]);
    slot = rows[0];
    if (!slot) { await connection.rollback(); return res.sendStatus(404); }
    if (slot.imam_user_id && Number(slot.imam_user_id)!==Number(req.user.id)) {
      await connection.rollback();
      req.session.notice='Another imam has already volunteered';
      return res.redirect(`/musallas/${req.params.id}?date=${slot.prayer_date}`);
    }
    if (slot.imam_user_id) {
      await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE id=?', [slot.id]);
    } else {
      const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=?', [req.params.id]);
      const { lastDate } = scheduleBounds(new Date(), locations[0].timezone);
      const requestedDays = Number.parseInt(req.body.days, 10);
      const lastAvailable = new Date(`${lastDate}T12:00:00Z`);
      const start = new Date(`${slot.prayer_date}T12:00:00Z`);
      const maxDays = Math.floor((lastAvailable-start)/86400000)+1;
      assignedDays = Math.max(1, Math.min(Number.isFinite(requestedDays)?requestedDays:1, maxDays, 93));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate()+assignedDays-1);
      const endDate = end.toISOString().slice(0,10);
      const [assignmentSlots] = await connection.execute(`SELECT id,prayer_date,imam_user_id FROM musalla_prayer_slots WHERE musalla_id=? AND prayer_name=? AND prayer_date BETWEEN ? AND ? ORDER BY prayer_date FOR UPDATE`, [req.params.id,slot.prayer_name,slot.prayer_date,endDate]);
      if (assignmentSlots.length!==assignedDays) {
        await connection.rollback();
        req.session.notice='The complete date range is not available';
        return res.redirect(`/musallas/${req.params.id}?date=${slot.prayer_date}`);
      }
      const conflict = assignmentSlots.find(item => item.imam_user_id && Number(item.imam_user_id)!==Number(req.user.id));
      if (conflict) {
        await connection.rollback();
        req.session.notice=`Another imam is already assigned on ${conflict.prayer_date}`;
        return res.redirect(`/musallas/${req.params.id}?date=${slot.prayer_date}`);
      }
      await connection.query('UPDATE musalla_prayer_slots SET imam_user_id=? WHERE id IN (?)', [req.user.id,assignmentSlots.map(item=>item.id)]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  req.session.notice=slot.imam_user_id?'You are no longer assigned for this date':`Jazak Allahu Khayran — you are leading this salah for ${assignedDays} ${assignedDays===1?'day':'days'}`;
  res.redirect(`/musallas/${req.params.id}?date=${slot.prayer_date}`);
});
app.post('/musallas/:id/members/:userId/status', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  if (Number(req.params.userId)===Number(req.user.id)) { req.session.notice='You cannot disable your own membership'; return res.redirect(`/musallas/${req.params.id}/members`); }
  if (!['active','disabled'].includes(req.body.status)) return res.sendStatus(400);
  await pool.execute("UPDATE musalla_memberships SET status=? WHERE musalla_id=? AND user_id=? AND status IN ('active','disabled')", [req.body.status,req.params.id,req.params.userId]);
  req.session.notice='Member access updated'; res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:id/membership-requests/:userId/approve', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [admins] = await pool.execute("SELECT COUNT(*) count FROM musalla_memberships WHERE musalla_id=? AND status='active' AND FIND_IN_SET('admin',role)>0", [req.params.id]);
  if (Number(admins[0].count)===0) { req.session.notice='A super admin must approve the initial membership'; return res.redirect(`/musallas/${req.params.id}/members`); }
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='active',role=IF(requested_role='imam','imam',''),requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [req.params.id,req.params.userId]);
  req.session.notice=result.affectedRows?'Membership request approved':'Membership request is no longer pending';
  res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:id/membership-requests/:userId/deny', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  const [result] = await pool.execute("UPDATE musalla_memberships SET status='denied',role='',requested_role='' WHERE musalla_id=? AND user_id=? AND status='pending'", [req.params.id,req.params.userId]);
  req.session.notice=result.affectedRows?'Membership request denied':'Membership request is no longer pending';
  res.redirect(`/musallas/${req.params.id}/members`);
});
app.post('/musallas/:id/members/:userId/remove', requireAuth, musallaAccess, requireAdmin, async (req, res) => {
  if (Number(req.params.userId)===Number(req.user.id)) { req.session.notice='You cannot remove yourself'; return res.redirect(`/musallas/${req.params.id}/members`); }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [memberships] = await connection.execute('SELECT role FROM musalla_memberships WHERE musalla_id=? AND user_id=? FOR UPDATE', [req.params.id,req.params.userId]);
    const target = memberships[0];
    if (!target) { await connection.rollback(); return res.sendStatus(404); }
    if (!hasRole(target,'imam') || hasRole(target,'admin')) {
      await connection.rollback();
      req.session.notice='Administrators cannot be removed with the imam removal action';
      return res.redirect(`/musallas/${req.params.id}/members`);
    }
    const [locations] = await connection.execute('SELECT timezone FROM musalla_locations WHERE id=?', [req.params.id]);
    const { today } = scheduleBounds(new Date(), locations[0].timezone);
    await connection.execute('UPDATE musalla_prayer_slots SET imam_user_id=NULL WHERE musalla_id=? AND imam_user_id=? AND prayer_date>=?', [req.params.id,req.params.userId,today]);
    await connection.execute('DELETE FROM musalla_memberships WHERE musalla_id=? AND user_id=?', [req.params.id,req.params.userId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  req.session.notice='Imam removed from the Musalla and future prayers unslotted';
  res.redirect(`/musallas/${req.params.id}/members`);
});

app.use((req,res)=>res.status(404).render('message',{title:'Page not found',message:'The page you requested does not exist.'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).render('message',{title:'Something went wrong',message:'Please try again.'});});

async function start() {
  await initializeDatabase();
  await syncPrayerSchedules();
  app.listen(port,()=>console.log(`Musalla app running at ${baseUrl}`));
}

start().catch(error => { console.error('Unable to start Musalla app:', error.message); process.exit(1); });
