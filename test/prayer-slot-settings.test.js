const test = require('node:test');
const assert = require('node:assert/strict');
const { enabledPrayersForDate } = require('../src/db');

const settings = {
  fajr_enabled: true,
  zuhr_enabled: false,
  asr_enabled: true,
  maghrib_enabled: false,
  isha_enabled: true,
  jumuah_1_enabled: true,
  jumuah_2_enabled: false,
  jumuah_3_enabled: true
};

test('daily Salah settings control which opt-in slots are generated', () => {
  assert.deepEqual(enabledPrayersForDate(settings, new Date('2026-07-16T12:00:00Z')), ['Fajr','Asr','Isha']);
});

test('Friday replaces Zuhr with independently enabled Jumuah slots', () => {
  assert.deepEqual(enabledPrayersForDate(settings, new Date('2026-07-17T12:00:00Z')), ['Fajr','Asr','Isha','Jumuah 1','Jumuah 3']);
});
