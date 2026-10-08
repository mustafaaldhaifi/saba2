import { useEffect, useMemo, useState } from 'react';
import { auth } from '../../config/firebase';
import { QUESTION_TYPES, RESPONSE_STATUS } from './surveyConstants';
import { getSurveyResponse, getVisibleSurveysForBranch, saveSurveyResponse } from './surveyService';
import './survey.css';

const answersFor = (survey, savedAnswers = {}) => Object.fromEntries(survey.questions.map((question) => [
  question.id,
  savedAnswers[question.id] || (question.type === QUESTION_TYPES.YES_NO
    ? { value: '', reason: '' }
    : question.type === QUESTION_TYPES.DOCUMENT
      ? { documentNumber: '', expiryDate: '' }
      : { value: '' }),
]));

const BranchSurveyPanel = ({ branchId }) => {
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [responseStatus, setResponseStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const submittedCount = useMemo(
    () => surveys.filter((survey) => survey.responseStatus === RESPONSE_STATUS.SUBMITTED).length,
    [surveys],
  );

  useEffect(() => {
    if (!branchId) return undefined;
    let isMounted = true;

    const loadSurveys = async () => {
      try {
        setIsLoading(true);
        const visibleSurveys = await getVisibleSurveysForBranch(branchId);
        const withResponses = await Promise.all(visibleSurveys.map(async (survey) => {
          const response = await getSurveyResponse({ surveyId: survey.id, branchId });
          return { ...survey, responseStatus: response?.status || null, savedAnswers: response?.answers || {} };
        }));
        if (isMounted) setSurveys(withResponses);
      } catch (loadError) {
        if (isMounted) setError('تعذر تحميل الاستبيانات حالياً.');
        console.error('Unable to load branch surveys:', loadError);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadSurveys();
    return () => { isMounted = false; };
  }, [branchId]);

  const openSurvey = (survey) => {
    setSelectedSurvey(survey);
    setAnswers(answersFor(survey, survey.savedAnswers));
    setResponseStatus(survey.responseStatus);
    setError('');
  };

  const updateAnswer = (questionId, patch) => {
    setAnswers((current) => ({ ...current, [questionId]: { ...current[questionId], ...patch } }));
  };

  const validate = () => {
    for (const question of selectedSurvey.questions) {
      const answer = answers[question.id] || {};
      if (!question.required) continue;
      if (question.type === QUESTION_TYPES.DOCUMENT && (!answer.documentNumber?.trim() || !answer.expiryDate)) return `أكمل بيانات: ${question.label}`;
      if (question.type === QUESTION_TYPES.YES_NO && !answer.value) return `اختر إجابة: ${question.label}`;
      if (question.type === QUESTION_TYPES.YES_NO && answer.value === 'no' && question.reasonRequiredWhen === 'no' && !answer.reason?.trim()) return `أدخل سبب عدم التصحيح: ${question.label}`;
      if (question.type === QUESTION_TYPES.NOTES && !answer.value?.trim()) return `أدخل: ${question.label}`;
    }
    return null;
  };

  const save = async (status) => {
    if (status === RESPONSE_STATUS.SUBMITTED) {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    try {
      setIsSaving(true);
      setError('');
      await saveSurveyResponse({ survey: selectedSurvey, branchId, userId: auth.currentUser?.uid || null, answers, status });
      setResponseStatus(status);
      setSurveys((current) => current.map((survey) => survey.id === selectedSurvey.id
        ? { ...survey, responseStatus: status, savedAnswers: answers }
        : survey));
    } catch (saveError) {
      setError('تعذر حفظ الإجابة. حاول مرة أخرى.');
      console.error('Unable to save survey response:', saveError);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || surveys.length === 0) return null;

  return (
    <section className="survey-branch-card card">
      <div className="survey-section-heading">
        <div>
          <h2>الاستبيانات الشهرية</h2>
          <p>أكمل الاستبيانات المطلوبة لهذا الشهر.</p>
        </div>
        <span className="survey-status-badge">{submittedCount} / {surveys.length} مكتمل</span>
      </div>
      {surveys.map((survey) => (
        <button type="button" className="survey-branch-item" key={survey.id} onClick={() => openSurvey(survey)}>
          <span>
            <strong>{survey.title}</strong>
            {survey.description && <small>{survey.description}</small>}
          </span>
          <span className={`survey-response-state ${survey.responseStatus || 'pending'}`}>
            {survey.responseStatus === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : survey.responseStatus === RESPONSE_STATUS.DRAFT ? 'مسودة' : 'مطلوب'}
          </span>
        </button>
      ))}

      {selectedSurvey && (
        <div className="survey-modal-backdrop" role="presentation" onMouseDown={() => setSelectedSurvey(null)}>
          <div className="survey-modal" role="dialog" aria-modal="true" aria-label={selectedSurvey.title} onMouseDown={(event) => event.stopPropagation()}>
            <div className="survey-modal-header">
              <div><h2>{selectedSurvey.title}</h2><p>{selectedSurvey.description}</p></div>
              <button type="button" className="survey-close" onClick={() => setSelectedSurvey(null)}>×</button>
            </div>
            {selectedSurvey.questions.map((question) => {
              const answer = answers[question.id] || {};
              return (
                <div className="survey-question" key={question.id}>
                  <label>{question.label}{question.required && <em> *</em>}</label>
                  {question.type === QUESTION_TYPES.DOCUMENT && <div className="survey-document-fields"><input className="input-field" placeholder="رقم الوثيقة" value={answer.documentNumber || ''} onChange={(event) => updateAnswer(question.id, { documentNumber: event.target.value })} /><input className="input-field" type="date" value={answer.expiryDate || ''} onChange={(event) => updateAnswer(question.id, { expiryDate: event.target.value })} /></div>}
                  {question.type === QUESTION_TYPES.YES_NO && <><div className="survey-choice-group"><button type="button" className={answer.value === 'yes' ? 'selected yes' : ''} onClick={() => updateAnswer(question.id, { value: 'yes', reason: '' })}>نعم</button><button type="button" className={answer.value === 'no' ? 'selected no' : ''} onClick={() => updateAnswer(question.id, { value: 'no' })}>لا</button></div>{answer.value === 'no' && question.reasonRequiredWhen === 'no' && <textarea className="input-field" placeholder="سبب عدم التصحيح" value={answer.reason || ''} onChange={(event) => updateAnswer(question.id, { reason: event.target.value })} />}</>}
                  {question.type === QUESTION_TYPES.NOTES && <textarea className="input-field" rows="4" value={answer.value || ''} onChange={(event) => updateAnswer(question.id, { value: event.target.value })} />}
                </div>
              );
            })}
            {error && <p className="survey-error">{error}</p>}
            {responseStatus === RESPONSE_STATUS.SUBMITTED && <p className="survey-success">تم إرسال إجابتك لهذا الشهر.</p>}
            <div className="survey-actions"><button type="button" className="btn survey-secondary" onClick={() => save(RESPONSE_STATUS.DRAFT)} disabled={isSaving}>حفظ مسودة</button><button type="button" className="btn btn-primary" onClick={() => save(RESPONSE_STATUS.SUBMITTED)} disabled={isSaving}>{isSaving ? 'جاري الحفظ...' : 'إرسال الاستبيان'}</button></div>
          </div>
        </div>
      )}
    </section>
  );
};

export default BranchSurveyPanel;
