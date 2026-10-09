import { getZonedDateTime } from './surveySchedule.js';

export const SURVEY_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
};

export const RESPONSE_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
};

export const QUESTION_TYPES = {
  DOCUMENT: 'document',
  YES_NO: 'yes_no',
  NOTES: 'notes',
  HEALTH_DOCUMENTS: 'health_documents',
};

export const getCurrentMonth = () => {
  return getZonedDateTime().date.slice(0, 7);
};

export const getRecentMonths = (count = 6) => {
  const [year, month] = getCurrentMonth().split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

export const formatMonth = (month) => {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 'شهر غير محدد';
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
};

export const createEmptyQuestion = (type = QUESTION_TYPES.DOCUMENT) => ({
  id: crypto.randomUUID(),
  type,
  label: '',
  required: true,
  ...(type === QUESTION_TYPES.YES_NO ? { reasonRequiredWhen: 'no' } : {}),
});
