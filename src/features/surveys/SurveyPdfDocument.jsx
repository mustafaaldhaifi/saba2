import { QUESTION_TYPES, RESPONSE_STATUS, formatMonth } from './surveyConstants';

const dateText = (value) => value || '—';

const SurveyPdfDocument = ({ survey, month, branches, responses }) => <div className="survey-pdf" dir="rtl">
  {branches.map((branch, index) => {
    const response = responses.find((item) => item.surveyId === survey.id && item.branchId === branch.id && item.month === month);
    const questions = response?.surveySnapshot?.questions || survey.questions || [];
    return <section className="survey-pdf-branch" key={branch.id}>
      <header className="survey-pdf-header"><div><span className="survey-pdf-kicker">نظام سبأ · تقرير الاستبيانات</span><h1>{response?.surveySnapshot?.title || survey.title}</h1><p>{formatMonth(month)} · {branch.name || branch.id}</p></div><div className="survey-pdf-number">{index + 1} / {branches.length}</div></header>
      <div className="survey-pdf-status"><strong>حالة الإجابة</strong><span>{response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'لم يرسل'}</span>{response?.submittedAt?.seconds && <small>تاريخ الإرسال: {new Date(response.submittedAt.seconds * 1000).toLocaleString('ar-SA')}</small>}</div>
      {response ? <div className="survey-pdf-answer-grid">{questions.map((question) => {
        const answer = response.answers?.[question.id] || {};
        const wide = question.type === QUESTION_TYPES.HEALTH_DOCUMENTS
          || (question.type === QUESTION_TYPES.NOTES && (answer.value || '').length > 120)
          || (question.type === QUESTION_TYPES.YES_NO && (answer.reason || '').length > 120);
        return <article className={`survey-pdf-question${wide ? ' survey-pdf-question-wide' : ''}`} key={question.id}><h2>{question.label}</h2>
          {question.type === QUESTION_TYPES.DOCUMENT && <div className="survey-pdf-pairs"><div><span>رقم الوثيقة</span><strong>{answer.documentNumber || '—'}</strong></div><div><span>تاريخ الانتهاء</span><strong>{dateText(answer.expiryDate)}</strong></div></div>}
          {question.type === QUESTION_TYPES.YES_NO && <div className="survey-pdf-pairs"><div><span>الإجابة</span><strong>{answer.value === 'yes' ? 'نعم' : answer.value === 'no' ? 'لا' : '—'}</strong></div>{answer.value === 'no' && <div><span>السبب</span><strong>{answer.reason || '—'}</strong></div>}</div>}
          {question.type === QUESTION_TYPES.NOTES && <p>{answer.value || '—'}</p>}
          {question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && <table className="survey-pdf-workers"><thead><tr><th>الاسم الرباعي</th><th>رقم الهوية</th><th>رقم الجوال</th><th>انتهاء الشهادة الصحية</th><th>انتهاء التثقيف</th></tr></thead><tbody>{(answer.workers || []).map((worker) => <tr key={worker.id}><td>{worker.fullName}</td><td>{worker.identityNumber}</td><td>{worker.phoneNumber}</td><td>{dateText(worker.healthCertificateExpiryDate)}</td><td>{dateText(worker.educationExpiryDate)}</td></tr>)}</tbody></table>}
        </article>;
      })}</div> : <p className="survey-pdf-empty">لم يسجل هذا الفرع إجابة لهذا الشهر.</p>}
      <footer>تاريخ إنشاء التقرير: {new Date().toLocaleString('ar-SA')} · {branch.name || branch.id}</footer>
    </section>;
  })}
</div>;

export default SurveyPdfDocument;
