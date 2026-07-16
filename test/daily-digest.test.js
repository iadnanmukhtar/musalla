const test = require('node:test');
const assert = require('node:assert/strict');
const {
  digestDetails,
  weeklyDigestHtml,
  weeklyDigestRows,
  easternDigestDate,
  isPastEasternNoon,
  millisecondsUntilNextEasternNoon
} = require('../src/daily-digest');

test('uses the Eastern calendar day and noon across daylight-saving time', () => {
  assert.equal(easternDigestDate(new Date('2026-01-15T17:00:00Z')), '2026-01-15');
  assert.equal(easternDigestDate(new Date('2026-07-15T16:00:00Z')), '2026-07-15');
  assert.equal(isPastEasternNoon(new Date('2026-07-15T15:59:59Z')), false);
  assert.equal(isPastEasternNoon(new Date('2026-07-15T16:00:00Z')), true);
});

test('finds the next noon in America/New_York', () => {
  assert.equal(millisecondsUntilNextEasternNoon(new Date('2026-07-15T15:59:00Z')), 60_000);
  assert.equal(millisecondsUntilNextEasternNoon(new Date('2026-01-15T16:59:00Z')), 60_000);
  assert.equal(millisecondsUntilNextEasternNoon(new Date('2026-07-15T16:01:00Z')), 23 * 60 * 60 * 1000 + 59 * 60 * 1000);
});

test('builds a seven-day, five-prayer coverage view', () => {
  const slots = [
    { prayer_date: '2026-07-15', prayer_name: 'Asr', imam_name: 'Amina' },
    { prayer_date: '2026-07-15', prayer_name: 'Fajr', imam_name: null },
    { prayer_date: '2026-07-17', prayer_name: 'Jumuah 1', imam_name: null },
    { prayer_date: '2026-07-17', prayer_name: 'Jumuah 2', imam_name: 'Bilal' }
  ];
  const rows = weeklyDigestRows(slots, '2026-07-15');
  const details = digestDetails(slots, '2026-07-15');
  const html = weeklyDigestHtml(slots, '2026-07-15');

  assert.equal(rows.length, 7);
  assert.ok(rows.every(row => row.prayers.length === 5));
  assert.deepEqual(rows[0].prayers[0], { prayer: 'Fajr', value: 'Open', open: true });
  assert.deepEqual(rows[0].prayers[2], { prayer: 'Asr', value: 'Amina', open: false });
  assert.deepEqual(rows[2].prayers[1], { prayer: 'Zuhr', value: 'J1: Open · J2: Bilal', open: true });
  assert.equal(details.length, 7);
  assert.match(html, /Seven-day prayer coverage/);
  assert.match(html, /J1: Open · J2: Bilal/);
  assert.match(html, /#fff9db/);
});
