import test from 'node:test';
import assert from 'node:assert/strict';
import { getLatestDueOccurrence, getResponseMonth, listDueOccurrencesInMonth, occurrenceDateOfResponse, scheduledDateTime } from './surveySchedule.js';

const survey = (schedule) => ({ schedule: { timezone: 'Asia/Riyadh', startDate: '2026-10-01', missedPolicy: 'latest_only', ...schedule } });

test('daily occurrence starts at the beginning of its Riyadh date', () => {
  const item = survey({ type: 'daily' });
  assert.equal(getLatestDueOccurrence(item, new Date('2026-10-08T20:59:00Z')), '2026-10-08');
  assert.equal(getLatestDueOccurrence(item, new Date('2026-10-08T21:00:00Z')), '2026-10-09');
});

test('weekly schedule follows the chosen ISO weekday', () => {
  const item = survey({ type: 'weekly', weekDay: 1 });
  assert.deepEqual(listDueOccurrencesInMonth(item, '2026-10', new Date('2026-10-31T12:00:00Z')), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
});

test('month end uses the actual last day, including leap year', () => {
  const item = survey({ type: 'month_end', startDate: '2028-02-01' });
  assert.deepEqual(listDueOccurrencesInMonth(item, '2028-02', new Date('2028-03-01T12:00:00Z')), ['2028-02-29']);
});

test('scheduled timestamp represents midnight in Riyadh', () => {
  assert.equal(scheduledDateTime('2026-10-09', survey({ type: 'daily' }).schedule).toISOString(), '2026-10-08T21:00:00.000Z');
});

test('a changed schedule preserves older occurrences and starts the new pattern on its start date', () => {
  const item = {
    scheduleHistory: [{ type: 'month_start', startDate: '2026-08-01', endDate: '2026-10-09', timezone: 'Asia/Riyadh' }],
    schedule: { type: 'daily', startDate: '2026-10-09', timezone: 'Asia/Riyadh' },
  };
  assert.deepEqual(listDueOccurrencesInMonth(item, '2026-09', new Date('2026-10-12T12:00:00Z')), ['2026-09-01']);
  assert.deepEqual(listDueOccurrencesInMonth(item, '2026-10', new Date('2026-10-11T12:00:00Z')), ['2026-10-01', '2026-10-09', '2026-10-10', '2026-10-11']);
});

test('old responses without month derive it from occurrence date or document ID', () => {
  assert.equal(getResponseMonth({ id: 'survey__branch__2026-10-09', occurrenceDate: '2026-10-09' }), '2026-10');
  assert.equal(getResponseMonth({ id: 'survey__branch__2026-09' }), '2026-09');
  assert.equal(occurrenceDateOfResponse({ id: 'survey__branch__2026-09' }), '2026-09-01');
  assert.equal(getResponseMonth({ id: 'broken', month: undefined }), null);
});
