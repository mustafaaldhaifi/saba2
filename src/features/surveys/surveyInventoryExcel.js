export const INVENTORY_EXPORT_FIELDS = [
  { id: 'expectedQuantity', label: 'رصيد الجرد', value: (answer) => answer?.expectedQuantity ?? null },
  { id: 'actualQuantity', label: 'الموجود الفعلي', value: (answer) => answer?.actualQuantity ?? null },
  { id: 'difference', label: 'الفارق', value: (answer) => answer?.difference ?? null },
  { id: 'appliedSurplus', label: 'الفائض المضاف للجرد', value: (answer) => answer ? answer.appliedSurplus ?? 0 : null },
  { id: 'reason', label: 'السبب', value: (answer) => answer?.reason || '' },
  { id: 'referenceDate', label: 'تاريخ الجرد المرجعي', value: (answer) => answer?.referenceDate || '' },
];

/**
 * Create one product-by-branch worksheet for every selected inventory field.
 * 1. Match the chosen date's responses to branches and collect unique product IDs.
 * 2. Add a separate sheet per field with product rows and branch columns.
 * 3. Preserve missing-response status and format each sheet for right-to-left reading.
 */
export const createSurveyInventoryWorkbook = async ({ survey, date, branches, responses, selectedColumnIds = INVENTORY_EXPORT_FIELDS.map((field) => field.id) }) => {
  // STEP 1: Product IDs keep the same item aligned across branches even if names differ.
  const selectedIds = new Set(selectedColumnIds);
  const fields = INVENTORY_EXPORT_FIELDS.filter((field) => selectedIds.has(field.id));
  if (!fields.length) throw new Error('اختر حقلًا واحدًا على الأقل للتصدير.');
  const responseByBranch = new Map();
  const products = new Map();
  for (const branch of branches) {
    const response = responses.find((item) => item.branchId === branch.id && item.occurrenceDate === date);
    responseByBranch.set(branch.id, response);
    for (const [productId, answer] of Object.entries(response?.inventoryAnswers || {})) {
      if (!products.has(productId)) products.set(productId, answer.productName || productId);
    }
  }
  const productRows = [...products.entries()].sort((left, right) => left[1].localeCompare(right[1], 'ar'));

  // STEP 2: The product column is shared; each selected branch has one value column.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  for (const field of fields) {
    const sheet = workbook.addWorksheet(field.label, { views: [{ rightToLeft: true, state: 'frozen', xSplit: 1, ySplit: 4 }] });
    sheet.mergeCells(1, 1, 1, branches.length + 1);
    sheet.getCell(1, 1).value = `${survey.title} · ${field.label} · ${date}`;
    sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF163B67' } };
    const header = sheet.getRow(3);
    ['الصنف', ...branches.map((branch) => branch.name || branch.id)].forEach((label, index) => {
      const cell = header.getCell(index + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: 'FF163B67' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    });
    // STEP 3: A branch without a response stays visible in its own status cell.
    sheet.addRow(['حالة الإجابة', ...branches.map((branch) => {
      const response = responseByBranch.get(branch.id);
      return response?.status === 'submitted' ? 'تم الإرسال' : response?.status === 'draft' ? 'مسودة' : response ? 'توجد إجابة' : 'لا توجد إجابة';
    })]);
    for (const [productId, productName] of productRows) {
      sheet.addRow([productName, ...branches.map((branch) =>
        field.value(responseByBranch.get(branch.id)?.inventoryAnswers?.[productId]))]);
    }
    sheet.getColumn(1).width = 30;
    branches.forEach((_, index) => { sheet.getColumn(index + 2).width = field.id === 'reason' ? 36 : 22; });
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: branches.length + 1 } };
  }
  return workbook;
};
