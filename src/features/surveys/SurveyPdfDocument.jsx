import { QUESTION_TYPES, RESPONSE_STATUS, formatMonth } from './surveyConstants';
import { getZonedDateTime } from './surveySchedule';
import { formatExpiryDate, isExpiredDate, normalizeExpiryDate } from './surveyDates';
import { getInventoryPdfFields, getSurveyPdfResponse } from './surveyPdfSelection';

/**
 * Renders one response using the chosen inventory columns or survey questions.
 * 1. Limit inventory columns to the selected export fields.
 * 2. Otherwise show the questions available in this response snapshot.
 */
const SurveyPdfAnswers = ({ response, survey, questionId, inventoryFieldIds }) => {
  // STEP 1: Inventory PDF uses exactly the same field definitions as Excel.
  if ((response.surveySnapshot?.kind || survey.kind) === 'inventory') {
    const fields = getInventoryPdfFields(inventoryFieldIds);
    return <table className="survey-pdf-workers"><thead><tr><th>الصنف</th>{fields.map((field) => <th key={field.id}>{field.label}</th>)}</tr></thead><tbody>{Object.entries(response.inventoryAnswers || {}).map(([id, answer]) => <tr key={id}><td>{answer.productName}</td>{fields.map((field) => {
      const value = field.value(answer);
      return <td key={field.id} className={field.id === 'difference' && Number(value) < 0 ? 'survey-pdf-alert' : undefined}>{value === null || value === '' ? '—' : value}</td>;
    })}</tr>)}</tbody></table>;
  }
  // STEP 2: Keep the existing document, note, and health-certificate rendering.
  const questions = response.surveySnapshot?.questions || survey.questions || [];
  const visibleQuestions = questionId ? questions.filter((question) => question.id === questionId) : questions;
  const today = getZonedDateTime().date;
  if (questionId && visibleQuestions.length === 0) return <p className="survey-pdf-empty">هذا الحقل غير موجود في نسخة الاستبيان التي أجاب عنها الفرع.</p>;
  return <div className="survey-pdf-answer-grid">{visibleQuestions.map((question) => {
    const answer = response.answers?.[question.id] || {};
    const wide = question.type === QUESTION_TYPES.HEALTH_DOCUMENTS
      || (question.type === QUESTION_TYPES.NOTES && (answer.value || '').length > 120)
      || (question.type === QUESTION_TYPES.YES_NO && (answer.reason || '').length > 120);
    return <article className={`survey-pdf-question${wide ? ' survey-pdf-question-wide' : ''}`} key={question.id}><h2>{question.label}</h2>
      {question.type === QUESTION_TYPES.DOCUMENT && (answer.status === 'missing' ? <p className="survey-pdf-alert">الوثيقة غير موجودة</p> : <div className="survey-pdf-pairs"><div><span>رقم الوثيقة</span><strong>{answer.documentNumber || '—'}</strong></div><div><span>تاريخ الانتهاء</span><strong className={isExpiredDate(normalizeExpiryDate(answer.expiryDate), today) ? 'survey-pdf-alert' : undefined}>{formatExpiryDate(answer.expiryDate, answer.expiryDateCalendar)}</strong></div></div>)}
      {question.type === QUESTION_TYPES.YES_NO && <div className="survey-pdf-pairs"><div><span>الإجابة</span><strong className={answer.value === 'no' ? 'survey-pdf-alert' : undefined}>{answer.value === 'yes' ? 'نعم' : answer.value === 'no' ? 'لا' : '—'}</strong></div>{answer.value === 'no' && <div><span>السبب</span><strong>{answer.reason || '—'}</strong></div>}</div>}
      {question.type === QUESTION_TYPES.NOTES && <p>{answer.value || '—'}</p>}
      {question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && <table className="survey-pdf-workers"><thead><tr><th>الاسم الرباعي</th><th>الرقم الوظيفي</th><th>رقم الهوية</th><th>رقم الجوال</th><th>بصمة في الفرع</th><th>انتهاء الشهادة الصحية</th><th>انتهاء التثقيف</th></tr></thead><tbody>{(answer.workers || []).map((worker) => <tr key={worker.id}><td>{worker.fullName}</td><td>{worker.employeeNumber || '—'}</td><td>{worker.identityNumber}</td><td>{worker.phoneNumber}</td><td className={worker.hasBranchFingerprint === 'no' ? 'survey-pdf-alert' : undefined}>{worker.hasBranchFingerprint === 'yes' ? 'نعم' : worker.hasBranchFingerprint === 'no' ? 'لا' : '—'}</td><td className={worker.healthCertificateStatus === 'missing' || isExpiredDate(normalizeExpiryDate(worker.healthCertificateExpiryDate), today) ? 'survey-pdf-alert' : undefined}>{worker.healthCertificateStatus === 'missing' ? 'غير موجودة' : formatExpiryDate(worker.healthCertificateExpiryDate, worker.healthCertificateExpiryDateCalendar)}</td><td className={worker.educationCertificateStatus === 'missing' || isExpiredDate(normalizeExpiryDate(worker.educationExpiryDate), today) ? 'survey-pdf-alert' : undefined}>{worker.educationCertificateStatus === 'missing' ? 'غير موجودة' : formatExpiryDate(worker.educationExpiryDate, worker.educationExpiryDateCalendar)}</td></tr>)}</tbody></table>}
    </article>;
  })}</div>;
};

/**
 * Builds a PDF for one selected survey date across the selected branches.
 * 1. Skip rendering until a date is selected.
 * 2. Match one response per branch for that date and render only its answers.
 */
const SurveyPdfDocument = ({ survey, month, date, branches, responses, question, inventoryFieldIds = [] }) => {
  // STEP 1: An empty date must not silently expand to the whole month.
  if (!date) return null;
  // STEP 2: Every branch gets just the chosen occurrence, including a clear missing status.
  return <div className="survey-pdf" dir="rtl">{branches.map((branch, index) => {
    const response = getSurveyPdfResponse({ surveyId: survey.id, branchId: branch.id, date, responses });
    const completed = response?.status === RESPONSE_STATUS.SUBMITTED ? 1 : 0;
    return <section className="survey-pdf-branch" key={branch.id}>
      <header className="survey-pdf-header"><div><span className="survey-pdf-kicker">نظام سبأ · تقرير الاستبيانات</span><h1>{question ? question.label : survey.title}</h1><p>{survey.title} · {formatMonth(month)} · {branch.name || branch.id}</p></div><div className="survey-pdf-number">{index + 1} / {branches.length}</div></header>
      <div className="survey-pdf-status"><strong>الموعد {date}</strong><span>{completed} مكتمل من 1</span></div>
      <section className="survey-pdf-occurrence">
        <div className="survey-pdf-occurrence-heading"><strong>موعد {date}</strong><span>{response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'لم يرسل'}</span></div>
        {response && <SurveyPdfAnswers response={response} survey={survey} questionId={question?.id} inventoryFieldIds={inventoryFieldIds} />}
      </section>
      <footer>تاريخ إنشاء التقرير: {new Date().toLocaleString('ar-SA')} · {branch.name || branch.id}</footer>
    </section>;
  })}</div>;
};

export default SurveyPdfDocument;
