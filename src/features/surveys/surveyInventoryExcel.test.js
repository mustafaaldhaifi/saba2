import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurveyInventoryWorkbook } from './surveyInventoryExcel.js';

test('inventory export aligns shared products by ID and gives each field its own sheet', async () => {
  const workbook = await createSurveyInventoryWorkbook({
    survey: { title: 'جرد الأصناف' },
    date: '2026-11-15',
    branches: [{ id: 'b1', name: 'الرياض' }, { id: 'b2', name: 'جدة' }, { id: 'b3', name: 'المدينة' }],
    responses: [
      { branchId: 'b1', occurrenceDate: '2026-11-15', status: 'submitted', inventoryAnswers: {
        milk: { productName: 'حليب', actualQuantity: 0, reason: '' },
        bread: { productName: 'خبز', actualQuantity: 5, reason: 'زيادة' },
      } },
      { branchId: 'b2', occurrenceDate: '2026-11-15', status: 'submitted', inventoryAnswers: {
        milk_jeddah: { productName: ' حليب  ', actualQuantity: 3, reason: 'نقص' },
        water: { productName: 'ماء', actualQuantity: 8, reason: '' },
      } },
      { branchId: 'b3', occurrenceDate: '2026-11-14', status: 'submitted', inventoryAnswers: {
        cheese: { productName: 'جبن', actualQuantity: 2, reason: '' },
      } },
    ],
    selectedColumnIds: ['reason', 'actualQuantity'],
  });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['الموجود الفعلي', 'السبب']);
  assert.equal(workbook.getWorksheet('الموجود الفعلي').autoFilter.to.column, 4);

  const buffer = await workbook.xlsx.writeBuffer();
  const { default: ExcelJS } = await import('exceljs');
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  const actualSheet = reopened.getWorksheet('الموجود الفعلي');
  const reasonSheet = reopened.getWorksheet('السبب');
  assert.deepEqual([1, 2, 3, 4].map((column) => actualSheet.getRow(3).getCell(column).value),
    ['الصنف', 'الرياض', 'جدة', 'المدينة']);
  assert.deepEqual([1, 2, 3, 4].map((column) => actualSheet.getRow(4).getCell(column).value),
    ['حالة الإجابة', 'تم الإرسال', 'تم الإرسال', 'لا توجد إجابة']);

  const products = new Map();
  for (let rowNumber = 5; rowNumber <= actualSheet.rowCount; rowNumber += 1) {
    const row = actualSheet.getRow(rowNumber);
    products.set(row.getCell(1).value, rowNumber);
  }
  assert.equal(products.size, 3);
  const milkRow = products.get('حليب');
  assert.ok(milkRow);
  assert.equal(actualSheet.getRow(milkRow).getCell(2).value, 0);
  assert.equal(actualSheet.getRow(milkRow).getCell(3).value, 3);
  assert.equal(actualSheet.getRow(milkRow).getCell(4).value, null);
  assert.equal(reasonSheet.getRow(milkRow).getCell(3).value, 'نقص');
  assert.equal(products.has('جبن'), false);
});

test('same-named products inside one branch retain separate values and IDs', async () => {
  const workbook = await createSurveyInventoryWorkbook({
    survey: { title: 'جرد الأصناف' }, date: '2026-11-15',
    branches: [{ id: 'b1', name: 'الرياض' }],
    responses: [{ branchId: 'b1', occurrenceDate: '2026-11-15', inventoryAnswers: {
      first: { productName: 'حليب', difference: 2 },
      second: { productName: ' حليب ', difference: -3 },
    } }],
    selectedColumnIds: ['difference'],
  });
  const sheet = workbook.getWorksheet('الفارق');
  assert.equal(sheet.getRow(5).getCell(1).value, 'حليب [first]');
  assert.equal(sheet.getRow(5).getCell(2).value, 2);
  assert.equal(sheet.getRow(6).getCell(1).value, 'حليب [second]');
  assert.equal(sheet.getRow(6).getCell(2).value, -3);
});
