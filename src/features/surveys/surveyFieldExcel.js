import { buildSurveyFieldReport } from './surveyFieldReportData.js';

const worksheetName = (label, index, usedNames) => {
  const base = String(label || `حقل ${index + 1}`).replace(/[\\/:*?]/g, '_').replaceAll('[', '_').replaceAll(']', '_').trim().replace(/^'+|'+$/g, '') || `حقل ${index + 1}`;
  let name = base.slice(0, 31);
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    const tail = ` (${suffix++})`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  usedNames.add(name.toLocaleLowerCase());
  return name;
};

const addFieldWorksheet = (workbook, { survey, question, date, branches, responses }, name) => {
  const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }] });
  const { columns, rows } = buildSurveyFieldReport({ survey, question, date, branches, responses });
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `تقرير حقل الاستبيان: ${question.label}`;
  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell(2, 1).value = `${survey.title} | تاريخ الموعد: ${date} | الفروع المختارة: ${branches.length}`;
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 24;
  for (const rowNumber of [1, 2]) {
    const cell = sheet.getCell(rowNumber, 1);
    cell.font = { name: 'Arial', bold: true, size: rowNumber === 1 ? 15 : 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber === 1 ? 'FF163B67' : 'FF3975AB' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  const header = sheet.getRow(4);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column;
    cell.font = { name: 'Arial', bold: true, color: { argb: 'FF163B67' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  });
  header.height = 34;
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 5);
    row.cells.forEach((value, cellIndex) => {
      const cell = excelRow.getCell(cellIndex + 1);
      cell.value = value;
      cell.font = { name: 'Arial', size: 10, color: { argb: Number(value) < 0 || value === 'غير موجودة' ? 'FFB91C1C' : 'FF1E293B' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD5E1EB' } } };
      if (rowIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
    });
    excelRow.height = row.cells.some((value) => String(value).length > 110) ? 48 : 30;
  });
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = index === 0 ? 24 : Math.min(42, Math.max(17, column.length + 5));
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
};

export const createSurveyFieldsWorkbook = async ({ survey, questions, date, branches, responses }) => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام سبأ';
  const usedNames = new Set();
  questions.forEach((question, index) => addFieldWorksheet(
    workbook,
    { survey, question, date, branches, responses },
    worksheetName(question.label, index, usedNames),
  ));
  return workbook;
};
