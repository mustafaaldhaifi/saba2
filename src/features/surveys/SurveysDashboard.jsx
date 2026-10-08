import { useCallback, useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import {
  QUESTION_TYPES,
  RESPONSE_STATUS,
  SURVEY_STATUS,
  createEmptyQuestion,
  formatMonth,
  getRecentMonths,
} from './surveyConstants';
import { createSurvey, getBranches, getResponsesByMonth, getSurveys, updateSurveyAudience, updateSurveyStatus } from './surveyService';
import SurveyResponseDetailsModal from './SurveyResponseDetailsModal';
import './survey.css';

const questionTypeLabels = {
  [QUESTION_TYPES.DOCUMENT]: 'وثيقة',
  [QUESTION_TYPES.YES_NO]: 'نعم أو لا',
  [QUESTION_TYPES.NOTES]: 'ملاحظات',
};

const statusLabel = {
  [SURVEY_STATUS.ACTIVE]: 'نشط',
  [SURVEY_STATUS.PAUSED]: 'موقوف',
  [SURVEY_STATUS.ARCHIVED]: 'مؤرشف',
};

const SurveysDashboard = () => {
  const months = useMemo(() => getRecentMonths(), []);
  const [surveys, setSurveys] = useState([]);
  const [branches, setBranches] = useState([]);
  const [responses, setResponses] = useState([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [audienceSurveyId, setAudienceSurveyId] = useState(null);
  const [audienceBranchIds, setAudienceBranchIds] = useState([]);
  const [message, setMessage] = useState('');
  const [selectedResponse, setSelectedResponse] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    targetBranchIds: [],
    questions: [createEmptyQuestion(QUESTION_TYPES.DOCUMENT)],
  });

  const selectedSurvey = surveys.find((survey) => survey.id === selectedSurveyId) || surveys[0];

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [surveyList, branchList, monthlyResponses] = await Promise.all([
        getSurveys(),
        getBranches(),
        Promise.all(months.map((month) => getResponsesByMonth(month))),
      ]);
      setSurveys(surveyList);
      setBranches(branchList);
      setResponses(monthlyResponses.flat());
      setSelectedSurveyId((current) => current || surveyList[0]?.id || '');
    } catch (error) {
      setMessage('تعذر تحميل بيانات الاستبيانات.');
      console.error('Unable to load surveys:', error);
    } finally {
      setIsLoading(false);
    }
  }, [months]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateQuestion = (id, patch) => {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question) => question.id === id
        ? { ...question, ...patch }
        : question),
    }));
  };

  const changeQuestionType = (id, type) => {
    const next = createEmptyQuestion(type);
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question) => question.id === id ? { ...next, id } : question),
    }));
  };

  const toggleBranch = (branchId) => {
    setForm((current) => ({
      ...current,
      targetBranchIds: current.targetBranchIds.includes(branchId)
        ? current.targetBranchIds.filter((id) => id !== branchId)
        : [...current.targetBranchIds, branchId],
    }));
  };

  const allBranchIds = branches.map((branch) => branch.id);
  const toggleAllFormBranches = () => {
    setForm((current) => ({
      ...current,
      targetBranchIds: current.targetBranchIds.length === allBranchIds.length ? [] : allBranchIds,
    }));
  };

  const toggleAllAudienceBranches = () => {
    setAudienceBranchIds((current) => current.length === allBranchIds.length ? [] : allBranchIds);
  };

  const saveSurvey = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || form.targetBranchIds.length === 0 || form.questions.some((question) => !question.label.trim())) {
      setMessage('أدخل اسم الاستبيان، اختر فرعاً واحداً على الأقل، وأكمل عناوين الحقول.');
      return;
    }
    try {
      setIsSaving(true);
      setMessage('');
      await createSurvey(form);
      setForm({ title: '', description: '', targetBranchIds: [], questions: [createEmptyQuestion(QUESTION_TYPES.DOCUMENT)] });
      setIsCreating(false);
      setMessage('تم إنشاء الاستبيان وسيظهر للفروع المختارة هذا الشهر وما بعده.');
      await loadData();
    } catch (error) {
      setMessage('تعذر حفظ الاستبيان.');
      console.error('Unable to create survey:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const setSurveyStatus = async (survey, status) => {
    try {
      await updateSurveyStatus(survey.id, status);
      setSurveys((current) => current.map((item) => item.id === survey.id ? { ...item, status } : item));
      setMessage(status === SURVEY_STATUS.PAUSED ? 'تم إيقاف الاستبيان، ولن يظهر في الأشهر القادمة.' : 'تم تشغيل الاستبيان.');
    } catch (error) {
      setMessage('تعذر تغيير حالة الاستبيان.');
      console.error('Unable to update survey status:', error);
    }
  };

  const openAudienceEditor = (survey) => {
    setAudienceSurveyId(survey.id);
    setAudienceBranchIds(survey.targetBranchIds || []);
  };

  const saveAudience = async (survey) => {
    if (audienceBranchIds.length === 0) {
      setMessage('اختر فرعاً واحداً على الأقل أو أوقف الاستبيان بالكامل.');
      return;
    }
    try {
      await updateSurveyAudience(survey.id, audienceBranchIds);
      setSurveys((current) => current.map((item) => item.id === survey.id ? { ...item, targetBranchIds: audienceBranchIds, excludedBranchIds: [] } : item));
      setAudienceSurveyId(null);
      setMessage('تم تحديث الفروع. لن يظهر الاستبيان في الأشهر القادمة للفروع المستثناة.');
    } catch (error) {
      setMessage('تعذر تحديث الفروع المختارة.');
      console.error('Unable to update survey audience:', error);
    }
  };

  const visibleBranches = selectedSurvey
    ? branches.filter((branch) => selectedSurvey.targetBranchIds?.includes(branch.id) || responses.some((response) => response.surveyId === selectedSurvey.id && response.branchId === branch.id))
    : [];

  const getResponse = (branchId, month) => responses.find((response) => response.surveyId === selectedSurvey?.id && response.branchId === branchId && response.month === month);

  return (
    <DashboardLayout title="إدارة الاستبيانات" role="admin">
      <div className="survey-admin-header">
        <div><h1>الاستبيانات الشهرية</h1><p>إنشاء استبيانات مستمرة ومتابعة إجابات الفروع شهراً بشهر.</p></div>
        <button type="button" className="btn btn-primary" onClick={() => setIsCreating((current) => !current)}>{isCreating ? 'إلغاء' : 'إضافة استبيان'}</button>
      </div>

      {message && <div className="survey-message">{message}</div>}

      {isCreating && (
        <form className="survey-builder card" onSubmit={saveSurvey}>
          <h2>استبيان مستمر جديد</h2>
          <p className="survey-helper">سيظهر تلقائياً كل شهر للفروع المختارة، إلى أن يتم إيقافه.</p>
          <div className="survey-form-grid"><label>اسم الاستبيان<input className="input-field" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="مثال: استبيان وثائق الفرع" /></label><label>الوصف (اختياري)<input className="input-field" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="متابعة الوثائق والتصحيحات الشهرية" /></label></div>

          <fieldset className="survey-fieldset"><legend>الفروع التي سيظهر لها الاستبيان</legend><div className="survey-fieldset-actions"><span>{form.targetBranchIds.length} من {branches.length} فرع محدد</span><button type="button" className="survey-text-button" onClick={toggleAllFormBranches}>{form.targetBranchIds.length === branches.length ? 'إلغاء اختيار الكل' : 'اختيار الكل'}</button></div><div className="survey-checkbox-grid">{branches.map((branch) => <label key={branch.id}><input type="checkbox" checked={form.targetBranchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} /> {branch.name || branch.id}</label>)}</div></fieldset>

          <div className="survey-builder-questions"><div className="survey-section-heading"><h3>حقول الاستبيان</h3><button type="button" className="btn survey-secondary" onClick={() => setForm((current) => ({ ...current, questions: [...current.questions, createEmptyQuestion()] }))}>إضافة حقل</button></div>{form.questions.map((question, index) => <div className="survey-question-editor" key={question.id}><strong>الحقل {index + 1}</strong><select className="input-field" value={question.type} onChange={(event) => changeQuestionType(question.id, event.target.value)}>{Object.entries(questionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="input-field" value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} placeholder={question.type === QUESTION_TYPES.DOCUMENT ? 'اسم الوثيقة، مثل رخصة البلدية' : 'نص السؤال أو الملاحظة'} /><label className="survey-inline-check"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} /> حقل مطلوب</label>{question.type === QUESTION_TYPES.YES_NO && <label className="survey-inline-check"><input type="checkbox" checked={question.reasonRequiredWhen === 'no'} onChange={(event) => updateQuestion(question.id, { reasonRequiredWhen: event.target.checked ? 'no' : null })} /> اطلب السبب عند اختيار «لا»</label>}{form.questions.length > 1 && <button type="button" className="survey-link-danger" onClick={() => setForm((current) => ({ ...current, questions: current.questions.filter((item) => item.id !== question.id) }))}>حذف الحقل</button>}</div>)}</div>
          <div className="survey-actions"><button className="btn btn-primary" disabled={isSaving}>{isSaving ? 'جاري الحفظ...' : 'إنشاء وتفعيل الاستبيان'}</button></div>
        </form>
      )}

      <section className="survey-list-section"><h2>الاستبيانات</h2>{isLoading ? <p>جاري التحميل...</p> : surveys.length === 0 ? <div className="card">لا توجد استبيانات بعد.</div> : <div className="survey-admin-list">{surveys.map((survey) => <article className="survey-admin-item card" key={survey.id}><div><h3>{survey.title}</h3><p>{survey.description || 'بدون وصف'}</p><small>{survey.targetBranchIds?.length || 0} فرع · يبدأ من {formatMonth(survey.startsFrom)}</small></div><div className="survey-item-actions"><span className={`survey-response-state ${survey.status}`}>{statusLabel[survey.status]}</span><button type="button" className="btn survey-secondary" onClick={() => openAudienceEditor(survey)}>الفروع</button>{survey.status === SURVEY_STATUS.ACTIVE ? <button type="button" className="btn survey-secondary" onClick={() => setSurveyStatus(survey, SURVEY_STATUS.PAUSED)}>إيقاف</button> : survey.status === SURVEY_STATUS.PAUSED ? <button type="button" className="btn btn-primary" onClick={() => setSurveyStatus(survey, SURVEY_STATUS.ACTIVE)}>تشغيل</button> : null}</div>{audienceSurveyId === survey.id && <div className="survey-audience-editor"><strong>اختر الفروع التي سيظهر لها الاستبيان مستقبلاً</strong><div className="survey-fieldset-actions"><span>{audienceBranchIds.length} من {branches.length} فرع محدد</span><button type="button" className="survey-text-button" onClick={toggleAllAudienceBranches}>{audienceBranchIds.length === branches.length ? 'إلغاء اختيار الكل' : 'اختيار الكل'}</button></div><div className="survey-checkbox-grid">{branches.map((branch) => <label key={branch.id}><input type="checkbox" checked={audienceBranchIds.includes(branch.id)} onChange={() => setAudienceBranchIds((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])} /> {branch.name || branch.id}</label>)}</div><div className="survey-actions"><button type="button" className="btn survey-secondary" onClick={() => setAudienceSurveyId(null)}>إلغاء</button><button type="button" className="btn btn-primary" onClick={() => saveAudience(survey)}>حفظ الفروع</button></div></div>}</article>)}</div>}</section>

      <section className="survey-monitor card">
        <div className="survey-section-heading"><div><h2>متابعة الفروع حسب الشهر</h2><p>يعرض سجل الإرسال لآخر ستة أشهر.</p></div>{surveys.length > 0 && <select className="input-field survey-select" value={selectedSurvey?.id || ''} onChange={(event) => setSelectedSurveyId(event.target.value)}>{surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.title}</option>)}</select>}</div>
        {selectedSurvey ? <div className="survey-table-wrap"><table className="survey-monitor-table"><thead><tr><th>الفرع</th>{months.map((month) => <th key={month}>{formatMonth(month)}</th>)}</tr></thead><tbody>{visibleBranches.map((branch) => <tr key={branch.id}><td>{branch.name || branch.id}</td>{months.map((month) => { const response = getResponse(branch.id, month); const beforeStart = month < selectedSurvey.startsFrom; const state = response?.status === RESPONSE_STATUS.SUBMITTED ? 'submitted' : response?.status === RESPONSE_STATUS.DRAFT ? 'draft' : beforeStart ? 'not-applicable' : 'pending'; const label = response?.status === RESPONSE_STATUS.SUBMITTED ? 'تم' : response?.status === RESPONSE_STATUS.DRAFT ? 'مسودة' : beforeStart ? '—' : 'لم يرسل'; return <td key={month}>{response ? <button type="button" className={`survey-response-state survey-state-button ${state}`} onClick={() => setSelectedResponse({ response, branch })}>{label}</button> : <span className={`survey-response-state ${state}`}>{label}</span>}</td>; })}</tr>)}</tbody></table></div> : <p>أنشئ استبياناً للبدء بالمتابعة.</p>}
      </section>
      {selectedResponse && <SurveyResponseDetailsModal response={selectedResponse.response} branch={selectedResponse.branch} survey={selectedSurvey} onClose={() => setSelectedResponse(null)} />}
    </DashboardLayout>
  );
};

export default SurveysDashboard;
