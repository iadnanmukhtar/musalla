const test = require('node:test');
const assert = require('node:assert/strict');
const {
  digestDetails,
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

test('lists available and assigned slots and labels the following Fajr', () => {
  const details = digestDetails([
    { prayer_date: '2026-07-15', prayer_name: 'Asr', imam_name: 'Amina' },
    { prayer_date: '2026-07-16', prayer_name: 'Fajr', imam_name: null },
    { prayer_date: '2026-07-15', prayer_name: 'Fajr', imam_name: null }
  ], '2026-07-16');
  assert.deepEqual(details, [
    { label: 'Fajr', value: 'Available' },
    { label: 'Asr', value: 'Amina' },
    { label: 'Next Fajr · Thu, Jul 16', value: 'Available' }
  ]);
});
