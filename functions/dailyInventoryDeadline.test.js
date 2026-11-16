const test = require('node:test');
const assert = require('node:assert/strict');
const { riyadhDate, lastOverdueDate } = require('./dailyInventoryDeadline');

test('one grace day allows a report dated the 15th through the 16th', () => {
  assert.equal(lastOverdueDate('2026-11-16', 1), '2026-11-14');
  assert.equal(lastOverdueDate('2026-11-17', 1), '2026-11-15');
});

test('Riyadh midnight starts the next enforcement date', () => {
  assert.equal(riyadhDate(new Date('2026-11-16T20:59:59Z')), '2026-11-16');
  assert.equal(riyadhDate(new Date('2026-11-16T21:00:00Z')), '2026-11-17');
});
