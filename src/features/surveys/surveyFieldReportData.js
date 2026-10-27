import { QUESTION_TYPES, RESPONSE_STATUS } from './surveyConstants.js';
import { getZonedDateTime, occurrenceDateOfResponse } from './surveySchedule.js';
import { daysUntilExpiry, formatExpiryDate } from './surveyDates.js';

const empty = '—';
const availability = (status, date, calendar) => status === 'missing' ? 'غير موجودة' : formatExpiryDate(date, calendar);
const remainingDays = (date, today) => {
  const days = daysUntilExpiry(date, today);
  return days === null ? empty : String(days);
};

export const fieldReportColumns = (type) => {
  if (type === QUESTION_TYPES.DOCUMENT) return ['الحالة', 'رقم الوثيقة', 'تاريخ الانتهاء', 'الأيام المتبقية'];
  if (type === QUESTION_TYPES.YES_NO) return ['الإجابة', 'السبب'];
  if (type === QUESTION_TYPES.HEALTH_DOCUMENTS) return ['الاسم الرباعي', 'الرقم الوظيفي', 'رقم الهوية', 'رقم الجوال', 'البصمة', 'الشهادة الصحية', 'الأيام المتبقية للصحية', 'شهادة التثقيف', 'الأيام المتبقية للتثقيف'];
  return ['الملاحظات'];
};

const fieldValues = (type, answer, worker, today) => {
  if (type === QUESTION_TYPES.DOCUMENT) return [
    answer?.status === 'missing' ? 'غير موجودة' : answer ? 'موجودة' : empty,
    answer?.status === 'missing' ? empty : answer?.documentNumber || empty,
    answer?.status === 'missing' ? empty : formatExpiryDate(answer?.expiryDate, answer?.expiryDateCalendar),
    answer?.status === 'missing' ? empty : remainingDays(answer?.expiryDate, today),
  ];
  if (type === QUESTION_TYPES.YES_NO) return [
    answer?.value === 'yes' ? 'نعم' : answer?.value === 'no' ? 'لا' : empty,
    answer?.reason || empty,
  ];
  if (type === QUESTION_TYPES.HEALTH_DOCUMENTS) return worker ? [
    worker.fullName || empty,
    worker.employeeNumber || empty,
    worker.identityNumber || empty,
    worker.phoneNumber || empty,
    worker.hasBranchFingerprint === 'yes' ? 'نعم' : worker.hasBranchFingerprint === 'no' ? 'لا' : empty,
    availability(worker.healthCertificateStatus, worker.healthCertificateExpiryDate, worker.healthCertificateExpiryDateCalendar),
    worker.healthCertificateStatus === 'missing' ? empty : remainingDays(worker.healthCertificateExpiryDate, today),
    availability(worker.educationCertificateStatus, worker.educationExpiryDate, worker.educationExpiryDateCalendar),
    worker.educationCertificateStatus === 'missing' ? empty : remainingDays(worker.educationExpiryDate, today),
  ] : Array(9).fill(empty);
  return [answer?.value || empty];
};

export const buildSurveyFieldReport = ({ survey, question, date, branches, responses, today = getZonedDateTime().date }) => ({
  columns: ['الفرع', 'حالة الإجابة', ...fieldReportColumns(question.type)],
  rows: branches.flatMap((branch) => {
    const response = responses.find((item) => item.surveyId === survey.id && item.branchId === branch.id && occurrenceDateOfResponse(item) === date);
    const inSnapshot = response?.surveySnapshot?.questions?.some((item) => item.id === question.id);
    const fieldExists = !response || inSnapshot || (!response.surveySnapshot && survey.questions?.some((item) => item.id === question.id));
    const answer = fieldExists ? response?.answers?.[question.id] : null;
    const workers = question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && answer?.workers?.length ? answer.workers : [null];
    const status = !fieldExists ? 'الحقل غير موجود' : response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'لم يرسل';
    return workers.map((worker, index) => ({
      key: `${branch.id}-${worker?.id || index}`,
      cells: [branch.name || branch.id, status, ...fieldValues(question.type, answer, worker, today)],
    }));
  }),
});
