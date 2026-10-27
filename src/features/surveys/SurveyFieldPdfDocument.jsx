import { QUESTION_TYPES, RESPONSE_STATUS } from './surveyConstants';
import { getZonedDateTime, occurrenceDateOfResponse } from './surveySchedule';
import { daysUntilExpiry, formatExpiryDate } from './surveyDates';

const empty = '—';
const answerStatus = (response) => response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'لم يرسل';
const availability = (status, date, calendar) => status === 'missing' ? 'غير موجودة' : formatExpiryDate(date, calendar);
const remainingDays = (date, today) => {
  const days = daysUntilExpiry(date, today);
  return days === null ? empty : String(days);
};

const columnsFor = (type) => {
  if (type === QUESTION_TYPES.DOCUMENT) return ['الحالة', 'رقم الوثيقة', 'تاريخ الانتهاء', 'الأيام المتبقية'];
  if (type === QUESTION_TYPES.YES_NO) return ['الإجابة', 'السبب'];
  if (type === QUESTION_TYPES.HEALTH_DOCUMENTS) return ['الاسم الرباعي', 'الرقم الوظيفي', 'رقم الهوية', 'رقم الجوال', 'البصمة', 'الشهادة الصحية', 'الأيام المتبقية للصحية', 'شهادة التثقيف', 'الأيام المتبقية للتثقيف'];
  return ['الملاحظات'];
};

const valuesFor = (type, answer, worker, today) => {
  if (type === QUESTION_TYPES.DOCUMENT) return [answer?.status === 'missing' ? 'غير موجودة' : answer ? 'موجودة' : empty, answer?.status === 'missing' ? empty : answer?.documentNumber || empty, answer?.status === 'missing' ? empty : formatExpiryDate(answer?.expiryDate, answer?.expiryDateCalendar), answer?.status === 'missing' ? empty : remainingDays(answer?.expiryDate, today)];
  if (type === QUESTION_TYPES.YES_NO) return [answer?.value === 'yes' ? 'نعم' : answer?.value === 'no' ? 'لا' : empty, answer?.reason || empty];
  if (type === QUESTION_TYPES.HEALTH_DOCUMENTS) return worker ? [worker.fullName || empty, worker.employeeNumber || empty, worker.identityNumber || empty, worker.phoneNumber || empty, worker.hasBranchFingerprint === 'yes' ? 'نعم' : worker.hasBranchFingerprint === 'no' ? 'لا' : empty, availability(worker.healthCertificateStatus, worker.healthCertificateExpiryDate, worker.healthCertificateExpiryDateCalendar), worker.healthCertificateStatus === 'missing' ? empty : remainingDays(worker.healthCertificateExpiryDate, today), availability(worker.educationCertificateStatus, worker.educationExpiryDate, worker.educationExpiryDateCalendar), worker.educationCertificateStatus === 'missing' ? empty : remainingDays(worker.educationExpiryDate, today)] : Array(9).fill(empty);
  return [answer?.value || empty];
};

const SurveyFieldPdfDocument = ({ survey, question, date, branches, responses }) => {
  const today = getZonedDateTime().date;
  const columns = columnsFor(question.type);
  const rows = branches.flatMap((branch) => {
    const response = responses.find((item) => item.surveyId === survey.id && item.branchId === branch.id && occurrenceDateOfResponse(item) === date);
    const savedQuestion = response?.surveySnapshot?.questions?.find((item) => item.id === question.id);
    const fieldExists = !response || savedQuestion || (!response.surveySnapshot && survey.questions?.some((item) => item.id === question.id));
    const answer = fieldExists ? response?.answers?.[question.id] : null;
    const workers = question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && answer?.workers?.length ? answer.workers : [null];
    return workers.map((worker, index) => ({ branch, response, answer, worker, index, fieldExists, count: workers.length }));
  });

  return <div className={`survey-pdf survey-field-report${question.type === QUESTION_TYPES.HEALTH_DOCUMENTS ? ' survey-field-report-wide' : ''}`} dir="rtl">
    <header className="survey-pdf-header"><div><span className="survey-pdf-kicker">نظام سبأ · تقرير حقل الاستبيان</span><h1>{question.label}</h1><p>{survey.title}</p></div><div className="survey-field-report-date">تاريخ الموعد<strong>{date}</strong></div></header>
    <div className="survey-field-report-summary"><span>الفروع المختارة: <strong>{branches.length}</strong></span><span>تاريخ إنشاء التقرير: <strong>{new Date().toLocaleString('ar-SA')}</strong></span></div>
    <table className="survey-field-report-table"><thead><tr><th>الفرع</th><th>حالة الإجابة</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map(({ branch, response, answer, worker, index, fieldExists, count }) => <tr key={`${branch.id}-${worker?.id || index}`}>
      {index === 0 && <><td rowSpan={count} className="survey-field-report-branch">{branch.name || branch.id}</td><td rowSpan={count}>{fieldExists ? answerStatus(response) : 'الحقل غير موجود'}</td></>}
      {valuesFor(question.type, answer, worker, today).map((value, cellIndex) => <td key={cellIndex} className={Number(value) < 0 || value === 'غير موجودة' || value === 'لا' || value.startsWith('تاريخ غير صالح') ? 'survey-pdf-alert' : undefined}>{value}</td>)}
    </tr>)}</tbody></table>
    <footer>تقرير حقل «{question.label}» · {date} · العدد السالب يعني أن الوثيقة انتهت صلاحيتها.</footer>
  </div>;
};

export default SurveyFieldPdfDocument;
