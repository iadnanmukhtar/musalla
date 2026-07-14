# Musalla

A mobile-first Node.js web app for managing imam volunteers across multiple musallas.

## Features

- Google account registration and sign-in
- Installable PWA interface for iOS and Android
- Multiple musallas with musalla-specific administrators
- Dedicated member roster for each Musalla
- Separate super-admin Musalla management
- Automatically available five-prayer roster with one-tap imam opt-in
- Four weeks of roster history and three months of advance scheduling
- Member access enable/disable controls
- Imam profiles with name, phone, and bio
- Superuser access for managing every musalla

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000 and sign in with Google.

## Test mode

Set `TEST_MODE=true` in `.env` and restart the app. The login page will offer test Imam and test Administrator accounts. Startup seeds two Musallas flagged with `is_test=TRUE`; both test users are active members of both Musallas. Existing production data remains visible in test mode.

With `TEST_MODE=false`, test login is disabled, test users cannot authenticate, and Musallas flagged as test data are excluded from application queries. The `musalla_users` and `musalla_locations` tables store this boundary in their `is_test` columns.

## Configure MySQL

Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` in `.env`. The app creates isolated `musalla_*` tables automatically at startup.

To migrate an existing local SQLite database once:

```bash
npm run migrate:mysql
```

## Configure Google sign-in

Create an OAuth 2.0 Web application in Google Cloud, add this redirect URI:

```
http://localhost:3000/auth/google/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`, and a strong `SESSION_SECRET` in `.env`. In production, use HTTPS, set `NODE_ENV=production`, and use a persistent session store rather than the default in-memory store.

## Super-admin access

Superusers are redirected to `/super-admin` after signing in. The account must have `is_superuser=TRUE` in `musalla_users`; normal imams and Musalla administrators cannot open this route.

## Configure email notifications

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` in `.env`. Notifications go to every active user with `is_superuser=TRUE`. You can add comma-separated fallback recipients with `SUPER_ADMIN_EMAIL`.

Super admins are notified when a new Musalla is registered. Every new or renewed membership request is emailed to the Musalla's active administrators and the super admins.
