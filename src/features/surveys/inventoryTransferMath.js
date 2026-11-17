/** Calculates the stock change still owed after the survey's initial surplus posting. */
export const calculateInventoryTransfer = (answer, report) => {
  const actual = Number(answer.actualQuantity);
  const expected = Number(answer.expectedQuantity);
  const difference = Number(answer.difference);
  const settled = answer.settledDifference === undefined ? 0 : Number(answer.settledDifference);
  const appliedSurplus = answer.settledDifference === undefined ? Number(answer.appliedSurplus || 0) : 0;
  const add = Number(report.add || 0);
  const closing = Number(report.closeStock);
  if (answer.actualQuantity == null || ![actual, expected, difference, settled, appliedSurplus, add, closing]
    .every(Number.isFinite) || Math.abs(difference - (actual - expected - settled)) > 1e-9 || appliedSurplus < 0) {
    throw new Error('قيمة الفارق أو رصيد الجرد غير صالح.');
  }
  const pending = difference - appliedSurplus;
  return { rawDifference: actual - expected, pending, nextAdd: add + pending, nextClosing: closing + pending };
};

/** Excludes unchanged surplus that was fully posted when the survey was submitted. */
export const canTransferInventoryDifference = (answer) => {
  const difference = Number(answer?.difference);
  return Number.isFinite(difference) && difference !== 0 &&
    !(answer.settledDifference === undefined && difference > 0 &&
      difference === Number(answer.appliedSurplus || 0));
};
