import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurveyFieldReport } from './surveyFieldReportData.js';
import { createSurveyFieldsWorkbook } from './surveyFieldExcel.js';

const survey = { id: 'survey-1', title: 'وثائق الفروع', questions: [{ id: 'license', type: 'document', label: 'الرخصة' }] };
const question = survey.questions[0];
const branches = [{ id: 'a', name: 'فرع أ' }, { id: 'b', name: 'فرع ب' }];
const responses = [{ surveyId: 'survey-1', branchId: 'a', occurrenceDate: '2026-10-27', status: 'submitted', answers: {
  license: { status: 'available', documentNumber: '123', expiryDate: '1448-04-29', expiryDateCalendar: 'hijri' },
} }];

test('field report keeps all selected branches and calculates Hijri expiry days', () => {
  const report = buildSurveyFieldReport({ survey, question, date: '2026-10-27', branches, responses, today: '2026-10-09' });
  assert.deepEqual(report.columns, ['الفرع', 'حالة الإجابة', 'الحالة', 'رقم الوثيقة', 'تاريخ الانتهاء', 'الأيام المتبقية']);
  assert.deepEqual(report.rows[0].cells, ['فرع أ', 'تم الإرسال', 'موجودة', '123', '1448-04-29 هـ', '1']);
  assert.deepEqual(report.rows[1].cells, ['فرع ب', 'لم يرسل', '—', '—', '—', '—']);
});

test('Excel workbook contains one tab per selected field, even with duplicate labels', async () => {
  const workbook = await createSurveyFieldsWorkbook({ survey, questions: [question, { id: 'notes', type: 'notes', label: 'الرخصة' }], date: '2026-10-27', branches, responses });
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 1000);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['الرخصة', 'الرخصة (2)']);
  const sheet = workbook.getWorksheet('الرخصة');
  assert.equal(sheet.getCell('A4').value, 'الفرع');
  assert.equal(sheet.getCell('A5').value, 'فرع أ');
  assert.equal(sheet.getCell('A6').value, 'فرع ب');
  assert.equal(workbook.getWorksheet('الرخصة (2)').getCell('C4').value, 'الملاحظات');
});
