# Musalla

Musalla is a mobile-first web application for coordinating Imams across multiple prayer spaces. Imams can volunteer for salah, Musalla administrators can manage their local community, and super admins can manage the platform as a whole.

The application is built with Node.js, Express, EJS, MySQL, Passport, and Nodemailer. It is server-rendered, installable as a Progressive Web App, and designed to work comfortably on iOS and Android.

## How it works

Users sign in with Google and join one or more Musallas. Membership requests are reviewed by the appropriate Musalla administrators or a super admin, who can grant Imam or administrator access and manage existing members.

Each Musalla has a weekly roster for Fajr, Zuhr, Asr, Maghrib, and Isha. When an Imam opts in to an available prayer, they can lead it just for the selected week or recur weekly on the same weekday. Musalla administrators can assign active Imams to open prayers or opt assigned Imams out, for either one occurrence or the weekly series. Replacements and opt-outs can apply to one occurrence or all future weekly occurrences. The schedule retains four weeks of history and provides three months of future availability while recurring assignments persist as new weeks are generated.

Friday schedules can be configured with up to three Jumuah slots. When at least one Jumuah slot is enabled, the enabled slots replace Zuhr on Fridays. If none are enabled, the regular Zuhr slot remains.

Musalla administrators and super admins can add an Imam, another administrator, or both by email. The selected roles are active immediately. The recipient is emailed a link to sign in with that address and reject the membership if they do not want it.

## Roles

### Members

Members can search for Musallas, submit membership requests, monitor or cancel pending requests, maintain their profile, and leave a Musalla. Leaving automatically clears their future prayer assignments.

### Imams

Imams have all regular member capabilities and can opt in to available prayer slots, withdraw from their own assignments, and volunteer across a consecutive date range.

### Musalla administrators

Musalla administrators manage membership requests, roles, member access, and Imam removal. They can add Imams and other administrators directly by email; the membership is active immediately, and the recipient receives an email allowing them to reject it. Within their own Musalla, administrators can update the name of active Imams and other administrators. They can also edit the Musalla name, address, logo, timetable link, and Jumuah configuration.

### Super admins

Super admins manage all Musallas without becoming local members. They can register, edit, enable, disable, or delete a Musalla; approve or deny any pending membership request; add Imams or administrators directly by email; edit every pending, active, or disabled member profile; manage member roles; and edit the same Musalla settings available to local administrators.

Super-admin access is controlled exclusively by `musalla_users.is_superuser=TRUE` in MySQL. It is not granted through an environment variable.

## Local setup

Copy the environment template, install dependencies, and start the development server:

```bash
cp .env.example .env
npm install
npm run dev
```

Open the URL configured in `BASE_URL`. The example configuration uses `http://localhost:3000`.

Other commands:

```bash
npm start                 # Start without watch mode
npm test                  # Run the Node test suite
npm run migrate:mysql     # Import the former SQLite database
```

## Database

Configure MySQL with the `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` values in `.env`. On startup, the application creates and incrementally updates its tables:

- `musalla_users`
- `musalla_locations`
- `musalla_memberships`
- `musalla_prayer_slots`
- `musalla_daily_digest_deliveries`

Users and Musallas include an `is_test` flag to isolate test records. Memberships store the active role and, when applicable, an invited Imam role awaiting approval.

## Google sign-in

Create an OAuth 2.0 Web application in Google Cloud and register a callback URL matching `BASE_URL`:

```text
http://localhost:3000/auth/google/callback
```

Then configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`, and `SESSION_SECRET` in `.env`.

If a user selects Register a Musalla before authentication, the application returns them to that flow after Google sign-in. A new user must complete the Musalla details form. An existing user can cancel and return to the application.

When an administrator adds an email address that has not signed in before, the application creates a placeholder account. The first Google sign-in with that email claims the account without duplicating the membership.

## Test mode

Test mode makes it possible to exercise Imam and administrator workflows without changing the visibility of production data:

```env
TEST_MODE=true
```

After restarting, the login page provides buttons for a clean Test New User, a seeded Test Imam, and a Test Administrator. The new-user login resets that account's memberships and test Musallas every time, allowing the complete first-time join-or-register flow to be repeated. The Imam and Administrator accounts belong to Test Musalla North and Test Musalla South with the appropriate roles. Existing production data remains available for comparison.

Test users and Musallas are stored with `is_test=TRUE`. Any new user or Musalla created while `TEST_MODE=true` is automatically marked as test data, regardless of which account creates it. When `TEST_MODE=false`, test logins are unavailable, test users cannot authenticate, and test Musallas are excluded from application queries and schedule generation. Test users are also prevented from joining production Musallas.

## Email notifications

Email delivery and sender identity are controlled entirely by the SMTP settings in `.env`. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. For local Gmail, use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, the Gmail address as `SMTP_USER`, a Google app password as `SMTP_PASSWORD`, and the same Gmail address in `MAIL_FROM`. In production, set `MAIL_FROM="Musalla <musalla@islamunlocked.com>"` and use an SMTP service that authorizes that sender.

The application sends notifications when a Musalla is submitted for review, when a new or renewed membership request is created, and when an administrator adds someone directly by email.

Every Imam schedule opt-in, opt-out, or replacement sends the updated seven-day schedule to all active Imams and Musalla administrators for that Musalla.

At noon in the `America/New_York` timezone each day, every active Musalla's active Imam members receive a prayer-coverage digest. It shows the next seven days as a compact weekly table, highlights open slots that still need an Imam, and links directly to the Musalla schedule. Persisted delivery records prevent duplicate sends after restarts or when multiple application instances are running.

When `TEST_MODE=true`, daily digests are restricted to test Musallas and test Imams so a test process cannot notify production recipients.

Membership notifications go to every active administrator of the affected Musalla and every active database-designated super admin. Addresses are normalized and deduplicated. There is no `SUPER_ADMIN_EMAIL` setting; super-admin recipients come from the database.

Users can opt out of optional email notifications from their profile. Musalla administrators and super admins can also disable optional notifications for an entire Musalla from its profile. A direct membership-addition notice is always sent so the recipient has the opportunity to reject access they did not request.

## Environment variables

| Variable | Description |
| --- | --- |
| `PORT` | HTTP server port |
| `BASE_URL` | Public origin used for OAuth callbacks, emails, and invitations |
| `SESSION_SECRET` | Secret used to sign sessions |
| `TEST_MODE` | Enables isolated test accounts and Musallas |
| `MYSQL_HOST` | MySQL host |
| `MYSQL_PORT` | MySQL port |
| `MYSQL_USER` | MySQL user |
| `MYSQL_PASSWORD` | MySQL password |
| `MYSQL_DATABASE` | MySQL database |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `SMTP_HOST` | SMTP host |
| `SMTP_PORT` | SMTP port |
| `SMTP_SECURE` | Whether SMTP uses a secure connection |
| `SMTP_USER` | Optional SMTP username |
| `SMTP_PASSWORD` | Optional SMTP password |
| `MAIL_FROM` | Notification sender name and address |

## Mobile installation

Musalla includes a web-app manifest, service worker, application icons, and iOS safe-area support. In a supported mobile browser, users can add it to their home screen and run it with an app-like interface.

## Production deployment

For production:

- Serve the application over HTTPS.
- Set `BASE_URL` to the public HTTPS origin and `TEST_MODE=false`.
- Use a strong, unique `SESSION_SECRET`.
- Replace the default in-memory session store with a persistent store.
- Use durable shared storage for uploaded profile photos and Musalla logos when running multiple application instances.
