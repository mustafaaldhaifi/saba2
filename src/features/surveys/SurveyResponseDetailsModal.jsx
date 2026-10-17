import { useState } from 'react';
import { auth } from '../../config/firebase';
import { QUESTION_TYPES, RESPONSE_STATUS, formatMonth } from './surveyConstants';
import { correctSurveyResponse } from './surveyService';
import { cleanSurveyAnswers, validateSurveyAnswers } from './surveyValidation';
import HealthWorkersEditor from './HealthWorkersEditor';
import SurveyDateField from './SurveyDateField';
import AvailabilityChoice from './AvailabilityChoice';
import { getResponseMonth, occurrenceDateOfResponse } from './surveySchedule';

const SurveyResponseDetailsModal = ({ response, branch, survey, onClose, onUpdated }) => {
  const questions = response.surveySnapshot?.questions || survey.questions || [];
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState(response.answers || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const updateAnswer = (id, patch) => setAnswers((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const save = async () => {
    const cleaned = cleanSurveyAnswers(questions, answers);
    const validationError = response.status === RESPONSE_STATUS.SUBMITTED ? validateSurveyAnswers(questions, cleaned) : null;
    if (validationError) { setError(validationError); return; }
    try {
      setSaving(true);
      const saved = await correctSurveyResponse({ response, survey, answers: cleaned, userId: auth.currentUser?.uid || null });
      onUpdated({ ...response, answers: saved });
      setEditing(false);
      setError('');
    } catch (saveError) { setError(saveError.message || 'تعذر حفظ التصحيح.'); }
    finally { setSaving(false); }
  };

  return <div className="survey-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="survey-modal survey-response-details" role="dialog" aria-modal="true" aria-label="تفاصيل إجابة الاستبيان" onMouseDown={(event) => event.stopPropagation()}>
      <div className="survey-modal-header"><div><h2>{response.surveySnapshot?.title || survey.title}</h2><p>{branch.name || branch.id} · {formatMonth(getResponseMonth(response))} · موعد {occurrenceDateOfResponse(response) || 'غير محدد'}</p></div><button type="button" className="survey-close" onClick={onClose}>×</button></div>
      <div className="survey-response-summary"><span className={`survey-response-state ${response.status}`}>{response.status === RESPONSE_STATUS.SUBMITTED ? 'تم الإرسال' : 'مسودة'}</span>{response.submittedAt?.seconds && <span>تاريخ الإرسال: {new Date(response.submittedAt.seconds * 1000).toLocaleString('ar-SA')}</span>}</div>
      <div className="survey-response-answers">{questions.map((question) => {
        const answer = answers[question.id] || {};
        return <article className="survey-response-answer" key={question.id}><h3>{question.label}</h3>
          {editing ? <>
            {question.type === QUESTION_TYPES.DOCUMENT && <div className="survey-document-fields"><AvailabilityChoice label="حالة الوثيقة" value={answer.status || 'available'} onChange={(status) => updateAnswer(question.id, { status, ...(status === 'missing' ? { documentNumber: '', expiryDate: '' } : {}) })} disabled={saving} />{(answer.status || 'available') === 'missing' ? <p className="survey-missing-note">الوثيقة غير موجودة</p> : <><input className="input-field" placeholder="رقم الوثيقة" value={answer.documentNumber || ''} onChange={(event) => updateAnswer(question.id, { documentNumber: event.target.value })} /><SurveyDateField label="تاريخ الانتهاء" value={answer.expiryDate || ''} onChange={(expiryDate) => updateAnswer(question.id, { expiryDate })} disabled={saving} /></>}</div>}
            {question.type === QUESTION_TYPES.YES_NO && <><select className="input-field" value={answer.value || ''} onChange={(event) => updateAnswer(question.id, { value: event.target.value, reason: event.target.value === 'no' ? answer.reason || '' : '' })}><option value="">اختر الإجابة</option><option value="yes">نعم</option><option value="no">لا</option></select>{answer.value === 'no' && <textarea className="input-field" placeholder="السبب" value={answer.reason || ''} onChange={(event) => updateAnswer(question.id, { reason: event.target.value })} />}</>}
            {question.type === QUESTION_TYPES.NOTES && <textarea className="input-field" value={answer.value || ''} onChange={(event) => updateAnswer(question.id, { value: event.target.value })} />}
            {question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && <HealthWorkersEditor workers={answer.workers || []} onChange={(workers) => updateAnswer(question.id, { workers })} disabled={saving} />}
          </> : <>
            {question.type === QUESTION_TYPES.DOCUMENT && <dl><div><dt>حالة الوثيقة</dt><dd>{answer.status === 'missing' ? 'غير موجودة' : 'متوفرة'}</dd></div>{answer.status !== 'missing' && <><div><dt>رقم الوثيقة</dt><dd>{answer.documentNumber || '—'}</dd></div><div><dt>تاريخ الانتهاء</dt><dd>{answer.expiryDate || '—'}</dd></div></>}</dl>}
            {question.type === QUESTION_TYPES.YES_NO && <dl><div><dt>الإجابة</dt><dd>{answer.value === 'yes' ? 'نعم' : answer.value === 'no' ? 'لا' : '—'}</dd></div>{answer.value === 'no' && <div><dt>السبب</dt><dd>{answer.reason || '—'}</dd></div>}</dl>}
            {question.type === QUESTION_TYPES.NOTES && <p>{answer.value || '—'}</p>}
            {question.type === QUESTION_TYPES.HEALTH_DOCUMENTS && <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>الاسم الرباعي</th><th>الرقم الوظيفي</th><th>رقم الهوية</th><th>رقم الجوال</th><th>بصمة في الفرع</th><th>انتهاء الشهادة الصحية</th><th>انتهاء التثقيف</th></tr></thead><tbody>{(answer.workers || []).map((worker) => <tr key={worker.id}><td>{worker.fullName}</td><td>{worker.employeeNumber || '—'}</td><td>{worker.identityNumber}</td><td>{worker.phoneNumber}</td><td>{worker.hasBranchFingerprint === 'yes' ? 'نعم' : worker.hasBranchFingerprint === 'no' ? 'لا' : '—'}</td><td>{worker.healthCertificateStatus === 'missing' ? 'غير موجودة' : worker.healthCertificateExpiryDate || '—'}</td><td>{worker.educationCertificateStatus === 'missing' ? 'غير موجودة' : worker.educationExpiryDate || '—'}</td></tr>)}</tbody></table>{!answer.workers?.length && <p>لا توجد بيانات عمال.</p>}</div>}
          </>}
        </article>;
      })}</div>
      {error && <p className="survey-error">{error}</p>}
      <div className="survey-actions">{editing ? <><button type="button" className="btn survey-secondary" onClick={() => { setAnswers(response.answers || {}); setEditing(false); setError(''); }}>إلغاء</button><button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ التصحيح'}</button></> : <button type="button" className="btn survey-secondary" onClick={() => setEditing(true)}>تعديل بيانات الفرع</button>}</div>
    </section>
  </div>;
};

export default SurveyResponseDetailsModal;
