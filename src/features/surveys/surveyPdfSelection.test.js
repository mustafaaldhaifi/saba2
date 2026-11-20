import test from 'node:test';
import assert from 'node:assert/strict';
import { getInventoryPdfFields, getSurveyPdfResponse } from './surveyPdfSelection.js';

test('PDF uses only the selected occurrence even when the branch has other dates', () => {
  const responses = [
    { surveyId: 's1', branchId: 'b1', occurrenceDate: '2026-11-14' },
    { surveyId: 's1', branchId: 'b1', occurrenceDate: '2026-11-15' },
    { surveyId: 's1', branchId: 'b2', occurrenceDate: '2026-11-15' },
  ];
  assert.equal(getSurveyPdfResponse({ surveyId: 's1', branchId: 'b1', date: '2026-11-15', responses }), responses[1]);
  assert.equal(getSurveyPdfResponse({ surveyId: 's1', branchId: 'b1', date: '2026-11-16', responses }), undefined);
});

test('inventory PDF includes only selected fields in the Excel field order', () => {
  assert.deepEqual(getInventoryPdfFields(['reason', 'difference']).map((field) => field.id), ['difference', 'reason']);
});
