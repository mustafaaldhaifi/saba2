import test from 'node:test';
import assert from 'node:assert/strict';
import { gregorianToHijri, hijriToGregorian, isExpiredDate } from './surveyDates.js';

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
