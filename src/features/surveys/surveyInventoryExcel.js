export const INVENTORY_EXPORT_FIELDS = [
  { id: 'expectedQuantity', label: 'رصيد الجرد', value: (answer) => answer?.expectedQuantity ?? null },
  { id: 'actualQuantity', label: 'الموجود الفعلي', value: (answer) => answer?.actualQuantity ?? null },
  { id: 'difference', label: 'الفارق', value: (answer) => answer?.difference ?? null },
  { id: 'appliedSurplus', label: 'الفائض المضاف للجرد', value: (answer) => answer ? answer.appliedSurplus ?? 0 : null },
  { id: 'reason', label: 'السبب', value: (answer) => answer?.reason || '' },
  { id: 'referenceDate', label: 'تاريخ الجرد المرجعي', value: (answer) => answer?.referenceDate || '' },
];

const productNameKey = (name) => String(name || '').normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');

/**
 * Create one product-by-branch worksheet for every selected inventory field.
 * 1. Match the chosen date's responses and find names repeated inside one branch.
 * 2. Align products across branches by normalized name, preserving local name collisions.
 * 3. Add a separate sheet per field with product rows and branch columns.
 * 4. Preserve missing-response status and format each sheet for right-to-left reading.
 */
export const createSurveyInventoryWorkbook = async ({ survey, date, branches, responses, selectedColumnIds = INVENTORY_EXPORT_FIELDS.map((field) => field.id) }) => {
  // STEP 1: Product document IDs can differ by city, so detect ambiguous local names first.
  const selectedIds = new Set(selectedColumnIds);
  const fields = INVENTORY_EXPORT_FIELDS.filter((field) => selectedIds.has(field.id));
  if (!fields.length) throw new Error('اختر حقلًا واحدًا على الأقل للتصدير.');
  const responseByBranch = new Map();
  const namesByBranch = new Map();
  const canonicalNameById = new Map();
  for (const branch of branches) {
    const response = responses.find((item) => item.branchId === branch.id && item.occurrenceDate === date);
    responseByBranch.set(branch.id, response);
    const localNames = new Map();
    for (const [productId, answer] of Object.entries(response?.inventoryAnswers || {})) {
      const name = productNameKey(answer.productName);
      if (!name) continue;
      if (!canonicalNameById.has(productId)) canonicalNameById.set(productId, name);
      const ids = localNames.get(name) || new Set();
      ids.add(productId);
      localNames.set(name, ids);
    }
    namesByBranch.set(branch.id, localNames);
  }
  const ambiguousNames = new Set([...namesByBranch.values()].flatMap((names) =>
    [...names.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name)));

  // STEP 2: Only a same-branch name collision needs separate ID-labelled rows.
  const products = new Map();
  for (const branch of branches) {
    const response = responseByBranch.get(branch.id);
    for (const [productId, answer] of Object.entries(response?.inventoryAnswers || {})) {
      const name = canonicalNameById.get(productId) || productNameKey(answer.productName);
      const key = !name || ambiguousNames.has(name) ? `id:${productId}` : `name:${name}`;
      if (!products.has(key)) products.set(key, {
        name: name && ambiguousNames.has(name) ? `${String(answer.productName).trim()} [${productId}]` :
          String(answer.productName || productId).trim().replace(/\s+/g, ' '),
        answersByBranch: new Map(),
      });
      products.get(key).answersByBranch.set(branch.id, answer);
    }
  }
  const productRows = [...products.values()].sort((left, right) => left.name.localeCompare(right.name, 'ar'));

  // STEP 3: The product column is shared; each selected branch has one value column.
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
    // STEP 4: A branch without a response stays visible in its own status cell.
    sheet.addRow(['حالة الإجابة', ...branches.map((branch) => {
      const response = responseByBranch.get(branch.id);
      return response?.status === 'submitted' ? 'تم الإرسال' : response?.status === 'draft' ? 'مسودة' : response ? 'توجد إجابة' : 'لا توجد إجابة';
    })]);
    for (const product of productRows) {
      sheet.addRow([product.name, ...branches.map((branch) =>
        field.value(product.answersByBranch.get(branch.id)))]);
    }
    sheet.getColumn(1).width = 30;
    branches.forEach((_, index) => { sheet.getColumn(index + 2).width = field.id === 'reason' ? 36 : 22; });
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: branches.length + 1 } };
  }
  return workbook;
};
