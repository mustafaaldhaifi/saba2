/**
 * Builds a single worksheet of product answers for the chosen survey date.
 * 1. Pair each selected branch with its response.
 * 2. Add one row per product answer.
 * 3. Format the resulting worksheet for right-to-left reading.
 */
export const createSurveyInventoryWorkbook = async ({ survey, date, branches, responses }) => {
  // STEP 1: Use the responses already loaded by the dashboard.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('جرد الأصناف', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
  const columns = ['الفرع', 'الصنف', 'رصيد الجرد', 'الموجود الفعلي', 'الفارق', 'الفائض المضاف للجرد', 'السبب', 'تاريخ الجرد المرجعي'];
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `${survey.title} · ${date}`;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF163B67' } };
  const header = sheet.getRow(3);
  columns.forEach((name, index) => {
    const cell = header.getCell(index + 1);
    cell.value = name;
    cell.font = { bold: true, color: { argb: 'FF163B67' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
  });

  // STEP 2: Keep every selected branch visible, including missing responses.
  for (const branch of branches) {
    const response = responses.find(item => item.branchId === branch.id && item.occurrenceDate === date);
    const answers = Object.values(response?.inventoryAnswers || {});
    if (!answers.length) sheet.addRow([branch.name || branch.id, 'لا توجد إجابة']);
    for (const answer of answers) sheet.addRow([
      branch.name || branch.id, answer.productName, answer.expectedQuantity,
      answer.actualQuantity, answer.difference, answer.appliedSurplus ?? 0, answer.reason || '', answer.referenceDate || '',
    ]);
  }

  // STEP 3: Apply readable widths and filters.
  [24, 28, 18, 20, 14, 21, 36, 23].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
  return workbook;
};
