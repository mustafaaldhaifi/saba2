import { QUESTION_TYPES, RESPONSE_STATUS, formatMonth } from './surveyConstants';
import { getResponseMonth, listDueOccurrencesInMonth, occurrenceDateOfResponse } from './surveySchedule';

const SurveyPdfAnswers = ({ response, survey }) => {
  const questions = response.surveySnapshot?.questions || survey.questions || [];
  return <div className="survey-pdf-answer-grid">{questions.map((question) => {
    const answer = response.answers?.[question.id] || {};
    const wide = question.type === QUESTION_TYPES.HEALTH_DOCUMENTS
      || (question.type === QUESTION_TYPES.NOTES && (answer.value || '').length > 120)
      || (question.type === QUESTION_TYPES.YES_NO && (answer.reason || '').length > 120);
    return <article className={`survey-pdf-question${wide ? ' survey-pdf-question-wide' : ''}`} key={question.id}><h2>{question.label}</h2>
      {question.type === QUESTION_TYPES.DOCUMENT && <div className="survey-pdf-pairs"><div><span>رقم الوثيقة</span><strong>{answer.documentNumber || '—'}</strong></div><div><span>تاريخ الانتهاء</span><strong>{answer.expiryDate || '—'}</strong></div></div>}
      {question.type === QUESTION_TYPES.YES_NO && <div className="survey-pdf-pairs"><div><span>الإجابة</span><strong>{answer.value === 'yes' ? 'نعم' : answer.value === 'no' ? 'لا' : '—'}</strong></div>{answer.value === 'no' && <div><span>السبب</span><strong>{answer.reason || '—'}</strong></div>}</div>}
      {question.type === QUESTION_TYPES.NOTES && <p>{answer.value || '—'}</p>}
      {question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && <table className="survey-pdf-workers"><thead><tr><th>الاسم الرباعي</th><th>رقم الهوية</th><th>رقم الجوال</th><th>انتهاء الشهادة الصحية</th><th>انتهاء التثقيف</th></tr></thead><tbody>{(answer.workers || []).map((worker) => <tr key={worker.id}><td>{worker.fullName}</td><td>{worker.identityNumber}</td><td>{worker.phoneNumber}</td><td>{worker.healthCertificateExpiryDate || '—'}</td><td>{worker.educationExpiryDate || '—'}</td></tr>)}</tbody></table>}
    </article>;
  })}</div>;
};

const SurveyPdfDocument = ({ survey, month, branches, responses }) => <div className="survey-pdf" dir="rtl">
  {branches.map((branch, index) => {
    const branchResponses = responses.filter((response) => response.surveyId === survey.id && response.branchId === branch.id && getResponseMonth(response) === month);
    const dates = [...new Set([...listDueOccurrencesInMonth(survey, month), ...branchResponses.map(occurrenceDateOfResponse)])].sort();
    const completed = branchResponses.filter((response) => response.status === RESPONSE_STATUS.SUBMITTED).length;
    return <section className="survey-pdf-branch" key={branch.id}>
      <header className="survey-pdf-header"><div><span className="survey-pdf-kicker">نظام سبأ · تقرير الاستبيانات</span><h1>{survey.title}</h1><p>{formatMonth(month)} · {branch.name || branch.id}</p></div><div className="survey-pdf-number">{index + 1} / {branches.length}</div></header>
      <div className="survey-pdf-status"><strong>المواعيد</strong><span>{completed} مكتمل من {dates.length}</span></div>
      {dates.length ? dates.map((date) => {
        const response = branchResponses.find((item) => occurrenceDateOfResponse(item) === date);
        return <section className="survey-pdf-occurrence" key={date}>
          <div className="survey-pdf-occurrence-heading"><strong>موعد {date}</strong><span>{response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'لم يرسل'}</span></div>
          {response && <SurveyPdfAnswers response={response} survey={survey} />}
        </section>;
      }) : <p className="survey-pdf-empty">لا توجد مواعيد مستحقة لهذا الفرع في الشهر المحدد.</p>}
      <footer>تاريخ إنشاء التقرير: {new Date().toLocaleString('ar-SA')} · {branch.name || branch.id}</footer>
    </section>;
  })}
</div>;

export default SurveyPdfDocument;
