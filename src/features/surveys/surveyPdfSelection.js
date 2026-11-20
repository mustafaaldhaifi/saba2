import { INVENTORY_EXPORT_FIELDS } from './surveyInventoryExcel.js';
import { occurrenceDateOfResponse } from './surveySchedule.js';

/** Selects only the requested survey occurrence for one branch. */
export const getSurveyPdfResponse = ({ surveyId, branchId, date, responses }) =>
  responses.find((response) => response.surveyId === surveyId && response.branchId === branchId &&
    occurrenceDateOfResponse(response) === date);

/** Keeps inventory PDF columns in the same order and meaning as Excel. */
export const getInventoryPdfFields = (selectedIds) => {
  const ids = new Set(selectedIds);
  return INVENTORY_EXPORT_FIELDS.filter((field) => ids.has(field.id));
};
