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
};

export const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const getRecentMonths = (count = 6) => {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - index - 1), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
};

export const formatMonth = (month) => {
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
