import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilExpiry, formatExpiryDate, gregorianToHijri, hijriToGregorian, isExpiredDate, normalizeExpiryDate } from './surveyDates.js';

test('Hijri dates round-trip through the Gregorian storage format', () => {
  for (const gregorian of ['2026-10-13', '2027-01-01', '2030-12-31']) {
    assert.equal(hijriToGregorian(gregorianToHijri(gregorian)), gregorian);
  }
  assert.equal(hijriToGregorian('1448-13-01'), null);
  assert.equal(hijriToGregorian('1448-02-31'), null);
});

test('only dates earlier than today are expired', () => {
  assert.equal(isExpiredDate('2026-10-12', '2026-10-13'), true);
  assert.equal(isExpiredDate('2026-10-13', '2026-10-13'), false);
  assert.equal(isExpiredDate('2026-10-14', '2026-10-13'), false);
  assert.equal(isExpiredDate('', '2026-10-13'), false);
});

test('expiry countdown treats stored Hijri and Gregorian dates as the same day', () => {
  const gregorian = '2026-10-28';
  const hijri = gregorianToHijri(gregorian);
  assert.equal(normalizeExpiryDate(hijri), gregorian);
  assert.equal(daysUntilExpiry(gregorian, '2026-10-27'), 1);
  assert.equal(daysUntilExpiry(hijri, '2026-10-27'), 1);
  assert.equal(daysUntilExpiry(hijri, '2026-10-29'), -1);
  assert.equal(daysUntilExpiry('1448-13-01', '2026-10-27'), null);
  assert.equal(formatExpiryDate(gregorian, 'hijri'), `${hijri} هـ`);
  assert.equal(formatExpiryDate(gregorian, 'gregorian'), `${gregorian} م`);
  assert.equal(formatExpiryDate(hijri), `${hijri} هـ`);
  assert.equal(formatExpiryDate('1448-04-28', 'hijri'), '1448-04-28 هـ');
  assert.equal(daysUntilExpiry('1448-04-28', '2026-10-08'), 1);
});
