import { QUESTION_TYPES, RESPONSE_STATUS, formatMonth } from './surveyConstants';

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
  : '—';

const SurveyResponseDetailsModal = ({ response, branch, survey, onClose }) => {
  const questions = response.surveySnapshot?.questions || survey.questions || [];
  const isSubmitted = response.status === RESPONSE_STATUS.SUBMITTED;

  return (
    <div className="survey-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="survey-modal survey-response-details" role="dialog" aria-modal="true" aria-label="تفاصيل إجابة الاستبيان" onMouseDown={(event) => event.stopPropagation()}>
        <div className="survey-modal-header">
          <div>
            <h2>{response.surveySnapshot?.title || survey.title}</h2>
            <p>{branch.name || branch.id} · {formatMonth(response.month)}</p>
          </div>
          <button type="button" className="survey-close" onClick={onClose}>×</button>
        </div>
        <div className="survey-response-summary">
          <span className={`survey-response-state ${response.status}`}>{isSubmitted ? 'تم الإرسال' : 'مسودة'}</span>
          {isSubmitted && response.submittedAt?.seconds && <span>أُرسل في {new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(response.submittedAt.seconds * 1000))}</span>}
        </div>

        <div className="survey-response-answers">
          {questions.map((question) => {
            const answer = response.answers?.[question.id] || {};
            return (
              <article className="survey-response-answer" key={question.id}>
                <h3>{question.label}</h3>
                {question.type === QUESTION_TYPES.DOCUMENT && <dl><div><dt>رقم الوثيقة</dt><dd>{answer.documentNumber || '—'}</dd></div><div><dt>تاريخ الانتهاء</dt><dd>{formatDate(answer.expiryDate)}</dd></div></dl>}
                {question.type === QUESTION_TYPES.YES_NO && <dl><div><dt>الإجابة</dt><dd>{answer.value === 'yes' ? 'نعم' : answer.value === 'no' ? 'لا' : '—'}</dd></div>{answer.value === 'no' && <div><dt>السبب</dt><dd>{answer.reason || '—'}</dd></div>}</dl>}
                {question.type === QUESTION_TYPES.NOTES && <p>{answer.value || '—'}</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default SurveyResponseDetailsModal;
